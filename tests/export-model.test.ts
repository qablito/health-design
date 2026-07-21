import { describe, expect, it } from "vitest";

import {
  EXPORT_RENDERER_VERSION,
  type ExportCreateRequestContract,
} from "@health-design/contracts";
import { createExportModel } from "@health-design/export/model";
import {
  applyNutritionSubstitution,
  generateNutritionWeek,
} from "@health-design/engine";
import {
  commercialProductName,
  commercialProductPrivateSentinels,
  exportModels,
} from "@health-design/test-fixtures/exports";
import { effectiveNutritionFoods } from "@health-design/test-fixtures/nutrition-plan";

const planVersionId = "20000000-0000-4000-8000-000000000001";
const planOutputHash = "ab".repeat(32);
const nutrition = generateNutritionWeek({
  answers: {
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
  },
  catalog: effectiveNutritionFoods,
});

const baseConfig = {
  choices: [],
  detail: "compact",
  format: "pdf",
  includeShopping: true,
  includeWeeklyPreparation: false,
  presentation: "ingredients",
  range: { kind: "week" },
  schemaVersion: 1,
} as const satisfies ExportCreateRequestContract;

function model(config: ExportCreateRequestContract, extra: object = {}) {
  return createExportModel({
    config,
    nutrition,
    planOutputHash,
    planVersionId,
    rendererVersion: EXPORT_RENDERER_VERSION,
    ...extra,
  });
}

describe("modelo canónico de exportación", () => {
  it("mantiene versión y totales entre detalle y presentación", () => {
    const compact = model(baseConfig);
    const complete = model({ ...baseConfig, detail: "complete" });
    const preparation = model({ ...baseConfig, presentation: "preparation" });

    expect(compact.planVersionId).toBe(planVersionId);
    expect(complete.planVersionId).toBe(planVersionId);
    expect(compact.totals).toEqual(complete.totals);
    expect(compact.totals).toEqual(preparation.totals);
    expect(compact.rows).toEqual(preparation.rows);
    expect(complete.rows.length).toBe(compact.rows.length * 3);
  });

  it("aplica elecciones originales y conserva sus dos alternativas", () => {
    const config = {
      ...baseConfig,
      choices: [[0, 0, 0, 1]],
      detail: "complete",
    } as const satisfies ExportCreateRequestContract;
    const result = model(config);
    const original = nutrition.days[0]!.meals[0]!.foods[0]!;
    const expected = applyNutritionSubstitution(nutrition, {
      dayIndex: 0,
      foodIndex: 0,
      mealIndex: 0,
      substituteIndex: 0,
    });
    const firstPosition = result.rows.filter(
      ({ dayIndex, foodIndex, mealIndex }) =>
        dayIndex === 0 && mealIndex === 0 && foodIndex === 0,
    );

    expect(firstPosition.map(({ choice }) => choice)).toEqual([1, 0, 2]);
    expect(firstPosition[0]!.name).toBe(original.substitutes[0]!.name);
    expect(firstPosition[0]!.nutrients).toEqual(
      expected.days[0]!.meals[0]!.foods[0]!.nutrients,
    );
    expect(firstPosition.slice(1).map(({ name }) => name)).toEqual([
      original.name,
      original.substitutes[1]!.name,
    ]);
  });

  it("limita el intervalo y deriva compra y preparación de elecciones actuales", () => {
    const result = model({
      ...baseConfig,
      choices: [[2, 0, 0, 2]],
      includeWeeklyPreparation: true,
      range: { kind: "week" },
    });
    const day = model({
      ...baseConfig,
      includeShopping: true,
      range: { day: 3, kind: "day" },
    });

    expect(new Set(result.rows.map(({ day }) => day))).toEqual(
      new Set([1, 2, 3, 4, 5, 6, 7]),
    );
    expect(new Set(day.rows.map(({ day: number }) => number))).toEqual(new Set([3]));
    expect(result.shoppingList?.length).toBeGreaterThan(0);
    expect(result.weeklyPreparation?.length).toBe(
      new Set(
        result.rows
          .filter(({ rowKind }) => rowKind === "selected")
          .map(({ canonicalFoodKey }) => canonicalFoodKey),
      ).size,
    );
  });

  it("ordena filas establemente y descarta entradas ajenas al contrato", () => {
    const sentinel = "MEDICACION-SECRETA-NO-EXPORTAR";
    const result = model(
      { ...baseConfig, detail: "complete" },
      { medicationContext: sentinel },
    );
    const positions = result.rows.map(
      ({ choice, dayIndex, foodIndex, mealIndex, rowKind }) =>
        `${dayIndex}:${mealIndex}:${foodIndex}:${rowKind}:${choice}`,
    );

    expect(positions).toEqual(
      [...positions].sort((left, right) => {
        const leftParts = left.split(":");
        const rightParts = right.split(":");
        return (
          Number(leftParts[0]) - Number(rightParts[0]) ||
          Number(leftParts[1]) - Number(rightParts[1]) ||
          Number(leftParts[2]) - Number(rightParts[2]) ||
          (leftParts[3] === "selected" ? -1 : rightParts[3] === "selected" ? 1 : 0) ||
          Number(leftParts[4]) - Number(rightParts[4])
        );
      }),
    );
    expect(JSON.stringify(result)).not.toContain(sentinel);
  });

  it("muestra el producto aplicado sin exponer GTIN ni procedencia privada", () => {
    const serialized = JSON.stringify(exportModels.commercialProduct);

    expect(
      exportModels.commercialProduct.rows.some(
        ({ name, rowKind }) => name === commercialProductName && rowKind === "selected",
      ),
    ).toBe(true);
    for (const sentinel of commercialProductPrivateSentinels) {
      expect(serialized).not.toContain(sentinel);
    }
  });
});
