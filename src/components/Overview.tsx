"use client";

import { AudioLines, Sparkles } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { query } from "@/lib/client/duckdb";
import { DEMO_MODEL } from "@/lib/demo";
import { bigNumber, type GlobalKpis, hyperPlan } from "@/lib/client/hyper";
import { autoCharts } from "@/lib/client/overview";
import type { ChartSpec, LoadedDataset } from "@/lib/types";
import { ChartView } from "./ChartView";
import { HyperCard } from "./Hyper";
import { cx, Tag } from "./ui";

const WIDE = new Set(["area", "line", "heatmap"]);
const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));

export function Overview({ dataset, onAsk, onDeepDive }: { dataset: LoadedDataset; onAsk: (q?: string) => void; onDeepDive: (objective?: string) => void }) {
  const plan = useMemo(() => hyperPlan(dataset), [dataset]);
  const charts = useMemo(() => autoCharts(dataset, { skipTrends: plan.hero.side.length > 0 }), [dataset, plan]);
  const [g, setG] = useState<GlobalKpis | null>(null);

  useEffect(() => {
    let live = true;
    query(plan.kpiSql)
      .then((r) => {
        if (!live) return;
        const [cur_n, prev_n, cur_m, prev_m, total, all_m, anchor] = r.rows[0] ?? [];
        setG({ cur_n: num(cur_n), prev_n: num(prev_n), cur_m: num(cur_m), prev_m: num(prev_m), total: Number(total ?? 0), all_m: num(all_m), anchor: anchor ? String(anchor).slice(0, 10) : null });
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [plan]);

  // Remaining derived charts: pair a wide chart with a narrow one per row.
  const layout = useMemo(() => {
    const wide = charts.filter((c) => WIDE.has(c.type));
    const narrow = charts.filter((c) => !WIDE.has(c.type));
    const out: { spec: ChartSpec; span: string }[] = [];
    for (let i = 0; i < Math.max(wide.length, narrow.length); i++) {
      const w = wide[i];
      const n = narrow[i];
      if (w && n) out.push({ spec: w, span: "lg:col-span-7" }, { spec: n, span: "lg:col-span-5" });
      else if (w) out.push({ spec: w, span: "lg:col-span-12" });
      else if (n) out.push({ spec: n, span: "lg:col-span-6" });
    }
    return out;
  }, [charts]);

  const totalCells = dataset.rowCount * dataset.stats.length;
  const filled = dataset.stats.reduce((s, c) => s + c.non_null, 0);
  const { hero, depth, radar } = plan;
  const radarCols = [radar.left, radar.center, radar.right].filter((c) => c.length);

  return (
    <div className="space-y-5">
      {/* Row 1 — barcode report beside two KPI/chart cards */}
      {(hero.report || hero.side.length > 0) && (
        <div className="grid gap-5 lg:grid-cols-12">
          {hero.report && <HyperCard def={hero.report} g={g} className={hero.side.length ? "lg:col-span-6" : "lg:col-span-12"} />}
          {hero.side.length > 0 && (
            <div className={cx("grid gap-5", hero.report ? "lg:col-span-6" : "lg:col-span-12 lg:grid-cols-2")}>
              {hero.side.map((def) => (
                <HyperCard key={def.id} def={def} g={g} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Row 2 — three 3D report cards */}
      {depth.length > 0 && (
        <div className={cx("grid gap-5", depth.length === 3 ? "lg:grid-cols-3" : depth.length === 2 ? "lg:grid-cols-2" : "")}>
          {depth.map((def) => (
            <HyperCard key={def.id} def={def} g={g} />
          ))}
        </div>
      )}

      {/* Row 3 — radar composition */}
      {radarCols.length > 0 && (
        <div className={cx("grid items-start gap-5", radarCols.length === 3 ? "lg:grid-cols-3" : radarCols.length === 2 ? "lg:grid-cols-2" : "")}>
          {radarCols.map((col, i) => (
            <div key={i} className="grid gap-5">
              {col.map((def) => (
                <HyperCard key={def.id} def={def} g={g} />
              ))}
            </div>
          ))}
        </div>
      )}

      {/* Dataset brief */}
      <section className="card fade-up px-7 pb-7 pt-7">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h2 className="text-[22px] font-bold tracking-[-0.02em] text-white">Dataset brief</h2>
          <span className="text-[13px] text-[#6c6c78]">{dataset.demoPackId ? `written by ${DEMO_MODEL}` : dataset.fallback ? "auto-detected" : "written by Claude Haiku from 20 sample rows"}</span>
        </div>
        <div className="mt-4 grid gap-6 lg:grid-cols-[minmax(0,1fr)_280px]">
          <div className="space-y-3 text-[14.5px] leading-[1.7] text-[#a3a3ad]">
            {dataset.profile.summary.map((p, i) => (
              <p key={i} className={i === 0 ? "text-[#e6e6ea]" : undefined}>
                {p}
              </p>
            ))}
          </div>
          <ul className="divide-y divide-white/[0.09] self-start">
            {[
              ["Domain", dataset.profile.domain],
              ["Rows", bigNumber(dataset.rowCount)],
              ["Columns", String(dataset.stats.length)],
              ["Complete", `${totalCells ? Math.round((filled / totalCells) * 100) : 0}%`],
              ...(g?.anchor ? [["Latest record", g.anchor]] : []),
            ].map(([k, v]) => (
              <li key={k} className="flex items-center justify-between gap-4 py-[11px] text-[14px]">
                <span className="text-[#8b8b96]">{k}</span>
                <span className={cx("truncate text-white", k !== "Domain" && "num font-semibold")}>{v}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="mt-5 flex flex-wrap gap-2">
          <Tag tone="accent">Try it</Tag>
          {dataset.profile.suggested_objectives.slice(0, 2).map((o) => (
            <button key={o} onClick={() => onDeepDive(o)} className="chip flex items-center gap-1.5 rounded-full px-3 py-1.5 text-left text-[12.5px]">
              <Sparkles className="h-3.5 w-3.5 shrink-0 text-accent" /> {o}
            </button>
          ))}
          {dataset.profile.suggested_questions.slice(0, 2).map((q) => (
            <button key={q} onClick={() => onAsk(q)} className="chip flex items-center gap-1.5 rounded-full px-3 py-1.5 text-left text-[12.5px]">
              <AudioLines className="h-3.5 w-3.5 shrink-0 text-accent" /> {q}
            </button>
          ))}
        </div>
      </section>

      {/* Derived chart types in the same language */}
      {layout.length > 0 && (
        <div className="grid gap-5 lg:grid-cols-12">
          {layout.map(({ spec, span }) => (
            <ChartView key={spec.title} spec={spec} className={cx("col-span-1", span)} />
          ))}
        </div>
      )}
    </div>
  );
}
