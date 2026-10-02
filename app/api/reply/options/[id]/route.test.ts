// @vitest-environment node
import { describe, expect, it } from "vitest";
import { PATCH } from "./route";

const VALID_ID = "0b6f2f4e-8d1c-4a55-9a7e-3f1d2c9b8a10";

function patch(id: string, body: string) {
  return PATCH(
    new Request(`http://localhost/api/reply/options/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body,
    }),
    { params: Promise.resolve({ id }) },
  );
}

describe("PATCH /api/reply/options/[id] validation", () => {
  it("answers 404 for an id that is not a uuid, without reading the body", async () => {
    const res = await patch("12", "{}");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Không tìm thấy bản nháp này." });
  });

  it("rejects a body that is not JSON", async () => {
    const res = await patch(VALID_ID, "{nope");
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Dữ liệu gửi lên không hợp lệ." });
  });

  it("rejects an empty update", async () => {
    const res = await patch(VALID_ID, "{}");
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Không có gì để cập nhật." });
  });

  it("rejects an unknown rating", async () => {
    const res = await patch(VALID_ID, JSON.stringify({ rating: "great" }));
    expect(res.status).toBe(400);
  });

  it("rejects a blank edit", async () => {
    const res = await patch(VALID_ID, JSON.stringify({ editedText: "   " }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("Hãy viết bản nháp đã sửa trước đã.");
  });
});
