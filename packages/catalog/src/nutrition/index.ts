import {
  classifyNutrientDiscrepancy,
  normalizeQuantity,
  quantitiesAreCompatible,
  sha256CanonicalJson,
  type DiscrepancyStatus,
  type FoodState,
  type NutrientClass,
  type Quantity,
  type QuantityBasis,
  type QuantityState,
  type QuantityUnit,
} from "@health-design/engine";

export const SOURCE_PRIORITY = [
  "ciqual_2025",
  "bls_4_0",
  "fineli",
  "livsmedelsverket",
  "usda_foundation",
  "usda_sr_legacy",
] as const;

export type NutritionSourceKey = (typeof SOURCE_PRIORITY)[number];

export const NUTRITION_SOURCES = {
  bls_4_0: {
    downloadUrl: "https://blsdb.de/download",
    license: "CC BY 4.0",
    name: "Bundeslebensmittelschlüssel 4.0",
    precedence: 2,
    referenceUrl: "https://blsdb.de/bls",
  },
  ciqual_2025: {
    downloadUrl: "https://ciqual.anses.fr/cms/en/2025-anses-ciqual-table",
    license: "Licence Ouverte 2.0",
    name: "ANSES-CIQUAL 2025",
    precedence: 1,
    referenceUrl: "https://ciqual.anses.fr/cms/en/2025-anses-ciqual-table",
  },
  fineli: {
    downloadUrl: "https://fineli.fi/fineli/en/index",
    license: "THL open data terms",
    name: "Fineli",
    precedence: 3,
    referenceUrl: "https://fineli.fi/fineli/en/index",
  },
  livsmedelsverket: {
    downloadUrl: "https://soknaringsinnehall.livsmedelsverket.se/",
    license: "CC BY",
    name: "Livsmedelsverket",
    precedence: 4,
    referenceUrl: "https://dataportal.livsmedelsverket.se/livsmedel/swagger/index.html",
  },
  usda_foundation: {
    downloadUrl: "https://fdc.nal.usda.gov/download-datasets/",
    license: "US public domain",
    name: "USDA Foundation Foods",
    precedence: 5,
    referenceUrl: "https://fdc.nal.usda.gov/data-documentation/",
  },
  usda_sr_legacy: {
    downloadUrl: "https://fdc.nal.usda.gov/download-datasets/",
    license: "US public domain",
    name: "USDA SR Legacy",
    precedence: 6,
    referenceUrl: "https://fdc.nal.usda.gov/data-documentation/",
  },
} as const satisfies Readonly<
  Record<
    NutritionSourceKey,
    {
      downloadUrl: string;
      license: string;
      name: string;
      precedence: number;
      referenceUrl: string;
    }
  >
>;

export const IMPORT_LIMITS = {
  cellBytes: 2 * 1_024,
  columnCount: 200,
  fileBytes: 25 * 1_024 * 1_024,
  rowCount: 100_000,
  uncompressedBytes: 100 * 1_024 * 1_024,
} as const;

export const NUTRITION_CANONICALIZATION_VERSION = "canonical-json-v1" as const;
export const NUTRITION_HASH_ALGORITHM = "sha256" as const;

export type NutritionImportEnvelope = Readonly<{
  archiveDepth: number;
  columnCount: number;
  maximumCellBytes: number;
  rowCount: number;
  uncompressedBytes: number;
}>;

export type NutritionNutrientClass = NutrientClass | "energy";

export type ImportedNutrientValue = Readonly<{
  nutrientClass: NutritionNutrientClass;
  state: QuantityState;
  unit: QuantityUnit;
  value: string | null;
}>;

export type NutritionImportRecord = Readonly<{
  aliases: readonly string[];
  basis: QuantityBasis;
  canonicalFoodKey: string;
  category: string;
  ediblePart: string;
  foodState: FoodState;
  gtin?: string;
  method: string;
  name: string;
  nutrients: Readonly<Record<string, ImportedNutrientValue>>;
  targetKind: "commercial_product" | "generic_food";
}>;

export type NutritionImportArtifact = Readonly<{
  envelope: NutritionImportEnvelope;
  licenseStatus: "approved" | "restricted" | "unknown";
  rawBytes: Uint8Array;
  records: readonly NutritionImportRecord[];
  retrievedAt: string;
  sourceKey: NutritionSourceKey;
  sourceVersion: string;
  transformations: readonly string[];
}>;

export type ImportViolationCode =
  | "archive_nested"
  | "cell_limit_exceeded"
  | "column_limit_exceeded"
  | "commercial_product_not_allowed"
  | "file_limit_exceeded"
  | "invalid_basis"
  | "invalid_edible_part"
  | "invalid_license"
  | "invalid_manifest"
  | "invalid_nutrient"
  | "invalid_record"
  | "invalid_state"
  | "row_limit_exceeded"
  | "uncompressed_limit_exceeded";

export type ImportViolation = Readonly<{
  code: ImportViolationCode;
  field?: string;
  recordIndex?: number;
}>;

export type ImportEnvelopeResult = Readonly<{
  accepted: boolean;
  publicationCount: 0;
  quarantined: true;
  violations: readonly ImportViolation[];
}>;

export type SourceManifest = Readonly<{
  canonicalizationVersion: typeof NUTRITION_CANONICALIZATION_VERSION;
  hashAlgorithm: typeof NUTRITION_HASH_ALGORITHM;
  id: string;
  licenseStatus: NutritionImportArtifact["licenseStatus"];
  normalizedContentHash: string;
  rawContentHash: string;
  retrievedAt: string;
  sourceKey: NutritionSourceKey;
  sourceVersion: string;
  transformations: readonly string[];
}>;

export type NormalizedNutrientObservation = Readonly<{
  basis: QuantityBasis;
  foodState: FoodState;
  normalizedUnit: QuantityUnit;
  normalizedValue: string | null;
  nutrientClass: NutritionNutrientClass;
  originalUnit: QuantityUnit;
  originalValue: string | null;
  state: QuantityState;
}>;

export type QuarantinedFoodRevision = Readonly<{
  aliases: readonly string[];
  basis: QuantityBasis;
  canonicalFoodKey: string;
  category: string;
  ediblePart: string;
  foodState: FoodState;
  id: string;
  manifestId: string;
  method: string;
  name: string;
  nutrients: Readonly<Record<string, NormalizedNutrientObservation>>;
  sourceKey: NutritionSourceKey;
  sourceVersion: string;
  status: "quarantined";
  targetKind: "generic_food";
}>;

export type NutritionQuarantineBatch = Readonly<{
  manifest: SourceManifest;
  publicationCount: 0;
  revisions: readonly QuarantinedFoodRevision[];
  status: "quarantined" | "rejected";
  violations: readonly ImportViolation[];
}>;

export type NutritionReview = Readonly<{
  anchorRevisionId: string;
  anchorSourceKey: NutritionSourceKey;
  candidateRevisionId: string;
  candidateSourceKey: NutritionSourceKey;
  nutrientKey: string;
  status: Extract<DiscrepancyStatus, "manual_review" | "priority_review">;
}>;

export type ResolvedNutrient = Readonly<{
  observation: NormalizedNutrientObservation;
  revisionId: string;
  sourceKey: NutritionSourceKey;
  value: string | null;
}>;

export type NutritionCandidateResolution = Readonly<{
  averaged: false;
  effectiveRevisionId: string | null;
  excludedRevisionIds: readonly string[];
  nutrients: Readonly<Record<string, ResolvedNutrient>>;
  publishAutomatically: false;
  reviews: readonly NutritionReview[];
  status: "ready_for_manual_activation" | "review_required";
}>;

export type NutritionResolutionContext = Readonly<{
  basis: QuantityBasis;
  ediblePart: string;
  foodState: FoodState;
  method: string;
}>;

function isNonNegativeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

export function validateNutritionImportEnvelope(
  input: NutritionImportEnvelope &
    Readonly<{ fileBytes: number; maximumCellBytes: number }>,
): ImportEnvelopeResult {
  const violations: ImportViolation[] = [];
  if (
    !isNonNegativeInteger(input.fileBytes) ||
    input.fileBytes > IMPORT_LIMITS.fileBytes
  ) {
    violations.push({ code: "file_limit_exceeded", field: "fileBytes" });
  }
  if (
    !isNonNegativeInteger(input.rowCount) ||
    input.rowCount > IMPORT_LIMITS.rowCount
  ) {
    violations.push({ code: "row_limit_exceeded", field: "rowCount" });
  }
  if (
    !isNonNegativeInteger(input.columnCount) ||
    input.columnCount > IMPORT_LIMITS.columnCount
  ) {
    violations.push({ code: "column_limit_exceeded", field: "columnCount" });
  }
  if (
    !isNonNegativeInteger(input.maximumCellBytes) ||
    input.maximumCellBytes > IMPORT_LIMITS.cellBytes
  ) {
    violations.push({ code: "cell_limit_exceeded", field: "maximumCellBytes" });
  }
  if (
    !isNonNegativeInteger(input.uncompressedBytes) ||
    input.uncompressedBytes > IMPORT_LIMITS.uncompressedBytes
  ) {
    violations.push({
      code: "uncompressed_limit_exceeded",
      field: "uncompressedBytes",
    });
  }
  if (!isNonNegativeInteger(input.archiveDepth) || input.archiveDepth > 0) {
    violations.push({ code: "archive_nested", field: "archiveDepth" });
  }
  return {
    accepted: violations.length === 0,
    publicationCount: 0,
    quarantined: true,
    violations,
  };
}

async function sha256Bytes(bytes: Uint8Array): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    Uint8Array.from(bytes),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function validateRecord(
  record: NutritionImportRecord,
  recordIndex: number,
): ImportViolation[] {
  const violations: ImportViolation[] = [];
  if (record.targetKind !== "generic_food" || record.gtin !== undefined) {
    violations.push({ code: "commercial_product_not_allowed", recordIndex });
  }
  if (
    !record.canonicalFoodKey.startsWith("food:") ||
    record.name.trim() === "" ||
    record.category.trim() === "" ||
    record.method.trim() === ""
  ) {
    violations.push({ code: "invalid_record", recordIndex });
  }
  if (record.ediblePart.trim() === "") {
    violations.push({ code: "invalid_edible_part", recordIndex });
  }
  if (record.basis !== "per_100_g" && record.basis !== "per_100_ml") {
    violations.push({ code: "invalid_basis", recordIndex });
  }
  if (!(["cooked", "raw", "unspecified"] as const).includes(record.foodState)) {
    violations.push({ code: "invalid_state", recordIndex });
  }
  for (const [nutrientKey, nutrient] of Object.entries(record.nutrients)) {
    const missingIsValid = nutrient.state === "missing" && nutrient.value === null;
    const knownIsValid = nutrient.state !== "missing" && nutrient.value !== null;
    if (nutrientKey.trim() === "" || (!missingIsValid && !knownIsValid)) {
      violations.push({
        code: "invalid_nutrient",
        field: nutrientKey,
        recordIndex,
      });
    }
  }
  return violations;
}

type NormalizedFoodRevision = Omit<
  QuarantinedFoodRevision,
  "id" | "manifestId" | "status"
>;

function normalizeRecord(
  record: NutritionImportRecord,
  sourceKey: NutritionSourceKey,
  sourceVersion: string,
): NormalizedFoodRevision {
  const nutrients = Object.fromEntries(
    Object.entries(record.nutrients).map(([nutrientKey, nutrient]) => {
      const quantity = normalizeQuantity(
        {
          basis: record.basis,
          foodState: record.foodState,
          method: record.method,
          state: nutrient.state,
          unit: nutrient.unit,
          value: nutrient.value,
        },
        nutrient.unit,
        record.basis,
      );
      const observation: NormalizedNutrientObservation = {
        basis: quantity.basis,
        foodState: quantity.foodState,
        normalizedUnit: quantity.unit,
        normalizedValue: quantity.value,
        nutrientClass: nutrient.nutrientClass,
        originalUnit: nutrient.unit,
        originalValue: nutrient.value,
        state: nutrient.state,
      };
      return [nutrientKey, observation] as const;
    }),
  );
  return {
    aliases: record.aliases,
    basis: record.basis,
    canonicalFoodKey: record.canonicalFoodKey,
    category: record.category,
    ediblePart: record.ediblePart,
    foodState: record.foodState,
    method: record.method,
    name: record.name,
    nutrients,
    sourceKey,
    sourceVersion,
    targetKind: "generic_food",
  };
}

async function materializeRevision(
  revision: NormalizedFoodRevision,
  manifestId: string,
): Promise<QuarantinedFoodRevision> {
  const hash = await sha256CanonicalJson({ ...revision, manifestId });
  return {
    ...revision,
    id: `revision:${hash}`,
    manifestId,
    status: "quarantined",
  };
}

export async function buildNutritionQuarantineBatch(
  artifact: NutritionImportArtifact,
): Promise<NutritionQuarantineBatch> {
  const rawContentHash = await sha256Bytes(artifact.rawBytes);
  const envelope = validateNutritionImportEnvelope({
    ...artifact.envelope,
    fileBytes: artifact.rawBytes.byteLength,
    maximumCellBytes: artifact.envelope.maximumCellBytes,
  });
  const violations: ImportViolation[] = [...envelope.violations];
  if (artifact.licenseStatus !== "approved") {
    violations.push({ code: "invalid_license", field: "licenseStatus" });
  }
  if (
    artifact.sourceVersion.trim() === "" ||
    artifact.sourceVersion.length > 128 ||
    !Number.isFinite(Date.parse(artifact.retrievedAt)) ||
    artifact.transformations.length === 0 ||
    artifact.transformations.some(
      (transformation) =>
        transformation.trim() === "" ||
        new TextEncoder().encode(transformation).byteLength > IMPORT_LIMITS.cellBytes,
    ) ||
    artifact.records.length === 0
  ) {
    violations.push({ code: "invalid_manifest" });
  }
  artifact.records.forEach((record, index) => {
    violations.push(...validateRecord(record, index));
  });

  let normalizedRecords: readonly NormalizedFoodRevision[] = [];
  if (violations.length === 0) {
    try {
      normalizedRecords = artifact.records.map((record) =>
        normalizeRecord(record, artifact.sourceKey, artifact.sourceVersion),
      );
    } catch {
      violations.push({ code: "invalid_nutrient" });
    }
  }

  const normalizedPayload = {
    rejected: violations.length > 0,
    records: normalizedRecords,
    sourceKey: artifact.sourceKey,
    sourceVersion: artifact.sourceVersion,
    transformations: artifact.transformations,
  };
  const normalizedContentHash = await sha256CanonicalJson(normalizedPayload);
  const manifestHash = await sha256CanonicalJson({
    canonicalizationVersion: NUTRITION_CANONICALIZATION_VERSION,
    licenseStatus: artifact.licenseStatus,
    normalizedContentHash,
    rawContentHash,
    retrievedAt: artifact.retrievedAt,
    sourceKey: artifact.sourceKey,
    sourceVersion: artifact.sourceVersion,
    transformations: artifact.transformations,
  });
  const manifest: SourceManifest = {
    canonicalizationVersion: NUTRITION_CANONICALIZATION_VERSION,
    hashAlgorithm: NUTRITION_HASH_ALGORITHM,
    id: `manifest:${manifestHash}`,
    licenseStatus: artifact.licenseStatus,
    normalizedContentHash,
    rawContentHash,
    retrievedAt: artifact.retrievedAt,
    sourceKey: artifact.sourceKey,
    sourceVersion: artifact.sourceVersion,
    transformations: artifact.transformations,
  };

  if (violations.length > 0) {
    return {
      manifest,
      publicationCount: 0,
      revisions: [],
      status: "rejected",
      violations,
    };
  }

  const revisions = await Promise.all(
    normalizedRecords.map((revision) => materializeRevision(revision, manifest.id)),
  );
  return {
    manifest,
    publicationCount: 0,
    revisions,
    status: "quarantined",
    violations: [],
  };
}

function sourceRank(sourceKey: NutritionSourceKey): number {
  return NUTRITION_SOURCES[sourceKey].precedence;
}

function revisionCompatible(
  context: NutritionResolutionContext,
  candidate: QuarantinedFoodRevision,
): boolean {
  return (
    context.basis === candidate.basis &&
    context.foodState === candidate.foodState &&
    context.ediblePart === candidate.ediblePart &&
    context.method === candidate.method
  );
}

function asQuantity(observation: NormalizedNutrientObservation): Quantity {
  return {
    basis: observation.basis,
    foodState: observation.foodState,
    state: observation.state,
    unit: observation.normalizedUnit,
    value: observation.normalizedValue,
  };
}

export function resolveNutritionCandidate(
  input: Readonly<{
    canonicalFoodKey: string;
    existingEffectiveRevisionId: string | null;
    resolutionContext: NutritionResolutionContext;
    revisions: readonly QuarantinedFoodRevision[];
  }>,
): NutritionCandidateResolution {
  const matching = input.revisions.filter(
    ({ canonicalFoodKey }) => canonicalFoodKey === input.canonicalFoodKey,
  );
  const compatible = matching
    .filter((revision) => revisionCompatible(input.resolutionContext, revision))
    .sort((left, right) => sourceRank(left.sourceKey) - sourceRank(right.sourceKey));
  const anchor = compatible[0];
  if (!anchor) throw new Error("nutrition_revision_not_found");

  const compatibleIds = new Set(compatible.map(({ id }) => id));
  const excludedRevisionIds = matching
    .filter(({ id }) => !compatibleIds.has(id))
    .map(({ id }) => id);
  const nutrientKeys = new Set(
    compatible.flatMap(({ nutrients }) => Object.keys(nutrients)),
  );
  const nutrients: Record<string, ResolvedNutrient> = {};
  const reviews: NutritionReview[] = [];

  for (const nutrientKey of [...nutrientKeys].sort()) {
    const observations = compatible.flatMap((revision) => {
      const observation = revision.nutrients[nutrientKey];
      return observation ? [{ observation, revision }] : [];
    });
    const selectedEntry =
      observations.find(({ observation }) => observation.state !== "missing") ??
      observations[0];
    if (!selectedEntry) continue;
    nutrients[nutrientKey] = {
      observation: selectedEntry.observation,
      revisionId: selectedEntry.revision.id,
      sourceKey: selectedEntry.revision.sourceKey,
      value: selectedEntry.observation.normalizedValue,
    };

    if (selectedEntry.observation.normalizedValue === null) continue;
    for (const entry of observations) {
      if (
        entry.revision.id === selectedEntry.revision.id ||
        entry.observation.normalizedValue === null
      ) {
        continue;
      }
      let status: DiscrepancyStatus;
      if (
        entry.observation.nutrientClass !== selectedEntry.observation.nutrientClass ||
        !quantitiesAreCompatible(
          asQuantity(selectedEntry.observation),
          asQuantity(entry.observation),
        )
      ) {
        status = "priority_review";
      } else if (selectedEntry.observation.nutrientClass === "energy") {
        status = "priority_review";
      } else {
        const normalized = normalizeQuantity(
          asQuantity(entry.observation),
          selectedEntry.observation.normalizedUnit,
          selectedEntry.observation.basis,
        );
        status = classifyNutrientDiscrepancy(
          selectedEntry.observation.nutrientClass,
          selectedEntry.observation.normalizedValue,
          normalized.value as string,
        );
      }
      if (status === "manual_review" || status === "priority_review") {
        reviews.push({
          anchorRevisionId: selectedEntry.revision.id,
          anchorSourceKey: selectedEntry.revision.sourceKey,
          candidateRevisionId: entry.revision.id,
          candidateSourceKey: entry.revision.sourceKey,
          nutrientKey,
          status,
        });
      }
    }
  }

  return {
    averaged: false,
    effectiveRevisionId: input.existingEffectiveRevisionId,
    excludedRevisionIds,
    nutrients,
    publishAutomatically: false,
    reviews,
    status: reviews.length > 0 ? "review_required" : "ready_for_manual_activation",
  };
}
