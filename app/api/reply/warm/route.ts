import { warmFastCache } from "@/lib/reply/claude";
import { getDb } from "@/lib/reply/db";
import { toPromptNote } from "@/lib/reply/notes-context";
import { createNotesReader } from "@/lib/reply/notes-read";
import { labelNotes } from "@/lib/reply/notes-select";
import { createStyleProfileRepo } from "@/lib/reply/style-profile-store";
import { modelCallEntry, recordQuietly } from "@/lib/reply/usage";
import { createUsageRepo } from "@/lib/reply/usage-repo";
import { shouldWarm } from "@/lib/reply/warm-throttle";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// The browser throttles its own calls; this guard keeps repeated or scripted
// calls from turning into repeated cache writes.
let lastWarmAt: number | null = null;

export async function POST(req: Request): Promise<Response> {
  const now = Date.now();
  if (!shouldWarm(now, lastWarmAt)) return new Response(null, { status: 204 });

  try {
    // Warm the prefix real requests will send, which includes the active style
    // profile and the pinned notes. Without them (or if they cannot be read) the
    // plain prefix is warmed.
    const db = getDb();
    const profile = await createStyleProfileRepo(db)
      .getActive()
      .catch(() => null);
    // Pinned notes are per scope (work or casual): warm the one being used.
    const context = new URL(req.url).searchParams.get("context") === "casual" ? "casual" : "work";
    const pinned = await createNotesReader(db)
      .listPinned({ context })
      .catch(() => []);
    const warmed = await warmFastCache(profile, labelNotes(pinned, []).map(toPromptNote));
    lastWarmAt = now;
    await recordQuietly(createUsageRepo(db), modelCallEntry("warm", warmed.model, warmed.usage));
    return new Response(null, { status: 204 });
  } catch (err) {
    console.error("[/api/reply/warm]", err);
    return Response.json({ error: "Could not warm the cache." }, { status: 502 });
  }
}
