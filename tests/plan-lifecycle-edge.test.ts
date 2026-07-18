import { describe, expect, it } from "vitest";
import {
  PlanVersionDetailSchema,
  type PlanEngineResult,
} from "@health-design/contracts";

import {
  handlePlanLifecycle,
  type PlanLifecycleDependencies,
} from "../supabase/functions/plans/lifecycle";

const profileId = "10000000-0000-4000-8000-000000000101";
const userId = "20000000-0000-4000-8000-000000000101";
const sessionId = "30000000-0000-4000-8000-000000000101";
const draftId = "40000000-0000-4000-8000-000000000101";
const contextId = "50000000-0000-4000-8000-000000000101";
const previousContextId = "50000000-0000-4000-8000-000000000102";
const planId = "60000000-0000-4000-8000-000000000101";
const firstVersionId = "70000000-0000-4000-8000-000000000101";
const candidateVersionId = "70000000-0000-4000-8000-000000000102";
const candidateId = "80000000-0000-4000-8000-000000000101";
const changeEventId = "90000000-0000-4000-8000-000000000101";
const ruleSetRevisionId = "a0000000-0000-4000-8000-000000000101";
const sourceManifestId = "b0000000-0000-4000-8000-000000000101";
const timestamp = "2026-07-18T12:00:00.000Z";
const hash = (pair: string) => pair.repeat(32);

const answers = {
  activeModules: ["nutrition", "hydration"],
  activityLevel: "moderate",
  age: 35,
  country: "ES",
  hasConditions: false,
  hasMedications: false,
  heightCm: 178,
  mealsPerDay: 4,
  nutritionAllergiesStatus: "none",
  nutritionFoodAnxiety: "no",
  nutritionIntolerancesStatus: "none",
  physiologicalSex: "male",
  primaryObjective: "body_composition_maintain",
  proteinPreference: "food_only",
  trainingMode: "none",
  weightKg: 80,
} as const;

const context = {
  answers,
  canonicalizationVersion: "canonical-json-v1",
  completeness: "complete",
  createdAt: timestamp,
  effectiveAt: timestamp,
  id: contextId,
  inputHash: hash("11"),
  normalizationVersion: "normalization-v1",
  profileId,
  schemaVersion: 1,
  sourceDraftId: draftId,
  sourceDraftVersion: 2,
} as const;

const contextAck = {
  canonicalizationVersion: context.canonicalizationVersion,
  completeness: context.completeness,
  createdAt: context.createdAt,
  effectiveAt: context.effectiveAt,
  id: context.id,
  inputHash: context.inputHash,
  normalizationVersion: context.normalizationVersion,
  profileId: context.profileId,
  schemaVersion: context.schemaVersion,
  sourceDraftId: context.sourceDraftId,
  sourceDraftVersion: context.sourceDraftVersion,
} as const;

const previousContext = {
  ...context,
  answers: { ...answers, weightKg: 82 },
  id: previousContextId,
  inputHash: hash("12"),
  sourceDraftVersion: 1,
} as const;

const engineResult: PlanEngineResult = {
  canonicalizationVersion: "canonical-json-v1",
  engineVersion: "engine-v1",
  inputHash: hash("21"),
  moduleResults: [
    {
      confidence: "high",
      module: "nutrition",
      payload: { days: 7 },
      status: "valid",
      uncertainties: [],
    },
  ],
  outputHash: hash("22"),
  ruleSetRevisionId,
  safetyFindings: [],
  sourceManifestId,
  validation: { checks: ["structure"] },
  validationStatus: "valid",
};

const firstAck = {
  activatedAt: null,
  activeVersionId: null,
  aggregateVersion: 1,
  archivedAt: null,
  completeness: "complete",
  contextSnapshotId: contextId,
  createdAt: timestamp,
  ordinal: 1,
  planId,
  planVersionId: firstVersionId,
  status: "draft",
  validationStatus: "valid",
} as const;

const baseVersion = {
  activatedAt: timestamp,
  archivedAt: null,
  canonicalizationVersion: "canonical-json-v1",
  completeness: "complete",
  contextSnapshotId: previousContextId,
  createdAt: timestamp,
  engineVersion: "engine-v1",
  hashAlgorithm: "sha256",
  id: firstVersionId,
  inputHash: hash("31"),
  moduleResults: [],
  ordinal: 1,
  outputHash: hash("32"),
  planId,
  ruleSetRevisionId,
  safetyFindings: [],
  sourceManifestId,
  status: "active",
  validatedAt: timestamp,
  validation: {},
  validationStatus: "valid",
} as const;

const baseVersionSummary = {
  activatedAt: baseVersion.activatedAt,
  archivedAt: baseVersion.archivedAt,
  canonicalizationVersion: baseVersion.canonicalizationVersion,
  completeness: baseVersion.completeness,
  contextSnapshotId: baseVersion.contextSnapshotId,
  createdAt: baseVersion.createdAt,
  engineVersion: baseVersion.engineVersion,
  hashAlgorithm: baseVersion.hashAlgorithm,
  id: baseVersion.id,
  inputHash: baseVersion.inputHash,
  ordinal: baseVersion.ordinal,
  outputHash: baseVersion.outputHash,
  planId: baseVersion.planId,
  ruleSetRevisionId: baseVersion.ruleSetRevisionId,
  sourceManifestId: baseVersion.sourceManifestId,
  status: baseVersion.status,
  validatedAt: baseVersion.validatedAt,
  validation: baseVersion.validation,
  validationStatus: baseVersion.validationStatus,
} as const;

const candidateAck = {
  ...firstAck,
  activeVersionId: firstVersionId,
  aggregateVersion: 3,
  baseVersionId: firstVersionId,
  candidateId,
  candidateStatus: "pending",
  changeEventId,
  contextSnapshotId: contextId,
  diff: {
    affectedModules: ["nutrition", "hydration"],
    changedFields: ["weightKg"],
  },
  impact: "dependent_modules",
  ordinal: 2,
  planVersionId: candidateVersionId,
  resolvedAt: null,
  validation: { checks: ["structure"] },
} as const;

function setup(options?: {
  engine?: PlanLifecycleDependencies["runEngine"];
  rpcData?: Record<string, unknown>;
  rpcError?: { code?: string; message?: string };
  rpcErrors?: Record<string, { code?: string; message?: string }>;
}) {
  const calls: Array<{ args: Record<string, unknown>; name: string }> = [];
  const engineCalls: unknown[] = [];
  const runEngine: PlanLifecycleDependencies["runEngine"] =
    options?.engine ??
    ((input) => {
      engineCalls.push(input);
      return Promise.resolve(engineResult);
    });
  const dependencies: PlanLifecycleDependencies = {
    authenticate: () => Promise.resolve({ sessionId, userId }),
    environment: "local",
    now: () => new Date(timestamp),
    randomUUID: () => "c0000000-0000-4000-8000-000000000101",
    rpc: (name, args) => {
      calls.push({ args, name });
      const rpcError = options?.rpcErrors?.[name] ?? options?.rpcError;
      if (rpcError) {
        return Promise.resolve({ data: null, error: rpcError });
      }
      const dataByName: Record<string, unknown> = {
        internal_activate_plan_candidate: [
          {
            ...candidateAck,
            activeVersionId: candidateVersionId,
            aggregateVersion: 4,
            candidateStatus: "activated",
            resolvedAt: timestamp,
            status: "active",
          },
        ],
        internal_activate_plan_version: [
          {
            ...firstAck,
            activatedAt: timestamp,
            activeVersionId: firstVersionId,
            aggregateVersion: 2,
            status: "active",
          },
        ],
        internal_create_context_snapshot: [contextAck],
        internal_create_plan_candidate: [candidateAck],
        internal_create_plan_draft: [firstAck],
        internal_discard_plan_candidate: [
          {
            ...candidateAck,
            aggregateVersion: 4,
            archivedAt: timestamp,
            candidateStatus: "discarded",
            resolvedAt: timestamp,
            status: "archived",
          },
        ],
        internal_get_context_snapshot:
          args.p_context_snapshot_id === previousContextId
            ? [previousContext]
            : [context],
        internal_get_plan_version: [baseVersion],
        internal_get_questionnaire_draft: [
          {
            answers,
            completeness: "complete",
            confirmedBlockIds: ["core", "modules", "summary"],
            currentBlockId: "summary",
            hardErrors: [],
            id: draftId,
            profileId,
            schemaVersion: 1,
            status: "submitted",
            uncertainties: [],
            updatedAt: timestamp,
            version: 2,
          },
        ],
        internal_list_plan_versions: [
          {
            activeVersionId: firstVersionId,
            aggregateVersion: 2,
            planId,
            profileId,
            versions: [baseVersionSummary],
          },
        ],
      };
      const hasRpcData =
        options?.rpcData !== undefined &&
        Object.prototype.hasOwnProperty.call(options.rpcData, name);
      const data = hasRpcData ? options.rpcData?.[name] : dataByName[name];
      return Promise.resolve({ data, error: null });
    },
    runEngine,
  };
  return { calls, dependencies, engineCalls };
}

function request(path: string, method: "GET" | "POST", body?: unknown): Request {
  let expectedVersion: unknown;
  if (body && typeof body === "object") {
    const record = body as Record<string, unknown>;
    expectedVersion = record.expectedVersion ?? record.expectedDraftVersion;
  }
  return new Request(`https://api.test/plans${path}`, {
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    headers: {
      authorization: "Bearer valid-user-jwt",
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...(typeof expectedVersion !== "number"
        ? {}
        : { "if-match": `"${expectedVersion}"` }),
      "idempotency-key": "d0000000-0000-4000-8000-000000000101",
      origin: "http://127.0.0.1:5173",
    },
    method,
  });
}

describe("Edge del ciclo de vida del plan", () => {
  it("congela únicamente un borrador enviado y versionado", async () => {
    const current = setup();
    const response = await handlePlanLifecycle(
      request(`/v1/profiles/${profileId}/contexts/snapshot`, "POST", {
        expectedDraftVersion: 2,
        schemaVersion: 1,
      }),
      current.dependencies,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ id: contextId });
    expect(current.calls.map(({ name }) => name)).toEqual([
      "internal_get_questionnaire_draft",
      "internal_create_context_snapshot",
    ]);
    expect(current.calls[1]?.args).toMatchObject({
      p_expected_draft_version: 2,
      p_normalization_version: "normalization-v1",
    });
    expect(current.calls[1]?.args.p_input_hash).toMatch(/^\\x[0-9a-f]{64}$/);
    expect(current.calls[1]?.args).not.toHaveProperty("p_answers");
  });

  it("rechaza If-Match incoherente antes de leer datos clínicos", async () => {
    const current = setup();
    const original = request(`/v1/profiles/${profileId}/contexts/snapshot`, "POST", {
      expectedDraftVersion: 2,
      schemaVersion: 1,
    });
    const headers = new Headers(original.headers);
    headers.set("if-match", '"1"');
    const response = await handlePlanLifecycle(
      new Request(original, { headers }),
      current.dependencies,
    );

    expect(response.status).toBe(409);
    expect(current.calls).toEqual([]);
  });

  it("genera un borrador solo desde la salida validada del motor servidor", async () => {
    const current = setup();
    const response = await handlePlanLifecycle(
      request(`/v1/profiles/${profileId}/plans/generate`, "POST", {
        contextSnapshotId: contextId,
        schemaVersion: 1,
      }),
      current.dependencies,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: "draft" });
    expect(current.engineCalls).toHaveLength(1);
    expect(current.calls.map(({ name }) => name)).toEqual([
      "internal_get_context_snapshot",
      "internal_create_plan_draft",
    ]);
    expect(current.calls[1]?.args).toMatchObject({
      p_canonicalization_version: "canonical-json-v1",
      p_engine_version: "engine-v1",
      p_validation_status: "valid",
    });
  });

  it("no persiste una primera generación inválida", async () => {
    const current = setup({
      engine: () =>
        Promise.resolve({
          ...engineResult,
          validation: { errors: ["constraint_failed"] },
          validationStatus: "invalid",
        }),
    });
    const response = await handlePlanLifecycle(
      request(`/v1/profiles/${profileId}/plans/generate`, "POST", {
        contextSnapshotId: contextId,
        schemaVersion: 1,
      }),
      current.dependencies,
    );

    expect(response.status).toBe(422);
    expect(current.calls.map(({ name }) => name)).toEqual([
      "internal_get_context_snapshot",
    ]);
  });

  it("calcula el diff servidor y crea candidato sin cambiar el activo", async () => {
    const current = setup();
    const response = await handlePlanLifecycle(
      request(`/v1/plans/${planId}/candidates`, "POST", {
        baseVersionId: firstVersionId,
        contextSnapshotId: contextId,
        expectedVersion: 2,
        schemaVersion: 1,
      }),
      current.dependencies,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      activeVersionId: firstVersionId,
      candidateStatus: "pending",
      impact: "dependent_modules",
    });
    expect(current.calls.at(-1)).toMatchObject({
      args: {
        p_diff: {
          affectedModules: ["nutrition", "hydration"],
          changedFields: ["weightKg"],
        },
        p_impact: "dependent_modules",
      },
      name: "internal_create_plan_candidate",
    });
  });

  it("traduce el conflicto transaccional a 409 estable", async () => {
    const current = setup({ rpcError: { code: "PT409", message: "version_conflict" } });
    const response = await handlePlanLifecycle(
      request(`/v1/plans/${planId}/versions/${firstVersionId}/activate`, "POST", {
        expectedVersion: 1,
        schemaVersion: 1,
      }),
      current.dependencies,
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: { code: "VERSION_CONFLICT" },
    });
  });

  it("distingue un borrador no activable de un candidato inválido", async () => {
    const current = setup({
      rpcError: { code: "PT422", message: "plan_version_invalid" },
    });
    const response = await handlePlanLifecycle(
      request(`/v1/plans/${planId}/versions/${firstVersionId}/activate`, "POST", {
        expectedVersion: 1,
        schemaVersion: 1,
      }),
      current.dependencies,
    );

    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({
      error: { code: "PLAN_VALIDATION_FAILED" },
    });
  });

  it("traduce una segunda generación inicial a conflicto de versión", async () => {
    const current = setup({
      rpcErrors: {
        internal_create_plan_draft: {
          code: "P0001",
          message: "plan_already_exists",
        },
      },
    });
    const response = await handlePlanLifecycle(
      request(`/v1/profiles/${profileId}/plans/generate`, "POST", {
        contextSnapshotId: contextId,
        schemaVersion: 1,
      }),
      current.dependencies,
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: { code: "VERSION_CONFLICT" },
    });
  });

  it("traduce una activación inicial repetida a conflicto y no a 503", async () => {
    const current = setup({
      rpcError: { code: "P0001", message: "initial_plan_already_active" },
    });
    const response = await handlePlanLifecycle(
      request(`/v1/plans/${planId}/versions/${firstVersionId}/activate`, "POST", {
        expectedVersion: 2,
        schemaVersion: 1,
      }),
      current.dependencies,
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: { code: "VERSION_CONFLICT" },
    });
  });

  it("trata una respuesta interna mal formada como dependencia fallida", async () => {
    const current = setup({
      rpcData: { internal_list_plan_versions: [{ arbitrary: "shape" }] },
    });
    const response = await handlePlanLifecycle(
      request(`/v1/plans/${planId}/versions`, "GET"),
      current.dependencies,
    );

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      error: { code: "DEPENDENCY_UNAVAILABLE", retryable: true },
    });
  });

  it("expone historial y detalle solo mediante lecturas autenticadas", async () => {
    const history = setup();
    const historyResponse = await handlePlanLifecycle(
      request(`/v1/plans/${planId}/versions`, "GET"),
      history.dependencies,
    );
    const detail = setup();
    const detailResponse = await handlePlanLifecycle(
      request(`/v1/plans/${planId}/versions/${firstVersionId}`, "GET"),
      detail.dependencies,
    );

    expect(historyResponse.status).toBe(200);
    expect(detailResponse.status).toBe(200);
    expect(history.calls[0]?.name).toBe("internal_list_plan_versions");
    expect(detail.calls[0]?.name).toBe("internal_get_plan_version");
    expect(
      PlanVersionDetailSchema.parse(await detailResponse.json()).moduleResults,
    ).toEqual([]);
  });

  it("mantiene una salida honesta cuando T8 todavía no aporta motor", async () => {
    const current = setup({
      engine: () => Promise.reject(new Error("engine_unavailable")),
    });
    const response = await handlePlanLifecycle(
      request(`/v1/profiles/${profileId}/plans/generate`, "POST", {
        contextSnapshotId: contextId,
        schemaVersion: 1,
      }),
      current.dependencies,
    );

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      error: { code: "ENGINE_UNAVAILABLE" },
    });
    expect(current.calls.map(({ name }) => name)).toEqual([
      "internal_get_context_snapshot",
    ]);
  });
});
