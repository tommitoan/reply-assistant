import { completeTextWithUsage, describeClaudeError } from "@/lib/reply/claude";
import { getDb } from "@/lib/reply/db";
import { getReplyEnv } from "@/lib/reply/env";
import { createReplyRepo } from "@/lib/reply/repo";
import { firstIssueMessage, styleProfilePatchSchema } from "@/lib/reply/schemas";
import { listStyleProfiles, rebuildStyleProfile } from "@/lib/reply/style-profile-service";
import { createStyleProfileRepo, type StyleProfileRepo } from "@/lib/reply/style-profile-store";
import { modelCallEntry, recordQuietly } from "@/lib/reply/usage";
import { createUsageRepo } from "@/lib/reply/usage-repo";

export const dynamic = "force-dynamic";
// Building a profile is one model call over the user's examples.
export const maxDuration = 60;

const LIST_LIMIT = 20;

function jsonError(message: string, status: number): Response {
  return Response.json({ error: message }, { status });
}

const listing = (repo: StyleProfileRepo) => listStyleProfiles(repo, LIST_LIMIT);

// The saved versions (newest first) and the one switched on, if any.
export async function GET(): Promise<Response> {
  try {
    return Response.json(await listing(createStyleProfileRepo(getDb())));
  } catch (err) {
    console.error("[/api/reply/style-profile]", err);
    return jsonError("Could not load the style profiles.", 500);
  }
}

// Builds a new version from the user's feedback. It is saved switched off.
export async function POST(): Promise<Response> {
  let env;
  try {
    env = getReplyEnv();
  } catch (err) {
    console.error("[/api/reply/style-profile]", err);
    return jsonError("The reply assistant is not configured on this server.", 503);
  }

  try {
    const db = getDb();
    const repo = createStyleProfileRepo(db);
    const result = await rebuildStyleProfile({
      repo,
      spentTodayUsd: () => createReplyRepo(db).spentTodayUsd(),
      dailyBudgetUsd: env.REPLY_DAILY_BUDGET_USD,
      model: env.REPLY_MODEL_STYLE,
      // Recorded as soon as the model answers, so a rebuild that is then
      // rejected (no usable rules) is still counted.
      complete: async (params) => {
        const completed = await completeTextWithUsage(params);
        await recordQuietly(createUsageRepo(db), modelCallEntry("style_profile", completed.model, completed.usage));
        return completed;
      },
    });
    if (!result.ok) return jsonError(result.error, result.status);
    return Response.json({ profile: result.profile, ...(await listing(repo)) }, { status: 201 });
  } catch (err) {
    console.error("[/api/reply/style-profile]", err);
    return jsonError(describeClaudeError(err).message, 502);
  }
}

// Switches a version on ({ activeId }) or every version off ({ activeId: null }).
export async function PATCH(req: Request): Promise<Response> {
  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return jsonError("Invalid JSON body.", 400);
  }
  const parsed = styleProfilePatchSchema.safeParse(payload);
  if (!parsed.success) return jsonError(firstIssueMessage(parsed.error), 400);

  try {
    const repo = createStyleProfileRepo(getDb());
    if (!(await repo.setActive(parsed.data.activeId))) return jsonError("That style profile was not found.", 404);
    return Response.json(await listing(repo));
  } catch (err) {
    console.error("[/api/reply/style-profile]", err);
    return jsonError("Could not save that. Try again.", 500);
  }
}
