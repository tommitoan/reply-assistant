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
    expect(await screen.findByText(/no style profile is switched on/i)).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Versions" })).not.toBeInTheDocument();
  });

  it("shows the rules in use, how they were made, and every version", async () => {
    state.profiles = [profile(2, { active: true }), profile(1)];
    render(<StyleProfilePanel />);
    const inUse = within(await screen.findByRole("region", { name: "In use" }));
    expect(inUse.getByText(/Version 2, from 4 edited, 3 liked, 1 disliked/)).toBeInTheDocument();
    expect(inUse.getByText("Rule A of 2")).toBeInTheDocument();
    const versions = within(screen.getByRole("region", { name: "Versions" }));
    expect(versions.getByText("Version 1")).toBeInTheDocument();
    expect(versions.getByText("In use")).toBeInTheDocument();
  });

  it("builds a profile and shows it as new but not switched on", async () => {
    render(<StyleProfilePanel />);
    fireEvent.click(await screen.findByRole("button", { name: /build a new profile/i }));

    expect(await screen.findByText("New, not switched on yet")).toBeInTheDocument();
    expect(calls).toContainEqual({ url: "/api/reply/style-profile", method: "POST", body: undefined });
    expect(screen.getByText(/no style profile is switched on/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Switch on this version" })).toBeInTheDocument();
  });

  it("switches a version on, then off", async () => {
    state.profiles = [profile(1)];
    render(<StyleProfilePanel />);
    fireEvent.click(await screen.findByRole("button", { name: "Switch on this version" }));

    expect(await screen.findByText(/these rules go in front of every request/i)).toBeInTheDocument();
    expect(JSON.parse(calls.at(-1)!.body!)).toEqual({ activeId: "p1" });

    fireEvent.click(screen.getByRole("button", { name: "Switch off" }));
    await waitFor(() => expect(screen.getByText(/no style profile is switched on/i)).toBeInTheDocument());
    expect(JSON.parse(calls.at(-1)!.body!)).toEqual({ activeId: null });
  });

  it("shows the server's reason when a profile cannot be built", async () => {
    fetchMock.mockImplementation(async (_url: string, init?: RequestInit) => {
      if ((init?.method ?? "GET") === "POST") {
        return Response.json({ error: "Not enough rated or edited replies yet: 2 of 5 needed." }, { status: 422 });
      }
      return Response.json({ profiles: [], active: null });
    });
    render(<StyleProfilePanel />);
    fireEvent.click(await screen.findByRole("button", { name: /build a new profile/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent("2 of 5 needed");
  });

  it("disables the buttons while a build is running", async () => {
    let finish: (value: Response) => void = () => {};
    fetchMock.mockImplementation((_url: string, init?: RequestInit) =>
      (init?.method ?? "GET") === "POST"
        ? new Promise<Response>((resolve) => (finish = resolve))
        : Promise.resolve(Response.json({ profiles: [], active: null })),
    );
    render(<StyleProfilePanel />);
    fireEvent.click(await screen.findByRole("button", { name: /build a new profile/i }));
    expect(await screen.findByRole("button", { name: "Building…" })).toBeDisabled();
    finish(Response.json({ error: "x" }, { status: 500 }));
    await waitFor(() => expect(screen.getByRole("button", { name: /build a new profile/i })).toBeEnabled());
  });

  it("reports a load failure and can try again", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ error: "Could not load the style profiles." }, { status: 500 }));
    render(<StyleProfilePanel />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not load the style profiles.");
    fetchMock.mockImplementation(async () => Response.json({ profiles: [], active: null }));
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText(/no style profile is switched on/i)).toBeInTheDocument();
  });

  describe("editing the rules of a version", () => {
    const edits = () => calls.filter((c) => c.url !== "/api/reply/style-profile" && c.method === "PATCH");

    async function openEditor(profiles: StyleProfileRecord[] = [profile(1)]) {
      state.profiles = profiles;
      render(<StyleProfilePanel />);
      fireEvent.click(await screen.findByRole("button", { name: "Edit rules" }));
      return within(await screen.findByRole("group", { name: "Edit the rules of version 1" }));
    }

    it("rewords, deletes and adds rules, then saves the whole list", async () => {
      const editor = await openEditor();
      fireEvent.change(editor.getByLabelText("Rule 1"), { target: { value: "Always use contractions." } });
      fireEvent.click(editor.getByRole("button", { name: "Delete rule 2" }));
      fireEvent.click(editor.getByRole("button", { name: "Add a rule" }));
      fireEvent.change(editor.getByLabelText("Rule 2"), { target: { value: "Open with the answer." } });
      fireEvent.click(editor.getByRole("button", { name: "Save rules" }));

      await waitFor(() => expect(edits()).toHaveLength(1));
      expect(edits()[0].url).toBe("/api/reply/style-profile/p1");
      expect(JSON.parse(edits()[0].body!)).toEqual({ rules: ["Always use contractions.", "Open with the answer."] });
      expect(await screen.findByText("Open with the answer.")).toBeInTheDocument();
      expect(screen.queryByRole("group", { name: /Edit the rules/ })).not.toBeInTheDocument();
      expect(screen.queryByText("Rule B of 1")).not.toBeInTheDocument();
    });

    it("does not save while no rule is left, and says why", async () => {
      const editor = await openEditor();
      fireEvent.click(editor.getByRole("button", { name: "Delete rule 2" }));
      fireEvent.click(editor.getByRole("button", { name: "Delete rule 1" }));
      expect(editor.getByRole("button", { name: "Save rules" })).toBeDisabled();
      expect(editor.getByText(/Keep at least one rule/)).toBeInTheDocument();
      expect(edits()).toHaveLength(0);
    });

    it("cancels without saving", async () => {
      const editor = await openEditor();
      fireEvent.change(editor.getByLabelText("Rule 1"), { target: { value: "Changed my mind." } });
      fireEvent.click(editor.getByRole("button", { name: "Cancel" }));
      expect(screen.queryByRole("group", { name: /Edit the rules/ })).not.toBeInTheDocument();
      expect(screen.getByText("Rule A of 1")).toBeInTheDocument();
      expect(edits()).toHaveLength(0);
    });

    it("shows the server's reason and keeps the editor and the typing when saving is refused", async () => {
      const editor = await openEditor();
      failEdit = { status: 409, error: "This version is in use. Switch it off before editing its rules." };
      fireEvent.change(editor.getByLabelText("Rule 1"), { target: { value: "Typed but refused." } });
      fireEvent.click(editor.getByRole("button", { name: "Save rules" }));
      expect(await screen.findByRole("alert")).toHaveTextContent("Switch it off before editing");
      expect(screen.getByLabelText("Rule 1")).toHaveValue("Typed but refused.");
    });

    it("stops adding rules at the maximum", async () => {
      const many = Array.from({ length: 15 }, (_, i) => `- Rule ${i}`).join("\n");
      const editor = await openEditor([profile(1, { rules: many })]);
      expect(editor.getByRole("button", { name: "Add a rule" })).toBeDisabled();
    });

    it("offers no editing for the version in use, only a hint", async () => {
      state.profiles = [profile(1, { active: true })];
      render(<StyleProfilePanel />);
      const versions = within(await screen.findByRole("region", { name: "Versions" }));
      expect(versions.queryByRole("button", { name: "Edit rules" })).not.toBeInTheDocument();
      expect(versions.getByText(/switch it off first/i)).toBeInTheDocument();
    });
  });
});
