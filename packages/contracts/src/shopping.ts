import { z } from "zod";

const segmenter = new Intl.Segmenter("es", { granularity: "grapheme" });
const graphemeLength = (value: string) => [...segmenter.segment(value)].length;

const LimitedTextSchema = (maximum: number) =>
  z
    .string()
    .trim()
    .min(1)
    .refine((value) => graphemeLength(value) <= maximum, "too_many_graphemes");

const CanonicalUnsignedDecimalSchema = z
  .string()
  .max(40)
  .regex(/^(?:0|[1-9]\d*)(?:\.\d*[1-9])?$/);

const CanonicalPositiveDecimalSchema = CanonicalUnsignedDecimalSchema.refine(
  (value) => value !== "0",
  "decimal_must_be_positive",
);

const FoodKeySchema = z.string().regex(/^food:[a-z0-9][a-z0-9._:-]{0,127}$/);
const Sha256Schema = z.string().regex(/^[0-9a-f]{64}$/);
const TokenSchema = z.string().regex(/^[a-z0-9][a-z0-9._-]{0,95}$/);
const NullableUuidSchema = z.uuid().nullable();

export const SUPERMARKET_CHAINS = ["mercadona", "dia", "aldi"] as const;
export const SHOPPING_MARKETS = ["ES"] as const;
export const SHOPPING_MATCH_STATES = [
  "exact",
  "allowed",
  "review",
  "excluded",
  "insufficient",
] as const;
export const SHOPPING_SORTS = [
  "normalized_price_asc",
  "price_asc",
  "price_desc",
  "name_asc",
  "name_desc",
] as const;
export const SHOPPING_PURCHASE_FORMS = [
  "dry",
  "fresh",
  "drained",
  "canned",
  "natural",
  "prepared",
  "marinated",
] as const;

export const SHOPPING_HTTP_BODY_BYTES = 16 * 1_024;
export const SHOPPING_MAX_LINES = 80;
export const SHOPPING_MAX_ALTERNATIVES = 4;

const SupermarketChainSchema = z.enum(SUPERMARKET_CHAINS);
const ShoppingMarketSchema = z.enum(SHOPPING_MARKETS);
const MatchStateSchema = z.enum(SHOPPING_MATCH_STATES);
const ShoppingSortSchema = z.enum(SHOPPING_SORTS);
const PurchaseFormSchema = z.enum(SHOPPING_PURCHASE_FORMS);

const MassMeasureSchema = z
  .object({
    dimension: z.literal("mass"),
    quantity: CanonicalPositiveDecimalSchema,
    unit: z.literal("g"),
  })
  .strict();

const VolumeMeasureSchema = z
  .object({
    dimension: z.literal("volume"),
    quantity: CanonicalPositiveDecimalSchema,
    unit: z.literal("ml"),
  })
  .strict();

const CountMeasureSchema = z
  .object({
    dimension: z.literal("count"),
    quantity: CanonicalPositiveDecimalSchema,
    unit: z.literal("unit"),
  })
  .strict();

export const SaleMeasureSchema = z.discriminatedUnion("dimension", [
  MassMeasureSchema,
  VolumeMeasureSchema,
  CountMeasureSchema,
]);

export const ConfirmedPackageSchema = z
  .object({
    equivalenceEvidenceRef: LimitedTextSchema(240).nullable(),
    equivalentEdibleMassG: CanonicalPositiveDecimalSchema.nullable(),
    saleMeasure: SaleMeasureSchema,
  })
  .strict()
  .superRefine((value, context) => {
    const hasMass = value.equivalentEdibleMassG !== null;
    const hasEvidence = value.equivalenceEvidenceRef !== null;
    if (hasMass !== hasEvidence) {
      context.addIssue({
        code: "custom",
        message: "equivalent_mass_evidence_pair_required",
      });
    }
    if (value.saleMeasure.dimension === "mass" && (hasMass || hasEvidence)) {
      context.addIssue({
        code: "custom",
        message: "mass_package_must_not_duplicate_equivalence",
      });
    }
  });

const NormalizedPriceSchema = z.discriminatedUnion("dimension", [
  z
    .object({
      dimension: z.literal("mass"),
      unit: z.literal("EUR/kg"),
      value: CanonicalPositiveDecimalSchema,
    })
    .strict(),
  z
    .object({
      dimension: z.literal("volume"),
      unit: z.literal("EUR/L"),
      value: CanonicalPositiveDecimalSchema,
    })
    .strict(),
  z
    .object({
      dimension: z.literal("count"),
      unit: z.literal("EUR/unit"),
      value: CanonicalPositiveDecimalSchema,
    })
    .strict(),
]);

const CoverageGroupSchema = z
  .object({
    groupKey: TokenSchema,
    required: z.number().int().min(1).max(80),
    usable: z.number().int().min(0).max(80),
  })
  .strict()
  .refine((value) => value.usable <= value.required, "usable_exceeds_required");

export const CatalogCoverageSchema = z
  .object({
    dynamicRequired: z.literal(20),
    dynamicUsable: z.number().int().min(0).max(20),
    fixedRequired: z.literal(60),
    fixedUsable: z.number().int().min(0).max(60),
    groups: z.array(CoverageGroupSchema).max(16),
    publishable: z.boolean(),
    totalRequired: z.literal(80),
    totalUsable: z.number().int().min(0).max(80),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.fixedUsable + value.dynamicUsable !== value.totalUsable) {
      context.addIssue({ code: "custom", message: "coverage_total_mismatch" });
    }
    const groupKeys = value.groups.map(({ groupKey }) => groupKey);
    if (new Set(groupKeys).size !== groupKeys.length) {
      context.addIssue({ code: "custom", message: "coverage_groups_not_unique" });
    }
    if (
      value.publishable &&
      (value.totalUsable < 72 ||
        value.groups.some((group) => group.usable * 4 < group.required * 3))
    ) {
      context.addIssue({ code: "custom", message: "coverage_gate_not_met" });
    }
  });

export const SupermarketSourceManifestSchema = z
  .object({
    canonicalizationVersion: TokenSchema,
    captureEvidenceRef: LimitedTextSchema(500),
    chain: SupermarketChainSchema,
    collectedAt: z.iso.datetime({ offset: true }),
    coverage: CatalogCoverageSchema,
    createdAt: z.iso.datetime({ offset: true }),
    errorCount: z.number().int().min(0).max(100_000),
    errorEvidenceRef: LimitedTextSchema(500).nullable(),
    id: z.uuid(),
    importerVersion: TokenSchema,
    licenseStatus: z.enum(["approved", "restricted", "unknown"]),
    market: ShoppingMarketSchema,
    normalizedObjectRef: LimitedTextSchema(500),
    normalizedSha256: Sha256Schema,
    priceCount: z.number().int().min(0).max(100_000),
    rawObjectRef: LimitedTextSchema(500),
    rawSha256: Sha256Schema,
    recordCount: z.number().int().min(0).max(100_000),
    schemaVersion: z.literal(1),
    sourceKind: z.enum(["csv_capture", "json_capture", "manual_export"]),
    sourceLocationInternal: LimitedTextSchema(240),
    sourceTermsStatus: z.enum(["approved", "restricted", "unknown"]),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.priceCount > value.recordCount) {
      context.addIssue({ code: "custom", message: "price_count_exceeds_records" });
    }
    if (value.errorCount > value.recordCount) {
      context.addIssue({ code: "custom", message: "error_count_exceeds_records" });
    }
  });

const SourceFieldsSchema = z
  .record(LimitedTextSchema(240), z.string().max(2_048))
  .refine((value) => Object.keys(value).length <= 200, "source_fields_limit");

export const SupermarketSourceRecordSchema = z
  .object({
    basePriceEur: CanonicalPositiveDecimalSchema.nullable(),
    captureErrorCode: TokenSchema.nullable(),
    captureStatus: z.enum(["accepted", "error"]),
    categoryPath: z.array(LimitedTextSchema(240)).max(20),
    chain: SupermarketChainSchema,
    currency: z.literal("EUR"),
    externalSku: LimitedTextSchema(240),
    formatText: LimitedTextSchema(240).nullable(),
    gtin14: z
      .string()
      .regex(/^\d{14}$/)
      .nullable(),
    market: ShoppingMarketSchema,
    name: LimitedTextSchema(240),
    package: ConfirmedPackageSchema.nullable(),
    purchaseForm: PurchaseFormSchema,
    schemaVersion: z.literal(1),
    sourceFields: SourceFieldsSchema,
    sourceRecordIndex: z.number().int().min(1).max(100_000),
  })
  .strict()
  .superRefine((value, context) => {
    if ((value.captureStatus === "error") !== (value.captureErrorCode !== null)) {
      context.addIssue({ code: "custom", message: "capture_error_state_mismatch" });
    }
  });

export const CatalogSkuProjectionSchema = z
  .object({
    basePriceEur: CanonicalPositiveDecimalSchema.nullable(),
    categoryPath: z.array(LimitedTextSchema(240)).max(20),
    chain: SupermarketChainSchema,
    exclusionReasons: z.array(TokenSchema).max(20),
    externalSku: LimitedTextSchema(240),
    formatText: LimitedTextSchema(240).nullable(),
    gtin14: z
      .string()
      .regex(/^\d{14}$/)
      .nullable(),
    market: ShoppingMarketSchema,
    name: LimitedTextSchema(240),
    normalizedPrice: NormalizedPriceSchema.nullable(),
    package: ConfirmedPackageSchema.nullable(),
    purchaseForm: PurchaseFormSchema,
    schemaVersion: z.literal(1),
    skuId: z.uuid(),
    usability: z.enum(["visible", "calculable"]),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.usability === "calculable" &&
      (value.basePriceEur === null || value.package === null)
    ) {
      context.addIssue({ code: "custom", message: "calculable_sku_data_missing" });
    }
    if (
      value.usability === "calculable" &&
      value.package?.saleMeasure.dimension !== "mass" &&
      value.package?.equivalentEdibleMassG === null
    ) {
      context.addIssue({ code: "custom", message: "calculable_sku_mass_missing" });
    }
    if (
      value.normalizedPrice !== null &&
      value.package !== null &&
      value.normalizedPrice.dimension !== value.package.saleMeasure.dimension
    ) {
      context.addIssue({
        code: "custom",
        message: "normalized_price_dimension_mismatch",
      });
    }
  });

const ShoppingPreferenceShape = {
  comparedChains: z.array(SupermarketChainSchema).max(SUPERMARKET_CHAINS.length),
  mode: z.enum(["single", "multistore"]),
  preferredChain: SupermarketChainSchema,
  sorting: ShoppingSortSchema,
} as const;

function validatePreference(
  value: {
    comparedChains: readonly SupermarketChain[];
    mode: "single" | "multistore";
    preferredChain: SupermarketChain;
  },
  context: z.RefinementCtx,
): void {
  if (new Set(value.comparedChains).size !== value.comparedChains.length) {
    context.addIssue({ code: "custom", message: "compared_chains_not_unique" });
  }
  if (value.mode === "single" && value.comparedChains.length !== 0) {
    context.addIssue({
      code: "custom",
      message: "single_mode_compared_chains_forbidden",
    });
  }
  if (
    value.mode === "multistore" &&
    (value.comparedChains.length < 2 ||
      !value.comparedChains.includes(value.preferredChain))
  ) {
    context.addIssue({ code: "custom", message: "multistore_chains_invalid" });
  }
}

export const ShoppingPreferencePutSchema = z
  .object({
    ...ShoppingPreferenceShape,
    expectedVersion: z.number().int().min(1).nullable(),
    schemaVersion: z.literal(1),
  })
  .strict()
  .superRefine(validatePreference);

export const ShoppingPreferenceRevisionSchema = z
  .object({
    ...ShoppingPreferenceShape,
    createdAt: z.iso.datetime({ offset: true }),
    createdBy: z.uuid(),
    id: z.uuid(),
    profileId: z.uuid(),
    schemaVersion: z.literal(1),
    supersedesId: NullableUuidSchema,
    version: z.number().int().min(1),
  })
  .strict()
  .superRefine(validatePreference);

const ShoppingListLineSchema = z
  .object({
    amountG: CanonicalPositiveDecimalSchema,
    canonicalFoodKey: FoodKeySchema,
    foodState: z.enum(["raw", "cooked", "unspecified"]),
    name: LimitedTextSchema(240),
    purchaseForm: PurchaseFormSchema,
  })
  .strict();

const ShoppingCatalogItemSchema = z
  .object({
    canonicalFoodKey: FoodKeySchema,
    matchState: MatchStateSchema,
    projection: CatalogSkuProjectionSchema,
  })
  .strict();

const ConfirmedLeftoverSchema = z
  .object({
    canonicalFoodKey: FoodKeySchema,
    confirmedEquivalentG: CanonicalPositiveDecimalSchema,
    evidenceRef: LimitedTextSchema(240).nullable(),
  })
  .strict();

const ManualShoppingSelectionSchema = z
  .object({
    canonicalFoodKey: FoodKeySchema,
    skuId: z.uuid(),
  })
  .strict();

export const ShoppingResolutionInputSchema = z
  .object({
    basketSeedRevisionId: z.uuid(),
    catalogItems: z.array(ShoppingCatalogItemSchema).max(400),
    catalogPublicationIds: z.array(z.uuid()).min(1).max(3),
    leftovers: z.array(ConfirmedLeftoverSchema).max(SHOPPING_MAX_LINES),
    manualSelections: z.array(ManualShoppingSelectionSchema).max(SHOPPING_MAX_LINES),
    planVersionId: z.uuid(),
    preferenceRevision: ShoppingPreferenceRevisionSchema,
    profileId: z.uuid(),
    schemaVersion: z.literal(1),
    shoppingList: z.array(ShoppingListLineSchema).min(1).max(SHOPPING_MAX_LINES),
  })
  .strict()
  .superRefine((value, context) => {
    const uniquenessChecks: readonly [readonly string[], string][] = [
      [value.catalogPublicationIds, "catalog_publications_not_unique"],
      [
        value.shoppingList.map(({ canonicalFoodKey }) => canonicalFoodKey),
        "shopping_lines_not_unique",
      ],
      [
        value.leftovers.map(({ canonicalFoodKey }) => canonicalFoodKey),
        "shopping_leftovers_not_unique",
      ],
      [
        value.manualSelections.map(({ canonicalFoodKey }) => canonicalFoodKey),
        "shopping_selections_not_unique",
      ],
      [
        value.catalogItems.map(({ projection }) => projection.skuId),
        "shopping_catalog_skus_not_unique",
      ],
    ];
    for (const [values, message] of uniquenessChecks) {
      if (new Set(values).size !== values.length) {
        context.addIssue({ code: "custom", message });
      }
    }
    if (value.preferenceRevision.profileId !== value.profileId) {
      context.addIssue({ code: "custom", message: "shopping_profile_mismatch" });
    }
    const itemCounts = new Map<string, number>();
    for (const item of value.catalogItems) {
      const count = (itemCounts.get(item.canonicalFoodKey) ?? 0) + 1;
      itemCounts.set(item.canonicalFoodKey, count);
      if (count > SHOPPING_MAX_ALTERNATIVES + 1) {
        context.addIssue({ code: "custom", message: "shopping_catalog_options_limit" });
        break;
      }
    }
  });

const ShoppingSelectionSchema = z
  .object({
    estimatedRemainderG: CanonicalUnsignedDecimalSchema,
    packageCount: CanonicalPositiveDecimalSchema.refine(
      (value) => !value.includes("."),
      "package_count_must_be_integer",
    ),
    projection: CatalogSkuProjectionSchema,
    requiredAfterLeftoverG: CanonicalUnsignedDecimalSchema,
    totalCostEur: CanonicalUnsignedDecimalSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (value.projection.usability !== "calculable") {
      context.addIssue({ code: "custom", message: "selected_sku_not_calculable" });
    }
  });

const ShoppingSnapshotItemSchema = z
  .object({
    alternatives: z.array(CatalogSkuProjectionSchema).max(SHOPPING_MAX_ALTERNATIVES),
    amountG: CanonicalPositiveDecimalSchema,
    canonicalFoodKey: FoodKeySchema,
    name: LimitedTextSchema(240),
    selected: ShoppingSelectionSchema.nullable(),
    shoppingItemId: z.uuid(),
    state: z.enum([
      "resolved",
      "price_unavailable",
      "package_unconfirmed",
      "no_confirmed_product",
    ]),
    uncertainties: z.array(TokenSchema).max(20),
  })
  .strict()
  .superRefine((value, context) => {
    if ((value.state === "resolved") !== (value.selected !== null)) {
      context.addIssue({ code: "custom", message: "shopping_item_state_mismatch" });
    }
  });

export const ShoppingSnapshotSchema = z
  .object({
    basketSeedRevisionId: z.uuid(),
    catalogPublicationIds: z.array(z.uuid()).min(1).max(3),
    completeness: z.enum(["complete", "partial"]),
    createdAt: z.iso.datetime({ offset: true }),
    createdBy: z.uuid(),
    id: z.uuid(),
    inputDigest: Sha256Schema,
    items: z.array(ShoppingSnapshotItemSchema).min(1).max(SHOPPING_MAX_LINES),
    planVersionId: z.uuid(),
    preferenceRevisionId: z.uuid(),
    profileId: z.uuid(),
    resolverVersion: TokenSchema,
    revision: z.number().int().min(1),
    schemaVersion: z.literal(1),
    status: z.enum(["active", "archived"]),
    supersedesId: NullableUuidSchema,
    totals: z
      .object({
        resolvedItems: z.number().int().min(0).max(SHOPPING_MAX_LINES),
        subtotalEur: CanonicalUnsignedDecimalSchema,
        unresolvedItems: z.number().int().min(0).max(SHOPPING_MAX_LINES),
      })
      .strict(),
  })
  .strict()
  .superRefine((value, context) => {
    const ids = value.items.map(({ shoppingItemId }) => shoppingItemId);
    if (new Set(ids).size !== ids.length) {
      context.addIssue({ code: "custom", message: "shopping_item_ids_not_unique" });
    }
    const resolved = value.items.filter(({ state }) => state === "resolved").length;
    const unresolved = value.items.length - resolved;
    if (
      resolved !== value.totals.resolvedItems ||
      unresolved !== value.totals.unresolvedItems
    ) {
      context.addIssue({ code: "custom", message: "shopping_totals_count_mismatch" });
    }
    if ((value.completeness === "complete") !== (unresolved === 0)) {
      context.addIssue({ code: "custom", message: "shopping_completeness_mismatch" });
    }
  });

export const ShoppingCreateRequestSchema = z
  .object({
    preferenceRevisionId: z.uuid(),
    schemaVersion: z.literal(1),
  })
  .strict();

export const ShoppingLeftoverRequestSchema = z
  .object({
    canonicalFoodKey: FoodKeySchema,
    declaredMeasure: SaleMeasureSchema,
    expectedVersion: z.number().int().min(1),
    schemaVersion: z.literal(1),
    skuRevisionId: z.uuid().optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.declaredMeasure.dimension !== "mass" &&
      value.skuRevisionId === undefined
    ) {
      context.addIssue({
        code: "custom",
        message: "leftover_sku_revision_required_for_equivalence",
      });
    }
  });

export const ShoppingProductSelectionRequestSchema = z
  .object({
    canonicalFoodKey: FoodKeySchema,
    expectedVersion: z.number().int().min(1),
    schemaVersion: z.literal(1),
    skuId: z.uuid(),
  })
  .strict();

export const ShoppingPreferenceAckSchema = z
  .object({
    preferenceRevisionId: z.uuid(),
    schemaVersion: z.literal(1),
    version: z.number().int().min(1),
  })
  .strict();

export const ShoppingMutationAckSchema = z
  .object({
    schemaVersion: z.literal(1),
    snapshotId: z.uuid(),
    status: z.enum(["active", "archived"]),
    version: z.number().int().min(1),
  })
  .strict();

export type SupermarketChain = (typeof SUPERMARKET_CHAINS)[number];
export type ShoppingMarket = (typeof SHOPPING_MARKETS)[number];
export type MatchState = (typeof SHOPPING_MATCH_STATES)[number];
export type ShoppingSort = (typeof SHOPPING_SORTS)[number];
export type ShoppingPurchaseForm = (typeof SHOPPING_PURCHASE_FORMS)[number];
export type SaleMeasure = z.infer<typeof SaleMeasureSchema>;
export type ConfirmedPackage = z.infer<typeof ConfirmedPackageSchema>;
export type CatalogCoverage = z.infer<typeof CatalogCoverageSchema>;
export type SupermarketSourceManifest = z.infer<typeof SupermarketSourceManifestSchema>;
export type SupermarketSourceRecord = z.infer<typeof SupermarketSourceRecordSchema>;
export type CatalogSkuProjection = z.infer<typeof CatalogSkuProjectionSchema>;
export type ShoppingPreferencePut = z.infer<typeof ShoppingPreferencePutSchema>;
export type ShoppingPreferenceRevision = z.infer<
  typeof ShoppingPreferenceRevisionSchema
>;
export type ShoppingResolutionInput = z.infer<typeof ShoppingResolutionInputSchema>;
export type ShoppingSnapshot = z.infer<typeof ShoppingSnapshotSchema>;
export type ShoppingCreateRequest = z.infer<typeof ShoppingCreateRequestSchema>;
export type ShoppingLeftoverRequest = z.infer<typeof ShoppingLeftoverRequestSchema>;
export type ShoppingProductSelectionRequest = z.infer<
  typeof ShoppingProductSelectionRequestSchema
>;
export type ShoppingPreferenceAck = z.infer<typeof ShoppingPreferenceAckSchema>;
export type ShoppingMutationAck = z.infer<typeof ShoppingMutationAckSchema>;
