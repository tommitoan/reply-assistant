import type { Options } from "postgres";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

// Connection settings derived from the URL, so the same code works against
// the local Docker database and a hosted one (Neon).
export function connectionOptions(url: string): Options<Record<string, never>> {
  const { hostname, searchParams } = new URL(url);
  // TLS is required for any host that is not this machine, unless the URL says
  // `sslmode=disable` on purpose: that is how a database container reached over
  // a private Docker network (host `db`, no TLS) is addressed.
  const plain = LOCAL_HOSTS.has(hostname) || searchParams.get("sslmode") === "disable";
  return {
    max: 5,
    ssl: plain ? false : "require",
    // A transaction-mode pooler (Neon's "-pooler" host) cannot keep
    // prepared statements between queries.
    prepare: !hostname.includes("-pooler"),
  };
}
