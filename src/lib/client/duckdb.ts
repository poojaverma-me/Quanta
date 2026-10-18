/**
 * Browser-side DuckDB-WASM. The engine and the user's data live entirely in
 * this tab; only schema statistics and query results the models request are
 * ever sent to the API routes.
 */
import type { AsyncDuckDB, AsyncDuckDBConnection } from "@duckdb/duckdb-wasm";
import type { Cell, QueryResult } from "../types";

let ready: Promise<AsyncDuckDBConnection> | null = null;
let database: AsyncDuckDB | null = null;

export function initDuckDB() {
  ready ??= (async () => {
    // Imported lazily: the package's Node entry breaks server-side rendering.
    const duckdb = await import("@duckdb/duckdb-wasm");
    const bundle = await duckdb.selectBundle(duckdb.getJsDelivrBundles());
    // Workers can't be loaded cross-origin directly, so bootstrap one from a blob.
    const workerUrl = URL.createObjectURL(new Blob([`importScripts("${bundle.mainWorker}");`], { type: "text/javascript" }));
    const db = new duckdb.AsyncDuckDB(new duckdb.VoidLogger(), new Worker(workerUrl));
    await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
    URL.revokeObjectURL(workerUrl);
    await db.open({ query: { castBigIntToDouble: true, castDecimalToDouble: true, castTimestampToDate: true } });
    database = db;
    return db.connect();
  })();
  ready.catch(() => {
    ready = null;
  });
  return ready;
}

const pad = (n: number) => String(n).padStart(2, "0");
function formatDate(d: Date, dateOnly: boolean) {
  const day = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  if (dateOnly || (d.getUTCHours() === 0 && d.getUTCMinutes() === 0 && d.getUTCSeconds() === 0)) return day;
  return `${day} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}

function toCell(v: unknown, type: string): Cell {
  if (v === null || v === undefined) return null;
  const temporal = /^(Date|Timestamp)/.test(type);
  if (temporal && (typeof v === "number" || typeof v === "bigint" || v instanceof Date)) {
    const d = v instanceof Date ? v : new Date(Number(v));
    return Number.isNaN(d.getTime()) ? null : formatDate(d, type.startsWith("Date32"));
  }
  if (typeof v === "bigint") return Number(v);
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" || typeof v === "boolean") return v;
  if (v instanceof Date) return formatDate(v, false);
  try {
    return JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? Number(x) : x));
  } catch {
    return String(v);
  }
}

export async function query(sql: string, maxRows = 5000): Promise<QueryResult> {
  const conn = await initDuckDB();
  const started = performance.now();
  const table = await conn.query(sql);
  const fields = table.schema.fields;
  const types = fields.map((f) => String(f.type));
  const vectors = fields.map((_, i) => table.getChildAt(i));
  const total = table.numRows;
  const n = Math.min(total, maxRows);
  const rows: Cell[][] = new Array(n);
  for (let r = 0; r < n; r++) rows[r] = vectors.map((vec, i) => toCell(vec?.get(r), types[i]));
  return {
    columns: fields.map((f) => f.name),
    types,
    rows,
    rowCount: total,
    truncated: total > maxRows,
    elapsedMs: performance.now() - started,
  };
}

export async function registerFile(name: string, bytes: Uint8Array) {
  await initDuckDB();
  await database!.registerFileBuffer(name, bytes);
}

export async function dropFile(name: string) {
  try {
    await database?.dropFile(name);
  } catch {
    // already gone
  }
}
