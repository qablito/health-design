import { describe, expect, it } from "vitest";

import { hydrateEffectiveNutritionCatalog } from "../supabase/functions/plans/nutrition-catalog";

const row = {
  canonicalFoodKey: "food:ciqual-36017",
  category: "meat",
  clinicalNutrients: {
    iron: { unit: "mg", value: "0.33" },
    vitamin_b12: { unit: "ug", value: "0.17" },
  },
  ediblePart: "meat_without_skin",
  effectiveRevisionId: "92000000-0000-4000-8000-000000000001",
  foodState: "raw",
  manifestId: "93000000-0000-4000-8000-000000000001",
  name: "Pechuga de pollo",
  nutrients: {
    carbohydrates: "0",
    energy_kcal: "110",
    fat: "1.5",
    fiber: "0",
    protein: "23.4",
  },
  revisionId: "94000000-0000-4000-8000-000000000001",
  sourceKey: "ciqual_2025",
  sourceVersion: "2025",
};

describe("lector efectivo del catálogo para planes", () => {
  it("hidrata solo claves curadas con procedencia y valores efectivos", () => {
    const result = hydrateEffectiveNutritionCatalog([
      row,
      { ...row, canonicalFoodKey: "food:unmodelled" },
    ]);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      canonicalFoodKey: "food:ciqual-36017",
      clinicalNutrients: row.clinicalNutrients,
      dietaryPatterns: ["omnivore"],
      manifestId: row.manifestId,
      nutrients: { energyKcal: "110", proteinG: "23.4" },
      sourceKey: "ciqual_2025",
    });
  });

  it("rechaza un estado o parte comestible que no coincida con la curación", () => {
    expect(() =>
      hydrateEffectiveNutritionCatalog([{ ...row, foodState: "cooked" }]),
    ).toThrow("effective_nutrition_catalog_metadata_mismatch");
  });

  it("rechaza una unidad clínica distinta de la unidad canónica curada", () => {
    expect(() =>
      hydrateEffectiveNutritionCatalog([
        {
          ...row,
          clinicalNutrients: { iron: { unit: "ug", value: "330" } },
        },
      ]),
    ).toThrow("effective_nutrition_catalog_clinical_unit_mismatch");
  });
});
