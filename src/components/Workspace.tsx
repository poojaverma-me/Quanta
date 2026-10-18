"use client";

import { Activity, AudioLines, Database, LayoutGrid, Plus, Sparkles, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/client/api";
import { initDuckDB, query } from "@/lib/client/duckdb";
import { type IngestStage, ingestCsv } from "@/lib/client/ingest";
import { DEMO_BADGE, DEMO_MODEL } from "@/lib/demo";
import { estimateCost } from "@/lib/pricing";
import { describeDatasetsForPrompt, quoteIdent } from "@/lib/sql";
import type { LoadedDataset, TokenUsage } from "@/lib/types";
import { AskPanel } from "./AskPanel";
import { DataPanel } from "./DataPanel";
import { DeepDive } from "./DeepDive";
import { Landing } from "./Landing";
import { Overview } from "./Overview";
import { cx, Segmented, Spinner } from "./ui";

export type Tab = "overview" | "deepdive" | "ask" | "data";
export type EngineState = "loading" | "ready" | "error";

export interface IngestStatus {
  fileName: string;
  stage: IngestStage;
  note?: string;
  /** Model doing the profiling, shown while that stage runs. */
  model?: string;
}

const STAGE_LABEL: Record<IngestStage, string> = {
  reading: "Reading file into DuckDB",
  profiling: "Profiling the schema",
  building: "Building typed SQL table",
  analyzing: "Computing column statistics",
  done: "Ready",
};

export const stageText = (s: IngestStatus) => (s.stage === "profiling" && s.model ? `${s.model} is profiling the schema` : STAGE_LABEL[s.stage]);

export function Workspace() {
  const [engine, setEngine] = useState<EngineState>("loading");
  const [health, setHealth] = useState<{ anthropic: boolean; gemini: boolean } | null>(null);
  const [datasets, setDatasets] = useState<LoadedDataset[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("overview");
  const [ingest, setIngest] = useState<IngestStatus | null>(null);
  const [toast, setToast] = useState<{ tone: "warn" | "error"; text: string } | null>(null);
  const [usage, setUsage] = useState<{ tokens: number; cost: number }>({ tokens: 0, cost: 0 });
  const [dragging, setDragging] = useState(false);
  const [deepSeed, setDeepSeed] = useState<{ text: string; nonce: number }>();
  const [askSeed, setAskSeed] = useState<{ text: string; nonce: number }>();
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    initDuckDB()
      .then(() => setEngine("ready"))
      .catch((e) => {
        setEngine("error");
        setToast({ tone: "error", text: `DuckDB failed to start: ${e instanceof Error ? e.message : e}` });
      });
    api.health().then(setHealth).catch(() => setHealth({ anthropic: false, gemini: false }));
  }, []);

  const addUsage = useCallback((u: TokenUsage) => {
    setUsage((prev) => ({ tokens: prev.tokens + u.inputTokens + u.outputTokens + (u.cacheReadTokens ?? 0), cost: prev.cost + estimateCost(u) }));
  }, []);

  const active = datasets.find((d) => d.id === activeId) ?? datasets[0] ?? null;
  const schema = useMemo(() => describeDatasetsForPrompt(datasets), [datasets]);

  const load = useCallback(
    async (fileName: string, bytes: Uint8Array) => {
      if (ingest) return;
      setToast(null);
      setIngest({ fileName, stage: "reading" });
      try {
        await initDuckDB();
        const { dataset, warning } = await ingestCsv(
          fileName,
          bytes,
          datasets.map((d) => d.tableName),
          (stage, note, model) => setIngest((prev) => ({ fileName, stage, note: note ?? prev?.note, model: model ?? prev?.model })),
        );
        if (dataset.usage) addUsage(dataset.usage);
        setDatasets((prev) => [...prev, dataset]);
        setActiveId(dataset.id);
        setTab("overview");
        if (warning) setToast({ tone: "warn", text: warning });
      } catch (e) {
        setToast({ tone: "error", text: e instanceof Error ? e.message : String(e) });
      } finally {
        setIngest(null);
      }
    },
    [datasets, ingest, addUsage],
  );

  const loadFile = useCallback(
    async (file: File) => {
      if (!/\.(csv|tsv|txt)$/i.test(file.name)) {
        setToast({ tone: "error", text: "Please choose a .csv (or .tsv) file." });
        return;
      }
      if (file.size > 300 * 1024 * 1024) {
        setToast({ tone: "error", text: "That file is over 300 MB — too large for in-browser analysis." });
        return;
      }
      await load(file.name, new Uint8Array(await file.arrayBuffer()));
    },
    [load],
  );

  const loadSample = useCallback(
    async (file: string) => {
      const res = await fetch(`/samples/${file}`);
      if (!res.ok) {
        setToast({ tone: "error", text: `Couldn't fetch sample ${file}. Run "npm run generate-data" first.` });
        return;
      }
      await load(file, new Uint8Array(await res.arrayBuffer()));
    },
    [load],
  );

  const removeDataset = useCallback(
    async (d: LoadedDataset) => {
      await query(`DROP TABLE IF EXISTS ${quoteIdent(d.tableName)}`).catch(() => {});
      setDatasets((prev) => prev.filter((x) => x.id !== d.id));
      if (activeId === d.id) setActiveId(null);
    },
    [activeId],
  );

  // Drop a CSV anywhere on the page.
  useEffect(() => {
    let depth = 0;
    const enter = (e: DragEvent) => {
      if (!e.dataTransfer?.types.includes("Files")) return;
      depth++;
      setDragging(true);
    };
    const leave = () => {
      depth = Math.max(0, depth - 1);
      if (!depth) setDragging(false);
    };
    const over = (e: DragEvent) => e.preventDefault();
    const drop = (e: DragEvent) => {
      e.preventDefault();
      depth = 0;
      setDragging(false);
      const f = e.dataTransfer?.files?.[0];
      if (f) loadFile(f);
    };
    window.addEventListener("dragenter", enter);
    window.addEventListener("dragleave", leave);
    window.addEventListener("dragover", over);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("dragover", over);
      window.removeEventListener("drop", drop);
    };
  }, [loadFile]);

  const tsStats = active?.stats.find((s) => s.name === active.profile.primary_timestamp);

  return (
    <div className="relative z-10 mx-auto flex min-h-dvh w-full max-w-[1440px] flex-col px-4 pb-10 sm:px-6 lg:px-8">
      <input ref={fileInput} type="file" accept=".csv,.tsv,.txt,text/csv" className="hidden" onChange={(e) => e.target.files?.[0] && loadFile(e.target.files[0])} />

      {/* top bar */}
      <header className="no-print sticky top-0 z-40 -mx-4 flex items-center gap-3 px-4 py-4 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
        <div className="pointer-events-none absolute inset-0 -z-10 bg-gradient-to-b from-bg via-bg/85 to-transparent" />
        <div className="flex min-w-0 items-center gap-2.5 md:flex-1">
          <Logo />
          <span className={cx("text-[17px] font-semibold tracking-tight", datasets.length > 0 && "hidden md:inline")}>Quanta</span>
          <span className="hidden text-[13px] text-ink-3 lg:inline">AI Data Analyst</span>
        </div>
        {datasets.length > 0 && (
          <Segmented<Tab>
            value={tab}
            onChange={setTab}
            items={[
              { value: "overview", label: "Overview", icon: <LayoutGrid className="h-4 w-4" /> },
              { value: "deepdive", label: "Deep Dive", icon: <Sparkles className="h-4 w-4" /> },
              { value: "ask", label: "Ask", icon: <AudioLines className="h-4 w-4" /> },
              { value: "data", label: "Data", icon: <Database className="h-4 w-4" /> },
            ]}
          />
        )}
        <div className={cx("flex flex-1 items-center justify-end gap-3", datasets.length > 0 && "hidden md:flex")}>
          {usage.tokens > 0 && (
            <span className="hidden items-center gap-1.5 whitespace-nowrap text-[12px] text-ink-3 xl:flex" title="Estimated AI spend this session">
              <Activity className="h-3.5 w-3.5" />
              {(usage.tokens / 1000).toFixed(1)}k tok · ${usage.cost.toFixed(3)}
            </span>
          )}
          {DEMO_BADGE && datasets.some((d) => d.demoPackId) && (
            <span
              className="rounded-full border border-[#7b5cff]/40 bg-[#7b5cff]/10 px-2.5 py-1 text-[11.5px] font-medium text-[#b9a8ff]"
              title={`Sample datasets come with analyses pre-computed by ${DEMO_MODEL}; they replay locally and queries still run on your in-browser DuckDB. Other CSVs are analyzed live.`}
            >
              Demo
            </span>
          )}
          <ProviderDot label="Claude" ok={health?.anthropic} />
          <ProviderDot label="Gemini" ok={health?.gemini} />
        </div>
      </header>

      {/* dataset bar */}
      {active && (
        <div className="card no-print mb-5 flex flex-wrap items-center gap-x-4 gap-y-3 !rounded-[26px] px-3 py-2.5 sm:px-4">
          <div className="flex min-w-0 items-center gap-3">
            <span className="grid h-9 w-9 place-items-center rounded-full" style={{ background: "var(--accent-grad)" }}>
              <Database className="h-4 w-4 text-[#03120a]" />
            </span>
            <span className="truncate text-[15px] font-medium">{active.profile.title}</span>
            <span className="hidden h-4 w-px bg-white/15 sm:block" />
            <span className="hidden text-[13px] text-ink-3 sm:block">{active.profile.domain}</span>
          </div>
          <div className="hidden items-center gap-4 text-[13px] text-ink-2 md:flex">
            <span>
              <span className="text-ink tabular-nums">{active.rowCount.toLocaleString()}</span> rows
            </span>
            <span>
              <span className="text-ink tabular-nums">{active.profile.columns.length}</span> columns
            </span>
            {tsStats?.min && (
              <span className="tabular-nums">
                {String(tsStats.min).slice(0, 10)} → {String(tsStats.max).slice(0, 10)}
              </span>
            )}
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-1.5">
            {datasets.map((d) => (
              <span key={d.id} className={cx("group flex items-center rounded-full border text-[12px] transition", d.id === active.id ? "border-accent/40 bg-accent/10 text-accent" : "border-line bg-surface-2 text-ink-2 hover:text-ink")}>
                <button className="mono py-1.5 pl-3 pr-1.5" onClick={() => setActiveId(d.id)} title={`${d.fileName} → table ${d.tableName}`}>
                  {d.tableName}
                </button>
                <button className="mr-1.5 rounded-full p-0.5 opacity-50 hover:bg-white/10 hover:opacity-100" onClick={() => removeDataset(d)} aria-label={`Remove ${d.tableName}`}>
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
            <button onClick={() => fileInput.current?.click()} disabled={!!ingest} className="btn-ghost flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px]">
              <Plus className="h-3.5 w-3.5" /> Add CSV
            </button>
          </div>
        </div>
      )}

      {toast && (
        <div role="status" className={cx("fade-up mb-5 flex items-start gap-3 rounded-2xl border px-4 py-3 text-[13px]", toast.tone === "error" ? "border-red-400/25 bg-red-400/[0.07] text-red-100" : "border-yellow-400/25 bg-yellow-400/[0.06] text-yellow-100")}>
          <span className="flex-1">{toast.text}</span>
          <button onClick={() => setToast(null)} aria-label="Dismiss">
            <X className="h-4 w-4 opacity-60 hover:opacity-100" />
          </button>
        </div>
      )}

      {ingest && datasets.length > 0 && <IngestBanner status={ingest} />}

      <main className="flex-1">
        {!active ? (
          <Landing engine={engine} ingest={ingest} stageLabel={stageText} onPick={() => fileInput.current?.click()} onSample={loadSample} health={health} />
        ) : (
          <>
            <div hidden={tab !== "overview"}>
              <Overview
                key={active.id}
                dataset={active}
                onAsk={(q) => {
                  setTab("ask");
                  if (q) setAskSeed({ text: q, nonce: Date.now() });
                }}
                onDeepDive={(o) => {
                  setTab("deepdive");
                  if (o) setDeepSeed({ text: o, nonce: Date.now() });
                }}
              />
            </div>
            <div hidden={tab !== "deepdive"}>
              <DeepDive datasets={datasets} active={active} schema={schema} addUsage={addUsage} visible={tab === "deepdive"} seed={deepSeed} />
            </div>
            <div hidden={tab !== "ask"}>
              <AskPanel datasets={datasets} active={active} schema={schema} addUsage={addUsage} visible={tab === "ask"} seed={askSeed} />
            </div>
            <div hidden={tab !== "data"}>
              <DataPanel key={active.id} dataset={active} />
            </div>
          </>
        )}
      </main>

      {dragging && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 backdrop-blur-sm">
          <div className="rounded-[32px] border-2 border-dashed border-accent/60 bg-surface/80 px-16 py-14 text-center">
            <div className="text-xl font-medium">Drop your CSV</div>
            <div className="mt-1 text-sm text-ink-2">It stays in your browser — loaded into a local DuckDB</div>
          </div>
        </div>
      )}
    </div>
  );
}

function IngestBanner({ status }: { status: IngestStatus }) {
  return (
    <div className="card fade-up mb-5 flex items-center gap-3 px-5 py-3.5 text-[13px]">
      <Spinner />
      <span className="font-medium">{status.fileName}</span>
      <span className="text-ink-3">{stageText(status)}</span>
      {status.note && <span className="ml-auto text-ink-3">{status.note}</span>}
    </div>
  );
}

function ProviderDot({ label, ok }: { label: string; ok?: boolean }) {
  return (
    <span className="flex items-center gap-1.5 rounded-full border border-line bg-surface-2 px-2.5 py-1 text-[11.5px] text-ink-2" title={ok === undefined ? "Checking…" : ok ? `${label} API key configured` : `${label} API key missing`}>
      <span className={cx("h-1.5 w-1.5 rounded-full", ok === undefined ? "bg-ink-3" : ok ? "bg-green-400 shadow-[0_0_8px_rgba(74,222,128,0.8)]" : "bg-red-400")} />
      {label}
      <span className="sr-only">{ok ? "connected" : "not configured"}</span>
    </span>
  );
}

export function Logo({ size = 30 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
      <defs>
        <linearGradient id="qlg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#b6ff8f" />
          <stop offset="0.5" stopColor="#22d3ee" />
          <stop offset="1" stopColor="#8b5cf6" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="10" fill="#000" stroke="rgba(255,255,255,0.14)" />
      <rect x="7" y="16" width="4" height="9" rx="2" fill="url(#qlg)" opacity="0.55" />
      <rect x="14" y="10" width="4" height="15" rx="2" fill="url(#qlg)" opacity="0.8" />
      <rect x="21" y="6" width="4" height="19" rx="2" fill="url(#qlg)" />
    </svg>
  );
}
