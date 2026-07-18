import { describe, expect, it } from "vitest";

import {
  checkDecimalClosure,
  checkMassBalance,
  classifyNutrientDiscrepancy,
  intervalsOverlap,
  normalizeQuantity,
  quantitiesAreCompatible,
  roundDecimal,
  sumDecimals,
} from "../packages/engine/src/index";

describe("normalización de cantidades normativas", () => {
  it("convierte unidades con factores versionados y conserva estado y contexto", () => {
    expect(
      normalizeQuantity(
        {
          basis: "per_100_g",
          foodState: "raw",
          method: "direct_analysis",
          state: "known",
          unit: "mg",
          value: "1250.00",
        },
        "g",
      ),
    ).toEqual({
      basis: "per_100_g",
      conversionVersion: "unit-conversion-v1",
      foodState: "raw",
      method: "direct_analysis",
      original: { basis: "per_100_g", unit: "mg", value: "1250.00" },
      state: "known",
      unit: "g",
      value: "1.25",
    });
  });

  it("normaliza también el denominador antes de comparar", () => {
    expect(
      normalizeQuantity(
        {
          basis: "per_kg",
          foodState: "raw",
          state: "known",
          unit: "mg",
          value: "1250",
        },
        "g",
        "per_100_g",
      ),
    ).toMatchObject({ basis: "per_100_g", unit: "g", value: "0.125" });
  });

  it("mantiene missing como missing y nunca lo convierte en cero", () => {
    expect(
      normalizeQuantity(
        {
          basis: "per_100_g",
          foodState: "raw",
          state: "missing",
          unit: "mg",
          value: null,
        },
        "g",
      ),
    ).toMatchObject({ state: "missing", value: null });
    expect(() =>
      normalizeQuantity(
        {
          basis: "per_100_g",
          foodState: "raw",
          state: "missing",
          unit: "mg",
          value: "0",
        },
        "g",
      ),
    ).toThrow("invalid_quantity_state");
  });

  it("no mezcla bases ni estados crudo/cocinado", () => {
    const raw = {
      basis: "per_100_g" as const,
      foodState: "raw" as const,
      state: "known" as const,
      unit: "g" as const,
      value: "10",
    };
    expect(quantitiesAreCompatible(raw, { ...raw })).toBe(true);
    expect(quantitiesAreCompatible(raw, { ...raw, foodState: "cooked" })).toBe(false);
    expect(quantitiesAreCompatible(raw, { ...raw, basis: "per_serving" })).toBe(false);
  });
});

describe("precisión, cierre y presentación", () => {
  it("redondea solo cuando el caller declara escala y modo", () => {
    const internal = sumDecimals(["1.005", "0.1"]);
    expect(internal).toBe("1.105");
    expect(roundDecimal("1.005", 2, "half_away_from_zero")).toBe("1.01");
    expect(roundDecimal("-1.005", 2, "half_away_from_zero")).toBe("-1.01");
    expect(internal).toBe("1.105");
  });

  it("comprueba el cierre exacto sobre valores internos no redondeados", () => {
    expect(checkDecimalClosure(["0.1", "0.2", "0.3"], "0.6")).toBe(true);
    expect(checkDecimalClosure(["0.1", "0.2", "0.3"], "0.61")).toBe(false);
  });
});

describe("umbrales y balance de masa", () => {
  it("abre revisión solo al superar estrictamente el umbral aplicable", () => {
    expect(classifyNutrientDiscrepancy("protein", "8", "10")).toBe(
      "informative_discrepancy",
    );
    expect(classifyNutrientDiscrepancy("protein", "8", "10.001")).toBe("manual_review");
    expect(classifyNutrientDiscrepancy("total_fat", "20", "24")).toBe(
      "informative_discrepancy",
    );
    expect(classifyNutrientDiscrepancy("total_fat", "20", "24.001")).toBe(
      "manual_review",
    );
    expect(classifyNutrientDiscrepancy("vitamin", "10", "15.001")).toBe(
      "manual_review",
    );
    expect(classifyNutrientDiscrepancy("mineral", "10", "6.499")).toBe("manual_review");
  });

  it("trata valores negativos imposibles como revisión prioritaria", () => {
    expect(classifyNutrientDiscrepancy("sodium", "0.2", "-0.01")).toBe(
      "priority_review",
    );
  });

  it("no crea conflicto cuantitativo cuando los intervalos se solapan", () => {
    expect(
      intervalsOverlap(
        { maximum: "10", minimum: "8" },
        { maximum: "12", minimum: "10" },
      ),
    ).toBe(true);
    expect(
      intervalsOverlap(
        { maximum: "9.999", minimum: "8" },
        { maximum: "12", minimum: "10" },
      ),
    ).toBe(false);
  });

  it("distingue zona preferida, aceptable, prioritaria y no evaluable", () => {
    const components = {
      alcohol: "0",
      ash: "1",
      carbohydrates: "20",
      fat: "10",
      fiber: "4",
      protein: "15",
      water: "50",
    };
    expect(checkMassBalance(components)).toEqual({ status: "preferred", total: "100" });
    expect(checkMassBalance({ ...components, water: "46" })).toEqual({
      status: "acceptable",
      total: "96",
    });
    expect(checkMassBalance({ ...components, water: "44" })).toEqual({
      status: "priority_review",
      total: "94",
    });
    expect(checkMassBalance({ ...components, water: null })).toEqual({
      status: "not_evaluable",
      total: null,
    });
  });
});
