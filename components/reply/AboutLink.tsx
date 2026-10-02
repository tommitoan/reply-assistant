"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

// The link to the About me page, with how many suggested notes are waiting. A
// failed lookup just leaves the plain link.
export default function AboutLink({ className, current }: { className?: string; current?: boolean }) {
  const [waiting, setWaiting] = useState(0);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/reply/notes/inbox")
      .then((res) => (res.ok ? (res.json() as Promise<{ count?: unknown }>) : null))
      .then((body) => {
        if (!cancelled && body && typeof body.count === "number") setWaiting(body.count);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <Link href="/about" className={className} aria-current={current ? "page" : undefined}>
      About me
      {waiting > 0 && (
        <span
          aria-label={`${waiting} suggested ${waiting === 1 ? "note" : "notes"} waiting`}
          className="ml-1.5 rounded-full bg-accent-100 px-1.5 py-0.5 text-[11px] font-semibold text-accent-800 dark:bg-accent-900 dark:text-accent-100"
        >
          {waiting} new
        </span>
      )}
    </Link>
  );
}
