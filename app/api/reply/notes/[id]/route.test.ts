// @vitest-environment node
import { describe, expect, it } from "vitest";
import { DELETE, PATCH } from "./route";

const ID = "4f1c3b0e-8a52-4a67-9d6f-0c8e1b2a3d44";
const context = (id: string) => ({ params: Promise.resolve({ id }) });
const patch = (body: string) =>
  new Request(`http://localhost/api/reply/notes/${ID}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body });

describe("/api/reply/notes/[id] validation", () => {
  it("answers 404 for an id that is not an id, before touching anything", async () => {
    expect((await PATCH(patch("{}"), context("nope"))).status).toBe(404);
    expect((await DELETE(new Request("http://localhost/x", { method: "DELETE" }), context("nope"))).status).toBe(404);
  });

  it("rejects a body that is not JSON", async () => {
    const res = await PATCH(patch("{nope"), context(ID));
    expect(res.status).toBe(400);
  });

  it("rejects an empty patch", async () => {
    const res = await PATCH(patch("{}"), context(ID));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Nothing to update.");
  });

  it("rejects a status that belongs to the inbox", async () => {
    const res = await PATCH(patch(JSON.stringify({ status: "dismissed" })), context(ID));
    expect(res.status).toBe(400);
  });

  it("refuses private and pinned together", async () => {
    const res = await PATCH(patch(JSON.stringify({ private: true, pinned: true })), context(ID));
    expect(res.status).toBe(400);
  });
});
