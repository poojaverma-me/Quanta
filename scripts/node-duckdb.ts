/** DuckDB for Node, wrapped as the same `SqlRunner` the browser uses. Scripts only. */
import { DuckDBInstance } from "@duckdb/node-api";
import type { Cell, QueryResult } from "../src/lib/types";

const pad = (n: number) => String(n).padStart(2, "0");

function toCell(v: unknown, type: string): Cell {
  if (v === null || v === undefined) return null;
  if (typeof v === "bigint") return Number(v);
  if (v instanceof Date) {
    const d = `${v.getUTCFullYear()}-${pad(v.getUTCMonth() + 1)}-${pad(v.getUTCDate())}`;
    return type === "DATE" ? d : `${d} ${pad(v.getUTCHours())}:${pad(v.getUTCMinutes())}:${pad(v.getUTCSeconds())}`;
  }
  if (typeof v === "number" || typeof v === "string" || typeof v === "boolean") return v;
  return String(v);
}

export async function createNodeRunner() {
  const instance = await DuckDBInstance.create(":memory:");
  const conn = await instance.connect();
  return async function run(sql: string, maxRows = 5000): Promise<QueryResult> {
    const started = performance.now();
    const reader = await conn.runAndReadAll(sql);
    const columns = reader.columnNames();
    const types = reader.columnTypes().map((t) => t.toString());
    const all = reader.getRowsJS();
    return {
      columns,
      types,
      rows: all.slice(0, maxRows).map((r) => r.map((v, i) => toCell(v, types[i]))),
      rowCount: all.length,
      truncated: all.length > maxRows,
      elapsedMs: performance.now() - started,
    };
  };
}
