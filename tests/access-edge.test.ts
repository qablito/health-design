import { describe, expect, it } from "vitest";

import {
  handleAccess,
  type AccessDependencies,
} from "../supabase/functions/access/index";

const userId = "00000000-0000-4000-8000-000000000001";
const sessionId = "21000000-0000-4000-8000-000000000001";
const attemptId = "50000000-0000-4000-8000-000000000001";

function dependencies(candidate: unknown): {
  dependencies: AccessDependencies;
  calls: Array<{ args: Record<string, unknown>; name: string }>;
} {
  const calls: Array<{ args: Record<string, unknown>; name: string }> = [];
  return {
    calls,
    dependencies: {
      authenticate: () =>
        Promise.resolve({ accessToken: "validated-jwt", sessionId, userId }),
      config: {
        deletionMarkerKey: "deletion-marker-key-with-at-least-256-bits",
        deletionMarkerKeyVersion: 1,
        idempotencyEncryptionKey: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
        privateCodePepper: "private-code-pepper",
        rateLimitPepper: "rate-limit-pepper",
      },
      environment: "local",
      now: () => new Date("2026-07-17T12:00:00.000Z"),
      randomUUID: () => crypto.randomUUID(),
      rpc: (name, args) => {
        calls.push({ args, name });
        if (name === "internal_start_access_attempt") {
          return Promise.resolve({
            data: [
              {
                decision: "allow",
                event_id: attemptId,
                retry_after_seconds: null,
              },
            ],
            error: null,
          });
        }
        if (name === "internal_private_code_candidate") {
          return Promise.resolve({ data: [candidate], error: null });
        }
        return Promise.resolve({ data: null, error: null });
      },
      verifyChallenge: () => Promise.resolve(true),
    },
  };
}

function codeRequest(privateCode: string): Request {
  return new Request("https://api.test/access/v1/device-links/code/consume", {
    body: JSON.stringify({
      alias: "Jose Pena",
      deviceLabel: "Movil",
      privateCode,
      schemaVersion: 1,
    }),
    headers: {
      authorization: "Bearer test-jwt",
      "content-type": "application/json",
      "idempotency-key": "10000000-0000-4000-8000-000000000001",
      origin: "http://127.0.0.1:5173",
    },
    method: "POST",
  });
}

async function publicError(response: Response): Promise<Record<string, unknown>> {
  const body = (await response.json()) as {
    error: Record<string, unknown>;
  };
  const stable = { ...body.error };
  delete stable.request_id;
  return stable;
}

describe("Edge de acceso", () => {
  it("crea una solicitud irreversible y nunca devuelve marcadores internos", async () => {
    const setup = dependencies(null);
    setup.dependencies.rpc = (name, args) => {
      setup.calls.push({ args, name });
      if (name === "internal_request_profile_deletion") {
        return Promise.resolve({
          data: {
            completedAt: null,
            errorCode: null,
            jobId: "71000000-0000-4000-8000-000000000001",
            profileId: "51000000-0000-4000-8000-000000000001",
            requestedAt: "2026-07-17T12:00:00.000Z",
            status: "queued",
            version: 1,
            steps: [],
          },
          error: null,
        });
      }
      return Promise.resolve({ data: null, error: null });
    };
    const response = await handleAccess(
      new Request(
        "https://api.test/access/v1/profiles/51000000-0000-4000-8000-000000000001/deletion-requests",
        {
          body: JSON.stringify({
            alias: "Jose Pena",
            confirmationPhrase: "BORRAR MI PERFIL PERMANENTEMENTE",
            irreversible: true,
            schemaVersion: 1,
          }),
          headers: {
            authorization: "Bearer test-jwt",
            "content-type": "application/json",
            "idempotency-key": "10000000-0000-4000-8000-000000000001",
            origin: "http://127.0.0.1:5173",
          },
          method: "POST",
        },
      ),
      setup.dependencies,
    );
    expect(response.status).toBe(202);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.handle).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(body).not.toHaveProperty("profileMarker");
    expect(body).not.toHaveProperty("jobId");
    expect(JSON.stringify(body)).not.toContain("\\x");
  });

  it("consulta solo el estado público allowlisted mediante el handle", async () => {
    const setup = dependencies(null);
    setup.dependencies.rpc = (name, args) => {
      setup.calls.push({ args, name });
      return Promise.resolve({
        data: {
          completedAt: null,
          errorCode: "profile_purge_failed",
          requestedAt: "2026-07-17T12:00:00.000Z",
          status: "failed",
        },
        error: null,
      });
    };
    const handle = "A".repeat(43);
    const response = await handleAccess(
      new Request(`https://api.test/access/v1/deletion-requests/${handle}`, {
        headers: {
          authorization: "Bearer test-jwt",
          origin: "http://127.0.0.1:5173",
        },
      }),
      setup.dependencies,
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      completedAt: null,
      errorCode: "purge_incomplete",
      handle,
      requestedAt: "2026-07-17T12:00:00.000Z",
      schemaVersion: 1,
      status: "failed",
    });
  });

  it("hace indistinguibles alias inexistente y código incorrecto", async () => {
    const missing = dependencies({
      profile_alias: null,
      profile_id: null,
      secret_digest_hex: "0".repeat(64),
    });
    const wrong = dependencies({
      profile_alias: "Jose Pena",
      profile_id: "10000000-0000-4000-8000-000000000001",
      secret_digest_hex: "1".repeat(64),
    });

    const missingResponse = await handleAccess(
      codeRequest("ABCD-EF01-2345-6789-ABCD-EF01-2345-6789"),
      missing.dependencies,
    );
    const wrongResponse = await handleAccess(
      codeRequest("ABCD-EF01-2345-6789-ABCD-EF01-2345-6789"),
      wrong.dependencies,
    );

    expect(missingResponse.status).toBe(403);
    expect(wrongResponse.status).toBe(403);
    expect(await publicError(missingResponse)).toEqual(
      await publicError(wrongResponse),
    );
    expect(
      missing.calls.some(({ name }) => name === "internal_finish_access_attempt"),
    ).toBe(true);
    expect(JSON.stringify(missing.calls)).not.toContain("ABCD-EF01");
  });

  it("rechaza cualquier intento de transportar secretos en query", async () => {
    const setup = dependencies(null);
    const response = await handleAccess(
      new Request(
        "https://api.test/access/v1/invitations/redeem?invitationSecret=prohibido",
        {
          headers: { origin: "http://127.0.0.1:5173" },
          method: "POST",
        },
      ),
      setup.dependencies,
    );

    expect(response.status).toBe(400);
    expect(setup.calls).toHaveLength(0);
    expect(response.headers.get("cache-control")).toBe("no-store, private");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  });

  it("exige Turnstile en el canje de invitación", async () => {
    const setup = dependencies(null);
    setup.dependencies.verifyChallenge = () => Promise.resolve(false);
    const response = await handleAccess(
      new Request("https://api.test/access/v1/invitations/redeem", {
        body: JSON.stringify({
          adultAttested: true,
          alias: "Jose Pena",
          captchaToken: "invalid-turnstile",
          deviceLabel: "Portatil",
          invitationSecret: "invite-secret-with-at-least-128-bits",
          schemaVersion: 1,
          timezone: "Europe/Madrid",
        }),
        headers: {
          authorization: "Bearer test-jwt",
          "content-type": "application/json",
          "idempotency-key": "10000000-0000-4000-8000-000000000001",
          origin: "http://127.0.0.1:5173",
        },
        method: "POST",
      }),
      setup.dependencies,
    );

    expect(response.status).toBe(403);
    expect(await publicError(response)).toMatchObject({
      code: "CHALLENGE_REQUIRED",
      message_key: "access.challenge_required",
    });
    expect(setup.calls.map(({ name }) => name)).toEqual([
      "internal_record_access_audit",
    ]);
  });
});
