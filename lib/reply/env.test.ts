import { describe, expect, it } from "vitest";
import { isAuthConfigured, parseAuthEnv, parseReplyEnv, passcodeWarning } from "./env";

const VALID_AUTH = {
  APP_PASSCODE: "passcode-123",
  APP_SESSION_SECRET: "s".repeat(32),
};

describe("parseAuthEnv", () => {
  it("accepts a valid passcode and secret", () => {
    expect(parseAuthEnv(VALID_AUTH)).toEqual(VALID_AUTH);
  });

  it("rejects missing variables and names them without echoing values", () => {
    expect(() => parseAuthEnv({})).toThrow(/APP_PASSCODE/);
    expect(() => parseAuthEnv({})).toThrow(/APP_SESSION_SECRET/);
  });

  it("rejects a short secret without leaking it", () => {
    const attempt = () => parseAuthEnv({ ...VALID_AUTH, APP_SESSION_SECRET: "too-short-secret" });
    expect(attempt).toThrow(/APP_SESSION_SECRET.*at least 32/);
    expect(attempt).not.toThrow(/too-short-secret/);
  });

  it("treats a blank value as unset", () => {
    expect(() => parseAuthEnv({ ...VALID_AUTH, APP_PASSCODE: "   " })).toThrow(/APP_PASSCODE/);
  });
});

describe("isAuthConfigured", () => {
  it("is true only when both variables are valid", () => {
    expect(isAuthConfigured(VALID_AUTH)).toBe(true);
    expect(isAuthConfigured({ APP_PASSCODE: VALID_AUTH.APP_PASSCODE })).toBe(false);
    expect(isAuthConfigured({})).toBe(false);
  });
});

describe("parseReplyEnv", () => {
  const DATABASE_URL = "postgres://user:pw@localhost:5433/reply";

  it("applies documented defaults when only DATABASE_URL is set", () => {
    const env = parseReplyEnv({ DATABASE_URL });
    expect(env).toMatchObject({
      DATABASE_URL,
      REPLY_EMBED_MODEL: "voyage-3.5-lite",
      REPLY_EMBED_RPM: 3,
      REPLY_EMBED_TPM: 10000,
      REPLY_MODEL_FAST: "claude-haiku-4-5",
      REPLY_MODEL_SMART: "claude-sonnet-5-5",
      REPLY_MODEL_SUMMARY: "claude-haiku-4-5",
      REPLY_MODEL_STYLE: "claude-sonnet-5-5",
      REPLY_SMART_EFFORT: "low",
      REPLY_SMART_THINKING: "adaptive",
      REPLY_SELF_NAMES: [],
      REPLY_DAILY_BUDGET_USD: 2,
    });
  });

  it("requires DATABASE_URL", () => {
    expect(() => parseReplyEnv({})).toThrow(/DATABASE_URL/);
  });

  it("rejects a DATABASE_URL that is not a postgres URL", () => {
    expect(() => parseReplyEnv({ DATABASE_URL: "mysql://localhost/db" })).toThrow(/DATABASE_URL/);
  });

  it("parses self names, trimming and dropping empties", () => {
    const env = parseReplyEnv({ DATABASE_URL, REPLY_SELF_NAMES: "  Sam , Alex,, " });
    expect(env.REPLY_SELF_NAMES).toEqual(["Sam", "Alex"]);
  });

  it("coerces the daily budget and rejects non-positive values", () => {
    expect(parseReplyEnv({ DATABASE_URL, REPLY_DAILY_BUDGET_USD: "5.5" }).REPLY_DAILY_BUDGET_USD).toBe(5.5);
    expect(() => parseReplyEnv({ DATABASE_URL, REPLY_DAILY_BUDGET_USD: "0" })).toThrow(
      /REPLY_DAILY_BUDGET_USD/,
    );
    expect(() => parseReplyEnv({ DATABASE_URL, REPLY_DAILY_BUDGET_USD: "abc" })).toThrow(
      /REPLY_DAILY_BUDGET_USD/,
    );
  });

  it("reads the embedding budget, with the limits of an account without a payment method as the default", () => {
    expect(parseReplyEnv({ DATABASE_URL, REPLY_EMBED_RPM: "2000", REPLY_EMBED_TPM: "1000000" })).toMatchObject({
      REPLY_EMBED_RPM: 2000,
      REPLY_EMBED_TPM: 1_000_000,
    });
    for (const bad of [{ REPLY_EMBED_RPM: "0" }, { REPLY_EMBED_RPM: "fast" }, { REPLY_EMBED_TPM: "10" }]) {
      expect(() => parseReplyEnv({ DATABASE_URL, ...bad })).toThrow(/REPLY_EMBED_(RPM|TPM)/);
    }
  });

  it("rejects unknown effort and thinking modes", () => {
    expect(() => parseReplyEnv({ DATABASE_URL, REPLY_SMART_EFFORT: "extreme" })).toThrow(
      /REPLY_SMART_EFFORT/,
    );
    expect(() => parseReplyEnv({ DATABASE_URL, REPLY_SMART_THINKING: "disabled" })).toThrow(
      /REPLY_SMART_THINKING/,
    );
  });

  it("accepts the alternative thinking mode", () => {
    expect(
      parseReplyEnv({ DATABASE_URL, REPLY_SMART_THINKING: "between_tools" }).REPLY_SMART_THINKING,
    ).toBe("between_tools");
  });
});

describe("passcodeWarning", () => {
  it("accepts a passcode of 16 characters or more", () => {
    expect(passcodeWarning("a".repeat(16))).toBeNull();
    expect(passcodeWarning("a".repeat(40))).toBeNull();
  });

  it("warns about a shorter passcode without repeating it", () => {
    const passcode = "short-pass-1";
    const warning = passcodeWarning(passcode);
    expect(warning).toContain("16");
    expect(warning).not.toContain(passcode);
  });
});
