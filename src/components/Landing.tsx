"use client";

import { ArrowRight, AudioLines, Bot, Database, FileSpreadsheet, Headset, LineChart, ShoppingCart, Upload, Users } from "lucide-react";
import type { EngineState, IngestStatus } from "./Workspace";
import { cx, Spinner } from "./ui";

const SAMPLES = [
  { file: "support_tickets.csv", title: "IT & Support Tickets", detail: "6.4k tickets · SLAs, departments, CSAT", icon: Headset },
  { file: "saas_churn.csv", title: "SaaS Subscription Churn", detail: "2.6k accounts · plans, MRR, NPS", icon: Users },
  { file: "ecommerce_fulfillment.csv", title: "E-commerce Fulfillment", detail: "7.8k orders · warehouses, carriers", icon: ShoppingCart },
];

/** Topographic contour rings, drawn procedurally (deterministic). */
function ContourArt() {
  const rings = Array.from({ length: 16 }, (_, k) => {
    const r = 26 + k * 13;
    const pts = Array.from({ length: 96 }, (_, i) => {
      const a = (i / 96) * Math.PI * 2;
      const wob = 1 + 0.12 * Math.sin(a * 3 + k * 0.5) + 0.07 * Math.sin(a * 5 - k * 0.3) + 0.04 * Math.cos(a * 9 + k);
      return [300 + Math.cos(a) * r * wob * 1.45, 210 + Math.sin(a) * r * wob * 0.78];
    });
    return `M${pts.map((p) => p.map((v) => v.toFixed(1)).join(",")).join("L")}Z`;
  });
  return (
    <svg viewBox="0 0 600 420" className="h-full w-full" aria-hidden>
      <defs>
        <radialGradient id="heat" cx="50%" cy="50%" r="50%">
          <stop offset="0" stopColor="#d9ffb8" stopOpacity="0.9" />
          <stop offset="0.25" stopColor="#7cff6b" stopOpacity="0.65" />
          <stop offset="0.55" stopColor="#22d3ee" stopOpacity="0.35" />
          <stop offset="0.8" stopColor="#8b5cf6" stopOpacity="0.18" />
          <stop offset="1" stopColor="#8b5cf6" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="terrain" cx="50%" cy="50%" r="50%">
          <stop offset="0" stopColor="#1e1b4b" stopOpacity="0.6" />
          <stop offset="1" stopColor="#000" stopOpacity="0" />
        </radialGradient>
        <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="2.2" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      <ellipse cx="300" cy="210" rx="300" ry="170" fill="url(#terrain)" />
      <ellipse cx="300" cy="210" rx="150" ry="85" fill="url(#heat)" opacity="0.6" />
      <g filter="url(#glow)" fill="none">
        {rings.map((d, k) => (
          <path
            key={k}
            d={d}
            stroke={k < 3 ? "#b6ff8f" : k < 6 ? "#2ef2b0" : k < 9 ? "#22d3ee" : k < 12 ? "#3e73e6" : "#8b5cf6"}
            strokeOpacity={k < 12 ? 0.95 - k * 0.06 : 0.3 - (k - 12) * 0.05}
            strokeWidth={k < 4 ? 1.4 : 1}
          />
        ))}
      </g>
      {[
        [228, 168, "anomaly"],
        [388, 236, "bottleneck"],
        [300, 132, "spike"],
      ].map(([x, y, t]) => (
        <g key={String(t)}>
          <line x1={x as number} y1={y as number} x2={x as number} y2={(y as number) - 34} stroke="rgba(124,255,107,0.55)" />
          <circle cx={x as number} cy={y as number} r="3.5" fill="#7cff6b" />
          <rect x={(x as number) - 30} y={(y as number) - 54} width="60" height="20" rx="10" fill="#000" stroke="rgba(124,255,107,0.4)" />
          <text x={x as number} y={(y as number) - 40} textAnchor="middle" fontSize="10" fill="#f5f5f7" fontFamily="inherit">
            {t}
          </text>
        </g>
      ))}
    </svg>
  );
}

export function Landing({
  engine,
  ingest,
  stageLabel,
  onPick,
  onSample,
  health,
}: {
  engine: EngineState;
  ingest: IngestStatus | null;
  stageLabel: (s: IngestStatus) => string;
  onPick: () => void;
  onSample: (file: string) => void;
  health: { anthropic: boolean; gemini: boolean } | null;
}) {
  const busy = !!ingest;
  return (
    <div className="grid gap-5 pt-2 lg:grid-cols-12">
      <section className="card fade-up overflow-hidden lg:col-span-7">
        <div className="relative px-6 pb-8 pt-8 sm:px-10 sm:pt-12">
          <span className="inline-flex items-center gap-2 rounded-full border border-accent/25 bg-accent/10 px-3 py-1 text-[12px] font-medium text-accent">
            <span className="h-1.5 w-1.5 rounded-full bg-accent" /> Talk to your CSVs
          </span>
          <h1 className="mt-5 max-w-xl text-[38px] font-semibold leading-[1.08] tracking-tight sm:text-[46px]">
            Your spreadsheets, <span className="accent-text">as an analyst</span> you can talk to.
          </h1>
          <p className="mt-4 max-w-lg text-[15px] leading-relaxed text-ink-2">
            Drop a CSV and it becomes a typed SQL database in your browser. An autonomous agent investigates bottlenecks and anomalies, and you can ask follow-ups out loud.
          </p>

          <button
            onClick={onPick}
            disabled={busy || engine === "error"}
            className={cx("mt-8 flex w-full items-center gap-4 rounded-[22px] border-2 border-dashed p-5 text-left transition sm:p-6", busy ? "border-accent/40 bg-accent/[0.04]" : "border-white/12 hover:border-accent/50 hover:bg-accent/[0.03]")}
          >
            <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl" style={{ background: "var(--accent-grad)" }}>
              {busy ? <Spinner className="!h-5 !w-5 border-[#03120a]/30 border-t-[#03120a]" /> : <Upload className="h-5 w-5 text-[#03120a]" />}
            </span>
            <span className="min-w-0 flex-1">
              {busy ? (
                <>
                  <span className="block truncate text-[15px] font-medium">{ingest!.fileName}</span>
                  <span className="mt-0.5 block text-[13px] text-ink-2">
                    {stageLabel(ingest!)}
                    {ingest!.note ? ` · ${ingest!.note}` : "…"}
                  </span>
                </>
              ) : (
                <>
                  <span className="block text-[15px] font-medium">Drop a CSV here, or browse</span>
                  <span className="mt-0.5 block text-[13px] text-ink-3">Any delimiter, any size your browser can hold. Data never leaves this tab.</span>
                </>
              )}
            </span>
          </button>
          <p className="mt-3 flex items-center gap-2 text-[12px] text-ink-3">
            {engine === "loading" ? (
              <>
                <Spinner className="!h-3 !w-3" /> Warming up DuckDB-WASM…
              </>
            ) : engine === "ready" ? (
              <>
                <span className="h-1.5 w-1.5 rounded-full bg-green-400" /> DuckDB engine ready
              </>
            ) : (
              <>
                <span className="h-1.5 w-1.5 rounded-full bg-red-400" /> DuckDB failed to load. Check your connection and refresh.
              </>
            )}
          </p>
          {health && (!health.anthropic || !health.gemini) && (
            <p className="mt-2 text-[12px] text-yellow-200/80">
              {!health.anthropic && "ANTHROPIC_API_KEY is missing (profiling falls back to auto-detection; Deep Dive is unavailable). "}
              {!health.gemini && "GEMINI_API_KEY is missing (Ask is unavailable)."}
            </p>
          )}
        </div>
      </section>

      <section className="card fade-up relative overflow-hidden lg:col-span-5" style={{ animationDelay: "60ms" }}>
        <div className="absolute inset-0 opacity-90">
          <ContourArt />
        </div>
        <div className="relative flex h-full min-h-[320px] flex-col justify-end p-6">
          <div className="glass rounded-[20px] p-4">
            <div className="flex items-center gap-2 text-[12px] text-ink-3">
              <Bot className="h-3.5 w-3.5 text-accent" /> Example finding · support tickets sample
            </div>
            <p className="mt-1.5 text-[13.5px] leading-relaxed text-ink">
              Security Engineering takes <b>39.1 h</b> to resolve a ticket on average, <span className="text-accent">1.9×</span> the overall mean of 21.1 h. Access requests make up 73% of its queue.
            </p>
          </div>
        </div>
      </section>

      <section className="lg:col-span-12">
        <div className="mb-3 mt-2 flex items-center gap-3 px-1">
          <h2 className="text-[15px] font-medium">Try a synthetic enterprise dataset</h2>
          <span className="h-4 w-px bg-white/15" />
          <span className="text-[13px] text-ink-3">generated by scripts/generate-data.ts</span>
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          {SAMPLES.map((s, i) => (
            <button
              key={s.file}
              onClick={() => onSample(s.file)}
              disabled={busy || engine !== "ready"}
              className="card fade-up group flex items-center gap-4 p-5 text-left transition hover:border-accent/30 disabled:opacity-60"
              style={{ animationDelay: `${100 + i * 50}ms` }}
            >
              <span className="icon-chip !h-11 !w-11 group-hover:text-accent">
                <s.icon className="h-5 w-5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[14.5px] font-medium">{s.title}</span>
                <span className="mt-0.5 block text-[12.5px] text-ink-3">{s.detail}</span>
              </span>
              <ArrowRight className="h-4 w-4 text-ink-3 transition group-hover:translate-x-0.5 group-hover:text-accent" />
            </button>
          ))}
        </div>
      </section>

      <section className="grid gap-4 sm:grid-cols-2 lg:col-span-12 lg:grid-cols-4">
        {[
          { icon: FileSpreadsheet, t: "Schema intelligence", d: "Claude Haiku reads 20 sample rows, types every column and writes an executive summary." },
          { icon: Database, t: "In-browser DuckDB", d: "The full file becomes a typed SQL table locally. Nothing is uploaded." },
          { icon: LineChart, t: "Autonomous deep dives", d: "Claude Opus runs iterative SQL to find bottlenecks and anomalies, then writes the report." },
          { icon: AudioLines, t: "Voice Q&A", d: "Ask out loud. Gemini turns your question into SQL; inspect the query and the rows." },
        ].map((f) => (
          <div key={f.t} className="inset p-4">
            <f.icon className="h-4 w-4 text-accent" />
            <div className="mt-3 text-[13.5px] font-medium">{f.t}</div>
            <div className="mt-1 text-[12.5px] leading-relaxed text-ink-3">{f.d}</div>
          </div>
        ))}
      </section>
    </div>
  );
}
