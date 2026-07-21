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

export const PRODUCT_SYMBOLOGIES = [
  "ean_8",
  "ean_13",
  "upc_a",
  "upc_e",
  "itf_14",
] as const;

export const PRODUCT_NUTRITION_BASES = ["per_100_g", "per_100_ml"] as const;

export const COMMERCIAL_PRODUCT_SOURCES = [
  "profile",
  "global",
  "confirmed_label",
  "open_food_facts",
  "manual_blank",
] as const;

export const COMMERCIAL_PRODUCT_COMPLETENESS = [
  "complete",
  "provisional",
  "insufficient",
] as const;

export const ProductGtinSchema = z
  .object({
    displayGtin: z.string().regex(/^\d{8}$|^\d{12}$|^\d{13}$|^\d{14}$/),
    gtin14: z.string().regex(/^\d{14}$/),
    symbology: z.enum(PRODUCT_SYMBOLOGIES),
  })
  .strict();

const ProductNutrientUnitSchema = z.enum(["g", "kcal", "mg", "ug"]);

const KnownProductNutrientValueSchema = z
  .object({
    state: z.literal("known"),
    unit: ProductNutrientUnitSchema,
    value: CanonicalUnsignedDecimalSchema,
  })
  .strict();

const EstimatedProductNutrientValueSchema = z
  .object({
    estimation: z
      .object({
        method: z.enum(["confirmed_conversion", "estimated_from_canonical"]),
        sourceRef: LimitedTextSchema(160),
      })
      .strict(),
    state: z.literal("estimated"),
    unit: ProductNutrientUnitSchema,
    value: CanonicalUnsignedDecimalSchema,
  })
  .strict();

const UnknownProductNutrientValueSchema = z
  .object({ state: z.literal("unknown") })
  .strict();

export const ProductNutrientValueSchema = z.discriminatedUnion("state", [
  KnownProductNutrientValueSchema,
  EstimatedProductNutrientValueSchema,
  UnknownProductNutrientValueSchema,
]);

const ClinicalNutrientsSchema = z
  .record(z.string().regex(/^[a-z][a-z0-9_]{0,63}$/), ProductNutrientValueSchema)
  .refine((values) => Object.keys(values).length <= 64, "clinical_nutrients_limit");

const KnownStructuredTextListSchema = z
  .object({
    state: z.literal("known"),
    values: z.array(LimitedTextSchema(300)).max(100),
  })
  .strict();

export const ProductStructuredTextListSchema = z.discriminatedUnion("state", [
  KnownStructuredTextListSchema,
  z.object({ state: z.literal("unknown") }).strict(),
]);

const ProductPackageSchema = z
  .object({
    amount: CanonicalUnsignedDecimalSchema.optional(),
    description: LimitedTextSchema(160).optional(),
    unit: z.enum(["g", "kg", "ml", "l", "unit"]).optional(),
  })
  .strict()
  .refine(
    (value) => (value.amount === undefined) === (value.unit === undefined),
    "package_amount_unit_pair_required",
  );

export const ProductDensitySchema = z.discriminatedUnion("state", [
  z
    .object({
      gramsPerMl: CanonicalUnsignedDecimalSchema.refine(
        (value) => value !== "0",
        "density_must_be_positive",
      ),
      sourceRef: LimitedTextSchema(160),
      state: z.literal("known"),
    })
    .strict(),
  z.object({ state: z.literal("unknown") }).strict(),
]);

const ProductNutrientsSchema = z
  .object({
    carbohydratesG: ProductNutrientValueSchema,
    clinical: ClinicalNutrientsSchema,
    energyKcal: ProductNutrientValueSchema,
    fatG: ProductNutrientValueSchema,
    fiberG: ProductNutrientValueSchema,
    proteinG: ProductNutrientValueSchema,
    saltG: ProductNutrientValueSchema,
    saturatedFatG: ProductNutrientValueSchema,
    sugarsG: ProductNutrientValueSchema,
  })
  .strict()
  .superRefine((nutrients, context) => {
    const expectedUnits = {
      carbohydratesG: "g",
      energyKcal: "kcal",
      fatG: "g",
      fiberG: "g",
      proteinG: "g",
      saltG: "g",
      saturatedFatG: "g",
      sugarsG: "g",
    } as const;
    for (const [key, expectedUnit] of Object.entries(expectedUnits)) {
      const nutrient = nutrients[key as keyof typeof expectedUnits];
      if (nutrient.state !== "unknown" && nutrient.unit !== expectedUnit) {
        context.addIssue({
          code: "custom",
          message: "product_nutrient_unit_mismatch",
          path: [key, "unit"],
        });
      }
    }
  });

export const CommercialProductSnapshotSchema = z
  .object({
    basis: z.enum(PRODUCT_NUTRITION_BASES),
    brand: LimitedTextSchema(200).optional(),
    density: ProductDensitySchema,
    gtin: ProductGtinSchema,
    name: LimitedTextSchema(200),
    nutrients: ProductNutrientsSchema,
    package: ProductPackageSchema.optional(),
    safety: z
      .object({
        allergens: ProductStructuredTextListSchema,
        crossContactAllergens: ProductStructuredTextListSchema,
        ingredients: ProductStructuredTextListSchema,
      })
      .strict(),
    schemaVersion: z.literal(1),
  })
  .strict();

const ContentHashSchema = z.string().regex(/^[0-9a-f]{64}$/);
const ProductUncertaintiesSchema = z
  .array(z.string().regex(/^[a-z][A-Za-z0-9_]{0,95}$/))
  .max(50);

export const ProductMatchingSummarySchema = z
  .object({
    canonicalFoodKey: z.string().regex(/^food:[a-z0-9][a-z0-9._:-]{0,127}$/),
    messageKey: z.string().min(1).max(160),
    state: z.enum(["exact", "allowed", "review", "excluded", "insufficient"]),
  })
  .strict();

export const ProductResolutionResponseSchema = z
  .object({
    completeness: z.enum(COMMERCIAL_PRODUCT_COMPLETENESS),
    confirmedForProfile: z.boolean(),
    contentHash: ContentHashSchema.nullable(),
    gtin: ProductGtinSchema,
    matching: ProductMatchingSummarySchema.nullable(),
    revisionId: z.uuid().nullable(),
    schemaVersion: z.literal(1),
    snapshot: CommercialProductSnapshotSchema.nullable(),
    source: z.enum(COMMERCIAL_PRODUCT_SOURCES),
    sourceAvailability: z.enum(["available", "not_found", "unavailable"]),
    uncertainties: ProductUncertaintiesSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.source === "manual_blank" &&
      (value.snapshot !== null ||
        value.contentHash !== null ||
        value.revisionId !== null ||
        value.completeness !== "insufficient")
    ) {
      context.addIssue({ code: "custom", message: "manual_blank_must_be_empty" });
    }
    if (
      (value.source === "profile" ||
        value.source === "global" ||
        value.source === "confirmed_label") &&
      (value.snapshot === null ||
        value.contentHash === null ||
        value.revisionId === null)
    ) {
      context.addIssue({ code: "custom", message: "internal_revision_required" });
    }
  });

export const ProductConfirmationRequestSchema = z
  .object({
    baseRevisionId: z.uuid().optional(),
    expectedContentHash: ContentHashSchema.optional(),
    schemaVersion: z.literal(1),
    snapshot: CommercialProductSnapshotSchema,
  })
  .strict();

export const ProductConfirmationAckSchema = z
  .object({
    completeness: z.enum(COMMERCIAL_PRODUCT_COMPLETENESS),
    confirmationId: z.uuid(),
    confirmedAt: z.iso.datetime({ offset: true }),
    correctionId: z.uuid().nullable(),
    productId: z.uuid(),
    reusedRevision: z.boolean(),
    revisionId: z.uuid(),
    schemaVersion: z.literal(1),
    scope: z.literal("profile"),
  })
  .strict();

export const ConfirmedProductApplicationSchema = z
  .object({
    completeness: z.enum(COMMERCIAL_PRODUCT_COMPLETENESS),
    confirmationId: z.uuid(),
    contentHash: ContentHashSchema,
    manifestId: z.uuid(),
    matching: ProductMatchingSummarySchema,
    productId: z.uuid(),
    revisionId: z.uuid(),
    schemaVersion: z.literal(1),
    snapshot: CommercialProductSnapshotSchema,
  })
  .strict();

export const ADMIN_BARCODE_CORRECTION_STATUSES = [
  "pending",
  "approved",
  "rejected",
  "superseded",
] as const;

export const ADMIN_BARCODE_REJECTION_REASONS = [
  "duplicate",
  "insufficient_evidence",
  "invalid_data",
  "safety_risk",
] as const;

const AdminBarcodeCorrectionSummarySchema = z
  .object({
    brand: LimitedTextSchema(200).optional(),
    completeness: z.enum(COMMERCIAL_PRODUCT_COMPLETENESS),
    correctionId: z.uuid(),
    createdAt: z.iso.datetime({ offset: true }),
    duplicateCount: z.number().int().min(1).max(10_000),
    gtin14: z.string().regex(/^\d{14}$/),
    name: LimitedTextSchema(200),
    profileId: z.uuid(),
    status: z.enum(ADMIN_BARCODE_CORRECTION_STATUSES),
    version: z.number().int().min(1),
  })
  .strict();

export const AdminBarcodeCorrectionListSchema = z
  .object({
    items: z.array(AdminBarcodeCorrectionSummarySchema).max(50),
    nextCursor: z.uuid().nullable(),
    schemaVersion: z.literal(1),
  })
  .strict();

export const AdminBarcodeCorrectionDetailSchema = z
  .object({
    baseSnapshot: CommercialProductSnapshotSchema.nullable(),
    correctionId: z.uuid(),
    createdAt: z.iso.datetime({ offset: true }),
    globalSnapshot: CommercialProductSnapshotSchema.nullable(),
    profileId: z.uuid(),
    productId: z.uuid(),
    proposedSnapshot: CommercialProductSnapshotSchema,
    reviewRevisionId: z.uuid(),
    schemaVersion: z.literal(1),
    status: z.enum(ADMIN_BARCODE_CORRECTION_STATUSES),
    version: z.number().int().min(1),
  })
  .strict();

const AdminProductMutationBaseSchema = z
  .object({
    expectedVersion: z.number().int().min(1),
    schemaVersion: z.literal(1),
  })
  .strict();

export const AdminBarcodeCorrectionRequestSchema =
  AdminProductMutationBaseSchema.extend({
    snapshot: CommercialProductSnapshotSchema,
  }).strict();

export const AdminBarcodeCorrectionApproveRequestSchema =
  AdminProductMutationBaseSchema.extend({
    canonicalFoodKey: z.string().regex(/^food:[a-z0-9][a-z0-9._:-]{0,127}$/),
    evidence: z.array(LimitedTextSchema(300)).min(1).max(20),
    matchState: z.enum(["exact", "allowed", "review", "excluded", "insufficient"]),
  }).strict();

export const AdminBarcodeCorrectionRejectRequestSchema =
  AdminProductMutationBaseSchema.extend({
    reason: z.enum(ADMIN_BARCODE_REJECTION_REASONS),
  }).strict();

export const AdminMatchingRuleActivateRequestSchema = AdminProductMutationBaseSchema;

export const AdminBarcodeCorrectionMutationAckSchema = z
  .object({
    auditClosure: z.literal("pending").optional(),
    correctionId: z.uuid(),
    globalRevisionId: z.uuid().nullable(),
    matchingRuleId: z.uuid().nullable(),
    schemaVersion: z.literal(1),
    status: z.enum(ADMIN_BARCODE_CORRECTION_STATUSES),
    version: z.number().int().min(1),
  })
  .strict();

export const AdminMatchingRuleMutationAckSchema = z
  .object({
    auditClosure: z.literal("pending").optional(),
    matchingRuleId: z.uuid(),
    schemaVersion: z.literal(1),
    status: z.enum(["active", "draft", "superseded", "withdrawn"]),
    version: z.number().int().min(1),
  })
  .strict();

export type ProductSymbology = (typeof PRODUCT_SYMBOLOGIES)[number];
export type ProductGtin = z.infer<typeof ProductGtinSchema>;
export type ProductNutrientValue = z.infer<typeof ProductNutrientValueSchema>;
export type ProductDensity = z.infer<typeof ProductDensitySchema>;
export type ProductStructuredTextList = z.infer<typeof ProductStructuredTextListSchema>;
export type CommercialProductSnapshot = z.infer<typeof CommercialProductSnapshotSchema>;
export type CommercialProductSource = (typeof COMMERCIAL_PRODUCT_SOURCES)[number];
export type CommercialProductCompleteness =
  (typeof COMMERCIAL_PRODUCT_COMPLETENESS)[number];
export type ProductResolutionResponse = z.infer<typeof ProductResolutionResponseSchema>;
export type ProductConfirmationRequest = z.infer<
  typeof ProductConfirmationRequestSchema
>;
export type ProductConfirmationAck = z.infer<typeof ProductConfirmationAckSchema>;
export type ConfirmedProductApplication = z.infer<
  typeof ConfirmedProductApplicationSchema
>;
export type AdminBarcodeCorrectionList = z.infer<
  typeof AdminBarcodeCorrectionListSchema
>;
export type AdminBarcodeCorrectionDetail = z.infer<
  typeof AdminBarcodeCorrectionDetailSchema
>;
export type AdminBarcodeCorrectionMutationAck = z.infer<
  typeof AdminBarcodeCorrectionMutationAckSchema
>;
export type AdminMatchingRuleMutationAck = z.infer<
  typeof AdminMatchingRuleMutationAckSchema
>;
