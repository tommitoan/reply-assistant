// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createSessionToken, passcodeMatches, verifySessionToken } from "./session";

const SECRET = "test-secret-test-secret-test-secret-1234";
const NOW = 1_800_000_000_000;

describe("session token", () => {
  it("round-trips a freshly signed token", async () => {
    const token = await createSessionToken(SECRET, NOW);
    expect(await verifySessionToken(token, SECRET, NOW)).toBe(true);
  });

  it("is still valid just before expiry and invalid at expiry", async () => {
    const token = await createSessionToken(SECRET, NOW, 60);
    expect(await verifySessionToken(token, SECRET, NOW + 59_000)).toBe(true);
    expect(await verifySessionToken(token, SECRET, NOW + 60_000)).toBe(false);
  });

  it("rejects a token signed with a different secret", async () => {
    const token = await createSessionToken("another-secret-another-secret-12345", NOW);
    expect(await verifySessionToken(token, SECRET, NOW)).toBe(false);
  });

  it("rejects a token whose expiry was extended", async () => {
    const token = await createSessionToken(SECRET, NOW, 60);
    const [expiry, signature] = token.split(".");
    const forged = `${Number(expiry) + 86_400}.${signature}`;
    expect(await verifySessionToken(forged, SECRET, NOW)).toBe(false);
  });

  it("rejects a token whose signature was altered", async () => {
    const token = await createSessionToken(SECRET, NOW);
    const flipped = token.slice(0, -1) + (token.endsWith("0") ? "1" : "0");
    expect(await verifySessionToken(flipped, SECRET, NOW)).toBe(false);
  });

  it.each([
    ["undefined", undefined],
    ["empty", ""],
    ["no separator", "12345"],
    ["empty signature", "12345."],
    ["non-numeric expiry", "abc.deadbeef"],
    ["non-hex signature", "9999999999.zzzz"],
    ["odd-length signature", "9999999999.abc"],
    ["extra segment", "9999999999.aa.bb"],
  ])("rejects a malformed token (%s)", async (_label, token) => {
    expect(await verifySessionToken(token, SECRET, NOW)).toBe(false);
  });
});

describe("passcodeMatches", () => {
  it("accepts the exact passcode", async () => {
    expect(await passcodeMatches("correct horse", "correct horse")).toBe(true);
  });

  it("rejects a different passcode of the same length", async () => {
    expect(await passcodeMatches("correct horsf", "correct horse")).toBe(false);
  });

  it("rejects prefixes, extensions and the empty string", async () => {
    expect(await passcodeMatches("correct", "correct horse")).toBe(false);
    expect(await passcodeMatches("correct horse!", "correct horse")).toBe(false);
    expect(await passcodeMatches("", "correct horse")).toBe(false);
  });
});
