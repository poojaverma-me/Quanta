/**
 * Database-agnostic ingestion pipeline. The browser runs it against
 * DuckDB-WASM and the eval script against DuckDB for Node — both pass in a
 * `SqlRunner`, so the same code path is exercised in tests and in the app.
 */
import { createTypedTableSql, dedupe, normalizeDuckType, quoteIdent, quoteLiteral, stageCsvSql, toSnakeCase, typedExpression } from "./sql";
import type { ColumnRole, ColumnSpec, ColumnStats, DatasetProfile, QueryResult, SqlType } from "./types";

export type SqlRunner = (sql: string) => Promise<QueryResult>;

export const SAMPLE_ROWS = 20;
/** A typed column is reverted to VARCHAR if more than this share of its values fail to parse. */
const MAX_CAST_FAILURE = 0.2;

export interface RawSample {
  headers: string[];
  rows: (string | null)[][];
  rowCount: number;
  /** DuckDB's own type guess per header — used as a hint and as the fallback. */
  detectedTypes: SqlType[];
  /** Full-file min/max of columns DuckDB sniffed as dates, so the profiler sees the real coverage. */
  ranges: Record<string, [string, string]>;
}

export async function stageCsv(run: SqlRunner, fileRef: string, rawTable: string): Promise<RawSample> {
  await run(stageCsvSql(fileRef, rawTable));
  const sample = await run(`SELECT * FROM ${quoteIdent(rawTable)} LIMIT ${SAMPLE_ROWS}`);
  const count = await run(`SELECT count(*) AS n FROM ${quoteIdent(rawTable)}`);
  let detectedTypes: SqlType[] = sample.columns.map(() => "VARCHAR");
  const ranges: Record<string, [string, string]> = {};
  const source = `read_csv(${quoteLiteral(fileRef)}, header = true, sample_size = 20480)`;
  try {
    const described = await run(`DESCRIBE SELECT * FROM ${source}`);
    const nameIdx = described.columns.indexOf("column_name");
    const typeIdx = described.columns.indexOf("column_type");
    const byName = new Map(described.rows.map((r) => [String(r[nameIdx]), normalizeDuckType(String(r[typeIdx]))]));
    detectedTypes = sample.columns.map((c) => byName.get(c) ?? "VARCHAR");
    const temporal = sample.columns.filter((_, i) => detectedTypes[i] === "DATE" || detectedTypes[i] === "TIMESTAMP").slice(0, 8);
    if (temporal.length) {
      const r = await run(`SELECT ${temporal.map((c) => `CAST(min(${quoteIdent(c)}) AS VARCHAR), CAST(max(${quoteIdent(c)}) AS VARCHAR)`).join(", ")} FROM ${source}`);
      temporal.forEach((c, i) => {
        const [mn, mx] = [r.rows[0]?.[i * 2], r.rows[0]?.[i * 2 + 1]];
        if (mn !== null && mx !== null && mn !== undefined) ranges[c] = [String(mn), String(mx)];
      });
    }
  } catch {
    // Type sniffing is only a hint; keep VARCHAR guesses.
  }
  return {
    headers: sample.columns,
    rows: sample.rows.map((r) => r.map((c) => (c === null ? null : String(c)))),
    rowCount: Number(count.rows[0]?.[0] ?? 0),
    detectedTypes,
    ranges,
  };
}

/** Heuristic profile used when the AI profiler is unavailable. */
export function fallbackProfile(fileName: string, sample: RawSample): DatasetProfile {
  const base = toSnakeCase(fileName.replace(/\.[^.]+$/, ""), "dataset");
  const names = dedupe(sample.headers.map((h, i) => toSnakeCase(h, `column_${i + 1}`)));
  const columns: ColumnSpec[] = sample.headers.map((h, i) => {
    const t = sample.detectedTypes[i];
    const distinct = new Set(sample.rows.map((r) => r[i])).size;
    let role: ColumnRole = "text";
    if (t === "DATE" || t === "TIMESTAMP") role = "timestamp";
    else if (t === "BOOLEAN") role = "boolean";
    else if (t === "BIGINT" || t === "DOUBLE") role = /(^|_)(id|zip|code)$/i.test(names[i]) ? "identifier" : "metric";
    else if (/(^|_)id$/i.test(names[i]) || distinct === sample.rows.length) role = "identifier";
    else role = "category";
    return { source_name: h, name: names[i], sql_type: t, role, timestamp_format: null, strip_non_numeric: false, description: "" };
  });
  return {
    table_name: base,
    title: fileName.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " "),
    domain: "General",
    columns,
    summary: [
      `This dataset was loaded from ${fileName} with ${sample.rowCount.toLocaleString("en-US")} rows and ${columns.length} columns. Column types were detected automatically because the AI profiler was unavailable.`,
    ],
    primary_metric: columns.find((c) => c.role === "metric")?.name ?? null,
    primary_timestamp: columns.find((c) => c.role === "timestamp")?.name ?? null,
    key_dimensions: [],
    heatmap_pair: null,
    suggested_objectives: ["Summarize the key trends and outliers in this dataset"],
    suggested_questions: ["How many rows are there per category?"],
  };
}

/**
 * Reconcile the model's column list with the real headers: every header must
 * appear exactly once, in order, with a unique, safe identifier.
 */
export function reconcileProfile(profile: DatasetProfile, sample: RawSample, fileName: string): DatasetProfile {
  const fallback = fallbackProfile(fileName, sample);
  const byHeader = new Map(profile.columns.map((c) => [c.source_name, c]));
  const columns = sample.headers.map((h, i) => byHeader.get(h) ?? profile.columns[i] ?? fallback.columns[i]);
  const names = dedupe(columns.map((c, i) => toSnakeCase(c.name || sample.headers[i], `column_${i + 1}`)));
  const fixed = columns.map((c, i) => ({ ...c, source_name: sample.headers[i], name: names[i] }));
  const nameSet = new Set(names);
  return {
    ...profile,
    key_dimensions: (profile.key_dimensions ?? []).filter((n) => nameSet.has(n)),
    heatmap_pair: profile.heatmap_pair?.length === 2 && profile.heatmap_pair.every((n) => nameSet.has(n)) && profile.heatmap_pair[0] !== profile.heatmap_pair[1] ? profile.heatmap_pair : null,
    table_name: toSnakeCase(profile.table_name || fallback.table_name, "dataset"),
    columns: fixed,
    primary_metric: profile.primary_metric && nameSet.has(profile.primary_metric) ? profile.primary_metric : fallback.primary_metric,
    primary_timestamp: profile.primary_timestamp && nameSet.has(profile.primary_timestamp) ? profile.primary_timestamp : fallback.primary_timestamp,
  };
}

/**
 * Build the typed table. Each column's conversion is measured first; any column
 * whose values mostly fail to parse (or whose expression errors, e.g. a bad
 * strptime pattern) is kept as VARCHAR instead.
 */
export async function materialize(run: SqlRunner, rawTable: string, table: string, profile: DatasetProfile) {
  const failures: Record<string, number> = {};
  const columns: ColumnSpec[] = [];
  for (const col of profile.columns) {
    if (col.sql_type === "VARCHAR") {
      columns.push(col);
      continue;
    }
    let rate = 1;
    try {
      const v = `NULLIF(TRIM(${quoteIdent(col.source_name)}), '')`;
      const r = await run(`SELECT count(${v}) AS raw_n, count(${typedExpression(col)}) AS typed_n FROM ${quoteIdent(rawTable)}`);
      const rawN = Number(r.rows[0][0]);
      const typedN = Number(r.rows[0][1]);
      rate = rawN === 0 ? 0 : 1 - typedN / rawN;
    } catch {
      rate = 1;
    }
    failures[col.name] = rate;
    if (rate > MAX_CAST_FAILURE) {
      columns.push({ ...col, sql_type: "VARCHAR", role: col.role === "metric" || col.role === "timestamp" ? "category" : col.role, timestamp_format: null });
    } else {
      columns.push(col);
    }
  }
  await run(createTypedTableSql(rawTable, table, columns));
  await run(`DROP TABLE IF EXISTS ${quoteIdent(rawTable)}`);
  const fixedProfile: DatasetProfile = {
    ...profile,
    table_name: table,
    columns,
    primary_metric: columns.find((c) => c.name === profile.primary_metric && (c.sql_type === "DOUBLE" || c.sql_type === "BIGINT"))?.name ?? columns.find((c) => c.role === "metric" && c.sql_type !== "VARCHAR")?.name ?? null,
    primary_timestamp: columns.find((c) => c.name === profile.primary_timestamp && (c.sql_type === "DATE" || c.sql_type === "TIMESTAMP"))?.name ?? columns.find((c) => c.sql_type === "DATE" || c.sql_type === "TIMESTAMP")?.name ?? null,
  };
  return { profile: fixedProfile, failures };
}

const asScalar = (v: unknown) => (v === null || v === undefined ? null : typeof v === "number" ? v : String(v));

/** Per-column profile statistics — computed locally, never sent anywhere except as prompt context. */
export async function computeStats(run: SqlRunner, table: string, profile: DatasetProfile, failures: Record<string, number> = {}): Promise<ColumnStats[]> {
  const t = quoteIdent(table);
  const stats: ColumnStats[] = [];
  for (const col of profile.columns) {
    const c = quoteIdent(col.name);
    const numeric = col.sql_type === "BIGINT" || col.sql_type === "DOUBLE";
    const temporal = col.sql_type === "DATE" || col.sql_type === "TIMESTAMP";
    const extra = numeric
      ? `, min(${c}) AS mn, max(${c}) AS mx, avg(${c}) AS av`
      : temporal
        ? `, CAST(min(${c}) AS VARCHAR) AS mn, CAST(max(${c}) AS VARCHAR) AS mx, NULL AS av`
        : ", NULL AS mn, NULL AS mx, NULL AS av";
    const r = await run(`SELECT count(${c}) AS nn, count(DISTINCT ${c}) AS nd${extra} FROM ${t}`);
    const [nn, nd, mn, mx, av] = r.rows[0];
    const s: ColumnStats = {
      name: col.name,
      sql_type: col.sql_type,
      role: col.role,
      non_null: Number(nn),
      distinct: Number(nd),
      min: asScalar(mn),
      max: asScalar(mx),
      avg: av === null ? null : Number(av),
    };
    if (failures[col.name] !== undefined) s.cast_failure_rate = failures[col.name];
    const wantsTop = !numeric && !temporal && (col.role !== "identifier" || s.distinct <= 12);
    if (wantsTop || col.role === "category" || col.role === "boolean") {
      const top = await run(`SELECT CAST(${c} AS VARCHAR) AS v, count(*) AS n FROM ${t} WHERE ${c} IS NOT NULL GROUP BY 1 ORDER BY 2 DESC, 1 LIMIT ${col.role === "text" ? 3 : 10}`);
      s.top_values = top.rows.map((row) => ({ value: String(row[0]), count: Number(row[1]) }));
    } else if (col.role === "identifier") {
      const ex = await run(`SELECT CAST(${c} AS VARCHAR) FROM ${t} WHERE ${c} IS NOT NULL LIMIT 2`);
      s.top_values = ex.rows.map((row) => ({ value: String(row[0]), count: 1 }));
    }
    stats.push(s);
  }
  return stats;
}

/** Pick a table name that isn't already taken. */
export function uniqueTableName(base: string, taken: Iterable<string>) {
  const used = new Set(taken);
  if (!used.has(base)) return base;
  for (let i = 2; ; i++) if (!used.has(`${base}_${i}`)) return `${base}_${i}`;
}
