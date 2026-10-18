/**
 * Demo playback. Pre-computed analyses replay as the same events a live run
 * emits, with natural pacing. Every query still executes against the user's
 * in-browser DuckDB, so tables and charts show real results.
 */
import type { AgentEvent, ChatQuery, ChatTurnResult, SqlExecutor } from "../loops";
import { safeQuery } from "../loops";
import { quoteIdent } from "../sql";
import type { QueryResult, Report } from "../types";
import type { DemoPack, DemoQA, DemoScenario } from "./types";

/** Model credited for pre-computed content (it wrote it). */
export const DEMO_MODEL = "Claude Opus 5.5";

const SPEED = Math.max(0.2, Number(process.env.NEXT_PUBLIC_DEMO_SPEED ?? 1) || 1);

export const withTable = (sql: string, table: string) => sql.replaceAll("{t}", quoteIdent(table));

function sleep(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const id = setTimeout(resolve, ms / SPEED);
    signal?.addEventListener("abort", () => {
      clearTimeout(id);
      reject(new DOMException("Analysis stopped", "AbortError"));
    });
  });
}

/** Reading/writing time that grows with the text, with a little jitter. */
const pace = (text: string, base = 700) => Math.min(2800, base + text.length * 9 + Math.random() * 400);

// ---------- matching free text to prepared content ----------

const STOP = new Set(
  "the a an and or of to in for with is are was were be been on at by from this that these those what which who whom how why when where do does did our we us my me i you it its as any all more much many per vs versus about into over than then there their them they can could would should show tell give find list get got came come have has had ticket tickets order orders customer customers account accounts client clients record records data number count big right now currently current stuff thing things people really just kind send".split(" "),
);

/** Map everyday wording onto the vocabulary of the prepared questions. */
const SYNONYMS: [RegExp, string][] = [
  [/^(team|teams|group|groups|squad|queue|queues|departments?)$/, "department"],
  [/^(resolv|resolution|resolve|fix|close|closing|closed|solv|handl|turnaround)/, "resol"],
  [/^(slow|longest|longer|lagg|bottleneck)/, "slow"],
  [/^(fast|quick)/, "fast"],
  [/^(happ|satisf|csat|rating|rated)/, "satisf"],
  [/^(biggest|largest|most|top|highest|max|busiest)$/, "most"],
  [/^(lowest|least|worst|min|minimum|fewest)$/, "least"],
  [/^(revenue|mrr|money|dollar|income|arr)/, "revenue"],
  [/^(leav|left|cancel|churn|quit|lost)/, "churn"],
  [/^(return|refund)/, "return"],
  [/^(late|overdue|tardy)/, "late"],
  [/^(shipper|carrier|courier)/, "carrier"],
  [/^(warehouse|site|facilit|fulfil)/, "warehouse"],
  [/^(yesterday|today|latest)$/, "yesterday"],
  [/^(rival|competit)/, "competitor"],
  [/^(region|geograph|area|emea|country)/, "region"],
  [/^(percent|share|proportion|rate|often|frequen)/, "rate"],
  [/^(risk|danger|might|likely|soon|warning)/, "risk"],
  [/^(back)$/, "return"],
  [/^(responsib|cause|causing|blame|driv)/, "cause"],
];

function tokens(s: string) {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => (w.length > 2 || /^\d+$/.test(w)) && !STOP.has(w))
    .map((w) => SYNONYMS.find(([re]) => re.test(w))?.[1] ?? (w.length > 5 ? w.slice(0, 5) : w));
}

/** 0..1: keyword hits plus how much of the query's vocabulary the target covers. */
export function matchScore(query: string, target: string, keywords: string[]) {
  const q = query.toLowerCase().trim();
  if (!q) return 0;
  if (q === target.toLowerCase().trim()) return 1;
  const qt = new Set(tokens(q));
  const tt = new Set([...tokens(target), ...keywords.flatMap(tokens)]);
  const overlap = qt.size ? [...qt].filter((w) => tt.has(w)).length / qt.size : 0;
  const hits = keywords.filter((k) => q.includes(k.toLowerCase())).length;
  return Math.min(1, overlap * 0.7 + Math.min(hits, 3) * 0.12);
}

export function bestScenario(objective: string, packs: DemoPack[], preferPackId?: string) {
  let best: { pack: DemoPack; scenario: DemoScenario; score: number } | null = null;
  for (const pack of packs) {
    for (const scenario of pack.scenarios) {
      const score = matchScore(objective, scenario.objective, scenario.keywords) + (pack.id === preferPackId ? 0.05 : 0);
      if (!best || score > best.score) best = { pack, scenario, score };
    }
  }
  // Fall back to the active dataset's first analysis rather than nothing.
  if (best && best.score < 0.15) {
    const pack = packs.find((p) => p.id === preferPackId) ?? packs[0];
    return { pack, scenario: pack.scenarios[0], score: best.score };
  }
  return best;
}

export function bestAnswer(question: string, packs: DemoPack[], preferPackId?: string) {
  let best: { pack: DemoPack; qa: DemoQA; score: number } | null = null;
  for (const pack of packs) {
    for (const qa of pack.qa) {
      const score = matchScore(question, qa.question, qa.keywords) + (pack.id === preferPackId ? 0.03 : 0);
      if (!best || score > best.score) best = { pack, qa, score };
    }
  }
  return best && best.score >= 0.4 ? best : null;
}

// ---------- playback ----------

export async function playScenario(opts: {
  scenario: DemoScenario;
  table: string;
  runSql: SqlExecutor;
  onEvent: (e: AgentEvent) => void;
  signal?: AbortSignal;
}): Promise<Report> {
  const { scenario, table, runSql, onEvent, signal } = opts;
  await sleep(900, signal);
  let n = 0;
  for (const step of scenario.steps) {
    if (step.kind === "query") {
      await sleep(650 + Math.random() * 500, signal);
      const id = `demo-${scenario.id}-${n++}`;
      const sql = withTable(step.sql, table);
      onEvent({ kind: "query", id, purpose: step.purpose, sql });
      const q = await safeQuery(runSql, sql);
      await sleep(550 + Math.random() * 600, signal);
      onEvent({ kind: "query_done", id, result: q.result, error: q.error });
    } else {
      await sleep(pace(step.text, step.kind === "thinking" ? 900 : 600), signal);
      onEvent({ kind: step.kind, text: step.text });
    }
  }
  const report: Report = { ...scenario.report, charts: scenario.report.charts.map((c) => ({ ...c, sql: withTable(c.sql, table) })) };
  await sleep(900, signal);
  onEvent({ kind: "validating", charts: report.charts.length });
  const chartData: (QueryResult | null)[] = [];
  for (const c of report.charts) chartData.push((await safeQuery(runSql, c.sql)).result ?? null);
  await sleep(1400, signal);
  onEvent({ kind: "report", report, chartData });
  return report;
}

export async function playAnswer(opts: { qa: DemoQA; table: string; runSql: SqlExecutor; onQuery?: (q: ChatQuery) => void }): Promise<ChatTurnResult> {
  const { qa, table, runSql, onQuery } = opts;
  await sleep(700 + Math.random() * 400);
  const q = await safeQuery(runSql, withTable(qa.sql, table));
  const entry: ChatQuery = { sql: q.sql, explanation: qa.explanation, result: q.result, error: q.error };
  onQuery?.(entry);
  await sleep(650 + Math.random() * 350);
  return { answer: qa.answer, queries: [entry], history: [], usage: [] };
}
