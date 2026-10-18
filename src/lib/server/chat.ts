import type { Content, FunctionDeclaration } from "@google/genai";
import type { TokenUsage } from "../types";
import { getGemini, MODELS, validDate } from "./config";

export const RUN_SQL_DECLARATION: FunctionDeclaration = {
  name: "run_sql",
  description:
    "Execute one read-only DuckDB SQL query against the user's loaded tables and return the result rows. Always use this to look up facts; never guess numbers.",
  parametersJsonSchema: {
    type: "object",
    properties: {
      sql: { type: "string", description: "A single SELECT/WITH statement in DuckDB dialect." },
      explanation: { type: "string", description: "Very short description of what the query computes." },
    },
    required: ["sql", "explanation"],
  },
};

function systemInstruction(schema: string, today: string) {
  return `You are a voice-and-text data assistant. The user is talking to their spreadsheets, which are loaded into an in-browser DuckDB database:

${schema}

Today's date is ${today}.

How to answer:
- For any question about the data, call run_sql. Use the exact table and column names above. DuckDB dialect: date_trunc('month', ts), ts::DATE, current_date, strftime, quantile_cont, avg(x) FILTER (WHERE ...).
- Relative dates ("yesterday", "this month") are relative to today. If the data has no rows in that period because it ends earlier, say so and answer for the latest available period instead, naming the date.
- If a query errors, fix it and retry. Aggregate in SQL; don't fetch raw rows to count them yourself.
- Your final answer is often read aloud: 1-3 short sentences, lead with the answer, round numbers sensibly, no markdown tables, no SQL in the answer (the user can inspect the SQL separately).
- If the question can't be answered from these tables, say what's missing.`;
}

export interface ChatStepOutput {
  /** The model turn, returned verbatim so the browser can send it back (it carries thought signatures). */
  content: Content | null;
  functionCalls: { id?: string; name: string; args: Record<string, unknown> }[];
  text: string;
  usage: TokenUsage;
}

/** One Gemini turn. As with the agent, the browser runs the SQL and owns the loop. */
export async function chatStep(schema: string, contents: Content[], today?: string): Promise<ChatStepOutput> {
  const ai = getGemini();
  const response = await ai.models.generateContent({
    model: MODELS.chat,
    contents,
    config: {
      systemInstruction: systemInstruction(schema, validDate(today)),
      tools: [{ functionDeclarations: [RUN_SQL_DECLARATION] }],
    },
  });
  const content = response.candidates?.[0]?.content ?? null;
  const calls = (response.functionCalls ?? []).map((c) => ({ id: c.id, name: c.name ?? "", args: (c.args ?? {}) as Record<string, unknown> }));
  return {
    content,
    functionCalls: calls,
    text: calls.length ? "" : (response.text ?? ""),
    usage: {
      provider: "google",
      model: response.modelVersion ?? MODELS.chat,
      inputTokens: response.usageMetadata?.promptTokenCount ?? 0,
      outputTokens: (response.usageMetadata?.candidatesTokenCount ?? 0) + (response.usageMetadata?.thoughtsTokenCount ?? 0),
      cacheReadTokens: response.usageMetadata?.cachedContentTokenCount ?? 0,
    },
  };
}
