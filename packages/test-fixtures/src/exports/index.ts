import {
  EXPORT_RENDERER_VERSION,
  QuestionnaireAnswersSchema,
  ShoppingSnapshotResponseSchema,
  type CatalogSkuProjection,
  type ShoppingSnapshotResponse,
} from "@health-design/contracts";
import {
  applyConfirmedCommercialProduct,
  generateNutritionWeek,
} from "@health-design/engine";
import { createExportModel } from "@health-design/export/model";

import { effectiveNutritionFoods } from "../profiles/nutrition/index.ts";
import { COMMERCIAL_PRODUCT_FIXTURE } from "../products/index.ts";

const exportAnswers = QuestionnaireAnswersSchema.parse({
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
  nutritionMode: "balanced",
  physiologicalSex: "male",
  primaryObjective: "body_composition_maintain",
  proteinPreference: "food_only",
  trainingMode: "none",
  weightKg: 80,
});

export const exportNutrition = generateNutritionWeek({
  answers: exportAnswers,
  catalog: effectiveNutritionFoods,
});

const productApplicationIds = {
  calculationHash: "cd".repeat(32),
  confirmationId: "10000000-0000-4000-8000-000000000016",
  manifestId: "20000000-0000-4000-8000-000000000016",
  productId: "30000000-0000-4000-8000-000000000016",
  revisionId: "40000000-0000-4000-8000-000000000016",
} as const;

export const commercialProductName = "Alimento proteico envasado";
const commercialProductSourceName = `${commercialProductName} ${COMMERCIAL_PRODUCT_FIXTURE.gtin.displayGtin}`;
export const commercialProductPrivateSentinels = [
  COMMERCIAL_PRODUCT_FIXTURE.gtin.displayGtin,
  COMMERCIAL_PRODUCT_FIXTURE.gtin.gtin14,
  ...Object.values(productApplicationIds),
] as const;

const proteinPosition = (() => {
  for (const [dayIndex, day] of exportNutrition.days.entries()) {
    for (const [mealIndex, meal] of day.meals.entries()) {
      const foodIndex = meal.foods.findIndex(
        ({ function: role }) => role === "protein",
      );
      if (foodIndex >= 0) {
        return {
          canonicalFoodKey: meal.foods[foodIndex]!.canonicalFoodKey,
          dayIndex,
          foodIndex,
          mealIndex,
        };
      }
    }
  }
  throw new Error("fixture_missing_protein");
})();
const commercialProductNutrition = applyConfirmedCommercialProduct(exportNutrition, {
  answers: exportAnswers,
  product: {
    ...productApplicationIds,
    matchingState: "exact",
    snapshot: {
      ...COMMERCIAL_PRODUCT_FIXTURE,
      brand: "Marca comercial",
      name: commercialProductSourceName,
      nutrients: {
        carbohydratesG: { state: "known", unit: "g", value: "0" },
        clinical: {},
        energyKcal: { state: "known", unit: "kcal", value: "110" },
        fatG: { state: "known", unit: "g", value: "1.5" },
        fiberG: { state: "unknown" },
        proteinG: { state: "known", unit: "g", value: "23.4" },
        saltG: { state: "known", unit: "g", value: "0.2" },
        saturatedFatG: { state: "known", unit: "g", value: "0.4" },
        sugarsG: { state: "known", unit: "g", value: "0" },
      },
      safety: {
        allergens: { state: "known", values: [] },
        crossContactAllergens: { state: "known", values: [] },
        ingredients: { state: "known", values: ["Alimento proteico"] },
      },
    },
  },
  selection: {
    dayIndex: proteinPosition.dayIndex,
    expectedCanonicalFoodKey: proteinPosition.canonicalFoodKey,
    foodIndex: proteinPosition.foodIndex,
    mealIndex: proteinPosition.mealIndex,
  },
}).nutrition;

const shared = {
  nutrition: exportNutrition,
  planOutputHash: "ab".repeat(32),
  planVersionId: "20000000-0000-4000-8000-000000000001",
  rendererVersion: EXPORT_RENDERER_VERSION,
} as const;

export const exportModels = {
  commercialProduct: createExportModel({
    ...shared,
    config: {
      choices: [],
      detail: "compact",
      format: "pdf",
      includeShopping: true,
      includeWeeklyPreparation: false,
      presentation: "ingredients",
      range: { kind: "week" },
      schemaVersion: 1,
    },
    nutrition: commercialProductNutrition,
  }),
  compact: createExportModel({
    ...shared,
    config: {
      choices: [],
      detail: "compact",
      format: "pdf",
      includeShopping: false,
      includeWeeklyPreparation: false,
      presentation: "ingredients",
      range: { kind: "week" },
      schemaVersion: 1,
    },
  }),
  complete: createExportModel({
    ...shared,
    config: {
      choices: [[0, 0, 0, 1]],
      detail: "complete",
      format: "pdf",
      includeShopping: true,
      includeWeeklyPreparation: true,
      presentation: "preparation",
      range: { kind: "week" },
      schemaVersion: 1,
    },
  }),
  preparation: createExportModel({
    ...shared,
    config: {
      choices: [],
      detail: "compact",
      format: "pdf",
      includeShopping: false,
      includeWeeklyPreparation: false,
      presentation: "preparation",
      range: { kind: "day", day: 1 },
      schemaVersion: 1,
    },
  }),
} as const;

const shoppingProjection = {
  basePriceEur: "3.25",
  categoryPath: ["Alimentación"],
  chain: "mercadona",
  exclusionReasons: [],
  externalSku: "private-sku-17e",
  formatText: "500 g",
  gtin14: "08412345678901",
  market: "ES",
  name: "Pechuga 8412345678901",
  normalizedPrice: { dimension: "mass", unit: "EUR/kg", value: "6.5" },
  package: {
    equivalenceEvidenceRef: null,
    equivalentEdibleMassG: null,
    saleMeasure: { dimension: "mass", quantity: "500", unit: "g" },
  },
  purchaseForm: "fresh",
  schemaVersion: 1,
  skuId: "91000000-0000-4000-8000-000000015001",
  usability: "calculable",
} as const satisfies CatalogSkuProjection;

const completeShoppingSnapshot = ShoppingSnapshotResponseSchema.parse({
  lifecycle: { archivedAt: null, status: "active" },
  schemaVersion: 1,
  snapshot: {
    basketSeedRevisionId: "91000000-0000-4000-8000-000000015002",
    catalogPublicationIds: ["91000000-0000-4000-8000-000000015003"],
    comparison: {
      basis: "automatic_equivalent",
      baselineChains: ["mercadona"],
      baselineSubtotalEur: "6.5",
      candidateChains: ["dia"],
      candidateKind: "chain",
      candidateSubtotalEur: "6.49",
      comparableItems: 1,
      savingsEur: "0.01",
      scope: "complete",
      totalItems: 1,
    },
    completeness: "complete",
    createdAt: "2026-07-23T10:00:00.000Z",
    createdBy: "91000000-0000-4000-8000-000000015004",
    id: "91000000-0000-4000-8000-000000015005",
    inputDigest: "12".repeat(32),
    items: [
      {
        alternatives: [],
        amountG: "1000",
        canonicalFoodKey: "food:test.chicken",
        name: "Pollo 91000000-0000-4000-8000-000000015099",
        selected: {
          estimatedRemainderG: "0",
          packageCount: "2",
          projection: shoppingProjection,
          requiredAfterLeftoverG: "1000",
          totalCostEur: "6.5",
        },
        selectionOrigin: "manual",
        shoppingItemId: "91000000-0000-4000-8000-000000015006",
        state: "resolved",
        uncertainties: [],
      },
    ],
    planVersionId: shared.planVersionId,
    preference: {
      comparedChains: [],
      mode: "single",
      preferredChain: "mercadona",
      sorting: "normalized_price_asc",
    },
    preferenceRevisionId: "91000000-0000-4000-8000-000000015007",
    profileId: "91000000-0000-4000-8000-000000015008",
    resolverVersion: "shopping-resolver-v2",
    revision: 2,
    schemaVersion: 1,
    supersedesId: null,
    totals: {
      coverage: { resolvedItems: 1, totalItems: 1 },
      estimatedTotalEur: "6.5",
      kind: "complete",
      resolvedItems: 1,
      unresolvedItems: 0,
    },
  },
});

export const exportShoppingSnapshots = {
  archived: ShoppingSnapshotResponseSchema.parse({
    ...completeShoppingSnapshot,
    lifecycle: {
      archivedAt: "2026-07-23T11:00:00.000Z",
      status: "archived",
    },
  }),
  complete: completeShoppingSnapshot,
  partial: ShoppingSnapshotResponseSchema.parse({
    ...completeShoppingSnapshot,
    snapshot: {
      ...completeShoppingSnapshot.snapshot,
      comparison: {
        ...completeShoppingSnapshot.snapshot.comparison!,
        comparableItems: 1,
        savingsEur: null,
        scope: "partial",
        totalItems: 2,
      },
      completeness: "partial",
      items: [
        completeShoppingSnapshot.snapshot.items[0],
        {
          alternatives: [],
          amountG: "500",
          canonicalFoodKey: "food:test.rice",
          name: "=ARROZ()",
          selected: null,
          selectionOrigin: "automatic",
          shoppingItemId: "91000000-0000-4000-8000-000000015009",
          state: "price_unavailable",
          uncertainties: ["shopping_price_unavailable"],
        },
      ],
      totals: {
        coverage: { resolvedItems: 1, totalItems: 2 },
        kind: "partial",
        partialSubtotalEur: "6.5",
        resolvedItems: 1,
        unresolvedItems: 1,
      },
    },
  }),
} as const satisfies Readonly<Record<string, ShoppingSnapshotResponse>>;
