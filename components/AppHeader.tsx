"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import AboutLink from "./reply/AboutLink";

const LINKS = [
  { href: "/style", label: "Phong cách" },
  { href: "/about", label: "Về tôi" },
  { href: "/stats", label: "Thống kê" },
  { href: "/usage", label: "Chi phí" },
] as const;

const PILL = "rounded-full px-3.5 py-1.5 text-sm transition";
const IDLE = "text-stone-600 hover:bg-stone-200/60 dark:text-stone-300 dark:hover:bg-stone-800";
const CURRENT = "bg-stone-200/70 font-medium text-stone-900 dark:bg-stone-800 dark:text-stone-50";

// The top bar: the way home on the left, the other pages centred, and Sign out
// on the right. It is not shown on the sign-in page, where there is no session
// to end. The far right corner is left free for the fixed theme toggle.
export default function AppHeader() {
  const pathname = usePathname();
  if (pathname === "/login") return null;

  const className = (href: string) => `${PILL} ${pathname === href ? CURRENT : IDLE}`;

  return (
    <header className="grid shrink-0 grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1 border-b border-stone-200/80 px-4 py-2 md:grid-cols-[1fr_auto_1fr] dark:border-stone-800">
      <Link href="/" className="flex items-center gap-2 justify-self-start font-serif text-xl tracking-tight text-stone-900 dark:text-stone-50">
        <span aria-hidden="true" className="text-accent-600 dark:text-accent-500">
          ✻
        </span>
        Reply Assistant
      </Link>

      <nav aria-label="Các trang" className="order-last col-span-2 flex items-center justify-center gap-1 overflow-x-auto md:order-none md:col-span-1">
        {LINKS.map((link) =>
          // The About link also says how many suggested notes are waiting.
          link.href === "/about" ? (
            <AboutLink key={link.href} className={className(link.href)} current={pathname === link.href} />
          ) : (
            <Link key={link.href} href={link.href} aria-current={pathname === link.href ? "page" : undefined} className={className(link.href)}>
              {link.label}
            </Link>
          ),
        )}
      </nav>

      <form action="/api/auth/logout" method="post" className="justify-self-end pr-12">
        <button type="submit" className="rounded-full px-3 py-1.5 text-sm text-stone-500 transition hover:bg-stone-200/60 dark:text-stone-400 dark:hover:bg-stone-800">
          Đăng xuất
        </button>
      </form>
    </header>
  );
}
