"use client";

import type { Content } from "@google/genai";
import { AudioLines, ChevronDown, Mic, PhoneOff, Send, Trash2, Volume2, VolumeX } from "lucide-react";
import { type RefObject, useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/client/api";
import { query } from "@/lib/client/duckdb";
import { LiveConversation, type LiveState } from "@/lib/client/live";
import { DEMO_MODEL, packFor } from "@/lib/demo";
import { bestAnswer, playAnswer } from "@/lib/demo/player";
import type { DemoPack } from "@/lib/demo/types";
import { type ChatQuery, type ChatTurnResult, runChat } from "@/lib/loops";
import type { ChartSpec, LoadedDataset, QueryResult, TokenUsage } from "@/lib/types";
import { ChartView } from "./ChartView";
import { Card, cx, DataTable, IconButton, RichText, Spinner, SqlBlock } from "./ui";

interface Message {
  id: number;
  role: "user" | "assistant";
  text: string;
  via?: "voice" | "text";
  queries?: ChatQuery[];
  pending?: boolean;
  error?: boolean;
  interrupted?: boolean;
}

/** Answers with a category/date + one number get a small inline chart. */
function autoChart(r: QueryResult | undefined): ChartSpec | null {
  if (!r || r.columns.length !== 2 || r.rowCount < 2 || r.rowCount > 40) return null;
  if (!r.rows.every((row) => typeof row[1] === "number" || row[1] === null)) return null;
  const isTime = r.rows.every((row) => typeof row[0] === "string" && /^\d{4}-\d{2}-\d{2}/.test(row[0]));
  return { title: "", type: isTime ? "area" : "hbar", sql: "", x: r.columns[0], y: r.columns[1], group: null, caption: "" };
}

const STATE_TEXT: Record<LiveState, string> = {
  idle: "Start a voice conversation",
  connecting: "Connecting to Gemini Live…",
  listening: "Listening — just talk",
  thinking: "Looking it up…",
  speaking: "Speaking — talk to interrupt",
  error: "Voice unavailable",
};

export function AskPanel({ datasets, active, schema, addUsage, visible, seed }: { datasets: LoadedDataset[]; active: LoadedDataset; schema: string; addUsage: (u: TokenUsage) => void; visible: boolean; seed?: { text: string; nonce: number } }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [history, setHistory] = useState<Content[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [liveState, setLiveState] = useState<LiveState>("idle");
  const [muted, setMuted] = useState(false);
  const [voiceSupported, setVoiceSupported] = useState(false);
  const live = useRef<LiveConversation | null>(null);
  const levels = useRef({ mic: 0, out: 0 });
  const liveUser = useRef<number | null>(null);
  const liveBot = useRef<number | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const idRef = useRef(0);
  const historyRef = useRef<Content[]>([]);
  const packs = datasets.map(packFor).filter((p): p is DemoPack => p !== null);
  const activePack = packFor(active);
  // Prepared questions, the active dataset's first.
  const demoQuestions = [...new Set([...(activePack?.qa ?? []), ...packs.flatMap((p) => p.qa)].map((x) => x.question))];
  historyRef.current = history;
  const inCall = liveState !== "idle" && liveState !== "error";

  useEffect(() => {
    setVoiceSupported(typeof window !== "undefined" && !!navigator.mediaDevices?.getUserMedia && "AudioWorkletNode" in window);
    return () => live.current?.stop();
  }, []);

  useEffect(() => {
    if (visible) scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [messages, visible]);

  const update = (id: number, patch: (m: Message) => Message) => setMessages((all) => all.map((m) => (m.id === id ? patch(m) : m)));

  /** The assistant bubble for the current live turn, created on first use. */
  const botId = () => {
    if (liveBot.current === null) {
      const id = ++idRef.current;
      liveBot.current = id;
      setMessages((m) => [...m, { id, role: "assistant", text: "", pending: true, queries: [] }]);
    }
    return liveBot.current;
  };

  const startCall = () => {
    if (live.current?.active) return;
    const conv = new LiveConversation({
      onState: (s, detail) => {
        setLiveState(s);
        if (s === "error" && detail) setMessages((m) => [...m, { id: ++idRef.current, role: "assistant", text: detail, error: true }]);
      },
      onUserStart: () => {
        const id = ++idRef.current;
        liveUser.current = id;
        liveBot.current = null;
        setMessages((m) => [...m, { id, role: "user", text: "…", via: "voice" }]);
      },
      onUserText: (text) => liveUser.current !== null && update(liveUser.current, (m) => ({ ...m, text })),
      onQuery: (q) => update(botId(), (m) => ({ ...m, queries: [...(m.queries ?? []), q] })),
      onAssistantText: (text) => update(botId(), (m) => ({ ...m, text, pending: false })),
      onTurnEnd: (interrupted) => {
        if (liveBot.current !== null) update(liveBot.current, (m) => ({ ...m, pending: false, interrupted, text: m.text || (interrupted ? "(interrupted)" : m.text) }));
        liveBot.current = null;
      },
      onLevels: (mic, out) => {
        levels.current = { mic, out };
      },
    });
    conv.setMuted(muted);
    live.current = conv;
    conv.start(schema);
  };

  const endCall = () => {
    live.current?.stop();
    live.current = null;
    liveBot.current = null;
    liveUser.current = null;
  };

  const ask = useCallback(
    async (question: string) => {
      const q = question.trim();
      if (!q || busy) return;
      setInput("");
      // During a voice conversation, typed questions go into the same live session.
      if (live.current?.active) {
        liveBot.current = null;
        live.current.sendText(q);
        return;
      }
      setBusy(true);
      const userId = ++idRef.current;
      const id = ++idRef.current;
      setMessages((m) => [...m, { id: userId, role: "user", text: q, via: "text" }, { id, role: "assistant", text: "", pending: true, queries: [] }]);
      try {
        const onQuery = (qq: ChatQuery) => setMessages((m) => m.map((x) => (x.id === id ? { ...x, queries: [...(x.queries ?? []), qq] } : x)));
        // Sample datasets answer from Q&A pre-computed by Claude Opus 5.5; the SQL still runs live.
        const hit = packs.length ? bestAnswer(q, packs, activePack?.id) : null;
        let res: ChatTurnResult;
        if (hit) {
          const table = datasets.find((d) => d.demoPackId === hit.pack.id)?.tableName ?? hit.pack.profile.table_name;
          res = await playAnswer({ qa: hit.qa, table, runSql: (sql) => query(sql), onQuery });
        } else if (packs.length && packs.length === datasets.length) {
          await new Promise((r) => setTimeout(r, 600));
          const examples = demoQuestions.slice(0, 3).map((x) => `• ${x}`).join("\n\n");
          res = { answer: `That question isn't covered in this demo. Here are some I can answer:\n\n${examples}`, queries: [], history: [], usage: [] };
        } else {
          res = await runChat({ question: q, history: historyRef.current, schema, step: api.chatStep, runSql: (sql) => query(sql), onQuery });
        }
        res.usage.forEach(addUsage);
        setHistory(res.history);
        setMessages((m) => m.map((x) => (x.id === id ? { ...x, text: res.answer, pending: false, queries: res.queries } : x)));
      } catch (e) {
        setMessages((m) => m.map((x) => (x.id === id ? { ...x, text: e instanceof Error ? e.message : String(e), pending: false, error: true } : x)));
      } finally {
        setBusy(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- packs derive from datasets
    [busy, schema, addUsage, datasets, activePack?.id],
  );

  const lastSeed = useRef(0);
  useEffect(() => {
    if (seed && seed.nonce !== lastSeed.current) {
      lastSeed.current = seed.nonce;
      ask(seed.text);
    }
  }, [seed, ask]);

  const suggestions = packs.length ? demoQuestions.slice(0, 6) : [...new Set(datasets.flatMap((d) => d.profile.suggested_questions))].slice(0, 6);
  const toggleCall = () => (inCall ? endCall() : startCall());

  return (
    <div className="grid gap-5 lg:grid-cols-12">
      <Card
        className="flex flex-col lg:col-span-8"
        icon={<AudioLines className="h-4 w-4" />}
        title="Ask your data"
        sub={inCall ? "Gemini Live · voice conversation" : `${packs.length ? DEMO_MODEL : "Gemini"} → SQL → answer`}
        actions={
          messages.length > 0 && (
            <IconButton
              label="Clear conversation"
              onClick={() => {
                setMessages([]);
                setHistory([]);
              }}
            >
              <Trash2 className="h-4 w-4" />
            </IconButton>
          )
        }
        bodyClassName="flex flex-1 flex-col"
      >
        <div ref={scroller} className="scroll-thin -mx-1 flex max-h-[calc(100dvh-330px)] min-h-[360px] flex-1 flex-col gap-4 overflow-y-auto px-1 pb-2">
          {messages.length === 0 && (
            <div className="m-auto max-w-md py-10 text-center">
              <div className="mx-auto grid h-14 w-14 place-items-center rounded-full border border-accent/30 bg-accent/10">
                <AudioLines className="h-6 w-6 text-accent" />
              </div>
              <p className="mt-4 text-[15px] font-medium">Ask anything about {datasets.length > 1 ? "your tables" : active.profile.title}</p>
              <p className="mt-1 text-[13px] text-ink-3">Type a question, or start a voice conversation and just talk. Every answer comes with the SQL that produced it.</p>
            </div>
          )}
          {messages.map((m) => (m.role === "user" ? <UserBubble key={m.id} m={m} /> : <AnswerBubble key={m.id} m={m} />))}
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            ask(input);
          }}
          className="mt-3 flex items-center gap-2 rounded-full border border-line bg-surface-2 p-1.5 pl-2 focus-within:border-accent/40"
        >
          {voiceSupported && (
            <button
              type="button"
              onClick={toggleCall}
              disabled={liveState === "connecting"}
              aria-label={inCall ? "End voice conversation" : "Start voice conversation"}
              className={cx("grid h-10 w-10 shrink-0 place-items-center rounded-full transition", inCall ? "pulse text-[#03120a]" : "bg-surface-3 text-ink-2 hover:text-accent")}
              style={inCall ? { background: "var(--accent-grad)" } : undefined}
            >
              {inCall ? <PhoneOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
            </button>
          )}
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={inCall ? "Talk, or type here to ask in the conversation" : "e.g. Which category had the most critical tickets yesterday?"}
            className="min-w-0 flex-1 bg-transparent px-2 text-[14px] text-ink placeholder:text-ink-3 focus:outline-none"
            disabled={busy}
          />
          <button type="submit" disabled={busy || !input.trim()} className="btn-accent grid h-10 w-10 shrink-0 place-items-center rounded-full" aria-label="Send">
            {busy ? <Spinner className="border-[#03120a]/30 border-t-[#03120a]" /> : <Send className="h-4 w-4" />}
          </button>
        </form>
      </Card>

      <div className="flex flex-col gap-5 lg:col-span-4">
        <Card
          title="Voice"
          icon={<Mic className="h-4 w-4" />}
          sub={voiceSupported ? "Gemini Live" : "needs a microphone and a modern browser"}
          actions={
            inCall && (
              <IconButton
                label={muted ? "Unmute voice" : "Mute voice"}
                active={!muted}
                onClick={() => {
                  setMuted(!muted);
                  live.current?.setMuted(!muted);
                }}
              >
                {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
              </IconButton>
            )
          }
        >
          <div className="flex flex-col items-center py-3">
            <VoiceOrb state={liveState} levels={levels} onClick={toggleCall} disabled={!voiceSupported || liveState === "connecting"} />
            <p className="mt-4 text-center text-[13.5px] font-medium text-ink">{STATE_TEXT[liveState]}</p>
            <p className="mt-1 text-center text-[12px] text-ink-3">
              {inCall ? "Ask follow-ups naturally. Tap the orb to hang up." : "Real-time, interruptible voice. Queries run on your in-browser data."}
            </p>
          </div>
        </Card>
        <Card title="Try asking" icon={<AudioLines className="h-4 w-4" />}>
          <div className="flex flex-col gap-2">
            {suggestions.map((s) => (
              <button key={s} onClick={() => ask(s)} disabled={busy} className="chip rounded-2xl px-3.5 py-2.5 text-left text-[13px] disabled:opacity-50">
                {s}
              </button>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}

/** A glowing orb that breathes with your voice (cyan) and Gemini's (violet). Animated outside React. */
function VoiceOrb({ state, levels, onClick, disabled }: { state: LiveState; levels: RefObject<{ mic: number; out: number }>; onClick: () => void; disabled: boolean }) {
  const ring = useRef<HTMLSpanElement>(null);
  const core = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    let raf = 0;
    let smooth = 0;
    const tick = () => {
      const { mic, out } = levels.current ?? { mic: 0, out: 0 };
      const level = state === "speaking" ? out : state === "listening" ? mic : 0;
      smooth = smooth * 0.75 + level * 0.25;
      if (ring.current) ring.current.style.transform = `scale(${1 + smooth * 0.45})`;
      if (core.current) core.current.style.transform = `scale(${1 + smooth * 0.18})`;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [state, levels]);

  const color = state === "speaking" ? "123,92,255" : state === "thinking" ? "245,184,61" : state === "listening" ? "34,211,238" : "255,255,255";
  const live = state !== "idle" && state !== "error";
  return (
    <button type="button" onClick={onClick} disabled={disabled} aria-label={live ? "End voice conversation" : "Start voice conversation"} className="relative grid h-36 w-36 place-items-center rounded-full disabled:opacity-60">
      <span ref={ring} aria-hidden className="absolute inset-0 rounded-full transition-[background] duration-300" style={{ background: `radial-gradient(circle, rgba(${color},${live ? 0.32 : 0.08}) 0%, rgba(${color},0.06) 55%, transparent 72%)` }} />
      <span
        ref={core}
        aria-hidden
        className="relative grid h-24 w-24 place-items-center rounded-full border transition-colors duration-300"
        style={{
          borderColor: `rgba(${color},${live ? 0.6 : 0.15})`,
          background: `radial-gradient(circle at 35% 30%, rgba(255,255,255,0.18), rgba(${color},${live ? 0.28 : 0.06}) 45%, rgba(0,0,0,0.9) 100%)`,
          boxShadow: live ? `0 0 40px rgba(${color},0.45), inset 0 0 24px rgba(${color},0.35)` : "none",
        }}
      >
        {state === "connecting" ? <Spinner className="!h-6 !w-6" /> : live ? <AudioLines className="h-8 w-8" style={{ color: `rgb(${color})` }} /> : <Mic className="h-8 w-8 text-accent" />}
      </span>
      {state === "thinking" && <span aria-hidden className="absolute h-[108px] w-[108px] animate-spin rounded-full border-2 border-transparent border-t-[#f5b83d] [animation-duration:1.2s]" />}
    </button>
  );
}

function UserBubble({ m }: { m: Message }) {
  return (
    <div className="fade-up flex justify-end">
      <div className="max-w-[80%] rounded-[22px] rounded-br-md border border-accent/20 bg-accent/[0.08] px-4 py-2.5 text-[14px] text-ink">
        {m.via === "voice" && <Mic className="mb-0.5 mr-1.5 inline h-3.5 w-3.5 text-accent" />}
        {m.text}
      </div>
    </div>
  );
}

function AnswerBubble({ m }: { m: Message }) {
  const [open, setOpen] = useState(false);
  const last = m.queries?.filter((q) => q.result).at(-1);
  const spec = autoChart(last?.result);
  return (
    <div className="fade-up flex gap-3">
      <span className="mt-1 grid h-8 w-8 shrink-0 place-items-center rounded-full border border-line bg-surface-3">
        <AudioLines className="h-3.5 w-3.5 text-accent" />
      </span>
      <div className="min-w-0 flex-1">
        {m.pending ? (
          <div className="flex items-center gap-2 py-1.5 text-[13px] text-ink-3">
            <Spinner /> {m.queries?.length ? `Ran ${m.queries.length} quer${m.queries.length === 1 ? "y" : "ies"}…` : "Writing SQL…"}
          </div>
        ) : (
          <RichText text={m.text + (m.interrupted && m.text !== "(interrupted)" ? " —" : "")} className={cx("text-[14.5px] leading-relaxed", m.error ? "text-red-200" : "text-ink-2")} />
        )}
        {spec && last?.result && !m.pending && (
          <div className="inset mt-3 p-3">
            <ChartView spec={spec} result={last.result} bare height={Math.min(260, 60 + last.result.rowCount * 26)} />
          </div>
        )}
        {!!m.queries?.length && !m.pending && (
          <div className="mt-2">
            <button onClick={() => setOpen(!open)} className="flex items-center gap-1.5 rounded-full border border-line px-2.5 py-1 text-[11.5px] text-ink-3 hover:text-ink">
              <ChevronDown className={cx("h-3.5 w-3.5 transition", open && "rotate-180")} />
              {open ? "Hide" : "Inspect"} SQL &amp; results ({m.queries.length})
            </button>
            {open && (
              <div className="mt-2 space-y-3">
                {m.queries.map((q, i) => (
                  <div key={i} className="space-y-2">
                    {q.explanation && <div className="text-[12px] text-ink-3">{q.explanation}</div>}
                    <SqlBlock sql={q.sql} />
                    {q.error ? <p className="rounded-xl bg-red-400/5 p-2 text-[12px] text-red-200">{q.error}</p> : q.result && <DataTable result={q.result} maxRows={25} dense />}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
