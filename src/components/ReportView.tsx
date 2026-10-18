"use client";

import { AreaChart, BarChart3, Check, Copy, Download, Flag, Grid3x3, Lightbulb, LineChart, PieChart, Printer, Target } from "lucide-react";
import { useState } from "react";
import type { ChartSpec, QueryResult, Report } from "@/lib/types";
import { ChartView } from "./ChartView";
import { Card, IconButton, LevelTag, SentimentIcon } from "./ui";

const ICONS: Partial<Record<ChartSpec["type"], React.ReactNode>> = {
  area: <AreaChart className="h-4 w-4" />,
  line: <LineChart className="h-4 w-4" />,
  bar: <BarChart3 className="h-4 w-4" />,
  hbar: <BarChart3 className="h-4 w-4 rotate-90" />,
  heatmap: <Grid3x3 className="h-4 w-4" />,
  donut: <PieChart className="h-4 w-4" />,
};

export function reportToMarkdown(r: Report, objective: string) {
  const lines = [
    `# ${r.title}`,
    "",
    `_Objective: ${objective}_`,
    "",
    "## Executive summary",
    r.executive_summary,
    "",
    "## Key metrics",
    ...r.kpis.map((k) => `- **${k.label}:** ${k.value} (${k.context})`),
    "",
    "## Findings",
    ...r.findings.map((f, i) => `${i + 1}. **${f.title}** _(${f.severity} severity)_ — ${f.detail}`),
    "",
    "## Recommendations",
    ...r.recommendations.map((x, i) => `${i + 1}. **${x.title}** _(${x.impact} impact)_ — ${x.detail}`),
    "",
    "## Charts",
    ...r.charts.flatMap((c) => [`### ${c.title}`, c.caption, "```sql", c.sql, "```", ""]),
  ];
  return lines.join("\n");
}

export function ReportView({ report, chartData, objective, finishedAt }: { report: Report; chartData: (QueryResult | null)[]; objective: string; finishedAt: number }) {
  const [copied, setCopied] = useState(false);
  const md = () => reportToMarkdown(report, objective);
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Card
        className="lg:col-span-2"
        icon={<Flag className="h-4 w-4 text-accent" />}
        title={report.title}
        sub={new Date(finishedAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
        actions={
          <div className="no-print flex items-center gap-1">
            <IconButton
              label="Copy as Markdown"
              onClick={() => {
                navigator.clipboard?.writeText(md());
                setCopied(true);
                setTimeout(() => setCopied(false), 1400);
              }}
            >
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            </IconButton>
            <IconButton
              label="Download Markdown"
              onClick={() => {
                const a = document.createElement("a");
                a.href = URL.createObjectURL(new Blob([md()], { type: "text/markdown" }));
                a.download = `${report.title.replace(/[^\w]+/g, "-").toLowerCase().slice(0, 60)}.md`;
                a.click();
                URL.revokeObjectURL(a.href);
              }}
            >
              <Download className="h-4 w-4" />
            </IconButton>
            <IconButton label="Print / save as PDF" onClick={() => window.print()}>
              <Printer className="h-4 w-4" />
            </IconButton>
          </div>
        }
      >
        <p className="text-[12.5px] text-ink-3">
          <span className="text-ink-2">Objective:</span> {objective}
        </p>
        <p className="mt-3 text-[15px] leading-[1.7] text-ink">{report.executive_summary}</p>
        <div className="mt-5 grid grid-cols-2 gap-3 xl:grid-cols-4">
          {report.kpis.map((k) => (
            <div key={k.label} className="inset relative overflow-hidden p-4">
              {k.sentiment !== "neutral" && (
                <div className="pointer-events-none absolute inset-x-0 top-0 h-px" style={{ background: k.sentiment === "negative" ? "linear-gradient(90deg,transparent,rgba(248,113,113,.6),transparent)" : "linear-gradient(90deg,transparent,rgba(74,222,128,.6),transparent)" }} />
              )}
              <div className="text-[12.5px] text-ink-2">{k.label}</div>
              <div className={`num mt-2 font-bold leading-tight ${k.value.length > 10 ? "text-[19px]" : "text-[28px] leading-none"}`}>{k.value}</div>
              <div className="mt-2 flex items-start gap-1 text-[12px] text-ink-2">
                <SentimentIcon sentiment={k.sentiment} />
                <span>{k.context}</span>
              </div>
            </div>
          ))}
        </div>
      </Card>

      {report.charts.map((c, i) => (
        <ChartView key={`${c.title}-${i}`} spec={c} result={chartData[i]} icon={ICONS[c.type]} className={report.charts.length % 2 === 1 && i === 0 ? "lg:col-span-2" : undefined} />
      ))}

      <Card title="Findings" icon={<Target className="h-4 w-4" />} sub={`${report.findings.length} ranked`}>
        <ol className="space-y-3">
          {report.findings.map((f, i) => (
            <li key={i} className="inset p-4">
              <div className="flex items-start gap-3">
                <span className="mono mt-0.5 text-[12px] text-ink-3">{String(i + 1).padStart(2, "0")}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[14px] font-medium">{f.title}</span>
                    <LevelTag level={f.severity} kind="severity" />
                  </div>
                  <p className="mt-1.5 text-[13px] leading-relaxed text-ink-2">{f.detail}</p>
                </div>
              </div>
            </li>
          ))}
        </ol>
      </Card>

      <Card title="Recommendations" icon={<Lightbulb className="h-4 w-4" />} sub="actionable this quarter">
        <ol className="space-y-3">
          {report.recommendations.map((r, i) => (
            <li key={i} className="inset p-4">
              <div className="flex items-start gap-3">
                <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full text-[11px] font-semibold text-[#03120a]" style={{ background: "var(--accent-grad)" }}>
                  {i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[14px] font-medium">{r.title}</span>
                    <LevelTag level={r.impact} kind="impact" />
                  </div>
                  <p className="mt-1.5 text-[13px] leading-relaxed text-ink-2">{r.detail}</p>
                </div>
              </div>
            </li>
          ))}
        </ol>
      </Card>
    </div>
  );
}
