import { writeFile } from "node:fs/promises";

import {
  IMPORT_LIMITS,
  type ImportedNutrientValue,
  type NutritionImportEnvelope,
} from "@health-design/catalog/nutrition";
import { normalizeDecimal } from "@health-design/engine";

export function decimal(value: unknown, error: string): string {
  if (typeof value !== "number" && typeof value !== "string") {
    throw new Error(error);
  }
  const normalized = String(value).trim().replace(",", ".");
  if (normalized === "" || !Number.isFinite(Number(normalized))) {
    throw new Error(error);
  }
  return normalizeDecimal(normalized);
}

export function kilojoulesToKilocalories(value: unknown, error: string): string {
  const kilojoules = Number(decimal(value, error));
  return normalizeDecimal((kilojoules / 4.184).toFixed(6));
}

export function nutrient(
  nutrientClass: ImportedNutrientValue["nutrientClass"],
  unit: ImportedNutrientValue["unit"],
  value: unknown,
  error: string,
): ImportedNutrientValue {
  return {
    nutrientClass,
    state: "known",
    unit,
    value: decimal(value, error),
  };
}

export function sourceEnvelope(
  rawBytes: Uint8Array,
  rowCount: number,
  columnCount: number,
  cells: readonly unknown[],
): NutritionImportEnvelope {
  const encoder = new TextEncoder();
  const cellText = (cell: unknown): string => {
    if (cell === null || cell === undefined) return "";
    if (
      typeof cell === "string" ||
      typeof cell === "number" ||
      typeof cell === "boolean"
    ) {
      return String(cell);
    }
    throw new Error("nutrition_source_cell_type_invalid");
  };
  const maximumCellBytes = cells.reduce<number>(
    (maximum, cell) => Math.max(maximum, encoder.encode(cellText(cell)).byteLength),
    0,
  );
  if (rawBytes.byteLength > IMPORT_LIMITS.fileBytes) {
    throw new Error("nutrition_source_file_limit_exceeded");
  }
  if (rowCount > IMPORT_LIMITS.rowCount) {
    throw new Error("nutrition_source_row_limit_exceeded");
  }
  if (columnCount > IMPORT_LIMITS.columnCount) {
    throw new Error("nutrition_source_column_limit_exceeded");
  }
  if (maximumCellBytes > IMPORT_LIMITS.cellBytes) {
    throw new Error("nutrition_source_cell_limit_exceeded");
  }
  return {
    archiveDepth: 0,
    columnCount,
    maximumCellBytes,
    rowCount,
    uncompressedBytes: rawBytes.byteLength,
  };
}

export async function boundedJson(response: Response, errorPrefix: string) {
  if (!response.ok) throw new Error(`${errorPrefix}_http_${response.status}`);
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > IMPORT_LIMITS.fileBytes) {
    throw new Error(`${errorPrefix}_file_limit_exceeded`);
  }
  const text = await response.text();
  if (new TextEncoder().encode(text).byteLength > IMPORT_LIMITS.fileBytes) {
    throw new Error(`${errorPrefix}_file_limit_exceeded`);
  }
  return JSON.parse(text) as unknown;
}

export async function writeJsonSnapshot(
  destination: string,
  snapshot: unknown,
): Promise<number> {
  const bytes = new TextEncoder().encode(JSON.stringify(snapshot));
  if (bytes.byteLength > IMPORT_LIMITS.fileBytes) {
    throw new Error("nutrition_source_file_limit_exceeded");
  }
  await writeFile(destination, bytes, { flag: "w" });
  return bytes.byteLength;
}
