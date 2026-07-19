import type {
  NutritionImportArtifact,
  NutritionImportRecord,
} from "@health-design/catalog/nutrition";

const encoder = new TextEncoder();

function artifact(
  sourceKey: NutritionImportArtifact["sourceKey"],
  records: readonly NutritionImportRecord[],
  transformations = [`fixture:${sourceKey}:v1`],
): NutritionImportArtifact {
  const raw = JSON.stringify({ records, sourceKey });
  return {
    envelope: {
      archiveDepth: 0,
      columnCount: 18,
      maximumCellBytes: 128,
      rowCount: records.length,
      uncompressedBytes: encoder.encode(raw).byteLength,
    },
    licenseStatus: "approved",
    rawBytes: encoder.encode(raw),
    records,
    retrievedAt: "2026-07-19T00:00:00.000Z",
    sourceKey,
    sourceVersion: `${sourceKey}-fixture-1`,
    transformations,
  };
}

const oatsBase = {
  aliases: ["copos de avena"],
  basis: "per_100_g" as const,
  canonicalFoodKey: "food:oat-flakes",
  category: "cereals",
  ediblePart: "whole_edible_product",
  foodState: "raw" as const,
  method: "source_declared",
  name: "Copos de avena",
  targetKind: "generic_food" as const,
};

export const ciqualOatsArtifact = artifact("ciqual_2025", [
  {
    ...oatsBase,
    nutrients: {
      carbohydrates: {
        nutrientClass: "carbohydrates",
        state: "known",
        unit: "g",
        value: "59",
      },
      fat: { nutrientClass: "total_fat", state: "known", unit: "g", value: "7" },
      fiber: { nutrientClass: "fiber", state: "missing", unit: "g", value: null },
      protein: { nutrientClass: "protein", state: "known", unit: "g", value: "13" },
    },
  },
]);

export const blsOatsArtifact = artifact("bls_4_0", [
  {
    ...oatsBase,
    nutrients: {
      fiber: { nutrientClass: "fiber", state: "known", unit: "g", value: "10" },
      protein: { nutrientClass: "protein", state: "known", unit: "g", value: "13.4" },
    },
  },
]);

export const fineliOatsArtifact = artifact("fineli", [
  {
    ...oatsBase,
    nutrients: {
      fiber: { nutrientClass: "fiber", state: "known", unit: "g", value: "11" },
    },
  },
]);

export const cookedOatsArtifact = artifact("livsmedelsverket", [
  {
    ...oatsBase,
    ediblePart: "prepared_porridge",
    foodState: "cooked",
    nutrients: {
      protein: { nutrientClass: "protein", state: "known", unit: "g", value: "4" },
    },
  },
]);

export const conflictingUsdaOatsArtifact = artifact("usda_foundation", [
  {
    ...oatsBase,
    nutrients: {
      protein: { nutrientClass: "protein", state: "known", unit: "g", value: "20" },
    },
  },
]);

export const commercialLabelArtifact = artifact("ciqual_2025", [
  {
    ...oatsBase,
    gtin: "08412345678901",
    nutrients: {
      protein: { nutrientClass: "protein", state: "known", unit: "g", value: "12" },
    },
    targetKind: "commercial_product",
  },
]);

export function withTransformations(
  source: NutritionImportArtifact,
  transformations: readonly string[],
): NutritionImportArtifact {
  return { ...source, transformations };
}

export function withRawSuffix(
  source: NutritionImportArtifact,
  suffix: string,
): NutritionImportArtifact {
  const suffixBytes = encoder.encode(suffix);
  const rawBytes = new Uint8Array(source.rawBytes.byteLength + suffixBytes.byteLength);
  rawBytes.set(source.rawBytes);
  rawBytes.set(suffixBytes, source.rawBytes.byteLength);
  return {
    ...source,
    envelope: {
      ...source.envelope,
      uncompressedBytes: rawBytes.byteLength,
    },
    rawBytes,
  };
}
