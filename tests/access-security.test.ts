import { describe, expect, it } from "vitest";

import {
  constantTimeEqualHex,
  decryptAccessResponse,
  encryptAccessResponse,
  generateInvitationSecret,
  generatePrivateCode,
  generateQrPayload,
  hashSha256Hex,
  hmacSha256Hex,
  normalizePrivateCode,
  parseAccessRoute,
  stripEphemeralAccessTokens,
} from "../supabase/functions/_shared/access-security";
import { classifyAccessAttempt } from "../supabase/functions/_shared/rate-limit";

describe("secretos de acceso", () => {
  it("genera al menos 128 bits sin convertir QR o invitación en URL", () => {
    const invitation = generateInvitationSecret();
    const qrPayload = generateQrPayload();
    const privateCode = generatePrivateCode();

    expect(invitation).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(qrPayload).toMatch(/^healthdesign-link-v1\.[A-Za-z0-9_-]{22}$/);
    expect(qrPayload).not.toMatch(/^https?:/);
    expect(privateCode).toMatch(/^(?:[A-F0-9]{4}-){7}[A-F0-9]{4}$/);
    expect(normalizePrivateCode(privateCode)).toHaveLength(32);
    expect(new Set(Array.from({ length: 64 }, generatePrivateCode)).size).toBe(64);
  });

  it("deriva códigos con HMAC y compara digests con recorrido constante", async () => {
    const code = "ABCD-EF01-2345-6789-ABCD-EF01-2345-6789";
    const first = await hmacSha256Hex(code, "pepper-de-entorno-uno");
    const second = await hmacSha256Hex(code, "pepper-de-entorno-dos");

    expect(first).toMatch(/^[a-f0-9]{64}$/);
    expect(second).toMatch(/^[a-f0-9]{64}$/);
    expect(first).not.toBe(second);
    expect(constantTimeEqualHex(first, first)).toBe(true);
    expect(constantTimeEqualHex(first, second)).toBe(false);
    expect(constantTimeEqualHex(first, "00")).toBe(false);
    expect(await hashSha256Hex("payload")).toMatch(/^[a-f0-9]{64}$/);
  });

  it("persiste los resultados idempotentes cifrados y ligados a la operación", async () => {
    const key = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
    const response = { privateCode: "ABCD-EF01-2345-6789-ABCD-EF01-2345-6789" };
    const encrypted = await encryptAccessResponse(
      response,
      key,
      "subject:operation:hash",
    );

    expect(encrypted.ciphertext).not.toContain("ABCD");
    expect(encrypted.nonce).toMatch(/^[A-Za-z0-9_-]{16}$/);
    await expect(
      decryptAccessResponse(encrypted, key, "subject:other-operation:hash"),
    ).rejects.toThrow();
    await expect(
      decryptAccessResponse(encrypted, key, "subject:operation:hash"),
    ).resolves.toEqual(response);
  });

  it("excluye tokens Turnstile efímeros de la identidad idempotente", () => {
    expect(
      stripEphemeralAccessTokens({
        alias: "Pablo Salud",
        captchaToken: "token-de-un-solo-uso",
        nested: { challengeToken: "otro-token", schemaVersion: 1 },
      }),
    ).toEqual({
      alias: "Pablo Salud",
      nested: { schemaVersion: 1 },
    });
  });
});

describe("frontera HTTP de acceso", () => {
  it("solo acepta secretos por body y conserva rutas sin credenciales", () => {
    expect(
      parseAccessRoute(new URL("https://api.test/access/v1/invitations/redeem")),
    ).toEqual({ kind: "invitation-redeem" });
    expect(
      parseAccessRoute(
        new URL("https://api.test/access/v1/device-links/qr/consume?token=secret"),
      ),
    ).toBeNull();
    expect(
      parseAccessRoute(
        new URL(
          "https://api.test/access/v1/profiles/10000000-0000-4000-8000-000000000001/private-code/rotate",
        ),
      ),
    ).toEqual({
      kind: "private-code-rotate",
      profileId: "10000000-0000-4000-8000-000000000001",
    });
  });

  it("aplica las ventanas contractuales sin promediar contadores", () => {
    expect(
      classifyAccessAttempt({ candidateFailures: 2, globalIpAttempts: 4 }),
    ).toEqual({
      decision: "allow",
    });
    expect(
      classifyAccessAttempt({ candidateFailures: 3, globalIpAttempts: 4 }),
    ).toEqual({
      decision: "challenge",
    });
    expect(
      classifyAccessAttempt({ candidateFailures: 5, globalIpAttempts: 4 }),
    ).toEqual({
      decision: "rate-limited",
      retryAfterSeconds: 900,
    });
    expect(
      classifyAccessAttempt({ candidateFailures: 0, globalIpAttempts: 30 }),
    ).toEqual({
      decision: "rate-limited",
      retryAfterSeconds: 3600,
    });
  });
});
