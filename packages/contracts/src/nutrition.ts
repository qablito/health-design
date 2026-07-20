import { z } from "zod";

import {
  DIETARY_PATTERNS,
  FOOD_FUNCTIONS,
  NUTRITION_MEAL_ANCHORS,
  NUTRITION_MODES,
  type FoodPreparation,
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

const PreparationTokenSchema = z.string().regex(/^[a-z0-9][a-z0-9._-]{0,63}$/);

export const FoodPreparationSchema = z
  .object({
    instruction: z.string().min(1).max(240),
    ruleId: PreparationTokenSchema,
    ruleSetVersion: PreparationTokenSchema,
    status: z.enum(["complete", "provisional"]),
  })
  .strict();

export const NutritionPreparationSchema = z
  .object({
    completeness: z.enum(["complete", "provisional"]),
    ruleSetVersion: PreparationTokenSchema,
    uncertainties: z.array(NutritionUncertaintySchema).max(50),
  })
  .strict()
  .superRefine((preparation, context) => {
    if (
      (preparation.completeness === "complete") !==
      (preparation.uncertainties.length === 0)
    ) {
      context.addIssue({
        code: "custom",
        message: "nutrition_preparation_completeness_mismatch",
        path: ["uncertainties"],
      });
    }
  });

export const LEGACY_FOOD_PREPARATION = {
  instruction:
    "Utiliza la cantidad indicada. Consulta el envase o la información del alimento para su preparación habitual.",
  ruleId: "legacy-fallback",
  ruleSetVersion: "legacy-fallback-v1",
  status: "provisional",
} as const satisfies FoodPreparation;

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

const LegacyPlannedFoodAlternativeSchema = z
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

const LegacyPlannedFoodSchema = LegacyPlannedFoodAlternativeSchema.extend({
  substitutes: z.array(LegacyPlannedFoodAlternativeSchema).length(2),
}).strict();

const PlannedFoodAlternativeV2Schema = LegacyPlannedFoodAlternativeSchema.extend({
  preparation: FoodPreparationSchema,
}).strict();

const PlannedFoodV2Schema = PlannedFoodAlternativeV2Schema.extend({
  substitutes: z.array(PlannedFoodAlternativeV2Schema).length(2),
}).strict();

const LegacyNutritionMealSchema = z
  .object({
    anchor: z.enum(NUTRITION_MEAL_ANCHORS),
    flexibleWindowMinutes: z.number().int().min(15).max(240),
    foods: z.array(LegacyPlannedFoodSchema).min(1).max(12),
    index: z.number().int().min(1).max(6),
    totals: NutritionTotalsSchema,
  })
  .strict();

const NutritionMealV2Schema = LegacyNutritionMealSchema.extend({
  foods: z.array(PlannedFoodV2Schema).min(1).max(12),
}).strict();

const LegacyNutritionDaySchema = z
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
    meals: z.array(LegacyNutritionMealSchema).min(2).max(6),
    totals: NutritionTotalsSchema,
  })
  .strict();

const NutritionDayV2Schema = LegacyNutritionDaySchema.extend({
  meals: z.array(NutritionMealV2Schema).min(2).max(6),
}).strict();

const NutritionWeekBaseShape = {
  catalogManifestIds: z.array(z.uuid()).min(1).max(100),
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
} as const;

export const LegacyNutritionWeekSchema = z
  .object({
    ...NutritionWeekBaseShape,
    days: z.array(LegacyNutritionDaySchema).length(7),
  })
  .strict();

export const NutritionWeekV2Schema = z
  .object({
    ...NutritionWeekBaseShape,
    days: z.array(NutritionDayV2Schema).length(7),
    nutritionSchemaVersion: z.literal(2),
    preparation: NutritionPreparationSchema,
  })
  .strict();

export const NutritionWeekSchema = z.union([
  NutritionWeekV2Schema,
  LegacyNutritionWeekSchema,
]);

export type LegacyNutritionWeekContract = z.infer<typeof LegacyNutritionWeekSchema>;
export type NutritionWeekV2Contract = z.infer<typeof NutritionWeekV2Schema>;
export type NutritionWeekContract = z.infer<typeof NutritionWeekSchema>;

export function normalizeNutritionWeek(candidate: unknown): NutritionWeekV2Contract {
  const parsed = NutritionWeekSchema.parse(candidate);
  if ("nutritionSchemaVersion" in parsed) return parsed;

  return NutritionWeekV2Schema.parse({
    ...parsed,
    days: parsed.days.map((day) => ({
      ...day,
      meals: day.meals.map((meal) => ({
        ...meal,
        foods: meal.foods.map((food) => ({
          ...food,
          preparation: { ...LEGACY_FOOD_PREPARATION },
          substitutes: food.substitutes.map((substitute) => ({
            ...substitute,
            preparation: { ...LEGACY_FOOD_PREPARATION },
          })),
        })),
      })),
    })),
    nutritionSchemaVersion: 2,
    preparation: {
      completeness: "provisional",
      ruleSetVersion: LEGACY_FOOD_PREPARATION.ruleSetVersion,
      uncertainties: [
        {
          code: "PREPARATION_NOT_VERSIONED",
          messageKey: "nutrition.preparation.not_versioned",
        },
      ],
    },
  });
}

export type EffectiveNutritionFoodContract = z.infer<
  typeof EffectiveNutritionFoodSchema
>;
