import {
  CLINICAL_CATALOG_VERSION,
  CONTEXT_CANONICALIZATION_VERSION,
} from "@health-design/contracts";
import {
  CLINICAL_CATALOG_DESCRIPTOR_HASH,
  RULE_SET_REVISION_ID,
  SOURCE_MANIFEST_ID,
} from "@health-design/engine";

const DESCRIPTOR_KEYS = [
  "canonicalizationVersion",
  "clinicalCatalogVersion",
  "descriptorHash",
  "hashAlgorithm",
  "ruleSetRevisionId",
  "schemaVersion",
  "sourceManifestId",
] as const;
const HASH_PATTERN = /^[0-9a-f]{64}$/;

export type ClinicalCatalogDescriptor = Readonly<{
  canonicalizationVersion: typeof CONTEXT_CANONICALIZATION_VERSION;
  clinicalCatalogVersion: typeof CLINICAL_CATALOG_VERSION;
  descriptorHash: string;
  hashAlgorithm: "sha256";
  ruleSetRevisionId: typeof RULE_SET_REVISION_ID;
  schemaVersion: 1;
  sourceManifestId: typeof SOURCE_MANIFEST_ID;
}>;

type HashCanonical = (value: unknown) => Promise<string>;

function object(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("invalid_clinical_catalog_descriptor");
  }
  return value as Record<string, unknown>;
}

export async function hydrateActiveClinicalCatalog(
  value: unknown,
  hashCanonical: HashCanonical,
): Promise<ClinicalCatalogDescriptor> {
  const row = object(value);
  const keys = Object.keys(row).sort();
  if (
    keys.length !== DESCRIPTOR_KEYS.length ||
    keys.some((key, index) => key !== DESCRIPTOR_KEYS[index])
  ) {
    throw new Error("invalid_clinical_catalog_descriptor");
  }

  if (
    row.canonicalizationVersion !== CONTEXT_CANONICALIZATION_VERSION ||
    row.clinicalCatalogVersion !== CLINICAL_CATALOG_VERSION ||
    row.hashAlgorithm !== "sha256" ||
    row.ruleSetRevisionId !== RULE_SET_REVISION_ID ||
    row.schemaVersion !== 1 ||
    row.sourceManifestId !== SOURCE_MANIFEST_ID
  ) {
    throw new Error("clinical_catalog_descriptor_mismatch");
  }
  if (
    typeof row.descriptorHash !== "string" ||
    !HASH_PATTERN.test(row.descriptorHash)
  ) {
    throw new Error("invalid_clinical_catalog_descriptor");
  }

  const payload = {
    canonicalizationVersion: row.canonicalizationVersion,
    clinicalCatalogVersion: row.clinicalCatalogVersion,
    hashAlgorithm: "sha256" as const,
    ruleSetRevisionId: row.ruleSetRevisionId,
    schemaVersion: 1 as const,
    sourceManifestId: row.sourceManifestId,
  };
  if (
    row.descriptorHash !== CLINICAL_CATALOG_DESCRIPTOR_HASH ||
    (await hashCanonical(payload)) !== row.descriptorHash
  ) {
    throw new Error("clinical_catalog_descriptor_hash_mismatch");
  }
  return { ...payload, descriptorHash: row.descriptorHash };
}
