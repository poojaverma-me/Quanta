import { type LiveConnectConfig, Modality } from "@google/genai";
import { RUN_SQL_DECLARATION } from "./chat";
import { getGemini, validDate } from "./config";

export const LIVE_MODEL = process.env.GEMINI_LIVE_MODEL ?? "gemini-3.8-live";
export const LIVE_VOICE = process.env.GEMINI_LIVE_VOICE ?? "Kore";

function instruction(schema: string, today: string) {
  return `You are a friendly, sharp data analyst on a live voice call. The user is talking to their spreadsheets, which are loaded into an in-browser DuckDB database:

${schema}

Today's date is ${today}.

How to answer:
- For any question about the data, call run_sql first. Use the exact table and column names above, in DuckDB dialect (date_trunc('month', ts), ts::DATE, quantile_cont, avg(x) FILTER (WHERE ...)).
- Every number you say must appear in a run_sql result from this conversation. If you need a number you haven't queried, run another query first — never estimate, round from memory, or fill a gap.
- Relative dates ("yesterday", "this month") are relative to today. If the data ends earlier, query the latest period in the data (one query can find the latest date and its count together), then say so and name the date.
- If a query errors, fix it and try again without mentioning the error unless it keeps failing.
- You are speaking, not writing: answer in one to three short, natural sentences. Lead with the answer and always say the key number ("Security Engineering, at about thirty-nine hours"). Round sensibly. Never read out SQL, column names with underscores, or lists longer than three items.
- Offer one brief, relevant follow-up only when it adds value.
- If the user interrupts, stop and address what they just said.`;
}

/** The session configuration, locked into the ephemeral token so the browser can't change it. */
export function liveConfig(schema: string, today?: string): LiveConnectConfig {
  return {
    responseModalities: [Modality.AUDIO],
    systemInstruction: instruction(schema, validDate(today)),
    tools: [{ functionDeclarations: [RUN_SQL_DECLARATION] }],
    speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: LIVE_VOICE } } },
    inputAudioTranscription: {},
    outputAudioTranscription: {},
  };
}

/**
 * A short-lived, single-use token for one Live session. The browser connects
 * to Gemini directly with it, so audio never transits our server and the real
 * API key never reaches the client.
 */
export async function createLiveToken(schema: string, today?: string) {
  const ai = getGemini();
  const config = liveConfig(schema, today);
  const token = await ai.authTokens.create({
    config: {
      uses: 1,
      expireTime: new Date(Date.now() + 30 * 60_000).toISOString(),
      newSessionExpireTime: new Date(Date.now() + 60_000).toISOString(),
      liveConnectConstraints: { model: LIVE_MODEL, config },
      httpOptions: { apiVersion: "v1alpha" },
    },
  });
  if (!token.name) throw new Error("Gemini did not return a session token.");
  return { token: token.name, model: LIVE_MODEL, config };
}
