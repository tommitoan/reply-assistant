// @vitest-environment node
import { describe, expect, it } from "vitest";
import { POST } from "./route";

const ID = "4f1c3b0e-8a52-4a67-9d6f-0c8e1b2a3d44";
const call = (id: string, body?: string) =>
  POST(new Request("http://localhost/x", { method: "POST", headers: { "Content-Type": "application/json" }, body }), {
    params: Promise.resolve({ id }),
  });

// Only requests turned away before any database, model or key is touched are
// tested here; the rest is covered against a real database.
describe("/api/reply/notes/[id]/review validation", () => {
  it("answers 404 for an id that is not an id", async () => {
    const res = await call("nope", JSON.stringify({ decision: "dismiss" }));
    expect(res.status).toBe(404);
  });

  it("rejects a body that is not JSON", async () => {
    const res = await call(ID, "{nope");
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Invalid JSON body." });
  });

  it("rejects an unknown decision and a private note that is pinned", async () => {
    expect((await call(ID, JSON.stringify({ decision: "archive" }))).status).toBe(400);
    const pinnedPrivate = await call(ID, JSON.stringify({ decision: "approve", changes: { private: true, pinned: true } }));
    expect(pinnedPrivate.status).toBe(400);
    expect((await pinnedPrivate.json()).error).toContain("cannot be pinned");
  });
});
