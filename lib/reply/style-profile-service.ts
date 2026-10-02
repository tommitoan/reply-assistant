import type { CompletedText } from "./claude";
import { computeCostUsd } from "./pricing";
import {
  buildProfileRequest,
  checkEvidence,
  formatRules,
  normalizeRules,
  parseRules,
  STYLE_PROFILE_SYSTEM,
} from "./style-profile";
import type { StyleProfileRepo } from "./style-profile-store";
import type { StyleProfileRecord } from "./types";

// A rebuild is a paid call; this keeps a double click or a script from
// turning into several of them.
export const REBUILD_COOLDOWN_MS = 60_000;
const PROFILE_MAX_TOKENS = 800;

export interface RebuildDeps {
  repo: StyleProfileRepo;
  spentTodayUsd: () => Promise<number>;
  dailyBudgetUsd: number;
  model: string;
  complete: (params: { model: string; system: string; user: string; maxTokens: number }) => Promise<CompletedText>;
  now?: () => number;
}

export type RebuildResult =
  | { ok: true; profile: StyleProfileRecord }
  | { ok: false; status: 422 | 429 | 502; error: string };

// Builds a new profile from the user's feedback. The new version is saved
// switched off: it is read and activated by the user, not applied silently.
export async function rebuildStyleProfile(deps: RebuildDeps): Promise<RebuildResult> {
  const now = deps.now ?? Date.now;

  const last = await deps.repo.latestCreatedAt();
  if (last && now() - last.getTime() < REBUILD_COOLDOWN_MS) {
    return { ok: false, status: 429, error: "A profile was built a moment ago. Wait a minute and try again." };
  }
  if ((await deps.spentTodayUsd()) >= deps.dailyBudgetUsd) {
    return {
      ok: false,
      status: 429,
      error: "The daily spending limit for replies is reached. It resets at 00:00 UTC.",
    };
  }

  const evidence = await deps.repo.collectEvidence();
  const check = checkEvidence(evidence);
  if (!check.ok) return { ok: false, status: 422, error: check.message };

  const completed = await deps.complete({
    model: deps.model,
    system: STYLE_PROFILE_SYSTEM,
    user: buildProfileRequest(evidence),
    maxTokens: PROFILE_MAX_TOKENS,
  });
  const rules = parseRules(completed.text);
  if (rules.length === 0) {
    return { ok: false, status: 502, error: "The model did not return usable rules. Try again." };
  }

  const profile = await deps.repo.create({
    rules: formatRules(rules),
    model: completed.model || deps.model,
    sourceCounts: {
      edited: evidence.edited.length,
      liked: evidence.liked.length,
      disliked: evidence.disliked.length,
      refined: evidence.refined.length,
      costUsd: computeCostUsd(completed.model || deps.model, completed.usage),
    },
  });
  return { ok: true, profile };
}

export interface ProfileListing {
  profiles: StyleProfileRecord[];
  active: StyleProfileRecord | null;
}

// The saved versions (newest first) and the one switched on, if any.
export async function listStyleProfiles(repo: StyleProfileRepo, limit: number): Promise<ProfileListing> {
  const profiles = await repo.list(limit);
  return { profiles, active: profiles.find((profile) => profile.active) ?? null };
}

export type EditRulesResult = { ok: true } | { ok: false; status: 400 | 404 | 409; error: string };

// Saves the writer's edited list of rules for one version: wording changed,
// rules deleted or added. Only a version that is not in use can be edited, so
// the rules in every request never change under the writer.
export async function editStyleRules(repo: StyleProfileRepo, id: string, rules: string[]): Promise<EditRulesResult> {
  const kept = normalizeRules(rules);
  if (kept.length === 0) {
    return { ok: false, status: 400, error: "Keep at least one rule. To stop using a profile, switch it off." };
  }
  const outcome = await repo.updateRules(id, formatRules(kept));
  if (outcome === "missing") return { ok: false, status: 404, error: "That style profile was not found." };
  if (outcome === "active") {
    return { ok: false, status: 409, error: "This version is in use. Switch it off before editing its rules." };
  }
  return { ok: true };
}
