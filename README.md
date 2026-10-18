# Quanta — AI Data Analyst

Talk to your CSVs. Drop in a spreadsheet and it becomes a typed SQL database **in your browser** (DuckDB-WASM). Then:

- **Overview** — Claude Haiku profiles the schema from 20 sample rows and writes an executive dataset brief; the dashboard charts are generated automatically from that profile.
- **Deep Dive** — an autonomous Claude Opus agent runs iterative SQL to find bottlenecks, spikes and anomalies, streaming its reasoning and queries to a live timeline, then delivers an executive report with KPI cards, validated charts, findings and recommendations.
- **Ask** — text Q&A, or a real-time **voice conversation over the Gemini Live API** (`gemini-3.8-live`): talk naturally, interrupt it, and hear answers in a natural voice. Gemini calls a `run_sql` tool mid-conversation; the query runs on the in-browser DuckDB and the SQL and rows appear in the chat, along with live transcripts of both sides.
- **Data** — the typed schema with per-column profiling, a read-only SQL console and a row preview.

Charts are built with Highcharts and replicate the components of Setproduct's [Hyper Charts](https://setproduct.com/hyper) kit on black cards: "Sales Report" cards (neon-green barcode with the busiest 14 days lit, ✦/medal KPI pair in monospace, three ranked rows), KPI-over-chart cards (cyan → violet pill columns with a gold rolling-average line; bright/dim mint range pills), three 3D report cards (glossy bubble landscape, glowing lollipop peak days, layered hourly-rhythm waves), and the radar set (Income-style comparison polygon with a center glyph, rounded star, flower petals, wavy rings, compact radar tiles). Chart types the kit doesn't show are derived from it: a glowing dot-matrix heatmap, a thick rounded donut with a monospace total, pill-track horizontal bars and glowing splines with hollow end markers. Every card keeps its table and SQL toggles. Card definitions and their SQL live in `src/lib/client/hyper.ts`.

## Quick start

```bash
npm install
cp .env.example .env.local   # add ANTHROPIC_API_KEY and GEMINI_API_KEY
npm run dev                  # http://localhost:3000
```

Pick one of the three sample datasets on the landing page, or drop in your own CSV.

## How it works

```
CSV ──► DuckDB-WASM (browser)
         │ stage as all-VARCHAR table, sniff types, sample 20 rows,
         │ compute full-file date ranges
         ▼
   /api/profile ──► Claude Haiku: typed schema, roles, strptime formats, summary
         │
         ▼
   typed table via TRY_CAST per column (columns that fail >20% fall back to VARCHAR)
   + local column statistics (ranges, top values, null rates)
         │
         ├─► Overview: deterministic charts from the profile
         ├─► Deep Dive: browser-driven loop ⇄ /api/agent (Claude Opus, tools: run_sql, submit_report)
         └─► Ask:       browser-driven loop ⇄ /api/chat  (Gemini, tool: run_sql)
```

The browser owns both tool loops. API routes only make model calls, and SQL always runs locally, so the raw file never leaves the tab. Models see the schema, column statistics and the results of the queries they ask for. Every model-written query passes a read-only guard (`src/lib/sql.ts`): single SELECT/WITH statements only, with no file or URL readers.

Before a Deep Dive report is accepted, each of its chart queries is executed. Charts that fail or return the wrong columns are sent back to the agent to fix.

| Layer | Where |
| --- | --- |
| Shared ingestion pipeline (browser + eval) | `src/lib/pipeline.ts` |
| Agent / chat loops (browser + eval) | `src/lib/loops.ts` |
| Model calls | `src/lib/server/{profile,agent,chat}.ts` |
| DuckDB-WASM client | `src/lib/client/duckdb.ts` |
| Highcharts theme + chart builder | `src/lib/client/charts.ts` |
| Hyper Charts dashboard plan | `src/lib/client/hyper.ts` |
| UI | `src/components/*` |

### Voice

The browser asks `/api/live-token` for a single-use, 30-minute session token. The server locks the model, voice, system prompt (with the dataset's schema) and the `run_sql` tool into that token, so the real API key never reaches the client and the browser can't change the session's setup. The browser then talks to Gemini directly over a WebSocket. Microphone audio streams up as 16 kHz PCM (with echo cancellation), and replies stream back as 24 kHz PCM and play gaplessly. If you speak while it's answering, it stops (barge-in). Typing during a call sends the text into the same conversation. Voice always runs live, including on the demo samples.

### Models

| Role | Default | Override |
| --- | --- | --- |
| Schema profiling + summary | `claude-haiku-5-5` (effort `low`, structured output) | `PROFILER_MODEL` |
| Deep-dive agent | `claude-opus-5-5` (adaptive thinking, effort `medium`, prompt caching, server-side refusal fallback) | `AGENT_MODEL`, `AGENT_EFFORT` |
| Conversational Q&A (text) | `gemini-flash-latest` | `GEMINI_MODEL` |
| Voice conversation | `gemini-3.8-live`, voice `Kore` | `GEMINI_LIVE_MODEL`, `GEMINI_LIVE_VOICE` |

The spec named Claude 3.5 Haiku; that model is retired, so profiling uses the current Haiku.

## Demo mode (pre-computed analyses)

The three sample datasets ship with analyses written by Claude Opus 5.5 ahead of time, in `src/lib/demo/packs/`:

- a profile and dataset brief for each;
- three full deep dives per dataset (reasoning timeline, queries, report with KPIs, findings, charts and recommendations);
- ten prepared Q&A answers per dataset.

When a sample CSV is loaded (it's recognized by its headers, so renaming the file doesn't matter), the app replays this work with natural pacing instead of calling the model APIs. The timeline queries, chart queries and Q&A queries still run live on the in-browser DuckDB, so every table and chart shows real results.

Free-text objectives and questions are matched to the closest prepared item, using synonyms ("team" ↔ department, "send back" ↔ return, …). Questions the demo doesn't cover get an honest "not covered in this demo" reply with suggestions. Any other CSV runs through the live pipeline as usual. A small **Demo** chip in the header marks demo mode.

```bash
npm run verify-demo   # re-proves every quoted number, query, chart and routing rule against the data
```

| Setting | Default | Effect |
| --- | --- | --- |
| `NEXT_PUBLIC_DEMO_MODE` | `on` | `off` runs the samples live too |
| `NEXT_PUBLIC_DEMO_BADGE` | `on` | `off` hides the header chip |
| `NEXT_PUBLIC_DEMO_SPEED` | `1` | Playback speed multiplier, e.g. `2` |

## Synthetic datasets

```bash
npm run generate-data
```

Writes three seeded, reproducible CSVs to `public/samples/`, each with planted patterns:

| File | Rows | Planted patterns |
| --- | --- | --- |
| `support_tickets.csv` | 6,357 | Security Engineering bottleneck (~2× slower); EMEA network outage spike Aug 17–20; billing spikes on days 1–3 of each month; Performance surge after a Sep 8 release; growing Data Platform backlog from August; CSAT falls as resolution time rises |
| `saas_churn.csv` | 2,600 | Starter/monthly plans churn most; low-activation accounts churn; Q3 competitor wave in EMEA Growth accounts. Dates are `MM/DD/YYYY` to test format detection |
| `ecommerce_fulfillment.csv` | 7,815 | Memphis warehouse slowdown from Sep 1; OnTrac late deliveries; high Electronics returns |

## Evaluation

```bash
npm run eval            # schema + summaries + Gemini SQL (~$0.02)
npm run eval -- --agent # also one full Opus deep dive (~$0.30)
```

The eval runs the same pipeline and loops as the app, against DuckDB for Node and the live APIs. It checks:

- Haiku's typed schema loads cleanly, with expected types and ≥98% parse rate, and detects the US date format.
- Summaries have 2–4 paragraphs and are consistent across two runs.
- Every SQL statement Gemini emits passes the read-only guard and compiles (`EXPLAIN`), and answers match ground truth computed in SQL.
- Token use per call stays within budget, with a cost report at the end.
- With `--agent`: the agent's report finds the planted bottleneck and spike, and all of its charts execute.

Last run: all 64 checks passed. The full run cost about $0.29: Haiku $0.005, Gemini $0.018, one Opus deep dive $0.27.

## Notes

- **Highcharts license:** free for personal, non-commercial and evaluation use. A commercial deployment needs a [Highcharts license](https://www.highcharts.com/license).
- **Voice** uses the browser's Web Speech API (Chrome, Edge, Safari). Text works everywhere.
- **Deployment:** the API routes are plain Node handlers (`maxDuration` 300 s for agent steps), so this deploys to Vercel or any Node host. DuckDB-WASM loads from the jsDelivr CDN at runtime.
- **Costs** are shown live in the header and in the agent log. Prices live in `src/lib/pricing.ts`; the Gemini price is an estimate.
