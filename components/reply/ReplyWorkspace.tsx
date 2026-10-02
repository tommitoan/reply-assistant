"use client";

import { useState } from "react";
import type { ReplyContext } from "@/lib/reply/types";
import { createConversation, deleteConversation, patchConversation } from "./conversationsApi";
import ReplyComposer from "./ReplyComposer";
import ThreadList from "./ThreadList";
import ThreadView from "./ThreadView";
import { useConversationDetail, useConversationList } from "./useConversations";
import { useReplySettings } from "./useReplySettings";

// Conversation list on the side (a drawer on small screens), and the chosen
// thread's transcript above the composer.
export default function ReplyWorkspace() {
  const [activeId, setActiveId] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const [settings] = useReplySettings();
  const list = useConversationList();
  const { detail, error: loadError, reload } = useConversationDetail(activeId);
  const { refresh } = list;

  async function refreshAll() {
    await Promise.all([reload(), refresh()]);
  }

  function select(id: string | null) {
    setActiveId(id);
    setActionError(null);
    setDrawerOpen(false);
  }

  async function run(action: () => Promise<void>): Promise<void> {
    setBusy(true);
    setActionError(null);
    try {
      await action();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  async function startConversation() {
    setCreating(true);
    setActionError(null);
    try {
      const created = await createConversation(settings.context);
      await refresh();
      select(created.id);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Could not start the conversation.");
    } finally {
      setCreating(false);
    }
  }

  const activeTitle = detail ? detail.title || "Untitled conversation" : "Quick translate";

  return (
    <div className="grid gap-6 lg:grid-cols-[15rem_minmax(0,1fr)]">
      <aside className="space-y-2">
        <button
          type="button"
          onClick={() => setDrawerOpen((open) => !open)}
          aria-expanded={drawerOpen}
          className="flex w-full items-center justify-between rounded-lg border border-stone-300 px-3 py-2 text-sm font-medium text-stone-700 lg:hidden dark:border-stone-700 dark:text-stone-200"
        >
          <span className="truncate">💬 {activeTitle}</span>
          <span aria-hidden="true">{drawerOpen ? "▴" : "▾"}</span>
        </button>
        <div className={drawerOpen ? "block" : "hidden lg:block"}>
          <ThreadList
            items={list.items}
            error={list.error}
            activeId={activeId}
            creating={creating}
            onSelect={select}
            onCreate={startConversation}
          />
        </div>
      </aside>

      <div className="min-w-0 space-y-5">
        {actionError && !detail && (
          <p
            role="alert"
            className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-400"
          >
            {actionError}
          </p>
        )}

        {activeId && !detail && !loadError && <p className="text-sm text-stone-400">Loading the conversation…</p>}
        {activeId && loadError && !detail && (
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">
            {loadError}
          </p>
        )}

        {detail && (
          <ThreadView
            conversation={detail}
            busy={busy}
            error={actionError}
            onRename={(title) =>
              run(async () => {
                await patchConversation(detail.id, { title });
                await refreshAll();
              })
            }
            onArchive={() =>
              run(async () => {
                await patchConversation(detail.id, { archived: true });
                select(null);
                await refresh();
              })
            }
            onDelete={() =>
              run(async () => {
                await deleteConversation(detail.id);
                select(null);
                await refresh();
              })
            }
          />
        )}

        <ReplyComposer
          conversation={detail}
          onThreadChanged={() => void refreshAll()}
          onContextChange={(context: ReplyContext) =>
            void run(async () => {
              if (!detail) return;
              await patchConversation(detail.id, { context });
              await refreshAll();
            })
          }
        />
      </div>
    </div>
  );
}
