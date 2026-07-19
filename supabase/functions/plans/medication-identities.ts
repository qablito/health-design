const AEMPS_ID_PATTERN = /^[0-9A-Z]{1,32}$/;
const HASH_PATTERN = /^[0-9a-f]{64}$/;
const IDENTITY_KEYS = [
  "activeIngredients",
  "administrationRoutes",
  "aempsId",
  "canonicalName",
  "commercialized",
  "prescriptionRequired",
  "retrievedAt",
  "sourceHash",
  "sourceVersion",
] as const;

export type CanonicalMedicationIdentity = Readonly<{
  activeIngredients: readonly string[];
  administrationRoutes: readonly string[];
  aempsId: string;
  canonicalName: string;
  commercialized: boolean | null;
  prescriptionRequired: boolean | null;
  retrievedAt: string;
  sourceHash: string;
  sourceVersion: "CIMA_REST_API_1_23";
}>;

function object(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("invalid_clinical_medication_identities");
  }
  return value as Record<string, unknown>;
}

function textArray(value: unknown, minimum: number): string[] {
  if (
    !Array.isArray(value) ||
    value.length < minimum ||
    value.length > 20 ||
    value.some(
      (entry) =>
        typeof entry !== "string" || entry.trim().length < 1 || entry.length > 200,
    )
  ) {
    throw new Error("invalid_clinical_medication_identities");
  }
  return value.filter((entry): entry is string => typeof entry === "string");
}

export function hydrateCanonicalMedicationIdentities(
  value: unknown,
  requestedIds: ReadonlySet<string>,
): CanonicalMedicationIdentity[] {
  if (!Array.isArray(value) || value.length > 50) {
    throw new Error("invalid_clinical_medication_identities");
  }
  const seen = new Set<string>();
  return value.map((entry) => {
    const row = object(entry);
    const keys = Object.keys(row).sort();
    if (
      keys.length !== IDENTITY_KEYS.length ||
      keys.some((key, index) => key !== IDENTITY_KEYS[index]) ||
      typeof row.aempsId !== "string" ||
      !AEMPS_ID_PATTERN.test(row.aempsId) ||
      !requestedIds.has(row.aempsId) ||
      seen.has(row.aempsId) ||
      typeof row.canonicalName !== "string" ||
      row.canonicalName.trim().length < 1 ||
      row.canonicalName.length > 500 ||
      (row.commercialized !== null && typeof row.commercialized !== "boolean") ||
      (row.prescriptionRequired !== null &&
        typeof row.prescriptionRequired !== "boolean") ||
      row.sourceVersion !== "CIMA_REST_API_1_23" ||
      typeof row.sourceHash !== "string" ||
      !HASH_PATTERN.test(row.sourceHash) ||
      typeof row.retrievedAt !== "string" ||
      !row.retrievedAt.includes("T") ||
      Number.isNaN(Date.parse(row.retrievedAt))
    ) {
      throw new Error("invalid_clinical_medication_identities");
    }
    seen.add(row.aempsId);
    return {
      activeIngredients: textArray(row.activeIngredients, 1),
      administrationRoutes: textArray(row.administrationRoutes, 0),
      aempsId: row.aempsId,
      canonicalName: row.canonicalName,
      commercialized: row.commercialized,
      prescriptionRequired: row.prescriptionRequired,
      retrievedAt: row.retrievedAt,
      sourceHash: row.sourceHash,
      sourceVersion: row.sourceVersion,
    };
  });
}
