import { readFile } from "node:fs/promises";

import {
  FINELI_20_GENERATOR_CORE,
  type GeneratorFoodMetadata,
} from "@health-design/catalog/nutrition-generator";
import {
  type ImportedNutrientValue,
  type NutritionImportArtifact,
  type NutritionImportRecord,
} from "@health-design/catalog/nutrition";

import {
  boundedJson,
  kilojoulesToKilocalories,
  nutrient,
  sourceEnvelope,
  writeJsonSnapshot,
} from "./source-utils.ts";

export const FINELI_API_VERSION = "v1" as const;
export const FINELI_SOURCE_VERSION = "20.0" as const;
export const FINELI_COMPONENTS_URL =
  "https://fineli.fi/fineli/api/v1/components" as const;
export const FINELI_FOOD_URL = "https://fineli.fi/fineli/api/v1/foods" as const;

type FineliComponent = Readonly<{
  code: string;
  unitOfMeasurement?: Readonly<{ code?: string }>;
}>;

type FineliFood = Readonly<{
  data: readonly unknown[];
  id: number;
  name?: Readonly<{ en?: string }>;
}>;

type FineliSnapshot = Readonly<{
  apiVersion: typeof FINELI_API_VERSION;
  components: readonly FineliComponent[];
  foods: readonly FineliFood[];
}>;

function snapshot(value: unknown): FineliSnapshot {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("fineli_snapshot_invalid");
  }
  const candidate = value as Record<string, unknown>;
  if (
    candidate.apiVersion !== FINELI_API_VERSION ||
    !Array.isArray(candidate.components) ||
    !Array.isArray(candidate.foods)
  ) {
    throw new Error("fineli_snapshot_invalid");
  }
  return candidate as unknown as FineliSnapshot;
}

function record(
  food: FineliFood,
  components: readonly FineliComponent[],
  metadata: GeneratorFoodMetadata,
): NutritionImportRecord {
  if (String(food.id) !== metadata.sourceCode) {
    throw new Error(`fineli_code_mismatch_${metadata.sourceCode}`);
  }
  if (food.data.length !== components.length) {
    throw new Error(`fineli_component_alignment_invalid_${food.id}`);
  }
  const valueByCode = new Map(
    components.map(({ code }, index) => [code, food.data[index]]),
  );
  const required = (code: string) => {
    const value = valueByCode.get(code);
    if (value === null || value === undefined) {
      throw new Error(`fineli_required_value_missing_${food.id}_${code}`);
    }
    return value;
  };
  const nutrients: Record<string, ImportedNutrientValue> = {
    calcium: nutrient("mineral", "mg", required("CA"), "fineli_calcium_invalid"),
    carbohydrates: nutrient(
      "carbohydrates",
      "g",
      required("CHO"),
      "fineli_carbohydrates_invalid",
    ),
    energy_kcal: {
      nutrientClass: "energy",
      state: "known",
      unit: "kcal",
      value: kilojoulesToKilocalories(required("ENERC"), "fineli_energy_invalid"),
    },
    fat: nutrient("total_fat", "g", required("FAT"), "fineli_fat_invalid"),
    fiber: nutrient("fiber", "g", required("FIBT"), "fineli_fiber_invalid"),
    protein: nutrient("protein", "g", required("PROT"), "fineli_protein_invalid"),
  };
  const optional = [
    ["saturated_fat", "FASAT", "saturated_fat", "g"],
    ["sodium", "NA", "sodium", "mg"],
    ["sugars", "SUGAR", "sugars", "g"],
  ] as const;
  for (const [key, code, nutrientClass, unit] of optional) {
    const value = valueByCode.get(code);
    if (value !== null && value !== undefined) {
      nutrients[key] = nutrient(nutrientClass, unit, value, `fineli_${key}_invalid`);
    }
  }
  return {
    aliases: [food.name?.en ?? "", ...metadata.aliases].filter(Boolean),
    basis: "per_100_g",
    canonicalFoodKey: metadata.canonicalFoodKey,
    category: metadata.category,
    ediblePart: metadata.ediblePart,
    foodState: metadata.foodState,
    method: "fineli_api_source_declared",
    name: metadata.name,
    nutrients,
    targetKind: "generic_food",
  };
}

export function buildFineliGeneratorArtifactFromSnapshot(
  rawBytes: Uint8Array,
  retrievedAt: string,
  core: readonly GeneratorFoodMetadata[] = FINELI_20_GENERATOR_CORE,
): NutritionImportArtifact {
  const parsed = snapshot(JSON.parse(new TextDecoder().decode(rawBytes)) as unknown);
  const foodsById = new Map(parsed.foods.map((food) => [String(food.id), food]));
  const records = core.map((metadata) => {
    const food = foodsById.get(metadata.sourceCode);
    if (!food) throw new Error(`fineli_food_missing_${metadata.sourceCode}`);
    return record(food, parsed.components, metadata);
  });
  return {
    envelope: sourceEnvelope(rawBytes, parsed.foods.length, parsed.components.length, [
      ...parsed.components.map(({ code }) => code),
      ...parsed.foods.flatMap(({ data, id }) => [id, ...data]),
    ]),
    licenseStatus: "approved",
    rawBytes,
    records,
    retrievedAt,
    sourceKey: "fineli",
    sourceVersion: FINELI_SOURCE_VERSION,
    transformations: [
      "source:fineli-api-v1",
      "selection:t17-generator-core-only",
      "energy:kJ_div_4.184_to_kcal_6dp",
      "components:positionally_joined_by_official_component_list",
      "labels:curated_spanish_v1",
    ],
  };
}

export async function buildFineliGeneratorArtifact(
  snapshotPath: string,
  retrievedAt: string,
): Promise<NutritionImportArtifact> {
  return buildFineliGeneratorArtifactFromSnapshot(
    new Uint8Array(await readFile(snapshotPath)),
    retrievedAt,
  );
}

export async function downloadFineliGeneratorSnapshot(
  destination: string,
): Promise<{ bytes: number; foods: number; sourceVersion: string }> {
  const components = await boundedJson(
    await fetch(FINELI_COMPONENTS_URL),
    "fineli_components_download",
  );
  if (!Array.isArray(components)) throw new Error("fineli_components_invalid");
  const foods: unknown[] = [];
  for (let offset = 0; offset < FINELI_20_GENERATOR_CORE.length; offset += 4) {
    const entries = FINELI_20_GENERATOR_CORE.slice(offset, offset + 4);
    foods.push(
      ...(await Promise.all(
        entries.map(async ({ sourceCode }) =>
          boundedJson(
            await fetch(`${FINELI_FOOD_URL}/${sourceCode}`),
            `fineli_food_${sourceCode}_download`,
          ),
        ),
      )),
    );
  }
  return {
    bytes: await writeJsonSnapshot(destination, {
      apiVersion: FINELI_API_VERSION,
      components,
      foods,
    }),
    foods: foods.length,
    sourceVersion: FINELI_SOURCE_VERSION,
  };
}
