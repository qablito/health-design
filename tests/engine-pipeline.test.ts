import { describe, expect, it } from "vitest";
import type { ContextSnapshotInternal } from "@health-design/contracts";

import {
  CORE_RULE_REVISIONS,
  CORE_RULE_SET_REVISION,
  CORE_SOURCE_MANIFEST,
  CORE_SOURCE_REVISIONS,
  ENGINE_VERSION,
  resolveChoice,
  runDeterministicEngine,
} from "../packages/engine/src/index";

const hash = (pair: string) => pair.repeat(32);
const context: ContextSnapshotInternal = {
  answers: {
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
    preferredFoods: ["Jose\u0301"],
    primaryObjective: "body_composition_maintain",
    proteinPreference: "food_only",
    trainingMode: "none",
    weightKg: 80,
  },
  canonicalizationVersion: "canonical-json-v1",
  completeness: "complete",
  createdAt: "2026-07-18T12:00:00.000Z",
  effectiveAt: "2026-07-18T12:00:00.000Z",
  id: "50000000-0000-4000-8000-000000000101",
  inputHash: hash("11"),
  normalizationVersion: "normalization-v1",
  profileId: "10000000-0000-4000-8000-000000000101",
  schemaVersion: 1,
  sourceDraftId: "40000000-0000-4000-8000-000000000101",
  sourceDraftVersion: 2,
};

describe("reconciliación de reglas", () => {
  it("versiona las fuentes científicas T11 y solo referencia revisiones registradas", () => {
    const expectedSourceIds = [
      "source:who-physical-activity-guidelines-2020@1.0.0",
      "source:acsm-resistance-training-position-2026@1.0.0",
      "source:ingram-static-stretching-meta-analysis-2025@1.0.0",
      "source:efsa-dietary-reference-values-water-2010@1.0.0",
    ];

    expect(CORE_SOURCE_REVISIONS.map(({ id }) => id)).toEqual(expectedSourceIds);
    expect(CORE_SOURCE_MANIFEST.sourceRevisionIds).toEqual(expectedSourceIds);
    expect(
      CORE_SOURCE_REVISIONS.every(
        ({
          applicability,
          citation,
          exclusions,
          evidenceType,
          hierarchy,
          population,
          reviewedAt,
          status,
          url,
        }) =>
          applicability.length > 0 &&
          citation.length > 0 &&
          exclusions.length > 0 &&
          evidenceType.length > 0 &&
          hierarchy.length > 0 &&
          population.length > 0 &&
          reviewedAt === "2026-07-19" &&
          status === "active" &&
          URL.canParse(url),
      ),
    ).toBe(true);

    const registeredSourceIds = new Set(expectedSourceIds);
    const t11Rules = CORE_RULE_REVISIONS.filter(({ ruleId }) =>
      [
        "rule.training-generated-block",
        "rule.training-declared-limitations",
        "rule.mobility-modular-duration",
      ].includes(ruleId),
    );
    expect(
      t11Rules
        .flatMap(({ evidenceRefs }) => evidenceRefs)
        .filter((reference) => reference.startsWith("source:"))
        .every((reference) => registeredSourceIds.has(reference)),
    ).toBe(true);

    expect(
      t11Rules.find(({ ruleId }) => ruleId === "rule.training-generated-block")
        ?.evidenceRefs,
    ).toEqual(
      expect.arrayContaining([
        "contract:t11-generated-four-week-block-v1",
        expectedSourceIds[0],
        expectedSourceIds[1],
      ]),
    );
    expect(
      t11Rules.find(({ ruleId }) => ruleId === "rule.training-declared-limitations")
        ?.evidenceRefs,
    ).toEqual(["contract:t11-declared-limitations-v1"]);
    expect(
      t11Rules.find(({ ruleId }) => ruleId === "rule.mobility-modular-duration")
        ?.evidenceRefs,
    ).toEqual(
      expect.arrayContaining([
        "contract:t11-mobility-modular-duration-v1",
        expectedSourceIds[2],
      ]),
    );
  });

  it("versiona el conjunto activo y exige evidencia trazable por revisión", () => {
    expect(ENGINE_VERSION).toBe("engine-v4");
    expect(CORE_RULE_SET_REVISION).toMatchObject({
      id: "d1bd58fd-54dc-4358-9242-43b1fdf20dc4",
      status: "active",
      version: "4.0.0",
    });
    expect(CORE_RULE_SET_REVISION.ruleRevisionIds).toEqual(
      CORE_RULE_REVISIONS.map(({ id }) => id),
    );
    expect(
      CORE_RULE_REVISIONS.every(
        ({ evidenceRefs, reviewedAt, status, version }) =>
          evidenceRefs.length > 0 &&
          ["2026-07-18", "2026-07-19"].includes(reviewedAt) &&
          status === "active" &&
          version === "1.0.0",
      ),
    ).toBe(true);
    expect(CORE_RULE_SET_REVISION.ruleRevisionIds).toEqual(
      expect.arrayContaining([
        "rule.training-generated-block@1.0.0",
        "rule.training-declared-limitations@1.0.0",
        "rule.mobility-modular-duration@1.0.0",
      ]),
    );
  });

  it("una preferencia no puede reabrir una opción excluida por una obligatoria", () => {
    expect(
      resolveChoice({
        options: ["requested", "not_requested"],
        rules: [
          {
            actionLevel: "adjustment",
            allowed: ["not_requested"],
            id: "training.none",
            kind: "mandatory",
          },
          {
            actionLevel: "information",
            id: "training.selected",
            kind: "preferential",
            order: ["requested", "not_requested"],
          },
        ],
      }),
    ).toEqual({
      appliedRuleIds: ["training.none", "training.selected"],
      choice: "not_requested",
      options: ["not_requested"],
      strictestActionLevel: "adjustment",
      unresolvedRuleIds: [],
    });
  });

  it("conserva la condicional sin datos como incertidumbre y gana la acción estricta", () => {
    expect(
      resolveChoice({
        options: ["low", "high"],
        rules: [
          {
            actionLevel: "priority_review",
            active: null,
            allowed: ["low"],
            id: "conditional.missing",
            kind: "conditional",
          },
          {
            actionLevel: "immediate_conservative",
            allowed: ["low", "high"],
            id: "mandatory.safe",
            kind: "mandatory",
          },
        ],
      }),
    ).toMatchObject({
      choice: "low",
      strictestActionLevel: "immediate_conservative",
      unresolvedRuleIds: ["conditional.missing"],
    });
  });
});

describe("pipeline determinista T8", () => {
  it("devuelve los seis módulos y marca como provisionales solo los solicitados", async () => {
    const result = await runDeterministicEngine({
      baseContext: null,
      baseModuleResults: null,
      change: null,
      context,
    });

    expect(result.engineVersion).toBe(ENGINE_VERSION);
    expect(result.completeness).toBe("provisional");
    expect(result.validationStatus).toBe("valid");
    expect(result.validation).toMatchObject({ errors: [], warnings: [] });
    expect(result.safetyFindings).toEqual([]);
    expect(result.moduleResults.map(({ module }) => module)).toEqual([
      "nutrition",
      "training",
      "hydration",
      "sleep",
      "mobility",
      "supplements",
    ]);
    expect(
      result.moduleResults.find(({ module }) => module === "nutrition"),
    ).toMatchObject({ confidence: "unknown", status: "provisional" });
    expect(
      result.moduleResults.find(({ module }) => module === "hydration"),
    ).toMatchObject({ confidence: "high", status: "valid" });
    expect(
      result.moduleResults.find(({ module }) => module === "training"),
    ).toMatchObject({
      confidence: "high",
      payload: { reason: "training_disabled_by_user" },
      status: "not_requested",
    });
    expect(
      result.moduleResults.filter(({ status }) => status === "not_requested"),
    ).toHaveLength(4);
  });

  it("produce hashes idénticos para Unicode equivalente y excluye timestamps volátiles", async () => {
    const first = await runDeterministicEngine({
      baseContext: null,
      baseModuleResults: null,
      change: null,
      context,
    });
    const second = await runDeterministicEngine({
      baseContext: null,
      baseModuleResults: null,
      change: null,
      context: {
        ...context,
        answers: {
          ...context.answers,
          preferredFoods: ["José"],
        },
        createdAt: "2028-01-01T00:00:00.000Z",
        effectiveAt: "2028-01-02T00:00:00.000Z",
      },
    });

    expect(second.inputHash).toBe(first.inputHash);
    expect(second.outputHash).toBe(first.outputHash);
  });

  it("rechaza como inválido un contexto sin módulos en vez de persistir un plan vacío", async () => {
    const result = await runDeterministicEngine({
      baseContext: null,
      baseModuleResults: null,
      change: null,
      context: { ...context, answers: { ...context.answers, activeModules: [] } },
    });

    expect(result.validationStatus).toBe("invalid");
    expect(result.validation).toMatchObject({ errors: ["modules_required"] });
    expect(result.moduleResults).toHaveLength(6);
  });

  it("recalcula solo módulos afectados y conserva literalmente los demás", async () => {
    const baseModuleResults = [
      {
        confidence: "high" as const,
        module: "nutrition" as const,
        payload: { marker: "base-nutrition" },
        status: "valid" as const,
        uncertainties: [],
      },
      {
        confidence: "high" as const,
        module: "training" as const,
        payload: { marker: "base-training" },
        status: "not_requested" as const,
        uncertainties: [],
      },
      {
        confidence: "high" as const,
        module: "hydration" as const,
        payload: { marker: "base-hydration" },
        status: "valid" as const,
        uncertainties: [],
      },
      {
        confidence: "high" as const,
        module: "sleep" as const,
        payload: { marker: "base-sleep" },
        status: "not_requested" as const,
        uncertainties: [],
      },
      {
        confidence: "high" as const,
        module: "mobility" as const,
        payload: { marker: "base-mobility" },
        status: "not_requested" as const,
        uncertainties: [],
      },
      {
        confidence: "high" as const,
        module: "supplements" as const,
        payload: { marker: "base-supplements" },
        status: "not_requested" as const,
        uncertainties: [],
      },
    ];
    const result = await runDeterministicEngine({
      baseContext: { ...context, inputHash: hash("12") },
      baseModuleResults,
      change: {
        affectedModules: ["nutrition"],
        changedFields: ["mealsPerDay"],
        impact: "module_only",
      },
      context: { ...context, answers: { ...context.answers, mealsPerDay: 5 } },
    });

    expect(
      result.moduleResults.find(({ module }) => module === "nutrition"),
    ).not.toEqual(baseModuleResults[0]);
    expect(result.moduleResults.find(({ module }) => module === "hydration")).toEqual(
      baseModuleResults[2],
    );
    expect(result.moduleResults.slice(1)).toEqual(baseModuleResults.slice(1));
    expect(result.validation).toMatchObject({
      preservedModules: ["training", "hydration", "sleep", "mobility", "supplements"],
      recalculatedModules: ["nutrition"],
    });
  });
});
