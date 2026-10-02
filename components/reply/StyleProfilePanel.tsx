"use client";

import { useEffect, useState } from "react";
import { MAX_RULE_CHARS, MAX_RULES } from "@/lib/reply/style-profile";
import type { StyleProfileRecord } from "@/lib/reply/types";

interface Listing {
  profiles: StyleProfileRecord[];
  active: StyleProfileRecord | null;
}

const BUTTON =
  "rounded-full border border-stone-300 px-4 py-1.5 text-sm font-medium text-stone-700 transition hover:bg-stone-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-stone-600 dark:text-stone-200 dark:hover:bg-stone-700";
const PRIMARY =
  "rounded-full bg-accent-600 px-5 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-accent-700 disabled:cursor-not-allowed disabled:opacity-40";
const CARD = "rounded-2xl border border-stone-200 bg-white p-5 dark:border-stone-700 dark:bg-stone-800";

export function rulesOf(profile: StyleProfileRecord): string[] {
  return profile.rules
    .split("\n")
    .map((line) => line.replace(/^\s*-\s*/, "").trim())
    .filter(Boolean);
}

function Rules({ profile }: { profile: StyleProfileRecord }) {
  return (
    <ul className="list-disc space-y-1 pl-5 text-sm text-stone-700 dark:text-stone-200">
      {rulesOf(profile).map((rule) => (
        <li key={rule}>{rule}</li>
      ))}
    </ul>
  );
}

// The rules of a version that is not in use, as a list the writer can reword,
// delete from and add to before switching it on. `onSave` resolves true when the
// server accepted the new list.
function RulesEditor({
  profile,
  busy,
  onSave,
  onCancel,
}: {
  profile: StyleProfileRecord;
  busy: boolean;
  onSave: (rules: string[]) => Promise<boolean>;
  onCancel: () => void;
}) {
  const [rules, setRules] = useState<string[]>(() => rulesOf(profile));
  const kept = rules.map((rule) => rule.trim()).filter(Boolean);

  return (
    <div className="space-y-2" role="group" aria-label={`Edit the rules of version ${profile.version}`}>
      <ul className="space-y-2">
        {rules.map((rule, index) => (
          <li key={index} className="flex items-start gap-2">
            <textarea
              value={rule}
              maxLength={MAX_RULE_CHARS}
              rows={2}
              aria-label={`Rule ${index + 1}`}
              onChange={(e) => setRules(rules.map((value, i) => (i === index ? e.target.value : value)))}
              className="min-w-0 flex-1 rounded-lg border border-stone-300 bg-white p-2 text-sm text-stone-800 outline-none focus:border-stone-500 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-200"
            />
            <button
              type="button"
              disabled={busy}
              aria-label={`Delete rule ${index + 1}`}
              onClick={() => setRules(rules.filter((_, i) => i !== index))}
              className={BUTTON}
            >
              Delete
            </button>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={busy || rules.length >= MAX_RULES}
          onClick={() => setRules([...rules, ""])}
          className={BUTTON}
        >
          Add a rule
        </button>
        <button type="button" disabled={busy || kept.length === 0} onClick={() => void onSave(kept)} className={PRIMARY}>
          {busy ? "Saving…" : "Save rules"}
        </button>
        <button type="button" disabled={busy} onClick={onCancel} className={BUTTON}>
          Cancel
        </button>
      </div>
      <p className="text-xs text-stone-400 dark:text-stone-500">
        {kept.length === 0
          ? "Keep at least one rule. To stop using a profile, leave it switched off."
          : `${kept.length} of at most ${MAX_RULES} rules. Empty and repeated rules are dropped when you save.`}
      </p>
    </div>
  );
}

function sourceLine(profile: StyleProfileRecord): string {
  const { edited, liked, disliked, refined = 0 } = profile.sourceCounts;
  const developed = refined > 0 ? `, ${refined} developed` : "";
  return `from ${edited} edited, ${liked} liked, ${disliked} disliked${developed}`;
}

async function errorOf(res: Response, fallback: string): Promise<string> {
  if (res.status === 401) return "Your session expired. Reload the page to sign in again.";
  try {
    const body = (await res.json()) as { error?: unknown };
    if (typeof body.error === "string") return body.error;
  } catch {
    // Not JSON; use the fallback.
  }
  return fallback;
}

// View the saved style profiles, build a new one, and choose which is in use.
export default function StyleProfilePanel() {
  const [listing, setListing] = useState<Listing | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const [busy, setBusy] = useState<"build" | "switch" | "edit" | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [justBuiltId, setJustBuiltId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/reply/style-profile")
      .then(async (res) => {
        if (!res.ok) throw new Error(await errorOf(res, "Could not load the style profiles."));
        const body = (await res.json()) as Listing;
        if (cancelled) return;
        setListing(body);
        setLoadError(null);
      })
      .catch((err) => {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : "Could not load the style profiles.");
      });
    return () => {
      cancelled = true;
    };
  }, [version]);

  // Resolves true when the server accepted the request.
  async function call(
    kind: "build" | "switch" | "edit",
    request: () => Promise<Response>,
    fallback: string,
  ): Promise<boolean> {
    setBusy(kind);
    setProblem(null);
    try {
      const res = await request();
      if (!res.ok) {
        setProblem(await errorOf(res, fallback));
        return false;
      }
      const body = (await res.json()) as Listing & { profile?: StyleProfileRecord };
      setListing({ profiles: body.profiles, active: body.active });
      if (body.profile) setJustBuiltId(body.profile.id);
      return true;
    } catch {
      setProblem("Could not reach the server. Check the connection and try again.");
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function saveRules(id: string, rules: string[]): Promise<boolean> {
    const saved = await call(
      "edit",
      () =>
        fetch(`/api/reply/style-profile/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ rules }),
        }),
      "Could not save the rules.",
    );
    if (saved) setEditingId(null);
    return saved;
  }

  const build = () =>
    call("build", () => fetch("/api/reply/style-profile", { method: "POST" }), "Could not build a style profile.");
  const switchTo = (activeId: string | null) =>
    call(
      "switch",
      () =>
        fetch("/api/reply/style-profile", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ activeId }),
        }),
      "Could not save that.",
    );

  if (loadError && !listing) {
    return (
      <p role="alert" className="text-sm text-red-600 dark:text-red-400">
        {loadError}{" "}
        <button type="button" className="underline" onClick={() => setVersion((v) => v + 1)}>
          Try again
        </button>
      </p>
    );
  }
  if (!listing) return <p className="text-sm text-stone-400">Loading…</p>;

  const { profiles, active } = listing;

  return (
    <div className="space-y-5">
      <section className={CARD} aria-label="In use">
        <h2 className="mb-2 text-sm font-semibold text-stone-800 dark:text-stone-100">In use now</h2>
        {active ? (
          <>
            <p className="mb-2 text-xs text-stone-500 dark:text-stone-400">
              Version {active.version}, {sourceLine(active)}. These rules go in front of every request.
            </p>
            <Rules profile={active} />
            <button type="button" className={`${BUTTON} mt-3`} disabled={busy !== null} onClick={() => switchTo(null)}>
              Switch off
            </button>
          </>
        ) : (
          <p className="text-sm text-stone-500 dark:text-stone-400">
            No style profile is switched on, so replies use the base voice only.
          </p>
        )}
      </section>

      <div>
        <button type="button" className={PRIMARY} disabled={busy !== null} onClick={build}>
          {busy === "build" ? "Building…" : "Build a new profile from my feedback"}
        </button>
        <p className="mt-2 text-xs text-stone-400 dark:text-stone-500">
          Learns from replies you edited or rated (only requests kept with Learn on). It needs at least 5 of them. The new
          version is saved switched off so you can read it first.
        </p>
      </div>

      {problem && (
        <p
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-400"
        >
          {problem}
        </p>
      )}

      {profiles.length > 0 && (
        <section aria-label="Versions" className="space-y-2">
          <h2 className="text-sm font-semibold text-stone-800 dark:text-stone-100">Versions</h2>
          {profiles.map((profile) => (
            <details
              key={profile.id}
              open={profile.id === justBuiltId || profile.active}
              className="rounded-xl border border-stone-200 bg-white p-3 shadow-sm dark:border-stone-800 dark:bg-stone-800"
            >
              <summary className="cursor-pointer text-sm text-stone-700 dark:text-stone-200">
                <span className="font-medium">Version {profile.version}</span>
                <span className="ml-2 text-xs text-stone-400 dark:text-stone-500">
                  {new Date(profile.createdAt).toLocaleString()} · {sourceLine(profile)}
                </span>
                {profile.active && (
                  <span className="ml-2 rounded bg-emerald-100 px-1.5 py-0.5 text-xs text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200">
                    In use
                  </span>
                )}
                {profile.id === justBuiltId && !profile.active && (
                  <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800 dark:bg-amber-900 dark:text-amber-200">
                    New, not switched on yet
                  </span>
                )}
              </summary>
              <div className="mt-3 space-y-3">
                {editingId === profile.id ? (
                  <RulesEditor
                    profile={profile}
                    busy={busy === "edit"}
                    onSave={(rules) => saveRules(profile.id, rules)}
                    onCancel={() => setEditingId(null)}
                  />
                ) : (
                  <Rules profile={profile} />
                )}
                {!profile.active && editingId !== profile.id && (
                  <div className="flex flex-wrap gap-2">
                    <button type="button" className={BUTTON} disabled={busy !== null} onClick={() => setEditingId(profile.id)}>
                      Edit rules
                    </button>
                    <button type="button" className={BUTTON} disabled={busy !== null} onClick={() => switchTo(profile.id)}>
                      Switch on this version
                    </button>
                  </div>
                )}
                {profile.active && (
                  <p className="text-xs text-stone-400 dark:text-stone-500">
                    This version is in use. To edit its rules, switch it off first.
                  </p>
                )}
              </div>
            </details>
          ))}
        </section>
      )}
    </div>
  );
}
