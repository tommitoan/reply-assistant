import { getDb } from "@/lib/reply/db";
import { conversationPatchSchema, firstIssueMessage, optionIdSchema } from "@/lib/reply/schemas";
import { createThreadRepo } from "@/lib/reply/thread-store";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

function jsonError(message: string, status: number): Response {
  return Response.json({ error: message }, { status });
}

const NOT_FOUND = "That conversation was not found.";

// The thread with all of its messages.
export async function GET(_req: Request, { params }: Context): Promise<Response> {
  const id = optionIdSchema.safeParse((await params).id);
  if (!id.success) return jsonError(NOT_FOUND, 404);

  try {
    const repo = createThreadRepo(getDb());
    const conversation = await repo.getConversation(id.data);
    if (!conversation) return jsonError(NOT_FOUND, 404);
    return Response.json({ conversation: { ...conversation, messages: await repo.getMessages(id.data) } });
  } catch (err) {
    console.error("[/api/reply/conversations/[id]]", err);
    return jsonError("Could not load the conversation.", 500);
  }
}

// Rename, change the context, or archive.
export async function PATCH(req: Request, { params }: Context): Promise<Response> {
  const id = optionIdSchema.safeParse((await params).id);
  if (!id.success) return jsonError(NOT_FOUND, 404);

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return jsonError("Invalid JSON body.", 400);
  }

  const parsed = conversationPatchSchema.safeParse(payload);
  if (!parsed.success) return jsonError(firstIssueMessage(parsed.error), 400);

  try {
    const conversation = await createThreadRepo(getDb()).updateConversation(id.data, parsed.data);
    if (!conversation) return jsonError(NOT_FOUND, 404);
    return Response.json({ conversation });
  } catch (err) {
    console.error("[/api/reply/conversations/[id]]", err);
    return jsonError("Could not save that. Try again.", 500);
  }
}

// Deletes the thread, its messages, and the requests made in it.
export async function DELETE(_req: Request, { params }: Context): Promise<Response> {
  const id = optionIdSchema.safeParse((await params).id);
  if (!id.success) return jsonError(NOT_FOUND, 404);

  try {
    const deleted = await createThreadRepo(getDb()).deleteConversation(id.data);
    return deleted ? new Response(null, { status: 204 }) : jsonError(NOT_FOUND, 404);
  } catch (err) {
    console.error("[/api/reply/conversations/[id]]", err);
    return jsonError("Could not delete that. Try again.", 500);
  }
}
