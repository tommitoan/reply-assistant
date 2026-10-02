import { z } from "zod";

// Blank values in `.env` (`KEY=`) are treated as unset so defaults apply.
function withoutBlanks(source: Record<string, string | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(source)) {
    if (value !== undefined && value.trim() !== "") out[key] = value;
  }
  return out;
}

const postgresUrl = z
  .string()
  .regex(/^postgres(ql)?:\/\//, "must be a postgres:// or postgresql:// URL");

const authEnvSchema = z.object({
  APP_PASSCODE: z.string().min(8, "must be at least 8 characters"),
  APP_SESSION_SECRET: z.string().min(32, "must be at least 32 characters"),
});

const replyEnvSchema = z.object({
  DATABASE_URL: postgresUrl,
  // Falls back to ANTHROPIC_API_KEY at the call site; a dedicated key keeps
  // reply spend separately trackable and limitable.
  REPLY_ANTHROPIC_API_KEY: z.string().optional(),
  // Memory is switched off when this is missing.
  VOYAGE_API_KEY: z.string().optional(),
  REPLY_EMBED_MODEL: z.string().default("voyage-3.5-lite"),
  // What the embedding account allows per minute. The defaults are the limits of
  // an account without a payment method; raise them if the account has more.
  REPLY_EMBED_RPM: z.coerce.number().int().min(1).default(3),
  REPLY_EMBED_TPM: z.coerce.number().int().min(1000).default(10000),
  REPLY_MODEL_FAST: z.string().default("claude-haiku-4-5"),
  REPLY_MODEL_SMART: z.string().default("claude-sonnet-5-5"),
  REPLY_MODEL_SUMMARY: z.string().default("claude-haiku-4-5"),
  REPLY_MODEL_STYLE: z.string().default("claude-sonnet-5-5"),
  REPLY_MODEL_EXPLAIN: z.string().default("claude-haiku-4-5"),
  REPLY_MODEL_NOTES: z.string().default("claude-haiku-4-5"),
  REPLY_SMART_EFFORT: z.enum(["low", "medium", "high"]).default("low"),
  REPLY_SMART_THINKING: z.enum(["adaptive", "between_tools"]).default("adaptive"),
  REPLY_SELF_NAMES: z
    .string()
    .default("")
    .transform((raw) =>
      raw
        .split(",")
        .map((name) => name.trim())
        .filter(Boolean),
    ),
  REPLY_DAILY_BUDGET_USD: z.coerce.number().positive().default(2),
});

// Only a guess-resistant passcode protects the app from someone spending the
// API credit, so a short one is reported. It is a warning, not an error, so an
// existing deployment keeps working while the passcode is replaced.
export const RECOMMENDED_PASSCODE_LENGTH = 16;

export function passcodeWarning(passcode: string): string | null {
  if (passcode.length >= RECOMMENDED_PASSCODE_LENGTH) return null;
  return `APP_PASSCODE is shorter than ${RECOMMENDED_PASSCODE_LENGTH} characters. Use a long random value, for example: openssl rand -base64 24`;
}

export type AuthEnv = z.infer<typeof authEnvSchema>;
export type ReplyEnv = z.infer<typeof replyEnvSchema>;

type EnvSource = Record<string, string | undefined>;

// Messages list variable names and constraints only, never the values, so a
// misconfigured secret cannot leak through a log line.
function describeIssues(label: string, error: z.ZodError): string {
  const lines = error.issues.map((issue) => `  ${issue.path.join(".") || "(root)"}: ${issue.message}`);
  return `invalid ${label} environment:\n${lines.join("\n")}`;
}

export function parseAuthEnv(source: EnvSource): AuthEnv {
  const result = authEnvSchema.safeParse(withoutBlanks(source));
  if (!result.success) throw new Error(describeIssues("auth", result.error));
  return result.data;
}

export function parseReplyEnv(source: EnvSource): ReplyEnv {
  const result = replyEnvSchema.safeParse(withoutBlanks(source));
  if (!result.success) throw new Error(describeIssues("reply", result.error));
  return result.data;
}

let authEnvCache: AuthEnv | undefined;
let replyEnvCache: ReplyEnv | undefined;

// Validated on first use rather than at import time, so `next build` and
// tests that never touch auth or the database do not need these variables.
export function getAuthEnv(): AuthEnv {
  if (!authEnvCache) {
    authEnvCache = parseAuthEnv(process.env);
    const warning = passcodeWarning(authEnvCache.APP_PASSCODE);
    if (warning) console.warn(`[auth] ${warning}`);
  }
  return authEnvCache;
}

export function getReplyEnv(): ReplyEnv {
  replyEnvCache ??= parseReplyEnv(process.env);
  return replyEnvCache;
}

// Non-throwing check for callers that must degrade gracefully (the proxy and
// the login page report "not configured" instead of crashing).
export function isAuthConfigured(source: EnvSource = process.env): boolean {
  return authEnvSchema.safeParse(withoutBlanks(source)).success;
}
