import { agentStep, type AgentStepInput } from "@/lib/server/agent";
import { toErrorResponse } from "@/lib/server/config";

// One agent step can take a while at higher effort levels.
export const maxDuration = 300;

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as AgentStepInput;
    if (typeof body.schema !== "string" || !Array.isArray(body.messages) || !body.messages.length) {
      return Response.json({ error: "schema and messages are required" }, { status: 400 });
    }
    return Response.json(await agentStep(body));
  } catch (err) {
    return toErrorResponse(err);
  }
}
