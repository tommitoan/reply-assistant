import type { ConversationDetail, ConversationListItem, ConversationRecord, ReplyContext } from "@/lib/reply/types";

async function errorMessage(res: Response, fallback: string): Promise<string> {
  if (res.status === 401) return "Phiên đăng nhập đã hết hạn. Hãy tải lại trang để đăng nhập lại.";
  try {
    const body = (await res.json()) as { error?: unknown };
    if (typeof body.error === "string") return body.error;
  } catch {
    // Not JSON; use the fallback.
  }
  return fallback;
}

// Each call resolves to the data, or throws an Error whose message is safe to show.
async function request<T>(url: string, init: RequestInit | undefined, fallback: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch {
    throw new Error("Không kết nối được với máy chủ. Hãy kiểm tra kết nối rồi thử lại.");
  }
  if (!res.ok) throw new Error(await errorMessage(res, fallback));
  return (res.status === 204 ? undefined : await res.json()) as T;
}

const JSON_HEADERS = { "Content-Type": "application/json" };

export async function listConversations(): Promise<ConversationListItem[]> {
  const body = await request<{ conversations: ConversationListItem[] }>(
    "/api/reply/conversations",
    undefined,
    "Không tải được danh sách cuộc trò chuyện.",
  );
  return body.conversations;
}

export async function createConversation(context: ReplyContext): Promise<ConversationRecord> {
  const body = await request<{ conversation: ConversationRecord }>(
    "/api/reply/conversations",
    { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ context }) },
    "Không tạo được cuộc trò chuyện.",
  );
  return body.conversation;
}

export async function getConversation(id: string): Promise<ConversationDetail> {
  const body = await request<{ conversation: ConversationDetail }>(
    `/api/reply/conversations/${id}`,
    undefined,
    "Không tải được cuộc trò chuyện.",
  );
  return body.conversation;
}

export async function patchConversation(
  id: string,
  patch: { title?: string; context?: ReplyContext; archived?: boolean },
): Promise<ConversationRecord> {
  const body = await request<{ conversation: ConversationRecord }>(
    `/api/reply/conversations/${id}`,
    { method: "PATCH", headers: JSON_HEADERS, body: JSON.stringify(patch) },
    "Không lưu được.",
  );
  return body.conversation;
}

export async function deleteConversation(id: string): Promise<void> {
  await request<void>(`/api/reply/conversations/${id}`, { method: "DELETE" }, "Không xóa được.");
}
