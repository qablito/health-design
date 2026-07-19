import { GENERATOR_METADATA_BY_FOOD_KEY } from "@health-design/catalog/nutrition-generator";
import {
  EffectiveNutritionFoodSchema,
  type EffectiveNutritionFoodContract,
} from "@health-design/contracts";

function object(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("invalid_effective_nutrition_catalog");
  }
  return value as Record<string, unknown>;
}

function text(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== "string") throw new Error("invalid_effective_nutrition_catalog");
  return value;
}

const CLINICAL_NUTRIENT_UNITS = {
  calcium: "mg",
  folate: "ug",
  iron: "mg",
  iodine: "ug",
  magnesium: "mg",
  potassium: "mg",
  salt: "g",
  saturated_fat: "g",
  selenium: "ug",
  sodium: "mg",
  sugars: "g",
  vitamin_b12: "ug",
  vitamin_c: "mg",
  zinc: "mg",
} as const;

function clinicalNutrients(value: unknown) {
  const source = object(value);
  return Object.fromEntries(
    Object.entries(CLINICAL_NUTRIENT_UNITS).flatMap(([key, expectedUnit]) => {
      if (source[key] === undefined) return [];
      const nutrient = object(source[key]);
      if (text(nutrient, "unit") !== expectedUnit) {
        throw new Error("effective_nutrition_catalog_clinical_unit_mismatch");
      }
      return [[key, { unit: expectedUnit, value: text(nutrient, "value") }]];
    }),
  );
}

export function hydrateEffectiveNutritionCatalog(
  value: unknown,
): EffectiveNutritionFoodContract[] {
  if (!Array.isArray(value) || value.length > 5_000) {
    throw new Error("invalid_effective_nutrition_catalog");
  }
  return value.flatMap((entry) => {
    const row = object(entry);
    const canonicalFoodKey = text(row, "canonicalFoodKey");
    const metadata = GENERATOR_METADATA_BY_FOOD_KEY.get(canonicalFoodKey);
    if (!metadata) return [];
    if (
      text(row, "category") !== metadata.category ||
      text(row, "foodState") !== metadata.foodState ||
      text(row, "ediblePart") !== metadata.ediblePart
    ) {
      throw new Error("effective_nutrition_catalog_metadata_mismatch");
    }
    const nutrients = object(row.nutrients);
    return [
      EffectiveNutritionFoodSchema.parse({
        aliases: metadata.aliases,
        allergens: metadata.allergens,
        canonicalFoodKey,
        category: metadata.category,
        clinicalNutrients: clinicalNutrients(row.clinicalNutrients),
        crossContactAllergens: metadata.crossContactAllergens,
        dietaryPatterns: metadata.dietaryPatterns,
        ediblePart: metadata.ediblePart,
        foodState: metadata.foodState,
        functions: metadata.functions,
        intoleranceTags: metadata.intoleranceTags,
        isProteinPowder: metadata.isProteinPowder,
        manifestId: text(row, "manifestId"),
        name: metadata.name,
        nutrients: {
          carbohydratesG: text(nutrients, "carbohydrates"),
          energyKcal: text(nutrients, "energy_kcal"),
          fatG: text(nutrients, "fat"),
          fiberG: text(nutrients, "fiber"),
          proteinG: text(nutrients, "protein"),
        },
        revisionId: text(row, "revisionId"),
        sourceKey: text(row, "sourceKey"),
        sourceVersion: text(row, "sourceVersion"),
      }),
    ];
  });
}
