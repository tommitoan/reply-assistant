import type { Options } from "postgres";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

// Connection settings derived from the URL, so the same code works against
// the local Docker database and a hosted one (Neon).
export function connectionOptions(url: string): Options<Record<string, never>> {
  const { hostname } = new URL(url);
  return {
    max: 5,
    // Hosted databases refuse plain connections; the local container has no TLS.
    ssl: LOCAL_HOSTS.has(hostname) ? false : "require",
    // A transaction-mode pooler (Neon's "-pooler" host) cannot keep
    // prepared statements between queries.
    prepare: !hostname.includes("-pooler"),
  };
}
