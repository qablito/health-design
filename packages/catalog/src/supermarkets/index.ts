import {
  CatalogSkuProjectionSchema,
  SupermarketSourceRecordSchema,
  type CatalogSkuProjection,
  type ShoppingMarket,
  type ShoppingPurchaseForm,
  type SupermarketChain,
  type SupermarketSourceRecord,
} from "@health-design/contracts";
import {
  compareDecimals,
  normalizeDecimal,
  sha256CanonicalJson,
} from "@health-design/engine";

import {
  normalizePackagePrice,
  packageSupportsShoppingGrams,
  parseSupermarketPackage,
} from "./package-parser.ts";

export * from "./manifest.ts";
export * from "./package-parser.ts";

export type RawSupermarketCatalogRecord = Readonly<{
  basePrice: string | null;
  categoryPath: readonly string[];
  currency: string;
  externalSku: string;
  formatText: string | null;
  gtin14: string | null;
  name: string;
  purchaseForm: ShoppingPurchaseForm;
  sourceFields: Readonly<Record<string, string>>;
  sourceRecordIndex: number;
}>;

export type NormalizedSupermarketRecord = Readonly<{
  projection: CatalogSkuProjection;
  source: SupermarketSourceRecord;
}>;

export type RejectedSupermarketRecord = Readonly<{
  externalSku: string;
  reason:
    | "invalid_base_price"
    | "invalid_currency"
    | "invalid_package_content"
    | "invalid_record";
  sourceRecordIndex: number;
}>;

export type NormalizedSupermarketCatalog = Readonly<{
  normalizedSha256: string;
  records: readonly NormalizedSupermarketRecord[];
  rejected: readonly RejectedSupermarketRecord[];
}>;

function normalizeText(value: string): string {
  return value.normalize("NFC").trim().replace(/\s+/g, " ");
}

function normalizeBasePrice(value: string | null): string | null {
  if (value === null || value.trim() === "") return null;
  const candidate = value.trim().replace(",", ".");
  if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(candidate)) {
    throw new Error("invalid_base_price");
  }
  const normalized = normalizeDecimal(candidate);
  if (compareDecimals(normalized, "0") <= 0) throw new Error("invalid_base_price");
  return normalized;
}

async function stableSkuId(
  market: ShoppingMarket,
  chain: SupermarketChain,
  externalSku: string,
): Promise<string> {
  const hash = await sha256CanonicalJson({ chain, externalSku, market });
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

export function neutralizeSpreadsheetCell(value: string): string {
  return /^[=+\-@]/.test(value) ? `'${value}` : value;
}

async function normalizeRecord(
  market: ShoppingMarket,
  chain: SupermarketChain,
  raw: RawSupermarketCatalogRecord,
): Promise<NormalizedSupermarketRecord> {
  if (raw.currency !== "EUR") throw new Error("invalid_currency");
  const basePriceEur = normalizeBasePrice(raw.basePrice);
  const parsedPackage =
    raw.formatText === null
      ? { package: null, reasons: ["ambiguous"] as const, status: "review" as const }
      : parseSupermarketPackage(raw.formatText);
  if (parsedPackage.reasons.includes("invalid_content")) {
    throw new Error("invalid_package_content");
  }

  const name = normalizeText(raw.name);
  const categoryPath = raw.categoryPath.map(normalizeText);
  const externalSku = normalizeText(raw.externalSku);
  const package_ = parsedPackage.package;
  const exclusionReasons: string[] = [];
  if (basePriceEur === null) exclusionReasons.push("base_price_missing");
  if (package_ === null) exclusionReasons.push("package_unconfirmed");
  if (package_ !== null && !packageSupportsShoppingGrams(package_)) {
    exclusionReasons.push("equivalent_edible_mass_missing");
  }
  const usability = exclusionReasons.length === 0 ? "calculable" : "visible";
  const normalizedPrice =
    basePriceEur === null || package_ === null
      ? null
      : normalizePackagePrice(basePriceEur, package_);
  const skuId = await stableSkuId(market, chain, externalSku);

  const source = SupermarketSourceRecordSchema.parse({
    basePriceEur,
    captureErrorCode: null,
    captureStatus: "accepted",
    categoryPath,
    chain,
    currency: "EUR",
    externalSku,
    formatText: raw.formatText === null ? null : normalizeText(raw.formatText),
    gtin14: raw.gtin14,
    market,
    name,
    package: package_,
    purchaseForm: raw.purchaseForm,
    schemaVersion: 1,
    sourceFields: raw.sourceFields,
    sourceRecordIndex: raw.sourceRecordIndex,
  });
  const projection = CatalogSkuProjectionSchema.parse({
    basePriceEur,
    categoryPath,
    chain,
    exclusionReasons,
    externalSku,
    formatText: source.formatText,
    gtin14: raw.gtin14,
    market,
    name,
    normalizedPrice,
    package: package_,
    purchaseForm: raw.purchaseForm,
    schemaVersion: 1,
    skuId,
    usability,
  });
  return { projection, source };
}

function rejectionReason(error: unknown): RejectedSupermarketRecord["reason"] {
  const message = error instanceof Error ? error.message : "invalid_record";
  if (
    message === "invalid_base_price" ||
    message === "invalid_currency" ||
    message === "invalid_package_content"
  ) {
    return message;
  }
  return "invalid_record";
}

export async function normalizeSupermarketCatalog(
  input: Readonly<{
    chain: SupermarketChain;
    market: ShoppingMarket;
    records: readonly RawSupermarketCatalogRecord[];
  }>,
): Promise<NormalizedSupermarketCatalog> {
  const records: NormalizedSupermarketRecord[] = [];
  const rejected: RejectedSupermarketRecord[] = [];
  for (const raw of input.records) {
    try {
      records.push(await normalizeRecord(input.market, input.chain, raw));
    } catch (error) {
      rejected.push({
        externalSku: raw.externalSku,
        reason: rejectionReason(error),
        sourceRecordIndex: raw.sourceRecordIndex,
      });
    }
  }
  records.sort((left, right) =>
    left.projection.externalSku.localeCompare(right.projection.externalSku, "es"),
  );
  return {
    normalizedSha256: await sha256CanonicalJson({
      chain: input.chain,
      market: input.market,
      records,
      rejected,
      schemaVersion: 1,
    }),
    records,
    rejected,
  };
}
