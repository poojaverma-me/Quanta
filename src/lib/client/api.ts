import type { Content, LiveConnectConfig } from "@google/genai";
import type { AgentStepInput, AgentStepOutput } from "../server/agent";
import type { ChatStepOutput } from "../server/chat";
import type { ProfileInput } from "../server/profile";
import type { DatasetProfile, TokenUsage } from "../types";

async function post<T>(url: string, body: unknown, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal });
  const data = await res.json().catch(() => ({ error: `Request failed (${res.status})` }));
  if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
  return data as T;
}

export const api = {
  profile: (input: ProfileInput) => post<{ profile: DatasetProfile; usage: TokenUsage }>("/api/profile", input),
  agentStep: (input: AgentStepInput, signal?: AbortSignal) => post<AgentStepOutput>("/api/agent", input, signal),
  chatStep: (schema: string, contents: Content[], today: string) => post<ChatStepOutput>("/api/chat", { schema, contents, today }),
  liveToken: (schema: string, today: string) => post<{ token: string; model: string; config: LiveConnectConfig }>("/api/live-token", { schema, today }),
  health: async () => {
    const res = await fetch("/api/health");
    return (await res.json()) as { anthropic: boolean; gemini: boolean; models: Record<string, string> };
  },
};
