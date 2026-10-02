import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { connectionOptions } from "./db-options";
import { getReplyEnv } from "./env";
import * as schema from "./schema";

export type ReplyDb = PostgresJsDatabase<typeof schema>;

// Cached on globalThis so dev-server module reloads reuse one connection pool
// instead of opening a new one per reload.
const globalForDb = globalThis as unknown as { __replyDb?: ReplyDb };

export function getDb(): ReplyDb {
  if (!globalForDb.__replyDb) {
    const url = getReplyEnv().DATABASE_URL;
    const client = postgres(url, connectionOptions(url));
    globalForDb.__replyDb = drizzle(client, { schema });
  }
  return globalForDb.__replyDb;
}
