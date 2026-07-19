import { z } from "zod";

import {
  DIETARY_PATTERNS,
  FOOD_FUNCTIONS,
  NUTRITION_MEAL_ANCHORS,
  NUTRITION_MODES,
} from "@health-design/domain";

const DecimalSchema = z.string().regex(/^(?:0|[1-9]\d*)(?:\.\d+)?$/);
const FoodKeySchema = z.string().regex(/^food:[a-z0-9][a-z0-9._:-]{0,127}$/);

export const NutritionTotalsSchema = z
  .object({
    carbohydratesG: DecimalSchema,
    energyKcal: DecimalSchema,
    fatG: DecimalSchema,
    fiberG: DecimalSchema,
    proteinG: DecimalSchema,
  })
  .strict();

const ClinicalNutrientAmountSchema = z
  .object({
    unit: z.enum(["g", "mg", "ug"]),
    value: DecimalSchema,
  })
  .strict();

const ClinicalNutrientsSchema = z
  .record(z.string().regex(/^[a-z][a-z0-9_]{0,63}$/), ClinicalNutrientAmountSchema)
  .refine((values) => Object.keys(values).length <= 64, "clinical_nutrients_limit");

export const EffectiveNutritionFoodSchema = z
  .object({
    aliases: z.array(z.string().min(1).max(200)).max(50),
    allergens: z.array(z.string().min(1).max(80)).max(30),
    canonicalFoodKey: FoodKeySchema,
    category: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/),
    clinicalNutrients: ClinicalNutrientsSchema,
    crossContactAllergens: z.array(z.string().min(1).max(80)).max(30),
    dietaryPatterns: z.array(z.enum(DIETARY_PATTERNS)).min(1).max(4),
    ediblePart: z.string().regex(/^[a-z][a-z0-9_]{0,95}$/),
    foodState: z.enum(["raw", "cooked", "unspecified"]),
    functions: z.array(z.enum(FOOD_FUNCTIONS)).min(1).max(FOOD_FUNCTIONS.length),
    intoleranceTags: z.array(z.string().min(1).max(80)).max(30),
    isProteinPowder: z.boolean(),
    manifestId: z.uuid(),
    name: z.string().min(1).max(200),
    nutrients: NutritionTotalsSchema.extend({
      clinical: z.record(z.string(), DecimalSchema).optional(),
    }).strict(),
    revisionId: z.uuid(),
    sourceKey: z.string().min(1).max(64),
    sourceVersion: z.string().min(1).max(128),
  })
  .strict();

const NutritionUncertaintySchema = z
  .object({ code: z.string().min(1).max(80), messageKey: z.string().min(1).max(160) })
  .strict();

export const NutritionTargetsSchema = z
  .object({
    completeness: z.enum(["complete", "provisional"]),
    energy: z
      .object({
        centerKcal: DecimalSchema,
        goalApplied: z.enum([
          "fat_loss",
          "maintenance",
          "maintenance_conservative",
          "muscle_gain",
          "recomposition",
        ]),
        maximumKcal: DecimalSchema,
        minimumKcal: DecimalSchema,
        restingCenterKcal: DecimalSchema,
        restingMaximumKcal: DecimalSchema,
        restingMinimumKcal: DecimalSchema,
        restingSource: z.enum(["indirect_calorimetry", "mifflin_st_jeor"]),
      })
      .strict(),
    fiber: z.object({ minimumG: z.literal("25"), targetG: DecimalSchema }).strict(),
    macros: NutritionTotalsSchema.extend({ fatPercent: z.literal("30") }).strict(),
    protein: z
      .object({
        centerG: DecimalSchema,
        centerGPerKg: DecimalSchema,
        maximumG: DecimalSchema,
        maximumGPerKg: DecimalSchema,
        minimumG: DecimalSchema,
        minimumGPerKg: DecimalSchema,
      })
      .strict(),
    uncertainties: z.array(NutritionUncertaintySchema).max(50),
  })
  .strict();

const PlannedFoodAlternativeSchema = z
  .object({
    amountG: DecimalSchema,
    canonicalFoodKey: FoodKeySchema,
    clinicalNutrients: ClinicalNutrientsSchema,
    foodState: z.enum(["raw", "cooked", "unspecified"]),
    function: z.enum(FOOD_FUNCTIONS),
    name: z.string().min(1).max(200),
    nutrients: NutritionTotalsSchema,
    revisionId: z.uuid(),
    source: z
      .object({
        manifestId: z.uuid(),
        sourceKey: z.string().min(1).max(64),
        sourceVersion: z.string().min(1).max(128),
      })
      .strict(),
  })
  .strict();

const PlannedFoodSchema = PlannedFoodAlternativeSchema.extend({
  substitutes: z.array(PlannedFoodAlternativeSchema).length(2),
}).strict();

const NutritionMealSchema = z
  .object({
    anchor: z.enum(NUTRITION_MEAL_ANCHORS),
    flexibleWindowMinutes: z.number().int().min(15).max(240),
    foods: z.array(PlannedFoodSchema).min(1).max(12),
    index: z.number().int().min(1).max(6),
    totals: NutritionTotalsSchema,
  })
  .strict();

const NutritionDaySchema = z
  .object({
    day: z.union([
      z.literal(1),
      z.literal(2),
      z.literal(3),
      z.literal(4),
      z.literal(5),
      z.literal(6),
      z.literal(7),
    ]),
    meals: z.array(NutritionMealSchema).min(2).max(6),
    totals: NutritionTotalsSchema,
  })
  .strict();

export const NutritionWeekSchema = z
  .object({
    catalogManifestIds: z.array(z.uuid()).min(1).max(100),
    days: z.array(NutritionDaySchema).length(7),
    dietaryPattern: z.enum(DIETARY_PATTERNS),
    mode: z.enum(NUTRITION_MODES),
    shoppingList: z.array(
      z
        .object({
          amountG: DecimalSchema,
          canonicalFoodKey: FoodKeySchema,
          name: z.string().min(1).max(200),
        })
        .strict(),
    ),
    strategies: z.array(z.string().min(1).max(160)).max(20),
    targets: NutritionTargetsSchema,
    validation: z
      .object({
        errors: z.array(z.string().min(1).max(120)).max(50),
        status: z.enum(["invalid", "valid"]),
        warnings: z.array(z.string().min(1).max(120)).max(50),
      })
      .strict(),
    weekTotals: NutritionTotalsSchema,
  })
  .strict();

export type EffectiveNutritionFoodContract = z.infer<
  typeof EffectiveNutritionFoodSchema
>;
export type NutritionWeekContract = z.infer<typeof NutritionWeekSchema>;
