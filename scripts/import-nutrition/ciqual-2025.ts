import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

import { readSheet } from "read-excel-file/node";

import {
  CIQUAL_2025_GENERATOR_CORE,
  type GeneratorFoodMetadata,
} from "@health-design/catalog/nutrition-generator";
import {
  IMPORT_LIMITS,
  type ImportedNutrientValue,
  type NutritionImportArtifact,
  type NutritionImportRecord,
} from "@health-design/catalog/nutrition";
import { normalizeDecimal } from "@health-design/engine";

export const CIQUAL_2025_SOURCE_VERSION = "2025" as const;
export const CIQUAL_2025_WORKSHEET = "composition nutritionnelle" as const;
export const CIQUAL_2025_DOWNLOAD_URL =
  "https://entrepot.recherche.data.gouv.fr/api/access/datafile/:persistentId?persistentId=doi:10.57745/RPWYZD" as const;
export const CIQUAL_2025_EXPECTED_MD5 = "0d9758ce23f3f13dd63a005bc1bb4f2c" as const;
export const CIQUAL_2025_EXPECTED_SHA256 =
  "5555c572fa3735991298d832d0427788fa69a11b4fd20a5d580d58942369fbb0" as const;
export const CIQUAL_2025_DOWNLOAD_ACCEPT = "*/*" as const;

type ParsedCiqualValue =
  | Readonly<{ state: "known"; value: string }>
  | Readonly<{ state: "missing"; value: null }>
  | Readonly<{ originalValue: "traces"; state: "trace"; value: null }>
  | Readonly<{
      intervalMaximum: string;
      intervalMinimum: "0";
      originalValue: string;
      state: "less_than";
      value: null;
    }>;

function cellText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return String(value);
  if (value instanceof Date) return value.toISOString();
  throw new Error("ciqual_2025_invalid_cell_type");
}

export function parseCiqualValue(value: unknown): ParsedCiqualValue {
  if (value === null || value === undefined || value === "-") {
    return { state: "missing", value: null };
  }
  const original = cellText(value).trim();
  if (original.toLowerCase() === "traces") {
    return { originalValue: "traces", state: "trace", value: null };
  }
  const decoded = original.replaceAll("&lt;", "<").trim();
  const lessThan = /^<\s*(\d+(?:[.,]\d+)?)$/.exec(decoded);
  if (lessThan?.[1]) {
    return {
      intervalMaximum: normalizeDecimal(lessThan[1].replace(",", ".")),
      intervalMinimum: "0",
      originalValue: decoded,
      state: "less_than",
      value: null,
    };
  }
  const decimal = original.replace(",", ".");
  return { state: "known", value: normalizeDecimal(decimal) };
}

function digest(bytes: Uint8Array, algorithm: "md5" | "sha256"): string {
  return createHash(algorithm).update(bytes).digest("hex");
}

function assertOfficialDigest(bytes: Uint8Array): void {
  if (digest(bytes, "md5") !== CIQUAL_2025_EXPECTED_MD5) {
    throw new Error("ciqual_2025_md5_mismatch");
  }
  if (digest(bytes, "sha256") !== CIQUAL_2025_EXPECTED_SHA256) {
    throw new Error("ciqual_2025_sha256_mismatch");
  }
}

async function boundedResponseBytes(response: Response): Promise<Uint8Array> {
  if (!response.ok) throw new Error(`ciqual_2025_download_http_${response.status}`);
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > IMPORT_LIMITS.fileBytes) {
    throw new Error("ciqual_2025_file_limit_exceeded");
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error("ciqual_2025_download_body_missing");
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > IMPORT_LIMITS.fileBytes) {
      await reader.cancel();
      throw new Error("ciqual_2025_file_limit_exceeded");
    }
    chunks.push(value);
  }
  const result = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

export async function downloadCiqual2025(destination: string): Promise<{
  bytes: number;
  md5: typeof CIQUAL_2025_EXPECTED_MD5;
  sha256: typeof CIQUAL_2025_EXPECTED_SHA256;
}> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60_000);
  try {
    const response = await fetch(CIQUAL_2025_DOWNLOAD_URL, {
      headers: { accept: CIQUAL_2025_DOWNLOAD_ACCEPT },
      redirect: "follow",
      signal: controller.signal,
    });
    const bytes = await boundedResponseBytes(response);
    assertOfficialDigest(bytes);
    await writeFile(destination, bytes, { flag: "w" });
    return {
      bytes: bytes.byteLength,
      md5: CIQUAL_2025_EXPECTED_MD5,
      sha256: CIQUAL_2025_EXPECTED_SHA256,
    };
  } finally {
    clearTimeout(timeout);
  }
}

function findEndOfCentralDirectory(bytes: Uint8Array): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const minimum = Math.max(0, bytes.byteLength - 65_557);
  for (let offset = bytes.byteLength - 22; offset >= minimum; offset -= 1) {
    if (view.getUint32(offset, true) === 0x06054b50) return offset;
  }
  throw new Error("ciqual_2025_invalid_xlsx_archive");
}

function uncompressedZipBytes(bytes: Uint8Array): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocd = findEndOfCentralDirectory(bytes);
  const entries = view.getUint16(eocd + 10, true);
  let offset = view.getUint32(eocd + 16, true);
  let total = 0;
  for (let index = 0; index < entries; index += 1) {
    if (view.getUint32(offset, true) !== 0x02014b50) {
      throw new Error("ciqual_2025_invalid_central_directory");
    }
    const size = view.getUint32(offset + 24, true);
    if (size === 0xffffffff) throw new Error("ciqual_2025_zip64_not_supported");
    total += size;
    if (total > IMPORT_LIMITS.uncompressedBytes) {
      throw new Error("ciqual_2025_uncompressed_limit_exceeded");
    }
    offset +=
      46 +
      view.getUint16(offset + 28, true) +
      view.getUint16(offset + 30, true) +
      view.getUint16(offset + 32, true);
  }
  return total;
}

function normalizedHeader(value: unknown): string {
  return cellText(value).normalize("NFC").replace(/\s+/g, " ").trim();
}

const REQUIRED_HEADERS = new Map<number, string>([
  [6, "alim_code"],
  [7, "alim_nom_fr"],
  [10, "Energie, Règlement UE N° 1169 2011 (kcal 100 g)"],
  [14, "Protéines, N x facteur de Jones (g 100 g)"],
  [16, "Glucides (g 100 g)"],
  [17, "Lipides (g 100 g)"],
  [26, "Fibres alimentaires (g 100 g)"],
]);

function assertWorkbookShape(rows: readonly (readonly unknown[])[]): void {
  if (rows.length < 2 || rows.length - 1 > IMPORT_LIMITS.rowCount) {
    throw new Error("ciqual_2025_row_limit_invalid");
  }
  const header = rows[0]!;
  if (header.length > IMPORT_LIMITS.columnCount) {
    throw new Error("ciqual_2025_column_limit_exceeded");
  }
  for (const [index, expected] of REQUIRED_HEADERS) {
    if (normalizedHeader(header[index]) !== expected) {
      throw new Error(`ciqual_2025_header_mismatch_${index}`);
    }
  }
}

function maximumCellBytes(rows: readonly (readonly unknown[])[]): number {
  const encoder = new TextEncoder();
  let maximum = 0;
  for (const row of rows) {
    for (const cell of row) {
      maximum = Math.max(maximum, encoder.encode(cellText(cell)).byteLength);
      if (maximum > IMPORT_LIMITS.cellBytes) {
        throw new Error("ciqual_2025_cell_limit_exceeded");
      }
    }
  }
  return maximum;
}

const NUTRIENT_COLUMNS = {
  calcium: { column: 50, nutrientClass: "mineral", unit: "mg" },
  carbohydrates: { column: 16, nutrientClass: "carbohydrates", unit: "g" },
  energy_kcal: { column: 10, nutrientClass: "energy", unit: "kcal" },
  fat: { column: 17, nutrientClass: "total_fat", unit: "g" },
  fiber: { column: 26, nutrientClass: "fiber", unit: "g" },
  folate: { column: 79, nutrientClass: "vitamin", unit: "ug" },
  iron: { column: 53, nutrientClass: "mineral", unit: "mg" },
  iodine: { column: 54, nutrientClass: "mineral", unit: "ug" },
  magnesium: { column: 55, nutrientClass: "mineral", unit: "mg" },
  potassium: { column: 58, nutrientClass: "mineral", unit: "mg" },
  protein: { column: 14, nutrientClass: "protein", unit: "g" },
  salt: { column: 49, nutrientClass: "salt", unit: "g" },
  saturated_fat: { column: 31, nutrientClass: "saturated_fat", unit: "g" },
  selenium: { column: 59, nutrientClass: "mineral", unit: "ug" },
  sodium: { column: 60, nutrientClass: "sodium", unit: "mg" },
  sugars: { column: 18, nutrientClass: "sugars", unit: "g" },
  vitamin_b12: { column: 82, nutrientClass: "vitamin", unit: "ug" },
  vitamin_c: { column: 72, nutrientClass: "vitamin", unit: "mg" },
  zinc: { column: 61, nutrientClass: "mineral", unit: "mg" },
} as const;

const GENERATOR_REQUIRED_NUTRIENTS = new Set([
  "carbohydrates",
  "energy_kcal",
  "fat",
  "fiber",
  "protein",
]);

function knownNutrient(
  row: readonly unknown[],
  key: keyof typeof NUTRIENT_COLUMNS,
): ImportedNutrientValue | null {
  const definition = NUTRIENT_COLUMNS[key];
  const parsed = parseCiqualValue(row[definition.column]);
  if (parsed.state !== "known") {
    if (parsed.state === "trace" && GENERATOR_REQUIRED_NUTRIENTS.has(key)) {
      return {
        nutrientClass: definition.nutrientClass,
        state: "known",
        unit: definition.unit,
        value: "0",
      };
    }
    if (GENERATOR_REQUIRED_NUTRIENTS.has(key)) {
      throw new Error(`ciqual_2025_required_value_${parsed.state}_${key}`);
    }
    return null;
  }
  return {
    nutrientClass: definition.nutrientClass,
    state: "known",
    unit: definition.unit,
    value: parsed.value,
  };
}

function recordFromRow(
  row: readonly unknown[],
  metadata: GeneratorFoodMetadata,
): NutritionImportRecord {
  if (cellText(row[6]) !== metadata.sourceCode) {
    throw new Error(`ciqual_2025_code_mismatch_${metadata.sourceCode}`);
  }
  const nutrients: Record<string, ImportedNutrientValue> = {};
  for (const key of Object.keys(
    NUTRIENT_COLUMNS,
  ) as (keyof typeof NUTRIENT_COLUMNS)[]) {
    const nutrient = knownNutrient(row, key);
    if (nutrient !== null) nutrients[key] = nutrient;
  }
  return {
    aliases: [cellText(row[7]), ...metadata.aliases],
    basis: "per_100_g",
    canonicalFoodKey: metadata.canonicalFoodKey,
    category: metadata.category,
    ediblePart: metadata.ediblePart,
    foodState: metadata.foodState,
    method: "ciqual_2025_source_declared",
    name: metadata.name,
    nutrients,
    targetKind: "generic_food",
  };
}

export async function buildCiqual2025GeneratorArtifact(
  workbookPath: string,
  retrievedAt: string,
): Promise<NutritionImportArtifact> {
  const rawBuffer = await readFile(workbookPath);
  const rawBytes = new Uint8Array(rawBuffer);
  if (rawBytes.byteLength > IMPORT_LIMITS.fileBytes) {
    throw new Error("ciqual_2025_file_limit_exceeded");
  }
  assertOfficialDigest(rawBytes);
  const rows = (await readSheet(
    workbookPath,
    CIQUAL_2025_WORKSHEET,
  )) as readonly (readonly unknown[])[];
  assertWorkbookShape(rows);
  const rowsByCode = new Map(rows.slice(1).map((row) => [String(row[6]), row]));
  const records = CIQUAL_2025_GENERATOR_CORE.map((metadata) => {
    const row = rowsByCode.get(metadata.sourceCode);
    if (!row) throw new Error(`ciqual_2025_code_missing_${metadata.sourceCode}`);
    return recordFromRow(row, metadata);
  });
  return {
    envelope: {
      archiveDepth: 0,
      columnCount: rows[0]!.length,
      maximumCellBytes: maximumCellBytes(rows),
      rowCount: rows.length - 1,
      uncompressedBytes: uncompressedZipBytes(rawBytes),
    },
    licenseStatus: "approved",
    rawBytes,
    records,
    retrievedAt,
    sourceKey: "ciqual_2025",
    sourceVersion: CIQUAL_2025_SOURCE_VERSION,
    transformations: [
      "source:doi:10.57745/RPWYZD",
      "trace:required_generator_nutrients_as_zero",
      "worksheet:composition nutritionnelle",
      "decimal_comma:canonical_decimal",
      "generator_core:exact_required_values_only",
      "optional_trace_less_than:preserved_in_raw_not_activated",
      "labels:curated_spanish_v1",
    ],
  };
}
