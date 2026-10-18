/** Deterministic dashboard charts derived from the dataset profile (no model call needed). */
import { quoteIdent } from "../sql";
import type { ChartSpec, ColumnStats, LoadedDataset } from "../types";

const pretty = (s: string) => s.replace(/_/g, " ");
const title = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function timeBucket(stats: ColumnStats | undefined): "day" | "week" | "month" {
  if (!stats?.min || !stats?.max) return "week";
  const days = (Date.parse(String(stats.max).replace(" ", "T")) - Date.parse(String(stats.min).replace(" ", "T"))) / 86_400_000;
  return days <= 120 ? "day" : days <= 900 ? "week" : "month";
}

/** Low-cardinality categorical columns: the profiler's key dimensions first, then richer columns. */
export function groupableColumns(d: LoadedDataset) {
  const rank = (name: string) => {
    const i = (d.profile.key_dimensions ?? []).indexOf(name);
    return i < 0 ? 99 : i;
  };
  return d.stats
    .filter((s) => (s.role === "category" || s.role === "boolean") && s.distinct >= 2 && s.distinct <= 20)
    .sort((a, b) => rank(a.name) - rank(b.name) || Math.min(b.distinct, 12) - Math.min(a.distinct, 12));
}

/** `skipTrends` drops the volume and metric trend charts when the Hyper cards already show them. */
export function autoCharts(d: LoadedDataset, { skipTrends = false } = {}): ChartSpec[] {
  const t = quoteIdent(d.tableName);
  const ts = d.profile.primary_timestamp;
  const metric = d.profile.primary_metric;
  const tsStats = d.stats.find((s) => s.name === ts);
  const cats = groupableColumns(d).filter((s) => s.role === "category");
  const bools = d.stats.filter((s) => s.role === "boolean");
  const charts: ChartSpec[] = [];
  const bucket = timeBucket(tsStats);

  if (ts) {
    const T = quoteIdent(ts);
    // Only complete periods: a partial first/last bucket would read as a fake drop.
    const complete = `${T} >= date_trunc('${bucket}', (SELECT min(${T}) FROM ${t})) + INTERVAL 1 ${bucket} AND ${T} < date_trunc('${bucket}', (SELECT max(${T}) FROM ${t}))`;
    if (!skipTrends) charts.push({
      title: `Volume per ${bucket}`,
      type: "area",
      sql: `SELECT date_trunc('${bucket}', ${T}) AS period, count(*) AS records FROM ${t} WHERE ${complete} GROUP BY 1 ORDER BY 1`,
      x: "period",
      y: "records",
      group: null,
      caption: `Records per ${bucket} by ${pretty(ts)} (complete ${bucket}s only).`,
    });
    if (cats[0]) {
      const C = quoteIdent(cats[0].name);
      charts.push({
        title: title(`${pretty(cats[0].name)} mix over time`),
        type: "area",
        sql: `WITH top AS (SELECT ${C} AS g FROM ${t} WHERE ${C} IS NOT NULL GROUP BY 1 ORDER BY count(*) DESC LIMIT 5)
SELECT date_trunc('${bucket}', ${T}) AS period, CAST(${C} AS VARCHAR) AS ${C}, count(*) AS records
FROM ${t} WHERE ${complete} AND ${C} IN (SELECT g FROM top) GROUP BY 1, 2 ORDER BY 1`,
        x: "period",
        y: "records",
        group: cats[0].name,
        caption: `Top ${pretty(cats[0].name)} values per ${bucket}.`,
      });
    }
    if (metric && !skipTrends) {
      const M = quoteIdent(metric);
      charts.push({
        title: `Average ${pretty(metric)} per ${bucket}`,
        type: "line",
        sql: `SELECT date_trunc('${bucket}', ${T}) AS period, round(avg(${M}), 2) AS avg_${metric} FROM ${t} WHERE ${complete} AND ${M} IS NOT NULL GROUP BY 1 ORDER BY 1`,
        x: "period",
        y: `avg_${metric}`,
        group: null,
        caption: `Mean ${pretty(metric)} over time.`,
      });
    }
  }

  for (const c of cats.slice(0, 2)) {
    const C = quoteIdent(c.name);
    charts.push({
      title: `Records by ${pretty(c.name)}`,
      type: "hbar",
      sql: `SELECT CAST(${C} AS VARCHAR) AS ${C}, count(*) AS records FROM ${t} WHERE ${C} IS NOT NULL GROUP BY 1 ORDER BY 2 DESC LIMIT 12`,
      x: c.name,
      y: "records",
      group: null,
      caption: `Distribution across ${pretty(c.name)}.`,
    });
  }

  if (metric && cats[0]) {
    const C = quoteIdent(cats[1]?.name ?? cats[0].name);
    const name = cats[1]?.name ?? cats[0].name;
    const M = quoteIdent(metric);
    charts.push({
      title: `Average ${pretty(metric)} by ${pretty(name)}`,
      type: "bar",
      sql: `SELECT CAST(${C} AS VARCHAR) AS ${C}, round(avg(${M}), 2) AS avg_${metric} FROM ${t} WHERE ${C} IS NOT NULL GROUP BY 1 ORDER BY 2 DESC LIMIT 12`,
      x: name,
      y: `avg_${metric}`,
      group: null,
      caption: `Which ${pretty(name)} values run highest.`,
    });
  }

  const pair = d.profile.heatmap_pair?.map((n) => cats.find((c) => c.name === n)).filter((c) => c !== undefined);
  const heat = pair?.length === 2 ? pair : cats.length >= 2 ? [cats[0], cats[1]] : null;
  if (heat) {
    const [a, b] = heat[0].distinct >= heat[1].distinct ? [heat[0], heat[1]] : [heat[1], heat[0]];
    const A = quoteIdent(a.name);
    const B = quoteIdent(b.name);
    const value = metric ? `round(avg(${quoteIdent(metric)}), 1)` : "count(*)";
    const yName = metric ? `avg_${metric}` : "records";
    charts.push({
      title: title(`${pretty(a.name)} × ${pretty(b.name)}`),
      type: "heatmap",
      sql: `SELECT CAST(${A} AS VARCHAR) AS ${A}, CAST(${B} AS VARCHAR) AS ${B}, ${value} AS ${yName} FROM ${t} WHERE ${A} IS NOT NULL AND ${B} IS NOT NULL GROUP BY 1, 2`,
      x: a.name,
      y: yName,
      group: b.name,
      caption: metric ? `Average ${pretty(metric)} for each combination.` : "Record count for each combination.",
    });
  }

  const share = bools[0] ?? cats.find((c) => c.distinct <= 6);
  if (share) {
    const S = quoteIdent(share.name);
    charts.push({
      title: title(`${pretty(share.name)} share`),
      type: "donut",
      sql: `SELECT CAST(${S} AS VARCHAR) AS ${S}, count(*) AS records FROM ${t} WHERE ${S} IS NOT NULL GROUP BY 1 ORDER BY 2 DESC`,
      x: share.name,
      y: "records",
      group: null,
      caption: `Split of ${pretty(share.name)}.`,
    });
  }
  return charts;
}
