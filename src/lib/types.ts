/** Types shared by the browser, the API routes and the eval script. */

export type SqlType = "VARCHAR" | "BIGINT" | "DOUBLE" | "BOOLEAN" | "DATE" | "TIMESTAMP";

export type ColumnRole = "identifier" | "timestamp" | "category" | "metric" | "text" | "boolean";

export interface ColumnSpec {
  /** Header exactly as it appears in the CSV. */
  source_name: string;
  /** snake_case column name used in the SQL table. */
  name: string;
  sql_type: SqlType;
  role: ColumnRole;
  /** strptime pattern for non-ISO dates (e.g. "%m/%d/%Y"); null when ISO or not temporal. */
  timestamp_format: string | null;
  /** Strip currency symbols, commas and % before casting to a number. */
  strip_non_numeric: boolean;
  description: string;
}

/** What Claude Haiku returns after looking at the sampled rows. */
export interface DatasetProfile {
  table_name: string;
  title: string;
  domain: string;
  columns: ColumnSpec[];
  /** Two to four paragraphs. */
  summary: string[];
  primary_metric: string | null;
  primary_timestamp: string | null;
  /** Categorical columns most useful for slicing, most important first. */
  key_dimensions: string[];
  /** Two independent categorical columns whose cross-tab is most informative. */
  heatmap_pair: string[] | null;
  suggested_objectives: string[];
  suggested_questions: string[];
}

export interface ColumnStats {
  name: string;
  sql_type: string;
  role: ColumnRole;
  non_null: number;
  distinct: number;
  min?: string | number | null;
  max?: string | number | null;
  avg?: number | null;
  top_values?: { value: string; count: number }[];
  /** Values the typed cast could not parse, as a share of non-empty raw values. */
  cast_failure_rate?: number;
}

export interface LoadedDataset {
  id: string;
  fileName: string;
  tableName: string;
  rowCount: number;
  profile: DatasetProfile;
  stats: ColumnStats[];
  /** True when the AI profile failed and we fell back to DuckDB's own type detection. */
  fallback: boolean;
  /** Set when this is a sample dataset with a pre-computed demo analysis. */
  demoPackId?: string;
  usage?: TokenUsage;
  loadedAt: number;
}

export type Cell = string | number | boolean | null;

export interface QueryResult {
  columns: string[];
  types: string[];
  rows: Cell[][];
  rowCount: number;
  truncated: boolean;
  elapsedMs: number;
}

export interface TokenUsage {
  provider: "anthropic" | "google";
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
}

// ---------- report (output of the deep-dive agent) ----------

/** The first six are available to the agent; the rest are Hyper Charts-style dashboard forms. */
export type ChartType = "area" | "line" | "bar" | "hbar" | "heatmap" | "donut" | "glowbars" | "pillcombo" | "candles" | "radar" | "bubble3d" | "ridgeline" | "lollipop3d" | "ridge3d";

export interface ChartSpec {
  title: string;
  type: ChartType;
  /** Read-only SQL whose result feeds the chart. */
  sql: string;
  /** Column for the x axis (or the category for bar/donut). */
  x: string;
  /** Numeric column plotted as the value. */
  y: string;
  /** Optional column that splits the data into series (or the heatmap's y axis). */
  group: string | null;
  caption: string;
  /** Extra column roles for the richer forms (line overlay, ranges, comparison, 3D axes). */
  extra?: {
    line?: string;
    low?: string;
    mid?: string;
    high?: string;
    /** Second, wider range drawn beside the first (candles). */
    low2?: string;
    high2?: string;
    compare?: string;
    z?: string;
    size?: string;
    /** Boolean column marking points to highlight (glow bars). */
    flag?: string;
    /** Radar outline: straight polygon, rounded star, flower petals, or a wavy ring. */
    shape?: "polygon" | "star" | "petal" | "wave";
    /** Column holding a human label for each point (tooltips). */
    label?: string;
  };
}

export interface Kpi {
  label: string;
  value: string;
  context: string;
  sentiment: "positive" | "negative" | "neutral";
}

export interface Finding {
  title: string;
  detail: string;
  severity: "high" | "medium" | "low";
}

export interface Recommendation {
  title: string;
  detail: string;
  impact: "high" | "medium" | "low";
}

export interface Report {
  title: string;
  executive_summary: string;
  kpis: Kpi[];
  findings: Finding[];
  charts: ChartSpec[];
  recommendations: Recommendation[];
}
