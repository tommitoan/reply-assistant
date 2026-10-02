import { createNotes } from "@/lib/reply/notes-service";
import { createNotesRuntime } from "@/lib/reply/notes-runtime";
import { firstIssueMessage, noteBatchSchema } from "@/lib/reply/schemas";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function jsonError(message: string, status: number): Response {
  return Response.json({ error: message }, { status });
}

// Saves the notes the writer ticked in the diary preview. All of their texts
// are embedded in one request.
export async function POST(req: Request): Promise<Response> {
  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return jsonError("Dữ liệu gửi lên không hợp lệ.", 400);
  }
  const parsed = noteBatchSchema.safeParse(payload);
  if (!parsed.success) return jsonError(firstIssueMessage(parsed.error), 400);

  let runtime;
  try {
    runtime = createNotesRuntime();
  } catch (err) {
    console.error("[/api/reply/notes/batch]", err);
    return jsonError("Reply Assistant chưa được cấu hình trên máy chủ này.", 503);
  }

  try {
    const result = await createNotes(runtime.service, parsed.data.notes, "imported");
    if (!result.ok) return jsonError(result.error, result.status);
    return Response.json({ notes: result.value }, { status: 201 });
  } catch (err) {
    console.error("[/api/reply/notes/batch]", err);
    return jsonError("Không lưu được các ghi chú. Hãy thử lại.", 500);
  }
}
