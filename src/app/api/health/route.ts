import { connection } from "next/server";
import { MODELS } from "@/lib/server/config";
import { LIVE_MODEL, LIVE_VOICE } from "@/lib/server/live";

/** Which providers are configured (never returns the keys themselves). */
export async function GET() {
  await connection();
  return Response.json({
    anthropic: Boolean(process.env.ANTHROPIC_API_KEY),
    gemini: Boolean(process.env.GEMINI_API_KEY),
    models: { ...MODELS, live: LIVE_MODEL, liveVoice: LIVE_VOICE },
  });
}
