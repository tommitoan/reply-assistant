"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

// The link to the About me page, with how many suggested notes are waiting. A
// failed lookup just leaves the plain link.
export default function AboutLink({ className }: { className?: string }) {
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
    <Link href="/reply/about" className={className}>
      🧑 About me
      {waiting > 0 && (
        <span
          aria-label={`${waiting} suggested ${waiting === 1 ? "note" : "notes"} waiting`}
          className="ml-1.5 rounded-full bg-amber-100 px-1.5 py-0.5 text-[11px] font-semibold text-amber-800 dark:bg-amber-900 dark:text-amber-200"
        >
          {waiting} new
        </span>
      )}
    </Link>
  );
}
