import { describe, expect, it } from "vitest";

import { GENERATOR_METADATA_BY_FOOD_KEY } from "@health-design/catalog/nutrition-generator";
import {
  T17_BASKET,
  T17_FIXED_BASKET,
  T17_FIXED_BASKET_KEYS,
  T17_PURCHASE_FORMS,
  T17_RESERVE_BASKET,
  T17_RESERVE_BASKET_KEYS,
} from "@health-design/test-fixtures/shopping";

const countByGroup = (items: typeof T17_FIXED_BASKET) =>
  Object.fromEntries(
    items.map(({ group }) => [
      group,
      items.filter((item) => item.group === group).length,
    ]),
  );

describe("semilla de compra T17 60 + 20", () => {
  it("fija 60 alimentos únicos, 20 de reserva y cero intersecciones", () => {
    expect(T17_FIXED_BASKET_KEYS).toHaveLength(60);
    expect(new Set(T17_FIXED_BASKET_KEYS)).toHaveProperty("size", 60);
    expect(T17_RESERVE_BASKET_KEYS).toHaveLength(20);
    expect(new Set(T17_RESERVE_BASKET_KEYS)).toHaveProperty("size", 20);
    expect(
      T17_FIXED_BASKET_KEYS.filter((key) =>
        T17_RESERVE_BASKET_KEYS.includes(
          key as (typeof T17_RESERVE_BASKET_KEYS)[number],
        ),
      ),
    ).toEqual([]);
  });

  it("conserva los grupos fijos 16/12/8/12/6/6 y clasifica la reserva", () => {
    expect(countByGroup(T17_FIXED_BASKET)).toEqual({
      carbohydrate: 12,
      dairy_alternative: 6,
      fat: 6,
      fruit: 8,
      protein: 16,
      vegetable: 12,
    });
    expect(T17_RESERVE_BASKET.every(({ group }) => group.length > 0)).toBe(true);
  });

  it("cierra estado, parte comestible y forma de compra", () => {
    expect(T17_BASKET).toHaveLength(80);
    for (const entry of T17_BASKET) {
      expect(["raw", "cooked", "unspecified"]).toContain(entry.foodState);
      expect(T17_PURCHASE_FORMS).toContain(entry.purchaseForm);
      expect(entry.ediblePart).not.toBe("");
      expect(entry.sourceCode).not.toBe("");
    }
  });

  it("demuestra el déficit exacto del catálogo efectivo actual", () => {
    const missing = T17_BASKET.filter(
      ({ canonicalFoodKey }) => !GENERATOR_METADATA_BY_FOOD_KEY.has(canonicalFoodKey),
    ).map(({ canonicalFoodKey }) => canonicalFoodKey);

    expect(missing).toEqual([]);
  });
});
