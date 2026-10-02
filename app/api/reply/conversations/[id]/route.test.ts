// @vitest-environment node
import { describe, expect, it } from "vitest";
import { DELETE, GET, PATCH } from "./route";

const VALID_ID = "0b6f2f4e-8d1c-4a55-9a7e-3f1d2c9b8a10";

const context = (id: string) => ({ params: Promise.resolve({ id }) });

function patch(id: string, body: string) {
  return PATCH(
    new Request(`http://localhost/api/reply/conversations/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body,
    }),
    context(id),
  );
}

describe("/api/reply/conversations/[id] validation", () => {
  it("answers 404 for an id that is not a uuid, on every method", async () => {
    const req = new Request("http://localhost/api/reply/conversations/12");
    for (const res of [await GET(req, context("12")), await DELETE(req, context("12")), await patch("12", "{}")]) {
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: "That conversation was not found." });
    }
  });

  it("rejects a PATCH body that is not JSON", async () => {
    const res = await patch(VALID_ID, "{nope");
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Invalid JSON body." });
  });

  it("rejects an empty PATCH and bad values", async () => {
    const empty = await patch(VALID_ID, "{}");
    expect(empty.status).toBe(400);
    expect(await empty.json()).toEqual({ error: "Nothing to update." });
    expect((await patch(VALID_ID, JSON.stringify({ context: "family" }))).status).toBe(400);
    expect((await patch(VALID_ID, JSON.stringify({ archived: "yes" }))).status).toBe(400);
    expect((await patch(VALID_ID, JSON.stringify({ title: "a".repeat(121) }))).status).toBe(400);
  });
});
