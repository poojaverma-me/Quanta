/**
 * Highcharts theme + a single builder that turns (ChartSpec, QueryResult) into
 * chart options. Overview charts and agent-report charts share this path.
 *
 * The visual language replicates Setproduct's Hyper Charts kit on black:
 * neon-green "barcode" bars, cyan → violet pill columns with a gold line and
 * hollow markers, bright/dim mint range pills, gridded 3D boxes (glossy
 * bubbles, glowing lollipops, layered waves), and violet/orange radars drawn
 * as polygons, rounded stars, flower petals or wavy rings. Chart types the kit
 * doesn't show (heatmap, donut, horizontal bars, lines) are derived from it.
 */
import type * as HighchartsNS from "highcharts";
import type { Cell, ChartSpec, QueryResult } from "../types";

type Highcharts = typeof HighchartsNS;
type Options = HighchartsNS.Options;
type Series = HighchartsNS.SeriesOptionsType;

/**
 * Categorical order, validated on the black chart surface: lightness band,
 * chroma, CVD separation and contrast all pass. Assigned in fixed order.
 */
export const SERIES_COLORS = ["#0EA2C4", "#3E9B46", "#8B5CF6", "#B8860B", "#3E73E6", "#D9488F"];
/** Brighter glow versions of the categorical colors, for strokes and glossy fills. */
const SERIES_GLOW = ["#22D3EE", "#5BEF4A", "#A78BFA", "#F5B83D", "#60A5FA", "#F472B6"];
/** Current vs. previous period, as in the radar references. */
export const COMPARE = { current: "#7B5CFF", previous: "#F26A21" };
/** Heat ramp: deep violet → violet → blue → cyan → neon green. Lightness rises monotonically. */
export const HEAT_STOPS: [number, string][] = [
  [0, "#160d33"],
  [0.3, "#4c1d95"],
  [0.55, "#2563eb"],
  [0.8, "#06b6d4"],
  [1, "#7cff6b"],
];
/** Wave layers, front to back: violet → blue → cyan → green (the 3D ridge reference). */
const WAVE = ["#6d28d9", "#5b3df5", "#3b5bfd", "#2f7dfb", "#1fa3f2", "#18c5e0", "#1ddcb8", "#3fe58f", "#6cf26a", "#9dfb6a"];
const NEON = "#6CFF5B";
const NEON_DIM = "#3DA53A";
const MINT = "#19F5A8";
const TEAL_DIM = "#0F6E58";
const GOLD = "#E8A93A";
const CYAN = "#1CD6F5";
const SURFACE = "#000000";
const MONO = "var(--font-mono-face), ui-monospace, Menlo, monospace";
const INK = { primary: "#F5F5F7", secondary: "#A3A3AD", muted: "#6C6C78", grid: "rgba(255,255,255,0.09)", faint: "rgba(255,255,255,0.05)" };

let loaded: Promise<Highcharts> | null = null;

/** Highcharts is loaded on demand in the browser only, with the modules we need. */
export function loadHighcharts() {
  loaded ??= (async () => {
    const H = (await import("highcharts")).default as unknown as Highcharts;
    await import("highcharts/highcharts-more");
    await import("highcharts/highcharts-3d");
    await import("highcharts/modules/heatmap");
    await import("highcharts/modules/accessibility");
    H.setOptions(theme());
    return H;
  })();
  return loaded;
}

function theme(): Options {
  return {
    colors: SERIES_COLORS,
    chart: {
      backgroundColor: "transparent",
      style: { fontFamily: "var(--font-sans), -apple-system, BlinkMacSystemFont, sans-serif" },
      spacing: [8, 4, 8, 4],
      animation: { duration: 650 },
    },
    title: { text: undefined },
    credits: { enabled: false },
    exporting: { enabled: false },
    legend: {
      itemStyle: { color: INK.secondary, fontWeight: "500", fontSize: "11px" },
      itemHoverStyle: { color: INK.primary },
      itemHiddenStyle: { color: "#3a3a42" },
      symbolRadius: 6,
      symbolHeight: 8,
      symbolWidth: 8,
      align: "left",
      verticalAlign: "top",
      margin: 14,
    },
    xAxis: {
      lineWidth: 0,
      tickColor: "transparent",
      gridLineColor: INK.grid,
      labels: { style: { color: INK.secondary, fontSize: "11px" } },
    },
    yAxis: {
      gridLineColor: INK.faint,
      title: { text: undefined },
      labels: { style: { color: INK.muted, fontSize: "10.5px", fontFamily: MONO } },
    },
    tooltip: {
      backgroundColor: "rgba(14,14,16,0.97)",
      borderColor: "rgba(255,255,255,0.12)",
      borderRadius: 12,
      borderWidth: 1,
      shadow: { color: "rgba(0,0,0,0.6)", offsetX: 0, offsetY: 8, width: 24, opacity: 0.5 },
      style: { color: INK.primary, fontSize: "12px" },
      padding: 10,
    },
    plotOptions: {
      series: { animation: { duration: 700 }, states: { inactive: { opacity: 0.35 } } },
      column: { borderWidth: 0 },
      bar: { borderWidth: 0 },
      columnrange: { borderWidth: 0 },
      areaspline: { lineWidth: 2, marker: { enabled: false, radius: 4 } },
      spline: { lineWidth: 2, marker: { enabled: false, radius: 4 } },
      pie: { borderWidth: 4, borderColor: SURFACE },
      heatmap: { borderWidth: 0 },
    },
  };
}

// ---------- helpers ----------

const DATE_RE = /^\d{4}-\d{2}-\d{2}( \d{2}:\d{2}(:\d{2})?)?$/;
const toTime = (v: Cell) => (typeof v === "string" && DATE_RE.test(v) ? Date.parse(v.replace(" ", "T") + (v.length > 10 ? "Z" : "T00:00:00Z")) : NaN);
const toNum = (v: Cell) => (typeof v === "number" ? v : typeof v === "boolean" ? Number(v) : v === null ? null : Number.isFinite(Number(v)) ? Number(v) : null);
const truthy = (v: Cell) => v === true || v === 1 || v === "true" || v === "TRUE";
const label = (v: Cell) => (v === null ? "(blank)" : String(v));
const pretty = (s: string) => s.replace(/_/g, " ");
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "2026-08-17" → "Aug 17"; anything else is passed through. */
export function shortDate(v: Cell) {
  const t = toTime(v);
  if (Number.isNaN(t)) return label(v);
  const d = new Date(t);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

export function formatNumber(n: number | null | undefined) {
  if (n === null || n === undefined || Number.isNaN(n)) return "–";
  const abs = Math.abs(n);
  if (abs >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (abs >= 1e4) return `${(n / 1e3).toFixed(1)}k`;
  if (Number.isInteger(n)) return n.toLocaleString("en-US");
  return n.toLocaleString("en-US", { maximumFractionDigits: abs < 1 ? 3 : abs < 100 ? 2 : 1 });
}

/** Glow for lit-from-within marks. */
const glow = (color: string, width = 10, opacity = 0.35) => ({ color, width, opacity, offsetX: 0, offsetY: 0 });
const vertical = (stops: [number, string][]) => ({ linearGradient: { x1: 0, y1: 0, x2: 0, y2: 1 }, stops });
const horizontal = (stops: [number, string][]) => ({ linearGradient: { x1: 0, y1: 0, x2: 1, y2: 0 }, stops });

function hexA(hex: string, a: number) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

/** Fully rounded ends on both sides of a bar, like the reference's pills. */
const PILL = { radius: "50%", where: "all", scope: "point" } as unknown as number;

/** Cyan top → violet → fading deep violet, the kit's signature pill fill. */
const PILL_FILL = vertical([
  [0, CYAN],
  [0.42, "#4F46E5"],
  [0.78, hexA("#5B21B6", 0.85)],
  [1, hexA("#3B0F8C", 0.2)],
]);

/** Glossy sphere fill for 3D bubbles and lollipop heads. */
const sphere = (color: string) => ({
  radialGradient: { cx: 0.35, cy: 0.3, r: 0.8 },
  stops: [
    [0, "#ffffff"],
    [0.22, color],
    [0.85, hexA(color, 0.55)],
    [1, hexA(color, 0.25)],
  ] as [number, string][],
});

const axisLabel = (extra: Record<string, unknown> = {}) => ({ style: { fontFamily: MONO, color: INK.secondary, fontSize: "10.5px", fontWeight: "500" }, ...extra });
const BOLD_MONO = { style: { fontFamily: MONO, color: "#E6E6EA", fontSize: "11.5px", fontWeight: "600" } };

function pivot(result: QueryResult, x: string, y: string, group: string | null, maxSeries: number) {
  const xi = result.columns.indexOf(x);
  const yi = result.columns.indexOf(y);
  const gi = group ? result.columns.indexOf(group) : -1;
  const totals = new Map<string, number>();
  for (const r of result.rows) {
    const g = gi >= 0 ? label(r[gi]) : y;
    totals.set(g, (totals.get(g) ?? 0) + Math.abs(toNum(r[yi]) ?? 0));
  }
  const keep = [...totals.entries()].sort((a, b) => b[1] - a[1]).slice(0, maxSeries).map(([g]) => g);
  return { xi, yi, gi, groups: keep };
}

/** Bars with long or many category labels are drawn horizontally. */
function isHorizontal(spec: Pick<ChartSpec, "type" | "x">, result: QueryResult) {
  if (spec.type === "hbar") return true;
  if (spec.type !== "bar") return false;
  const xi = result.columns.indexOf(spec.x);
  const cats = new Set(result.rows.map((r) => label(r[xi])));
  return cats.size > 10 || [...cats].some((c) => c.length > 14);
}

function barHeight(n: number) {
  return Math.max(180, Math.min(520, 30 + Math.min(n, 20) * 34));
}

export function chartHeight(spec: Pick<ChartSpec, "type" | "x" | "group">, result: QueryResult) {
  if (isHorizontal(spec, result)) {
    const xi = result.columns.indexOf(spec.x);
    return barHeight(new Set(result.rows.map((r) => label(r[xi]))).size);
  }
  switch (spec.type) {
    case "heatmap": {
      const gi = spec.group ? result.columns.indexOf(spec.group) : -1;
      const n = gi >= 0 ? new Set(result.rows.map((r) => label(r[gi]))).size : 1;
      return Math.max(240, 120 + Math.min(n, 12) * 52);
    }
    case "glowbars":
      return 300;
    case "pillcombo":
      return 250;
    case "candles":
      return 230;
    case "radar":
      return 340;
    case "bubble3d":
    case "lollipop3d":
    case "ridge3d":
      return 340;
    case "ridgeline": {
      const gi = spec.group ? result.columns.indexOf(spec.group) : -1;
      const n = gi >= 0 ? new Set(result.rows.map((r) => label(r[gi]))).size : 1;
      return 90 + Math.min(n, 6) * 44;
    }
    default:
      return 260;
  }
}

/** Unusual values (above mean + 1.5σ), used when a glow-bar spec has no explicit flag column. */
export function spikeThreshold(values: number[]) {
  if (values.length < 8) return Infinity;
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const sd = Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length);
  return mean + 1.5 * sd;
}

/** The gridded 3D box from the reference: floor and two back walls with fine lines. */
function box3d(height: number, alpha: number, beta: number, depth: number): Options["chart"] {
  const wall = { size: 1, color: "rgba(255,255,255,0.025)" };
  return {
    height,
    margin: [24, 40, 64, 52],
    options3d: { enabled: true, alpha, beta, depth, viewDistance: 7, fitToPlot: false, frame: { bottom: wall, back: wall, side: wall, left: wall } },
  };
}

function range(vals: (number | null)[], pad = 0.12) {
  const v = vals.filter((x): x is number => x !== null);
  if (!v.length) return {};
  const lo = Math.min(...v);
  const hi = Math.max(...v);
  const p = (hi - lo || Math.abs(hi) || 1) * pad;
  return { min: lo >= 0 ? Math.max(0, lo - p) : lo - p, max: hi + p };
}

/** Build Highcharts options for a spec + its query result. */
export function buildOptions(spec: ChartSpec, result: QueryResult, opts: { height?: number; compact?: boolean } = {}): Options {
  const height = opts.height ?? chartHeight(spec, result);
  const base: Options = { chart: { height }, accessibility: { description: `${spec.title}. ${spec.caption}` } };
  const col = (name?: string | null) => (name ? result.columns.indexOf(name) : -1);
  const valueSuffix = /pct|percent|rate|share/i.test(spec.y) ? (result.rows.some((r) => (toNum(r[col(spec.y)]) ?? 0) > 1.5) ? "%" : "") : "";
  const compact = !!opts.compact;

  switch (spec.type) {
    // Neon "barcode": thin pill bars fading to black; flagged bars light up as one bright block.
    case "glowbars": {
      const xi = col(spec.x);
      const yi = col(spec.y);
      const fi = col(spec.extra?.flag);
      const values = result.rows.map((r) => toNum(r[yi]) ?? 0);
      const cut = spikeThreshold(values);
      const lit = result.rows.map((r, i) => (fi >= 0 ? truthy(r[fi]) : values[i] > cut));
      const cats = result.rows.map((r) => shortDate(r[xi]));
      const common = { type: "column" as const, grouping: false, borderRadius: PILL, pointPadding: 0.24, groupPadding: 0, maxPointWidth: 9 };
      return {
        ...base,
        chart: { height, spacing: [4, 0, 0, 0] },
        legend: { enabled: false },
        xAxis: { categories: cats, labels: { enabled: false }, gridLineWidth: 0 },
        yAxis: { gridLineWidth: 0, labels: { enabled: false }, min: 0, endOnTick: false, maxPadding: 0.02 },
        tooltip: { valueSuffix, headerFormat: '<span style="font-size:11px;color:#A3A3AD">{point.key}</span><br/>', pointFormat: `<b>{point.y:,.0f}</b> ${pretty(spec.y)}` },
        series: [
          { ...common, name: pretty(spec.y), color: vertical([[0, hexA(NEON_DIM, 1)], [0.55, hexA(NEON_DIM, 0.7)], [1, hexA(NEON_DIM, 0)]]), data: values.map((v, i) => (lit[i] ? null : v)) },
          { ...common, name: `${pretty(spec.y)} · highlighted`, color: vertical([[0, NEON], [0.6, hexA(NEON, 0.95)], [1, hexA(NEON, 0.35)]]), shadow: glow(NEON, 16, 0.55), data: values.map((v, i) => (lit[i] ? v : null)) },
        ] as Series[],
      };
    }

    // Cyan → violet pills with vertical separators, gold line with hollow white markers.
    case "pillcombo": {
      const xi = col(spec.x);
      const yi = col(spec.y);
      const li = col(spec.extra?.line);
      const cats = result.rows.map((r) => shortDate(r[xi]));
      return {
        ...base,
        chart: { height, spacing: [6, 0, 4, 0] },
        legend: { enabled: false },
        xAxis: { categories: cats, gridLineWidth: 1, gridLineColor: "rgba(255,255,255,0.1)", labels: BOLD_MONO },
        yAxis: { gridLineWidth: 0, labels: { enabled: false }, min: 0, maxPadding: 0.08 },
        tooltip: { shared: true, valueSuffix },
        series: [
          { type: "column", name: pretty(spec.y), borderRadius: PILL, pointPadding: 0.27, groupPadding: 0, maxPointWidth: 34, color: PILL_FILL, data: result.rows.map((r) => toNum(r[yi])) },
          ...(li >= 0
            ? [
                {
                  type: "spline",
                  name: pretty(spec.extra!.line!),
                  color: GOLD,
                  lineWidth: 2,
                  shadow: glow(GOLD, 6, 0.25),
                  marker: { enabled: true, symbol: "circle", radius: 5.5, fillColor: SURFACE, lineColor: "#FFFFFF", lineWidth: 2 },
                  data: result.rows.map((r) => toNum(r[li])),
                },
              ]
            : []),
        ] as Series[],
      };
    }

    // Floating pills: bright mint (middle 50%) beside dim teal (middle 80%).
    case "candles": {
      const xi = col(spec.x);
      const lo = col(spec.extra?.low);
      const hi = col(spec.extra?.high);
      const lo2 = col(spec.extra?.low2);
      const hi2 = col(spec.extra?.high2);
      const mid = col(spec.extra?.mid);
      const li = col(spec.extra?.label);
      const cats = result.rows.map((r) => label(r[xi]));
      const tip = (r: Cell[]) => ({ when: li >= 0 ? `Week of ${shortDate(r[li])}` : label(r[xi]), mid: mid >= 0 ? toNum(r[mid]) : null });
      const common = { type: "columnrange" as const, borderRadius: PILL, pointPadding: 0.06, groupPadding: 0.2, maxPointWidth: 16 };
      return {
        ...base,
        chart: { height, spacing: [6, 0, 4, 0] },
        legend: { enabled: false },
        xAxis: { categories: cats, labels: BOLD_MONO },
        yAxis: { gridLineWidth: 0, labels: { enabled: false }, maxPadding: 0.05, minPadding: 0.05 },
        tooltip: {
          formatter() {
            const p = this as unknown as { series: { name: string }; point: { low: number; high: number; custom: { when: string; mid: number | null } } };
            return `<span style="font-size:11px;color:${INK.secondary}">${p.point.custom.when}</span><br/>${p.series.name}: <b>${formatNumber(p.point.low)} – ${formatNumber(p.point.high)}</b>${p.point.custom.mid !== null ? `<br/>median: <b>${formatNumber(p.point.custom.mid)}</b>` : ""}`;
          },
        },
        series: [
          { ...common, name: "middle 50%", color: vertical([[0, "#7DFFD0"], [0.5, MINT], [1, hexA(MINT, 0.75)]]), shadow: glow(MINT, 14, 0.45), data: result.rows.map((r) => ({ low: toNum(r[lo]), high: toNum(r[hi]), custom: tip(r) })) },
          ...(lo2 >= 0 && hi2 >= 0
            ? [{ ...common, name: "middle 80%", color: vertical([[0, hexA(TEAL_DIM, 0.95)], [1, hexA(TEAL_DIM, 0.55)]]), data: result.rows.map((r) => ({ low: toNum(r[lo2]), high: toNum(r[hi2]), custom: tip(r) })) }]
            : []),
        ] as Series[],
      };
    }

    case "radar":
      return radarOptions(spec, result, base, height, compact, col);

    // Glossy spheres in a gridded 3D box.
    case "bubble3d": {
      const li = col(spec.group);
      const xi = col(spec.x);
      const yi = col(spec.y);
      const zi = col(spec.extra?.z);
      const si = col(spec.extra?.size ?? spec.x);
      const sizes = result.rows.map((r) => toNum(r[si]) ?? 0);
      const maxSize = Math.max(1, ...sizes);
      const data = result.rows.map((r, i) => ({
        x: toNum(r[xi]),
        y: toNum(r[yi]),
        z: zi >= 0 ? toNum(r[zi]) : 0,
        name: li >= 0 ? label(r[li]) : `#${i + 1}`,
        marker: { radius: 11 + Math.sqrt(sizes[i] / maxSize) * 27, fillColor: sphere(SERIES_GLOW[i % SERIES_GLOW.length]), lineWidth: 0 },
      }));
      return {
        ...base,
        chart: { ...box3d(height, 12, 34, 260), type: "scatter3d" },
        legend: { enabled: false },
        xAxis: { ...range(data.map((d) => d.x)), gridLineWidth: 1, gridLineColor: INK.grid, title: { text: undefined }, labels: axisLabel() },
        yAxis: { ...range(data.map((d) => d.y)), gridLineWidth: 1, gridLineColor: INK.grid, labels: axisLabel() },
        zAxis: { ...range(data.map((d) => d.z)), gridLineWidth: 1, gridLineColor: INK.grid, labels: axisLabel() },
        tooltip: {
          formatter() {
            const p = this as unknown as { point: { name: string; x: number; y: number; z: number } };
            return `<b>${p.point.name}</b><br/>${pretty(spec.x)}: <b>${formatNumber(p.point.x)}</b><br/>${pretty(spec.y)}: <b>${formatNumber(p.point.y)}</b>${spec.extra?.z ? `<br/>${pretty(spec.extra.z)}: <b>${formatNumber(p.point.z)}</b>` : ""}`;
          },
        },
        series: [{ type: "scatter3d", name: pretty(spec.y), data }] as Series[],
      };
    }

    // Glowing green lollipops: a head on a thin stem rising from the floor.
    case "lollipop3d": {
      const xi = col(spec.x);
      const yi = col(spec.y);
      const zi = col(spec.extra?.z);
      const li = col(spec.extra?.label);
      const pts = result.rows.map((r) => ({ x: toNum(r[xi]) ?? 0, y: toNum(r[yi]) ?? 0, z: zi >= 0 ? (toNum(r[zi]) ?? 0) : 0, name: li >= 0 ? shortDate(r[li]) : label(r[xi]) }));
      const stems = pts.map((p) => ({
        type: "scatter3d",
        lineWidth: 1.5,
        color: hexA(NEON, 0.6),
        enableMouseTracking: false,
        marker: { enabled: false },
        showInLegend: false,
        data: [
          { x: p.x, y: 0, z: p.z },
          { x: p.x, y: p.y, z: p.z },
        ],
      }));
      return {
        ...base,
        chart: { ...box3d(height, 12, 34, 240), type: "scatter3d" },
        legend: { enabled: false },
        xAxis: { ...range(pts.map((p) => p.x), 0.15), gridLineWidth: 1, gridLineColor: INK.grid, labels: axisLabel(), allowDecimals: false },
        yAxis: { min: 0, gridLineWidth: 1, gridLineColor: INK.grid, labels: axisLabel() },
        zAxis: { ...range(pts.map((p) => p.z), 0.15), gridLineWidth: 1, gridLineColor: INK.grid, labels: axisLabel(), allowDecimals: false },
        tooltip: {
          formatter() {
            const p = this as unknown as { point: { name: string; y: number } };
            return `<b>${p.point.name}</b><br/><b>${formatNumber(p.point.y)}</b> ${pretty(spec.y)}`;
          },
        },
        series: [...stems, { type: "scatter3d", name: pretty(spec.y), data: pts.map((p) => ({ ...p, marker: { radius: 7.5, fillColor: sphere(NEON), lineWidth: 0 } })) }] as Series[],
      };
    }

    // Layered 3D waves, front violet through to back green.
    case "ridge3d": {
      const xi = col(spec.x);
      const yi = col(spec.y);
      const gi = col(spec.group);
      const groups = [...new Set(result.rows.map((r) => label(r[gi])))];
      const n = groups.length;
      const xs = result.rows.map((r) => toNum(r[xi]) ?? 0);
      // Log-binned values (e.g. revenue) need a log axis to spread out.
      const logX = xs.every((v) => v > 0) && Math.max(...xs) / Math.min(...xs) > 50;
      const series = groups.map((g, i) => {
        const rows = result.rows.filter((r) => label(r[gi]) === g).sort((a, b) => (toNum(a[xi]) ?? 0) - (toNum(b[xi]) ?? 0));
        const color = WAVE[Math.round((i / Math.max(1, n - 1)) * (WAVE.length - 1))];
        return {
          type: "area",
          name: g,
          color,
          lineColor: color,
          lineWidth: 2,
          fillColor: vertical([[0, hexA(color, 0.9)], [0.55, hexA(color, 0.45)], [1, "rgba(0,0,0,0.9)"]]),
          marker: { enabled: false },
          data: rows.map((r, j) => {
            const near = [rows[j - 1], r, rows[j + 1]].filter(Boolean).map((x) => toNum(x[yi]) ?? 0);
            return [toNum(r[xi]), Math.round((near.reduce((a, b) => a + b, 0) / near.length) * 10) / 10];
          }),
        };
      });
      return {
        ...base,
        chart: { ...box3d(height, 14, 28, Math.max(160, n * 26)), type: "area" },
        legend: { enabled: false },
        // `depth` spaces the layers along z (supported by the 3D module, missing from its types).
        plotOptions: { area: { depth: 18, states: { inactive: { enabled: false } } } as unknown as HighchartsNS.PlotAreaOptions },
        xAxis: { type: logX ? "logarithmic" : "linear", gridLineWidth: 1, gridLineColor: INK.grid, labels: axisLabel() },
        yAxis: { min: 0, max: Math.max(1, ...result.rows.map((r) => toNum(r[yi]) ?? 0)) * 1.08, endOnTick: false, gridLineWidth: 1, gridLineColor: INK.grid, labels: axisLabel() },
        zAxis: { min: 0, max: n - 1, labels: { enabled: false }, gridLineWidth: 0 },
        tooltip: { headerFormat: "", pointFormat: `<b>{series.name}</b><br/>${pretty(spec.x)} {point.x}: <b>{point.y:,.0f}</b> ${pretty(spec.y)}` },
        series: series as Series[],
      };
    }

    // 2D ridgeline (kept for the agent and small cards).
    case "ridgeline": {
      const xi = col(spec.x);
      const yi = col(spec.y);
      const gi = col(spec.group);
      const totals = new Map<string, number>();
      for (const r of result.rows) totals.set(label(r[gi]), (totals.get(label(r[gi])) ?? 0) + (toNum(r[yi]) ?? 0));
      const groups = [...totals.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([g]) => g);
      const n = groups.length;
      const overlap = 1.6;
      const step = 100 / (n - 1 + overlap);
      return {
        ...base,
        chart: { height, marginLeft: 130 },
        legend: { enabled: false },
        xAxis: { gridLineWidth: 1, gridLineColor: INK.grid, labels: axisLabel() },
        yAxis: groups.map((g, i) => ({ top: `${i * step}%`, height: `${overlap * step}%`, offset: 0, min: 0, max: 1, gridLineWidth: 0, tickPositions: [0], title: { text: undefined }, labels: { formatter: () => g, align: "right" as const, x: -8, y: 4, style: { color: INK.secondary, fontSize: "10.5px" } } })),
        series: groups.map((g, i) => {
          const rows = result.rows.filter((r) => label(r[gi]) === g).sort((a, b) => (toNum(a[xi]) ?? 0) - (toNum(b[xi]) ?? 0));
          const max = Math.max(1, ...rows.map((r) => toNum(r[yi]) ?? 0));
          const color = WAVE[Math.round((i / Math.max(1, n - 1)) * (WAVE.length - 1))];
          return { type: "areaspline", name: g, yAxis: i, zIndex: i, color, lineWidth: 2, fillColor: vertical([[0, hexA(color, 0.45)], [0.7, "rgba(0,0,0,0.9)"], [1, "rgba(0,0,0,0.96)"]]), shadow: glow(color, 10, 0.45), data: rows.map((r) => [toNum(r[xi]), (toNum(r[yi]) ?? 0) / max]) };
        }) as Series[],
      };
    }

    // Lines: glowing splines over vertical rules, hollow white marker on each series' latest point.
    case "area":
    case "line": {
      const { xi, yi, gi, groups } = pivot(result, spec.x, spec.y, spec.group, 6);
      const isTime = result.rows.length > 0 && result.rows.every((r) => r[xi] === null || !Number.isNaN(toTime(r[xi])));
      const cats = isTime ? [] : [...new Set(result.rows.map((r) => label(r[xi])))];
      const single = groups.length === 1;
      const series = groups.map((g, i) => {
        const rows = result.rows.filter((r) => (gi >= 0 ? label(r[gi]) === g : true));
        const data = rows
          .map((r) => (isTime ? [toTime(r[xi]), toNum(r[yi])] : [cats.indexOf(label(r[xi])), toNum(r[yi])]))
          .sort((a, b) => (a[0] as number) - (b[0] as number))
          .map((p, j, arr) => ({ x: p[0] as number, y: p[1] as number | null, marker: j === arr.length - 1 ? { enabled: true } : undefined }));
        const color = single ? (spec.type === "area" ? NEON : GOLD) : SERIES_GLOW[i % SERIES_GLOW.length];
        return {
          type: spec.type === "area" ? "areaspline" : "spline",
          name: gi >= 0 ? g : pretty(spec.y),
          data,
          color,
          lineWidth: single ? 2.4 : 2,
          fillColor: spec.type === "area" ? vertical([[0, hexA(color, single ? 0.3 : 0.1)], [1, hexA(color, 0)]]) : undefined,
          shadow: glow(color, single ? 12 : 6, single ? 0.45 : 0.3),
          marker: { enabled: false, symbol: "circle", radius: 5, fillColor: SURFACE, lineColor: "#FFFFFF", lineWidth: 2 },
        } as Series;
      });
      return {
        ...base,
        legend: { enabled: series.length > 1 },
        xAxis: isTime
          ? { type: "datetime", gridLineWidth: 1, gridLineColor: "rgba(255,255,255,0.07)", crosshair: { color: "rgba(255,255,255,0.25)", dashStyle: "Dash", width: 1 }, labels: axisLabel() }
          : { categories: cats, gridLineWidth: 1, gridLineColor: "rgba(255,255,255,0.07)", crosshair: { color: "rgba(255,255,255,0.25)" } },
        yAxis: { min: result.rows.every((r) => (toNum(r[yi]) ?? 0) >= 0) ? 0 : undefined, gridLineWidth: 0 },
        tooltip: { shared: true, valueSuffix, xDateFormat: "%b %e, %Y" },
        series,
      };
    }

    case "bar":
    case "hbar": {
      const { xi, yi, gi, groups } = pivot(result, spec.x, spec.y, spec.group, 5);
      const cats = [...new Set(result.rows.map((r) => label(r[xi])))].slice(0, 20);
      const horiz = isHorizontal(spec, result);
      const single = groups.length === 1;
      const series = groups.map((g, i) => ({
        type: horiz ? "bar" : "column",
        name: gi >= 0 ? g : pretty(spec.y),
        borderRadius: PILL,
        data: cats.map((c) => {
          const row = result.rows.find((r) => label(r[xi]) === c && (gi < 0 || label(r[gi]) === g));
          return row ? toNum(row[yi]) : null;
        }),
        color: single ? (horiz ? horizontal([[0, hexA("#4F46E5", 0.7)], [0.55, "#6D5BFF"], [1, CYAN]]) : PILL_FILL) : SERIES_COLORS[i % SERIES_COLORS.length],
        shadow: single ? glow(horiz ? CYAN : "#6D5BFF", 8, 0.25) : false,
      })) as Series[];
      if (single && horiz) {
        // Pill track behind each bar, like a progress row.
        const max = Math.max(0, ...("data" in series[0] ? (series[0].data as (number | null)[]).map((v) => v ?? 0) : [0]));
        series.unshift({ type: "bar", name: "track", data: cats.map(() => max), borderRadius: PILL, color: "rgba(255,255,255,0.06)", enableMouseTracking: false, showInLegend: false, grouping: false, animation: false } as Series);
      }
      return {
        ...base,
        chart: { height: horiz ? barHeight(cats.length) : height, marginRight: horiz ? 64 : undefined },
        legend: { enabled: groups.length > 1 },
        xAxis: horiz
          ? { categories: cats, gridLineWidth: 0, labels: { style: { color: "#D4D4DA", fontSize: "12.5px" } } }
          : { categories: cats, gridLineWidth: 1, gridLineColor: "rgba(255,255,255,0.1)", labels: cats.every((c) => c.length <= 8) ? BOLD_MONO : { style: { color: "#D4D4DA", fontSize: "11px" } } },
        yAxis: { gridLineWidth: 0, labels: { enabled: false } },
        plotOptions: {
          column: { grouping: groups.length > 1, pointPadding: 0.22, groupPadding: 0.06, maxPointWidth: 34 },
          bar: {
            grouping: groups.length > 1,
            pointPadding: 0.3,
            groupPadding: 0,
            maxPointWidth: 9,
            dataLabels: single
              ? {
                  enabled: true,
                  inside: false,
                  crop: false,
                  overflow: "allow",
                  x: 6,
                  style: { color: INK.primary, textOutline: "none", fontWeight: "600", fontSize: "12.5px", fontFamily: MONO },
                  formatter() {
                    return this.series.name === "track" ? "" : formatNumber(this.y as number) + valueSuffix;
                  },
                }
              : undefined,
          },
        },
        tooltip: { shared: false, valueSuffix },
        series,
      };
    }

    // Heatmap as a glowing dot matrix: one dot per cell, colored on the heat ramp.
    case "heatmap": {
      const xi = col(spec.x);
      const yi = col(spec.y);
      const gi = col(spec.group);
      const xCats = [...new Set(result.rows.map((r) => label(r[xi])))].slice(0, 15);
      const yCats = gi >= 0 ? [...new Set(result.rows.map((r) => label(r[gi])))].slice(0, 12) : [spec.y];
      const data = result.rows
        .map((r) => ({ x: xCats.indexOf(label(r[xi])), y: gi >= 0 ? yCats.indexOf(label(r[gi])) : 0, value: toNum(r[yi]) }))
        .filter((p) => p.x >= 0 && p.y >= 0);
      const h = Math.max(240, 120 + yCats.length * 52);
      const radius = Math.max(9, Math.min(22, (h - 120) / yCats.length / 2 - 4));
      return {
        ...base,
        chart: { height: h, type: "scatter", marginRight: 12 },
        xAxis: { categories: xCats, min: -0.5, max: xCats.length - 0.5, tickPositions: xCats.map((_, i) => i), gridLineWidth: 0, lineWidth: 0, labels: { autoRotation: [-35], style: { color: INK.secondary, fontSize: "10.5px" } } },
        yAxis: { categories: yCats, min: -0.5, max: yCats.length - 0.5, tickPositions: yCats.map((_, i) => i), reversed: true, gridLineWidth: 0, startOnTick: false, endOnTick: false, labels: { style: { color: INK.secondary, fontSize: "10.5px", fontFamily: "inherit" } } },
        colorAxis: { stops: HEAT_STOPS, labels: { style: { color: INK.muted, fontSize: "10px", fontFamily: MONO } }, gridLineWidth: 0 },
        legend: { enabled: true, align: "right", verticalAlign: "top", layout: "horizontal", symbolWidth: 150, symbolHeight: 6, symbolRadius: 3, margin: 10 },
        tooltip: {
          formatter() {
            const p = this as unknown as { point: { x: number; y: number; value: number } };
            return `<span style="color:${INK.secondary}">${xCats[p.point.x]} · ${yCats[p.point.y]}</span><br/><b>${formatNumber(p.point.value)}${valueSuffix}</b> ${pretty(spec.y)}`;
          },
        },
        series: [
          {
            type: "scatter",
            name: spec.y,
            colorKey: "value",
            showInLegend: false,
            data,
            shadow: glow("#7B5CFF", 10, 0.22),
            marker: { symbol: "circle", radius, lineWidth: 0, states: { hover: { radiusPlus: 2, lineWidth: 2, lineColor: "#ffffff" } } },
            dataLabels: {
              enabled: xCats.length * yCats.length <= 80,
              inside: true,
              verticalAlign: "middle",
              y: 0,
              style: { textOutline: "none", fontWeight: "600", fontSize: "10px", color: "contrast", fontFamily: MONO },
              formatter() {
                return formatNumber((this as unknown as { point: { value: number } }).point.value);
              },
            },
          },
        ] as unknown as Series[],
      };
    }

    // Donut as a thick rounded ring with the total in the middle.
    default: {
      const xi = col(spec.x);
      const yi = col(spec.y);
      const sorted = [...result.rows].sort((a, b) => (toNum(b[yi]) ?? 0) - (toNum(a[yi]) ?? 0));
      const top = sorted.slice(0, 5);
      const rest = sorted.slice(5).reduce((s, r) => s + (toNum(r[yi]) ?? 0), 0);
      const data = top.map((r, i) => ({ name: label(r[xi]), y: toNum(r[yi]), color: SERIES_GLOW[i] }));
      if (rest > 0) data.push({ name: "Other", y: rest, color: "#4b4b55" });
      const total = data.reduce((s, d) => s + (d.y ?? 0), 0);
      return {
        ...base,
        chart: {
          height,
          events: {
            render() {
              // Total in the ring's center, in the kit's monospace.
              const c = this as unknown as HighchartsNS.Chart & { centerLabel?: HighchartsNS.SVGElement };
              const s = c.series[0] as unknown as { center: number[] };
              const cx = c.plotLeft + s.center[0];
              const cy = c.plotTop + s.center[1];
              c.centerLabel?.destroy();
              c.centerLabel = c.renderer
                .text(`<span style="font-family:${MONO};font-size:22px;font-weight:700;fill:${INK.primary}">${formatNumber(total)}</span>`, cx, cy + 4)
                .attr({ align: "center", zIndex: 5 })
                .css({ color: INK.primary, fontFamily: MONO, fontSize: "22px", fontWeight: "700" })
                .add();
            },
          },
        },
        legend: {
          enabled: true,
          align: "right",
          verticalAlign: "middle",
          layout: "vertical",
          itemMarginBottom: 8,
          useHTML: true,
          labelFormatter() {
            const p = this as unknown as { name: string; y: number };
            return `<span style="display:inline-flex;gap:14px;min-width:130px;justify-content:space-between"><span style="color:${INK.secondary}">${p.name}</span><span style="font-family:${MONO};color:${INK.primary};font-weight:600">${formatNumber(p.y)}</span></span>`;
          },
        },
        tooltip: { pointFormat: `<b>{point.y:,.1f}${valueSuffix}</b> ({point.percentage:.1f}%)` },
        series: [{ type: "pie", name: spec.y, innerSize: "76%", size: "92%", center: ["28%", "50%"], borderRadius: 8, data, showInLegend: true, dataLabels: { enabled: false } }] as Series[],
      };
    }
  }
}

/**
 * Radars: a straight polygon (comparison), a rounded star, flower petals, or a
 * wavy ring for long periodic series. Shapes are drawn on a numeric polar axis
 * so in-between control points can shape the outline.
 */
function radarOptions(spec: ChartSpec, result: QueryResult, base: Options, height: number, compact: boolean, col: (n?: string | null) => number): Options {
  const shape = spec.extra?.shape ?? "polygon";
  const xi = col(spec.x);
  const yi = col(spec.y);
  const ci = col(spec.extra?.compare);
  const cats = result.rows.map((r) => label(r[xi]));
  const cur = result.rows.map((r) => toNum(r[yi]) ?? 0);
  const prev = ci >= 0 ? result.rows.map((r) => toNum(r[ci]) ?? 0) : null;
  const n = cats.length;
  const maxV = Math.max(1, ...cur, ...(prev ?? []));

  const style = (color: string) => ({
    color,
    lineWidth: compact ? 2 : 2.6,
    fillColor: { radialGradient: { cx: 0.5, cy: 0.5, r: 0.65 }, stops: [[0, hexA(color, 0.04)], [1, hexA(color, 0.22)]] as [number, string][] },
    shadow: glow(color, 12, 0.3),
    marker: { enabled: false },
    states: { inactive: { opacity: 1 } },
  });

  // Stars and petals extend from a common base radius so the silhouette stays legible when
  // values differ a lot; ordering is preserved and the exact values sit in the labels.
  const reach = (v: number) => maxV * 0.38 + v * 0.62;
  // Turn n values into the outline's control points on x ∈ [0, n).
  const outline = (vals: number[]): [number, number][] => {
    if (shape === "polygon") return vals.map((v, i) => [i, v]);
    if (shape === "wave") return vals.map((v, i) => [i, maxV * 2.2 + v * 0.55]);
    if (shape === "star") {
      const pts: [number, number][] = [];
      vals.forEach((v, i) => pts.push([i, reach(v)], [i + 0.5, maxV * 0.3]));
      return pts;
    }
    // petal: a broad lobe per category that pinches back to the center between categories
    const pts: [number, number][] = [];
    vals.forEach((v, i) => pts.push([i - 0.2, reach(v) * 0.66], [i, reach(v)], [i + 0.2, reach(v) * 0.66], [i + 0.5, maxV * 0.04]));
    return pts.map(([x, y]) => [(x + n) % n, y] as [number, number]).sort((a, b) => a[0] - b[0]);
  };

  const type = shape === "polygon" ? "area" : "areaspline";
  const yMax = shape === "wave" ? maxV * 2.95 : maxV * 1.04;
  const showLabels = !compact && shape !== "wave";
  const valueLabel = (i: number) =>
    prev
      ? `<span style="color:${COMPARE.current}">${formatNumber(cur[i])}</span><span style="color:${INK.muted}">/</span><span style="color:${COMPARE.previous}">${formatNumber(prev[i])}</span>`
      : `<span style="color:${INK.primary}">${formatNumber(cur[i])}</span>`;

  return {
    ...base,
    chart: { polar: true, height, spacing: compact ? [0, 0, 0, 0] : [10, 8, 10, 8], margin: compact ? [4, 4, 4, 4] : undefined },
    legend: { enabled: false },
    pane: { size: compact ? "100%" : "74%", startAngle: 0 },
    xAxis: {
      min: 0,
      max: n,
      tickInterval: 1,
      lineWidth: 0,
      gridLineColor: compact ? "rgba(255,255,255,0.06)" : "rgba(255,255,255,0.09)",
      gridLineWidth: shape === "wave" ? 0 : 1,
      labels: showLabels
        ? {
            useHTML: true,
            distance: 16,
            formatter() {
              const i = Math.round(this.value as number);
              if (i >= n) return "";
              return `<div style="text-align:center;line-height:1.25"><div style="font-family:${MONO};font-size:11.5px;font-weight:700">${valueLabel(i)}</div><div style="color:${INK.muted};font-size:10px;max-width:92px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${cats[i] ?? ""}</div></div>`;
            },
          }
        : { enabled: false },
    },
    yAxis: {
      gridLineInterpolation: shape === "polygon" ? "polygon" : "circle",
      gridLineColor: compact ? "rgba(255,255,255,0.05)" : "rgba(255,255,255,0.07)",
      lineWidth: 0,
      min: 0,
      max: yMax,
      endOnTick: false,
      tickAmount: shape === "wave" ? 2 : 4,
      labels: { enabled: false },
    },
    tooltip: {
      enabled: !compact,
      formatter() {
        const p = this as unknown as { x: number };
        const i = ((Math.round(p.x) % n) + n) % n;
        return `<b>${cats[i]}</b><br/><span style="color:${COMPARE.current}">●</span> ${pretty(spec.y)}: <b>${formatNumber(cur[i])}</b>${prev ? `<br/><span style="color:${COMPARE.previous}">●</span> ${pretty(spec.extra!.compare!)}: <b>${formatNumber(prev[i])}</b>` : ""}`;
      },
    },
    plotOptions: { series: { pointPlacement: "on" } },
    series: [
      ...(prev ? [{ type, name: pretty(spec.extra!.compare!), data: outline(prev), ...style(COMPARE.previous) }] : []),
      { type, name: pretty(spec.y), data: outline(cur), ...style(COMPARE.current) },
    ] as Series[],
  };
}

/** Drag to rotate a 3D chart. Returns a cleanup function. */
export function enableRotation(chart: HighchartsNS.Chart) {
  const el = chart.container;
  const onDown = (e: PointerEvent) => {
    const o3d = chart.options.chart?.options3d;
    if (!o3d) return;
    const start = { x: e.clientX, y: e.clientY, alpha: o3d.alpha ?? 0, beta: o3d.beta ?? 0 };
    const move = (ev: PointerEvent) => {
      chart.update({ chart: { options3d: { alpha: Math.max(-10, Math.min(60, start.alpha + (ev.clientY - start.y) / 5)), beta: start.beta + (start.x - ev.clientX) / 5 } } }, true, false, false);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  el.addEventListener("pointerdown", onDown);
  return () => el.removeEventListener("pointerdown", onDown);
}

export const is3d = (t: ChartSpec["type"]) => t === "bubble3d" || t === "lollipop3d" || t === "ridge3d";
