import { describe, expect, it, vi } from "vitest";

import {
  createNutritionPlanClient,
  selectCurrentVersion,
} from "../apps/web/src/features/nutrition/nutrition-client";
import type { NutritionPlanApiError } from "../apps/web/src/features/nutrition/nutrition-client";

const profileId = "51000000-0000-4000-8000-000000000010";
const contextSnapshotId = "52000000-0000-4000-8000-000000000010";
const planId = "53000000-0000-4000-8000-000000000010";
const planVersionId = "54000000-0000-4000-8000-000000000010";

const mutationAck = {
  activatedAt: null,
  activeVersionId: null,
  aggregateVersion: 1,
  archivedAt: null,
  completeness: "complete",
  contextSnapshotId,
  createdAt: "2026-07-19T10:00:00.000Z",
  ordinal: 1,
  planId,
  planVersionId,
  status: "draft",
  validationStatus: "valid",
};

const history = {
  activeVersionId: null,
  aggregateVersion: 1,
  planId,
  profileId,
  versions: [
    {
      activatedAt: null,
      archivedAt: null,
      canonicalizationVersion: "canonical-json-v1",
      completeness: "complete",
      contextSnapshotId,
      createdAt: "2026-07-19T10:00:00.000Z",
      engineVersion: "engine-v3",
      hashAlgorithm: "sha256",
      id: planVersionId,
      inputHash: "a".repeat(64),
      ordinal: 1,
      outputHash: "b".repeat(64),
      planId,
      ruleSetRevisionId: "55000000-0000-4000-8000-000000000010",
      sourceManifestId: "56000000-0000-4000-8000-000000000010",
      status: "draft",
      validatedAt: "2026-07-19T10:00:00.000Z",
      validation: { status: "valid" },
      validationStatus: "valid",
    },
  ],
} as const;

function client(fetcher: typeof fetch) {
  return createNutritionPlanClient({
    baseUrl: "https://project.supabase.co/functions/v1/plans",
    fetcher,
    getAccessToken: () => Promise.resolve("user-jwt"),
    publishableKey: "publishable-key",
  });
}

describe("cliente del plan nutricional", () => {
  it("genera un plan sin filtrar contexto sensible en URL y con idempotencia", async () => {
    const fetcher = vi.fn<typeof fetch>(() =>
      Promise.resolve(
        new Response(JSON.stringify(mutationAck), {
          headers: { "content-type": "application/json" },
          status: 200,
        }),
      ),
    );

    await client(fetcher).generate(profileId, contextSnapshotId);

    const [url, init] = fetcher.mock.calls[0] ?? [];
    expect(url).toBe(
      `https://project.supabase.co/functions/v1/plans/v1/profiles/${profileId}/plans/generate`,
    );
    const headers = new Headers(init?.headers);
    expect(headers.get("authorization")).toBe("Bearer user-jwt");
    expect(headers.get("idempotency-key")).toMatch(/^[0-9a-f-]{36}$/);
    expect(headers.get("x-client-info")).toBe("health-design-web/nutrition-v1");
    if (typeof init?.body !== "string" || typeof url !== "string") {
      throw new Error("expected_string_request");
    }
    expect(JSON.parse(init.body)).toEqual({
      contextSnapshotId,
      schemaVersion: 1,
    });
    expect(url).not.toContain(contextSnapshotId);
  });

  it("activa con control optimista mediante If-Match", async () => {
    const activeAck = {
      ...mutationAck,
      activatedAt: "2026-07-19T10:01:00.000Z",
      activeVersionId: planVersionId,
      aggregateVersion: 2,
      status: "active",
    };
    const fetcher = vi.fn<typeof fetch>(() =>
      Promise.resolve(new Response(JSON.stringify(activeAck), { status: 200 })),
    );

    await client(fetcher).activateVersion(planId, planVersionId, 1);

    const [url, init] = fetcher.mock.calls[0] ?? [];
    expect(url).toBe(
      `https://project.supabase.co/functions/v1/plans/v1/plans/${planId}/versions/${planVersionId}/activate`,
    );
    expect(new Headers(init?.headers).get("if-match")).toBe('"1"');
    if (typeof init?.body !== "string") throw new Error("expected_string_body");
    expect(JSON.parse(init.body)).toEqual({
      expectedVersion: 1,
      schemaVersion: 1,
    });
  });

  it("consulta el historial existente usando el endpoint de lifecycle", async () => {
    const fetcher = vi.fn<typeof fetch>(() =>
      Promise.resolve(new Response(JSON.stringify(history), { status: 200 })),
    );

    await expect(client(fetcher).listVersions(planId)).resolves.toEqual(history);
    expect(fetcher).toHaveBeenCalledWith(
      `https://project.supabase.co/functions/v1/plans/v1/plans/${planId}/versions`,
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("consulta el plan actual por perfil", async () => {
    const fetcher = vi.fn<typeof fetch>(() =>
      Promise.resolve(new Response(JSON.stringify(history), { status: 200 })),
    );

    await expect(client(fetcher).getCurrent(profileId)).resolves.toEqual(history);
    expect(fetcher).toHaveBeenCalledWith(
      `https://project.supabase.co/functions/v1/plans/v1/profiles/${profileId}/plans/current`,
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("conserva un 404 para que la app permita generar el primer plan", async () => {
    const fetcher = vi.fn<typeof fetch>(() =>
      Promise.resolve(
        new Response(JSON.stringify({ error: { code: "NOT_FOUND" } }), {
          status: 404,
        }),
      ),
    );

    await expect(client(fetcher).getCurrent(profileId)).rejects.toMatchObject({
      code: "NOT_FOUND",
      status: 404,
    });
  });

  it("prioriza la versión activa aunque exista un borrador más reciente", () => {
    const newerDraft = {
      ...history.versions[0],
      createdAt: "2026-07-20T10:00:00.000Z",
      id: "54000000-0000-4000-8000-000000000011",
      ordinal: 2,
      status: "draft" as const,
    };
    const current = {
      ...history,
      activeVersionId: planVersionId,
      versions: [{ ...history.versions[0], status: "active" as const }, newerDraft],
    };

    expect(selectCurrentVersion(current)?.id).toBe(planVersionId);
  });

  it("conserva el código y request_id de un conflicto remoto", async () => {
    const fetcher = vi.fn<typeof fetch>(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            error: {
              code: "VERSION_CONFLICT",
              message_key: "plan.version_conflict",
              request_id: "55000000-0000-4000-8000-000000000010",
            },
          }),
          { status: 409 },
        ),
      ),
    );

    const promise = client(fetcher).activateVersion(planId, planVersionId, 1);
    await expect(promise).rejects.toMatchObject({
      code: "VERSION_CONFLICT",
      requestId: "55000000-0000-4000-8000-000000000010",
      status: 409,
    } satisfies Partial<NutritionPlanApiError>);
  });

  it("invoca fetch como función independiente para Window.fetch", async () => {
    const receivedThis: unknown[] = [];
    const fetcher = function (this: void) {
      receivedThis.push(this);
      return Promise.resolve(
        new Response(JSON.stringify(mutationAck), { status: 200 }),
      );
    } as typeof fetch;

    await client(fetcher).generate(profileId, contextSnapshotId);

    expect(receivedThis).toEqual([undefined]);
  });
});
