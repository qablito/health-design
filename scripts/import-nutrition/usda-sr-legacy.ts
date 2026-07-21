import { readFile } from "node:fs/promises";

import {
  USDA_SR_LEGACY_GENERATOR_CORE,
  type GeneratorFoodMetadata,
} from "@health-design/catalog/nutrition-generator";
import {
  type ImportedNutrientValue,
  type NutritionImportArtifact,
  type NutritionImportRecord,
} from "@health-design/catalog/nutrition";

import {
  boundedJson,
  nutrient,
  sourceEnvelope,
  writeJsonSnapshot,
} from "./source-utils.ts";

export const USDA_SR_LEGACY_SOURCE_VERSION = "2018-04" as const;
export const USDA_FOOD_URL = "https://api.nal.usda.gov/fdc/v1/food" as const;

type UsdaNutrient = Readonly<{
  amount?: unknown;
  nutrient?: Readonly<{ id?: number; unitName?: string }>;
}>;

type UsdaFood = Readonly<{
  description?: string;
  fdcId: number;
  foodNutrients: readonly UsdaNutrient[];
}>;

type UsdaSnapshot = Readonly<{
  foods: readonly UsdaFood[];
  release: typeof USDA_SR_LEGACY_SOURCE_VERSION;
}>;

function snapshot(value: unknown): UsdaSnapshot {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("usda_sr_snapshot_invalid");
  }
  const candidate = value as Record<string, unknown>;
  if (
    candidate.release !== USDA_SR_LEGACY_SOURCE_VERSION ||
    !Array.isArray(candidate.foods)
  ) {
    throw new Error("usda_sr_snapshot_invalid");
  }
  return candidate as unknown as UsdaSnapshot;
}

function record(
  food: UsdaFood,
  metadata: GeneratorFoodMetadata,
): NutritionImportRecord {
  if (String(food.fdcId) !== metadata.sourceCode) {
    throw new Error(`usda_sr_code_mismatch_${metadata.sourceCode}`);
  }
  const values = new Map(
    food.foodNutrients.flatMap((entry) =>
      typeof entry.nutrient?.id === "number" && entry.amount !== undefined
        ? [[entry.nutrient.id, entry.amount] as const]
        : [],
    ),
  );
  const required = (id: number) => {
    const value = values.get(id);
    if (value === undefined) {
      throw new Error(`usda_sr_required_value_missing_${food.fdcId}_${id}`);
    }
    return value;
  };
  const nutrients: Record<string, ImportedNutrientValue> = {
    calcium: nutrient("mineral", "mg", required(1087), "usda_sr_calcium_invalid"),
    carbohydrates: nutrient(
      "carbohydrates",
      "g",
      required(1005),
      "usda_sr_carbohydrates_invalid",
    ),
    energy_kcal: nutrient("energy", "kcal", required(1008), "usda_sr_energy_invalid"),
    fat: nutrient("total_fat", "g", required(1004), "usda_sr_fat_invalid"),
    fiber: nutrient("fiber", "g", required(1079), "usda_sr_fiber_invalid"),
    protein: nutrient("protein", "g", required(1003), "usda_sr_protein_invalid"),
  };
  for (const [key, id, nutrientClass, unit] of [
    ["saturated_fat", 1258, "saturated_fat", "g"],
    ["sodium", 1093, "sodium", "mg"],
    ["sugars", 2000, "sugars", "g"],
  ] as const) {
    const value = values.get(id);
    if (value !== undefined) {
      nutrients[key] = nutrient(nutrientClass, unit, value, `usda_sr_${key}_invalid`);
    }
  }
  return {
    aliases: [food.description ?? "", ...metadata.aliases].filter(Boolean),
    basis: "per_100_g",
    canonicalFoodKey: metadata.canonicalFoodKey,
    category: metadata.category,
    ediblePart: metadata.ediblePart,
    foodState: metadata.foodState,
    method: "usda_sr_legacy_source_declared",
    name: metadata.name,
    nutrients,
    targetKind: "generic_food",
  };
}

export function buildUsdaSrLegacyGeneratorArtifactFromSnapshot(
  rawBytes: Uint8Array,
  retrievedAt: string,
  core: readonly GeneratorFoodMetadata[] = USDA_SR_LEGACY_GENERATOR_CORE,
): NutritionImportArtifact {
  const parsed = snapshot(JSON.parse(new TextDecoder().decode(rawBytes)) as unknown);
  const foodsById = new Map(parsed.foods.map((food) => [String(food.fdcId), food]));
  const records = core.map((metadata) => {
    const food = foodsById.get(metadata.sourceCode);
    if (!food) throw new Error(`usda_sr_food_missing_${metadata.sourceCode}`);
    return record(food, metadata);
  });
  return {
    envelope: sourceEnvelope(
      rawBytes,
      parsed.foods.length,
      6,
      parsed.foods.flatMap(({ description, fdcId, foodNutrients }) => [
        fdcId,
        description,
        ...foodNutrients.flatMap(({ amount, nutrient: definition }) => [
          definition?.id,
          amount,
        ]),
      ]),
    ),
    licenseStatus: "approved",
    rawBytes,
    records,
    retrievedAt,
    sourceKey: "usda_sr_legacy",
    sourceVersion: USDA_SR_LEGACY_SOURCE_VERSION,
    transformations: [
      "source:fooddata-central-api",
      "dataset:sr-legacy-final-release-2018-04",
      "selection:t17-generator-core-only",
      "nutrients:joined_by_usda_nutrient_id",
      "labels:curated_spanish_v1",
    ],
  };
}

export async function buildUsdaSrLegacyGeneratorArtifact(
  snapshotPath: string,
  retrievedAt: string,
): Promise<NutritionImportArtifact> {
  return buildUsdaSrLegacyGeneratorArtifactFromSnapshot(
    new Uint8Array(await readFile(snapshotPath)),
    retrievedAt,
  );
}

export async function downloadUsdaSrLegacyGeneratorSnapshot(
  destination: string,
  apiKey = "DEMO_KEY",
): Promise<{ bytes: number; foods: number; sourceVersion: string }> {
  const foods = await Promise.all(
    USDA_SR_LEGACY_GENERATOR_CORE.map(async ({ sourceCode }) =>
      boundedJson(
        await fetch(
          `${USDA_FOOD_URL}/${sourceCode}?format=full&api_key=${encodeURIComponent(apiKey)}`,
        ),
        `usda_sr_food_${sourceCode}_download`,
      ),
    ),
  );
  return {
    bytes: await writeJsonSnapshot(destination, {
      foods,
      release: USDA_SR_LEGACY_SOURCE_VERSION,
    }),
    foods: foods.length,
    sourceVersion: USDA_SR_LEGACY_SOURCE_VERSION,
  };
}
