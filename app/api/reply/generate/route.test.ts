// @vitest-environment node
import { describe, expect, it } from "vitest";
import { POST } from "./route";

function post(body: string): Request {
  return new Request("http://localhost/api/reply/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });
}

describe("POST /api/reply/generate validation", () => {
  it("rejects a body that is not JSON", async () => {
    const res = await POST(post("{nope"));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Invalid JSON body." });
  });

  it("rejects empty input before touching the model or database", async () => {
    const res = await POST(post(JSON.stringify({ mode: "vi_to_en", input: "  ", context: "work" })));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "input: Write what you want to say first." });
  });

  it("rejects an unsupported mode", async () => {
    const res = await POST(post(JSON.stringify({ mode: "translate", input: "hi", context: "work" })));
    expect(res.status).toBe(400);
  });

  it("asks for a conversation when a chat is pasted without one", async () => {
    const res = await POST(post(JSON.stringify({ mode: "en_reply", input: "Hi, are you free?", context: "work" })));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "conversationId: Choose or start a conversation first." });
  });

  it("rejects input over the length limit", async () => {
    const res = await POST(
      post(JSON.stringify({ mode: "vi_to_en", input: "a".repeat(4001), context: "work" })),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("4000");
  });
});

describe("POST /api/reply/generate with a refine part", () => {
  const OPTION = "4f1c3b0e-8a52-4a67-9d6f-0c8e1b2a3d44";

  it("rejects a refine body with no direction before touching the model or database", async () => {
    const res = await POST(post(JSON.stringify({ refine: { optionId: OPTION } })));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "refine.instruction: Say how to develop it, or choose a quick direction.",
    });
  });

  it("asks for the detail when a personal detail is chosen without one", async () => {
    const res = await POST(post(JSON.stringify({ refine: { optionId: OPTION, preset: "personal_detail" } })));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("Write the detail to add.");
  });

  it("rejects an option id that is not an id", async () => {
    const res = await POST(post(JSON.stringify({ refine: { optionId: "nope", preset: "longer" } })));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("That reply was not found.");
  });
});
