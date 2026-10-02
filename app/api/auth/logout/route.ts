import { NextResponse } from "next/server";
import { SESSION_COOKIE, sessionCookieOptions } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

// Ends the session on this browser by expiring the cookie. POST only, so a
// link or an image tag cannot trigger it.
export function POST() {
  // The redirect target is relative on purpose. The URL the standalone server
  // derives for a request comes from its own bind address, not from the public
  // host, so an absolute URL built from it would point behind the proxy. 303
  // turns the POST into a GET of /login.
  const response = new NextResponse(null, { status: 303, headers: { Location: "/login" } });
  response.cookies.set(SESSION_COOKIE, "", sessionCookieOptions(0));
  return response;
}
