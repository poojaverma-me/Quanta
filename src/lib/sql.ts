/**
 * Pure SQL helpers shared by the browser (DuckDB-WASM), the API routes and the
 * eval script (DuckDB for Node). Nothing in here touches a database directly.
 */
import type { Cell, ColumnSpec, ColumnStats, LoadedDataset, QueryResult, SqlType } from "./types";

export const quoteIdent = (name: string) => `"${name.replace(/"/g, '""')}"`;
export const quoteLiteral = (value: string) => `'${value.replace(/'/g, "''")}'`;

/** Turn any header into a safe snake_case identifier. */
export function toSnakeCase(name: string, fallback = "column") {
  const s = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
  if (!s) return fallback;
  return /^[0-9]/.test(s) ? `c_${s}` : s;
}

/** Make every name unique by suffixing duplicates. */
export function dedupe(names: string[]) {
  const seen = new Map<string, number>();
  return names.map((n) => {
    const count = seen.get(n) ?? 0;
    seen.set(n, count + 1);
    return count === 0 ? n : `${n}_${count + 1}`;
  });
}

const VALID_TYPES: SqlType[] = ["VARCHAR", "BIGINT", "DOUBLE", "BOOLEAN", "DATE", "TIMESTAMP"];
export const isSqlType = (t: string): t is SqlType => (VALID_TYPES as string[]).includes(t);

/** Map DuckDB's auto-detected type names onto our small type vocabulary. */
export function normalizeDuckType(t: string): SqlType {
  const u = t.toUpperCase();
  if (/^(TINYINT|SMALLINT|INTEGER|BIGINT|HUGEINT|UBIGINT|UINTEGER|USMALLINT|UTINYINT)/.test(u)) return "BIGINT";
  if (/^(DOUBLE|FLOAT|REAL|DECIMAL|NUMERIC)/.test(u)) return "DOUBLE";
  if (u.startsWith("BOOL")) return "BOOLEAN";
  if (u === "DATE") return "DATE";
  if (u.startsWith("TIMESTAMP")) return "TIMESTAMP";
  return "VARCHAR";
}

/**
 * The SELECT expression that converts one raw VARCHAR column into its typed
 * form. Every conversion is a TRY_ variant, so a bad guess yields NULLs rather
 * than a failed load; the caller measures the NULL rate and backs off.
 */
export function typedExpression(col: Pick<ColumnSpec, "source_name" | "sql_type" | "timestamp_format" | "strip_non_numeric">) {
  const v = `NULLIF(TRIM(${quoteIdent(col.source_name)}), '')`;
  const fmt = col.timestamp_format ? quoteLiteral(col.timestamp_format) : null;
  switch (col.sql_type) {
    case "BIGINT":
    case "DOUBLE": {
      const cleaned = col.strip_non_numeric ? `regexp_replace(${v}, '[^0-9eE.+-]', '', 'g')` : v;
      if (col.sql_type === "BIGINT") return `COALESCE(TRY_CAST(${cleaned} AS BIGINT), TRY_CAST(TRY_CAST(${cleaned} AS DOUBLE) AS BIGINT))`;
      return `TRY_CAST(${cleaned} AS DOUBLE)`;
    }
    case "BOOLEAN":
      return `CASE WHEN lower(${v}) IN ('true','t','yes','y','1') THEN TRUE WHEN lower(${v}) IN ('false','f','no','n','0') THEN FALSE END`;
    case "DATE":
      return fmt
        ? `CAST(try_strptime(${v}, ${fmt}) AS DATE)`
        : `COALESCE(TRY_CAST(${v} AS DATE), CAST(TRY_CAST(${v} AS TIMESTAMP) AS DATE))`;
    case "TIMESTAMP":
      return fmt ? `try_strptime(${v}, ${fmt})` : `TRY_CAST(${v} AS TIMESTAMP)`;
    default:
      return v;
  }
}

/** SQL to stage a CSV file as an all-VARCHAR table, so nothing can fail on load. */
export function stageCsvSql(fileRef: string, rawTable: string) {
  return `CREATE OR REPLACE TABLE ${quoteIdent(rawTable)} AS SELECT * FROM read_csv(${quoteLiteral(fileRef)}, all_varchar = true, header = true, sample_size = -1, ignore_errors = true)`;
}

export function createTypedTableSql(rawTable: string, table: string, columns: ColumnSpec[]) {
  const select = columns.map((c) => `${typedExpression(c)} AS ${quoteIdent(c.name)}`).join(",\n  ");
  return `CREATE OR REPLACE TABLE ${quoteIdent(table)} AS SELECT\n  ${select}\nFROM ${quoteIdent(rawTable)}`;
}

// ---------- read-only guard ----------

const FORBIDDEN = /\b(insert|update|delete|drop|create|alter|attach|detach|copy|export|import|install|load|pragma|call|vacuum|checkpoint|truncate|grant|revoke)\s/i;
const FORBIDDEN_FUNCS = /\b(read_\w+|glob|sniff_csv|parquet_\w+|httpfs|getenv|query_table|query)\s*\(/i;
const ALLOWED_START = /^(select|with|from|describe|summarize|show|explain|values|table|pivot|unpivot)\b/i;

/**
 * Only plain read queries may run against the user's data: generated SQL never
 * gets to modify tables or read files/URLs (which could leak data elsewhere).
 */
export function checkReadOnlySql(sql: string): { ok: true; sql: string } | { ok: false; reason: string } {
  const withoutComments = sql.replace(/--[^\n]*/g, " ").replace(/\/\*[\s\S]*?\*\//g, " ");
  // Blank out string literals and quoted identifiers so their contents can't trip the keyword checks.
  const skeleton = withoutComments.replace(/'(?:[^']|'')*'/g, "''").replace(/"(?:[^"]|"")*"/g, '""');
  const trimmed = skeleton.trim().replace(/;\s*$/, "");
  if (!trimmed) return { ok: false, reason: "Empty query." };
  if (trimmed.includes(";")) return { ok: false, reason: "Only a single statement is allowed." };
  if (!ALLOWED_START.test(trimmed)) return { ok: false, reason: "Only read-only SELECT queries are allowed." };
  const bad = trimmed.match(FORBIDDEN);
  if (bad) return { ok: false, reason: `Keyword "${bad[1].toUpperCase()}" is not allowed in read-only mode.` };
  const badFn = trimmed.match(FORBIDDEN_FUNCS);
  if (badFn) return { ok: false, reason: `Function "${badFn[1]}" is not allowed; query the loaded tables instead.` };
  return { ok: true, sql: withoutComments.trim().replace(/;\s*$/, "") };
}

// ---------- formatting results for a model ----------

function formatCell(v: Cell, maxLen = 60): string {
  if (v === null) return "∅";
  if (typeof v === "number") {
    if (Number.isInteger(v)) return String(v);
    const abs = Math.abs(v);
    return abs >= 1000 ? v.toFixed(1) : abs >= 1 ? v.toFixed(3).replace(/0+$/, "").replace(/\.$/, "") : v.toPrecision(3);
  }
  const s = String(v);
  return s.length > maxLen ? `${s.slice(0, maxLen)}…` : s;
}

/** Compact, token-frugal text rendering of a query result. */
export function formatResultForModel(result: QueryResult, maxRows = 40, maxChars = 6000): string {
  const header = result.columns.join(" | ");
  const lines = [header];
  let used = header.length;
  let shown = 0;
  for (const row of result.rows.slice(0, maxRows)) {
    const line = row.map((c) => formatCell(c)).join(" | ");
    if (used + line.length > maxChars) break;
    lines.push(line);
    used += line.length + 1;
    shown++;
  }
  const more = result.rowCount - shown;
  if (more > 0) lines.push(`… ${more} more row(s) not shown (${result.rowCount} total). Aggregate or add LIMIT to see specifics.`);
  if (result.rowCount === 0) lines.push("(no rows)");
  return lines.join("\n");
}

// ---------- schema context for prompts ----------

function describeColumn(s: ColumnStats, rowCount: number, description?: string) {
  const parts = [`- ${s.name} ${s.sql_type} [${s.role}]`];
  const nullPct = rowCount ? Math.round(((rowCount - s.non_null) / rowCount) * 100) : 0;
  if (s.role === "metric" || s.sql_type === "DOUBLE" || s.sql_type === "BIGINT") {
    parts.push(`min ${formatCell(s.min ?? null)}, max ${formatCell(s.max ?? null)}, avg ${formatCell(s.avg ?? null)}`);
  } else if (s.sql_type === "DATE" || s.sql_type === "TIMESTAMP") {
    parts.push(`range ${s.min ?? "?"} → ${s.max ?? "?"}`);
  }
  if (s.role === "identifier" && s.top_values?.length) {
    parts.push(`${s.distinct} distinct, e.g. ${s.top_values.map((t) => t.value).join(", ")}`);
  } else if (s.top_values?.length) {
    const list = s.top_values.map((t) => `${formatCell(t.value, 40)} (${t.count})`).join(", ");
    parts.push(s.distinct > s.top_values.length ? `${s.distinct} distinct, top: ${list}` : `values: ${list}`);
  } else if (s.distinct) {
    parts.push(`${s.distinct} distinct`);
  }
  if (nullPct > 0) parts.push(`${nullPct}% null`);
  let line = parts.join("; ");
  if (description) line += ` — ${description}`;
  return line;
}

/** Rich schema description: column types, roles, ranges and top values, computed locally. */
export function describeDatasetsForPrompt(datasets: Pick<LoadedDataset, "tableName" | "rowCount" | "profile" | "stats">[]) {
  return datasets
    .map((d) => {
      const desc = new Map(d.profile.columns.map((c) => [c.name, c.description]));
      const cols = d.stats.map((s) => describeColumn(s, d.rowCount, desc.get(s.name))).join("\n");
      return `TABLE ${d.tableName} — "${d.profile.title}" — ${d.rowCount.toLocaleString("en-US")} rows\n${cols}`;
    })
    .join("\n\n");
}
