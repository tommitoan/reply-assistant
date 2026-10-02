// @vitest-environment node
import { describe, expect, it } from "vitest";
import { DELETE, POST } from "./route";

function request(method: string, body?: string, url = "http://localhost/api/reply/notes"): Request {
  return new Request(url, { method, headers: { "Content-Type": "application/json" }, body });
}

// Only requests that are turned away before any database, model or key is
// touched are tested here; the rest is covered against a real database.
describe("/api/reply/notes validation", () => {
  it("POST rejects a body that is not JSON", async () => {
    const res = await POST(request("POST", "{nope"));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Dữ liệu gửi lên không hợp lệ." });
  });

  it("POST rejects an empty note", async () => {
    const res = await POST(request("POST", JSON.stringify({ text: "  " })));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("Hãy viết ghi chú trước đã.");
  });

  it("POST refuses a private note that is pinned", async () => {
    const res = await POST(request("POST", JSON.stringify({ text: "a", private: true, pinned: true })));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("không thể ghim");
  });

  it("POST rejects an impossible date", async () => {
    const res = await POST(request("POST", JSON.stringify({ text: "a", kind: "event", happenedOn: "2026-02-30" })));
    expect(res.status).toBe(400);
  });

  it("DELETE does nothing unless every note is asked for explicitly", async () => {
    for (const url of ["http://localhost/api/reply/notes", "http://localhost/api/reply/notes?confirm=yes"]) {
      const res = await DELETE(request("DELETE", undefined, url));
      expect(res.status).toBe(400);
      expect((await res.json()).error).toContain("confirm=all");
    }
  });
});
