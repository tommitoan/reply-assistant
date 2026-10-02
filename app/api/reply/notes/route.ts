import { after } from "next/server";
import { createNotes } from "@/lib/reply/notes-service";
import { createNotesRuntime } from "@/lib/reply/notes-runtime";
import { createNotesRepo } from "@/lib/reply/notes-store";
import { getDb } from "@/lib/reply/db";
import { firstIssueMessage, noteFilterSchema, noteInputSchema } from "@/lib/reply/schemas";

export const dynamic = "force-dynamic";
// Saving a note may call a model and the embedding service once each.
export const maxDuration = 30;

const LIST_LIMIT = 500;

function jsonError(message: string, status: number): Response {
  return Response.json({ error: message }, { status });
}

// The notes (pinned first, then newest) with counts. ?status=active|archived|all
// and ?scope= ?kind= ?pinned= ?private= narrow the list.
export async function GET(req: Request): Promise<Response> {
  const params = Object.fromEntries(new URL(req.url).searchParams);
  const filter = noteFilterSchema.parse(params);
  try {
    const repo = createNotesRepo(getDb());
    const [notes, counts] = await Promise.all([repo.list(filter, LIST_LIMIT), repo.counts()]);
    // Notes saved while the embedding budget was spent catch up here, after the
    // page has its answer. It costs one request to the provider at most.
    if (counts.unindexed > 0) {
      try {
        const runtime = createNotesRuntime();
        after(() => runtime.indexPending());
      } catch {
        // Not configured on this server: the page still works without indexing.
      }
    }
    return Response.json({ notes, counts });
  } catch (err) {
    console.error("[/api/reply/notes]", err);
    return jsonError("Could not load the notes.", 500);
  }
}

// Saves one note the writer typed. Without an English version, the model writes one.
export async function POST(req: Request): Promise<Response> {
  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return jsonError("Invalid JSON body.", 400);
  }
  const parsed = noteInputSchema.safeParse(payload);
  if (!parsed.success) return jsonError(firstIssueMessage(parsed.error), 400);

  let runtime;
  try {
    runtime = createNotesRuntime();
  } catch (err) {
    console.error("[/api/reply/notes]", err);
    return jsonError("The reply assistant is not configured on this server.", 503);
  }

  try {
    const result = await createNotes(runtime.service, [parsed.data], "manual");
    if (!result.ok) return jsonError(result.error, result.status);
    return Response.json({ note: result.value[0] }, { status: 201 });
  } catch (err) {
    console.error("[/api/reply/notes]", err);
    return jsonError("Could not save the note. Try again.", 500);
  }
}

// Deletes every note. It has to be asked for in the URL: ?confirm=all.
export async function DELETE(req: Request): Promise<Response> {
  if (new URL(req.url).searchParams.get("confirm") !== "all") {
    return jsonError("Add ?confirm=all to delete every note.", 400);
  }
  try {
    const deleted = await createNotesRepo(getDb()).removeAll();
    return Response.json({ deleted });
  } catch (err) {
    console.error("[/api/reply/notes]", err);
    return jsonError("Could not delete the notes. Try again.", 500);
  }
}
