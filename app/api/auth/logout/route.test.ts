import { describe, expect, it } from "vitest";
import { SESSION_COOKIE } from "@/lib/auth/session";
import { POST } from "./route";

describe("POST /api/auth/logout", () => {
  it("expires the session cookie and sends the browser to the login page", () => {
    const response = POST();

    expect(response.status).toBe(303);
    // Relative, so it stays on whichever host the browser used.
    expect(response.headers.get("location")).toBe("/login");

    const cookie = response.cookies.get(SESSION_COOKIE);
    expect(cookie?.value).toBe("");
    expect(cookie?.maxAge).toBe(0);
    expect(cookie?.path).toBe("/");
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.sameSite).toBe("lax");
  });
});
