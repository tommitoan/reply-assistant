import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import AboutLink from "./AboutLink";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("AboutLink", () => {
  it("points to the About me page and shows how many suggested notes are waiting", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ notes: [], count: 3 })));
    render(<AboutLink />);
    const link = screen.getByRole("link", { name: /About me/ });
    expect(link).toHaveAttribute("href", "/reply/about");
    await waitFor(() => expect(link).toHaveTextContent("3 new"));
    expect(screen.getByLabelText("3 suggested notes waiting")).toBeInTheDocument();
  });

  it("says nothing when none are waiting, or when the count cannot be read", async () => {
    const fetchMock = vi.fn(async () => Response.json({ notes: [], count: 0 }));
    vi.stubGlobal("fetch", fetchMock);
    render(<AboutLink />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(screen.getByRole("link", { name: "🧑 About me" })).not.toHaveTextContent("new");

    cleanup();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 500 })));
    render(<AboutLink />);
    expect(screen.getByRole("link", { name: "🧑 About me" })).toBeInTheDocument();

    cleanup();
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new Error("offline"))));
    render(<AboutLink />);
    expect(screen.getByRole("link", { name: "🧑 About me" })).not.toHaveTextContent("new");
  });

  it("uses the singular for one note", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ notes: [], count: 1 })));
    render(<AboutLink />);
    expect(await screen.findByLabelText("1 suggested note waiting")).toBeInTheDocument();
  });
});
