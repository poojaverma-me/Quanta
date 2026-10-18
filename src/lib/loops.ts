/**
 * Isomorphic tool-use loops. The model call (`step`) and the SQL executor
 * (`runSql`) are injected: in the browser `step` is a fetch to an API route and
 * `runSql` hits DuckDB-WASM; in the eval script both are direct calls.
 */
import type Anthropic from "@anthropic-ai/sdk";
import type { Content, Part } from "@google/genai";
import type { AgentStepInput, AgentStepOutput } from "./server/agent";
import type { ChatStepOutput } from "./server/chat";
import { checkReadOnlySql, formatResultForModel } from "./sql";
import type { ChartSpec, QueryResult, Report, TokenUsage } from "./types";

export type SqlExecutor = (sql: string) => Promise<QueryResult>;

/** The user's local calendar date, YYYY-MM-DD. */
export const localToday = () => new Date().toLocaleDateString("en-CA");

/** Run model-written SQL through the read-only guard. Never throws. */
export async function safeQuery(runSql: SqlExecutor, sql: string): Promise<{ sql: string; result?: QueryResult; error?: string }> {
  const check = checkReadOnlySql(sql);
  if (!check.ok) return { sql, error: check.reason };
  try {
    return { sql: check.sql, result: await runSql(check.sql) };
  } catch (e) {
    return { sql: check.sql, error: e instanceof Error ? e.message.split("\n").slice(0, 3).join(" ") : String(e) };
  }
}

// ---------------- deep-dive agent (Claude) ----------------

export type AgentEvent =
  | { kind: "thinking"; text: string }
  | { kind: "note"; text: string }
  | { kind: "query"; id: string; purpose: string; sql: string }
  | { kind: "query_done"; id: string; result?: QueryResult; error?: string }
  | { kind: "validating"; charts: number }
  | { kind: "report"; report: Report; chartData: (QueryResult | null)[] }
  | { kind: "usage"; usage: TokenUsage; step: number }
  | { kind: "fallback"; from: string; to: string };

export interface AgentRunOptions {
  objective: string;
  schema: string;
  step: (input: AgentStepInput) => Promise<AgentStepOutput>;
  runSql: SqlExecutor;
  onEvent: (e: AgentEvent) => void;
  maxSteps?: number;
  signal?: AbortSignal;
}

function chartColumnsError(chart: ChartSpec, result: QueryResult) {
  const missing = [chart.x, chart.y, ...(chart.group ? [chart.group] : [])].filter((c) => !result.columns.includes(c));
  if (missing.length) return `returns columns [${result.columns.join(", ")}] but the spec names ${missing.map((m) => `"${m}"`).join(", ")}`;
  if (result.rowCount === 0) return "returns no rows";
  return null;
}

export async function runAgent({ objective, schema, step, runSql, onEvent, maxSteps = 18, signal }: AgentRunOptions): Promise<Report> {
  const messages: Anthropic.Beta.BetaMessageParam[] = [
    { role: "user", content: `Objective: ${objective}\n\nInvestigate, then call submit_report.` },
  ];

  for (let i = 1; i <= maxSteps; i++) {
    if (signal?.aborted) throw new DOMException("Analysis stopped", "AbortError");
    const out = await step({ schema, messages, today: localToday() });
    onEvent({ kind: "usage", usage: out.usage, step: i });
    // Append the assistant turn verbatim — thinking blocks must be sent back unchanged.
    messages.push({ role: "assistant", content: out.content as Anthropic.Beta.BetaContentBlockParam[] });

    const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
    let report: Report | null = null;
    let chartData: (QueryResult | null)[] = [];

    for (const block of out.content) {
      if (block.type === "thinking" && block.thinking.trim()) onEvent({ kind: "thinking", text: block.thinking.trim() });
      else if (block.type === "text" && block.text.trim()) onEvent({ kind: "note", text: block.text.trim() });
      else if (block.type === "fallback") onEvent({ kind: "fallback", from: block.from.model, to: block.to.model });
      else if (block.type === "tool_use" && block.name === "run_sql") {
        const input = block.input as { sql?: string; purpose?: string };
        onEvent({ kind: "query", id: block.id, purpose: input.purpose ?? "", sql: input.sql ?? "" });
        const q = await safeQuery(runSql, input.sql ?? "");
        onEvent({ kind: "query_done", id: block.id, result: q.result, error: q.error });
        const remaining = maxSteps - i;
        const budgetNote = remaining <= 3 ? `\n\n[${remaining} turn(s) left — call submit_report now.]` : "";
        results.push({
          type: "tool_result",
          tool_use_id: block.id,
          is_error: !!q.error,
          content: (q.error ? `SQL error: ${q.error}` : formatResultForModel(q.result!)) + budgetNote,
        });
      } else if (block.type === "tool_use" && block.name === "submit_report") {
        const candidate = block.input as Report;
        onEvent({ kind: "validating", charts: candidate.charts?.length ?? 0 });
        // Run every chart query before accepting the report, so broken charts get fixed by the agent.
        const problems: string[] = [];
        chartData = [];
        for (const [idx, chart] of (candidate.charts ?? []).entries()) {
          const q = await safeQuery(runSql, chart.sql);
          const problem = q.error ?? (q.result ? chartColumnsError(chart, q.result) : "no result");
          if (problem) problems.push(`Chart ${idx + 1} "${chart.title}": ${problem}`);
          chartData.push(q.result ?? null);
        }
        if (problems.length && i < maxSteps) {
          results.push({
            type: "tool_result",
            tool_use_id: block.id,
            is_error: true,
            content: `Report not accepted. Fix these charts and call submit_report again:\n${problems.join("\n")}`,
          });
        } else {
          report = { ...candidate, charts: candidate.charts.filter((_, idx) => !problems.some((p) => p.startsWith(`Chart ${idx + 1} `))) };
          chartData = chartData.filter((_, idx) => !problems.some((p) => p.startsWith(`Chart ${idx + 1} `)));
          results.push({ type: "tool_result", tool_use_id: block.id, content: "Report delivered." });
        }
      } else if (block.type === "tool_use") {
        results.push({ type: "tool_result", tool_use_id: block.id, is_error: true, content: `Unknown tool ${block.name}` });
      }
    }

    if (report) {
      onEvent({ kind: "report", report, chartData });
      return report;
    }
    if (out.stop_reason === "refusal") throw new Error("The model declined to continue this analysis.");
    if (!results.length) {
      // The model stopped without a report; nudge it once more.
      messages.push({ role: "user", content: "Please continue the investigation and finish by calling submit_report." });
      continue;
    }
    messages.push({ role: "user", content: results });
  }
  throw new Error("The agent ran out of steps before submitting a report.");
}

// ---------------- conversational Q&A (Gemini) ----------------

export interface ChatQuery {
  sql: string;
  explanation: string;
  result?: QueryResult;
  error?: string;
}

export interface ChatTurnResult {
  answer: string;
  queries: ChatQuery[];
  history: Content[];
  usage: TokenUsage[];
}

export interface ChatRunOptions {
  question: string;
  history: Content[];
  schema: string;
  step: (schema: string, contents: Content[], today: string) => Promise<ChatStepOutput>;
  runSql: SqlExecutor;
  onQuery?: (q: ChatQuery) => void;
  maxRounds?: number;
}

/** Keep the last few exchanges so long conversations stay cheap. */
function trimHistory(history: Content[], keepUserTurns = 6) {
  let seen = 0;
  for (let i = history.length - 1; i >= 0; i--) {
    const c = history[i];
    const isQuestion = c.role === "user" && c.parts?.some((p) => typeof p.text === "string");
    if (isQuestion && ++seen === keepUserTurns) return history.slice(i);
  }
  return history;
}

export async function runChat({ question, history, schema, step, runSql, onQuery, maxRounds = 6 }: ChatRunOptions): Promise<ChatTurnResult> {
  const contents: Content[] = [...trimHistory(history), { role: "user", parts: [{ text: question }] }];
  const queries: ChatQuery[] = [];
  const usage: TokenUsage[] = [];

  for (let round = 0; round < maxRounds; round++) {
    const out = await step(schema, contents, localToday());
    usage.push(out.usage);
    if (out.content) contents.push(out.content);
    if (!out.functionCalls.length) {
      return { answer: out.text.trim() || "I couldn't find an answer to that.", queries, history: contents, usage };
    }
    const parts: Part[] = [];
    for (const call of out.functionCalls) {
      const sql = String(call.args.sql ?? "");
      const q = await safeQuery(runSql, sql);
      const entry: ChatQuery = { sql: q.sql, explanation: String(call.args.explanation ?? ""), result: q.result, error: q.error };
      queries.push(entry);
      onQuery?.(entry);
      parts.push({
        functionResponse: {
          id: call.id,
          name: call.name,
          response: q.error ? { error: q.error } : { result: formatResultForModel(q.result!, 30, 4000) },
        },
      });
    }
    contents.push({ role: "user", parts });
  }
  return { answer: "That took too many steps — try asking a narrower question.", queries, history: contents, usage };
}
