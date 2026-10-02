import { getDb } from "@/lib/reply/db";
import { createReplyRepo } from "@/lib/reply/repo";
import { generationsLimitSchema, generationsScopeSchema } from "@/lib/reply/schemas";

export const dynamic = "force-dynamic";

// Recent finished generations with their options, newest first, so replies
// can be rated or edited after the page was closed. ?conversation=<id> limits
// them to one thread and ?conversation=none to those made outside any thread.
export async function GET(req: Request): Promise<Response> {
  const params = new URL(req.url).searchParams;
  const limit = generationsLimitSchema.parse(params.get("limit") ?? undefined);
  const conversation = generationsScopeSchema.parse(params.get("conversation") ?? undefined);
  const scope = conversation === undefined ? undefined : { conversationId: conversation === "none" ? null : conversation };
  try {
    const generations = await createReplyRepo(getDb()).listRecentGenerations(limit, scope);
    return Response.json({ generations });
  } catch (err) {
    console.error("[/api/reply/generations]", err);
    return Response.json({ error: "Không tải được danh sách gần đây." }, { status: 500 });
  }
}
