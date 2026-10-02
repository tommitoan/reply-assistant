import { splitDiary } from "@/lib/reply/notes-ai";
import { createNotesRuntime } from "@/lib/reply/notes-runtime";
import { diaryImportSchema, firstIssueMessage } from "@/lib/reply/schemas";

export const dynamic = "force-dynamic";
// A long diary makes a long answer.
export const maxDuration = 60;

function jsonError(message: string, status: number): Response {
  return Response.json({ error: message }, { status });
}

// Splits a pasted diary into candidate notes for the writer to review. Nothing
// is stored: the writer ticks, edits and saves them with /api/reply/notes/batch.
export async function POST(req: Request): Promise<Response> {
  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return jsonError("Invalid JSON body.", 400);
  }
  const parsed = diaryImportSchema.safeParse(payload);
  if (!parsed.success) return jsonError(firstIssueMessage(parsed.error), 400);

  let runtime;
  try {
    runtime = createNotesRuntime();
  } catch (err) {
    console.error("[/api/reply/notes/import-preview]", err);
    return jsonError("The reply assistant is not configured on this server.", 503);
  }

  try {
    if (await runtime.overBudget()) {
      return jsonError("The daily spending limit for replies is reached. It resets at 00:00 UTC.", 429);
    }
    const drafts = await splitDiary(runtime.ai, parsed.data.text);
    if (!drafts) return jsonError("Could not split the diary. Try again, or add the notes one by one.", 502);
    return Response.json({ drafts });
  } catch (err) {
    console.error("[/api/reply/notes/import-preview]", err);
    return jsonError("Could not split the diary. Try again.", 500);
  }
}
