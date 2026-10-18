import { toErrorResponse } from "@/lib/server/config";
import { profileDataset, type ProfileInput } from "@/lib/server/profile";

export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as ProfileInput;
    if (!Array.isArray(body.headers) || !body.headers.length || !Array.isArray(body.rows)) {
      return Response.json({ error: "headers and rows are required" }, { status: 400 });
    }
    if (body.headers.length > 300) return Response.json({ error: "Too many columns (max 300)." }, { status: 400 });
    const input: ProfileInput = {
      fileName: String(body.fileName ?? "data.csv").slice(0, 200),
      headers: body.headers.map(String),
      detectedTypes: Array.isArray(body.detectedTypes) ? body.detectedTypes.map(String) : [],
      rows: body.rows.slice(0, 25),
      rowCount: Number(body.rowCount) || body.rows.length,
      ranges: body.ranges && typeof body.ranges === "object" ? body.ranges : undefined,
    };
    return Response.json(await profileDataset(input));
  } catch (err) {
    return toErrorResponse(err);
  }
}
