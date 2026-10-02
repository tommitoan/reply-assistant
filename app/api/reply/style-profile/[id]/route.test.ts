// @vitest-environment node
import { describe, expect, it } from "vitest";
import { MAX_RULE_CHARS, MAX_RULES } from "@/lib/reply/style-profile";
import { PATCH } from "./route";

const ID = "4f1c3b0e-8a52-4a67-9d6f-0c8e1b2a3d44";
const call = (id: string, body: string) =>
  PATCH(new Request("http://localhost/x", { method: "PATCH", headers: { "Content-Type": "application/json" }, body }), {
    params: Promise.resolve({ id }),
  });

// Only requests turned away before the database is touched are tested here; the
// rest is covered against a real database.
describe("PATCH /api/reply/style-profile/[id] validation", () => {
  it("answers 404 for an id that is not an id", async () => {
    expect((await call("12", JSON.stringify({ rules: ["a"] }))).status).toBe(404);
  });

  it("rejects a body that is not JSON", async () => {
    const res = await call(ID, "{nope");
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Dữ liệu gửi lên không hợp lệ." });
  });

  it("needs a list of text rules", async () => {
    expect((await call(ID, "{}")).status).toBe(400);
    expect((await call(ID, JSON.stringify({ rules: "one rule" }))).status).toBe(400);
    expect((await call(ID, JSON.stringify({ rules: [1, 2] }))).status).toBe(400);
  });

  it("refuses too many rules and a rule that is too long, with the reason", async () => {
    const many = await call(ID, JSON.stringify({ rules: Array.from({ length: MAX_RULES + 1 }, (_, i) => `r${i}`) }));
    expect(many.status).toBe(400);
    expect((await many.json()).error).toContain(`tối đa ${MAX_RULES}`);
    const long = await call(ID, JSON.stringify({ rules: ["x".repeat(MAX_RULE_CHARS + 1)] }));
    expect(long.status).toBe(400);
    expect((await long.json()).error).toContain(`${MAX_RULE_CHARS}`);
  });
});
