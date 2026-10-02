import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth/session";
import { getAuthEnv } from "@/lib/reply/env";

// Fails closed: when auth is not configured, nothing but /login is reachable.
async function hasValidSession(request: NextRequest): Promise<boolean> {
  let secret: string;
  try {
    secret = getAuthEnv().APP_SESSION_SECRET;
  } catch {
    return false;
  }
  return verifySessionToken(request.cookies.get(SESSION_COOKIE)?.value, secret);
}

export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  // The login page and its Server Action (a POST to this same path) must be
  // reachable without a session.
  if (pathname === "/login") return NextResponse.next();

  if (await hasValidSession(request)) return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // The proxy runtime requires an absolute redirect target; nextUrl keeps the
  // host the request arrived on.
  const loginUrl = request.nextUrl.clone();
  loginUrl.pathname = "/login";
  loginUrl.search = "";
  if (pathname !== "/") loginUrl.searchParams.set("next", `${pathname}${search}`);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  // /api/health stays open for the platform health check. Static build output
  // and the favicon are not worth gating.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/health).*)"],
};
