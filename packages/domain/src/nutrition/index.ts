import type {
  DietaryPattern,
  NutritionMealAnchor,
  NutritionMode,
} from "../questionnaire/index.ts";

export const FOOD_FUNCTIONS = [
  "protein",
  "carbohydrate_base",
  "fat",
  "fruit_vegetable",
  "dairy_equivalent",
  "complement",
] as const;
export type FoodFunction = (typeof FOOD_FUNCTIONS)[number];

export type NutritionTotals = Readonly<{
  carbohydratesG: string;
  energyKcal: string;
  fatG: string;
  fiberG: string;
  proteinG: string;
}>;

export type ClinicalNutrientAmount = Readonly<{
  unit: "g" | "mg" | "ug";
  value: string;
}>;

export type EffectiveNutritionFood = Readonly<{
  aliases: readonly string[];
  allergens: readonly string[];
  canonicalFoodKey: string;
  category: string;
  clinicalNutrients: Readonly<Record<string, ClinicalNutrientAmount>>;
  crossContactAllergens: readonly string[];
  dietaryPatterns: readonly DietaryPattern[];
  ediblePart: string;
  foodState: "cooked" | "raw" | "unspecified";
  functions: readonly FoodFunction[];
  intoleranceTags: readonly string[];
  isProteinPowder: boolean;
  manifestId: string;
  name: string;
  nutrients: NutritionTotals;
  revisionId: string;
  sourceKey: string;
  sourceVersion: string;
}>;

export type NutritionUncertainty = Readonly<{
  code: string;
  messageKey: string;
}>;

export type FoodPreparation = Readonly<{
  instruction: string;
  ruleId: string;
  ruleSetVersion: string;
  status: "complete" | "provisional";
}>;

export type NutritionPreparation = Readonly<{
  completeness: "complete" | "provisional";
  ruleSetVersion: string;
  uncertainties: readonly NutritionUncertainty[];
}>;

export type NutritionTargets = Readonly<{
  completeness: "complete" | "provisional";
  energy: Readonly<{
    centerKcal: string;
    goalApplied:
      | "fat_loss"
      | "maintenance"
      | "maintenance_conservative"
      | "muscle_gain"
      | "recomposition";
    maximumKcal: string;
    minimumKcal: string;
    restingCenterKcal: string;
    restingMaximumKcal: string;
    restingMinimumKcal: string;
    restingSource: "indirect_calorimetry" | "mifflin_st_jeor";
  }>;
  fiber: Readonly<{ minimumG: "25"; targetG: string }>;
  macros: NutritionTotals & Readonly<{ fatPercent: "30" }>;
  protein: Readonly<{
    centerG: string;
    centerGPerKg: string;
    maximumG: string;
    maximumGPerKg: string;
    minimumG: string;
    minimumGPerKg: string;
  }>;
  uncertainties: readonly NutritionUncertainty[];
}>;

export type PlannedFoodAlternative = Readonly<{
  amountG: string;
  canonicalFoodKey: string;
  clinicalNutrients: Readonly<Record<string, ClinicalNutrientAmount>>;
  foodState: EffectiveNutritionFood["foodState"];
  function: FoodFunction;
  name: string;
  nutrients: NutritionTotals;
  revisionId: string;
  source: Readonly<{
    manifestId: string;
    sourceKey: string;
    sourceVersion: string;
  }>;
}>;

export type PlannedFood = PlannedFoodAlternative &
  Readonly<{
    substitutes: readonly PlannedFoodAlternative[];
  }>;

export type PreparedPlannedFoodAlternative = PlannedFoodAlternative &
  Readonly<{ preparation: FoodPreparation }>;

export type PreparedPlannedFood = PreparedPlannedFoodAlternative &
  Readonly<{
    substitutes: readonly PreparedPlannedFoodAlternative[];
  }>;

export type NutritionMeal = Readonly<{
  anchor: NutritionMealAnchor;
  flexibleWindowMinutes: number;
  foods: readonly PlannedFood[];
  index: number;
  totals: NutritionTotals;
}>;

export type NutritionDay = Readonly<{
  day: 1 | 2 | 3 | 4 | 5 | 6 | 7;
  meals: readonly NutritionMeal[];
  totals: NutritionTotals;
}>;

export type NutritionMealV2 = Omit<NutritionMeal, "foods"> &
  Readonly<{ foods: readonly PreparedPlannedFood[] }>;

export type NutritionDayV2 = Omit<NutritionDay, "meals"> &
  Readonly<{ meals: readonly NutritionMealV2[] }>;

export type ShoppingListItem = Readonly<{
  amountG: string;
  canonicalFoodKey: string;
  name: string;
}>;

export type NutritionWeek = Readonly<{
  catalogManifestIds: readonly string[];
  days: readonly NutritionDay[];
  dietaryPattern: DietaryPattern;
  mode: NutritionMode;
  shoppingList: readonly ShoppingListItem[];
  strategies: readonly string[];
  targets: NutritionTargets;
  validation: Readonly<{
    errors: readonly string[];
    status: "invalid" | "valid";
    warnings: readonly string[];
  }>;
  weekTotals: NutritionTotals;
}>;

export type NutritionWeekV2 = Omit<NutritionWeek, "days"> &
  Readonly<{
    days: readonly NutritionDayV2[];
    nutritionSchemaVersion: 2;
    preparation: NutritionPreparation;
  }>;
