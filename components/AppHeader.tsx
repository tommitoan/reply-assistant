"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// The top bar: the way back to the assistant and Sign out. It is not shown on
// the sign-in page, where there is no session to end. The right edge is left
// free for the fixed theme toggle.
export default function AppHeader() {
  const pathname = usePathname();
  if (pathname === "/login") return null;

  return (
    <header className="mx-auto flex max-w-5xl items-center justify-between px-4 pt-4 pr-16 text-sm">
      <Link href="/reply" className="font-semibold text-stone-800 hover:underline dark:text-stone-100">
        💬 Reply Assistant
      </Link>
      <form action="/api/auth/logout" method="post">
        <button type="submit" className="text-stone-500 hover:underline dark:text-stone-400">
          Sign out
        </button>
      </form>
    </header>
  );
}
