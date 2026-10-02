import { getDb } from "@/lib/reply/db";
import { MAX_NOTES_EXPORT, notesExportFilename, toNotesExport } from "@/lib/reply/notes-export";
import { createNotesRepo } from "@/lib/reply/notes-store";

export const dynamic = "force-dynamic";

// Downloads the writer's notes as JSON. Private notes are never included (only
// their number is given), so the file is safe to share or keep elsewhere.
export async function GET(): Promise<Response> {
  try {
    const repo = createNotesRepo(getDb());
    const [notes, counts] = await Promise.all([repo.list({ status: "all", private: false }, MAX_NOTES_EXPORT), repo.counts()]);
    const now = new Date();
    return new Response(JSON.stringify(toNotesExport(notes, counts.private, now), null, 2), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="${notesExportFilename(now)}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    console.error("[/api/reply/notes/export]", err);
    return Response.json({ error: "Could not build the export." }, { status: 500 });
  }
}
