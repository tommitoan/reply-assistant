import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import AppHeader from "./AppHeader";

const pathname = vi.fn<() => string>();
vi.mock("next/navigation", () => ({ usePathname: () => pathname() }));

afterEach(() => {
  cleanup();
  pathname.mockReset();
});

describe("AppHeader", () => {
  it("links to the home page and the other pages, marking the current one", () => {
    pathname.mockReturnValue("/about");
    render(<AppHeader />);
    expect(screen.getByRole("link", { name: /Reply Assistant/ })).toHaveAttribute("href", "/");
    const pages = within(screen.getByRole("navigation", { name: "Pages" }));
    expect(pages.getAllByRole("link").map((link) => [link.textContent, link.getAttribute("href")])).toEqual([
      ["Style", "/style"],
      ["About me", "/about"],
      ["Stats", "/stats"],
      ["Usage", "/usage"],
    ]);
    expect(pages.getByRole("link", { name: "About me" })).toHaveAttribute("aria-current", "page");
    expect(pages.getByRole("link", { name: "Stats" })).not.toHaveAttribute("aria-current");
  });

  it("links back to the assistant and signs out with a POST to the logout route", () => {
    pathname.mockReturnValue("/about");
    render(<AppHeader />);
    expect(screen.getByRole("link", { name: /Reply Assistant/ })).toHaveAttribute("href", "/");
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
