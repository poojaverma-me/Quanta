/**
 * Real-time voice conversation with the Gemini Live API.
 *
 * The browser fetches a single-use session token from /api/live-token, then
 * talks to Gemini directly over a WebSocket: microphone audio streams up as
 * 16 kHz PCM, spoken replies stream back as 24 kHz PCM and play immediately.
 * When Gemini needs data it calls run_sql; the query runs on the in-browser
 * DuckDB and the result goes back as the tool response. Speaking over the
 * assistant interrupts it (barge-in).
 */
import { GoogleGenAI, type LiveServerMessage, type Session } from "@google/genai";
import { localToday, safeQuery, type ChatQuery } from "../loops";
import { formatResultForModel } from "../sql";
import { api } from "./api";
import { query } from "./duckdb";

export type LiveState = "idle" | "connecting" | "listening" | "thinking" | "speaking" | "error";

export interface LiveHandlers {
  onState: (s: LiveState, detail?: string) => void;
  /** The user started a new spoken (or typed) turn. */
  onUserStart: () => void;
  /** Running transcript of what the user is saying in the current turn. */
  onUserText: (text: string) => void;
  /** Running transcript of the assistant's spoken reply in the current turn. */
  onAssistantText: (text: string) => void;
  onQuery: (q: ChatQuery) => void;
  /** The assistant finished (or was interrupted in) its reply. */
  onTurnEnd: (interrupted: boolean) => void;
  /** 0..1 levels for the visualizer. */
  onLevels?: (mic: number, out: number) => void;
}

const IN_RATE = 16_000;
const OUT_RATE = 24_000;

// Captures raw microphone frames; resampling happens on the main thread.
const WORKLET = `class Capture extends AudioWorkletProcessor {
  process(inputs) { const ch = inputs[0] && inputs[0][0]; if (ch) this.port.postMessage(ch.slice(0)); return true; }
}
registerProcessor("pcm-capture", Capture);`;

function toBase64(bytes: Uint8Array) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function fromBase64(b64: string) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Average-decimate float samples from `from` Hz to 16 kHz, then convert to 16-bit PCM. */
function downsampleToPcm16(input: Float32Array, from: number) {
  const ratio = from / IN_RATE;
  const n = Math.floor(input.length / ratio);
  const out = new Int16Array(n);
  for (let i = 0; i < n; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.min(input.length, Math.floor((i + 1) * ratio));
    let sum = 0;
    for (let j = start; j < end; j++) sum += input[j];
    const v = Math.max(-1, Math.min(1, sum / Math.max(1, end - start)));
    out[i] = v < 0 ? v * 0x8000 : v * 0x7fff;
  }
  return out;
}

export class LiveConversation {
  private session: Session | null = null;
  private inCtx: AudioContext | null = null;
  private outCtx: AudioContext | null = null;
  private outGain: GainNode | null = null;
  private analyser: AnalyserNode | null = null;
  private stream: MediaStream | null = null;
  private worklet: AudioWorkletNode | null = null;
  private pending: Int16Array[] = [];
  private pendingLen = 0;
  private playing = new Set<AudioBufferSourceNode>();
  private nextTime = 0;
  private userText = "";
  private userTurnOpen = false;
  private assistantText = "";
  private turnDone = false;
  private toolBusy = false;
  private micLevel = 0;
  private raf = 0;
  private closed = false;
  private state: LiveState = "idle";

  constructor(private handlers: LiveHandlers) {}

  get active() {
    return this.state !== "idle" && this.state !== "error";
  }

  private set(s: LiveState, detail?: string) {
    this.state = s;
    this.handlers.onState(s, detail);
  }

  async start(schema: string) {
    this.closed = false;
    this.set("connecting");
    try {
      // Ask for the microphone first so a denied permission fails fast.
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      const { token, model, config } = await api.liveToken(schema, localToday());
      const ai = new GoogleGenAI({ apiKey: token, httpOptions: { apiVersion: "v1alpha" } });

      this.outCtx = new AudioContext();
      this.outGain = this.outCtx.createGain();
      this.analyser = this.outCtx.createAnalyser();
      this.analyser.fftSize = 256;
      this.outGain.connect(this.analyser).connect(this.outCtx.destination);

      let ready!: () => void;
      const setup = new Promise<void>((r) => (ready = r));
      this.session = await ai.live.connect({
        model,
        config,
        callbacks: {
          onmessage: (m) => {
            if (m.setupComplete) ready();
            this.onMessage(m);
          },
          onerror: (e) => this.fail(e.message || "Connection error"),
          onclose: (e) => {
            if (!this.closed) this.fail(e.reason || "The voice session ended.");
          },
        },
      });
      await setup;
      await this.startMic();
      this.set("listening");
      this.meter();
    } catch (e) {
      const msg = e instanceof DOMException && e.name === "NotAllowedError" ? "Microphone access was blocked. Allow it in your browser's site settings to talk to your data." : e instanceof Error ? e.message : String(e);
      this.fail(msg);
    }
  }

  /** Type into the live conversation; the answer is spoken. */
  sendText(text: string) {
    if (!this.session || !text.trim()) return;
    this.stopPlayback();
    if (this.assistantText) {
      this.handlers.onTurnEnd(true);
      this.assistantText = "";
    }
    this.handlers.onUserStart();
    this.handlers.onUserText(text.trim());
    this.closeUserTurn();
    this.set("thinking");
    this.session.sendRealtimeInput({ text: text.trim() });
  }

  setMuted(muted: boolean) {
    if (this.outGain) this.outGain.gain.value = muted ? 0 : 1;
  }

  stop() {
    this.closed = true;
    cancelAnimationFrame(this.raf);
    try {
      this.session?.sendRealtimeInput({ audioStreamEnd: true });
    } catch {
      // already closed
    }
    this.session?.close();
    this.session = null;
    this.stopPlayback();
    this.worklet?.disconnect();
    this.stream?.getTracks().forEach((t) => t.stop());
    this.inCtx?.close().catch(() => {});
    this.outCtx?.close().catch(() => {});
    this.inCtx = this.outCtx = null;
    this.worklet = null;
    this.stream = null;
    this.set("idle");
  }

  // ---------- microphone ----------

  private async startMic() {
    this.inCtx = new AudioContext();
    const url = URL.createObjectURL(new Blob([WORKLET], { type: "text/javascript" }));
    await this.inCtx.audioWorklet.addModule(url);
    URL.revokeObjectURL(url);
    const source = this.inCtx.createMediaStreamSource(this.stream!);
    this.worklet = new AudioWorkletNode(this.inCtx, "pcm-capture");
    const rate = this.inCtx.sampleRate;
    this.worklet.port.onmessage = (e: MessageEvent<Float32Array>) => {
      const frame = e.data;
      let sum = 0;
      for (let i = 0; i < frame.length; i++) sum += frame[i] * frame[i];
      this.micLevel = Math.min(1, Math.sqrt(sum / frame.length) * 6);
      const pcm = downsampleToPcm16(frame, rate);
      this.pending.push(pcm);
      this.pendingLen += pcm.length;
      // Send ~40 ms chunks.
      if (this.pendingLen >= 640) this.flushMic();
    };
    source.connect(this.worklet);
  }

  private flushMic() {
    if (!this.session || !this.pendingLen) return;
    const merged = new Int16Array(this.pendingLen);
    let o = 0;
    for (const p of this.pending) {
      merged.set(p, o);
      o += p.length;
    }
    this.pending = [];
    this.pendingLen = 0;
    this.session.sendRealtimeInput({ audio: { data: toBase64(new Uint8Array(merged.buffer)), mimeType: `audio/pcm;rate=${IN_RATE}` } });
  }

  // ---------- playback ----------

  private play(b64: string) {
    if (!this.outCtx || !this.outGain) return;
    const bytes = fromBase64(b64);
    const pcm = new Int16Array(bytes.buffer, bytes.byteOffset, Math.floor(bytes.byteLength / 2));
    const buf = this.outCtx.createBuffer(1, pcm.length, OUT_RATE);
    const ch = buf.getChannelData(0);
    for (let i = 0; i < pcm.length; i++) ch[i] = pcm[i] / 0x8000;
    const src = this.outCtx.createBufferSource();
    src.buffer = buf;
    src.connect(this.outGain);
    this.nextTime = Math.max(this.nextTime, this.outCtx.currentTime + 0.03);
    src.start(this.nextTime);
    this.nextTime += buf.duration;
    this.playing.add(src);
    src.onended = () => {
      this.playing.delete(src);
      if (!this.playing.size && this.turnDone && this.active) this.set("listening");
    };
    if (this.state !== "speaking") this.set("speaking");
  }

  private stopPlayback() {
    for (const s of this.playing) {
      try {
        s.stop();
      } catch {
        // not started
      }
    }
    this.playing.clear();
    this.nextTime = 0;
  }

  // ---------- protocol ----------

  /** Model output has started, so the next transcription belongs to a new user turn. */
  private closeUserTurn() {
    this.userTurnOpen = false;
    this.userText = "";
  }

  private async onMessage(m: LiveServerMessage) {
    const sc = m.serverContent;
    if (sc?.inputTranscription?.text) {
      // The user is (still) talking: a new turn begins.
      if (this.assistantText) {
        this.handlers.onTurnEnd(false);
        this.assistantText = "";
      }
      if (!this.userTurnOpen) {
        this.userTurnOpen = true;
        this.userText = "";
        this.handlers.onUserStart();
      }
      this.userText += sc.inputTranscription.text;
      this.handlers.onUserText(this.userText.trim());
    }
    if (sc?.interrupted) {
      // Barge-in: drop whatever is still queued for playback.
      this.stopPlayback();
      this.handlers.onTurnEnd(true);
      this.assistantText = "";
      this.set("listening");
    }
    if (m.toolCall?.functionCalls?.length && this.session) {
      this.closeUserTurn();
      this.toolBusy = true;
      this.set("thinking");
      const responses = [];
      for (const fc of m.toolCall.functionCalls) {
        const sql = String((fc.args as { sql?: string } | undefined)?.sql ?? "");
        const q = await safeQuery(query, sql);
        this.handlers.onQuery({ sql: q.sql, explanation: String((fc.args as { explanation?: string } | undefined)?.explanation ?? ""), result: q.result, error: q.error });
        responses.push({ id: fc.id, name: fc.name, response: q.error ? { error: q.error } : { result: formatResultForModel(q.result!, 30, 3000) } });
      }
      this.toolBusy = false;
      this.session?.sendToolResponse({ functionResponses: responses });
    }
    for (const part of sc?.modelTurn?.parts ?? []) {
      if (part.inlineData?.data && part.inlineData.mimeType?.startsWith("audio/")) {
        this.closeUserTurn();
        this.turnDone = false;
        this.play(part.inlineData.data);
      }
    }
    if (sc?.outputTranscription?.text) {
      this.closeUserTurn();
      this.assistantText += sc.outputTranscription.text;
      this.handlers.onAssistantText(this.assistantText.trim());
    }
    if (sc?.turnComplete && !this.toolBusy) {
      this.turnDone = true;
      if (this.assistantText) {
        this.handlers.onTurnEnd(false);
        this.assistantText = "";
      }
      if (!this.playing.size && this.active) this.set("listening");
    }
    if (m.goAway) this.handlers.onState(this.state, "The voice session is about to time out; start a new one to keep talking.");
  }

  private meter() {
    const data = new Uint8Array(128);
    const tick = () => {
      if (this.closed) return;
      let out = 0;
      if (this.analyser) {
        this.analyser.getByteTimeDomainData(data);
        let sum = 0;
        for (const v of data) sum += ((v - 128) / 128) ** 2;
        out = Math.min(1, Math.sqrt(sum / data.length) * 5);
      }
      this.handlers.onLevels?.(this.micLevel, out);
      this.micLevel *= 0.85;
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  private fail(msg: string) {
    if (this.closed) return;
    this.stop();
    this.state = "error";
    this.handlers.onState("error", msg);
  }
}
