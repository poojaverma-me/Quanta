/**
 * The Hyper Charts dashboard: which cards a dataset gets, the SQL behind each,
 * and how each card's KPI pair and ranked rows are derived from query results.
 * Card templates mirror the reference kit:
 *  - "report": bold title, chart, KPI pair (✦ / medal), three ranked rows
 *  - "kpichart": KPI pair on top, chart below
 *  - "income": label, big figure, "Compared to …", comparison radar
 *  - "tile": compact figure + delta with a mini radar on the right
 * Period comparisons use 30-day windows ending at the latest timestamp, so
 * historical files compare like-for-like.
 */
import { quoteIdent } from "../sql";
import type { Cell, ChartSpec, LoadedDataset, QueryResult } from "../types";
import { formatNumber, shortDate } from "./charts";
import { groupableColumns, timeBucket } from "./overview";

const pretty = (s: string) => s.replace(/_/g, " ");
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Full-precision figure for the big monospace numbers ("312,134"); compact only when huge. */
export function bigNumber(n: number | null | undefined, digits = 1) {
  if (n === null || n === undefined || Number.isNaN(n)) return "–";
  if (Math.abs(n) >= 1e7) return formatNumber(n);
  return n.toLocaleString("en-US", { maximumFractionDigits: Number.isInteger(n) ? 0 : digits });
}

export interface KpiItem {
  label: string;
  icon: "spark" | "medal";
  value: string;
  cur?: number | null;
  prev?: number | null;
  sub: string;
}

export interface RankRow {
  label: string;
  value: string;
}

export interface GlobalKpis {
  cur_n: number | null;
  prev_n: number | null;
  cur_m: number | null;
  prev_m: number | null;
  total: number;
  all_m: number | null;
  anchor: string | null;
}

export type Glow = "bubbles" | "green" | "violet" | "duo" | "none";

export interface CardDef {
  id: string;
  template: "report" | "kpichart" | "income" | "tile";
  title: string;
  spec: ChartSpec;
  /** Optional second query for the KPIs or rows. */
  auxSql?: string;
  kpis?: (main: QueryResult, aux: QueryResult | null, g: GlobalKpis | null) => KpiItem[];
  rows?: (main: QueryResult, aux: QueryResult | null) => RankRow[];
  /** For "income" and "tile": the headline figure. */
  headline?: (main: QueryResult, g: GlobalKpis | null) => { value: string; cur?: number | null; prev?: number | null; sub: string };
  glow?: Glow;
  height?: number;
}

export interface HyperPlan {
  kpiSql: string;
  /** First row of cards: barcode report + two KPI/chart cards. */
  hero: { report: CardDef | null; side: CardDef[] };
  /** Second row: three 3D report cards. */
  depth: CardDef[];
  /** Third row: radar cards in three columns. */
  radar: { left: CardDef[]; center: CardDef[]; right: CardDef[] };
}

const num = (v: Cell | undefined) => (v === null || v === undefined ? null : Number(v));
const colOf = (r: QueryResult, name: string) => r.columns.indexOf(name);
const values = (r: QueryResult, name: string) => r.rows.map((row) => num(row[colOf(r, name)]));
const delta = (cur: number | null | undefined, prev: number | null | undefined) => ({ cur, prev });

export function hyperPlan(d: LoadedDataset): HyperPlan {
  const t = quoteIdent(d.tableName);
  const ts = d.profile.primary_timestamp;
  const metric = d.profile.primary_metric;
  const tsType = d.profile.columns.find((c) => c.name === ts)?.sql_type;
  const cats = groupableColumns(d).filter((s) => s.role === "category" && s.distinct >= 3);
  const dim = cats[0]?.name ?? null;
  const dim2 = cats[1]?.name ?? dim;
  const T = ts ? quoteIdent(ts) : null;
  const M = metric ? quoteIdent(metric) : null;
  const D = dim ? quoteIdent(dim) : null;
  const D2 = dim2 ? quoteIdent(dim2) : null;
  const mName = metric ? pretty(metric) : "";
  const anchor = T ? `WITH a AS (SELECT max(${T}) AS anchor FROM ${t})` : "";
  const cur = T ? `${T} > a.anchor - INTERVAL 30 DAY` : "";
  const prev = T ? `${T} > a.anchor - INTERVAL 60 DAY AND ${T} <= a.anchor - INTERVAL 30 DAY` : "";
  const bucket = timeBucket(d.stats.find((s) => s.name === ts));
  const span = T ? `WITH s AS (SELECT min(${T}) AS mn, max(${T}) AS mx FROM ${t})` : "";
  const complete = T ? `${T} >= date_trunc('${bucket}', s.mn) + INTERVAL 1 ${bucket} AND ${T} < date_trunc('${bucket}', s.mx)` : "";
  const topRowsSql = (col: string) => `SELECT CAST(${col} AS VARCHAR) AS value, count(*) AS records FROM ${t} WHERE ${col} IS NOT NULL GROUP BY 1 ORDER BY 2 DESC LIMIT 3`;
  const rowsFrom = (r: QueryResult | null, labelCol: string, valueCol: string, fmt = (n: number | null) => bigNumber(n)): RankRow[] =>
    r ? r.rows.slice(0, 3).map((row) => ({ label: String(row[colOf(r, labelCol)] ?? "–"), value: fmt(num(row[colOf(r, valueCol)])) })) : [];
  const volumeKpis = (g: GlobalKpis | null): KpiItem[] =>
    g
      ? [
          { label: "Last 30 days", icon: "spark", value: bigNumber(g.cur_n), ...delta(g.cur_n, g.prev_n), sub: `vs ${bigNumber(g.prev_n)} prior` },
          { label: "All time", icon: "medal", value: bigNumber(g.total), sub: `${d.rowCount.toLocaleString()} records` },
        ]
      : [];
  const metricKpis = (g: GlobalKpis | null): KpiItem[] =>
    g && metric
      ? [
          { label: `${cap(mName)} · 30d`, icon: "spark", value: bigNumber(g.cur_m, 2), ...delta(g.cur_m, g.prev_m), sub: `vs ${bigNumber(g.prev_m, 2)} prior` },
          { label: `${cap(mName)} · all`, icon: "medal", value: bigNumber(g.all_m, 2), sub: "all records" },
        ]
      : [];

  const kpiSql = T
    ? `${anchor}
SELECT count(*) FILTER (WHERE ${cur}) AS cur_n,
       count(*) FILTER (WHERE ${prev}) AS prev_n,
       ${M ? `avg(${M}) FILTER (WHERE ${cur})` : "NULL"} AS cur_m,
       ${M ? `avg(${M}) FILTER (WHERE ${prev})` : "NULL"} AS prev_m,
       count(*) AS total,
       ${M ? `avg(${M})` : "NULL"} AS all_m,
       CAST(any_value(a.anchor) AS VARCHAR) AS anchor
FROM ${t}, a`
    : `SELECT NULL AS cur_n, NULL AS prev_n, NULL AS cur_m, NULL AS prev_m, count(*) AS total, ${M ? `avg(${M})` : "NULL"} AS all_m, NULL AS anchor FROM ${t}`;

  // ---------- row 1: barcode + pills + candles ----------

  const report: CardDef | null = T
    ? {
        id: "barcode",
        template: "report",
        title: d.profile.title,
        glow: "green",
        height: 440,
        spec: {
          title: "Daily records",
          type: "glowbars",
          sql: `${anchor},
d AS (SELECT CAST(${T} AS DATE) AS day, count(*) AS records FROM ${t}, a WHERE ${T} > a.anchor - INTERVAL 60 DAY GROUP BY 1),
w AS (SELECT day, sum(records) OVER (ORDER BY day ROWS BETWEEN CURRENT ROW AND 13 FOLLOWING) AS win,
             count(*) OVER (ORDER BY day ROWS BETWEEN CURRENT ROW AND 13 FOLLOWING) AS n FROM d),
best AS (SELECT day AS start FROM w WHERE n = 14 ORDER BY win DESC LIMIT 1)
SELECT d.day, d.records, coalesce(d.day >= best.start AND d.day < best.start + INTERVAL 14 DAY, false) AS busiest
FROM d LEFT JOIN best ON true ORDER BY d.day`,
          x: "day",
          y: "records",
          group: null,
          caption: "Records per day over the last 60 days. The busiest 14-day stretch is lit up.",
          extra: { flag: "busiest" },
        },
        auxSql: D ? topRowsSql(D) : undefined,
        kpis: (_m, _a, g) => volumeKpis(g),
        rows: (_m, aux) => rowsFrom(aux, "value", "records"),
      }
    : null;

  const side: CardDef[] = [];
  if (T) {
    side.push({
      id: "pills",
      template: "kpichart",
      title: `${cap(bucket)}ly volume`,
      height: 230,
      spec: {
        title: `${cap(bucket)}ly volume`,
        type: "pillcombo",
        sql: `${span},
w AS (SELECT date_trunc('${bucket}', ${T}) AS period, count(*) AS records FROM ${t}, s WHERE ${complete} GROUP BY 1),
r AS (SELECT period, records, round(avg(records) OVER (ORDER BY period ROWS BETWEEN 3 PRECEDING AND CURRENT ROW), 1) AS rolling_avg FROM w)
SELECT * FROM (SELECT * FROM r ORDER BY period DESC LIMIT 8) ORDER BY period`,
        x: "period",
        y: "records",
        group: null,
        caption: `Records per complete ${bucket} (pills) and the 4-${bucket} rolling average (gold line).`,
        extra: { line: "rolling_avg" },
      },
      kpis: (m) => {
        const rec = values(m, "records");
        const avg = values(m, "rolling_avg");
        const last = rec.at(-1) ?? null;
        const before = rec.at(-2) ?? null;
        const p = m.rows.at(-1)?.[colOf(m, "period")] ?? null;
        return [
          { label: `Latest ${bucket}`, icon: "spark", value: bigNumber(last), ...delta(last, before), sub: p ? `${bucket} of ${shortDate(p)}` : "" },
          { label: `4-${bucket} average`, icon: "medal", value: bigNumber(avg.at(-1) ?? null), ...delta(avg.at(-1), avg.at(-5)), sub: "rolling" },
        ];
      },
    });
    if (M) {
      const fmt = bucket === "month" ? "%m" : bucket === "day" ? "%d" : "%V";
      side.push({
        id: "candles",
        template: "kpichart",
        title: `${cap(mName)} range`,
        height: 220,
        spec: {
          title: `${cap(mName)} range`,
          type: "candles",
          sql: `${span},
w AS (SELECT date_trunc('${bucket}', ${T}) AS period,
             quantile_cont(${M}, 0.1) AS p10, quantile_cont(${M}, 0.25) AS p25, median(${M}) AS median,
             quantile_cont(${M}, 0.75) AS p75, quantile_cont(${M}, 0.9) AS p90
      FROM ${t}, s WHERE ${complete} AND ${M} IS NOT NULL GROUP BY 1)
SELECT strftime(period, '${fmt}') AS period_no, CAST(period AS DATE) AS period_start,
       round(p10, 2) AS p10, round(p25, 2) AS p25, round(median, 2) AS median, round(p75, 2) AS p75, round(p90, 2) AS p90
FROM (SELECT * FROM w ORDER BY period DESC LIMIT 9) ORDER BY period_start`,
          x: "period_no",
          y: metric!,
          group: null,
          caption: `${cap(mName)} per ${bucket}: bright pills span the middle 50%, dim pills the middle 80%. Labels are ${bucket === "week" ? "ISO week numbers" : `${bucket} numbers`}.`,
          extra: { low: "p25", high: "p75", low2: "p10", high2: "p90", mid: "median", label: "period_start" },
        },
        kpis: (m) => {
          const med = values(m, "median");
          const p25 = values(m, "p25").at(-1);
          const p75 = values(m, "p75").at(-1);
          return [
            { label: `Median · latest ${bucket}`, icon: "spark", value: bigNumber(med.at(-1) ?? null), ...delta(med.at(-1), med.at(-2)), sub: `vs ${bigNumber(med.at(-2) ?? null)}` },
            { label: "Typical range", icon: "medal", value: `${bigNumber(p25 ?? null, 0)}–${bigNumber(p75 ?? null, 0)}`, sub: "middle 50%" },
          ];
        },
      });
    }
  }

  // ---------- row 2: three 3D report cards ----------

  const depth: CardDef[] = [];
  const bools = d.stats.filter((s) => s.role === "boolean" && s.sql_type === "BOOLEAN");
  const metric2 = d.stats.find((s) => s.role === "metric" && s.name !== metric && (s.sql_type === "DOUBLE" || s.sql_type === "BIGINT"));
  if (D && M) {
    let zExpr = "count(DISTINCT 1)";
    let zName = "z";
    if (bools[0]) {
      zName = `pct_${bools[0].name}`;
      zExpr = `round(100.0 * avg(CASE WHEN ${quoteIdent(bools[0].name)} THEN 1 ELSE 0 END), 1)`;
    } else if (metric2) {
      zName = `avg_${metric2.name}`;
      zExpr = `round(avg(${quoteIdent(metric2.name)}), 2)`;
    }
    depth.push({
      id: "bubbles",
      template: "report",
      title: `${cap(pretty(dim!))} landscape`,
      glow: "bubbles",
      spec: {
        title: `${cap(pretty(dim!))} landscape`,
        type: "bubble3d",
        sql: `SELECT CAST(${D} AS VARCHAR) AS label, count(*) AS records, round(avg(${M}), 2) AS avg_${metric}, ${zExpr} AS ${zName}
FROM ${t} WHERE ${D} IS NOT NULL GROUP BY 1 ORDER BY 2 DESC LIMIT 10`,
        x: "records",
        y: `avg_${metric}`,
        group: "label",
        caption: `Each sphere is a ${pretty(dim!)}: records across, average ${mName} up, ${pretty(zName.replace(/^pct_/, "% ").replace(/^avg_/, "avg "))} in depth; size follows records. Drag to rotate.`,
        extra: { z: zName, size: "records" },
      },
      kpis: (m) => {
        const byRec = [...m.rows].sort((a, b) => Number(b[1]) - Number(a[1]));
        const byAvg = [...m.rows].sort((a, b) => Number(b[2]) - Number(a[2]));
        return [
          { label: "Largest", icon: "spark", value: bigNumber(num(byRec[0]?.[1])), sub: String(byRec[0]?.[0] ?? "") },
          { label: `Highest ${mName}`, icon: "medal", value: bigNumber(num(byAvg[0]?.[2]), 2), sub: String(byAvg[0]?.[0] ?? "") },
        ];
      },
      rows: (m) => [...m.rows].sort((a, b) => Number(b[2]) - Number(a[2])).slice(0, 3).map((r) => ({ label: String(r[0]), value: bigNumber(num(r[2]), 2) })),
    });
  }
  if (T) {
    depth.push({
      id: "lollipops",
      template: "report",
      title: "Peak days",
      glow: "green",
      spec: {
        title: "Peak days",
        type: "lollipop3d",
        sql: `${anchor},
d AS (SELECT CAST(${T} AS DATE) AS day, count(*) AS records FROM ${t}, a WHERE ${T} > a.anchor - INTERVAL 63 DAY GROUP BY 1),
f AS (SELECT min(day) AS first, round(avg(records), 1) AS avg_day FROM d)
SELECT d.day, d.records, CAST(floor(datediff('day', f.first, d.day) / 7) AS INTEGER) + 1 AS week, isodow(d.day) AS weekday, f.avg_day
FROM d, f ORDER BY d.records DESC LIMIT 10`,
        x: "week",
        y: "records",
        group: null,
        caption: "The 10 busiest days of the last 9 weeks: week across, weekday (1 = Monday) in depth, records up. Drag to rotate.",
        extra: { z: "weekday", label: "day" },
      },
      kpis: (m) => [
        { label: "Peak day", icon: "spark", value: bigNumber(num(m.rows[0]?.[1])), sub: m.rows[0] ? shortDate(m.rows[0][0]) : "" },
        { label: "Average day", icon: "medal", value: bigNumber(num(m.rows[0]?.[4]), 1), sub: "last 9 weeks" },
      ],
      rows: (m) => m.rows.slice(0, 3).map((r) => ({ label: shortDate(r[0]), value: bigNumber(num(r[1])) })),
    });
  }
  if (T && tsType === "TIMESTAMP") {
    depth.push({
      id: "waves",
      template: "report",
      title: "Daily rhythm",
      glow: "violet",
      spec: {
        title: "Daily rhythm",
        type: "ridge3d",
        sql: `${anchor},
weeks AS (SELECT DISTINCT date_trunc('week', ${T}) AS wk FROM ${t}, a WHERE ${T} >= date_trunc('week', a.anchor) - INTERVAL 8 WEEK AND ${T} < date_trunc('week', a.anchor)),
hours AS (SELECT range AS hour FROM range(24)),
c AS (SELECT date_trunc('week', ${T}) AS wk, hour(${T}) AS hour, count(*) AS n FROM ${t}, a
      WHERE ${T} >= date_trunc('week', a.anchor) - INTERVAL 8 WEEK AND ${T} < date_trunc('week', a.anchor) GROUP BY 1, 2)
SELECT strftime(weeks.wk, 'Week %V') AS week, hours.hour, coalesce(c.n, 0) AS records
FROM weeks CROSS JOIN hours LEFT JOIN c ON c.wk = weeks.wk AND c.hour = hours.hour
ORDER BY weeks.wk DESC, hours.hour`,
        x: "hour",
        y: "records",
        group: "week",
        caption: "Records by hour of day (3-hour smoothing) for each of the last 8 complete weeks; the newest week is in front (violet), the oldest at the back (green). Drag to rotate.",
      },
      kpis: (m) => {
        const byHour = new Map<number, number>();
        const byWeek = new Map<string, number>();
        for (const r of m.rows) {
          byHour.set(Number(r[1]), (byHour.get(Number(r[1])) ?? 0) + Number(r[2]));
          byWeek.set(String(r[0]), (byWeek.get(String(r[0])) ?? 0) + Number(r[2]));
        }
        const weeks = [...byWeek.values()];
        const peak = [...byHour.entries()].sort((a, b) => b[1] - a[1])[0];
        return [
          { label: "Latest week", icon: "spark", value: bigNumber(weeks[0] ?? null), ...delta(weeks[0], weeks[1]), sub: `vs ${bigNumber(weeks[1] ?? null)}` },
          { label: "Peak hour", icon: "medal", value: peak ? `${String(peak[0]).padStart(2, "0")}:00` : "–", sub: peak ? `${bigNumber(peak[1] / Math.max(1, weeks.length), 0)} per week` : "" },
        ];
      },
      rows: (m) => {
        const byHour = new Map<number, number>();
        for (const r of m.rows) byHour.set(Number(r[1]), (byHour.get(Number(r[1])) ?? 0) + Number(r[2]));
        return [...byHour.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 3)
          .map(([h, n]) => ({ label: `${String(h).padStart(2, "0")}:00 – ${String((h + 1) % 24).padStart(2, "0")}:00`, value: bigNumber(n) }));
      },
    });
  } else if (D && M) {
    // Skewed positive metrics (revenue, sizes) are binned on a log scale so the layers have shape.
    const mStats = d.stats.find((x) => x.name === metric);
    const lo0 = Number(mStats?.min ?? 0);
    const hi0 = Number(mStats?.max ?? 0);
    const logScale = lo0 > 0 && hi0 / lo0 > 50;
    const f = (e: string) => (logScale ? `ln(${e})` : e);
    const back = (e: string) => (logScale ? `exp(${e})` : e);
    depth.push({
      id: "waves",
      template: "report",
      title: `${cap(mName)} by ${pretty(dim!)}`,
      glow: "violet",
      spec: {
        title: `${cap(mName)} by ${pretty(dim!)}`,
        type: "ridge3d",
        sql: `WITH s AS (SELECT ${f(`quantile_cont(${M}, 0.01)`)} AS lo, ${f(`quantile_cont(${M}, 0.99)`)} AS hi FROM ${t} WHERE ${M} IS NOT NULL${logScale ? ` AND ${M} > 0` : ""}),
top AS (SELECT ${D} AS g FROM ${t} WHERE ${D} IS NOT NULL AND ${M} IS NOT NULL GROUP BY 1 ORDER BY count(*) DESC LIMIT 8),
b AS (SELECT CAST(${D} AS VARCHAR) AS grp, CAST(least(19, greatest(0, floor((${f(M)} - s.lo) / nullif(s.hi - s.lo, 0) * 20))) AS INTEGER) AS bin, s.lo, s.hi
      FROM ${t}, s WHERE ${D} IN (SELECT g FROM top) AND ${M} IS NOT NULL${logScale ? ` AND ${M} > 0` : ""})
SELECT grp AS ${D}, round(${back("any_value(lo) + (bin + 0.5) * (any_value(hi) - any_value(lo)) / 20")}, 1) AS ${M},
       round(100.0 * count(*) / sum(count(*)) OVER (PARTITION BY grp), 1) AS pct_of_group
FROM b GROUP BY grp, bin ORDER BY grp, bin`,
        x: metric!,
        y: "pct_of_group",
        group: dim!,
        caption: `How ${mName} is spread within each ${pretty(dim!)}: each layer shows the % of that ${pretty(dim!)}'s records per ${logScale ? "log-scaled " : ""}bin (1st–99th percentile range). Drag to rotate.`,
      },
      auxSql: `SELECT CAST(${D} AS VARCHAR) AS value, round(median(${M}), 2) AS med FROM ${t} WHERE ${D} IS NOT NULL AND ${M} IS NOT NULL GROUP BY 1 ORDER BY 2 DESC LIMIT 3`,
      kpis: (_m, aux, g) => [
        { label: `Overall ${mName}`, icon: "spark", value: bigNumber(g?.all_m ?? null, 2), sub: "average" },
        { label: "Highest median", icon: "medal", value: bigNumber(num(aux?.rows[0]?.[1]), 2), sub: String(aux?.rows[0]?.[0] ?? "") },
      ],
      rows: (_m, aux) => rowsFrom(aux, "value", "med", (n) => bigNumber(n, 2)),
    });
  }

  // ---------- row 3: radars ----------

  const left: CardDef[] = [];
  const center: CardDef[] = [];
  const right: CardDef[] = [];
  const byDim = (col: string, value: string, name: string, limit = 8) =>
    `SELECT * FROM (SELECT CAST(${col} AS VARCHAR) AS ${col}, ${value} AS ${name} FROM ${t} WHERE ${col} IS NOT NULL GROUP BY 1 ORDER BY count(*) DESC LIMIT ${limit}) ORDER BY 1`;
  const compareCounts = (col: string) => `${anchor},
top AS (SELECT ${col} AS g FROM ${t} WHERE ${col} IS NOT NULL GROUP BY 1 ORDER BY count(*) DESC LIMIT 6)
SELECT CAST(${col} AS VARCHAR) AS ${col}, count(*) FILTER (WHERE ${cur}) AS last_30_days, count(*) FILTER (WHERE ${prev}) AS prior_30_days
FROM ${t}, a WHERE ${col} IN (SELECT g FROM top) GROUP BY 1 ORDER BY 1`;

  if (D2) {
    left.push({
      id: "tile-flower",
      template: "tile",
      title: "Total records",
      spec: { title: `Records by ${pretty(dim2!)}`, type: "radar", sql: byDim(D2, "count(*)", "records", 6), x: dim2!, y: "records", group: null, caption: `Petals: records per ${pretty(dim2!)}.`, extra: { shape: "petal" } },
      headline: (_m, g) => ({ value: bigNumber(g?.total ?? null), ...delta(g?.cur_n, g?.prev_n), sub: g?.cur_n !== null && g?.cur_n !== undefined ? `${bigNumber(g.cur_n)} in the last 30 days` : "all records" }),
    });
  }
  if (D2 && M) {
    left.push({
      id: "star",
      template: "report",
      title: `${cap(mName)} by ${pretty(dim2!)}`,
      glow: "violet",
      spec: { title: `${cap(mName)} by ${pretty(dim2!)}`, type: "radar", sql: byDim(D2, `round(avg(${M}), 2)`, `avg_${metric}`), x: dim2!, y: `avg_${metric}`, group: null, caption: `Star points: average ${mName} per ${pretty(dim2!)}.`, extra: { shape: "star" } },
      kpis: (_m, _a, g) => metricKpis(g),
      rows: (m) => {
        const sorted = [...m.rows].sort((a, b) => Number(b[1]) - Number(a[1]));
        return sorted.slice(0, 3).map((r) => ({ label: String(r[0]), value: bigNumber(num(r[1]), 2) }));
      },
    });
  }
  if (T && D) {
    center.push({
      id: "income",
      template: "income",
      title: "Last 30 days",
      glow: "duo",
      spec: {
        title: `${cap(pretty(dim!))}: last 30 days vs prior`,
        type: "radar",
        sql: compareCounts(D),
        x: dim!,
        y: "last_30_days",
        group: null,
        caption: "Violet is the last 30 days, orange the 30 days before; labels read current / prior.",
        extra: { compare: "prior_30_days", shape: "polygon" },
      },
      headline: (_m, g) => ({ value: bigNumber(g?.cur_n ?? null), ...delta(g?.cur_n, g?.prev_n), sub: `Compared to ${bigNumber(g?.prev_n ?? null)} in the prior 30 days` }),
    });
    center.push({
      id: "tile-wave",
      template: "tile",
      title: "Daily rhythm",
      spec: {
        title: "Daily records: last 30 days vs prior",
        type: "radar",
        sql: `${anchor},
d AS (SELECT CAST(datediff('day', CAST(${T} AS DATE), CAST(a.anchor AS DATE)) AS INTEGER) AS ago FROM ${t}, a WHERE ${T} > a.anchor - INTERVAL 60 DAY)
SELECT 29 - (ago % 30) AS day_index, count(*) FILTER (WHERE ago < 30) AS last_30_days, count(*) FILTER (WHERE ago >= 30) AS prior_30_days FROM d GROUP BY 1 ORDER BY 1`,
        x: "day_index",
        y: "last_30_days",
        group: null,
        caption: "Each ring traces 30 days of records around the circle, rippling with each day's volume: violet (outer) the last 30 days, orange (inner) the 30 before.",
        extra: { compare: "prior_30_days", shape: "wave" },
      },
      headline: (_m, g) => ({ value: bigNumber(g?.cur_n ?? null), ...delta(g?.cur_n, g?.prev_n), sub: `vs ${bigNumber(g?.prev_n ?? null)} prior` }),
    });
    if (M && D2) {
      center.push({
        id: "tile-compare",
        template: "tile",
        title: `Avg ${mName}`,
        spec: {
          title: `Avg ${mName} by ${pretty(dim2!)}: last 30 days vs prior`,
          type: "radar",
          sql: `${anchor},
top AS (SELECT ${D2} AS g FROM ${t} WHERE ${D2} IS NOT NULL GROUP BY 1 ORDER BY count(*) DESC LIMIT 6)
SELECT CAST(${D2} AS VARCHAR) AS ${D2}, round(avg(${M}) FILTER (WHERE ${cur}), 2) AS last_30_days, round(avg(${M}) FILTER (WHERE ${prev}), 2) AS prior_30_days
FROM ${t}, a WHERE ${D2} IN (SELECT g FROM top) GROUP BY 1 ORDER BY 1`,
          x: dim2!,
          y: "last_30_days",
          group: null,
          caption: `Average ${mName} per ${pretty(dim2!)}: violet last 30 days, orange prior 30.`,
          extra: { compare: "prior_30_days", shape: "polygon" },
        },
        headline: (_m, g) => ({ value: bigNumber(g?.cur_m ?? null, 1), ...delta(g?.cur_m, g?.prev_m), sub: `30-day average · ${bigNumber(g?.all_m ?? null, 1)} overall` }),
      });
    }
  }
  if (D && M) {
    right.push({
      id: "tile-star",
      template: "tile",
      title: `Avg ${mName}`,
      spec: { title: `Avg ${mName} by ${pretty(dim!)}`, type: "radar", sql: byDim(D, `round(avg(${M}), 2)`, `avg_${metric}`, 6), x: dim!, y: `avg_${metric}`, group: null, caption: "", extra: { shape: "star" } },
      headline: (_m, g) => ({ value: bigNumber(g?.all_m ?? null, 1), ...delta(g?.cur_m, g?.prev_m), sub: g?.cur_m !== null && g?.cur_m !== undefined ? `30-day avg ${bigNumber(g.cur_m, 1)}` : "all records" }),
    });
  }
  if (D) {
    right.push({
      id: "flower",
      template: "report",
      title: `${cap(pretty(dim!))} mix`,
      glow: "violet",
      spec: { title: `${cap(pretty(dim!))} mix`, type: "radar", sql: byDim(D, "count(*)", "records", 6), x: dim!, y: "records", group: null, caption: `Petals: records per ${pretty(dim!)}.`, extra: { shape: "petal" } },
      kpis: (_m, _a, g) => volumeKpis(g),
      rows: (m) => [...m.rows].sort((a, b) => Number(b[1]) - Number(a[1])).slice(0, 3).map((r) => ({ label: String(r[0]), value: bigNumber(num(r[1])) })),
    });
  }

  return { kpiSql, hero: { report, side }, depth, radar: { left, center, right } };
}
