import {
  AdminCatalogRevisionListSchema,
  AdminSupermarketMatchingRuleListSchema,
  type AdminCatalogRevisionList,
  type AdminSupermarketMatchingRuleList,
} from "@health-design/contracts";
import {
  generateSupermarketMatchCandidates,
  type MatchFoodState,
  type SupermarketMatchTarget,
} from "@health-design/catalog/supermarkets";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HEX_64_PATTERN = /^[a-f0-9]{64}$/;
const CHAINS = new Set(["mercadona", "dia", "aldi"]);
const STATES = new Set(["quarantine", "review", "publishable", "published", "hidden"]);

export type CatalogAdminRoute =
  | {
      chain: string | null;
      cursor: string | null;
      kind: "catalog-revisions-list";
      state: string | null;
    }
  | { catalogRevisionId: string; kind: "catalog-match-candidates" }
  | { catalogRevisionId: string; kind: "catalog-publish" }
  | { catalogPublicationId: string; kind: "catalog-publication-hide" }
  | {
      catalogRevisionId: string;
      cursor: string | null;
      kind: "supermarket-matching-rules-list";
    }
  | { kind: "supermarket-matching-rule-review"; matchingRuleId: string };

export class CatalogAdminInputError extends Error {}

type MatchInputSku = Readonly<{
  allergenData: "known" | "unknown";
  categoryPath: string[];
  crossContactData: "known" | "unknown";
  excludedTerms: string[];
  externalSku: string;
  foodState: MatchFoodState;
  formatText: string | null;
  gtinFoodKey: string | null;
  ingredients: string[];
  name: string;
  purchaseForm: SupermarketMatchTarget["purchaseForm"];
  skuContentHash: string;
  skuId: string;
}>;

type MatchInputPayload = Readonly<{
  basketSeedRevisionId: string;
  skus: MatchInputSku[];
  targets: SupermarketMatchTarget[];
}>;

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    throw new Error("invalid_catalog_match_input");
  }
  const result: string[] = [];
  for (const entry of value as unknown[]) {
    if (typeof entry !== "string") {
      throw new Error("invalid_catalog_match_input");
    }
    result.push(entry);
  }
  return result;
}

function matchInputPayload(value: unknown): MatchInputPayload {
  const direct = Array.isArray(value) ? undefined : value;
  const payload =
    direct && typeof direct === "object" && !Array.isArray(direct)
      ? direct
      : rows(value)[0]?.payload;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("invalid_catalog_match_input");
  }
  const candidate = payload as Record<string, unknown>;
  if (
    typeof candidate.basketSeedRevisionId !== "string" ||
    !UUID_PATTERN.test(candidate.basketSeedRevisionId) ||
    !Array.isArray(candidate.skus) ||
    !Array.isArray(candidate.targets)
  ) {
    throw new Error("invalid_catalog_match_input");
  }
  const skus = candidate.skus.map((raw): MatchInputSku => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw new Error("invalid_catalog_match_input");
    }
    const sku = raw as Record<string, unknown>;
    if (
      (sku.allergenData !== "known" && sku.allergenData !== "unknown") ||
      (sku.crossContactData !== "known" && sku.crossContactData !== "unknown") ||
      (sku.foodState !== "raw" &&
        sku.foodState !== "cooked" &&
        sku.foodState !== "unspecified") ||
      typeof sku.externalSku !== "string" ||
      typeof sku.name !== "string" ||
      typeof sku.skuId !== "string" ||
      !UUID_PATTERN.test(sku.skuId) ||
      typeof sku.skuContentHash !== "string" ||
      !HEX_64_PATTERN.test(sku.skuContentHash) ||
      (sku.formatText !== null && typeof sku.formatText !== "string") ||
      (sku.gtinFoodKey !== null && typeof sku.gtinFoodKey !== "string") ||
      ![
        "dry",
        "fresh",
        "drained",
        "canned",
        "natural",
        "prepared",
        "marinated",
      ].includes(String(sku.purchaseForm))
    ) {
      throw new Error("invalid_catalog_match_input");
    }
    return {
      allergenData: sku.allergenData,
      categoryPath: stringArray(sku.categoryPath),
      crossContactData: sku.crossContactData,
      excludedTerms: stringArray(sku.excludedTerms),
      externalSku: sku.externalSku,
      foodState: sku.foodState,
      formatText: sku.formatText,
      gtinFoodKey: sku.gtinFoodKey,
      ingredients: stringArray(sku.ingredients),
      name: sku.name,
      purchaseForm: sku.purchaseForm as MatchInputSku["purchaseForm"],
      skuContentHash: sku.skuContentHash,
      skuId: sku.skuId,
    };
  });
  const targets = candidate.targets.map((raw): SupermarketMatchTarget => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw new Error("invalid_catalog_match_input");
    }
    const target = raw as Record<string, unknown>;
    if (
      typeof target.canonicalFoodKey !== "string" ||
      typeof target.ediblePart !== "string" ||
      typeof target.name !== "string" ||
      (target.foodState !== "raw" &&
        target.foodState !== "cooked" &&
        target.foodState !== "unspecified") ||
      ![
        "dry",
        "fresh",
        "drained",
        "canned",
        "natural",
        "prepared",
        "marinated",
      ].includes(String(target.purchaseForm))
    ) {
      throw new Error("invalid_catalog_match_input");
    }
    return {
      canonicalFoodKey: target.canonicalFoodKey,
      categoryTerms: stringArray(target.categoryTerms),
      ediblePart: target.ediblePart,
      foodState: target.foodState,
      name: target.name,
      purchaseForm: target.purchaseForm as SupermarketMatchTarget["purchaseForm"],
    };
  });
  return { basketSeedRevisionId: candidate.basketSeedRevisionId, skus, targets };
}

export function supermarketMatchCandidateBatchFromRows(value: unknown): {
  basketSeedRevisionId: string;
  candidates: unknown[];
  processedSkus: ReadonlyArray<{ skuContentHash: string; skuId: string }>;
} {
  const { basketSeedRevisionId, skus, targets } = matchInputPayload(value);
  const candidates: unknown[] = [];
  const processedSkus: Array<{ skuContentHash: string; skuId: string }> = [];
  for (const sku of skus) {
    const skuCandidates = targets
      .flatMap((target) =>
        generateSupermarketMatchCandidates({
          ...sku,
          gtinConsistency:
            sku.gtinFoodKey === null
              ? "not_available"
              : sku.gtinFoodKey === target.canonicalFoodKey
                ? "consistent"
                : "conflict",
          targets: [target],
        }).map((candidate) => ({
          ...candidate,
          evidence: ["deterministic-candidate", candidate.reason],
          exclusions: candidate.matchState === "excluded" ? [candidate.reason] : [],
          foodState: target.foodState,
          purchaseForm: target.purchaseForm,
          skuContentHash: sku.skuContentHash,
          skuId: sku.skuId,
        })),
      )
      .sort(
        (left, right) =>
          left.skuId.localeCompare(right.skuId) ||
          left.canonicalFoodKey.localeCompare(right.canonicalFoodKey),
      );
    if (candidates.length + skuCandidates.length > 1_000) break;
    candidates.push(...skuCandidates);
    processedSkus.push({
      skuContentHash: sku.skuContentHash,
      skuId: sku.skuId,
    });
  }
  return { basketSeedRevisionId, candidates, processedSkus };
}

export function parseCatalogAdminRoute(url: URL): CatalogAdminRoute | null {
  const path = url.pathname;
  if (path.endsWith("/v1/admin/catalog-revisions")) {
    const keys = [...url.searchParams.keys()];
    if (
      keys.some((key) => key !== "chain" && key !== "state" && key !== "cursor") ||
      new Set(keys).size !== keys.length
    ) {
      throw new CatalogAdminInputError("invalid_query");
    }
    const chain = url.searchParams.get("chain");
    const state = url.searchParams.get("state");
    const cursor = url.searchParams.get("cursor");
    if (
      (chain !== null && !CHAINS.has(chain)) ||
      (state !== null && !STATES.has(state)) ||
      (cursor !== null && !UUID_PATTERN.test(cursor))
    ) {
      throw new CatalogAdminInputError("invalid_query");
    }
    return { chain, cursor, kind: "catalog-revisions-list", state };
  }

  if (path.endsWith("/v1/admin/matching-rules")) {
    const keys = [...url.searchParams.keys()];
    if (
      keys.some((key) => key !== "catalogRevisionId" && key !== "cursor") ||
      new Set(keys).size !== keys.length
    ) {
      throw new CatalogAdminInputError("invalid_query");
    }
    const catalogRevisionId = url.searchParams.get("catalogRevisionId");
    const cursor = url.searchParams.get("cursor");
    if (
      !catalogRevisionId ||
      !UUID_PATTERN.test(catalogRevisionId) ||
      (cursor !== null && !UUID_PATTERN.test(cursor))
    ) {
      throw new CatalogAdminInputError("invalid_query");
    }
    return { catalogRevisionId, cursor, kind: "supermarket-matching-rules-list" };
  }

  const matchingRule = path.match(
    /\/v1\/admin\/matching-rules\/([0-9a-f-]{36})\/review$/i,
  );
  if (matchingRule?.[1] && UUID_PATTERN.test(matchingRule[1])) {
    return {
      kind: "supermarket-matching-rule-review",
      matchingRuleId: matchingRule[1],
    };
  }

  const revision = path.match(
    /\/v1\/admin\/catalog-revisions\/([0-9a-f-]{36})\/(match-candidates|publish)$/i,
  );
  if (revision?.[1] && UUID_PATTERN.test(revision[1])) {
    return revision[2] === "match-candidates"
      ? { catalogRevisionId: revision[1], kind: "catalog-match-candidates" }
      : { catalogRevisionId: revision[1], kind: "catalog-publish" };
  }

  const publication = path.match(
    /\/v1\/admin\/catalog-publications\/([0-9a-f-]{36})\/hide$/i,
  );
  if (publication?.[1] && UUID_PATTERN.test(publication[1])) {
    return {
      catalogPublicationId: publication[1],
      kind: "catalog-publication-hide",
    };
  }
  return null;
}

export function adminSupermarketMatchingRuleListFromRows(
  value: unknown,
): AdminSupermarketMatchingRuleList {
  const source = rows(value);
  const cursorCandidate = source[49]?.matching_rule_id;
  return AdminSupermarketMatchingRuleListSchema.parse({
    items: source.slice(0, 50).map((row) => ({
      canonicalFoodKey: row.canonical_food_key,
      canonicalFoodName: row.canonical_food_name,
      chain: row.chain,
      criticalIssueOpen: row.critical_issue_open,
      externalSku: row.external_sku,
      foodState: row.food_state,
      gtinConsistency: row.gtin_consistency,
      matchState: row.match_state,
      matchingRuleId: row.matching_rule_id,
      purchaseForm: row.purchase_form,
      reasons: row.reasons,
      reviewed: row.reviewed,
      schemaVersion: 1,
      skuName: row.sku_name,
      status: row.status,
      version: row.version,
    })),
    nextCursor:
      source.length > 50 && typeof cursorCandidate === "string"
        ? cursorCandidate
        : null,
    schemaVersion: 1,
  });
}

function byteaHex(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") throw new Error("invalid_catalog_admin_row");
  const normalized = value.startsWith("\\x") ? value.slice(2) : value;
  if (!HEX_64_PATTERN.test(normalized)) {
    throw new Error("invalid_catalog_admin_row");
  }
  return normalized;
}

function rows(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) throw new Error("invalid_catalog_admin_rows");
  return value.map((row) => {
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      throw new Error("invalid_catalog_admin_row");
    }
    return row as Record<string, unknown>;
  });
}

export function adminCatalogRevisionListFromRows(
  value: unknown,
): AdminCatalogRevisionList {
  const source = rows(value);
  const items = source.slice(0, 50).map((row) => ({
    activePublicationId: row.active_publication_id,
    basketSeedHash: byteaHex(row.basket_seed_hash),
    basketSeedRevisionId: row.basket_seed_revision_id,
    catalogHash: byteaHex(row.catalog_hash),
    catalogRevisionId: row.catalog_revision_id,
    chain: row.chain,
    coverage: row.coverage,
    coverageHash: byteaHex(row.coverage_hash),
    manifest: {
      errorCount: row.error_count,
      licenseStatus: row.license_status,
      recordCount: row.record_count,
      sourceTermsStatus: row.source_terms_status,
    },
    publicationVersion: row.publication_version,
    qualityStatus: row.quality_status,
    revisionNumber: row.revision_number,
    schemaVersion: 1,
    sourceDecisionReady:
      row.license_status !== "unknown" && row.source_terms_status !== "unknown",
    state: row.state,
    usableCount: row.usable_count,
  }));
  const cursorCandidate = source[49]?.catalog_revision_id;
  const nextCursor =
    source.length > 50 && typeof cursorCandidate === "string" ? cursorCandidate : null;
  return AdminCatalogRevisionListSchema.parse({ items, nextCursor, schemaVersion: 1 });
}
