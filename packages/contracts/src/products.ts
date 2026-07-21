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

export type ProductSymbology = (typeof PRODUCT_SYMBOLOGIES)[number];
export type ProductGtin = z.infer<typeof ProductGtinSchema>;
export type ProductNutrientValue = z.infer<typeof ProductNutrientValueSchema>;
export type ProductStructuredTextList = z.infer<typeof ProductStructuredTextListSchema>;
export type CommercialProductSnapshot = z.infer<typeof CommercialProductSnapshotSchema>;
export type CommercialProductSource = (typeof COMMERCIAL_PRODUCT_SOURCES)[number];
export type CommercialProductCompleteness =
  (typeof COMMERCIAL_PRODUCT_COMPLETENESS)[number];
