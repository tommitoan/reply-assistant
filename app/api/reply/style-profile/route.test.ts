// @vitest-environment node
import { describe, expect, it } from "vitest";
import { PATCH } from "./route";

function patch(body: string) {
  return PATCH(
    new Request("http://localhost/api/reply/style-profile", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body,
    }),
  );
}

describe("PATCH /api/reply/style-profile validation", () => {
  it("rejects a body that is not JSON", async () => {
    const res = await patch("{nope");
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Invalid JSON body." });
  });

  it("needs activeId, which is a profile id or null", async () => {
    expect((await patch("{}")).status).toBe(400);
    expect((await patch(JSON.stringify({ activeId: "12" }))).status).toBe(400);
    expect((await patch(JSON.stringify({ activeId: 5 }))).status).toBe(400);
    expect((await patch(JSON.stringify({ activeId: "' or 1=1 --" }))).status).toBe(400);
  });
});
