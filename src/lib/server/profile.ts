import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import type { DatasetProfile, TokenUsage } from "../types";
import { getAnthropic, MODELS } from "./config";

const ColumnSchema = z.object({
  source_name: z.string().describe("Header exactly as given"),
  name: z.string().describe("snake_case SQL identifier"),
  sql_type: z.enum(["VARCHAR", "BIGINT", "DOUBLE", "BOOLEAN", "DATE", "TIMESTAMP"]),
  role: z.enum(["identifier", "timestamp", "category", "metric", "text", "boolean"]),
  timestamp_format: z.string().nullable().describe("DuckDB strptime pattern such as %m/%d/%Y when dates are NOT ISO-8601; otherwise null"),
  strip_non_numeric: z.boolean().describe("true when numbers carry $, commas, % or units that must be removed before casting"),
  description: z.string().describe("One short phrase describing the column"),
});

const ProfileSchema = z.object({
  table_name: z.string().describe("Short snake_case table name"),
  title: z.string().describe("Human title, 2-5 words"),
  domain: z.string().describe("Business domain, e.g. 'IT Service Management'"),
  columns: z.array(ColumnSchema),
  summary: z.array(z.string()).describe("2 to 4 paragraphs, see instructions"),
  primary_metric: z.string().nullable().describe("Name of the most important numeric column, or null"),
  primary_timestamp: z.string().nullable().describe("Name of the main event-time column, or null"),
  key_dimensions: z.array(z.string()).describe("Up to 3 category column names most useful for slicing, most important first"),
  heatmap_pair: z.array(z.string()).nullable().describe("Two category column names to cross-tabulate, or null"),
  suggested_objectives: z.array(z.string()).describe("4 strategic deep-dive objectives"),
  suggested_questions: z.array(z.string()).describe("4 short conversational questions"),
});

const SYSTEM = `You are a senior data engineer profiling a CSV that is about to be loaded into DuckDB for business analysis.

You receive the headers, DuckDB's own type sniffing (a hint only), and the first rows. Produce a typed schema and an executive dataset summary.

Schema rules
- Keep every column, in the original order, with source_name copied exactly.
- name: concise snake_case, unique.
- sql_type: TIMESTAMP for date+time values, DATE for date-only, BIGINT for whole-number counts, DOUBLE for measures that can be fractional (money, hours, rates, scores), BOOLEAN for true/false or Yes/No flags, VARCHAR otherwise. Identifiers such as "TCK-1001" or zip codes are VARCHAR.
- An empty cell is a missing value, not evidence of a text column.
- timestamp_format: null when values are ISO-8601 (2026-03-01, 2026-03-01 14:05:00, 2026-03-01T14:05:00Z). Otherwise give the DuckDB strptime pattern, e.g. %m/%d/%Y or %d-%b-%Y %H:%M.
- role: identifier (unique keys), timestamp, category (low-cardinality labels to group by), metric (numbers worth aggregating), boolean, text (free text).

Summary rules — 2 to 4 paragraphs, plain prose, no markdown, no bullet points:
1. What the dataset is, what one row represents, and the business process it captures.
2. The key metrics and what they measure.
3. The main categorical breakdowns and dimensions available for slicing.
4. (Optional) Time coverage and the kinds of questions the data can answer.
The rows you see are only the first few of the file. For size and time coverage use the total row count and the full-file date ranges provided, never the sample's dates. Don't invent other figures.

Dashboard hints (use the snake_case names you chose)
- key_dimensions: up to three category columns a manager would slice by first (teams, categories, regions, plans). Skip near-constant status flags and ID-like columns.
- heatmap_pair: two category columns that vary independently, so their cross-tab is informative (e.g. team × severity, region × plan). Avoid pairs where one column determines the other. Each should have roughly 3-15 values. null if none.

Suggestions
- suggested_objectives: four strategic deep-dive goals an operations lead would ask an analyst (bottlenecks, anomalies, drivers, trends), each one sentence.
- suggested_questions: four short natural questions someone could ask out loud, e.g. "Which category had the most tickets this month?"`;

export interface ProfileInput {
  fileName: string;
  headers: string[];
  detectedTypes: string[];
  rows: (string | null)[][];
  rowCount: number;
  /** Full-file min/max for date-like columns, computed locally by DuckDB. */
  ranges?: Record<string, [string, string]>;
}

function renderSample(input: ProfileInput) {
  const esc = (v: string | null) => (v === null ? "" : v.length > 80 ? `${v.slice(0, 80)}…` : v).replace(/\|/g, "/");
  const lines = [input.headers.map((h) => esc(h)).join(" | "), ...input.rows.map((r) => r.map(esc).join(" | "))];
  return lines.join("\n");
}

export async function profileDataset(input: ProfileInput): Promise<{ profile: DatasetProfile; usage: TokenUsage }> {
  const client = getAnthropic();
  const hints = input.headers.map((h, i) => `${h}: ${input.detectedTypes[i] ?? "VARCHAR"}`).join("\n");
  const ranges = Object.entries(input.ranges ?? {})
    .map(([c, [mn, mx]]) => `${c}: ${mn} → ${mx}`)
    .join("\n");
  const response = await client.messages.parse({
    model: MODELS.profiler,
    max_tokens: 8000,
    output_config: { effort: "low", format: zodOutputFormat(ProfileSchema) },
    system: SYSTEM,
    messages: [
      {
        role: "user",
        content: `File: ${input.fileName}\nTotal rows: ${input.rowCount}\n${ranges ? `\nFull-file date ranges (computed by DuckDB):\n${ranges}\n` : ""}\nDuckDB type sniffing (hint):\n${hints}\n\nFirst ${input.rows.length} rows (pipe-separated, empty = missing):\n${renderSample(input)}`,
      },
    ],
  });

  if (response.stop_reason === "refusal") throw new Error("The profiler declined to analyze this file.");
  if (response.stop_reason === "max_tokens") throw new Error("The profile response was cut off (too many columns?).");
  const parsed = response.parsed_output;
  if (!parsed) throw new Error("The profiler returned an unparseable schema.");

  return {
    profile: {
      ...parsed,
      summary: parsed.summary.filter((p) => p.trim()).slice(0, 4),
      suggested_objectives: parsed.suggested_objectives.slice(0, 4),
      suggested_questions: parsed.suggested_questions.slice(0, 4),
    },
    usage: {
      provider: "anthropic",
      model: MODELS.profiler,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
    },
  };
}
