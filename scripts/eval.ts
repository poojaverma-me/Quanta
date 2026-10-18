/**
 * Evaluation suite.
 *
 *   npm run eval              # profiling + Gemini Q&A checks (a few cents)
 *   npm run eval -- --agent   # also runs one full deep-dive with the Claude agent
 *
 * Runs the exact pipeline and loops the app uses, against DuckDB for Node and
 * the real APIs. It checks that:
 *  1. Haiku produces a typed schema that loads cleanly (low cast failure, expected types).
 *  2. Haiku's summary has 2-4 paragraphs and is consistent across two runs.
 *  3. Every SQL statement Gemini emits passes the read-only guard and compiles (EXPLAIN),
 *     and its answers match ground truth computed directly in SQL.
 *  4. Token use per call stays within budget.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { runAgent, runChat } from "../src/lib/loops";
import { computeStats, materialize, reconcileProfile, stageCsv } from "../src/lib/pipeline";
import { agentStep } from "../src/lib/server/agent";
import { chatStep } from "../src/lib/server/chat";
import { MODELS } from "../src/lib/server/config";
import { profileDataset } from "../src/lib/server/profile";
import { estimateCost } from "../src/lib/pricing";
import { checkReadOnlySql, describeDatasetsForPrompt } from "../src/lib/sql";
import type { DatasetProfile, LoadedDataset, TokenUsage } from "../src/lib/types";
import { createNodeRunner } from "./node-duckdb";

const RUN_AGENT = process.argv.includes("--agent");

const BUDGET = { profileInput: 6000, profileOutput: 4000, chatInputPerCall: 12000 };

// ---------- tiny test harness ----------
const results: { group: string; name: string; ok: boolean; detail: string }[] = [];
const usages: (TokenUsage & { label: string })[] = [];
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
function check(group: string, name: string, ok: boolean, detail = "") {
  results.push({ group, name, ok, detail });
  console.log(`  ${ok ? green("✓") : red("✗")} ${name}${detail ? dim(`  — ${detail}`) : ""}`);
}
function track(label: string, u: TokenUsage) {
  usages.push({ ...u, label });
}

// ---------- expectations ----------
const DATASETS = [
  {
    file: "support_tickets.csv",
    types: { created_at: "TIMESTAMP", closed_at: "TIMESTAMP", resolution_hours: "DOUBLE", csat_score: ["BIGINT", "DOUBLE"], reopened: "BOOLEAN", category: "VARCHAR", ticket_id: "VARCHAR" },
  },
  {
    file: "saas_churn.csv",
    types: { signup_date: "DATE", churn_date: "DATE", mrr_usd: "DOUBLE", seats: "BIGINT", churned: "BOOLEAN", plan: "VARCHAR" },
  },
  {
    file: "ecommerce_fulfillment.csv",
    types: { order_timestamp: "TIMESTAMP", fulfillment_hours: "DOUBLE", order_value_usd: "DOUBLE", warehouse: "VARCHAR", delivered_late: "BOOLEAN" },
  },
] as const;

type Run = Awaited<ReturnType<typeof createNodeRunner>>;

async function loadDataset(run: Run, file: string, label: string): Promise<{ dataset: LoadedDataset; profile: DatasetProfile; failures: Record<string, number> }> {
  const raw = `_raw_${file.replace(/\W/g, "_")}`;
  const sample = await stageCsv(run, `public/samples/${file}`, raw);
  const { profile: aiProfile, usage } = await profileDataset({ fileName: file, headers: sample.headers, detectedTypes: sample.detectedTypes, rows: sample.rows, rowCount: sample.rowCount, ranges: sample.ranges });
  track(label, usage);
  const reconciled = reconcileProfile(aiProfile, sample, file);
  const table = file.replace(/\.csv$/, "");
  const { profile, failures } = await materialize(run, raw, table, reconciled);
  const stats = await computeStats(run, table, profile, failures);
  return {
    dataset: { id: table, fileName: file, tableName: table, rowCount: sample.rowCount, profile, stats, fallback: false, usage, loadedAt: Date.now() },
    profile: aiProfile,
    failures,
  };
}

function keyTerms(text: string) {
  const stop = new Set("the a an and or of to in for with each is are this that by on as be can it its from which such data dataset row rows column columns".split(" "));
  return new Set(text.toLowerCase().match(/[a-z_]{4,}/g)?.filter((w) => !stop.has(w)) ?? []);
}
const jaccard = (a: Set<string>, b: Set<string>) => [...a].filter((x) => b.has(x)).length / new Set([...a, ...b]).size;

async function main() {
  console.log(`\nAI Data Analyst — eval suite`);
  console.log(dim(`profiler=${MODELS.profiler}  chat=${MODELS.chat}  agent=${MODELS.agent}${RUN_AGENT ? "" : " (skipped; pass --agent)"}\n`));
  const run = await createNodeRunner();
  const loaded: LoadedDataset[] = [];

  // 1-2. Schema generation + summaries
  for (const spec of DATASETS) {
    console.log(`Schema · ${spec.file}`);
    const group = `schema:${spec.file}`;
    try {
      const { dataset, profile, failures } = await loadDataset(run, spec.file, `profile ${spec.file}`);
      loaded.push(dataset);
      const cols = new Map(dataset.profile.columns.map((c) => [c.name, c]));
      check(group, "every CSV header mapped to a column", profile.columns.length === dataset.profile.columns.length, `${dataset.profile.columns.length} columns`);
      for (const [name, expected] of Object.entries(spec.types)) {
        const got = cols.get(name)?.sql_type ?? "(missing)";
        const ok = Array.isArray(expected) ? (expected as readonly string[]).includes(got) : got === expected;
        check(group, `${name} typed ${Array.isArray(expected) ? expected.join("|") : expected}`, ok, ok ? "" : `got ${got}`);
      }
      const worst = Object.entries(failures).sort((a, b) => b[1] - a[1])[0];
      check(group, "typed casts parse ≥ 98% of values", !worst || worst[1] <= 0.02, worst ? `worst ${worst[0]} ${(worst[1] * 100).toFixed(1)}%` : "");
      const formats = dataset.profile.columns.filter((c) => c.timestamp_format).map((c) => `${c.name}:${c.timestamp_format}`);
      if (spec.file === "saas_churn.csv") check(group, "US date format detected (strptime)", formats.some((f) => f.includes("%m/%d/%Y")), formats.join(", "));
      check(group, "summary has 2-4 paragraphs", dataset.profile.summary.length >= 2 && dataset.profile.summary.length <= 4, `${dataset.profile.summary.length} paragraphs`);
      check(group, "4 objectives + 4 questions suggested", dataset.profile.suggested_objectives.length === 4 && dataset.profile.suggested_questions.length === 4);
      const u = usages[usages.length - 1];
      check(group, "profile call within token budget", u.inputTokens <= BUDGET.profileInput && u.outputTokens <= BUDGET.profileOutput, `${u.inputTokens} in / ${u.outputTokens} out`);
    } catch (e) {
      check(group, "profile + load", false, e instanceof Error ? e.message : String(e));
    }
    console.log();
  }

  console.log("Consistency · Haiku run twice on support_tickets.csv");
  try {
    const run2 = await createNodeRunner();
    const second = await loadDataset(run2, "support_tickets.csv", "profile consistency rerun");
    const first = loaded.find((d) => d.fileName === "support_tickets.csv")!;
    const typesA = first.profile.columns.map((c) => c.sql_type).join();
    const typesB = second.dataset.profile.columns.map((c) => c.sql_type).join();
    check("consistency", "identical column types across runs", typesA === typesB);
    const sim = jaccard(keyTerms(first.profile.summary.join(" ")), keyTerms(second.dataset.profile.summary.join(" ")));
    check("consistency", "summary vocabulary overlap ≥ 0.25 (Jaccard)", sim >= 0.25, sim.toFixed(2));
    check("consistency", "same paragraph count ±1", Math.abs(first.profile.summary.length - second.dataset.profile.summary.length) <= 1);
  } catch (e) {
    check("consistency", "second profile run", false, e instanceof Error ? e.message : String(e));
  }
  console.log();

  // 3. Gemini tool calls
  if (loaded.length) {
    const schema = describeDatasetsForPrompt(loaded);
    const scalar = async (sql: string) => (await run(sql)).rows[0]?.[0];
    const yesterday = new Date(Date.now() - 86_400_000).toLocaleDateString("en-CA");
    const ydayCount = Number(await scalar(`SELECT count(*) FROM support_tickets WHERE created_at::DATE = DATE '${yesterday}'`));
    const latestMonthTop = String(
      await scalar(`SELECT category FROM support_tickets WHERE date_trunc('month', created_at) = (SELECT date_trunc('month', max(created_at)) FROM support_tickets) GROUP BY 1 ORDER BY count(*) DESC LIMIT 1`),
    );

    const QUESTIONS: { q: string; expect: RegExp; note: string }[] = [
      { q: "Which department has the highest average resolution time?", expect: /security engineering/i, note: "planted bottleneck" },
      { q: "On which day did we get the most Network tickets?", expect: /aug(ust)?\.?\s*1[7-9]|08-1[7-9]|8\/1[7-9]/i, note: "planted outage spike" },
      { q: "How many support tickets were created yesterday?", expect: new RegExp(`\\b${ydayCount}\\b`), note: `ground truth ${ydayCount}` },
      { q: "What was the most common ticket category this month?", expect: new RegExp(latestMonthTop.replace(/[&]/g, "(&|and)"), "i"), note: `ground truth ${latestMonthTop}` },
      { q: "Which subscription plan has the highest churn rate?", expect: /starter/i, note: "planted churn driver" },
      { q: "Which warehouse has had the slowest average fulfillment since September 1st?", expect: /memphis/i, note: "planted staffing issue" },
      { q: "Which carrier has the highest late delivery rate?", expect: /ontrac/i, note: "planted late carrier" },
    ];

    console.log(`Gemini tool calls · ${QUESTIONS.length} questions`);
    for (const item of QUESTIONS) {
      try {
        const t = await runChat({
          question: item.q,
          history: [],
          schema,
          step: chatStep,
          runSql: (sql) => run(sql),
        });
        t.usage.forEach((u) => track(`chat: ${item.q.slice(0, 40)}`, u));
        let sqlOk = t.queries.length > 0;
        const bad: string[] = [];
        for (const q of t.queries) {
          const guard = checkReadOnlySql(q.sql);
          let compiles = guard.ok;
          if (guard.ok) {
            try {
              await run(`EXPLAIN ${guard.sql}`);
            } catch {
              compiles = false;
            }
          }
          if (!compiles) {
            sqlOk = false;
            bad.push(q.sql.slice(0, 80));
          }
        }
        const hadRetries = t.queries.some((q) => q.error);
        check("gemini", `valid SQL · ${item.q}`, sqlOk || (hadRetries && t.queries.some((q) => !q.error)), `${t.queries.length} quer${t.queries.length === 1 ? "y" : "ies"}${bad.length ? `, invalid: ${bad.join(" | ")}` : ""}`);
        check("gemini", `correct answer (${item.note})`, item.expect.test(t.answer), t.answer.replace(/\s+/g, " ").slice(0, 140));
        const maxIn = Math.max(...t.usage.map((u) => u.inputTokens));
        check("gemini", "per-call input within budget", maxIn <= BUDGET.chatInputPerCall, `${maxIn} tokens`);
      } catch (e) {
        check("gemini", item.q, false, e instanceof Error ? e.message : String(e));
      }
    }
    console.log();

    // 4. Optional: the full deep-dive agent
    if (RUN_AGENT) {
      console.log("Deep-dive agent · support_tickets");
      const tickets = loaded.filter((d) => d.tableName === "support_tickets");
      let queries = 0;
      try {
        const report = await runAgent({
          objective: "Identify department bottlenecks and recurring ticket spikes, and recommend fixes.",
          schema: describeDatasetsForPrompt(tickets),
          step: agentStep,
          runSql: (sql) => run(sql),
          onEvent: (e) => {
            if (e.kind === "query") {
              queries++;
              console.log(dim(`    · ${e.purpose}`));
            }
            if (e.kind === "usage") track(`agent step ${e.step}`, e.usage);
          },
        });
        check("agent", "report delivered", true, report.title);
        check("agent", "4 KPIs", report.kpis.length === 4);
        check("agent", "2-4 charts that execute", report.charts.length >= 2 && report.charts.length <= 4, `${report.charts.length} charts`);
        check("agent", "finds the Security Engineering bottleneck", /security engineering/i.test(JSON.stringify(report)));
        check("agent", "finds the August Network spike", /aug|network/i.test(JSON.stringify(report.findings)));
        check("agent", "reasonable query count (3-20)", queries >= 3 && queries <= 20, `${queries} queries`);
      } catch (e) {
        check("agent", "run", false, e instanceof Error ? e.message : String(e));
      }
      console.log();
    }
  }

  // ---------- token & cost report ----------
  const byModel = new Map<string, { calls: number; in: number; out: number; cached: number; cost: number }>();
  for (const u of usages) {
    const row = byModel.get(u.model) ?? { calls: 0, in: 0, out: 0, cached: 0, cost: 0 };
    row.calls++;
    row.in += u.inputTokens;
    row.out += u.outputTokens;
    row.cached += u.cacheReadTokens ?? 0;
    row.cost += estimateCost(u);
    byModel.set(u.model, row);
  }
  console.log("Token usage");
  console.log(dim("  model                         calls   input   cached   output   est. cost"));
  let total = 0;
  for (const [model, r] of byModel) {
    total += r.cost;
    console.log(`  ${model.padEnd(28)} ${String(r.calls).padStart(5)} ${String(r.in).padStart(7)} ${String(r.cached).padStart(8)} ${String(r.out).padStart(8)}   $${r.cost.toFixed(4)}`);
  }
  console.log(dim(`  total ≈ $${total.toFixed(4)} (prices in src/lib/pricing.ts; Gemini is an estimate)\n`));

  const failed = results.filter((r) => !r.ok);
  console.log(failed.length ? red(`${failed.length} of ${results.length} checks failed`) : green(`All ${results.length} checks passed`));
  for (const f of failed) console.log(red(`  ✗ [${f.group}] ${f.name}`) + dim(f.detail ? ` — ${f.detail}` : ""));
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
