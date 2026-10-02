import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { EMPTY_FEEDBACK } from "@/lib/reply/feedback-state";
import { useOptionFeedback } from "./useOptionFeedback";

const fetchMock = vi.fn();

function okResponse(option: Record<string, unknown>) {
  return { ok: true, status: 200, json: async () => ({ option }) };
}

function failResponse(status: number, error?: string) {
  return { ok: false, status, json: async () => (error ? { error } : Promise.reject(new Error("no body"))) };
}

function mounted() {
  const hook = renderHook(() => useOptionFeedback());
  act(() => hook.result.current.load([{ id: "a", generationId: "g1", ...EMPTY_FEEDBACK }]));
  return hook;
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useOptionFeedback.save", () => {
  it("sends a PATCH and keeps what the server confirms", async () => {
    fetchMock.mockResolvedValue(okResponse({ id: "a", rating: "good", editedText: null, chosen: false }));
    const { result } = mounted();

    let ok = false;
    await act(async () => {
      ok = await result.current.save("a", { rating: "good" });
    });

    expect(ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith("/api/reply/options/a", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rating: "good" }),
    });
    expect(result.current.items.a.saved.rating).toBe("good");
    expect(result.current.items.a.pending).toBe(false);
  });

  it("shows the change before the server answers", async () => {
    let finish: (value: unknown) => void = () => {};
    fetchMock.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    const { result } = mounted();

    let saving: Promise<boolean> = Promise.resolve(false);
    act(() => {
      saving = result.current.save("a", { rating: "bad" });
    });
    expect(result.current.items.a.shown.rating).toBe("bad");
    expect(result.current.items.a.saved.rating).toBeNull();
    expect(result.current.items.a.pending).toBe(true);

    await act(async () => {
      finish(okResponse({ id: "a", rating: "bad", editedText: null, chosen: false }));
      await saving;
    });
    expect(result.current.items.a.pending).toBe(false);
  });

  it("rolls back and reports the server's message when a save is rejected", async () => {
    fetchMock.mockResolvedValue(failResponse(400, "Write the edited reply first."));
    const { result } = mounted();

    let ok = true;
    await act(async () => {
      ok = await result.current.save("a", { editedText: "x" });
    });

    expect(ok).toBe(false);
    expect(result.current.items.a.shown).toEqual(EMPTY_FEEDBACK);
    expect(result.current.items.a.error).toBe("Write the edited reply first.");
  });

  it("explains an expired session", async () => {
    fetchMock.mockResolvedValue(failResponse(401));
    const { result } = mounted();
    await act(async () => {
      await result.current.save("a", { chosen: true });
    });
    expect(result.current.items.a.error).toMatch(/phiên đăng nhập đã hết hạn/i);
  });

  it("uses a generic message when the error body cannot be read", async () => {
    fetchMock.mockResolvedValue(failResponse(500));
    const { result } = mounted();
    await act(async () => {
      await result.current.save("a", { chosen: true });
    });
    expect(result.current.items.a.error).toBe("Không lưu được. Bạn thử lại nhé.");
  });

  it("rolls back on a network failure", async () => {
    fetchMock.mockRejectedValue(new TypeError("offline"));
    const { result } = mounted();
    await act(async () => {
      await result.current.save("a", { rating: "good" });
    });
    expect(result.current.items.a.shown.rating).toBeNull();
    expect(result.current.items.a.error).toMatch(/kết nối/i);
  });

  it("does not send a second request for the same option while one is in flight", async () => {
    let finish: (value: unknown) => void = () => {};
    fetchMock.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    const { result } = mounted();

    let first: Promise<boolean> = Promise.resolve(false);
    let second = true;
    await act(async () => {
      first = result.current.save("a", { rating: "good" });
      second = await result.current.save("a", { rating: "bad" });
    });
    expect(second).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      finish(okResponse({ id: "a", rating: "good", editedText: null, chosen: false }));
      await first;
    });
  });

  it("lets the error be dismissed", async () => {
    fetchMock.mockResolvedValue(failResponse(500, "boom"));
    const { result } = mounted();
    await act(async () => {
      await result.current.save("a", { chosen: true });
    });
    act(() => result.current.dismissError("a"));
    expect(result.current.items.a.error).toBeNull();
  });
});
