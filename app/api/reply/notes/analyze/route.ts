import { suggestForNote } from "@/lib/reply/notes-ai";
import { createNotesRuntime } from "@/lib/reply/notes-runtime";
import { firstIssueMessage, noteAnalyzeSchema } from "@/lib/reply/schemas";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

function jsonError(message: string, status: number): Response {
  return Response.json({ error: message }, { status });
}

// Suggests an English version, kind, scope and date for a note, so the writer
// can adjust them before saving. Nothing is stored. The note text goes to the
// model, so the page never calls this for a private note.
export async function POST(req: Request): Promise<Response> {
  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return jsonError("Invalid JSON body.", 400);
  }
  const parsed = noteAnalyzeSchema.safeParse(payload);
  if (!parsed.success) return jsonError(firstIssueMessage(parsed.error), 400);

  let runtime;
  try {
    runtime = createNotesRuntime();
  } catch (err) {
    console.error("[/api/reply/notes/analyze]", err);
    return jsonError("The reply assistant is not configured on this server.", 503);
  }

  try {
    if (await runtime.overBudget()) {
      return jsonError("The daily spending limit for replies is reached. It resets at 00:00 UTC.", 429);
    }
    const suggestion = await suggestForNote(runtime.ai, parsed.data.text);
    if (!suggestion) return jsonError("Could not suggest an English version. Write it yourself, or try again.", 502);
    return Response.json({ suggestion });
  } catch (err) {
    console.error("[/api/reply/notes/analyze]", err);
    return jsonError("Could not suggest an English version. Try again.", 500);
  }
}
