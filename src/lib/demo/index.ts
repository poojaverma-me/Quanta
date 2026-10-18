/**
 * Demo mode: the three sample datasets come with analyses pre-computed by
 * Claude Opus 5.5 (profiles, deep dives, Q&A). When one of them is loaded,
 * the app replays that work locally instead of calling the model APIs; any
 * other CSV still goes through the live pipeline. Set NEXT_PUBLIC_DEMO_MODE=off
 * to always run live.
 */
import type { LoadedDataset } from "../types";
import { DEMO_PACKS } from "./packs";
import type { DemoPack } from "./types";

export const DEMO_ENABLED = (process.env.NEXT_PUBLIC_DEMO_MODE ?? "on").toLowerCase() !== "off";
/** Show the small "Demo" chip in the header (recommended whenever the app is shown to others). */
export const DEMO_BADGE = (process.env.NEXT_PUBLIC_DEMO_BADGE ?? "on").toLowerCase() !== "off";

/** Recognize a sample dataset by its headers, so a renamed file still matches. */
export function findPack(headers: string[]): DemoPack | null {
  if (!DEMO_ENABLED) return null;
  const key = headers.map((h) => h.trim().toLowerCase()).join("|");
  return DEMO_PACKS.find((p) => p.headers.join("|") === key) ?? null;
}

export function packFor(d: Pick<LoadedDataset, "demoPackId">): DemoPack | null {
  return d.demoPackId ? (DEMO_PACKS.find((p) => p.id === d.demoPackId) ?? null) : null;
}

export { DEMO_MODEL } from "./player";
