"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { loginGuard } from "@/lib/auth/login-guard";
import { safeNextPath } from "@/lib/auth/next-path";
import {
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
  createSessionToken,
  passcodeMatches,
  sessionCookieOptions,
} from "@/lib/auth/session";
import { getAuthEnv, isAuthConfigured } from "@/lib/reply/env";

export interface LoginState {
  error: string | null;
}

async function clientKey(): Promise<string> {
  const forwarded = (await headers()).get("x-forwarded-for");
  return forwarded?.split(",")[0]?.trim() || "unknown";
}

// This is deliberately reachable without a session; every other Server
// Function must check the session itself rather than rely on the proxy.
export async function login(_previous: LoginState, formData: FormData): Promise<LoginState> {
  if (!isAuthConfigured()) {
    return { error: "Server này chưa được cấu hình đăng nhập." };
  }

  const key = await clientKey();
  const limit = loginGuard.check(key);
  if (!limit.allowed) {
    const minutes = Math.ceil(limit.retryAfterSeconds / 60);
    return { error: `Bạn đã thử quá nhiều lần. Hãy thử lại sau ${minutes} phút.` };
  }

  const { APP_PASSCODE, APP_SESSION_SECRET } = getAuthEnv();
  const submitted = formData.get("passcode");
  if (typeof submitted !== "string" || !(await passcodeMatches(submitted, APP_PASSCODE))) {
    loginGuard.recordFailure(key);
    return { error: "Mật khẩu không đúng." };
  }

  loginGuard.recordSuccess(key);
  (await cookies()).set(
    SESSION_COOKIE,
    await createSessionToken(APP_SESSION_SECRET),
    sessionCookieOptions(SESSION_TTL_SECONDS),
  );

  redirect(safeNextPath(formData.get("next")));
}
