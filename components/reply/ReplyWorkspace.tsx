"use client";

import { useState } from "react";
import type { RecentGeneration, ReplyContext } from "@/lib/reply/types";
import { createConversation, deleteConversation, patchConversation } from "./conversationsApi";
import RecentGenerations from "./RecentGenerations";
import ReplyComposer from "./ReplyComposer";
import ThreadList from "./ThreadList";
import { ThreadHeader, ThreadMessages } from "./ThreadView";
import { useConversationDetail, useConversationList } from "./useConversations";
import { useReplySettings } from "./useReplySettings";
import { useSidebarOpen } from "./useSidebarOpen";

const ICON_BUTTON =
  "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-stone-500 transition hover:bg-stone-200/70 dark:text-stone-400 dark:hover:bg-stone-800";

function narrowScreen(): boolean {
  return typeof window.matchMedia === "function" && !window.matchMedia("(min-width: 1024px)").matches;
}

// A side bar (new conversation, Quick translate, saved conversations, recent
// replies) that can be hidden, and next to it the chat: the open thread's
// messages and the drafts scroll above an input box that stays at the bottom.
export default function ReplyWorkspace() {
  const [activeId, setActiveId] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useSidebarOpen();
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  // A request opened from the Recent list, and the key that reloads that list.
  const [reviewing, setReviewing] = useState<RecentGeneration | null>(null);
  const [recentKey, setRecentKey] = useState<string | null>(null);

  const [settings] = useReplySettings();
  const list = useConversationList();
  const { detail, error: loadError, reload } = useConversationDetail(activeId);
  const { refresh } = list;

  async function refreshAll() {
    await Promise.all([reload(), refresh()]);
  }

  function select(id: string | null) {
    setActiveId(id);
    setReviewing(null);
    setActionError(null);
    // On a narrow screen the side bar covers the chat, so it gets out of the way.
    if (narrowScreen()) setSidebarOpen(false);
  }

  async function run(action: () => Promise<void>): Promise<void> {
    setBusy(true);
    setActionError(null);
    try {
      await action();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Có lỗi xảy ra.");
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
      setActionError(err instanceof Error ? err.message : "Không tạo được cuộc trò chuyện.");
    } finally {
      setCreating(false);
    }
  }

  const ready = activeId === null || detail !== null;

  return (
    <div className="relative flex h-full">
      {sidebarOpen && (
        <button
          type="button"
          tabIndex={-1}
          aria-hidden="true"
          onClick={() => setSidebarOpen(false)}
          className="fixed inset-0 z-30 bg-stone-900/30 lg:hidden"
        />
      )}

      <aside
        id="reply-sidebar"
        aria-label="Thanh bên"
        className={`${
          sidebarOpen ? "flex" : "hidden"
        } fixed inset-y-0 left-0 z-40 w-72 flex-col border-r border-stone-200/80 bg-stone-50 shadow-xl lg:static lg:z-auto lg:w-64 lg:shrink-0 lg:shadow-none dark:border-stone-800 dark:bg-stone-900`}
      >
        <div className="flex items-center justify-end px-2 pt-2">
          <button
            type="button"
            onClick={() => setSidebarOpen(false)}
            aria-label="Ẩn thanh bên"
            title="Ẩn thanh bên"
            className={ICON_BUTTON}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="4" width="18" height="16" rx="2" />
              <path d="M9 4v16" />
            </svg>
          </button>
        </div>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-3 pb-4 pt-1">
          <ThreadList
            items={list.items}
            error={list.error}
            activeId={activeId}
            creating={creating}
            onSelect={select}
            onCreate={startConversation}
          />
          <RecentGenerations
            scope={activeId ?? "none"}
            refreshKey={recentKey}
            activeId={reviewing?.id ?? null}
            onOpen={(generation) => {
              setReviewing(generation);
              if (narrowScreen()) setSidebarOpen(false);
            }}
          />
        </div>
      </aside>

      <section className="flex min-w-0 flex-1 flex-col">
        <div className="flex shrink-0 items-start gap-2 border-b border-stone-200/60 px-3 py-2 dark:border-stone-800/80">
          {!sidebarOpen && (
            <button
              type="button"
              onClick={() => setSidebarOpen(true)}
              aria-label="Hiện thanh bên"
              aria-controls="reply-sidebar"
              title="Hiện thanh bên"
              className={ICON_BUTTON}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="4" width="18" height="16" rx="2" />
                <path d="M9 4v16" />
              </svg>
            </button>
          )}
          {detail ? (
            <ThreadHeader
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
          ) : (
            <p className="flex h-8 items-center gap-2 text-sm font-semibold text-stone-800 dark:text-stone-100">
              <span aria-hidden="true">⚡</span>
              Dịch nhanh
            </p>
          )}
        </div>

        {actionError && !detail && (
          <p
            role="alert"
            className="mx-4 mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-400"
          >
            {actionError}
          </p>
        )}
        {activeId && !detail && !loadError && <p className="p-4 text-sm text-stone-400">Đang tải cuộc trò chuyện…</p>}
        {activeId && loadError && !detail && (
          <p role="alert" className="p-4 text-sm text-red-600 dark:text-red-400">
            {loadError}
          </p>
        )}

        {ready && (
          <div className="min-h-0 flex-1">
            <ReplyComposer
              key={activeId ?? "quick"}
              conversation={detail}
              transcript={detail ? <ThreadMessages messages={detail.messages} /> : undefined}
              reviewing={reviewing}
              onCloseReview={() => setReviewing(null)}
              onGenerationDone={(generationId) => setRecentKey(generationId)}
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
        )}
      </section>
    </div>
  );
}
