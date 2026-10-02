import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { NoteRef } from "@/lib/reply/types";
import NotesDisclosure from "./NotesDisclosure";

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockImplementation(async () => Response.json({ note: {} }));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const moved: NoteRef = { id: "n1", text: "I moved to a new flat in September.", pinned: false };
const pinned: NoteRef = { id: "n2", text: "I work on Go.", pinned: true };

function show(props: Partial<React.ComponentProps<typeof NotesDisclosure>> = {}) {
  const onLeaveOut = vi.fn();
  render(
    <NotesDisclosure mode="en_reply" notes={{ status: "ready", offered: 3 }} used={[moved]} onLeaveOut={onLeaveOut} {...props} />,
  );
  return { onLeaveOut };
}

describe("NotesDisclosure", () => {
  it("shows nothing when the notes switch was off", () => {
    show({ notes: undefined });
    expect(screen.queryByText(/note/i)).not.toBeInTheDocument();
  });

  it("shows nothing while the replies are still being written", () => {
    show({ used: undefined });
    expect(screen.queryByText(/Used/)).not.toBeInTheDocument();
  });

  it("lists the notes that were used, pinned ones marked", () => {
    show({ used: [moved, pinned] });
    expect(screen.getByText("Used 2 notes")).toBeInTheDocument();
    expect(screen.getByText("I moved to a new flat in September.")).toBeInTheDocument();
    expect(screen.getByLabelText("pinned")).toBeInTheDocument();
  });

  it("says 'Used 1 note' in the singular", () => {
    show();
    expect(screen.getByText("Used 1 note")).toBeInTheDocument();
  });

  it("offers to write the replies again without a note", () => {
    const { onLeaveOut } = show({ used: [moved, pinned] });
    fireEvent.click(screen.getAllByRole("button", { name: "Don’t use this one" })[1]);
    expect(onLeaveOut).toHaveBeenCalledWith("n2");
  });

  it("links to the note on the About me page", () => {
    show();
    expect(screen.getByRole("link", { name: "Edit" })).toHaveAttribute("href", "/reply/about#note-n1");
  });

  it("archives a note from here, once", async () => {
    show();
    fireEvent.click(screen.getByRole("button", { name: "Archive" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Archived ✓" })).toBeDisabled());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("/api/reply/notes/n1", expect.objectContaining({ method: "PATCH", body: JSON.stringify({ status: "archived" }) }));
  });

  it("says why a note could not be archived, and leaves it available", async () => {
    fetchMock.mockImplementation(async () => Response.json({ error: "That note was not found." }, { status: 404 }));
    show();
    fireEvent.click(screen.getByRole("button", { name: "Archive" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("That note was not found.");
    expect(screen.getByRole("button", { name: "Archive" })).toBeEnabled();
  });

  it("disables the actions while another request is running", () => {
    show({ disabled: true });
    expect(screen.getByRole("button", { name: "Don’t use this one" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Archive" })).toBeDisabled();
  });

  it("says how many notes were there when none fit", () => {
    show({ used: [], notes: { status: "ready", offered: 4 } });
    expect(screen.getByText("4 notes were available; none fit this message.")).toBeInTheDocument();
    cleanup();
    show({ used: [], notes: { status: "ready", offered: 1 } });
    expect(screen.getByText("1 note was available; none fit this message.")).toBeInTheDocument();
  });

  it("stays quiet when there were no notes at all", () => {
    show({ used: [], notes: { status: "empty", offered: 0 } });
    expect(screen.queryByText(/available/)).not.toBeInTheDocument();
  });

  it("explains a skipped search, differently for a pasted message and a typed idea", () => {
    show({ notes: { status: "skipped", offered: 1 }, used: undefined });
    expect(screen.getByText(/could not be searched/)).toBeInTheDocument();
    cleanup();
    show({ mode: "vi_to_en", notes: { status: "skipped", offered: 0 }, used: undefined });
    expect(screen.getByText(/Note suggestions were skipped/)).toBeInTheDocument();
  });

  it("does not list notes for a typed idea: they are only suggested as chips", () => {
    show({ mode: "vi_to_en", used: [moved] });
    expect(screen.queryByText(/Used/)).not.toBeInTheDocument();
  });
});
