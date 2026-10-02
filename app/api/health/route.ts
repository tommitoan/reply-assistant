// Liveness only: no database or auth dependency, so the platform health check
// reflects whether the server process is up.
export const dynamic = "force-dynamic";

export function GET() {
  return Response.json({ status: "ok" });
}
