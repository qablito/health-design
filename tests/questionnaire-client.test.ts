import { describe, expect, it, vi } from "vitest";

import { createQuestionnaireClient } from "../apps/web/src/features/questionnaire/questionnaire-client";

const profileId = "10000000-0000-4000-8000-000000000001";

const ack = {
  completeness: "provisional",
  confirmedBlockIds: ["core"],
  currentBlockId: "goals",
  hardErrors: [],
  profileId,
  schemaVersion: 1,
  status: "editing",
  uncertainties: [],
  updatedAt: "2026-07-18T10:00:00.000Z",
  version: 2,
};

describe("cliente del cuestionario", () => {
  it("guarda por PUT con versión e idempotencia solo en headers", async () => {
    const fetcher = vi.fn<typeof fetch>(() =>
      Promise.resolve(
        new Response(JSON.stringify(ack), {
          headers: { "content-type": "application/json" },
          status: 200,
        }),
      ),
    );
    const client = createQuestionnaireClient({
      baseUrl: "https://project.supabase.co/functions/v1/plans",
      fetcher,
      getAccessToken: () => Promise.resolve("user-jwt"),
      publishableKey: "publishable-key",
    });

    await client.saveDraft(
      profileId,
      {
        answers: { activeModules: ["nutrition"] },
        confirmedBlockIds: ["core"],
        currentBlockId: "goals",
        expectedVersion: 1,
        schemaVersion: 1,
      },
      { idempotencyKey: "fixed-retry-key-0001" },
    );

    const [url, init] = fetcher.mock.calls[0] ?? [];
    expect(url).toBe(
      `https://project.supabase.co/functions/v1/plans/v1/profiles/${profileId}/draft`,
    );
    expect(init?.method).toBe("PUT");
    expect(new Headers(init?.headers).get("idempotency-key")).toBe(
      "fixed-retry-key-0001",
    );
    expect(new Headers(init?.headers).get("if-match")).toBe('"1"');
    if (typeof url !== "string") throw new Error("expected_string_url");
    expect(url).not.toContain("activeModules");
  });

  it("no transforma un fallo de red en un guardado aparente", async () => {
    const client = createQuestionnaireClient({
      baseUrl: "https://project.supabase.co/functions/v1/plans",
      fetcher: () => Promise.reject(new TypeError("offline")),
      getAccessToken: () => Promise.resolve("user-jwt"),
      publishableKey: "publishable-key",
    });

    await expect(
      client.saveDraft(
        profileId,
        {
          answers: {},
          confirmedBlockIds: [],
          currentBlockId: "core",
          expectedVersion: 0,
          schemaVersion: 1,
        },
        { idempotencyKey: "fixed-retry-key-0002" },
      ),
    ).rejects.toThrow("offline");
  });

  it("invoca fetch como función independiente para ser compatible con Window.fetch", async () => {
    const receivedThis: unknown[] = [];
    const fetcher = function (this: void) {
      receivedThis.push(this);
      return Promise.resolve(
        new Response(JSON.stringify(ack), {
          headers: { "content-type": "application/json" },
          status: 200,
        }),
      );
    } as typeof fetch;
    const client = createQuestionnaireClient({
      baseUrl: "https://project.supabase.co/functions/v1/plans",
      fetcher,
      getAccessToken: () => Promise.resolve("user-jwt"),
      publishableKey: "publishable-key",
    });

    await client.saveDraft(profileId, {
      answers: {},
      confirmedBlockIds: [],
      currentBlockId: "core",
      expectedVersion: 1,
      schemaVersion: 1,
    });

    expect(receivedThis).toEqual([undefined]);
  });
});
