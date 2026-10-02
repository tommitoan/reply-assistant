"use client";

import { useCallback, useEffect, useState } from "react";

const KEY = "reply.sidebar.v1";
const DESKTOP_QUERY = "(min-width: 1024px)";

// Whether the side bar is showing. It starts open (so the server render and the
// first client render agree), then follows the saved choice; on a narrow screen
// it starts closed so it does not cover the chat.
export function useSidebarOpen(): [boolean, (open: boolean) => void] {
  const [open, setOpenState] = useState(true);

  useEffect(() => {
    let saved: string | null = null;
    try {
      saved = localStorage.getItem(KEY);
    } catch {
      // Storage is blocked; the choice lasts for this page only.
    }
    const wide = typeof window.matchMedia === "function" ? window.matchMedia(DESKTOP_QUERY).matches : true;
    const next = saved === null ? wide : saved === "1";
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the saved choice is only known on the client
    setOpenState(next);
  }, []);

  const setOpen = useCallback((next: boolean) => {
    setOpenState(next);
    try {
      localStorage.setItem(KEY, next ? "1" : "0");
    } catch {
      // Not saved; fine.
    }
  }, []);

  return [open, setOpen];
}
