"use client";

import { Play, Rows3, TableProperties, Terminal } from "lucide-react";
import { useEffect, useState } from "react";
import { formatNumber } from "@/lib/client/charts";
import { query } from "@/lib/client/duckdb";
import { safeQuery } from "@/lib/loops";
import { quoteIdent } from "@/lib/sql";
import type { LoadedDataset, QueryResult } from "@/lib/types";
import { Card, DataTable, Spinner, Tag, TypeBadge } from "./ui";

export function DataPanel({ dataset }: { dataset: LoadedDataset }) {
  const [preview, setPreview] = useState<QueryResult | null>(null);
  const [sql, setSql] = useState(`SELECT *\nFROM ${dataset.tableName}\nLIMIT 100`);
  const [result, setResult] = useState<QueryResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    query(`SELECT * FROM ${quoteIdent(dataset.tableName)} LIMIT 100`, 100).then(setPreview).catch(() => {});
  }, [dataset.tableName]);

  const run = async () => {
    setRunning(true);
    setError(null);
    const q = await safeQuery(query, sql);
    setRunning(false);
    if (q.error) {
      setError(q.error);
      setResult(null);
    } else setResult(q.result!);
  };

  const desc = new Map(dataset.profile.columns.map((c) => [c.name, c]));

  return (
    <div className="grid gap-5">
      <Card title="Schema" icon={<TableProperties className="h-4 w-4" />} sub={<span className="mono">{dataset.tableName}</span>}>
        <div className="scroll-thin overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-[12.5px]">
            <thead>
              <tr className="text-[11px] uppercase tracking-wider text-ink-3">
                <th className="py-2 pr-3 font-medium">Column</th>
                <th className="py-2 pr-3 font-medium">Type</th>
                <th className="py-2 pr-3 font-medium">Role</th>
                <th className="py-2 pr-3 font-medium">Description</th>
                <th className="py-2 pr-3 text-right font-medium">Filled</th>
                <th className="py-2 pr-3 text-right font-medium">Distinct</th>
                <th className="py-2 font-medium">Profile</th>
              </tr>
            </thead>
            <tbody>
              {dataset.stats.map((s) => {
                const c = desc.get(s.name);
                const filled = dataset.rowCount ? s.non_null / dataset.rowCount : 0;
                return (
                  <tr key={s.name} className="border-t border-line align-top">
                    <td className="py-2.5 pr-3">
                      <div className="mono text-ink">{s.name}</div>
                      {c && c.source_name !== s.name && <div className="text-[11px] text-ink-3">from “{c.source_name}”</div>}
                    </td>
                    <td className="py-2.5 pr-3">
                      <TypeBadge type={s.sql_type} />
                      {c?.timestamp_format && <div className="mono mt-1 text-[10.5px] text-ink-3">{c.timestamp_format}</div>}
                    </td>
                    <td className="py-2.5 pr-3">
                      <Tag>{s.role}</Tag>
                    </td>
                    <td className="max-w-[260px] py-2.5 pr-3 text-ink-2">{c?.description}</td>
                    <td className="py-2.5 pr-3 text-right">
                      <div className="tabular-nums text-ink">{Math.round(filled * 100)}%</div>
                      <div className="ml-auto mt-1 h-1 w-16 overflow-hidden rounded-full bg-white/5">
                        <div className="h-full rounded-full" style={{ width: `${filled * 100}%`, background: "var(--accent-grad)" }} />
                      </div>
                    </td>
                    <td className="py-2.5 pr-3 text-right tabular-nums text-ink-2">{formatNumber(s.distinct)}</td>
                    <td className="max-w-[320px] py-2.5 text-[12px] text-ink-2">
                      {s.sql_type === "DOUBLE" || s.sql_type === "BIGINT"
                        ? `${formatNumber(Number(s.min))} – ${formatNumber(Number(s.max))} · avg ${formatNumber(s.avg ?? null)}`
                        : s.sql_type === "DATE" || s.sql_type === "TIMESTAMP"
                          ? `${String(s.min).slice(0, 16)} → ${String(s.max).slice(0, 16)}`
                          : s.top_values
                              ?.slice(0, 4)
                              .map((t) => (s.role === "identifier" ? t.value : `${t.value} (${formatNumber(t.count)})`))
                              .join(", ")}
                      {s.cast_failure_rate !== undefined && s.cast_failure_rate > 0.001 && <div className="mt-1 text-[11px] text-yellow-200/80">{(s.cast_failure_rate * 100).toFixed(1)}% of values couldn&apos;t be parsed</div>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="SQL console" icon={<Terminal className="h-4 w-4" />} sub="read-only · DuckDB dialect · runs in your browser">
        <textarea
          value={sql}
          onChange={(e) => setSql(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") run();
          }}
          rows={5}
          spellCheck={false}
          className="mono w-full resize-y rounded-2xl border border-line bg-black/40 p-3.5 text-[12.5px] leading-relaxed text-ink focus:border-accent/40 focus:outline-none"
        />
        <div className="mt-3 flex items-center gap-3">
          <button onClick={run} disabled={running} className="btn-accent flex items-center gap-2 rounded-full px-4 py-2 text-[13px]">
            {running ? <Spinner className="border-[#03120a]/30 border-t-[#03120a]" /> : <Play className="h-3.5 w-3.5" />} Run
          </button>
          <span className="text-[12px] text-ink-3">⌘/Ctrl + Enter</span>
          {result && (
            <span className="ml-auto text-[12px] text-ink-3">
              {result.rowCount.toLocaleString()} rows · {Math.round(result.elapsedMs)} ms
            </span>
          )}
        </div>
        {error && <p className="mt-3 rounded-xl border border-red-400/20 bg-red-400/5 p-3 text-[12.5px] text-red-200">{error}</p>}
        {result && (
          <div className="mt-3">
            <DataTable result={result} maxRows={200} dense />
          </div>
        )}
      </Card>

      <Card title="Preview" icon={<Rows3 className="h-4 w-4" />} sub="first 100 rows">
        {preview ? <DataTable result={preview} maxRows={100} dense /> : <div className="skeleton h-64" />}
      </Card>
    </div>
  );
}
