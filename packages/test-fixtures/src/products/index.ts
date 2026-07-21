import type { CommercialProductSnapshot } from "@health-design/contracts";

const known = (value: string, unit: "g" | "kcal" = "g") => ({
  state: "known" as const,
  unit,
  value,
});

export const COMMERCIAL_PRODUCT_FIXTURE = {
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
    fiberG: { state: "unknown" },
    proteinG: known("3.4"),
    saltG: known("0.1"),
    saturatedFatG: known("2.3"),
    sugarsG: known("4.7"),
  },
  package: { amount: "500", description: "Pack de cuatro unidades", unit: "g" },
  safety: {
    allergens: { state: "known", values: ["milk"] },
    crossContactAllergens: { state: "known", values: [] },
    ingredients: { state: "known", values: ["Leche", "Fermentos lácticos"] },
  },
  schemaVersion: 1,
} as const satisfies CommercialProductSnapshot;
