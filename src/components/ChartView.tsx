"use client";

import { Code2, Table2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type * as HighchartsNS from "highcharts";
import { buildOptions, chartHeight, enableRotation, is3d, loadHighcharts } from "@/lib/client/charts";
import { query } from "@/lib/client/duckdb";
import { safeQuery } from "@/lib/loops";
import type { ChartSpec, QueryResult } from "@/lib/types";
import { RadarArt } from "./RadarArt";
import { cx, DataTable, IconButton, SqlBlock } from "./ui";

export type ChartMode = "chart" | "table" | "sql";

/** Runs a spec's SQL (unless a result is given) and returns the result for callers that also need the numbers. */
export function useChartData(spec: ChartSpec, given?: QueryResult | null) {
  const [fetched, setFetched] = useState<QueryResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (given) return;
    let live = true;
    safeQuery(query, spec.sql).then((q) => {
      if (!live) return;
      if (q.error) setError(q.error);
      else setFetched(q.result!);
    });
    return () => {
      live = false;
    };
  }, [spec.sql, given]);
  return { result: given ?? fetched, error };
}

/** Just the plot (or its table / SQL), no card chrome. */
export function ChartCanvas({ spec, result, error, mode = "chart", height, compact }: { spec: ChartSpec; result: QueryResult | null; error?: string | null; mode?: ChartMode; height?: number; compact?: boolean }) {
  const el = useRef<HTMLDivElement>(null);
  const chart = useRef<HighchartsNS.Chart | null>(null);

  const svgRadar = spec.type === "radar";

  useEffect(() => {
    if (!result || !el.current || mode !== "chart" || svgRadar) return;
    let live = true;
    let stopRotate: (() => void) | undefined;
    loadHighcharts().then((H) => {
      if (!live || !el.current) return;
      chart.current?.destroy();
      chart.current = H.chart(el.current, buildOptions(spec, result, { height, compact }));
      if (is3d(spec.type)) stopRotate = enableRotation(chart.current);
    });
    // Charts in hidden tabs mount at zero width; reflow when they become visible.
    const ro = new ResizeObserver(() => chart.current?.reflow());
    ro.observe(el.current);
    return () => {
      live = false;
      ro.disconnect();
      stopRotate?.();
      chart.current?.destroy();
      chart.current = null;
    };
  }, [result, spec, mode, height, compact, svgRadar]);

  const h = height ?? (result ? chartHeight(spec, result) : 260);
  if (error) return <div className="rounded-2xl border border-red-400/20 bg-red-400/5 p-4 text-[12.5px] text-red-200">Couldn&apos;t draw this chart: {error}</div>;
  if (!result) return <div className="skeleton" style={{ height: h }} />;
  if (mode === "table") return <DataTable result={result} dense />;
  if (mode === "sql") return <SqlBlock sql={spec.sql} />;
  // Radars are hand-drawn SVG to match the reference shapes exactly.
  if (svgRadar) return <RadarArt spec={spec} result={result} height={height} compact={compact} />;
  return <div ref={el} style={{ minHeight: h }} role="img" aria-label={`${spec.title}. ${spec.caption}`} />;
}

/** Table/SQL toggles for any chart card. */
export function ChartModeToggles({ mode, onChange }: { mode: ChartMode; onChange: (m: ChartMode) => void }) {
  return (
    <>
      <IconButton label="Show data table" active={mode === "table"} onClick={() => onChange(mode === "table" ? "chart" : "table")}>
        <Table2 className="h-4 w-4" />
      </IconButton>
      <IconButton label="Show SQL" active={mode === "sql"} onClick={() => onChange(mode === "sql" ? "chart" : "sql")}>
        <Code2 className="h-4 w-4" />
      </IconButton>
    </>
  );
}

/** A chart in a Hyper Charts-style card: bold title, quiet table/SQL toggles. Runs its SQL unless a result is supplied. */
export function ChartView({ spec, result: given, className, height, bare }: { spec: ChartSpec; result?: QueryResult | null; icon?: React.ReactNode; className?: string; height?: number; bare?: boolean }) {
  const { result, error } = useChartData(spec, given);
  const [mode, setMode] = useState<ChartMode>("chart");
  if (bare) return <div className={className}><ChartCanvas spec={spec} result={result} error={error} height={height} /></div>;
  return (
    <section className={cx("card group fade-up flex flex-col px-7 pb-6 pt-7", className)} aria-label={spec.title}>
      <header className="mb-4 flex items-start gap-3">
        <h2 className="flex-1 text-[22px] font-bold leading-tight tracking-[-0.02em] text-white">{spec.title}</h2>
        <div className="no-print flex items-center gap-0.5 opacity-60 transition group-hover:opacity-100 focus-within:opacity-100">
          <ChartModeToggles mode={mode} onChange={setMode} />
        </div>
      </header>
      <ChartCanvas spec={spec} result={result} error={error} mode={mode} height={height} />
      {spec.caption && <p className="mt-3 text-[12.5px] leading-relaxed text-[#6c6c78]">{spec.caption}</p>}
    </section>
  );
}
