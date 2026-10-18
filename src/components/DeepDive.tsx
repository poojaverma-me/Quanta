"use client";

import { AlertTriangle, Brain, ChevronDown, Database, Flag, MessageSquareText, Play, RotateCcw, ShieldCheck, Shuffle, Sparkles, Square } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/client/api";
import { query } from "@/lib/client/duckdb";
import { DEMO_MODEL, packFor } from "@/lib/demo";
import { bestScenario, playScenario } from "@/lib/demo/player";
import type { DemoPack } from "@/lib/demo/types";
import { type AgentEvent, runAgent } from "@/lib/loops";
import { estimateCost } from "@/lib/pricing";
import type { LoadedDataset, QueryResult, Report, TokenUsage } from "@/lib/types";
import { ReportView } from "./ReportView";
import { Card, cx, DataTable, RichText, Spinner, SqlBlock } from "./ui";

type Item =
  | { id: string; at: number; kind: "thinking" | "note"; text: string }
  | { id: string; at: number; kind: "query"; purpose: string; sql: string; status: "running" | "done" | "error"; result?: QueryResult; error?: string }
  | { id: string; at: number; kind: "validating"; charts: number }
  | { id: string; at: number; kind: "fallback"; from: string; to: string }
  | { id: string; at: number; kind: "report" }
  | { id: string; at: number; kind: "error"; text: string };

const GENERIC = [
  "Identify the biggest operational bottlenecks and what is driving them",
  "Detect anomalies and recurring spikes, and explain their likely causes",
  "Compare the most recent month with the previous one: what changed and why?",
  "What are the main drivers of the primary metric, and which segments are outliers?",
];

export function DeepDive({ datasets, active, schema, addUsage, visible, seed }: { datasets: LoadedDataset[]; active: LoadedDataset; schema: string; addUsage: (u: TokenUsage) => void; visible: boolean; seed?: { text: string; nonce: number } }) {
  const [objective, setObjective] = useState("");
  const [running, setRunning] = useState(false);
  const [items, setItems] = useState<Item[]>([]);
  const [report, setReport] = useState<{ report: Report; chartData: (QueryResult | null)[]; objective: string; at: number } | null>(null);
  const [started, setStarted] = useState(0);
  const [now, setNow] = useState(0);
  const [spend, setSpend] = useState({ steps: 0, tokens: 0, cost: 0, cached: 0 });
  const abort = useRef<AbortController | null>(null);
  const logEnd = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [running]);

  useEffect(() => {
    if (visible) logEnd.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [items.length, visible]);

  // Sample datasets replay analyses pre-computed by Claude Opus 5.5 instead of calling the API.
  const packs = datasets.map(packFor).filter((p): p is DemoPack => p !== null);
  const activePack = packFor(active);
  const demo = packs.length > 0;

  const run = useCallback(
    async (goal: string) => {
      const typed = goal.trim();
      if (!typed || running) return;
      const match = demo ? bestScenario(typed, packs, activePack?.id) : null;
      const text = match ? match.scenario.objective : typed;
      setObjective(text);
      setItems([]);
      setReport(null);
      setSpend({ steps: 0, tokens: 0, cost: 0, cached: 0 });
      setRunning(true);
      const t0 = Date.now();
      setStarted(t0);
      setNow(t0);
      const ctrl = new AbortController();
      abort.current = ctrl;
      let n = 0;
      const push = (item: Item) => setItems((prev) => [...prev, item]);
      const onEvent = (e: AgentEvent) => {
        const at = Date.now();
        if (e.kind === "thinking" || e.kind === "note") push({ id: `e${n++}`, at, kind: e.kind, text: e.text });
        else if (e.kind === "query") push({ id: e.id, at, kind: "query", purpose: e.purpose, sql: e.sql, status: "running" });
        else if (e.kind === "query_done") setItems((prev) => prev.map((it) => (it.id === e.id && it.kind === "query" ? { ...it, status: e.error ? "error" : "done", result: e.result, error: e.error } : it)));
        else if (e.kind === "validating") push({ id: `e${n++}`, at, kind: "validating", charts: e.charts });
        else if (e.kind === "fallback") push({ id: `e${n++}`, at, kind: "fallback", from: e.from, to: e.to });
        else if (e.kind === "usage") {
          addUsage(e.usage);
          setSpend((s) => ({ steps: e.step, tokens: s.tokens + e.usage.inputTokens + e.usage.outputTokens, cost: s.cost + estimateCost(e.usage), cached: s.cached + (e.usage.cacheReadTokens ?? 0) }));
        } else if (e.kind === "report") {
          push({ id: `e${n++}`, at, kind: "report" });
          setReport({ report: e.report, chartData: e.chartData, objective: text, at });
        }
      };
      try {
        if (match) {
          const table = datasets.find((d) => d.demoPackId === match.pack.id)?.tableName ?? match.pack.profile.table_name;
          await playScenario({ scenario: match.scenario, table, runSql: (sql) => query(sql), onEvent, signal: ctrl.signal });
        } else {
          await runAgent({ objective: text, schema, step: (input) => api.agentStep(input, ctrl.signal), runSql: (sql) => query(sql), onEvent, signal: ctrl.signal });
        }
      } catch (e) {
        const aborted = ctrl.signal.aborted;
        push({ id: `err${Date.now()}`, at: Date.now(), kind: "error", text: aborted ? "Stopped." : e instanceof Error ? e.message : String(e) });
      } finally {
        setRunning(false);
        abort.current = null;
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- packs derive from datasets
    [running, schema, addUsage, demo, datasets, activePack?.id],
  );

  // Objectives clicked elsewhere (e.g. the overview) start a run directly.
  const lastSeed = useRef(0);
  useEffect(() => {
    if (seed && seed.nonce !== lastSeed.current) {
      lastSeed.current = seed.nonce;
      run(seed.text);
    }
  }, [seed, run]);

  const presets = activePack ? activePack.scenarios.map((sc) => sc.objective) : [...new Set([...active.profile.suggested_objectives, ...GENERIC])].slice(0, 6);
  const elapsed = Math.max(0, Math.round(((running ? now : (items.at(-1)?.at ?? now)) - started) / 1000));
  const queries = items.filter((i) => i.kind === "query").length;
  const hasRun = items.length > 0 || running;

  return (
    <div className="grid gap-5 lg:grid-cols-12">
      <Card
        className="lg:col-span-12"
        icon={<Sparkles className="h-4 w-4 text-accent" />}
        title="Autonomous deep dive"
        sub={`${demo ? DEMO_MODEL : "Claude Opus"} investigates ${datasets.length > 1 ? `${datasets.length} tables` : active.tableName} with iterative SQL`}
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            run(objective);
          }}
          className="flex flex-col gap-3 md:flex-row"
        >
          <textarea
            value={objective}
            onChange={(e) => setObjective(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                run(objective);
              }
            }}
            rows={2}
            placeholder="Give the agent a strategic objective, e.g. “Why are resolution times rising, and where?”"
            className="min-h-[56px] flex-1 resize-none rounded-2xl border border-line bg-surface-2 px-4 py-3 text-[14px] text-ink placeholder:text-ink-3 focus:border-accent/40 focus:outline-none"
            disabled={running}
          />
          {running ? (
            <button type="button" onClick={() => abort.current?.abort()} className="btn-ghost flex items-center justify-center gap-2 rounded-2xl px-5 py-3 text-[14px] font-medium">
              <Square className="h-4 w-4" /> Stop
            </button>
          ) : (
            <button type="submit" disabled={!objective.trim()} className="btn-accent flex items-center justify-center gap-2 rounded-2xl px-6 py-3 text-[14px]">
              {report ? <RotateCcw className="h-4 w-4" /> : <Play className="h-4 w-4" />} {report ? "Run again" : "Run analysis"}
            </button>
          )}
        </form>
        <div className="mt-3 flex flex-wrap gap-2">
          {presets.map((p) => (
            <button key={p} disabled={running} onClick={() => run(p)} className="chip rounded-full px-3 py-1.5 text-left text-[12.5px] disabled:opacity-50">
              {p}
            </button>
          ))}
        </div>
        <p className="mt-3 text-[12px] text-ink-3">
          {demo
            ? `${DEMO_MODEL} · every query runs on your in-browser DuckDB.`
            : "Typically 1–3 minutes and about $0.20–0.40 per run. SQL runs locally in your browser; only aggregated query results are sent to the model."}
        </p>
      </Card>

      {hasRun && (
        <>
          <Card
            className="self-start lg:sticky lg:top-[84px] lg:col-span-4"
            icon={<Brain className="h-4 w-4" />}
            title="Agent log"
            sub={running ? <span className="text-accent">live · {elapsed}s</span> : `${elapsed}s`}
            bodyClassName="!pb-3"
          >
            <div className="mb-3 grid grid-cols-3 gap-2 text-center">
              {[
                ["steps", demo ? items.filter((i) => i.kind === "thinking" || i.kind === "note" || i.kind === "query").length : spend.steps],
                ["queries", queries],
                demo ? ["time", `${elapsed}s`] : ["cost", `$${spend.cost.toFixed(2)}`],
              ].map(([k, v]) => (
                <div key={k} className="inset !rounded-xl px-2 py-2">
                  <div className="text-[15px] font-semibold tabular-nums">{v}</div>
                  <div className="text-[10.5px] uppercase tracking-wider text-ink-3">{k}</div>
                </div>
              ))}
            </div>
            <ol className="scroll-thin max-h-[calc(100dvh-300px)] space-y-2.5 overflow-y-auto pr-1">
              {items.map((it) => (
                <TimelineItem key={it.id} item={it} t0={started} />
              ))}
              {running && (
                <li className="timeline-item flex items-center gap-3">
                  <span className="pulse grid h-8 w-8 shrink-0 place-items-center rounded-full border border-accent/40 bg-accent/10">
                    <Spinner />
                  </span>
                  <span className="text-[12.5px] text-ink-3">Thinking…</span>
                </li>
              )}
              <div ref={logEnd} />
            </ol>
          </Card>

          <div className="lg:col-span-8">
            {report ? (
              <ReportView report={report.report} chartData={report.chartData} objective={report.objective} finishedAt={report.at} />
            ) : running ? (
              <div className="card p-6">
                <div className="flex items-center gap-3 text-[14px] text-ink-2">
                  <Spinner /> Investigating — the executive report appears here when the agent is done.
                </div>
                <div className="mt-6 grid grid-cols-4 gap-3">
                  {[0, 1, 2, 3].map((i) => (
                    <div key={i} className="skeleton h-24" style={{ animationDelay: `${i * 120}ms` }} />
                  ))}
                </div>
                <div className="mt-4 grid grid-cols-2 gap-3">
                  <div className="skeleton h-56" />
                  <div className="skeleton h-56" />
                </div>
              </div>
            ) : (
              <div className="card p-6 text-[13.5px] text-ink-2">No report was produced. Check the log, then try again or rephrase the objective.</div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function TimelineItem({ item, t0 }: { item: Item; t0: number }) {
  const [open, setOpen] = useState(false);
  const rel = `+${Math.max(0, Math.round((item.at - t0) / 1000))}s`;
  const icon = {
    thinking: <Brain className="h-3.5 w-3.5" />,
    note: <MessageSquareText className="h-3.5 w-3.5" />,
    query: item.kind === "query" && item.status === "running" ? <Spinner /> : <Database className="h-3.5 w-3.5" />,
    validating: <ShieldCheck className="h-3.5 w-3.5" />,
    fallback: <Shuffle className="h-3.5 w-3.5" />,
    report: <Flag className="h-3.5 w-3.5" />,
    error: <AlertTriangle className="h-3.5 w-3.5" />,
  }[item.kind];
  const ring =
    item.kind === "report"
      ? "border-transparent text-[#03120a]"
      : item.kind === "error" || (item.kind === "query" && item.status === "error")
        ? "border-red-400/40 bg-red-400/10 text-red-300"
        : item.kind === "query"
          ? "border-accent/30 bg-accent/10 text-accent"
          : "border-line bg-surface-3 text-ink-2";

  return (
    <li className="timeline-item fade-up flex gap-3">
      <span className={cx("relative z-10 grid h-8 w-8 shrink-0 place-items-center rounded-full border", ring)} style={item.kind === "report" ? { background: "var(--accent-grad)" } : undefined}>
        {icon}
      </span>
      <div className="min-w-0 flex-1 pb-1">
        <div className="flex items-baseline gap-2">
          <span className="truncate text-[13px] font-medium text-ink">
            {item.kind === "thinking" && "Reasoning"}
            {item.kind === "note" && "Analyst note"}
            {item.kind === "query" && (item.purpose || "Query")}
            {item.kind === "validating" && `Checking ${item.charts} chart quer${item.charts === 1 ? "y" : "ies"}`}
            {item.kind === "fallback" && "Switched model"}
            {item.kind === "report" && "Report delivered"}
            {item.kind === "error" && "Stopped"}
          </span>
          <span className="mono ml-auto shrink-0 text-[10.5px] text-ink-3">{rel}</span>
        </div>

        {(item.kind === "thinking" || item.kind === "note") && (
          <button onClick={() => setOpen(!open)} className="mt-1 block w-full text-left">
            <RichText text={item.text} className={cx("text-[12.5px] leading-relaxed text-ink-2", !open && "line-clamp-3")} />
          </button>
        )}
        {item.kind === "fallback" && (
          <p className="mt-1 text-[12px] text-ink-3">
            {item.from} declined; {item.to} continued.
          </p>
        )}
        {item.kind === "error" && <p className="mt-1 text-[12px] text-red-200/90">{item.text}</p>}
        {item.kind === "query" && (
          <div className="mt-1.5">
            <button onClick={() => setOpen(!open)} className="flex items-center gap-1.5 text-[11.5px] text-ink-3 hover:text-ink">
              <ChevronDown className={cx("h-3.5 w-3.5 transition", open && "rotate-180")} />
              {item.status === "running" && "running…"}
              {item.status === "done" && item.result && `${item.result.rowCount.toLocaleString()} row${item.result.rowCount === 1 ? "" : "s"} · ${Math.round(item.result.elapsedMs)} ms`}
              {item.status === "error" && <span className="text-red-300">error — agent will retry</span>}
            </button>
            {open && (
              <div className="mt-2 space-y-2">
                <SqlBlock sql={item.sql} />
                {item.error && <p className="rounded-xl bg-red-400/5 p-2 text-[11.5px] text-red-200">{item.error}</p>}
                {item.result && <DataTable result={item.result} maxRows={15} dense />}
              </div>
            )}
          </div>
        )}
      </div>
    </li>
  );
}
