import { defineConfig } from "drizzle-kit";

// drizzle-kit reads `.env` by itself before this file runs, and variables that
// are already in the environment win. To point a command at another database,
// pass DATABASE_URL inline for that one command.

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
const CHANGES_DATABASE = ["migrate", "push", "drop", "up"];

function parseTarget(url: string | undefined): { label: string; local: boolean } {
  if (!url) return { label: "(DATABASE_URL is not set)", local: false };
  try {
    const { hostname, port, pathname } = new URL(url);
    // Host, port and database name only; never credentials.
    return { label: `${hostname}${port ? `:${port}` : ""}${pathname}`, local: LOCAL_HOSTS.has(hostname) };
  } catch {
    return { label: "(DATABASE_URL is not a valid URL)", local: false };
  }
}

const target = parseTarget(process.env.DATABASE_URL);
console.log(`[drizzle] database target: ${target.label}`);

// A shared `.env` can hold the URL of a database that has nothing to do with
// the Reply Assistant. Commands that change a database must not run against a
// remote one unless that was asked for explicitly.
if (
  process.argv.some((arg) => CHANGES_DATABASE.includes(arg)) &&
  !target.local &&
  process.env.ALLOW_REMOTE_MIGRATE !== "1"
) {
  console.error(
    `[drizzle] refusing to change ${target.label}: it is not a local database.\n` +
      "If this is the database you mean, run the command again with ALLOW_REMOTE_MIGRATE=1.",
  );
  process.exit(1);
}

// Hosted databases refuse plain connections, and drizzle-kit hides the reason
// when a connection fails, so TLS is requested explicitly instead of relying on
// the URL carrying `?sslmode=require`. The URL is split into parts because the
// URL-only form of the credentials has no TLS setting.
function credentials(url: string | undefined) {
  if (!url) return { url: "" }; // `db:generate` never connects
  try {
    const parsed = new URL(url);
    return {
      host: parsed.hostname,
      port: parsed.port ? Number(parsed.port) : undefined,
      user: decodeURIComponent(parsed.username),
      password: decodeURIComponent(parsed.password),
      database: decodeURIComponent(parsed.pathname.slice(1)),
      // `sslmode=disable` is how a database container on a private Docker network is addressed.
      ssl: target.local || parsed.searchParams.get("sslmode") === "disable" ? (false as const) : ("require" as const),
    };
  } catch {
    return { url };
  }
}

export default defineConfig({
  dialect: "postgresql",
  schema: "./lib/reply/schema.ts",
  out: "./drizzle",
  dbCredentials: credentials(process.env.DATABASE_URL),
});
