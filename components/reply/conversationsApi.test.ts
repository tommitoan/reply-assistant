import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createConversation,
  deleteConversation,
  getConversation,
  listConversations,
  patchConversation,
} from "./conversationsApi";

const fetchMock = vi.fn();

const json = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body });

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("conversationsApi", () => {
  it("lists conversations", async () => {
    fetchMock.mockResolvedValue(json({ conversations: [{ id: "a" }] }));
    expect(await listConversations()).toEqual([{ id: "a" }]);
    expect(fetchMock).toHaveBeenCalledWith("/api/reply/conversations", undefined);
  });

  it("creates a conversation with the context", async () => {
    fetchMock.mockResolvedValue(json({ conversation: { id: "new" } }, 201));
    expect(await createConversation("casual")).toEqual({ id: "new" });
    expect(fetchMock).toHaveBeenCalledWith("/api/reply/conversations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ context: "casual" }),
    });
  });

  it("loads one conversation", async () => {
    fetchMock.mockResolvedValue(json({ conversation: { id: "a", messages: [] } }));
    expect(await getConversation("a")).toEqual({ id: "a", messages: [] });
    expect(fetchMock.mock.calls[0][0]).toBe("/api/reply/conversations/a");
  });

  it("patches a conversation", async () => {
    fetchMock.mockResolvedValue(json({ conversation: { id: "a", title: "T" } }));
    await patchConversation("a", { title: "T" });
    expect(fetchMock).toHaveBeenCalledWith("/api/reply/conversations/a", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "T" }),
    });
  });

  it("deletes a conversation, which answers with no body", async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 204, json: async () => Promise.reject(new Error("no body")) });
    await expect(deleteConversation("a")).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledWith("/api/reply/conversations/a", { method: "DELETE" });
  });

  it("throws the server's message when a request is rejected", async () => {
    fetchMock.mockResolvedValue(json({ error: "That conversation was not found." }, 404));
    await expect(getConversation("a")).rejects.toThrow("That conversation was not found.");
  });

  it("explains an expired session", async () => {
    fetchMock.mockResolvedValue(json({ error: "unauthorized" }, 401));
    await expect(listConversations()).rejects.toThrow(/phiên đăng nhập đã hết hạn/i);
  });

  it("uses a generic message when the error body cannot be read", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500, json: async () => Promise.reject(new Error("x")) });
    await expect(listConversations()).rejects.toThrow("Không tải được danh sách cuộc trò chuyện.");
  });

  it("reports a network failure in plain words", async () => {
    fetchMock.mockRejectedValue(new TypeError("offline"));
    await expect(listConversations()).rejects.toThrow(/không kết nối được với máy chủ/i);
  });
});
