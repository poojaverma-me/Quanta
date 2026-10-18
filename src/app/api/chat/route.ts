import type { Content } from "@google/genai";
import { chatStep } from "@/lib/server/chat";
import { toErrorResponse } from "@/lib/server/config";

export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { schema?: string; contents?: Content[]; today?: string };
    if (typeof body.schema !== "string" || !Array.isArray(body.contents) || !body.contents.length) {
      return Response.json({ error: "schema and contents are required" }, { status: 400 });
    }
    return Response.json(await chatStep(body.schema, body.contents, body.today));
  } catch (err) {
    return toErrorResponse(err);
  }
}
