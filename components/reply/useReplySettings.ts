"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";
import { SETTINGS_KEY, parseSettings, type ReplySettings } from "@/lib/reply/settings";

const listeners = new Set<() => void>();
// Used when localStorage is unavailable (private window, blocked site data),
// so the controls still respond for the life of the page.
let memoryRaw = "";

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === SETTINGS_KEY) listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

function getSnapshot(): string {
  try {
    const stored = localStorage.getItem(SETTINGS_KEY);
    if (stored !== null) return stored;
  } catch {
    // Storage is blocked; use the in-memory copy.
  }
  return memoryRaw;
}

function getServerSnapshot(): string {
  return "";
}

export function useReplySettings(): [ReplySettings, (patch: Partial<ReplySettings>) => void] {
  const raw = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const settings = useMemo(() => parseSettings(raw), [raw]);

  const update = useCallback((patch: Partial<ReplySettings>) => {
    const next = JSON.stringify({ ...parseSettings(getSnapshot()), ...patch });
    memoryRaw = next;
    try {
      localStorage.setItem(SETTINGS_KEY, next);
    } catch {
      // Kept in memory only.
    }
    listeners.forEach((listener) => listener());
  }, []);

  return [settings, update];
}
