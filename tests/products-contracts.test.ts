import { describe, expect, it } from "vitest";

import {
  CommercialProductSnapshotSchema,
  ProductConfirmationAckSchema,
  ProductConfirmationRequestSchema,
  ProductNutrientValueSchema,
  ProductResolutionResponseSchema,
  type CommercialProductSnapshot,
} from "@health-design/contracts";

const known = (value: string, unit: "g" | "kcal" = "g") => ({
  state: "known" as const,
  unit,
  value,
});

const unknown = { state: "unknown" as const };

const snapshot = {
  basis: "per_100_g",
  brand: "Marca de prueba",
  gtin: {
    displayGtin: "8412345678905",
    gtin14: "08412345678905",
    symbology: "ean_13",
  },
  name: "Yogur natural",
  nutrients: {
    carbohydratesG: known("4.7"),
    clinical: {},
    energyKcal: known("63", "kcal"),
    fatG: known("3.5"),
    fiberG: unknown,
    proteinG: known("3.4"),
    saltG: known("0.1"),
    saturatedFatG: known("2.3"),
    sugarsG: known("4.7"),
  },
  safety: {
    allergens: { state: "known", values: ["milk"] },
    crossContactAllergens: { state: "known", values: [] },
    ingredients: { state: "known", values: ["Leche", "Fermentos lácticos"] },
  },
  schemaVersion: 1,
} as const satisfies CommercialProductSnapshot;

describe("contrato estructurado de producto comercial", () => {
  it("acepta una ficha cerrada sin fotografías ni campos de compra", () => {
    expect(CommercialProductSnapshotSchema.safeParse(snapshot).success).toBe(true);
    expect(
      CommercialProductSnapshotSchema.safeParse({
        ...snapshot,
        imageUrl: "https://example.test/label.jpg",
      }).success,
    ).toBe(false);
    expect(
      CommercialProductSnapshotSchema.safeParse({ ...snapshot, price: "1.99" }).success,
    ).toBe(false);
  });

  it("conserva unknown sin convertirlo en cero", () => {
    expect(ProductNutrientValueSchema.parse(unknown)).toEqual({ state: "unknown" });
    expect(
      ProductNutrientValueSchema.safeParse({ state: "unknown", value: "0" }).success,
    ).toBe(false);
  });

  it("solo acepta decimales no negativos y canónicos", () => {
    for (const value of ["0", "0.25", "12.5", "100"]) {
      expect(ProductNutrientValueSchema.safeParse(known(value)).success).toBe(true);
    }
    for (const value of ["-1", "01", "1,5", "1.0", "NaN", "Infinity", " 1"]) {
      expect(ProductNutrientValueSchema.safeParse(known(value)).success).toBe(false);
    }
  });

  it("limita a cien elementos las listas estructuradas", () => {
    const values = Array.from({ length: 101 }, (_, index) => `ingredient-${index}`);
    expect(
      CommercialProductSnapshotSchema.safeParse({
        ...snapshot,
        safety: {
          ...snapshot.safety,
          ingredients: { state: "known", values },
        },
      }).success,
    ).toBe(false);
  });

  it("separa resolución efímera de confirmación persistente", () => {
    expect(
      ProductResolutionResponseSchema.safeParse({
        completeness: "complete",
        confirmedForProfile: false,
        contentHash: "ab".repeat(32),
        gtin: snapshot.gtin,
        matching: null,
        revisionId: null,
        schemaVersion: 1,
        snapshot,
        source: "open_food_facts",
        sourceAvailability: "available",
        uncertainties: ["fiberG_unknown"],
      }).success,
    ).toBe(true);
    expect(
      ProductConfirmationRequestSchema.safeParse({
        expectedContentHash: "ab".repeat(32),
        schemaVersion: 1,
        snapshot,
      }).success,
    ).toBe(true);
    expect(
      ProductConfirmationAckSchema.safeParse({
        completeness: "complete",
        confirmationId: "10000000-0000-4000-8000-000000000001",
        confirmedAt: "2026-07-21T08:00:00.000Z",
        correctionId: null,
        productId: "20000000-0000-4000-8000-000000000001",
        reusedRevision: false,
        revisionId: "30000000-0000-4000-8000-000000000001",
        schemaVersion: 1,
        scope: "profile",
      }).success,
    ).toBe(true);
  });

  it("mantiene el formulario manual vacío como insuficiente y sin snapshot supuesto", () => {
    expect(
      ProductResolutionResponseSchema.safeParse({
        completeness: "insufficient",
        confirmedForProfile: false,
        contentHash: null,
        gtin: snapshot.gtin,
        matching: null,
        revisionId: null,
        schemaVersion: 1,
        snapshot: null,
        source: "manual_blank",
        sourceAvailability: "not_found",
        uncertainties: ["product_snapshot_missing"],
      }).success,
    ).toBe(true);
  });
});
