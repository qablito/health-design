import { describe, expect, it } from "vitest";

import {
  BEDCA_PUBLIC_GENERATOR_CORE,
  FINELI_20_GENERATOR_CORE,
  GENERATOR_FOOD_CORE,
  GENERATOR_METADATA_BY_FOOD_KEY,
  USDA_SR_LEGACY_GENERATOR_CORE,
} from "@health-design/catalog/nutrition-generator";
import { buildNutritionQuarantineBatch } from "@health-design/catalog/nutrition";
import { T17_BASKET } from "@health-design/test-fixtures/shopping";
import { buildBedcaPublicGeneratorArtifactFromSnapshot } from "../scripts/import-nutrition/bedca-public";
import { buildFineliGeneratorArtifactFromSnapshot } from "../scripts/import-nutrition/fineli";
import { buildUsdaSrLegacyGeneratorArtifactFromSnapshot } from "../scripts/import-nutrition/usda-sr-legacy";

describe("correspondencia oficial del núcleo nutricional T17", () => {
  it("resuelve las 80 identidades con fuente, código y versión oficiales", () => {
    for (const expected of T17_BASKET) {
      const actual = GENERATOR_METADATA_BY_FOOD_KEY.get(expected.canonicalFoodKey);
      expect(actual).toMatchObject({
        canonicalFoodKey: expected.canonicalFoodKey,
        ediblePart: expected.ediblePart,
        foodState: expected.foodState,
        name: expected.name,
        sourceCode: expected.sourceCode,
        sourceKey: expected.sourceKey,
      });
      expect(typeof actual?.sourceVersion).toBe("string");
    }
  });

  it("mantiene solo los ocho alimentos previos fuera de la puerta T17", () => {
    const basketKeys = new Set(
      T17_BASKET.map(({ canonicalFoodKey }) => canonicalFoodKey),
    );
    const extraKeys = GENERATOR_FOOD_CORE.map(
      ({ canonicalFoodKey }) => canonicalFoodKey,
    ).filter((key) => !basketKeys.has(key));

    expect(extraKeys).toEqual([
      "food:ciqual-20535",
      "food:ciqual-9102",
      "food:ciqual-9108",
      "food:ciqual-9119",
      "food:ciqual-17130",
      "food:ciqual-17100",
      "food:ciqual-17350",
      "food:ciqual-20280",
    ]);
    expect(GENERATOR_FOOD_CORE).toHaveLength(88);
  });

  it("normaliza un snapshot oficial Fineli sin usar los atajos erróneos del payload", async () => {
    const rawBytes = new TextEncoder().encode(
      JSON.stringify({
        apiVersion: "v1",
        components: [
          { code: "ENERC", unitOfMeasurement: { code: "KJ" } },
          { code: "FAT", unitOfMeasurement: { code: "G" } },
          { code: "CHO", unitOfMeasurement: { code: "G" } },
          { code: "PROT", unitOfMeasurement: { code: "G" } },
          { code: "FIBT", unitOfMeasurement: { code: "G" } },
          { code: "CA", unitOfMeasurement: { code: "MG" } },
        ],
        foods: [
          {
            data: [321.22, 0.756, 0, 17.25, 0, 28],
            fiber: 99,
            id: 804,
            name: { en: "Cod" },
          },
        ],
      }),
    );
    const artifact = buildFineliGeneratorArtifactFromSnapshot(
      rawBytes,
      "2026-07-21T00:00:00.000Z",
      [FINELI_20_GENERATOR_CORE[0]],
    );
    const batch = await buildNutritionQuarantineBatch(artifact);

    expect(batch.status).toBe("quarantined");
    expect(batch.revisions[0]?.nutrients).toMatchObject({
      carbohydrates: { normalizedValue: "0" },
      energy_kcal: { normalizedValue: "76.773423" },
      fiber: { normalizedValue: "0" },
      protein: { normalizedValue: "17.25" },
    });
    expect(batch.manifest.rawContentHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("normaliza los dos SR Legacy por id nutricional estable", async () => {
    const rawBytes = new TextEncoder().encode(
      JSON.stringify({
        foods: [
          {
            description: "Tofu, raw, firm, prepared with calcium sulfate",
            fdcId: 172475,
            foodNutrients: [
              [1003, 17.27, "G"],
              [1004, 8.72, "G"],
              [1005, 2.78, "G"],
              [1008, 144, "KCAL"],
              [1079, 2.3, "G"],
              [1087, 683, "MG"],
            ].map(([id, amount, unitName]) => ({
              amount,
              nutrient: { id, unitName },
            })),
          },
        ],
        release: "2018-04",
      }),
    );
    const artifact = buildUsdaSrLegacyGeneratorArtifactFromSnapshot(
      rawBytes,
      "2026-07-21T00:00:00.000Z",
      [USDA_SR_LEGACY_GENERATOR_CORE[0]],
    );
    const batch = await buildNutritionQuarantineBatch(artifact);

    expect(batch.status).toBe("quarantined");
    expect(batch.revisions[0]?.nutrients).toMatchObject({
      calcium: { normalizedValue: "683" },
      energy_kcal: { normalizedValue: "144" },
      fiber: { normalizedValue: "2.3" },
    });
  });

  it("normaliza BEDCA desde sus códigos EuroFIR y conserva el XML bruto", async () => {
    const fields = [
      ["ENERC", "823.1", "kJ"],
      ["FAT", "15.4", "g"],
      ["PROT", "12.4", "g"],
      ["CHO", "2.5", "g"],
      ["FIBT", "0", "g"],
      ["CA", "338", "mg"],
    ]
      .map(
        ([code, value, unit]) =>
          `<foodvalue><eur_name>${code}</eur_name><best_location>${value}</best_location><v_unit>${unit}</v_unit></foodvalue>`,
      )
      .join("");
    const rawBytes = new TextEncoder().encode(
      JSON.stringify({
        database: "BEDCA public",
        foods: [
          {
            id: 2507,
            xml: `<foodresponse><food><f_id>2507</f_id><f_ori_name>Queso fresco de burgos</f_ori_name>${fields}</food></foodresponse>`,
          },
        ],
      }),
    );
    const artifact = buildBedcaPublicGeneratorArtifactFromSnapshot(
      rawBytes,
      "2026-07-21T00:00:00.000Z",
      [BEDCA_PUBLIC_GENERATOR_CORE[0]],
    );
    const batch = await buildNutritionQuarantineBatch(artifact);

    expect(batch.status).toBe("quarantined");
    expect(batch.revisions[0]?.nutrients).toMatchObject({
      calcium: { normalizedValue: "338" },
      energy_kcal: { normalizedValue: "196.725621" },
      fiber: { normalizedValue: "0" },
    });
  });
});
