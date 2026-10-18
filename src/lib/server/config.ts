import Anthropic from "@anthropic-ai/sdk";
import { GoogleGenAI } from "@google/genai";

/**
 * Model choices. Every one can be overridden from .env.local.
 *  - Profiling runs on Claude Haiku (fast and cheap; it only reads 20 sample rows).
 *  - The deep-dive agent runs on Claude Opus (multi-step reasoning over many queries).
 *  - Conversational Q&A runs on Gemini with native function calling.
 */
export const MODELS = {
  profiler: process.env.PROFILER_MODEL ?? "claude-haiku-5-5",
  agent: process.env.AGENT_MODEL ?? "claude-opus-5-5",
  chat: process.env.GEMINI_MODEL ?? "gemini-flash-latest",
};

export const AGENT_EFFORT = (process.env.AGENT_EFFORT ?? "medium") as "low" | "medium" | "high" | "xhigh" | "max";

let anthropic: Anthropic | null = null;
let gemini: GoogleGenAI | null = null;

export class MissingKeyError extends Error {
  constructor(name: string) {
    super(`${name} is not set. Add it to .env.local and restart the server.`);
  }
}

export function getAnthropic() {
  if (!process.env.ANTHROPIC_API_KEY) throw new MissingKeyError("ANTHROPIC_API_KEY");
  anthropic ??= new Anthropic();
  return anthropic;
}

export function getGemini() {
  if (!process.env.GEMINI_API_KEY) throw new MissingKeyError("GEMINI_API_KEY");
  gemini ??= new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  return gemini;
}

/** Accept a client-supplied YYYY-MM-DD date, else fall back to the server's date. */
export function validDate(d?: string) {
  return d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : new Date().toISOString().slice(0, 10);
}

/** Turn SDK errors into a status + message the browser can show. */
export function toErrorResponse(err: unknown) {
  if (err instanceof MissingKeyError) return Response.json({ error: err.message }, { status: 500 });
  if (err instanceof Anthropic.APIError) {
    const status = err.status ?? 502;
    const msg =
      err instanceof Anthropic.AuthenticationError
        ? "Anthropic rejected the API key."
        : err instanceof Anthropic.RateLimitError
          ? "Anthropic rate limit reached. Try again in a moment."
          : `Anthropic API error: ${err.message}`;
    return Response.json({ error: msg }, { status });
  }
  const message = err instanceof Error ? err.message : String(err);
  console.error(err);
  return Response.json({ error: message }, { status: 500 });
}
