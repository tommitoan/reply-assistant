import { getDb } from "@/lib/reply/db";
import { createReplyRepo } from "@/lib/reply/repo";
import { firstIssueMessage, optionIdSchema, optionPatchSchema } from "@/lib/reply/schemas";

export const dynamic = "force-dynamic";

function jsonError(message: string, status: number): Response {
  return Response.json({ error: message }, { status });
}

// Rate, edit or choose one reply option. Each field is optional; the ones
// present are changed and the saved option is returned.
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const id = optionIdSchema.safeParse((await params).id);
  if (!id.success) return jsonError("That reply was not found.", 404);

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return jsonError("Invalid JSON body.", 400);
  }

  const parsed = optionPatchSchema.safeParse(payload);
  if (!parsed.success) return jsonError(firstIssueMessage(parsed.error), 400);

  try {
    const option = await createReplyRepo(getDb()).updateOption(id.data, parsed.data);
    if (!option) return jsonError("That reply was not found.", 404);
    return Response.json({ option });
  } catch (err) {
    console.error("[/api/reply/options]", err);
    return jsonError("Could not save that. Try again.", 500);
  }
}
