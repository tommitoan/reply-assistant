// @vitest-environment node
import { describe, expect, it } from "vitest";
import { MAX_NOTES_PER_BATCH } from "@/lib/reply/limits";
import { POST } from "./route";

const post = (body: string) =>
  new Request("http://localhost/api/reply/notes/batch", { method: "POST", headers: { "Content-Type": "application/json" }, body });

describe("POST /api/reply/notes/batch validation", () => {
  it("rejects a body that is not JSON", async () => {
    expect((await POST(post("{nope"))).status).toBe(400);
  });

  it("needs at least one note", async () => {
    const res = await POST(post(JSON.stringify({ notes: [] })));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("Choose at least one note.");
  });

  it("limits how many notes are saved at once", async () => {
    const notes = Array.from({ length: MAX_NOTES_PER_BATCH + 1 }, () => ({ text: "a" }));
    const res = await POST(post(JSON.stringify({ notes })));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain(String(MAX_NOTES_PER_BATCH));
  });

  it("rejects the whole batch when a note is empty", async () => {
    expect((await POST(post(JSON.stringify({ notes: [{ text: "a" }, { text: " " }] })))).status).toBe(400);
  });
});
