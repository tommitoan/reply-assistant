// @vitest-environment node
import { describe, expect, it } from "vitest";
import { MAX_DIARY_CHARS } from "@/lib/reply/limits";
import { POST } from "./route";

const post = (body: string) =>
  new Request("http://localhost/api/reply/notes/import-preview", { method: "POST", headers: { "Content-Type": "application/json" }, body });

describe("POST /api/reply/notes/import-preview validation", () => {
  it("rejects a body that is not JSON", async () => {
    expect((await POST(post("{nope"))).status).toBe(400);
  });

  it("rejects an empty diary", async () => {
    const res = await POST(post(JSON.stringify({ text: "" })));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("Paste the diary first.");
  });

  it("rejects a diary over the limit, and says how to go on", async () => {
    const res = await POST(post(JSON.stringify({ text: "x".repeat(MAX_DIARY_CHARS + 1) })));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("Split it in parts");
  });
});
