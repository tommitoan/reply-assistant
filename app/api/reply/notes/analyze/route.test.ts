// @vitest-environment node
import { describe, expect, it } from "vitest";
import { POST } from "./route";

const post = (body: string) =>
  new Request("http://localhost/api/reply/notes/analyze", { method: "POST", headers: { "Content-Type": "application/json" }, body });

describe("POST /api/reply/notes/analyze validation", () => {
  it("rejects a body that is not JSON", async () => {
    expect((await POST(post("{nope"))).status).toBe(400);
  });

  it("rejects an empty note before any model call", async () => {
    const res = await POST(post(JSON.stringify({ text: "   " })));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("Write the note first.");
  });
});
