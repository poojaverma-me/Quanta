import type { TokenUsage } from "./types";

/** USD per million tokens [input, output]. Gemini Flash pricing is an estimate; adjust as needed. */
export const PRICES: Record<string, [number, number]> = {
  "claude-haiku-5-5": [0.1, 0.5],
  "claude-sonnet-5-5": [2, 10],
  "claude-opus-5-5": [4, 20],
  "claude-opus-4-8": [5, 25],
  gemini: [0.3, 2.5],
};

export function priceFor(u: TokenUsage): [number, number] {
  if (u.provider === "google") return PRICES.gemini;
  return PRICES[u.model] ?? PRICES[Object.keys(PRICES).find((k) => u.model.startsWith(k)) ?? ""] ?? PRICES["claude-opus-5-5"];
}

/** Estimated cost; cache reads bill at ~10% of the input price. */
export function estimateCost(u: TokenUsage) {
  const [pin, pout] = priceFor(u);
  return (u.inputTokens * pin + u.outputTokens * pout + (u.cacheReadTokens ?? 0) * pin * 0.1) / 1e6;
}
