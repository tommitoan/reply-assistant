import { createNotesRuntime } from "@/lib/reply/notes-runtime";
import { reviewSuggestion } from "@/lib/reply/notes-service";
import { firstIssueMessage, optionIdSchema, suggestionReviewSchema } from "@/lib/reply/schemas";

export const dynamic = "force-dynamic";
// Approving may call a model and the embedding service once each.
export const maxDuration = 30;

type Context = { params: Promise<{ id: string }> };

function jsonError(message: string, status: number): Response {
  return Response.json({ error: message }, { status });
}

// Approves (optionally with edits) or dismisses one suggested note.
export async function POST(req: Request, { params }: Context): Promise<Response> {
  const id = optionIdSchema.safeParse((await params).id);
  if (!id.success) return jsonError("Không tìm thấy ghi chú gợi ý này.", 404);

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return jsonError("Dữ liệu gửi lên không hợp lệ.", 400);
  }
  const parsed = suggestionReviewSchema.safeParse(payload);
  if (!parsed.success) return jsonError(firstIssueMessage(parsed.error), 400);

  let runtime;
  try {
    runtime = createNotesRuntime();
  } catch (err) {
    console.error("[/api/reply/notes/[id]/review]", err);
    return jsonError("Reply Assistant chưa được cấu hình trên máy chủ này.", 503);
  }

  try {
    const result = await reviewSuggestion(runtime.service, id.data, parsed.data);
    if (!result.ok) return jsonError(result.error, result.status);
    return Response.json({ note: result.value });
  } catch (err) {
    console.error("[/api/reply/notes/[id]/review]", err);
    return jsonError("Không lưu được thay đổi này. Hãy thử lại.", 500);
  }
}
