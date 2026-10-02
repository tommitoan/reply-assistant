import { getDb } from "@/lib/reply/db";
import { firstIssueMessage, optionIdSchema, styleRulesPatchSchema } from "@/lib/reply/schemas";
import { editStyleRules, listStyleProfiles } from "@/lib/reply/style-profile-service";
import { createStyleProfileRepo } from "@/lib/reply/style-profile-store";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

const LIST_LIMIT = 20;

function jsonError(message: string, status: number): Response {
  return Response.json({ error: message }, { status });
}

// Saves an edited list of rules ({ rules: [...] }) for one version that is not
// switched on: wording changed, rules deleted or added.
export async function PATCH(req: Request, { params }: Context): Promise<Response> {
  const id = optionIdSchema.safeParse((await params).id);
  if (!id.success) return jsonError("That style profile was not found.", 404);

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return jsonError("Invalid JSON body.", 400);
  }
  const parsed = styleRulesPatchSchema.safeParse(payload);
  if (!parsed.success) return jsonError(firstIssueMessage(parsed.error), 400);

  try {
    const repo = createStyleProfileRepo(getDb());
    const result = await editStyleRules(repo, id.data, parsed.data.rules);
    if (!result.ok) return jsonError(result.error, result.status);
    return Response.json(await listStyleProfiles(repo, LIST_LIMIT));
  } catch (err) {
    console.error("[/api/reply/style-profile/[id]]", err);
    return jsonError("Could not save that. Try again.", 500);
  }
}
