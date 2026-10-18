"use client";

import { ArrowDown, ArrowUp, Code2, Info, Medal, Sparkle, Table2 } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { query } from "@/lib/client/duckdb";
import type { CardDef, Glow, GlobalKpis, KpiItem, RankRow } from "@/lib/client/hyper";
import type { QueryResult } from "@/lib/types";
import { ChartCanvas, type ChartMode, useChartData } from "./ChartView";
import { cx } from "./ui";

/** "↑19.6%" in green, "↓4.1%" in rose. Direction only: whether up is good depends on the metric. */
export function Delta({ cur, prev, className }: { cur: number | null | undefined; prev: number | null | undefined; className?: string }) {
  if (cur === null || cur === undefined || !prev) return null;
  const pct = ((cur - prev) / Math.abs(prev)) * 100;
  const up = pct >= 0;
  return (
    <span className={cx("num inline-flex items-center font-bold", up ? "text-[#3ee089]" : "text-[#ff6b7a]", className)}>
      {up ? <ArrowUp className="h-3.5 w-3.5" strokeWidth={2.75} aria-label="up" /> : <ArrowDown className="h-3.5 w-3.5" strokeWidth={2.75} aria-label="down" />}
      {Math.abs(pct).toFixed(1)}%
    </span>
  );
}

/** Big figures shrink as they get longer so they never clip in a half-width column. */
function figureSize(value: string, size: "lg" | "md") {
  const n = value.length;
  if (size === "md") return n > 9 ? "text-[22px]" : n > 7 ? "text-[25px]" : "text-[28px] sm:text-[30px]";
  return n > 9 ? "text-[24px]" : n > 7 ? "text-[29px]" : "text-[34px] sm:text-[38px]";
}

/** The ✦ Monthly / 🏅 Yearly pair from the reference cards. */
export function KpiPair({ items, size = "lg" }: { items: KpiItem[]; size?: "lg" | "md" }) {
  return (
    <div className="grid grid-cols-2 gap-5">
      {items.map((k) => (
        <div key={k.label} className="min-w-0">
          <div className="flex items-center gap-2 text-[14px] text-[#d4d4da]">
            {k.icon === "spark" ? <Sparkle className="h-4 w-4 shrink-0 fill-[#3ee089] text-[#3ee089]" /> : <Medal className="h-4 w-4 shrink-0 text-[#f5b83d]" />}
            <span className="truncate">{k.label}</span>
          </div>
          <div className={cx("num mt-2 truncate font-bold leading-none text-white", figureSize(k.value, size))} title={k.value}>
            {k.value}
          </div>
          <div className="mt-2.5 flex min-w-0 items-center gap-2 text-[13px]">
            <Delta cur={k.cur} prev={k.prev} />
            <span className="truncate text-[#6c6c78]">{k.sub}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

export function RankRows({ rows }: { rows: RankRow[] }) {
  if (!rows.length) return null;
  return (
    <ul className="divide-y divide-white/[0.09]">
      {rows.map((r) => (
        <li key={r.label} className="flex items-center justify-between gap-4 py-[13px] text-[15px]">
          <span className="truncate text-[#c9c9d1]">{r.label}</span>
          <span className="num shrink-0 text-[16px] font-semibold text-white">{r.value}</span>
        </li>
      ))}
    </ul>
  );
}

/** Soft colored light behind a chart, as in the references. */
function Halo({ glow }: { glow?: Glow }) {
  if (!glow || glow === "none") return null;
  const bg: Record<Exclude<Glow, "none">, string> = {
    bubbles: "radial-gradient(38% 40% at 50% 46%, rgba(255,120,40,0.32), rgba(220,38,90,0.18) 45%, rgba(124,58,237,0.16) 70%, transparent 100%)",
    green: "radial-gradient(45% 38% at 50% 62%, rgba(80,255,90,0.2), rgba(40,180,70,0.08) 55%, transparent 100%)",
    violet: "radial-gradient(40% 42% at 50% 50%, rgba(123,92,255,0.26), rgba(123,92,255,0.06) 60%, transparent 100%)",
    duo: "radial-gradient(34% 36% at 44% 52%, rgba(123,92,255,0.24), transparent 100%), radial-gradient(30% 32% at 58% 46%, rgba(242,106,33,0.16), transparent 100%)",
  };
  return <div aria-hidden className="pointer-events-none absolute inset-0 blur-xl" style={{ background: bg[glow] }} />;
}

/** The small octahedron glyph at the center of the reference radars. */
function CenterGlyph() {
  return (
    <div aria-hidden className="pointer-events-none absolute left-1/2 top-1/2 grid h-11 w-11 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border border-white/15 bg-black/70 shadow-[0_0_20px_rgba(123,92,255,0.35)]">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#e7e7ee" strokeWidth="1.6" strokeLinejoin="round">
        <path d="M12 2 21 12 12 22 3 12Z" />
        <path d="M3 12h18M12 2l-3.5 10L12 22l3.5-10Z" />
      </svg>
    </div>
  );
}

function useAux(sql?: string) {
  const [aux, setAux] = useState<QueryResult | null>(null);
  useEffect(() => {
    if (!sql) return;
    let live = true;
    query(sql)
      .then((r) => live && setAux(r))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [sql]);
  return aux;
}

/** Table / SQL / info controls, quiet until the card is hovered. */
function CardTools({ mode, setMode, caption }: { mode: ChartMode; setMode: (m: ChartMode) => void; caption: string }) {
  const btn = (active: boolean) => cx("grid h-7 w-7 place-items-center rounded-full transition", active ? "bg-white/10 text-white" : "text-[#6c6c78] hover:bg-white/5 hover:text-white");
  return (
    <div className="no-print flex items-center gap-0.5 opacity-60 transition group-hover:opacity-100 focus-within:opacity-100">
      {caption && (
        <span className={btn(false)} title={caption} aria-label={caption} tabIndex={0} role="note">
          <Info className="h-3.5 w-3.5" />
        </span>
      )}
      <button type="button" className={btn(mode === "table")} aria-label="Show data table" aria-pressed={mode === "table"} onClick={() => setMode(mode === "table" ? "chart" : "table")}>
        <Table2 className="h-3.5 w-3.5" />
      </button>
      <button type="button" className={btn(mode === "sql")} aria-label="Show SQL" aria-pressed={mode === "sql"} onClick={() => setMode(mode === "sql" ? "chart" : "sql")}>
        <Code2 className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

function ChartArea({ def, result, error, mode, height, compact, glyph }: { def: CardDef; result: QueryResult | null; error: string | null; mode: ChartMode; height?: number; compact?: boolean; glyph?: boolean }) {
  return (
    <div className="relative">
      {mode === "chart" && <Halo glow={def.glow} />}
      <div className="relative">
        <ChartCanvas spec={def.spec} result={result} error={error} mode={mode} height={height} compact={compact} />
        {glyph && mode === "chart" && result && def.spec.type !== "radar" && <CenterGlyph />}
      </div>
      {mode !== "chart" && def.spec.caption && <p className="mt-2 text-[12px] text-[#6c6c78]">{def.spec.caption}</p>}
    </div>
  );
}

/** "Sales Report" card: bold title, chart, KPI pair, three ranked rows. */
export function ReportCard({ def, g, className }: { def: CardDef; g: GlobalKpis | null; className?: string }) {
  const { result, error } = useChartData(def.spec);
  const aux = useAux(def.auxSql);
  const [mode, setMode] = useState<ChartMode>("chart");
  const kpis = result && def.kpis ? def.kpis(result, aux, g) : [];
  const rows = result && def.rows ? def.rows(result, aux) : [];
  const radar = def.spec.type === "radar";
  return (
    <section className={cx("card group fade-up flex flex-col overflow-hidden px-7 pb-5 pt-7", className)} aria-label={def.title}>
      <header className="flex items-start gap-3">
        <h2 className="flex-1 text-[28px] font-bold leading-[1.1] tracking-[-0.02em] text-white">{def.title}</h2>
        <CardTools mode={mode} setMode={setMode} caption={def.spec.caption} />
      </header>
      <div className="mt-3 flex-1">
        <ChartArea def={def} result={result} error={error} mode={mode} height={def.height ?? (radar ? 330 : 320)} glyph={radar && def.spec.extra?.shape !== "petal"} />
      </div>
      {kpis.length > 0 && (
        <div className="mt-6">
          <KpiPair items={kpis} />
        </div>
      )}
      {rows.length > 0 && (
        <div className="mt-5">
          <RankRows rows={rows} />
        </div>
      )}
    </section>
  );
}

/** KPI pair on top, chart below (the reference's two right-hand cards). */
export function KpiChartCard({ def, g, className }: { def: CardDef; g: GlobalKpis | null; className?: string }) {
  const { result, error } = useChartData(def.spec);
  const aux = useAux(def.auxSql);
  const [mode, setMode] = useState<ChartMode>("chart");
  const kpis = result && def.kpis ? def.kpis(result, aux, g) : [];
  return (
    <section className={cx("card group fade-up relative flex flex-col px-7 pb-5 pt-7", className)} aria-label={def.title}>
      <div className="absolute right-5 top-5">
        <CardTools mode={mode} setMode={setMode} caption={`${def.title}. ${def.spec.caption}`} />
      </div>
      {kpis.length > 0 ? <KpiPair items={kpis} size="md" /> : <div className="skeleton h-[86px]" />}
      <div className="mt-5 flex-1">
        <ChartArea def={def} result={result} error={error} mode={mode} height={def.height} />
      </div>
    </section>
  );
}

/** "Income" card: label, big figure, comparison line, sparkle chip, radar with center glyph. */
export function IncomeCard({ def, g, className }: { def: CardDef; g: GlobalKpis | null; className?: string }) {
  const { result, error } = useChartData(def.spec);
  const [mode, setMode] = useState<ChartMode>("chart");
  const h = result && def.headline ? def.headline(result, g) : null;
  return (
    <section className={cx("card group fade-up relative flex flex-col overflow-hidden px-7 pb-4 pt-7", className)} aria-label={def.spec.title}>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-[18px] font-semibold text-white">{def.title}</div>
          <div className="mt-1 flex flex-wrap items-baseline gap-x-3">
            <span className="num text-[40px] font-bold leading-[1.1] text-white">{h?.value ?? "–"}</span>
            {h && <Delta cur={h.cur} prev={h.prev} className="text-[14px]" />}
          </div>
          <div className="mt-1 text-[14px] text-[#8b8b96]">{h?.sub}</div>
        </div>
        <div className="flex flex-col items-end gap-2">
          <span className="grid h-11 w-11 place-items-center rounded-full bg-[#7b5cff]/15 shadow-[0_0_24px_rgba(123,92,255,0.45)]">
            <Sparkle className="h-5 w-5 fill-[#8f74ff] text-[#8f74ff]" />
          </span>
          <CardTools mode={mode} setMode={setMode} caption={def.spec.caption} />
        </div>
      </div>
      <div className="mt-2">
        <ChartArea def={def} result={result} error={error} mode={mode} height={330} glyph />
      </div>
      <div className="flex items-center justify-center gap-5 pb-1 text-[12px] text-[#8b8b96]">
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-[#7b5cff]" /> last 30 days
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-[#f26a21]" /> prior 30 days
        </span>
      </div>
    </section>
  );
}

/** Compact tile: title, figure + delta, grey line, mini radar on the right with a violet glow. */
export function RadarTile({ def, g, className }: { def: CardDef; g: GlobalKpis | null; className?: string }) {
  const { result, error } = useChartData(def.spec);
  const h = result && def.headline ? def.headline(result, g) : null;
  const enough = result && result.rowCount >= 3;
  return (
    <section className={cx("card fade-up relative flex items-center gap-3 overflow-hidden py-5 pl-6 pr-3", className)} aria-label={def.spec.title} title={def.spec.caption || def.spec.title}>
      <div aria-hidden className="pointer-events-none absolute -bottom-10 right-0 h-36 w-48 rounded-full bg-[#7b5cff]/25 blur-3xl" />
      <div className="relative min-w-0 flex-1">
        <div className="text-[15px] font-semibold text-white">{def.title}</div>
        <div className="mt-1.5 flex flex-wrap items-baseline gap-x-2">
          <span className="num text-[32px] font-bold leading-none text-white">{h?.value ?? "–"}</span>
          {h && <Delta cur={h.cur} prev={h.prev} className="text-[13px]" />}
        </div>
        <div className="mt-2.5 truncate text-[13px] text-[#8b8b96]" title={h?.sub}>
          {h?.sub}
        </div>
      </div>
      <div className="relative h-[132px] w-[150px] shrink-0">{error ? null : enough || !result ? <ChartCanvas spec={def.spec} result={result} height={132} compact /> : null}</div>
    </section>
  );
}

export function HyperCard({ def, g, className }: { def: CardDef; g: GlobalKpis | null; className?: string }): ReactNode {
  switch (def.template) {
    case "report":
      return <ReportCard def={def} g={g} className={className} />;
    case "kpichart":
      return <KpiChartCard def={def} g={g} className={className} />;
    case "income":
      return <IncomeCard def={def} g={g} className={className} />;
    default:
      return <RadarTile def={def} g={g} className={className} />;
  }
}
