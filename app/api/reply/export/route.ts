import { getDb } from "@/lib/reply/db";
import { exportFilename, serializeJsonl, toExportRecords } from "@/lib/reply/export";
import { createExportRepo } from "@/lib/reply/export-repo";

export const dynamic = "force-dynamic";

// Downloads the replies you edited or liked (Learn on only) as JSON Lines, one
// example per line, ready to keep as a corpus.
export async function GET(): Promise<Response> {
  try {
    const repo = createExportRepo(getDb());
    const rows = await repo.loadRows();
    const conversationIds = [...new Set(rows.flatMap((row) => (row.conversationId ? [row.conversationId] : [])))];
    const body = serializeJsonl(toExportRecords(rows, await repo.loadMessages(conversationIds)));
    return new Response(body, {
      headers: {
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "Content-Disposition": `attachment; filename="${exportFilename(new Date())}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    console.error("[/api/reply/export]", err);
    return Response.json({ error: "Không tạo được tệp xuất." }, { status: 500 });
  }
}
