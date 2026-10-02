"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import AboutLink from "./reply/AboutLink";

const LINKS = [
  { href: "/style", label: "Style" },
  { href: "/about", label: "About me" },
  { href: "/stats", label: "Stats" },
  { href: "/usage", label: "Usage" },
] as const;

const PILL = "rounded-full px-3 py-1.5 text-sm transition";
const IDLE = "text-stone-600 hover:bg-stone-200/60 dark:text-stone-300 dark:hover:bg-stone-800";
const CURRENT = "bg-stone-200/70 font-medium text-stone-900 dark:bg-stone-800 dark:text-stone-50";

// The top bar: the way home, the other pages, and Sign out. It is not shown on
// the sign-in page, where there is no session to end. The right edge is left
// free for the fixed theme toggle.
export default function AppHeader() {
  const pathname = usePathname();
  if (pathname === "/login") return null;

  const className = (href: string) => `${PILL} ${pathname === href ? CURRENT : IDLE}`;

  return (
    <header className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-4 gap-y-2 px-4 pt-4 pr-16">
      <Link href="/" className="flex items-center gap-2 font-serif text-xl tracking-tight text-stone-900 dark:text-stone-50">
        <span aria-hidden="true" className="text-accent-600 dark:text-accent-500">
          ✻
        </span>
        Reply Assistant
      </Link>

      <nav aria-label="Pages" className="order-last flex w-full items-center gap-1 overflow-x-auto sm:order-none sm:w-auto sm:flex-1">
        {LINKS.map((link) =>
          // The About me link also says how many suggested notes are waiting.
          link.href === "/about" ? (
            <AboutLink key={link.href} className={className(link.href)} current={pathname === link.href} />
          ) : (
            <Link key={link.href} href={link.href} aria-current={pathname === link.href ? "page" : undefined} className={className(link.href)}>
              {link.label}
            </Link>
          ),
        )}
      </nav>

      <form action="/api/auth/logout" method="post">
        <button type="submit" className="rounded-full px-3 py-1.5 text-sm text-stone-500 transition hover:bg-stone-200/60 dark:text-stone-400 dark:hover:bg-stone-800">
          Sign out
        </button>
      </form>
    </header>
  );
}
