import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { StyleProfileRecord } from "@/lib/reply/types";
import StyleProfilePanel, { rulesOf } from "./StyleProfilePanel";

function profile(version: number, overrides: Partial<StyleProfileRecord> = {}): StyleProfileRecord {
  return {
    id: `p${version}`,
    version,
    rules: `- Rule A of ${version}\n- Rule B of ${version}`,
    model: "claude-sonnet-5-5",
    active: false,
    createdAt: "2026-10-01T10:00:00.000Z",
    sourceCounts: { edited: 4, liked: 3, disliked: 1 },
    ...overrides,
  };
}

const fetchMock = vi.fn();
let calls: Array<{ url: string; method: string; body?: string }>;
let state: { profiles: StyleProfileRecord[] };
let failEdit: { status: number; error: string } | null;

function listing() {
  return { profiles: state.profiles, active: state.profiles.find((p) => p.active) ?? null };
}

beforeEach(() => {
  calls = [];
  failEdit = null;
  state = { profiles: [] };
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    calls.push({ url, method, body: init?.body as string | undefined });
    if (method === "GET") return Response.json(listing());
    if (method === "POST") {
      const created = profile(state.profiles.length + 1);
      state.profiles = [created, ...state.profiles];
      return Response.json({ profile: created, ...listing() }, { status: 201 });
    }
    const edit = /^\/api\/reply\/style-profile\/([^/]+)$/.exec(url);
    if (edit) {
      if (failEdit) return Response.json({ error: failEdit.error }, { status: failEdit.status });
      const { rules } = JSON.parse(init?.body as string) as { rules: string[] };
      state.profiles = state.profiles.map((p) => (p.id === edit[1] ? { ...p, rules: rules.map((r) => `- ${r}`).join("\n") } : p));
      return Response.json(listing());
    }
    const { activeId } = JSON.parse(init?.body as string) as { activeId: string | null };
    state.profiles = state.profiles.map((p) => ({ ...p, active: p.id === activeId }));
    return Response.json(listing());
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("rulesOf", () => {
  it("lists the rules without their dashes", () => {
    expect(rulesOf(profile(1, { rules: "- First.\n-  Second.\n\n- Third." }))).toEqual(["First.", "Second.", "Third."]);
  });
});

describe("StyleProfilePanel", () => {
  it("says no profile is in use when none is switched on", async () => {
    render(<StyleProfilePanel />);
    expect(await screen.findByText(/chưa bật hồ sơ phong cách nào/i)).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Các phiên bản" })).not.toBeInTheDocument();
  });

  it("shows the rules in use, how they were made, and every version", async () => {
    state.profiles = [profile(2, { active: true }), profile(1)];
    render(<StyleProfilePanel />);
    const inUse = within(await screen.findByRole("region", { name: "Đang dùng" }));
    expect(inUse.getByText(/Phiên bản 2, từ 4 bản đã sửa, 3 bản thích, 1 bản không thích/)).toBeInTheDocument();
    expect(inUse.getByText("Rule A of 2")).toBeInTheDocument();
    const versions = within(screen.getByRole("region", { name: "Các phiên bản" }));
    expect(versions.getByText("Phiên bản 1")).toBeInTheDocument();
    expect(versions.getByText("Đang dùng")).toBeInTheDocument();
  });

  it("builds a profile and shows it as new but not switched on", async () => {
    render(<StyleProfilePanel />);
    fireEvent.click(await screen.findByRole("button", { name: /tạo phiên bản mới/i }));

    expect(await screen.findByText("Mới tạo, chưa bật")).toBeInTheDocument();
    expect(calls).toContainEqual({ url: "/api/reply/style-profile", method: "POST", body: undefined });
    expect(screen.getByText(/chưa bật hồ sơ phong cách nào/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Bật phiên bản này" })).toBeInTheDocument();
  });

  it("switches a version on, then off", async () => {
    state.profiles = [profile(1)];
    render(<StyleProfilePanel />);
    fireEvent.click(await screen.findByRole("button", { name: "Bật phiên bản này" }));

    expect(await screen.findByText(/được đặt vào mọi yêu cầu/i)).toBeInTheDocument();
    expect(JSON.parse(calls.at(-1)!.body!)).toEqual({ activeId: "p1" });

    fireEvent.click(screen.getByRole("button", { name: "Tắt hồ sơ này" }));
    await waitFor(() => expect(screen.getByText(/chưa bật hồ sơ phong cách nào/i)).toBeInTheDocument());
    expect(JSON.parse(calls.at(-1)!.body!)).toEqual({ activeId: null });
  });

  it("shows the server's reason when a profile cannot be built", async () => {
    fetchMock.mockImplementation(async (_url: string, init?: RequestInit) => {
      if ((init?.method ?? "GET") === "POST") {
        return Response.json({ error: "Chưa đủ bản nháp đã sửa hoặc đánh giá: mới có 2 trên 5 cần thiết." }, { status: 422 });
      }
      return Response.json({ profiles: [], active: null });
    });
    render(<StyleProfilePanel />);
    fireEvent.click(await screen.findByRole("button", { name: /tạo phiên bản mới/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent("2 trên 5");
  });

  it("disables the buttons while a build is running", async () => {
    let finish: (value: Response) => void = () => {};
    fetchMock.mockImplementation((_url: string, init?: RequestInit) =>
      (init?.method ?? "GET") === "POST"
        ? new Promise<Response>((resolve) => (finish = resolve))
        : Promise.resolve(Response.json({ profiles: [], active: null })),
    );
    render(<StyleProfilePanel />);
    fireEvent.click(await screen.findByRole("button", { name: /tạo phiên bản mới/i }));
    expect(await screen.findByRole("button", { name: "Đang tạo…" })).toBeDisabled();
    finish(Response.json({ error: "x" }, { status: 500 }));
    await waitFor(() => expect(screen.getByRole("button", { name: /tạo phiên bản mới/i })).toBeEnabled());
  });

  it("reports a load failure and can try again", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ error: "Không tải được các hồ sơ phong cách." }, { status: 500 }));
    render(<StyleProfilePanel />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Không tải được các hồ sơ phong cách.");
    fetchMock.mockImplementation(async () => Response.json({ profiles: [], active: null }));
    fireEvent.click(screen.getByRole("button", { name: "Thử lại" }));
    expect(await screen.findByText(/chưa bật hồ sơ phong cách nào/i)).toBeInTheDocument();
  });

  describe("editing the rules of a version", () => {
    const edits = () => calls.filter((c) => c.url !== "/api/reply/style-profile" && c.method === "PATCH");

    async function openEditor(profiles: StyleProfileRecord[] = [profile(1)]) {
      state.profiles = profiles;
      render(<StyleProfilePanel />);
      fireEvent.click(await screen.findByRole("button", { name: "Sửa quy tắc" }));
      return within(await screen.findByRole("group", { name: "Sửa quy tắc của phiên bản 1" }));
    }

    it("rewords, deletes and adds rules, then saves the whole list", async () => {
      const editor = await openEditor();
      fireEvent.change(editor.getByLabelText("Quy tắc 1"), { target: { value: "Always use contractions." } });
      fireEvent.click(editor.getByRole("button", { name: "Xóa quy tắc 2" }));
      fireEvent.click(editor.getByRole("button", { name: "Thêm quy tắc" }));
      fireEvent.change(editor.getByLabelText("Quy tắc 2"), { target: { value: "Open with the answer." } });
      fireEvent.click(editor.getByRole("button", { name: "Lưu quy tắc" }));

      await waitFor(() => expect(edits()).toHaveLength(1));
      expect(edits()[0].url).toBe("/api/reply/style-profile/p1");
      expect(JSON.parse(edits()[0].body!)).toEqual({ rules: ["Always use contractions.", "Open with the answer."] });
      // Wait for the editor to close first: while it is open the new text is also
      // inside its textarea, which would be found and then removed.
      await waitFor(() => expect(screen.queryByRole("group", { name: /Sửa quy tắc/ })).not.toBeInTheDocument());
      expect(await screen.findByText("Open with the answer.")).toBeInTheDocument();
      expect(screen.queryByText("Rule B of 1")).not.toBeInTheDocument();
    });

    it("does not save while no rule is left, and says why", async () => {
      const editor = await openEditor();
      fireEvent.click(editor.getByRole("button", { name: "Xóa quy tắc 2" }));
      fireEvent.click(editor.getByRole("button", { name: "Xóa quy tắc 1" }));
      expect(editor.getByRole("button", { name: "Lưu quy tắc" })).toBeDisabled();
      expect(editor.getByText(/Cần giữ lại ít nhất một quy tắc/)).toBeInTheDocument();
      expect(edits()).toHaveLength(0);
    });

    it("cancels without saving", async () => {
      const editor = await openEditor();
      fireEvent.change(editor.getByLabelText("Quy tắc 1"), { target: { value: "Changed my mind." } });
      fireEvent.click(editor.getByRole("button", { name: "Hủy" }));
      expect(screen.queryByRole("group", { name: /Sửa quy tắc/ })).not.toBeInTheDocument();
      expect(screen.getByText("Rule A of 1")).toBeInTheDocument();
      expect(edits()).toHaveLength(0);
    });

    it("shows the server's reason and keeps the editor and the typing when saving is refused", async () => {
      const editor = await openEditor();
      failEdit = { status: 409, error: "Phiên bản này đang được dùng. Hãy tắt nó trước khi sửa quy tắc." };
      fireEvent.change(editor.getByLabelText("Quy tắc 1"), { target: { value: "Typed but refused." } });
      fireEvent.click(editor.getByRole("button", { name: "Lưu quy tắc" }));
      expect(await screen.findByRole("alert")).toHaveTextContent("Hãy tắt nó trước khi sửa");
      expect(screen.getByLabelText("Quy tắc 1")).toHaveValue("Typed but refused.");
    });

    it("stops adding rules at the maximum", async () => {
      const many = Array.from({ length: 15 }, (_, i) => `- Rule ${i}`).join("\n");
      const editor = await openEditor([profile(1, { rules: many })]);
      expect(editor.getByRole("button", { name: "Thêm quy tắc" })).toBeDisabled();
    });

    it("offers no editing for the version in use, only a hint", async () => {
      state.profiles = [profile(1, { active: true })];
      render(<StyleProfilePanel />);
      const versions = within(await screen.findByRole("region", { name: "Các phiên bản" }));
      expect(versions.queryByRole("button", { name: "Sửa quy tắc" })).not.toBeInTheDocument();
      expect(versions.getByText(/hãy tắt nó trước/i)).toBeInTheDocument();
    });
  });
});
