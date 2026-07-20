import { describe, expect, it, vi } from "vitest";

import {
  createFollowUpClient,
  type FollowUpApiError,
} from "../apps/web/src/features/follow-up/follow-up-client";

const profileId = "51000000-0000-4000-8000-000000001301";
const planId = "53000000-0000-4000-8000-000000001301";
const versionId = "54000000-0000-4000-8000-000000001301";
const candidateId = "55000000-0000-4000-8000-000000001301";
const contextId = "56000000-0000-4000-8000-000000001301";
const changeEventId = "57000000-0000-4000-8000-000000001301";
const timestamp = "2026-07-20T10:00:00.000Z";

const candidate = {
  activatedAt: null,
  activeVersionId: versionId,
  aggregateVersion: 3,
  archivedAt: null,
  baseVersionId: versionId,
  candidateId,
  candidateStatus: "pending",
  changeEventId,
  completeness: "complete",
  contextSnapshotId: contextId,
  createdAt: timestamp,
  diff: {
    affectedModules: ["supplements"],
    changedFields: ["labValues"],
  },
  impact: "module_only",
  ordinal: 2,
  planId,
  planVersionId: "58000000-0000-4000-8000-000000001301",
  resolvedAt: null,
  status: "draft",
  validation: { completeness: "complete" },
  validationStatus: "valid",
} as const;

const history = {
  entries: [],
  pendingCandidates: [candidate],
  profileId,
};

const labs = {
  items: [],
  observations: [],
  pendingCandidates: [candidate],
  profileId,
};

function client(fetcher: typeof fetch) {
  return createFollowUpClient({
    baseUrl: "https://project.supabase.co/functions/v1/plans",
    fetcher,
    getAccessToken: () => Promise.resolve("user-jwt"),
    publishableKey: "publishable-key",
  });
}

describe("cliente de seguimiento", () => {
  it("registra una revisión sin filtrar datos de salud en la URL", async () => {
    const values = {
      common: { adherence: 4, importantSymptoms: [], materialChanges: [] },
    };
    const entry = {
      basePlanVersionId: versionId,
      completeness: "complete",
      createdAt: timestamp,
      id: "59000000-0000-4000-8000-000000001301",
      observedAt: timestamp,
      planId,
      profileId,
      requestRecalculation: false,
      scope: "weekly",
      values,
    } as const;
    const response = {
      candidate: null,
      contextUpdateRequired: false,
      entry,
      impact: {
        affectedModules: [],
        candidateRequired: false,
        conservativeModules: [],
        impact: "unaffected",
        minorTrainingAdjustmentPercent: null,
        reasons: [],
      },
    };
    const fetcher = vi.fn<typeof fetch>(() =>
      Promise.resolve(new Response(JSON.stringify(response), { status: 200 })),
    );

    await client(fetcher).createFollowUp(profileId, {
      basePlanVersionId: versionId,
      observedAt: timestamp,
      schemaVersion: 1,
      scope: "weekly",
      values,
    });

    const [url, init] = fetcher.mock.calls[0] ?? [];
    expect(url).toBe(
      `https://project.supabase.co/functions/v1/plans/v1/profiles/${profileId}/follow-ups`,
    );
    const headers = new Headers(init?.headers);
    expect(headers.get("authorization")).toBe("Bearer user-jwt");
    expect(headers.get("idempotency-key")).toMatch(/^[0-9a-f-]{36}$/);
    expect(headers.get("x-client-info")).toBe("health-design-web/follow-up-v1");
    expect(url).not.toContain("adherence");
  });

  it("consulta las revisiones y analíticas por perfil", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify(history), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(labs), { status: 200 }));

    await expect(client(fetcher).getFollowUps(profileId)).resolves.toEqual(history);
    await expect(client(fetcher).getLabs(profileId)).resolves.toEqual(labs);
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
      `https://project.supabase.co/functions/v1/plans/v1/profiles/${profileId}/follow-ups`,
      `https://project.supabase.co/functions/v1/plans/v1/profiles/${profileId}/labs`,
    ]);
  });

  it("registra de una a cuatro analíticas con fecha y origen", async () => {
    const response = { candidate: null, history: labs };
    const fetcher = vi.fn<typeof fetch>(() =>
      Promise.resolve(new Response(JSON.stringify(response), { status: 200 })),
    );

    await client(fetcher).createLabs(
      profileId,
      versionId,
      [
        {
          analyte: "b12",
          measurement: { date: "2026-07-20", kind: "exact" },
          name: "Vitamina B12",
          source: "laboratory",
          unit: "pg/mL",
          value: "250",
        },
      ],
      true,
    );

    const [url, init] = fetcher.mock.calls[0] ?? [];
    expect(url).toBe(
      `https://project.supabase.co/functions/v1/plans/v1/profiles/${profileId}/labs`,
    );
    if (typeof init?.body !== "string") throw new Error("expected_string_body");
    expect(JSON.parse(init.body)).toMatchObject({
      basePlanVersionId: versionId,
      requestRecalculation: true,
      schemaVersion: 1,
    });
  });

  it("activa y descarta candidatos con control optimista", async () => {
    const activated = {
      ...candidate,
      activatedAt: timestamp,
      activeVersionId: candidate.planVersionId,
      aggregateVersion: 4,
      candidateStatus: "activated",
      resolvedAt: timestamp,
      status: "active",
    } as const;
    const discarded = {
      ...candidate,
      aggregateVersion: 4,
      candidateStatus: "discarded",
      resolvedAt: timestamp,
    } as const;
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify(activated), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(discarded), { status: 200 }));

    await client(fetcher).activateCandidate(candidateId, 3);
    await client(fetcher).discardCandidate(candidateId, 3);

    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
      `https://project.supabase.co/functions/v1/plans/v1/candidates/${candidateId}/activate`,
      `https://project.supabase.co/functions/v1/plans/v1/candidates/${candidateId}/discard`,
    ]);
    for (const [, init] of fetcher.mock.calls) {
      expect(new Headers(init?.headers).get("if-match")).toBe('"3"');
      if (typeof init?.body !== "string") throw new Error("expected_string_body");
      expect(JSON.parse(init.body)).toEqual({ expectedVersion: 3, schemaVersion: 1 });
    }
  });

  it("conserva el código y request_id de un conflicto remoto", async () => {
    const fetcher = vi.fn<typeof fetch>(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            error: {
              code: "VERSION_CONFLICT",
              message_key: "plan.version_conflict",
              request_id: "60000000-0000-4000-8000-000000001301",
            },
          }),
          { status: 409 },
        ),
      ),
    );

    const promise = client(fetcher).activateCandidate(candidateId, 3);
    await expect(promise).rejects.toMatchObject({
      code: "VERSION_CONFLICT",
      requestId: "60000000-0000-4000-8000-000000001301",
      status: 409,
    } satisfies Partial<FollowUpApiError>);
  });
});
