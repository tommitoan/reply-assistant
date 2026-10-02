// @vitest-environment node
import { describe, expect, it } from "vitest";
import { POST } from "./route";

function post(body: string) {
  return POST(
    new Request("http://localhost/api/reply/conversations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    }),
  );
}

describe("POST /api/reply/conversations validation", () => {
  it("rejects a body that is not JSON", async () => {
    const res = await post("{nope");
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Dữ liệu gửi lên không hợp lệ." });
  });

  it("needs a context", async () => {
    const res = await post(JSON.stringify({ title: "Chat" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Yêu cầu không hợp lệ.");
  });

  it("rejects an unknown context and a title that is too long", async () => {
    expect((await post(JSON.stringify({ context: "family" }))).status).toBe(400);
    const long = await post(JSON.stringify({ context: "work", title: "a".repeat(121) }));
    expect(long.status).toBe(400);
    expect((await long.json()).error).toContain("120");
  });
});
