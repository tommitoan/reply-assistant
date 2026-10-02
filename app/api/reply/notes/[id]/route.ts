import { getDb } from "@/lib/reply/db";
import { createNotesRuntime } from "@/lib/reply/notes-runtime";
import { updateNote } from "@/lib/reply/notes-service";
import { createNotesRepo } from "@/lib/reply/notes-store";
import { firstIssueMessage, notePatchSchema, optionIdSchema } from "@/lib/reply/schemas";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

type Context = { params: Promise<{ id: string }> };

const NOT_FOUND = "That note was not found.";

function jsonError(message: string, status: number): Response {
  return Response.json({ error: message }, { status });
}

// Edits a note: text, English version, kind, date, scope, pin, private, archive.
export async function PATCH(req: Request, { params }: Context): Promise<Response> {
  const id = optionIdSchema.safeParse((await params).id);
  if (!id.success) return jsonError(NOT_FOUND, 404);

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return jsonError("Invalid JSON body.", 400);
  }
  const parsed = notePatchSchema.safeParse(payload);
  if (!parsed.success) return jsonError(firstIssueMessage(parsed.error), 400);

  let runtime;
  try {
    runtime = createNotesRuntime();
  } catch (err) {
    console.error("[/api/reply/notes/[id]]", err);
    return jsonError("The reply assistant is not configured on this server.", 503);
  }

  try {
    const result = await updateNote(runtime.service, id.data, parsed.data);
    if (!result.ok) return jsonError(result.error, result.status);
    return Response.json({ note: result.value });
  } catch (err) {
    console.error("[/api/reply/notes/[id]]", err);
    return jsonError("Could not save that. Try again.", 500);
  }
}

// Deletes a note and every embedding made from it.
export async function DELETE(_req: Request, { params }: Context): Promise<Response> {
  const id = optionIdSchema.safeParse((await params).id);
  if (!id.success) return jsonError(NOT_FOUND, 404);
  try {
    const removed = await createNotesRepo(getDb()).remove(id.data);
    return removed ? new Response(null, { status: 204 }) : jsonError(NOT_FOUND, 404);
  } catch (err) {
    console.error("[/api/reply/notes/[id]]", err);
    return jsonError("Could not delete that. Try again.", 500);
  }
}
