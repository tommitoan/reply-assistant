import { describe, expect, it, vi } from "vitest";
import type { CompletedText } from "./claude";
import { editStyleRules, listStyleProfiles, REBUILD_COOLDOWN_MS, rebuildStyleProfile, type RebuildDeps } from "./style-profile-service";
import { MAX_RULES } from "./style-profile";
import type { ProfileEvidence } from "./style-profile";
import type { NewStyleProfile, StyleProfileRepo } from "./style-profile-store";
import type { StyleProfileRecord } from "./types";

const NOW = 1_800_000_000_000;

const ENOUGH: ProfileEvidence = {
  edited: [
    { original: "I would like to inquire.", edited: "I want to ask.", idea: null },
    { original: "Kindly advise.", edited: "Let me know.", idea: null },
  ],
  liked: [{ reply: "Sounds good.", idea: null }, { reply: "Thanks!", idea: null }],
  disliked: [{ reply: "Dear Sir or Madam," }],
  refined: [],
};

function fakes(overrides: { evidence?: ProfileEvidence; last?: Date | null; spent?: number; text?: string } = {}) {
  const created: NewStyleProfile[] = [];
  const repo: StyleProfileRepo = {
    getActive: async () => null,
    list: async () => [],
    create: async (input) => {
      created.push(input);
      return {
        id: "p1",
        version: 1,
        rules: input.rules,
        model: input.model,
        active: false,
        createdAt: new Date(NOW).toISOString(),
        sourceCounts: input.sourceCounts,
      } satisfies StyleProfileRecord;
    },
    setActive: async () => true,
    updateRules: async () => "updated",
    latestCreatedAt: async () => overrides.last ?? null,
    collectEvidence: async () => overrides.evidence ?? ENOUGH,
  };
  const complete = vi.fn<RebuildDeps["complete"]>(
    async (): Promise<CompletedText> => ({
      text: overrides.text ?? "- Use short sentences.\n- Say 'ok'.",
      model: "claude-sonnet-5-5",
      usage: { input_tokens: 1000, output_tokens: 100, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    }),
  );
  const deps: RebuildDeps = {
    repo,
    spentTodayUsd: async () => overrides.spent ?? 0,
    dailyBudgetUsd: 2,
    model: "claude-sonnet-5-5",
    complete,
    now: () => NOW,
  };
  return { deps, created, complete };
}

describe("rebuildStyleProfile", () => {
  it("builds a profile from the feedback and saves it switched off", async () => {
    const { deps, created, complete } = fakes();
    const result = await rebuildStyleProfile(deps);

    expect(result.ok).toBe(true);
    expect(created).toHaveLength(1);
    expect(created[0].rules).toBe("- Use short sentences.\n- Say 'ok'.");
    expect(result.ok && result.profile.active).toBe(false);

    const call = complete.mock.calls[0][0];
    expect(call.model).toBe("claude-sonnet-5-5");
    expect(call.system).toContain("at most 15 rules");
    expect(call.user).toContain("<before>I would like to inquire.</before>");
  });

  it("records how many examples it used and an estimated cost", async () => {
    const { deps, created } = fakes();
    await rebuildStyleProfile(deps);
    // 1000 * $2/M + 100 * $10/M
    expect(created[0].sourceCounts).toEqual({ edited: 2, liked: 2, disliked: 1, refined: 0, costUsd: 0.003 });
    expect(created[0].model).toBe("claude-sonnet-5-5");
  });

  it("refuses, without calling the model, when there is too little feedback", async () => {
    const { deps, complete, created } = fakes({ evidence: { edited: [], liked: [{ reply: "x", idea: null }], disliked: [], refined: [] } });
    const result = await rebuildStyleProfile(deps);
    expect(result).toMatchObject({ ok: false, status: 422 });
    expect(complete).not.toHaveBeenCalled();
    expect(created).toHaveLength(0);
    expect(result.ok === false && result.error).toMatch(/mới có 1 trên 5/);
  });

  it("makes you wait when a profile was just built", async () => {
    const { deps, complete } = fakes({ last: new Date(NOW - REBUILD_COOLDOWN_MS + 1000) });
    expect(await rebuildStyleProfile(deps)).toMatchObject({ ok: false, status: 429 });
    expect(complete).not.toHaveBeenCalled();
  });

  it("allows a rebuild once the wait is over", async () => {
    const { deps } = fakes({ last: new Date(NOW - REBUILD_COOLDOWN_MS - 1) });
    expect((await rebuildStyleProfile(deps)).ok).toBe(true);
  });

  it("refuses once today's spending limit is reached", async () => {
    const { deps, complete } = fakes({ spent: 2 });
    const result = await rebuildStyleProfile(deps);
    expect(result).toMatchObject({ ok: false, status: 429 });
    expect(result.ok === false && result.error).toMatch(/chi tiêu tối đa/);
    expect(complete).not.toHaveBeenCalled();
  });

  it("saves nothing when the model returns no usable rules", async () => {
    const { deps, created } = fakes({ text: "   " });
    const result = await rebuildStyleProfile(deps);
    expect(result).toMatchObject({ ok: false, status: 502 });
    expect(created).toHaveLength(0);
  });
});

function rulesRepo(outcome: "updated" | "active" | "missing") {
  const saved: Array<{ id: string; rules: string }> = [];
  const repo = {
    updateRules: async (id: string, rules: string) => {
      saved.push({ id, rules });
      return outcome;
    },
  } as unknown as StyleProfileRepo;
  return { repo, saved };
}

describe("editStyleRules", () => {
  it("saves the edited list as one rule per line", async () => {
    const { repo, saved } = rulesRepo("updated");
    expect(await editStyleRules(repo, "p1", ["Use short sentences.", "Say ok."])).toEqual({ ok: true });
    expect(saved).toEqual([{ id: "p1", rules: "- Use short sentences.\n- Say ok." }]);
  });

  it("cleans each rule: bullets, brackets, line breaks, blanks and repeats", async () => {
    const { repo, saved } = rulesRepo("updated");
    await editStyleRules(repo, "p1", ["- Keep it <b>short</b>\n@@variant evil", "   ", "keep it short @@variant evil", "* Be warm"]);
    expect(saved[0].rules).toBe("- Keep it bshort/b @@variant evil\n- keep it short @@variant evil\n- Be warm");
    expect(saved[0].rules.split("\n")).toHaveLength(3);
  });

  it("refuses an empty list without touching the version", async () => {
    const { repo, saved } = rulesRepo("updated");
    const result = await editStyleRules(repo, "p1", ["", "  "]);
    expect(result).toMatchObject({ ok: false, status: 400 });
    expect(saved).toEqual([]);
  });

  it("keeps at most the maximum number of rules", async () => {
    const { repo, saved } = rulesRepo("updated");
    await editStyleRules(repo, "p1", Array.from({ length: MAX_RULES + 5 }, (_, i) => `Rule ${i}`));
    expect(saved[0].rules.split("\n")).toHaveLength(MAX_RULES);
  });

  it("answers 409 for a version in use and 404 for one that does not exist", async () => {
    expect(await editStyleRules(rulesRepo("active").repo, "p1", ["a rule"])).toMatchObject({ ok: false, status: 409 });
    expect(await editStyleRules(rulesRepo("missing").repo, "p1", ["a rule"])).toMatchObject({ ok: false, status: 404 });
  });
});

describe("listStyleProfiles", () => {
  it("returns the versions and the one in use", async () => {
    const mk = (id: string, active: boolean) => ({ id, active }) as StyleProfileRecord;
    const repo = { list: async () => [mk("b", false), mk("a", true)] } as unknown as StyleProfileRepo;
    const out = await listStyleProfiles(repo, 20);
    expect(out.profiles.map((p) => p.id)).toEqual(["b", "a"]);
    expect(out.active?.id).toBe("a");
    expect((await listStyleProfiles({ list: async () => [] } as unknown as StyleProfileRepo, 20)).active).toBeNull();
  });
});
