"use client";

import { useCallback, useEffect, useState } from "react";
import type { ConversationDetail, ConversationListItem } from "@/lib/reply/types";
import { getConversation, listConversations } from "./conversationsApi";

function messageOf(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}

// The list of active conversation threads. `refresh` asks for a reload; it
// does not wait for it.
export function useConversationList(): {
  items: ConversationListItem[] | null;
  error: string | null;
  refresh: () => Promise<void>;
} {
  const [items, setItems] = useState<ConversationListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;
    listConversations()
      .then((next) => {
        if (cancelled) return;
        setItems(next);
        setError(null);
      })
      .catch((err) => {
        if (!cancelled) setError(messageOf(err, "Không tải được danh sách cuộc trò chuyện."));
      });
    return () => {
      cancelled = true;
    };
  }, [version]);

  const refresh = useCallback(async () => setVersion((v) => v + 1), []);
  return { items, error, refresh };
}

// One thread with its messages. `detail` is null for "no thread" and until the
// first load; it is keyed by id so a stale thread never shows for a new choice.
export function useConversationDetail(id: string | null): {
  detail: ConversationDetail | null;
  error: string | null;
  reload: () => Promise<void>;
} {
  const [loaded, setLoaded] = useState<{ id: string; detail: ConversationDetail } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    getConversation(id)
      .then((detail) => {
        if (cancelled) return;
        setLoaded({ id, detail });
        setError(null);
      })
      .catch((err) => {
        if (!cancelled) setError(messageOf(err, "Không tải được cuộc trò chuyện."));
      });
    return () => {
      cancelled = true;
    };
  }, [id, version]);

  const reload = useCallback(async () => setVersion((v) => v + 1), []);
  return { detail: loaded && loaded.id === id ? loaded.detail : null, error: id ? error : null, reload };
}
