import { describe, expect, it } from "vitest";

import type { CommercialProductSnapshot } from "@health-design/contracts";
import {
  classifyCommercialProductCompleteness,
  commercialProductSnapshotContentHash,
  evaluateCommercialProductSnapshotCoherence,
  normalizeProductGtin,
  resolveCommercialProductCandidate,
  validateCommercialProductSnapshotLimits,
} from "@health-design/catalog/products";

const known = (value: string, unit: "g" | "kcal" = "g") => ({
  state: "known" as const,
  unit,
  value,
});
const unknown = { state: "unknown" as const };

function productSnapshot(
  nutrients: Partial<CommercialProductSnapshot["nutrients"]> = {},
): CommercialProductSnapshot {
  return {
    basis: "per_100_g",
    density: { state: "unknown" },
    gtin: normalizeProductGtin({ code: "8412345678905", symbology: "ean_13" }),
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
      ...nutrients,
    },
    safety: {
      allergens: { state: "known", values: ["milk"] },
      crossContactAllergens: { state: "known", values: [] },
      ingredients: { state: "known", values: ["Leche", "Fermentos lácticos"] },
    },
    schemaVersion: 1,
  };
}

describe("identidad GTIN", () => {
  it.each([
    ["ean_8", "96385074", "00000096385074"],
    ["ean_13", "8412345678905", "08412345678905"],
    ["upc_a", "012345000058", "00012345000058"],
    ["upc_e", "01234558", "00012345000058"],
    ["itf_14", "08412345678905", "08412345678905"],
  ] as const)(
    "normaliza %s sin perder el código visible",
    (symbology, code, gtin14) => {
      expect(normalizeProductGtin({ code, symbology })).toEqual({
        displayGtin: code,
        gtin14,
        symbology,
      });
    },
  );

  it.each([
    ["ean_13", "8412345678907"],
    ["ean_13", "84123 45678905"],
    ["ean_13", "841234567890A"],
    ["ean_8", "8412345678905"],
    ["upc_e", "21234558"],
  ] as const)("rechaza %s inválido: %s", (symbology, code) => {
    expect(() => normalizeProductGtin({ code, symbology })).toThrow("invalid_gtin");
  });

  it("solo elimina espacio exterior", () => {
    expect(
      normalizeProductGtin({ code: "  8412345678905  ", symbology: "ean_13" }),
    ).toEqual({
      displayGtin: "8412345678905",
      gtin14: "08412345678905",
      symbology: "ean_13",
    });
  });
});

describe("ficha comercial determinista", () => {
  it("calcula el mismo hash para claves en distinto orden", async () => {
    const original = productSnapshot();
    const reordered = {
      ...original,
      nutrients: Object.fromEntries(Object.entries(original.nutrients).reverse()),
    } as CommercialProductSnapshot;
    await expect(commercialProductSnapshotContentHash(original)).resolves.toBe(
      await commercialProductSnapshotContentHash(reordered),
    );
  });

  it("clasifica complete, provisional e insufficient sin inventar ceros", () => {
    expect(classifyCommercialProductCompleteness(productSnapshot())).toEqual({
      completeness: "complete",
      uncertainties: ["fiberG_unknown"],
    });
    expect(
      classifyCommercialProductCompleteness(
        productSnapshot({ saturatedFatG: unknown }),
      ),
    ).toEqual({
      completeness: "provisional",
      uncertainties: ["fiberG_unknown", "saturatedFatG_unknown"],
    });
    expect(
      classifyCommercialProductCompleteness(productSnapshot({ proteinG: unknown })),
    ).toEqual({
      completeness: "insufficient",
      uncertainties: ["fiberG_unknown", "proteinG_unknown"],
    });
  });

  it("detecta incoherencias físicas inequívocas sin evaluar datos ausentes", () => {
    expect(evaluateCommercialProductSnapshotCoherence(productSnapshot())).toEqual({
      findings: [],
      status: "valid",
    });
    expect(
      evaluateCommercialProductSnapshotCoherence(
        productSnapshot({
          carbohydratesG: known("80"),
          fatG: known("30"),
          fiberG: known("10"),
          proteinG: known("20"),
        }),
      ),
    ).toEqual({
      findings: ["mass_balance_exceeds_105"],
      status: "priority_review",
    });
    expect(
      evaluateCommercialProductSnapshotCoherence(
        productSnapshot({ energyKcal: known("0", "kcal"), proteinG: known("3") }),
      ).findings,
    ).toContain("zero_energy_with_energy_bearing_nutrients");
    expect(
      evaluateCommercialProductSnapshotCoherence(
        productSnapshot({ saturatedFatG: known("4"), fatG: known("3") }),
      ).findings,
    ).toContain("saturated_fat_exceeds_total_fat");
  });

  it("eleva a insufficient un dato de seguridad requerido por el perfil", () => {
    const candidate = {
      ...productSnapshot(),
      safety: { ...productSnapshot().safety, allergens: unknown },
    };
    expect(
      classifyCommercialProductCompleteness(candidate, {
        requiredSafetyFields: ["allergens"],
      }).completeness,
    ).toBe("insufficient");
  });

  it("impone límites de grafemas, profundidad, campos y bytes", () => {
    expect(validateCommercialProductSnapshotLimits(productSnapshot())).toEqual({
      valid: true,
      violations: [],
    });
    expect(
      validateCommercialProductSnapshotLimits({
        ...productSnapshot(),
        name: "👩🏽‍⚕️".repeat(201),
      }).violations,
    ).toContain("name_graphemes_limit");
    expect(
      validateCommercialProductSnapshotLimits({
        ...productSnapshot(),
        extra: "x".repeat(70_000),
      }).violations,
    ).toContain("snapshot_bytes_limit");

    const tooManyFields = Object.fromEntries(
      Array.from({ length: 101 }, (_, index) => [`field${index}`, index]),
    );
    expect(
      validateCommercialProductSnapshotLimits({
        ...productSnapshot(),
        extra: tooManyFields,
      }).violations,
    ).toContain("snapshot_fields_limit");

    let tooDeep: unknown = "end";
    for (let index = 0; index < 13; index++) tooDeep = { nested: tooDeep };
    expect(
      validateCommercialProductSnapshotLimits({
        ...productSnapshot(),
        extra: tooDeep,
      }).violations,
    ).toContain("snapshot_depth_limit");

    expect(
      validateCommercialProductSnapshotLimits({
        ...productSnapshot(),
        extra: Array.from({ length: 101 }, () => "item"),
      }).violations,
    ).toContain("snapshot_list_limit");
  });

  it("resuelve por precedencia sin promediar ni mezclar fichas", () => {
    const resolved = resolveCommercialProductCandidate([
      { id: "off", snapshot: productSnapshot(), source: "open_food_facts" },
      { id: "global", snapshot: productSnapshot(), source: "global" },
      { id: "profile", snapshot: productSnapshot(), source: "profile" },
      { id: "label", snapshot: productSnapshot(), source: "confirmed_label" },
    ]);
    expect(resolved?.id).toBe("profile");
    expect(resolveCommercialProductCandidate([])).toBeNull();
  });
});
