"use client";

/**
 * Hand-drawn SVG radars that replicate the Hyper Charts reference shapes:
 *  - star:    a rounded n-point star (smooth tips and valleys) on circular rings
 *  - petal:   overlapping teardrop petals, each growing from the center
 *  - polygon: soft-cornered polygons for current vs prior comparisons
 *  - wave:    smooth wavy rings tracing a periodic series (e.g. 30 days)
 * Violet strokes with a lavender inner glow, an orange second series, fine
 * rings and spokes, monospace "current/prior" labels and the center glyph.
 * Shapes are data-driven; exact values are always in the labels and tooltips.
 */
import { useId } from "react";
import { formatNumber } from "@/lib/client/charts";
import type { ChartSpec, QueryResult } from "@/lib/types";

const VIOLET = "#7B5CFF";
const ORANGE = "#F26A21";
const MONO = "var(--font-mono-face), ui-monospace, Menlo, monospace";

type Pt = [number, number];

/** Closed Catmull-Rom spline through points, as cubic Béziers. */
function smoothClosed(points: Pt[], tension = 1) {
  const n = points.length;
  if (n < 3) return "";
  let d = `M${points[0][0].toFixed(1)},${points[0][1].toFixed(1)}`;
  for (let i = 0; i < n; i++) {
    const p0 = points[(i - 1 + n) % n];
    const p1 = points[i];
    const p2 = points[(i + 1) % n];
    const p3 = points[(i + 2) % n];
    const c1: Pt = [p1[0] + ((p2[0] - p0[0]) / 6) * tension, p1[1] + ((p2[1] - p0[1]) / 6) * tension];
    const c2: Pt = [p2[0] - ((p3[0] - p1[0]) / 6) * tension, p2[1] - ((p3[1] - p1[1]) / 6) * tension];
    d += ` C${c1[0].toFixed(1)},${c1[1].toFixed(1)} ${c2[0].toFixed(1)},${c2[1].toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
  }
  return `${d} Z`;
}

/** Polygon with softly rounded corners. */
function roundedPolygon(points: Pt[], radius: number) {
  const n = points.length;
  let d = "";
  for (let i = 0; i < n; i++) {
    const a = points[(i - 1 + n) % n];
    const v = points[i];
    const b = points[(i + 1) % n];
    const la = Math.hypot(a[0] - v[0], a[1] - v[1]);
    const lb = Math.hypot(b[0] - v[0], b[1] - v[1]);
    const r = Math.min(radius, la / 2, lb / 2);
    const p1: Pt = [v[0] + ((a[0] - v[0]) / la) * r, v[1] + ((a[1] - v[1]) / la) * r];
    const p2: Pt = [v[0] + ((b[0] - v[0]) / lb) * r, v[1] + ((b[1] - v[1]) / lb) * r];
    d += `${i === 0 ? "M" : "L"}${p1[0].toFixed(1)},${p1[1].toFixed(1)} Q${v[0].toFixed(1)},${v[1].toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)} `;
  }
  return `${d}Z`;
}

const polar = (cx: number, cy: number, r: number, a: number): Pt => [cx + r * Math.cos(a), cy + r * Math.sin(a)];
const angleOf = (i: number, n: number) => -Math.PI / 2 + (i * 2 * Math.PI) / n;

/** One teardrop petal along angle `c`, length `len`, half-width `w` (radians), with a slight pinwheel twist. */
function petalPath(cx: number, cy: number, c: number, len: number, w: number, twist = 0.2) {
  const pts: Pt[] = [];
  const steps = 56;
  for (let k = 0; k <= steps; k++) {
    const t = k / steps;
    const th = c + w * (2 * t - 1) + twist * Math.sin(Math.PI * t);
    const r = len * Math.pow(Math.cos((Math.PI / 2) * (2 * t - 1)), 0.85);
    pts.push(polar(cx, cy, r, th));
  }
  return `M${pts.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" L")} Z`;
}

function useSeries(spec: ChartSpec, result: QueryResult) {
  const col = (name?: string | null) => (name ? result.columns.indexOf(name) : -1);
  const xi = col(spec.x);
  const yi = col(spec.y);
  const ci = col(spec.extra?.compare);
  const labels = result.rows.map((r) => (r[xi] === null ? "(blank)" : String(r[xi])));
  const num = (v: unknown) => (typeof v === "number" ? v : Number(v) || 0);
  const cur = result.rows.map((r) => num(r[yi]));
  const prev = ci >= 0 ? result.rows.map((r) => num(r[ci])) : null;
  return { labels, cur, prev };
}

export function RadarArt({ spec, result, height, compact }: { spec: ChartSpec; result: QueryResult; height?: number; compact?: boolean }) {
  const uid = useId().replace(/:/g, "");
  const shape = spec.extra?.shape ?? "polygon";
  const { labels, cur, prev } = useSeries(spec, result);
  const n = cur.length;
  if (n < 3) return <div className="grid h-32 place-items-center text-[12px] text-ink-3">Not enough categories for a radar.</div>;

  const W = compact ? 220 : 480;
  const H = compact ? 220 : 400;
  const cx = W / 2;
  const cy = H / 2;
  const R = compact ? 92 : 132;
  const max = Math.max(1e-9, ...cur, ...(prev ?? []));
  const showLabels = !compact && shape !== "wave";
  const ringsAsPolygon = shape === "polygon" || shape === "petal";
  const glyph = shape === "star" || shape === "polygon";

  // ---- grid ----
  const rings = [0.34, 0.67, 1].map((f) =>
    ringsAsPolygon ? roundedPolygon(Array.from({ length: n }, (_, i) => polar(cx, cy, R * f, angleOf(i, n))), 4) : null,
  );

  // ---- shapes ----
  // Stars and petals extend from a common base so their silhouettes stay legible; polygons use
  // square-root radii so area tracks value and one large category doesn't become a spike.
  const reach = (v: number) => R * (0.36 + 0.64 * (v / max));
  const tipReach = (v: number) => R * (0.52 + 0.48 * (v / max));
  type Shape = { d: string; color: string; key: string };
  const shapes: Shape[] = [];
  const outline = (vals: number[], color: string, key: string, inner = false) => {
    if (shape === "star") {
      // Each point gets two shoulders so tips are broad and rounded, like a cookie-cutter star.
      const pts: Pt[] = [];
      vals.forEach((v, i) => {
        const t = tipReach(v);
        const tNext = tipReach(vals[(i + 1) % vals.length]);
        pts.push(polar(cx, cy, t * 0.8, angleOf(i - 0.15, n)));
        pts.push(polar(cx, cy, t, angleOf(i, n)));
        pts.push(polar(cx, cy, t * 0.8, angleOf(i + 0.15, n)));
        pts.push(polar(cx, cy, ((t + tNext) / 2) * 0.58, angleOf(i + 0.5, n)));
      });
      shapes.push({ d: smoothClosed(pts, 1), color, key });
    } else if (shape === "petal") {
      const w = (Math.PI / n) * 1.5;
      vals.forEach((v, i) => shapes.push({ d: petalPath(cx, cy, angleOf(i, n), reach(v), w), color, key: `${key}-${i}` }));
    } else if (shape === "wave") {
      // A wide ring whose ripple traces each point's deviation from the series mean.
      const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
      const spread = Math.max(1e-9, ...vals.map((v) => Math.abs(v - mean)));
      // The prior period sits on a slightly smaller ring so both ripples stay visible.
      const base = inner ? 0.68 : 0.8;
      const pts = vals.map((v, i) => polar(cx, cy, R * (base + 0.15 * ((v - mean) / spread)), angleOf(i, vals.length)));
      shapes.push({ d: smoothClosed(pts, 1), color, key });
    } else {
      const pts = vals.map((v, i) => polar(cx, cy, Math.max(R * 0.2, R * Math.sqrt(v / max)), angleOf(i, n)));
      shapes.push({ d: roundedPolygon(pts, compact ? 7 : 12), color, key });
    }
  };
  if (prev) outline(prev, ORANGE, "prev", true);
  outline(cur, VIOLET, "cur");

  const tip = (i: number) => `${labels[i]}: ${formatNumber(cur[i])}${prev ? ` (prior ${formatNumber(prev[i])})` : ""}`;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={height ?? H} role="img" aria-label={`${spec.title}. ${spec.caption}`} style={{ overflow: "visible" }}>
      <defs>
        {[VIOLET, ORANGE].map((c) => (
          <radialGradient key={c} id={`${uid}-fill-${c.slice(1)}`} cx="50%" cy="50%" r="55%">
            <stop offset="0" stopColor={c} stopOpacity="0.03" />
            <stop offset="0.65" stopColor={c} stopOpacity="0.12" />
            <stop offset="1" stopColor={c} stopOpacity="0.34" />
          </radialGradient>
        ))}
        <filter id={`${uid}-glow`} x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation={compact ? 4 : 7} />
        </filter>
        <radialGradient id={`${uid}-halo`} cx="50%" cy="50%" r="50%">
          <stop offset="0" stopColor={VIOLET} stopOpacity="0.28" />
          <stop offset="1" stopColor={VIOLET} stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* soft halo */}
      <circle cx={cx} cy={cy} r={R * 1.15} fill={`url(#${uid}-halo)`} />

      {/* grid */}
      <g stroke="rgba(255,255,255,0.09)" fill="none" strokeWidth={1}>
        {rings.map((d, i) => (d ? <path key={i} d={d} /> : <circle key={i} cx={cx} cy={cy} r={R * [0.34, 0.67, 1][i]} />))}
        {Array.from({ length: shape === "wave" ? 0 : n }, (_, i) => {
          const [x, y] = polar(cx, cy, R, angleOf(i, n));
          return <line key={i} x1={cx} y1={cy} x2={x} y2={y} />;
        })}
      </g>

      {/* shapes: blurred glow under a crisp stroke and a lavender fill */}
      <g className="radar-in" style={{ transformOrigin: `${cx}px ${cy}px` }}>
        {shapes.map((s) => (
          <g key={s.key}>
            <path d={s.d} fill="none" stroke={s.color} strokeWidth={compact ? 5 : 8} strokeOpacity={0.45} filter={`url(#${uid}-glow)`} />
            <path d={s.d} fill={`url(#${uid}-fill-${s.color.slice(1)})`} stroke={s.color} strokeWidth={compact ? 2.2 : 2.8} strokeLinejoin="round" />
          </g>
        ))}
      </g>

      {/* center glyph */}
      {glyph && (
        <g>
          <circle cx={cx} cy={cy} r={compact ? 13 : 22} fill="#000" stroke="rgba(255,255,255,0.18)" />
          <g transform={`translate(${cx - (compact ? 7 : 11)} ${cy - (compact ? 7 : 11)}) scale(${compact ? 0.58 : 0.92})`} fill="none" stroke="#e7e7ee" strokeWidth={1.7} strokeLinejoin="round">
            <path d="M12 2 21 12 12 22 3 12Z" />
            <path d="M3 12h18M12 2l-3.5 10L12 22l3.5-10Z" />
          </g>
        </g>
      )}

      {/* labels: "current/prior" in each series' color, category beneath */}
      {showLabels &&
        labels.map((name, i) => {
          const a = angleOf(i, n);
          const [x, y] = polar(cx, cy, R + 30, a);
          const anchor = Math.abs(Math.cos(a)) < 0.25 ? "middle" : Math.cos(a) > 0 ? "start" : "end";
          const dy = Math.sin(a) < -0.6 ? -8 : Math.sin(a) > 0.6 ? 10 : 0;
          return (
            <g key={name} fontFamily={MONO}>
              <text x={x} y={y + dy} textAnchor={anchor} fontSize={12.5} fontWeight={700}>
                <tspan fill={prev ? VIOLET : "#d9d9e0"}>{formatNumber(cur[i])}</tspan>
                {prev && <tspan fill="#5c5c66">/</tspan>}
                {prev && <tspan fill={ORANGE}>{formatNumber(prev[i])}</tspan>}
              </text>
              <text x={x} y={y + dy + 14} textAnchor={anchor} fontSize={10} fill="#6c6c78" fontFamily="var(--font-sans), sans-serif">
                {name.length > 18 ? `${name.slice(0, 17)}…` : name}
              </text>
            </g>
          );
        })}

      {/* hover targets with tooltips */}
      {!compact &&
        Array.from({ length: shape === "wave" ? 0 : n }, (_, i) => {
          const a0 = angleOf(i - 0.5, n);
          const a1 = angleOf(i + 0.5, n);
          const [x0, y0] = polar(cx, cy, R * 1.12, a0);
          const [x1, y1] = polar(cx, cy, R * 1.12, a1);
          return (
            <path key={i} d={`M${cx},${cy} L${x0},${y0} A${R * 1.12},${R * 1.12} 0 0 1 ${x1},${y1} Z`} fill="transparent" className="radar-hit">
              <title>{tip(i)}</title>
            </path>
          );
        })}
    </svg>
  );
}
