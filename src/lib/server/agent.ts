import type Anthropic from "@anthropic-ai/sdk";
import type { TokenUsage } from "../types";
import { AGENT_EFFORT, getAnthropic, MODELS, validDate } from "./config";

type Tool = Anthropic.Beta.BetaTool;

const RUN_SQL: Tool = {
  name: "run_sql",
  description:
    "Run one read-only DuckDB SQL query against the user's loaded tables and get the result as text (at most ~40 rows are shown). Use aggregations, GROUP BY, window functions and CTEs rather than pulling raw rows.",
  strict: true,
  input_schema: {
    type: "object",
    properties: {
      purpose: { type: "string", description: "One short sentence: what this query checks and why. Shown to the user in the live timeline." },
      sql: { type: "string", description: "A single SELECT/WITH statement in DuckDB dialect." },
    },
    required: ["purpose", "sql"],
    additionalProperties: false,
  },
};

const level = { type: "string", enum: ["high", "medium", "low"] };

const SUBMIT_REPORT: Tool = {
  name: "submit_report",
  description: "Deliver the final executive intelligence report. Call exactly once, after the investigation is complete. Every figure must come from a query you ran.",
  strict: true,
  input_schema: {
    type: "object",
    properties: {
      title: { type: "string" },
      executive_summary: { type: "string", description: "3-5 sentences for an executive: what you found and why it matters." },
      kpis: {
        type: "array",
        description: "Exactly 4 headline metrics.",
        items: {
          type: "object",
          properties: {
            label: { type: "string" },
            value: { type: "string", description: "Formatted value, e.g. '31.4 h' or '+212%'" },
            context: { type: "string", description: "Short comparison, e.g. '2.3× the org median'" },
            sentiment: { type: "string", enum: ["positive", "negative", "neutral"] },
          },
          required: ["label", "value", "context", "sentiment"],
          additionalProperties: false,
        },
      },
      findings: {
        type: "array",
        description: "3-6 findings ordered by importance.",
        items: {
          type: "object",
          properties: { title: { type: "string" }, detail: { type: "string" }, severity: level },
          required: ["title", "detail", "severity"],
          additionalProperties: false,
        },
      },
      charts: {
        type: "array",
        description: "2-4 charts that make the findings visible.",
        items: {
          type: "object",
          properties: {
            title: { type: "string" },
            type: { type: "string", enum: ["area", "line", "bar", "hbar", "heatmap", "donut"] },
            sql: { type: "string", description: "Read-only query returning the columns named in x, y and group." },
            x: { type: "string", description: "Result column for the x axis / category." },
            y: { type: "string", description: "Numeric result column." },
            group: { type: ["string", "null"], description: "Result column that splits series (heatmap: the y-axis category), or null." },
            caption: { type: "string", description: "One sentence telling the reader what to notice." },
          },
          required: ["title", "type", "sql", "x", "y", "group", "caption"],
          additionalProperties: false,
        },
      },
      recommendations: {
        type: "array",
        description: "3-5 concrete, actionable recommendations.",
        items: {
          type: "object",
          properties: { title: { type: "string" }, detail: { type: "string" }, impact: level },
          required: ["title", "detail", "impact"],
          additionalProperties: false,
        },
      },
    },
    required: ["title", "executive_summary", "kpis", "findings", "charts", "recommendations"],
    additionalProperties: false,
  },
};

export const AGENT_TOOLS: Tool[] = [RUN_SQL, SUBMIT_REPORT];

function systemPrompt(schema: string, today: string) {
  return `You are an autonomous senior data analyst. A business stakeholder gives you a strategic objective; you investigate the data with SQL and deliver an executive intelligence report.

## Data
The user's data is loaded in an in-browser DuckDB database. Tables (profiled locally):

${schema}

Today's date is ${today}. If the data ends before today, interpret relative periods ("this month", "recently") against the latest date in the data and say so.

## How to work
- Investigate iteratively with run_sql: establish baselines, break down by the relevant dimensions, compare periods (percentage change), and test for anomalies (spikes vs. a rolling or overall baseline, outliers vs. the median). Follow the evidence: when something stands out, drill into it.
- Before each query, say in one short sentence what you are checking; the user watches your steps live.
- Be economical: pack several aggregates into one query; 5-12 queries is typical. Never select raw rows without a LIMIT.
- DuckDB dialect: date_trunc('week', ts), strftime(ts, '%Y-%m'), ts::DATE, quantile_cont(x, 0.5), avg(x) FILTER (WHERE cond), lag() OVER (ORDER BY ...), round(x, 1). Use the exact table and column names above.
- If a query fails, read the error and fix it.
- Every number in the report must come from a query result. Don't invent figures.

## The report
When you have enough evidence, call submit_report once:
- 4 KPIs, 3-6 findings with concrete numbers, 3-5 recommendations an operations lead could act on this quarter.
- 2-4 charts. Each chart's SQL must return exactly the columns named in x, y and group, and must run on its own:
  - area/line: x is a time bucket (DATE or TIMESTAMP), ordered by x; optional group with at most 6 series.
  - bar/hbar: x is a category, at most 15 rows ordered by y descending; optional group with at most 5 series.
  - heatmap: x and group are categories (at most 15 × 12), y is the value.
  - donut: at most 8 slices.
  Prefer charts that show the anomaly or bottleneck you found, not generic distributions.`;
}

export interface AgentStepInput {
  schema: string;
  /** The user's local date (YYYY-MM-DD); relative dates must follow the user's calendar, not the server's. */
  today?: string;
  messages: Anthropic.Beta.BetaMessageParam[];
}

export interface AgentStepOutput {
  content: Anthropic.Beta.BetaContentBlock[];
  stop_reason: string | null;
  usage: TokenUsage;
}

/**
 * One turn of the agent. The browser owns the loop: it executes run_sql calls
 * against its local DuckDB and sends results back, so the data never leaves
 * the user's machine except for the aggregated results the model asks for.
 */
export async function agentStep({ schema, messages, today }: AgentStepInput): Promise<AgentStepOutput> {
  const client = getAnthropic();
  const response = await client.beta.messages.create({
    model: MODELS.agent,
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    thinking: { type: "adaptive", display: "summarized" },
    output_config: { effort: AGENT_EFFORT },
    cache_control: { type: "ephemeral" },
    system: systemPrompt(schema, validDate(today)),
    tools: AGENT_TOOLS,
    messages,
  });
  return {
    content: response.content,
    stop_reason: response.stop_reason,
    usage: {
      provider: "anthropic",
      model: response.model,
      inputTokens: response.usage.input_tokens + (response.usage.cache_creation_input_tokens ?? 0),
      outputTokens: response.usage.output_tokens,
      cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
    },
  };
}
