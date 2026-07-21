import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, realpath, stat } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { StringDecoder } from "node:string_decoder";

import {
  normalizeSupermarketCatalog,
  type NormalizedSupermarketRecord,
  type RawSupermarketCatalogRecord,
  type RejectedSupermarketRecord,
} from "@health-design/catalog/supermarkets";
import { IMPORT_LIMITS } from "@health-design/catalog/nutrition";
import {
  buildSupermarketSourceManifest,
  type SupermarketManifestInput,
} from "@health-design/catalog/supermarkets";
import type {
  CatalogCoverage,
  ShoppingPurchaseForm,
  SupermarketChain,
  SupermarketSourceManifest,
} from "@health-design/contracts";
import { sha256CanonicalJson } from "@health-design/engine";

import {
  supermarketR2ObjectKeys,
  type SupermarketR2Descriptor,
} from "./r2-manifest.ts";

export const SUPERMARKET_IMPORT_LIMITS = IMPORT_LIMITS;

type ImportEnvelope = Readonly<{
  columnCount: number;
  fileBytes: number;
  maximumCellBytes: number;
  rowCount: number;
  uncompressedBytes: number;
}>;

export function validateSupermarketImportEnvelope(envelope: ImportEnvelope): void {
  if (envelope.fileBytes > IMPORT_LIMITS.fileBytes) {
    throw new Error("supermarket_file_limit_exceeded");
  }
  if (envelope.rowCount > IMPORT_LIMITS.rowCount) {
    throw new Error("supermarket_row_limit_exceeded");
  }
  if (envelope.columnCount > IMPORT_LIMITS.columnCount) {
    throw new Error("supermarket_column_limit_exceeded");
  }
  if (envelope.maximumCellBytes > IMPORT_LIMITS.cellBytes) {
    throw new Error("supermarket_cell_limit_exceeded");
  }
  if (envelope.uncompressedBytes > IMPORT_LIMITS.uncompressedBytes) {
    throw new Error("supermarket_uncompressed_limit_exceeded");
  }
}

export function assertLocalSupermarketInput(input: string): string {
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(input)) {
    throw new Error("supermarket_input_must_be_local");
  }
  if (extname(input).toLocaleLowerCase("en") !== ".csv") {
    throw new Error("supermarket_input_must_be_csv");
  }
  return resolve(input);
}

type ParsedCsv = Readonly<{
  envelope: ImportEnvelope;
  header: readonly string[];
  rawSha256: string;
  rows: readonly Readonly<Record<string, string>>[];
}>;

const T17_SOURCE_FIELDS = new Set([
  "brand",
  "data_status",
  "gtin",
  "last_error",
  "location_mode",
  "name",
  "observed_at",
  "package_text",
  "postal_code",
  "price_eur",
  "retailer",
  "sku",
  "slug",
  "source_category",
  "source_url",
]);

async function parseCsvFile(input: string): Promise<ParsedCsv> {
  const safePath = assertLocalSupermarketInput(input);
  const inputStat = await lstat(safePath);
  if (inputStat.isSymbolicLink() || !inputStat.isFile()) {
    throw new Error("supermarket_input_must_be_regular_file");
  }
  const canonicalPath = await realpath(safePath);
  const canonicalStat = await stat(canonicalPath);
  validateSupermarketImportEnvelope({
    columnCount: 0,
    fileBytes: canonicalStat.size,
    maximumCellBytes: 0,
    rowCount: 0,
    uncompressedBytes: canonicalStat.size,
  });

  const decoder = new StringDecoder("utf8");
  const digest = createHash("sha256");
  const encoder = new TextEncoder();
  let field = "";
  let row: string[] = [];
  let header: string[] | null = null;
  const rows: Readonly<Record<string, string>>[] = [];
  let inQuotes = false;
  let quotePending = false;
  let maximumCellBytes = 0;
  let streamedBytes = 0;

  const pushField = () => {
    const bytes = encoder.encode(field).byteLength;
    const retainedColumn = header === null ? null : header[row.length];
    const bounded = header === null || T17_SOURCE_FIELDS.has(retainedColumn ?? "");
    if (bounded) maximumCellBytes = Math.max(maximumCellBytes, bytes);
    if (bounded && bytes > IMPORT_LIMITS.cellBytes) {
      throw new Error("supermarket_cell_limit_exceeded");
    }
    row.push(field);
    field = "";
  };
  const pushRow = () => {
    if (row.length === 1 && row[0] === "") {
      row = [];
      return;
    }
    if (header === null) {
      const first = row[0]?.replace(/^\uFEFF/, "") ?? "";
      header = [first, ...row.slice(1)];
      if (
        header.length === 0 ||
        header.some((column) => column.length === 0) ||
        new Set(header).size !== header.length
      ) {
        throw new Error("supermarket_csv_header_invalid");
      }
      validateSupermarketImportEnvelope({
        columnCount: header.length,
        fileBytes: canonicalStat.size,
        maximumCellBytes,
        rowCount: 0,
        uncompressedBytes: streamedBytes,
      });
    } else {
      if (row.length !== header.length) {
        throw new Error("supermarket_csv_column_mismatch");
      }
      const values: Record<string, string> = {};
      for (let index = 0; index < header.length; index += 1) {
        values[header[index]!] = row[index]!;
      }
      rows.push(values);
      if (rows.length > IMPORT_LIMITS.rowCount) {
        throw new Error("supermarket_row_limit_exceeded");
      }
    }
    row = [];
  };
  const processText = (text: string) => {
    for (let index = 0; index < text.length; index += 1) {
      const character = text[index]!;
      if (quotePending) {
        if (character === '"') {
          field += '"';
          quotePending = false;
          continue;
        }
        inQuotes = false;
        quotePending = false;
      }
      if (inQuotes) {
        if (character === '"') quotePending = true;
        else field += character;
        continue;
      }
      if (character === '"') {
        if (field.length !== 0) throw new Error("supermarket_csv_quote_invalid");
        inQuotes = true;
      } else if (character === ",") {
        pushField();
      } else if (character === "\n") {
        pushField();
        pushRow();
      } else if (character !== "\r") {
        field += character;
      }
    }
  };

  for await (const chunk of createReadStream(canonicalPath)) {
    const bytes = chunk as Buffer;
    streamedBytes += bytes.byteLength;
    if (
      streamedBytes > IMPORT_LIMITS.fileBytes ||
      streamedBytes > IMPORT_LIMITS.uncompressedBytes
    ) {
      throw new Error("supermarket_file_limit_exceeded");
    }
    digest.update(bytes);
    processText(decoder.write(bytes));
  }
  processText(decoder.end());
  if (quotePending) {
    quotePending = false;
    inQuotes = false;
  }
  if (inQuotes) throw new Error("supermarket_csv_unclosed_quote");
  if (field.length > 0 || row.length > 0) {
    pushField();
    pushRow();
  }
  const completeHeader = header as string[] | null;
  if (completeHeader === null) throw new Error("supermarket_csv_header_missing");
  const envelope = {
    columnCount: completeHeader.length,
    fileBytes: canonicalStat.size,
    maximumCellBytes,
    rowCount: rows.length,
    uncompressedBytes: streamedBytes,
  };
  validateSupermarketImportEnvelope(envelope);
  return { envelope, header: completeHeader, rawSha256: digest.digest("hex"), rows };
}

function normalizeGtin14(value: string): string | null {
  const code = value.trim();
  return /^\d{8}$|^\d{12}$|^\d{13}$|^\d{14}$/.test(code)
    ? code.padStart(14, "0")
    : null;
}

function inferPurchaseForm(
  row: Readonly<Record<string, string>>,
): ShoppingPurchaseForm {
  const text = `${row.source_category ?? ""} ${row.name ?? ""}`
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase("es");
  if (/marinad|adobad/.test(text)) return "marinated";
  if (/conserva|en lata|enlatad/.test(text)) return "canned";
  if (/arroz|pasta|legumbre seca|cereal|harina/.test(text)) return "dry";
  if (/fruta|verdura|hortaliza|carne|pescado|huevo/.test(text)) return "fresh";
  if (/natural/.test(text)) return "natural";
  return "prepared";
}

function fallbackName(row: Readonly<Record<string, string>>): string {
  const name = row.name?.trim();
  if (name) return name;
  const slug = row.slug?.trim().replaceAll("-", " ");
  if (slug) return slug;
  return `Producto ${row.sku ?? "sin SKU"}`;
}

function rawRecord(
  row: Readonly<Record<string, string>>,
  sourceRecordIndex: number,
): RawSupermarketCatalogRecord {
  const sourceFields = Object.fromEntries(
    Object.entries(row).filter(([key]) => T17_SOURCE_FIELDS.has(key)),
  );
  return {
    basePrice: row.price_eur?.trim() || null,
    categoryPath: (row.source_category ?? "Sin categoría")
      .split(">")
      .map((value) => value.trim())
      .filter(Boolean),
    currency: "EUR",
    externalSku: row.sku?.trim() || `row-${sourceRecordIndex}`,
    formatText: row.package_text?.trim() || null,
    gtin14: normalizeGtin14(row.gtin ?? ""),
    name: fallbackName(row),
    purchaseForm: inferPurchaseForm(row),
    sourceFields,
    sourceRecordIndex,
  };
}

function maximumObservedAt(
  rows: readonly Readonly<Record<string, string>>[],
  fallback: string,
): string {
  const valid = rows
    .map((row) => row.observed_at ?? "")
    .filter((value) => Number.isFinite(Date.parse(value)))
    .sort((left, right) => Date.parse(right) - Date.parse(left));
  return valid[0] ?? fallback;
}

function sourceLocation(rows: readonly Readonly<Record<string, string>>[]): string {
  const postalCodes = [...new Set(rows.map((row) => row.postal_code).filter(Boolean))];
  if (postalCodes.length === 1) return `postal_code:${postalCodes[0]}`;
  const locationModes = [
    ...new Set(rows.map((row) => row.location_mode).filter(Boolean)),
  ];
  return locationModes.length === 1 ? locationModes[0]! : "mixed_internal";
}

function uuidFromHash(hash: string): string {
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

const EMPTY_COVERAGE = {
  dynamicRequired: 20,
  dynamicUsable: 0,
  fixedRequired: 60,
  fixedUsable: 0,
  groups: [],
  publishable: false,
  totalRequired: 80,
  totalUsable: 0,
} as const satisfies CatalogCoverage;

export type SupermarketImportArtifact = Readonly<{
  captureErrors: readonly Readonly<{
    error: string;
    externalSku: string;
    sourceRecordIndex: number;
  }>[];
  chain: SupermarketChain;
  market: "ES";
  records: readonly NormalizedSupermarketRecord[];
  rejected: readonly RejectedSupermarketRecord[];
  schemaVersion: 1;
}>;

export type SupermarketImportBatch = Readonly<{
  artifact: SupermarketImportArtifact;
  descriptor: SupermarketR2Descriptor;
  manifest: SupermarketSourceManifest;
  summary: Readonly<{
    captureErrorCount: number;
    chain: SupermarketChain;
    market: "ES";
    normalizationRejectionCount: number;
    priceCount: number;
    recordCount: number;
    usableRecordCount: number;
  }>;
}>;

export async function importSupermarketCatalogFile(
  input: Readonly<{
    chain: SupermarketChain;
    input: string;
    licenseStatus: "approved" | "restricted" | "unknown";
    sourceTermsStatus: "approved" | "restricted" | "unknown";
  }>,
): Promise<SupermarketImportBatch> {
  const parsed = await parseCsvFile(input.input);
  const fileStat = await stat(assertLocalSupermarketInput(input.input));
  const captureErrors: SupermarketImportArtifact["captureErrors"][number][] = [];
  const candidates: RawSupermarketCatalogRecord[] = [];
  let priceCount = 0;
  for (let index = 0; index < parsed.rows.length; index += 1) {
    const row = parsed.rows[index]!;
    const sourceRecordIndex = index + 1;
    if (row.retailer !== input.chain) {
      throw new Error("supermarket_chain_mismatch");
    }
    if (row.data_status === "error") {
      captureErrors.push({
        error: row.last_error || "capture_error",
        externalSku: row.sku || `row-${sourceRecordIndex}`,
        sourceRecordIndex,
      });
      continue;
    }
    if (row.price_eur?.trim()) priceCount += 1;
    candidates.push(rawRecord(row, sourceRecordIndex));
  }
  const normalized = await normalizeSupermarketCatalog({
    chain: input.chain,
    market: "ES",
    records: candidates,
  });
  const artifact: SupermarketImportArtifact = {
    captureErrors,
    chain: input.chain,
    market: "ES",
    records: normalized.records,
    rejected: normalized.rejected,
    schemaVersion: 1,
  };
  const normalizedSha256 = await sha256CanonicalJson(artifact);
  const collectedAt = maximumObservedAt(parsed.rows, fileStat.mtime.toISOString());
  const descriptor: SupermarketR2Descriptor = {
    chain: input.chain,
    collectedAt,
    normalizedSha256,
    rawSha256: parsed.rawSha256,
    schemaVersion: 1,
  };
  const keys = supermarketR2ObjectKeys(descriptor);
  const manifestInput: SupermarketManifestInput = {
    captureEvidenceRef: keys.raw,
    chain: input.chain,
    collectedAt,
    coverage: EMPTY_COVERAGE,
    createdAt: collectedAt,
    errorCount: captureErrors.length,
    errorEvidenceRef: captureErrors.length === 0 ? null : keys.errors,
    id: uuidFromHash(
      await sha256CanonicalJson({
        chain: input.chain,
        normalizedSha256,
        rawSha256: parsed.rawSha256,
      }),
    ),
    licenseStatus: input.licenseStatus,
    normalizedObjectRef: keys.normalized,
    normalizedSha256,
    priceCount,
    rawObjectRef: keys.raw,
    rawSha256: parsed.rawSha256,
    recordCount: parsed.rows.length,
    sourceKind: "csv_capture",
    sourceLocationInternal: sourceLocation(parsed.rows),
    sourceTermsStatus: input.sourceTermsStatus,
  };
  const manifest = buildSupermarketSourceManifest(manifestInput);
  return {
    artifact,
    descriptor,
    manifest,
    summary: {
      captureErrorCount: captureErrors.length,
      chain: input.chain,
      market: "ES",
      normalizationRejectionCount: normalized.rejected.length,
      priceCount,
      recordCount: parsed.rows.length,
      usableRecordCount: normalized.records.filter(
        ({ projection }) => projection.usability === "calculable",
      ).length,
    },
  };
}

export function canPublishSupermarketSource(
  input: Readonly<{
    environment: "development" | "production";
    licenseStatus: "approved" | "restricted" | "unknown";
    sourceTermsStatus: "approved" | "restricted" | "unknown";
    useDecision: "approved_for_development" | "not_approved";
  }>,
): boolean {
  if (input.licenseStatus === "unknown" || input.sourceTermsStatus === "unknown") {
    return false;
  }
  return (
    input.environment === "development" &&
    input.useDecision === "approved_for_development"
  );
}
