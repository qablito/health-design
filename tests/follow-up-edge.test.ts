import { describe, expect, it } from "vitest";
import {
  LabMutationAckSchema,
  QuestionnaireAnswersSchema,
  type ContextSnapshotInternal,
  type PlanEngineResult,
} from "@health-design/contracts";

import {
  handlePlanLifecycle,
  type PlanLifecycleDependencies,
} from "../supabase/functions/plans/lifecycle";

const profileId = "10000000-0000-4000-8000-000000001301";
const userId = "20000000-0000-4000-8000-000000001301";
const sessionId = "30000000-0000-4000-8000-000000001301";
const draftId = "40000000-0000-4000-8000-000000001301";
const contextId = "50000000-0000-4000-8000-000000001301";
const derivedContextId = "50000000-0000-4000-8000-000000001302";
const planId = "60000000-0000-4000-8000-000000001301";
const versionId = "70000000-0000-4000-8000-000000001301";
const candidateVersionId = "70000000-0000-4000-8000-000000001302";
const candidateId = "80000000-0000-4000-8000-000000001301";
const changeEventId = "90000000-0000-4000-8000-000000001301";
const followUpId = "a0000000-0000-4000-8000-000000001301";
const batchId = "b0000000-0000-4000-8000-000000001301";
const previousLabId = "c0000000-0000-4000-8000-000000001301";
const labId = "c0000000-0000-4000-8000-000000001302";
const timestamp = "2026-07-20T08:00:00.000Z";
const hash = (pair: string) => pair.repeat(32);

const answers = {
  activeModules: [
    "nutrition",
    "training",
    "hydration",
    "sleep",
    "mobility",
    "supplements",
  ],
  activityLevel: "moderate",
  age: 35,
  country: "ES",
  currentSupplements: [{ name: "Vitamina B12" }],
  generatedTrainingDaysPerWeek: 3,
  generatedTrainingEquipment: ["full_gym"],
  generatedTrainingExperience: "intermediate",
  generatedTrainingSessionMinutes: 60,
  generatedTrainingStyles: ["strength_hypertrophy"],
  hasConditions: false,
  hasCurrentSupplements: true,
  hasLabValues: false,
  hasMedications: false,
  heightCm: 178,
  mealsPerDay: 4,
  nutritionAllergiesStatus: "none",
  nutritionFoodAnxiety: "no",
  nutritionIntolerancesStatus: "none",
  physiologicalSex: "male",
  primaryObjective: "body_composition_maintain",
  proteinPreference: "food_only",
  trainingMode: "generated",
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
  schemaVersion: 2,
  sourceDraftId: draftId,
  sourceDraftVersion: 2,
} as const;

const baseModuleResult = {
  confidence: "high",
  createdAt: timestamp,
  id: "d0000000-0000-4000-8000-000000001301",
  module: "supplements",
  payload: { recommendations: [] },
  status: "valid",
  uncertainties: [],
} as const;

const version = {
  activatedAt: timestamp,
  archivedAt: null,
  canonicalizationVersion: "canonical-json-v1",
  completeness: "complete",
  contextSnapshotId: contextId,
  createdAt: timestamp,
  engineVersion: "engine-v1",
  hashAlgorithm: "sha256",
  id: versionId,
  inputHash: hash("21"),
  moduleResults: [baseModuleResult],
  ordinal: 1,
  outputHash: hash("22"),
  planId,
  ruleSetRevisionId: "e0000000-0000-4000-8000-000000001301",
  safetyFindings: [],
  sourceManifestId: "f0000000-0000-4000-8000-000000001301",
  status: "active",
  validatedAt: timestamp,
  validation: { completeness: "complete" },
  validationStatus: "valid",
} as const;

const versionSummary = {
  activatedAt: version.activatedAt,
  archivedAt: version.archivedAt,
  canonicalizationVersion: version.canonicalizationVersion,
  completeness: version.completeness,
  contextSnapshotId: version.contextSnapshotId,
  createdAt: version.createdAt,
  engineVersion: version.engineVersion,
  hashAlgorithm: version.hashAlgorithm,
  id: version.id,
  inputHash: version.inputHash,
  ordinal: version.ordinal,
  outputHash: version.outputHash,
  planId: version.planId,
  ruleSetRevisionId: version.ruleSetRevisionId,
  sourceManifestId: version.sourceManifestId,
  status: version.status,
  validatedAt: version.validatedAt,
  validation: version.validation,
  validationStatus: version.validationStatus,
} as const;

const history = {
  activeVersionId: versionId,
  aggregateVersion: 2,
  planId,
  profileId,
  versions: [versionSummary],
} as const;

const followUpEntry = {
  basePlanVersionId: versionId,
  completeness: "complete",
  createdAt: timestamp,
  id: followUpId,
  observedAt: timestamp,
  planId,
  profileId,
  requestRecalculation: false,
  scope: "weekly",
  values: {
    common: { adherence: 4, importantSymptoms: [], materialChanges: [] },
  },
} as const;

const previousLab = {
  analyte: "b12",
  confidence: "high",
  createdAt: "2026-06-01T08:00:00.000Z",
  id: previousLabId,
  measuredFrom: "2026-06-01",
  measuredTo: "2026-06-01",
  measurement: { date: "2026-06-01", kind: "exact" },
  name: "Vitamina B12",
  profileId,
  referenceRange: { maximum: "900", minimum: "200", unit: "pg/mL" },
  source: "laboratory",
  unit: "pg/mL",
  value: "220",
} as const;

const newLab = {
  ...previousLab,
  createdAt: timestamp,
  id: labId,
  measuredFrom: "2026-07-20",
  measuredTo: "2026-07-20",
  measurement: { date: "2026-07-20", kind: "exact" },
  value: "180",
} as const;

const engineResult: PlanEngineResult = {
  canonicalizationVersion: "canonical-json-v1",
  completeness: "complete",
  engineVersion: "engine-v1",
  inputHash: hash("31"),
  moduleResults: [
    {
      confidence: "high",
      module: "supplements",
      payload: { recommendations: [] },
      status: "valid",
      uncertainties: [],
    },
    {
      confidence: "high",
      module: "hydration",
      payload: { target: 2500 },
      status: "valid",
      uncertainties: [],
    },
  ],
  outputHash: hash("32"),
  ruleSetRevisionId: version.ruleSetRevisionId,
  safetyFindings: [],
  sourceManifestId: version.sourceManifestId,
  validation: { completeness: "complete" },
  validationStatus: "valid",
};

function setup(options?: {
  answers?: ContextSnapshotInternal["answers"];
  labObservations?: readonly [typeof previousLab, typeof newLab] | readonly [];
}) {
  const calls: Array<{ args: Record<string, unknown>; name: string }> = [];
  const engineCalls: unknown[] = [];
  const currentContext = { ...context, answers: options?.answers ?? answers };
  const dependencies: PlanLifecycleDependencies = {
    authenticate: () => Promise.resolve({ sessionId, userId }),
    environment: "local",
    now: () => new Date(timestamp),
    randomUUID: () => "00000000-0000-4000-8000-000000001399",
    rpc: (name, args) => {
      calls.push({ args, name });
      if (name === "internal_get_profile_current_plan") {
        return Promise.resolve({ data: [history], error: null });
      }
      if (name === "internal_get_plan_version") {
        return Promise.resolve({ data: [version], error: null });
      }
      if (name === "internal_get_context_snapshot") {
        return Promise.resolve({ data: [currentContext], error: null });
      }
      if (name === "internal_list_follow_ups") {
        return Promise.resolve({
          data: [{ entries: [followUpEntry], profileId }],
          error: null,
        });
      }
      if (name === "internal_list_tracking_candidates") {
        return Promise.resolve({
          data: [{ candidates: [], profileId }],
          error: null,
        });
      }
      if (name === "internal_record_follow_up") {
        return Promise.resolve({
          data: [
            {
              ...followUpEntry,
              completeness: args.p_completeness,
              requestRecalculation: args.p_request_recalculation,
              scope: args.p_scope,
              values: args.p_values,
            },
          ],
          error: null,
        });
      }
      if (name === "internal_record_lab_batch") {
        return Promise.resolve({
          data: [
            {
              batchId,
              observations: [newLab],
              requestRecalculation: args.p_request_recalculation,
            },
          ],
          error: null,
        });
      }
      if (name === "internal_list_lab_observations") {
        return Promise.resolve({
          data: [
            {
              observations: options?.labObservations ?? [previousLab, newLab],
              profileId,
            },
          ],
          error: null,
        });
      }
      if (name === "internal_create_derived_context_snapshot") {
        return Promise.resolve({
          data: [
            {
              canonicalizationVersion: currentContext.canonicalizationVersion,
              completeness: args.p_completeness,
              createdAt: currentContext.createdAt,
              effectiveAt: currentContext.effectiveAt,
              id: derivedContextId,
              inputHash: hash("41"),
              normalizationVersion: currentContext.normalizationVersion,
              profileId: currentContext.profileId,
              schemaVersion: currentContext.schemaVersion,
              sourceDraftId: currentContext.sourceDraftId,
              sourceDraftVersion: currentContext.sourceDraftVersion,
            },
          ],
          error: null,
        });
      }
      if (name === "internal_create_plan_candidate") {
        return Promise.resolve({
          data: [
            {
              activatedAt: null,
              activeVersionId: versionId,
              aggregateVersion: 3,
              archivedAt: null,
              baseVersionId: versionId,
              candidateId,
              candidateStatus: "pending",
              changeEventId,
              completeness: args.p_engine_completeness,
              contextSnapshotId: derivedContextId,
              createdAt: timestamp,
              diff: args.p_diff,
              impact: args.p_impact,
              ordinal: 2,
              planId,
              planVersionId: candidateVersionId,
              resolvedAt: null,
              status: "draft",
              validation: args.p_validation,
              validationStatus: "valid",
            },
          ],
          error: null,
        });
      }
      return Promise.resolve({ data: null, error: { message: `unexpected_${name}` } });
    },
    runEngine: (input) => {
      engineCalls.push(input);
      return Promise.resolve(engineResult);
    },
  };
  return { calls, dependencies, engineCalls };
}

function request(path: string, method: "GET" | "POST", body?: unknown): Request {
  return new Request(`https://api.test/plans${path}`, {
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    headers: {
      authorization: "Bearer valid-user-jwt",
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      "idempotency-key": "follow-up-request-0000000001",
      origin: "http://127.0.0.1:5173",
    },
    method,
  });
}

function weekly(values: Record<string, unknown>, requestRecalculation = false) {
  return {
    basePlanVersionId: versionId,
    observedAt: timestamp,
    requestRecalculation,
    schemaVersion: 1,
    scope: "weekly",
    values,
  };
}

describe("Edge de seguimiento T13", () => {
  it("lista el historial semanal sin exponer tablas al navegador", async () => {
    const current = setup();
    const response = await handlePlanLifecycle(
      request(`/v1/profiles/${profileId}/follow-ups`, "GET"),
      current.dependencies,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      entries: [followUpEntry],
      pendingCandidates: [],
      profileId,
    });
    expect(current.calls.map(({ name }) => name)).toEqual([
      "internal_list_follow_ups",
      "internal_list_tracking_candidates",
    ]);
  });

  it("registra una semana estable sin fabricar un candidato idéntico", async () => {
    const current = setup();
    const response = await handlePlanLifecycle(
      request(
        `/v1/profiles/${profileId}/follow-ups`,
        "POST",
        weekly({
          common: { adherence: 4, importantSymptoms: [], materialChanges: [] },
          nutrition: { hunger: 3, satiety: 4 },
        }),
      ),
      current.dependencies,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      candidate: null,
      contextUpdateRequired: false,
      impact: { candidateRequired: false, impact: "unaffected" },
    });
    expect(current.engineCalls).toHaveLength(0);
    expect(current.calls.at(-1)?.name).toBe("internal_record_follow_up");
  });

  it("rechaza como entrada inválida los datos de un módulo inactivo", async () => {
    const current = setup({
      answers: QuestionnaireAnswersSchema.parse({
        ...answers,
        activeModules: ["nutrition", "hydration", "sleep", "supplements"],
        trainingMode: "none",
      }),
    });
    const response = await handlePlanLifecycle(
      request(
        `/v1/profiles/${profileId}/follow-ups`,
        "POST",
        weekly({
          common: { adherence: 4, importantSymptoms: [], materialChanges: [] },
          training: { completedSessions: 2, plannedSessions: 3 },
        }),
      ),
      current.dependencies,
    );

    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({
      error: { code: "INVALID_INPUT" },
    });
    expect(current.calls.map(({ name }) => name)).not.toContain(
      "internal_record_follow_up",
    );
  });

  it("recomienda un cambio de volumen de hasta 10 % sin mutar ni regenerar", async () => {
    const current = setup();
    const response = await handlePlanLifecycle(
      request(
        `/v1/profiles/${profileId}/follow-ups`,
        "POST",
        weekly({
          common: { adherence: 4, importantSymptoms: [], materialChanges: [] },
          training: { pain: "none", volumeChangePercent: -10 },
        }),
      ),
      current.dependencies,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      candidate: null,
      impact: { minorTrainingAdjustmentPercent: -10 },
    });
    expect(current.calls.some(({ name }) => name.includes("candidate"))).toBe(false);
  });

  it("crea un candidato conservador por síntoma importante y conserva el activo", async () => {
    const current = setup();
    const response = await handlePlanLifecycle(
      request(
        `/v1/profiles/${profileId}/follow-ups`,
        "POST",
        weekly({
          common: {
            adherence: 3,
            importantSymptoms: [{ modules: ["hydration"], severity: "important" }],
            materialChanges: [],
          },
          hydration: { issues: "important" },
        }),
      ),
      current.dependencies,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      candidate: {
        activeVersionId: versionId,
        candidateStatus: "pending",
        completeness: "provisional",
        diff: { affectedModules: ["hydration"] },
      },
      contextUpdateRequired: false,
    });
    expect(current.engineCalls).toHaveLength(1);
    expect(
      current.calls.find(({ name }) => name === "internal_create_plan_candidate"),
    ).toMatchObject({
      args: { p_change_kind: "follow_up_changed", p_impact: "module_only" },
      name: "internal_create_plan_candidate",
    });
  });

  it("registra un cambio material como provisional y exige completar contexto", async () => {
    const current = setup();
    const response = await handlePlanLifecycle(
      request(
        `/v1/profiles/${profileId}/follow-ups`,
        "POST",
        weekly({
          common: {
            adherence: 4,
            importantSymptoms: [],
            materialChanges: ["medication"],
          },
        }),
      ),
      current.dependencies,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      candidate: null,
      contextUpdateRequired: true,
      entry: { completeness: "provisional" },
      impact: { impact: "structural" },
    });
    expect(current.engineCalls).toHaveLength(0);
  });

  it("guarda analítica, muestra tendencia básica y crea candidato manual si sale de rango", async () => {
    const current = setup();
    const response = await handlePlanLifecycle(
      request(`/v1/profiles/${profileId}/labs`, "POST", {
        basePlanVersionId: versionId,
        observations: [
          {
            analyte: "b12",
            measurement: { date: "2026-07-20", kind: "exact" },
            name: "Vitamina B12",
            referenceRange: { maximum: "900", minimum: "200", unit: "pg/mL" },
            source: "laboratory",
            unit: "pg/mL",
            value: "180",
          },
        ],
        schemaVersion: 1,
      }),
      current.dependencies,
    );

    expect(response.status).toBe(200);
    const payload = LabMutationAckSchema.parse(await response.json());
    expect(payload).toMatchObject({
      candidate: {
        activeVersionId: versionId,
        candidateStatus: "pending",
        diff: { affectedModules: ["supplements"], changedFields: ["labValues"] },
      },
      history: {
        items: [
          {
            interpretation: "below_range",
            latestValue: "180",
            name: "Vitamina B12",
            trend: "down",
          },
        ],
      },
    });
    expect(payload.history.items[0]).not.toHaveProperty("prediction");
    expect(
      current.calls.find(({ name }) => name === "internal_create_plan_candidate"),
    ).toMatchObject({
      args: { p_change_kind: "lab_result_changed" },
      name: "internal_create_plan_candidate",
    });
  });

  it("mantiene confianza desconocida y no recalcula un valor incompleto", async () => {
    const incomplete = {
      ...newLab,
      confidence: "unknown" as const,
      measuredFrom: null,
      measuredTo: null,
      measurement: { kind: "unknown" as const },
      referenceRange: undefined,
      unit: undefined,
    };
    const current = setup({ labObservations: [] });
    current.dependencies.rpc = (name, args) => {
      current.calls.push({ args, name });
      if (name === "internal_get_profile_current_plan")
        return Promise.resolve({ data: [history], error: null });
      if (name === "internal_get_plan_version")
        return Promise.resolve({ data: [version], error: null });
      if (name === "internal_get_context_snapshot")
        return Promise.resolve({ data: [context], error: null });
      if (name === "internal_record_lab_batch")
        return Promise.resolve({
          data: [{ batchId, observations: [incomplete], requestRecalculation: false }],
          error: null,
        });
      if (name === "internal_list_lab_observations")
        return Promise.resolve({
          data: [{ observations: [incomplete], profileId }],
          error: null,
        });
      if (name === "internal_list_tracking_candidates")
        return Promise.resolve({
          data: [{ candidates: [], profileId }],
          error: null,
        });
      return Promise.resolve({ data: null, error: { message: `unexpected_${name}` } });
    };
    const response = await handlePlanLifecycle(
      request(`/v1/profiles/${profileId}/labs`, "POST", {
        basePlanVersionId: versionId,
        observations: [
          {
            analyte: "folate",
            measurement: { kind: "unknown" },
            name: "Folato",
            source: "self_reported",
            value: "4.2",
          },
        ],
        schemaVersion: 1,
      }),
      current.dependencies,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      candidate: null,
      history: {
        items: [{ freshness: { confidence: "unknown" }, trend: "insufficient" }],
      },
    });
    expect(current.engineCalls).toHaveLength(0);
  });
});
