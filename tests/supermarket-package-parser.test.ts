import { describe, expect, it } from "vitest";

import {
  confirmEquivalentEdibleMass,
  normalizePackagePrice,
  packageSupportsShoppingGrams,
  parseSupermarketPackage,
} from "@health-design/catalog/supermarkets";

describe("parser determinista de envases T17", () => {
  it.each([
    ["500 g", { dimension: "mass", quantity: "500", unit: "g" }],
    ["1 kg", { dimension: "mass", quantity: "1000", unit: "g" }],
    ["750 ml", { dimension: "volume", quantity: "750", unit: "ml" }],
    ["6 x 1,5 L", { dimension: "volume", quantity: "9000", unit: "ml" }],
    ["6 x 1.5 l", { dimension: "volume", quantity: "9000", unit: "ml" }],
    ["12 unidades", { dimension: "count", quantity: "12", unit: "unit" }],
  ])("normaliza %s sin usar conversiones implícitas", (text, saleMeasure) => {
    expect(parseSupermarketPackage(text)).toEqual({
      package: {
        equivalenceEvidenceRef: null,
        equivalentEdibleMassG: null,
        saleMeasure,
      },
      reasons: [],
      status: "confirmed",
    });
  });

  it.each([
    ["peso variable", "variable_weight"],
    ["500-700 g", "range"],
    ["2x1 promoción", "promotion"],
    ["formato familiar", "ambiguous"],
  ])("envía %s a revisión", (text, reason) => {
    expect(parseSupermarketPackage(text)).toEqual({
      package: null,
      reasons: [reason],
      status: "review",
    });
  });

  it("mantiene separadas masa, volumen y unidades", () => {
    const mass = parseSupermarketPackage("500 g");
    const volume = parseSupermarketPackage("750 ml");
    const count = parseSupermarketPackage("12 unidades");
    if (mass.package === null || volume.package === null || count.package === null) {
      throw new Error("fixture_package_missing");
    }

    expect(normalizePackagePrice("3.25", mass.package)).toEqual({
      dimension: "mass",
      unit: "EUR/kg",
      value: "6.5",
    });
    expect(normalizePackagePrice("1.5", volume.package)).toEqual({
      dimension: "volume",
      unit: "EUR/L",
      value: "2",
    });
    expect(normalizePackagePrice("3.6", count.package)).toEqual({
      dimension: "count",
      unit: "EUR/unit",
      value: "0.3",
    });
    expect(packageSupportsShoppingGrams(mass.package)).toBe(true);
    expect(packageSupportsShoppingGrams(volume.package)).toBe(false);
    expect(packageSupportsShoppingGrams(count.package)).toBe(false);
  });

  it("solo habilita volumen o unidades con equivalencia confirmada y evidencia", () => {
    const parsed = parseSupermarketPackage("750 ml");
    if (parsed.package === null) throw new Error("fixture_package_missing");
    const confirmed = confirmEquivalentEdibleMass(
      parsed.package,
      "720",
      "Etiqueta revisada 2026-07-21",
    );

    expect(packageSupportsShoppingGrams(confirmed)).toBe(true);
    expect(confirmed.equivalentEdibleMassG).toBe("720");
    expect(confirmed.equivalenceEvidenceRef).toBe("Etiqueta revisada 2026-07-21");
    expect(() => confirmEquivalentEdibleMass(parsed.package!, "0", "Etiqueta")).toThrow(
      "invalid_equivalent_edible_mass",
    );
    expect(() => confirmEquivalentEdibleMass(parsed.package!, "720", " ")).toThrow(
      "invalid_equivalence_evidence",
    );
  });

  it.each(["0", "-1", "NaN", "Infinity", "1,2", "01"])(
    "rechaza el precio no canónico %s",
    (price) => {
      const parsed = parseSupermarketPackage("500 g");
      if (parsed.package === null) throw new Error("fixture_package_missing");
      expect(() => normalizePackagePrice(price, parsed.package!)).toThrow(
        "invalid_base_price",
      );
    },
  );
});
