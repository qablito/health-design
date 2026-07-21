import {
  SupermarketSourceManifestSchema,
  type CatalogCoverage,
  type SupermarketChain,
  type SupermarketSourceManifest,
} from "@health-design/contracts";

export const SUPERMARKET_CANONICALIZATION_VERSION = "supermarket-canonical-v1" as const;
export const SUPERMARKET_IMPORTER_VERSION = "supermarket-import-v1" as const;

export type SupermarketManifestInput = Readonly<{
  captureEvidenceRef: string;
  chain: SupermarketChain;
  collectedAt: string;
  coverage: CatalogCoverage;
  createdAt: string;
  errorCount: number;
  errorEvidenceRef: string | null;
  id: string;
  licenseStatus: "approved" | "restricted" | "unknown";
  normalizedObjectRef: string;
  normalizedSha256: string;
  priceCount: number;
  rawObjectRef: string;
  rawSha256: string;
  recordCount: number;
  sourceKind: "csv_capture" | "json_capture" | "manual_export";
  sourceLocationInternal: string;
  sourceTermsStatus: "approved" | "restricted" | "unknown";
}>;

export function buildSupermarketSourceManifest(
  input: SupermarketManifestInput,
): SupermarketSourceManifest {
  return SupermarketSourceManifestSchema.parse({
    ...input,
    canonicalizationVersion: SUPERMARKET_CANONICALIZATION_VERSION,
    importerVersion: SUPERMARKET_IMPORTER_VERSION,
    market: "ES",
    schemaVersion: 1,
  });
}
