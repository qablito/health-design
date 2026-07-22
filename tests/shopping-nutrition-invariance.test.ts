import { describe, expect, it } from "vitest";

import {
  ShoppingResolutionInputSchema,
  type ShoppingResolutionInput,
} from "@health-design/contracts";
import type { QuestionnaireAnswers } from "@health-design/domain";
import { generateNutritionWeek, sha256CanonicalJson } from "@health-design/engine";
import {
  resolveShopping,
  SHOPPING_RESOLVER_VERSION,
} from "@health-design/engine/shopping";
import { effectiveNutritionFoods } from "@health-design/test-fixtures/nutrition-plan";

const uuid = (value: number) =>
  `${String(value).padStart(8, "0")}-0000-4000-8000-000000000001`;

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
  nutritionMode: "balanced",
  physiologicalSex: "male",
  primaryObjective: "body_composition_maintain",
  proteinPreference: "food_only",
  trainingMode: "none",
  weightKg: 80,
} as const satisfies QuestionnaireAnswers;

function nutritionFingerprint(nutrition: ReturnType<typeof generateNutritionWeek>) {
  return {
    days: nutrition.days.map(({ meals }) =>
      meals.map(({ foods, totals }) => ({
        foods: foods.map(({ amountG, canonicalFoodKey, nutrients, substitutes }) => ({
          amountG,
          canonicalFoodKey,
          nutrients: {
            carbohydratesG: nutrients.carbohydratesG,
            energyKcal: nutrients.energyKcal,
            fatG: nutrients.fatG,
            fiberG: nutrients.fiberG,
            proteinG: nutrients.proteinG,
          },
          substitutes,
        })),
        totals,
      })),
    ),
    shoppingList: nutrition.shoppingList,
    weekTotals: nutrition.weekTotals,
  };
}

describe("invariancia nutricional T17C", () => {
  it("cambiar compra no altera alimentos, gramos, macros, fibra, sustituciones ni hash", async () => {
    const nutrition = generateNutritionWeek({
      answers,
      catalog: effectiveNutritionFoods,
    });
    const before = structuredClone(nutrition);
    const beforeFingerprint = nutritionFingerprint(nutrition);
    const beforeHash = await sha256CanonicalJson(nutrition);
    const food = nutrition.shoppingList[0]!;

    const base = {
      basketSeedRevisionId: uuid(2),
      catalogItems: [
        {
          canonicalFoodKey: food.canonicalFoodKey,
          matchState: "exact",
          matchedEdiblePart: "whole_edible_product",
          matchedFoodState: "raw",
          matchedPurchaseForm: "fresh",
          projection: {
            basePriceEur: "3",
            categoryPath: ["Fixture"],
            chain: "mercadona",
            exclusionReasons: [],
            externalSku: "nutrition-invariant-mercadona",
            formatText: "500 g",
            gtin14: null,
            market: "ES",
            name: food.name,
            normalizedPrice: {
              dimension: "mass",
              unit: "EUR/kg",
              value: "6",
            },
            package: {
              equivalenceEvidenceRef: null,
              equivalentEdibleMassG: null,
              saleMeasure: { dimension: "mass", quantity: "500", unit: "g" },
            },
            purchaseForm: "fresh",
            schemaVersion: 1,
            skuId: uuid(20),
            usability: "calculable",
          },
        },
        {
          canonicalFoodKey: food.canonicalFoodKey,
          matchState: "allowed",
          matchedEdiblePart: "whole_edible_product",
          matchedFoodState: "raw",
          matchedPurchaseForm: "fresh",
          projection: {
            basePriceEur: "2.5",
            categoryPath: ["Fixture"],
            chain: "dia",
            exclusionReasons: [],
            externalSku: "nutrition-invariant-dia",
            formatText: "750 g",
            gtin14: null,
            market: "ES",
            name: food.name,
            normalizedPrice: {
              dimension: "mass",
              unit: "EUR/kg",
              value: "3.333333",
            },
            package: {
              equivalenceEvidenceRef: null,
              equivalentEdibleMassG: null,
              saleMeasure: { dimension: "mass", quantity: "750", unit: "g" },
            },
            purchaseForm: "fresh",
            schemaVersion: 1,
            skuId: uuid(21),
            usability: "calculable",
          },
        },
      ],
      catalogPublicationIds: [uuid(3), uuid(4)],
      leftovers: [],
      manualSelections: [],
      planVersionId: uuid(5),
      preferenceRevision: {
        comparedChains: [],
        createdAt: "2026-07-22T10:00:00.000Z",
        createdBy: uuid(6),
        id: uuid(7),
        mode: "single",
        preferredChain: "mercadona",
        profileId: uuid(8),
        schemaVersion: 1,
        sorting: "price_asc",
        supersedesId: null,
        version: 1,
      },
      profileId: uuid(8),
      resolutionMetadata: {
        createdAt: "2026-07-22T11:00:00.000Z",
        createdBy: uuid(6),
        id: uuid(9),
        itemIds: [
          { canonicalFoodKey: food.canonicalFoodKey, shoppingItemId: uuid(10) },
        ],
        resolverVersion: SHOPPING_RESOLVER_VERSION,
        revision: 1,
        supersedesId: null,
      },
      schemaVersion: 1,
      shoppingList: [
        {
          amountG: food.amountG,
          canonicalFoodKey: food.canonicalFoodKey,
          name: food.name,
          purchaseContext: {
            ediblePart: "whole_edible_product",
            foodState: "raw",
            purchaseForm: "fresh",
          },
        },
      ],
    } satisfies ShoppingResolutionInput;

    const variants = [
      base,
      {
        ...base,
        leftovers: [
          {
            canonicalFoodKey: food.canonicalFoodKey,
            confirmedEquivalentG: "100",
            evidenceRef: "Confirmado",
          },
        ],
        manualSelections: [
          { canonicalFoodKey: food.canonicalFoodKey, skuId: uuid(20) },
        ],
      },
      {
        ...base,
        manualSelections: [
          { canonicalFoodKey: food.canonicalFoodKey, skuId: uuid(21) },
        ],
        preferenceRevision: {
          ...base.preferenceRevision,
          comparedChains: ["mercadona", "dia"],
          mode: "multistore",
          version: 2,
        },
      },
      {
        ...base,
        preferenceRevision: {
          ...base.preferenceRevision,
          preferredChain: "dia",
          version: 3,
        },
      },
    ].map((variant) => ShoppingResolutionInputSchema.parse(variant));

    for (const variant of variants) {
      await resolveShopping(variant);
      expect(nutrition).toEqual(before);
      expect(nutritionFingerprint(nutrition)).toEqual(beforeFingerprint);
      expect(await sha256CanonicalJson(nutrition)).toBe(beforeHash);
    }
  });
});
