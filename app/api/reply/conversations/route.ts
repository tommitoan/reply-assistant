import { getDb } from "@/lib/reply/db";
import { conversationCreateSchema, firstIssueMessage } from "@/lib/reply/schemas";
import { createThreadRepo } from "@/lib/reply/thread-store";

export const dynamic = "force-dynamic";

const LIST_LIMIT = 50;

function jsonError(message: string, status: number): Response {
  return Response.json({ error: message }, { status });
}

// ?archived=true lists archived threads; the default is the active ones.
export async function GET(req: Request): Promise<Response> {
  const archived = new URL(req.url).searchParams.get("archived") === "true";
  try {
    const conversations = await createThreadRepo(getDb()).listConversations({ archived, limit: LIST_LIMIT });
    return Response.json({ conversations });
  } catch (err) {
    console.error("[/api/reply/conversations]", err);
    return jsonError("Không tải được danh sách cuộc trò chuyện.", 500);
  }
}

export async function POST(req: Request): Promise<Response> {
  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return jsonError("Dữ liệu gửi lên không hợp lệ.", 400);
  }

  const parsed = conversationCreateSchema.safeParse(payload);
  if (!parsed.success) return jsonError(firstIssueMessage(parsed.error), 400);

  try {
    const conversation = await createThreadRepo(getDb()).createConversation(parsed.data);
    return Response.json({ conversation }, { status: 201 });
  } catch (err) {
    console.error("[/api/reply/conversations]", err);
    return jsonError("Không tạo được cuộc trò chuyện. Bạn thử lại nhé.", 500);
  }
}
