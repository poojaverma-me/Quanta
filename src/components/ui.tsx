"use client";

import { AlertTriangle, ArrowDownRight, ArrowUpRight, Check, Copy, Minus } from "lucide-react";
import { type ReactNode, useState } from "react";
import { formatNumber } from "@/lib/client/charts";
import type { Cell, QueryResult } from "@/lib/types";

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(" ");
}

export function Card({
  title,
  icon,
  sub,
  actions,
  children,
  className,
  bodyClassName,
}: {
  title?: ReactNode;
  icon?: ReactNode;
  sub?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={cx("card fade-up", className)}>
      {(title || actions) && (
        <header className="flex items-center gap-3 px-5 pt-5 pb-3">
          {icon && <span className="icon-chip">{icon}</span>}
          <div className="flex min-w-0 flex-1 items-center gap-3">
            {title && <h2 className="line-clamp-2 text-[15px] font-medium leading-snug text-ink">{title}</h2>}
            {sub && (
              <>
                <span className="h-4 w-px bg-white/15" aria-hidden />
                <span className="shrink-0 truncate text-[13px] text-ink-3">{sub}</span>
              </>
            )}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-1.5">{actions}</div>}
        </header>
      )}
      <div className={cx("px-5 pb-5", !title && !actions && "pt-5", bodyClassName)}>{children}</div>
    </section>
  );
}

export function IconButton({ label, onClick, children, active }: { label: string; onClick?: () => void; children: ReactNode; active?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      aria-pressed={active}
      className={cx("grid h-8 w-8 place-items-center rounded-full border transition-colors", active ? "border-accent/40 bg-accent/10 text-accent" : "border-transparent text-ink-3 hover:border-line hover:bg-white/5 hover:text-ink")}
    >
      {children}
    </button>
  );
}

export function Segmented<T extends string>({ value, onChange, items }: { value: T; onChange: (v: T) => void; items: { value: T; label: string; icon?: ReactNode; badge?: ReactNode }[] }) {
  return (
    <nav className="glass flex items-center gap-1 rounded-full p-1" role="tablist">
      {items.map((it) => {
        const active = it.value === value;
        return (
          <button
            key={it.value}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(it.value)}
            className={cx(
              "flex items-center gap-2 rounded-full px-3.5 py-2 text-[13px] font-medium transition-all sm:px-4",
              active ? "bg-white/[0.09] text-ink shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]" : "text-ink-2 hover:text-ink",
            )}
          >
            {it.icon}
            <span className="hidden sm:inline">{it.label}</span>
            {it.badge}
          </button>
        );
      })}
    </nav>
  );
}

const TYPE_STYLE: Record<string, string> = {
  VARCHAR: "text-indigo-300 bg-indigo-400/10 border-indigo-400/20",
  BIGINT: "text-accent bg-accent/10 border-accent/25",
  DOUBLE: "text-orange-300 bg-orange-400/10 border-orange-400/25",
  BOOLEAN: "text-violet-300 bg-violet-400/10 border-violet-400/20",
  DATE: "text-emerald-300 bg-emerald-400/10 border-emerald-400/20",
  TIMESTAMP: "text-emerald-300 bg-emerald-400/10 border-emerald-400/20",
};

export function TypeBadge({ type }: { type: string }) {
  return <span className={cx("mono rounded-md border px-1.5 py-0.5 text-[10.5px] font-medium tracking-wide", TYPE_STYLE[type] ?? "border-line text-ink-2")}>{type}</span>;
}

export function Tag({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "accent" | "heat" | "good" | "bad" | "warn" }) {
  const tones = {
    neutral: "border-line bg-white/[0.03] text-ink-2",
    accent: "border-accent/30 bg-accent/10 text-accent",
    heat: "border-violet-400/30 bg-violet-500/10 text-violet-200",
    good: "border-green-400/25 bg-green-400/10 text-green-300",
    bad: "border-red-400/25 bg-red-400/10 text-red-300",
    warn: "border-yellow-400/25 bg-yellow-400/10 text-yellow-200",
  };
  return <span className={cx("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium", tones[tone])}>{children}</span>;
}

/** Status always ships with an icon and a label, never color alone. */
export function SentimentIcon({ sentiment }: { sentiment: "positive" | "negative" | "neutral" }) {
  if (sentiment === "positive") return <ArrowUpRight className="h-3.5 w-3.5 text-green-300" aria-label="positive" />;
  if (sentiment === "negative") return <ArrowDownRight className="h-3.5 w-3.5 text-red-300" aria-label="negative" />;
  return <Minus className="h-3.5 w-3.5 text-ink-3" aria-label="neutral" />;
}

export function LevelTag({ level, kind }: { level: "high" | "medium" | "low"; kind: "severity" | "impact" }) {
  const tone = kind === "severity" ? ({ high: "bad", medium: "warn", low: "neutral" } as const)[level] : ({ high: "heat", medium: "neutral", low: "neutral" } as const)[level];
  return (
    <Tag tone={tone}>
      {kind === "severity" && level === "high" && <AlertTriangle className="h-3 w-3" />}
      {level} {kind}
    </Tag>
  );
}

const KEYWORDS = new Set("select from where group by order limit with as and or not in is null join left right inner outer on case when then else end desc asc having over partition filter distinct union all between cast interval date timestamp true false".split(" "));

export function SqlBlock({ sql, className }: { sql: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  const parts: ReactNode[] = [];
  let last = 0;
  for (const m of sql.matchAll(/'(?:[^']|'')*'|\b\d+(?:\.\d+)?\b|\b[A-Za-z_][A-Za-z0-9_]*\b/g)) {
    const text = m[0];
    const idx = m.index ?? 0;
    if (idx > last) parts.push(sql.slice(last, idx));
    let color = "";
    if (text.startsWith("'")) color = "text-emerald-300";
    else if (/^\d/.test(text)) color = "text-orange-300";
    else if (KEYWORDS.has(text.toLowerCase())) color = "text-accent";
    else if (/^\s*\(/.test(sql.slice(idx + text.length))) color = "text-fuchsia-300";
    parts.push(color ? <span key={idx} className={color}>{text}</span> : text);
    last = idx + text.length;
  }
  parts.push(sql.slice(last));
  return (
    <div className={cx("group relative", className)}>
      <pre className="mono scroll-thin overflow-x-auto rounded-2xl border border-line bg-black/40 p-3.5 text-[11.5px] leading-relaxed text-ink-2">{parts}</pre>
      <button
        type="button"
        onClick={() => {
          navigator.clipboard?.writeText(sql);
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        }}
        className="absolute right-2 top-2 rounded-lg border border-line bg-surface-3 p-1.5 text-ink-3 opacity-0 transition group-hover:opacity-100 hover:text-ink"
        aria-label="Copy SQL"
      >
        {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      </button>
    </div>
  );
}

function cellText(v: Cell) {
  if (v === null) return <span className="text-ink-3">∅</span>;
  if (typeof v === "number") return formatNumber(v);
  if (typeof v === "boolean") return v ? "true" : "false";
  return v;
}

export function DataTable({ result, maxRows = 50, dense }: { result: QueryResult; maxRows?: number; dense?: boolean }) {
  const rows = result.rows.slice(0, maxRows);
  const numeric = result.columns.map((_, i) => rows.length > 0 && rows.every((r) => r[i] === null || typeof r[i] === "number"));
  return (
    <div className="scroll-thin max-h-[420px] overflow-auto rounded-2xl border border-line">
      <table className="w-full border-collapse text-left text-[12px]">
        <thead className="sticky top-0 z-10 bg-surface-3/95 backdrop-blur">
          <tr>
            {result.columns.map((c, i) => (
              <th key={c + i} className={cx("whitespace-nowrap px-3 py-2 font-medium text-ink-2", numeric[i] && "text-right")}>
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, ri) => (
            <tr key={ri} className="border-t border-line/60 hover:bg-white/[0.025]">
              {r.map((v, ci) => (
                <td key={ci} className={cx("max-w-[280px] truncate whitespace-nowrap px-3 text-ink", dense ? "py-1.5" : "py-2", numeric[ci] && "mono text-right tabular-nums")}>
                  {cellText(v)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {result.rowCount > rows.length && (
        <div className="border-t border-line px-3 py-2 text-[11px] text-ink-3">
          Showing {rows.length} of {result.rowCount.toLocaleString()} rows
        </div>
      )}
    </div>
  );
}

/** Render **bold** and line breaks from model text without a markdown dependency. */
export function RichText({ text, className }: { text: string; className?: string }) {
  const paragraphs = text.split(/\n{2,}/);
  return (
    <div className={cx("space-y-2", className)}>
      {paragraphs.map((p, i) => (
        <p key={i}>
          {p.split(/(\*\*[^*]+\*\*)/g).map((seg, j) =>
            seg.startsWith("**") && seg.endsWith("**") ? (
              <strong key={j} className="font-semibold text-ink">
                {seg.slice(2, -2)}
              </strong>
            ) : (
              <span key={j}>{seg.replace(/^\s*[-*]\s+/gm, "• ")}</span>
            ),
          )}
        </p>
      ))}
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <span className={cx("inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-accent/30 border-t-accent", className)} aria-hidden />;
}

export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <div className="inset p-4">
      <div className="text-[11.5px] font-medium uppercase tracking-[0.08em] text-ink-3">{label}</div>
      <div className="mt-2 text-[26px] font-semibold leading-none tracking-tight text-ink tabular-nums">{value}</div>
      {hint && <div className="mt-2 text-[12px] text-ink-2">{hint}</div>}
    </div>
  );
}
