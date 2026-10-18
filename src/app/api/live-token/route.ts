import { toErrorResponse } from "@/lib/server/config";
import { createLiveToken } from "@/lib/server/live";

/** Issues a single-use Gemini Live session token with the dataset context baked in. */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { schema?: string; today?: string };
    if (typeof body.schema !== "string" || !body.schema.trim()) return Response.json({ error: "schema is required" }, { status: 400 });
    if (body.schema.length > 60_000) return Response.json({ error: "schema is too large" }, { status: 400 });
    return Response.json(await createLiveToken(body.schema, body.today));
  } catch (err) {
    return toErrorResponse(err);
  }
}
