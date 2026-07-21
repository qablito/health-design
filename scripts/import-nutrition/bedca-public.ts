import { readFile } from "node:fs/promises";

import {
  BEDCA_PUBLIC_GENERATOR_CORE,
  type GeneratorFoodMetadata,
} from "@health-design/catalog/nutrition-generator";
import {
  type ImportedNutrientValue,
  type NutritionImportArtifact,
  type NutritionImportRecord,
} from "@health-design/catalog/nutrition";

import {
  kilojoulesToKilocalories,
  nutrient,
  sourceEnvelope,
  writeJsonSnapshot,
} from "./source-utils.ts";

export const BEDCA_PUBLIC_SOURCE_VERSION = "public-database" as const;
export const BEDCA_QUERY_URL = "https://www.bedca.net/bdpub/procquery.php" as const;

type BedcaSnapshot = Readonly<{
  database: "BEDCA public";
  foods: readonly Readonly<{ id: number; xml: string }>[];
}>;

function snapshot(value: unknown): BedcaSnapshot {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("bedca_snapshot_invalid");
  }
  const candidate = value as Record<string, unknown>;
  if (candidate.database !== "BEDCA public" || !Array.isArray(candidate.foods)) {
    throw new Error("bedca_snapshot_invalid");
  }
  return candidate as unknown as BedcaSnapshot;
}

function decodeXml(value: string): string {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'");
}

function tag(block: string, name: string): string | null {
  const match = new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(block);
  return match?.[1] === undefined ? null : decodeXml(match[1].trim());
}

function bedcaRows(xml: string): readonly Readonly<Record<string, string>>[] {
  const rows: Record<string, string>[] = [];
  for (const match of xml.matchAll(/<food>([\s\S]*?)<\/food>/g)) {
    const block = match[1] ?? "";
    const foodId = tag(block, "f_id") ?? "";
    const name = tag(block, "f_ori_name") ?? "";
    for (const valueMatch of block.matchAll(/<foodvalue>([\s\S]*?)<\/foodvalue>/g)) {
      const valueBlock = valueMatch[1] ?? "";
      const code = tag(valueBlock, "eur_name");
      const value = tag(valueBlock, "best_location");
      if (!code || value === null || value === "") continue;
      rows.push({
        code,
        foodId,
        name,
        unit: tag(valueBlock, "v_unit") ?? "",
        value,
      });
    }
  }
  if (rows.length === 0) throw new Error("bedca_food_rows_missing");
  return rows;
}

function record(xml: string, metadata: GeneratorFoodMetadata): NutritionImportRecord {
  const rows = bedcaRows(xml);
  if (rows.some(({ foodId }) => foodId !== metadata.sourceCode)) {
    throw new Error(`bedca_code_mismatch_${metadata.sourceCode}`);
  }
  const values = new Map(rows.map(({ code, value }) => [code, value]));
  const required = (code: string) => {
    const value = values.get(code);
    if (value === undefined) {
      throw new Error(`bedca_required_value_missing_${metadata.sourceCode}_${code}`);
    }
    return value;
  };
  const nutrients: Record<string, ImportedNutrientValue> = {
    calcium: nutrient("mineral", "mg", required("CA"), "bedca_calcium_invalid"),
    carbohydrates: nutrient(
      "carbohydrates",
      "g",
      required("CHO"),
      "bedca_carbohydrates_invalid",
    ),
    energy_kcal: {
      nutrientClass: "energy",
      state: "known",
      unit: "kcal",
      value: kilojoulesToKilocalories(required("ENERC"), "bedca_energy_invalid"),
    },
    fat: nutrient("total_fat", "g", required("FAT"), "bedca_fat_invalid"),
    fiber: nutrient("fiber", "g", required("FIBT"), "bedca_fiber_invalid"),
    protein: nutrient("protein", "g", required("PROT"), "bedca_protein_invalid"),
  };
  for (const [key, code, nutrientClass, unit] of [
    ["saturated_fat", "FASAT", "saturated_fat", "g"],
    ["sodium", "NA", "sodium", "mg"],
  ] as const) {
    const value = values.get(code);
    if (value !== undefined) {
      nutrients[key] = nutrient(nutrientClass, unit, value, `bedca_${key}_invalid`);
    }
  }
  return {
    aliases: [rows[0]?.name ?? "", ...metadata.aliases].filter(Boolean),
    basis: "per_100_g",
    canonicalFoodKey: metadata.canonicalFoodKey,
    category: metadata.category,
    ediblePart: metadata.ediblePart,
    foodState: metadata.foodState,
    method: "bedca_public_source_declared",
    name: metadata.name,
    nutrients,
    targetKind: "generic_food",
  };
}

export function buildBedcaPublicGeneratorArtifactFromSnapshot(
  rawBytes: Uint8Array,
  retrievedAt: string,
  core: readonly GeneratorFoodMetadata[] = BEDCA_PUBLIC_GENERATOR_CORE,
): NutritionImportArtifact {
  const parsed = snapshot(JSON.parse(new TextDecoder().decode(rawBytes)) as unknown);
  const foodsById = new Map(parsed.foods.map((food) => [String(food.id), food]));
  const rows = parsed.foods.flatMap(({ xml }) => bedcaRows(xml));
  const records = core.map((metadata) => {
    const food = foodsById.get(metadata.sourceCode);
    if (!food) throw new Error(`bedca_food_missing_${metadata.sourceCode}`);
    return record(food.xml, metadata);
  });
  return {
    envelope: sourceEnvelope(
      rawBytes,
      rows.length,
      6,
      rows.flatMap(({ code, foodId, name, unit, value }) => [
        code,
        foodId,
        name,
        unit,
        value,
      ]),
    ),
    licenseStatus: "approved",
    rawBytes,
    records,
    retrievedAt,
    sourceKey: "bedca_public",
    sourceVersion: BEDCA_PUBLIC_SOURCE_VERSION,
    transformations: [
      "source:bedca-public-query",
      "selection:t17-generator-core-only",
      "nutrients:joined_by_eurofir_code",
      "energy:kJ_div_4.184_to_kcal_6dp",
      "labels:curated_spanish_v1",
    ],
  };
}

export async function buildBedcaPublicGeneratorArtifact(
  snapshotPath: string,
  retrievedAt: string,
): Promise<NutritionImportArtifact> {
  return buildBedcaPublicGeneratorArtifactFromSnapshot(
    new Uint8Array(await readFile(snapshotPath)),
    retrievedAt,
  );
}

function query(foodId: string): string {
  const attributes = [
    "f_id",
    "f_ori_name",
    "f_eng_name",
    "f_origen",
    "eur_name",
    "best_location",
    "v_unit",
  ]
    .map((name) => `<atribute name="${name}"/>`)
    .join("");
  return `<?xml version="1.0" encoding="utf-8"?><foodquery><type level="2"/><selection>${attributes}</selection><condition><cond1><atribute1 name="f_id"/></cond1><relation type="EQUAL"/><cond3>${foodId}</cond3></condition><condition><cond1><atribute1 name="publico"/></cond1><relation type="EQUAL"/><cond3>1</cond3></condition><order ordtype="ASC"><atribute3 name="componentgroup_id"/></order></foodquery>`;
}

export async function downloadBedcaPublicGeneratorSnapshot(
  destination: string,
): Promise<{ bytes: number; foods: number; sourceVersion: string }> {
  const foods = [];
  for (const { sourceCode } of BEDCA_PUBLIC_GENERATOR_CORE) {
    const response = await fetch(BEDCA_QUERY_URL, {
      body: query(sourceCode),
      headers: { "content-type": "text/xml" },
      method: "POST",
    });
    if (!response.ok) throw new Error(`bedca_download_http_${response.status}`);
    const xml = await response.text();
    if (new TextEncoder().encode(xml).byteLength > 2 * 1_024 * 1_024) {
      throw new Error(`bedca_food_${sourceCode}_file_limit_exceeded`);
    }
    bedcaRows(xml);
    foods.push({ id: Number(sourceCode), xml });
  }
  return {
    bytes: await writeJsonSnapshot(destination, {
      database: "BEDCA public",
      foods,
    }),
    foods: foods.length,
    sourceVersion: BEDCA_PUBLIC_SOURCE_VERSION,
  };
}
