const PRIVATE_CODE_BYTES = 16;
const QR_PREFIX = "healthdesign-link-v1.";
const UUID_PATTERN =
  "[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";

export type AccessRoute =
  | { kind: "code-consume" }
  | { kind: "invitation-redeem" }
  | { kind: "profiles-list" }
  | { kind: "qr-consume" }
  | { kind: "qr-create"; profileId: string }
  | { kind: "private-code-rotate"; profileId: string }
  | { kind: "session-revoke"; profileId: string; sessionId: string }
  | { kind: "sessions-list"; profileId: string }
  | { kind: "session-touch" };

function randomBytes(length: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(length));
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function base64UrlToBytes(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("invalid_base64url");
  const base64 = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function bytesToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return Uint8Array.from(bytes).buffer;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function generateInvitationSecret(): string {
  return bytesToBase64Url(randomBytes(PRIVATE_CODE_BYTES));
}

export function generateQrPayload(): string {
  return `${QR_PREFIX}${bytesToBase64Url(randomBytes(PRIVATE_CODE_BYTES))}`;
}

export function generatePrivateCode(): string {
  return bytesToHex(randomBytes(PRIVATE_CODE_BYTES))
    .toUpperCase()
    .match(/.{4}/g)!
    .join("-");
}

export function normalizePrivateCode(code: string): string {
  const normalized = code.replace(/[\s-]/g, "").toUpperCase();
  if (!/^[A-F0-9]{32}$/.test(normalized)) throw new Error("invalid_private_code");
  return normalized;
}

export async function hashSha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return bytesToHex(new Uint8Array(digest));
}

export async function hmacSha256Hex(value: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { hash: "SHA-256", name: "HMAC" },
    false,
    ["sign"],
  );
  const digest = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return bytesToHex(new Uint8Array(digest));
}

export function constantTimeEqualHex(left: string, right: string): boolean {
  let mismatch = left.length ^ right.length;
  for (let index = 0; index < 64; index += 1) {
    mismatch |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }
  return mismatch === 0;
}

export function parseAccessRoute(url: URL): AccessRoute | null {
  if (url.search !== "" || url.hash !== "") return null;
  const versionIndex = url.pathname.lastIndexOf("/v1/");
  if (versionIndex < 0) return null;
  const path = url.pathname.slice(versionIndex);

  const staticRoutes: Readonly<Record<string, AccessRoute>> = {
    "/v1/device-links/code/consume": { kind: "code-consume" },
    "/v1/device-links/qr/consume": { kind: "qr-consume" },
    "/v1/invitations/redeem": { kind: "invitation-redeem" },
    "/v1/me/profiles": { kind: "profiles-list" },
    "/v1/me/session/touch": { kind: "session-touch" },
  };
  const staticRoute = staticRoutes[path];
  if (staticRoute) return staticRoute;

  const profileMatch = new RegExp(
    `^/v1/profiles/(${UUID_PATTERN})/(device-links/qr|private-code/rotate|sessions)$`,
    "i",
  ).exec(path);
  if (profileMatch?.[1] && profileMatch[2]) {
    if (profileMatch[2] === "device-links/qr") {
      return { kind: "qr-create", profileId: profileMatch[1] };
    }
    if (profileMatch[2] === "private-code/rotate") {
      return { kind: "private-code-rotate", profileId: profileMatch[1] };
    }
    return { kind: "sessions-list", profileId: profileMatch[1] };
  }

  const revokeMatch = new RegExp(
    `^/v1/profiles/(${UUID_PATTERN})/sessions/(${UUID_PATTERN})/revoke$`,
    "i",
  ).exec(path);
  if (revokeMatch?.[1] && revokeMatch[2]) {
    return {
      kind: "session-revoke",
      profileId: revokeMatch[1],
      sessionId: revokeMatch[2],
    };
  }
  return null;
}

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a.localeCompare(b),
    );
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function stripEphemeralAccessTokens(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripEphemeralAccessTokens);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([key]) => key !== "captchaToken" && key !== "challengeToken")
        .map(([key, item]) => [key, stripEphemeralAccessTokens(item)]),
    );
  }
  return value;
}

async function importIdempotencyKey(encodedKey: string): Promise<CryptoKey> {
  const keyBytes = base64UrlToBytes(encodedKey);
  if (keyBytes.byteLength !== 32) throw new Error("invalid_idempotency_key");
  return crypto.subtle.importKey(
    "raw",
    bytesToArrayBuffer(keyBytes),
    "AES-GCM",
    false,
    ["decrypt", "encrypt"],
  );
}

export async function encryptAccessResponse(
  payload: unknown,
  encodedKey: string,
  additionalData: string,
): Promise<{ ciphertext: string; nonce: string }> {
  const nonce = randomBytes(12);
  const ciphertext = await crypto.subtle.encrypt(
    {
      additionalData: new TextEncoder().encode(additionalData),
      iv: bytesToArrayBuffer(nonce),
      name: "AES-GCM",
    },
    await importIdempotencyKey(encodedKey),
    new TextEncoder().encode(canonicalJson(payload)),
  );
  return {
    ciphertext: bytesToBase64Url(new Uint8Array(ciphertext)),
    nonce: bytesToBase64Url(nonce),
  };
}

export async function decryptAccessResponse<T = unknown>(
  encrypted: { ciphertext: string; nonce: string },
  encodedKey: string,
  additionalData: string,
): Promise<T> {
  const plaintext = await crypto.subtle.decrypt(
    {
      additionalData: new TextEncoder().encode(additionalData),
      iv: bytesToArrayBuffer(base64UrlToBytes(encrypted.nonce)),
      name: "AES-GCM",
    },
    await importIdempotencyKey(encodedKey),
    bytesToArrayBuffer(base64UrlToBytes(encrypted.ciphertext)),
  );
  return JSON.parse(new TextDecoder().decode(plaintext)) as T;
}
