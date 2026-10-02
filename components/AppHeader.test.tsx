import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import AppHeader from "./AppHeader";

const pathname = vi.fn<() => string>();
vi.mock("next/navigation", () => ({ usePathname: () => pathname() }));

afterEach(() => {
  cleanup();
  pathname.mockReset();
});

describe("AppHeader", () => {
  it("links back to the assistant and signs out with a POST to the logout route", () => {
    pathname.mockReturnValue("/reply/about");
    render(<AppHeader />);
    expect(screen.getByRole("link", { name: /Reply Assistant/ })).toHaveAttribute("href", "/reply");
    const button = screen.getByRole("button", { name: "Sign out" });
    const form = button.closest("form");
    expect(form).toHaveAttribute("action", "/api/auth/logout");
    expect(form).toHaveAttribute("method", "post");
  });

  it("is not shown on the sign-in page", () => {
    pathname.mockReturnValue("/login");
    const { container } = render(<AppHeader />);
    expect(container).toBeEmptyDOMElement();
  });
});
