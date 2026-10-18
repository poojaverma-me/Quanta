/**
 * Verifies the pre-computed demo packs against the real sample data.
 *
 *   npm run verify-demo
 *
 * For each pack it loads the CSV through the app's own ingestion pipeline
 * using the pack's profile, then checks that:
 *  - every typed column parses cleanly;
 *  - every timeline query, chart query and Q&A query runs;
 *  - every chart query returns the columns its spec names;
 *  - every number quoted in the narratives matches the data (`checks`).
 */
import { DEMO_PACKS } from "../src/lib/demo/packs";
import { bestAnswer, bestScenario, withTable } from "../src/lib/demo/player";
import type { DemoCheck } from "../src/lib/demo/types";
import { checkReadOnlySql } from "../src/lib/sql";
import { materialize, reconcileProfile, stageCsv } from "../src/lib/pipeline";
import { createNodeRunner } from "./node-duckdb";

const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;

let failures = 0;
let passes = 0;
function report(ok: boolean, label: string, detail = "") {
  if (ok) passes++;
  else failures++;
  if (!ok || process.argv.includes("--verbose")) console.log(`  ${ok ? green("✓") : red("✗")} ${label}${detail ? dim(`  — ${detail}`) : ""}`);
}

const same = (got: unknown, want: number | string) => {
  if (typeof want === "number") return typeof got === "number" && Math.abs(got - want) <= 0.051 + Math.abs(want) * 1e-9;
  return String(got) === want;
};

async function main() {
  for (const pack of DEMO_PACKS) {
    console.log(`\n${pack.id}`);
    const run = await createNodeRunner();
    const sample = await stageCsv(run, `public/samples/${pack.id}.csv`, "_raw");
    report(sample.headers.join() === pack.headers.join(), "headers match the CSV", sample.headers.join(", "));
    const profile = reconcileProfile(pack.profile, sample, `${pack.id}.csv`);
    const { failures: casts } = await materialize(run, "_raw", pack.profile.table_name, profile);
    const worst = Object.entries(casts).sort((a, b) => b[1] - a[1])[0];
    report(!worst || worst[1] <= 0.02, "typed columns parse ≥ 98%", worst ? `worst ${worst[0]} ${(worst[1] * 100).toFixed(1)}%` : "");
    const table = pack.profile.table_name;

    const runs = async (label: string, sql: string) => {
      const q = withTable(sql, table);
      const guard = checkReadOnlySql(q);
      if (!guard.ok) {
        report(false, label, `read-only guard: ${guard.reason}`);
        return null;
      }
      try {
        const r = await run(guard.sql);
        report(true, label, `${r.rowCount} rows`);
        return r;
      } catch (e) {
        report(false, label, e instanceof Error ? e.message.split("\n")[0] : String(e));
        return null;
      }
    };
    const verify = async (label: string, c: DemoCheck) => {
      try {
        const r = await run(withTable(c.sql, table));
        const row = r.rows[0] ?? [];
        const ok = c.expect.every((want, i) => same(row[i], want));
        report(ok, label, ok ? "" : `expected ${JSON.stringify(c.expect)}, got ${JSON.stringify(row)}`);
      } catch (e) {
        report(false, label, e instanceof Error ? e.message.split("\n")[0] : String(e));
      }
    };

    for (const s of pack.scenarios) {
      let i = 0;
      for (const step of s.steps) if (step.kind === "query") await runs(`[${s.id}] step: ${step.purpose}`, step.sql);
      for (const c of s.report.charts) {
        const r = await runs(`[${s.id}] chart: ${c.title}`, c.sql);
        if (r) {
          const missing = [c.x, c.y, ...(c.group ? [c.group] : [])].filter((col) => !r.columns.includes(col));
          report(!missing.length && r.rowCount > 0, `[${s.id}] chart columns: ${c.title}`, missing.length ? `missing ${missing.join(", ")}` : "");
        }
      }
      report(s.report.kpis.length === 4, `[${s.id}] 4 KPIs`);
      for (const c of s.checks) await verify(`[${s.id}] fact #${++i}`, c);
    }
    for (const qa of pack.qa) {
      await runs(`[qa] ${qa.question}`, qa.sql);
      let i = 0;
      for (const c of qa.checks) await verify(`[qa] fact #${++i}: ${qa.question}`, c);
    }
    const objectives = new Set(pack.scenarios.map((s) => s.objective));
    report(pack.profile.suggested_objectives.every((o) => objectives.has(o)), "every suggested objective has a prepared analysis");
    const questions = new Set(pack.qa.map((q) => q.question));
    report(pack.profile.suggested_questions.every((q) => questions.has(q)), "every suggested question has a prepared answer");
  }
  // Free-text routing: paraphrases must reach the right prepared answer or analysis.
  console.log("\nrouting");
  const [st, sc, ec] = DEMO_PACKS;
  const questions: [string, (typeof DEMO_PACKS)[number], string | null][] = [
    ["which team is the slowest at resolving tickets?", st, "Which department has the highest average resolution time?"],
    ["how many tickets came in yesterday", st, "How many tickets were created yesterday?"],
    ["when was the network outage", st, "On which day did we get the most Network tickets?"],
    ["who is responsible for most SLA breaches", st, "What share of SLA breaches comes from Security Engineering?"],
    ["how big is the backlog right now", st, "How many tickets are still open?"],
    ["what percentage of customers have cancelled", sc, "What is our overall churn rate?"],
    ["which accounts might cancel soon", sc, "How many active customers are at risk of churning?"],
    ["are we losing customers to rivals", sc, "How many customers left for a competitor last quarter?"],
    ["which shipper is late the most", ec, "Which carrier has the highest late delivery rate?"],
    ["how often do people send stuff back", ec, "What is our return rate?"],
    ["what is the weather in Paris", st, null],
    ["tell me a joke", ec, null],
  ];
  for (const [q, pack, want] of questions) {
    const got = bestAnswer(q, [pack], pack.id)?.qa.question ?? null;
    report(got === want, `ask: "${q}"`, got === want ? "" : `routed to ${got ?? "fallback"}`);
  }
  const objectives: [string, (typeof DEMO_PACKS)[number], string][] = [
    ["Where are our bottlenecks?", st, "bottlenecks"],
    ["find unusual spikes in volume", st, "anomalies"],
    ["how do we make customers happier", st, "csat"],
    ["how much money are we losing to churn", sc, "revenue"],
    ["is a competitor stealing customers", sc, "acceleration"],
    ["why are deliveries late", ec, "carriers"],
    ["what's going on with refunds", ec, "returns"],
  ];
  for (const [o, pack, want] of objectives) {
    const got = bestScenario(o, [pack], pack.id)?.scenario.id;
    report(got === want, `deep dive: "${o}"`, got === want ? "" : `routed to ${got}`);
  }

  console.log(failures ? red(`\n${failures} failed, ${passes} passed`) : green(`\nAll ${passes} checks passed`));
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
