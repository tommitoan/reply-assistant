// @vitest-environment node
import { NextRequest } from "next/server";
import { beforeAll, describe, expect, it } from "vitest";
import { SESSION_COOKIE, createSessionToken } from "@/lib/auth/session";
import { config, proxy } from "./proxy";

const SECRET = "x".repeat(40);

// The proxy reads its env lazily and caches it on first call, so the
// variables only need to be in place before the first request.
beforeAll(() => {
  process.env.APP_PASSCODE = "passcode-123";
  process.env.APP_SESSION_SECRET = SECRET;
});

function request(path: string, token?: string): NextRequest {
  return new NextRequest(`http://localhost:3000${path}`, {
    headers: token ? { cookie: `${SESSION_COOKIE}=${token}` } : {},
  });
}

// The location is absolute (the proxy runtime requires it), so compare the
// parts the app controls.
function redirectTarget(res: Response): string {
  const url = new URL(res.headers.get("location") ?? "");
  return `${url.host}${url.pathname}${url.search}`;
}

describe("proxy", () => {
  it("redirects an anonymous page request to /login", async () => {
    const res = await proxy(request("/study"));
    expect(res.status).toBe(307);
    expect(redirectTarget(res)).toBe("localhost:3000/login?next=%2Fstudy");
  });

  it("keeps the query string in the return path", async () => {
    const res = await proxy(request("/study?category=go"));
    expect(redirectTarget(res)).toBe("localhost:3000/login?next=%2Fstudy%3Fcategory%3Dgo");
  });

  it("sends the home page to a bare /login", async () => {
    const res = await proxy(request("/"));
    expect(redirectTarget(res)).toBe("localhost:3000/login");
  });

  it("answers an anonymous API request with 401 instead of a redirect", async () => {
    const res = await proxy(request("/api/score"));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
  });

  it("lets /login through without a session", async () => {
    const res = await proxy(request("/login"));
    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
  });

  it("lets a valid session through to pages and APIs", async () => {
    const token = await createSessionToken(SECRET);
    for (const path of ["/reply", "/api/reply/generate"]) {
      const res = await proxy(request(path, token));
      expect(res.status).toBe(200);
      expect(res.headers.get("x-middleware-next")).toBe("1");
    }
  });

  it("rejects a cookie signed with another secret", async () => {
    const token = await createSessionToken("y".repeat(40));
    const res = await proxy(request("/reply", token));
    expect(res.status).toBe(307);
  });

  it("rejects an expired session", async () => {
    const token = await createSessionToken(SECRET, Date.now() - 2 * 86_400_000, 86_400);
    const res = await proxy(request("/reply", token));
    expect(res.status).toBe(307);
  });
});

describe("proxy matcher", () => {
  const pattern = new RegExp(`^${config.matcher[0]}$`);

  it("skips the health check and static assets", () => {
    for (const path of ["/api/health", "/_next/static/chunk.js", "/_next/image", "/favicon.ico"]) {
      expect(pattern.test(path)).toBe(false);
    }
  });

  it("covers pages and other API routes", () => {
    for (const path of ["/", "/reply", "/login", "/api/score", "/api/reply/generate"]) {
      expect(pattern.test(path)).toBe(true);
    }
  });
});
