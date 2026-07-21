import { describe, expect, it } from "vitest";

import {
  normalizeNutritionWeek,
  type PlanEngineResult,
} from "@health-design/contracts";
import type { QuestionnaireAnswers } from "@health-design/domain";
import { generateNutritionWeek } from "@health-design/engine";
import { effectiveNutritionFoods } from "@health-design/test-fixtures/nutrition-plan";
import { COMMERCIAL_PRODUCT_FIXTURE } from "@health-design/test-fixtures/products";

import {
  handlePlanLifecycle,
  type PlanLifecycleDependencies,
} from "../supabase/functions/plans/lifecycle";

const profileId = "10000000-0000-4000-8000-000000000016";
const userId = "20000000-0000-4000-8000-000000000016";
const sessionId = "30000000-0000-4000-8000-000000000016";
const contextId = "40000000-0000-4000-8000-000000000016";
const planId = "50000000-0000-4000-8000-000000000016";
const baseVersionId = "60000000-0000-4000-8000-000000000016";
const candidateVersionId = "70000000-0000-4000-8000-000000000016";
const confirmationId = "80000000-0000-4000-8000-000000000016";
const timestamp = "2026-07-21T12:00:00.000Z";
const hash = (pair: string) => pair.repeat(32);

const answers = {
  activeModules: ["nutrition"],
  activityLevel: "moderate",
  age: 35,
  country: "ES",
  dietaryPattern: "omnivore",
  hasConditions: false,
  hasMedications: false,
  heightCm: 178,
  mealsPerDay: 4,
  nutritionAllergiesStatus: "none",
  nutritionFoodAnxiety: "no",
  nutritionIntolerancesStatus: "none",
  nutritionMealAnchors: ["wake_up", "midday", "afternoon", "evening"],
  nutritionMode: "simple",
  physiologicalSex: "male",
  primaryObjective: "body_composition_maintain",
  proteinPreference: "food_only",
  trainingMode: "none",
  weightKg: 80,
} as const satisfies QuestionnaireAnswers;

const nutrition = generateNutritionWeek({ answers, catalog: effectiveNutritionFoods });
const selection = (() => {
  for (const [dayIndex, day] of nutrition.days.entries()) {
    for (const [mealIndex, meal] of day.meals.entries()) {
      const foodIndex = meal.foods.findIndex(
        ({ canonicalFoodKey }) => canonicalFoodKey === "food:chicken-breast",
      );
      if (foodIndex >= 0) {
        return {
          dayIndex,
          expectedCanonicalFoodKey: "food:chicken-breast",
          foodIndex,
          mealIndex,
        };
      }
    }
  }
  throw new Error("fixture_missing_chicken");
})();

const known = (value: string, unit: "g" | "kcal" = "g") => ({
  state: "known" as const,
  unit,
  value,
});
const snapshot = {
  ...COMMERCIAL_PRODUCT_FIXTURE,
  brand: "Marca comercial",
  name: "Pechuga de pollo envasada",
  nutrients: {
    carbohydratesG: known("0"),
    clinical: {},
    energyKcal: known("110", "kcal"),
    fatG: known("1.5"),
    fiberG: { state: "unknown" as const },
    proteinG: known("23.4"),
    saltG: known("0.2"),
    saturatedFatG: known("0.4"),
    sugarsG: known("0"),
  },
};

const baseVersion = {
  activatedAt: timestamp,
  archivedAt: null,
  canonicalizationVersion: "canonical-json-v1",
  completeness: "complete",
  contextSnapshotId: contextId,
  createdAt: timestamp,
  engineVersion: "engine-v1",
  hashAlgorithm: "sha256",
  id: baseVersionId,
  inputHash: hash("11"),
  moduleResults: [
    {
      confidence: "high",
      createdAt: timestamp,
      id: "61000000-0000-4000-8000-000000000016",
      module: "nutrition",
      payload: nutrition,
      status: "valid",
      uncertainties: [],
    },
  ],
  ordinal: 1,
  outputHash: hash("12"),
  planId,
  ruleSetRevisionId: "62000000-0000-4000-8000-000000000016",
  safetyFindings: [],
  sourceManifestId: "63000000-0000-4000-8000-000000000016",
  status: "active",
  validatedAt: timestamp,
  validation: { completeness: "complete" },
  validationStatus: "valid",
} as const;

const baseSummary = (({ moduleResults, safetyFindings, ...summary }) => {
  void moduleResults;
  void safetyFindings;
  return summary;
})(baseVersion);

const candidateAck = {
  activatedAt: null,
  activeVersionId: baseVersionId,
  aggregateVersion: 3,
  archivedAt: null,
  baseVersionId,
  candidateId: "90000000-0000-4000-8000-000000000016",
  candidateStatus: "pending",
  changeEventId: "91000000-0000-4000-8000-000000000016",
  completeness: "provisional",
  contextSnapshotId: contextId,
  createdAt: timestamp,
  diff: {
    affectedModules: ["nutrition"],
    changedFields: ["nutrition.productApplication"],
  },
  impact: "module_only",
  ordinal: 2,
  planId,
  planVersionId: candidateVersionId,
  resolvedAt: null,
  status: "draft",
  validation: { completeness: "provisional" },
  validationStatus: "valid",
} as const;

function setup(
  matchingState: "exact" | "review" = "exact",
  completeness: "complete" | "insufficient" | "provisional" = "complete",
) {
  const calls: Array<{ args: Record<string, unknown>; name: string }> = [];
  const dependencies: PlanLifecycleDependencies = {
    authenticate: () => Promise.resolve({ sessionId, userId }),
    environment: "local",
    now: () => new Date(timestamp),
    randomUUID: () => "a0000000-0000-4000-8000-000000000016",
    rpc: (name, args) => {
      calls.push({ args, name });
      const data: Record<string, unknown> = {
        internal_commercial_product_for_application: [
          {
            completeness,
            confirmationId,
            contentHash: hash("ab"),
            manifestId: "b0000000-0000-4000-8000-000000000016",
            matching: {
              canonicalFoodKey: "food:chicken-breast",
              messageKey: `commercial_products.matching.${matchingState}`,
              state: matchingState,
            },
            productId: "c0000000-0000-4000-8000-000000000016",
            revisionId: "d0000000-0000-4000-8000-000000000016",
            schemaVersion: 1,
            snapshot,
          },
        ],
        internal_create_commercial_product_candidate: [candidateAck],
        internal_get_context_snapshot: [
          {
            answers,
            canonicalizationVersion: "canonical-json-v1",
            completeness: "complete",
            createdAt: timestamp,
            effectiveAt: timestamp,
            id: contextId,
            inputHash: hash("21"),
            normalizationVersion: "normalization-v1",
            profileId,
            schemaVersion: 1,
            sourceDraftId: "e0000000-0000-4000-8000-000000000016",
            sourceDraftVersion: 1,
          },
        ],
        internal_get_plan_version: [baseVersion],
        internal_list_plan_versions: [
          {
            activeVersionId: baseVersionId,
            aggregateVersion: 2,
            planId,
            profileId,
            versions: [baseSummary],
          },
        ],
      };
      return Promise.resolve({ data: data[name], error: null });
    },
    runEngine: () => Promise.reject(new Error("full_engine_must_not_run")),
  };
  return { calls, dependencies };
}

function request() {
  return new Request(`https://api.test/plans/v1/plans/${planId}/product-applications`, {
    body: JSON.stringify({
      baseVersionId,
      confirmationId,
      expectedVersion: 2,
      schemaVersion: 1,
      selection,
    }),
    headers: {
      authorization: "Bearer valid-user-jwt",
      "content-type": "application/json",
      "idempotency-key": "f0000000-0000-4000-8000-000000000016",
      "if-match": '"2"',
      origin: "http://127.0.0.1:5173",
    },
    method: "POST",
  });
}

describe("Edge de aplicación comercial al plan", () => {
  it("crea candidato provisional sin mutar ni regenerar la versión activa", async () => {
    const current = setup();
    const response = await handlePlanLifecycle(request(), current.dependencies);

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      activeVersionId: baseVersionId,
      candidateStatus: "pending",
      completeness: "provisional",
    });
    expect(current.calls.map(({ name }) => name)).toEqual([
      "internal_list_plan_versions",
      "internal_get_plan_version",
      "internal_get_context_snapshot",
      "internal_commercial_product_for_application",
      "internal_create_commercial_product_candidate",
    ]);
    const create = current.calls.at(-1)!;
    const modules = create.args.p_module_results as PlanEngineResult["moduleResults"];
    const appliedNutrition = normalizeNutritionWeek(modules[0]!.payload);
    expect(modules[0]).toMatchObject({
      module: "nutrition",
      status: "provisional",
    });
    expect(
      appliedNutrition.days.flatMap(({ meals }) =>
        meals.flatMap(({ foods }) => foods.map(({ name }) => name)),
      ),
    ).toContain("Pechuga de pollo envasada");
    expect(create.args.p_change_payload).not.toHaveProperty("snapshot");
    expect(create.args).toMatchObject({
      p_base_version_id: baseVersionId,
      p_change_kind: "commercial_product_applied",
      p_diff: {
        affectedModules: ["nutrition"],
        changedFields: ["nutrition.productApplication"],
      },
      p_engine_completeness: "provisional",
      p_expected_version: 2,
      p_plan_id: planId,
      p_validation_status: "valid",
    });
  });

  it("no crea candidato cuando el matching requiere revisión", async () => {
    const current = setup("review");
    const response = await handlePlanLifecycle(request(), current.dependencies);

    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({
      error: { code: "PRODUCT_MATCH_REVIEW_REQUIRED" },
    });
    expect(
      current.calls.some(
        ({ name }) => name === "internal_create_commercial_product_candidate",
      ),
    ).toBe(false);
  });

  it("no aplica una revisión persistida como insuficiente", async () => {
    const current = setup("exact", "insufficient");
    const response = await handlePlanLifecycle(request(), current.dependencies);

    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({
      error: { code: "PRODUCT_DATA_INSUFFICIENT" },
    });
    expect(
      current.calls.some(
        ({ name }) => name === "internal_create_commercial_product_candidate",
      ),
    ).toBe(false);
  });
});
