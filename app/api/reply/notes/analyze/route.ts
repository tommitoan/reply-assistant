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
    return jsonError("Dữ liệu gửi lên không hợp lệ.", 400);
  }
  const parsed = noteAnalyzeSchema.safeParse(payload);
  if (!parsed.success) return jsonError(firstIssueMessage(parsed.error), 400);

  let runtime;
  try {
    runtime = createNotesRuntime();
  } catch (err) {
    console.error("[/api/reply/notes/analyze]", err);
    return jsonError("Reply Assistant chưa được cấu hình trên máy chủ này.", 503);
  }

  try {
    if (await runtime.overBudget()) {
      return jsonError("Đã hết hạn mức chi tiêu trong ngày. Hạn mức được đặt lại lúc 00:00 UTC (7:00 sáng giờ Việt Nam).", 429);
    }
    const suggestion = await suggestForNote(runtime.ai, parsed.data.text);
    if (!suggestion) return jsonError("Không gợi ý được bản tiếng Anh. Bạn tự viết hoặc thử lại nhé.", 502);
    return Response.json({ suggestion });
  } catch (err) {
    console.error("[/api/reply/notes/analyze]", err);
    return jsonError("Không gợi ý được bản tiếng Anh. Hãy thử lại.", 500);
  }
}
