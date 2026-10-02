// Session cookies are `<expiry-unix-seconds>.<hmac-sha256-hex>`. Only Web
// Crypto is used so the same code runs in the proxy and in Server Actions.

export const SESSION_COOKIE = "ip_session";
export const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;

// Shared by login (sets the cookie) and logout (expires it): the browser only
// replaces a cookie whose attributes match.
export function sessionCookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    // Plain http://localhost cannot carry a Secure cookie during development.
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge,
  };
}

const encoder = new TextEncoder();

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function fromHex(hex: string): Uint8Array<ArrayBuffer> | null {
  if (hex.length === 0 || hex.length % 2 !== 0 || !/^[0-9a-f]+$/.test(hex)) return null;
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

// The version prefix lets the signing scheme change later without old cookies
// ever validating under the new one.
function signingInput(expiresAt: number): Uint8Array<ArrayBuffer> {
  return encoder.encode(`v1.${expiresAt}`);
}

export async function createSessionToken(
  secret: string,
  now: number = Date.now(),
  ttlSeconds: number = SESSION_TTL_SECONDS,
): Promise<string> {
  const expiresAt = Math.floor(now / 1000) + ttlSeconds;
  const signature = await crypto.subtle.sign("HMAC", await hmacKey(secret), signingInput(expiresAt));
  return `${expiresAt}.${toHex(new Uint8Array(signature))}`;
}

export async function verifySessionToken(
  token: string | undefined,
  secret: string,
  now: number = Date.now(),
): Promise<boolean> {
  if (!token) return false;
  const [expiryPart, signaturePart, ...rest] = token.split(".");
  if (rest.length > 0 || !expiryPart || !signaturePart) return false;
  if (!/^\d{1,12}$/.test(expiryPart)) return false;

  const signature = fromHex(signaturePart);
  if (!signature) return false;

  const expiresAt = Number(expiryPart);
  // `subtle.verify` compares the MAC in constant time.
  const valid = await crypto.subtle.verify(
    "HMAC",
    await hmacKey(secret),
    signature,
    signingInput(expiresAt),
  );
  return valid && expiresAt > Math.floor(now / 1000);
}

async function sha256(value: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value)));
}

// Hashing both sides first gives equal-length inputs, so the comparison below
// cannot leak the passcode length or a matching prefix through timing.
export async function passcodeMatches(submitted: string, expected: string): Promise<boolean> {
  const [a, b] = await Promise.all([sha256(submitted), sha256(expected)]);
  let diff = a.length ^ b.length;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ (b[i] ?? 0);
  return diff === 0;
}
