import { z } from "zod";

export const CLINICAL_COVERAGE = ["modeled", "partial", "unmodeled"] as const;
export const CLINICAL_RULE_KINDS = [
  "mandatory",
  "conditional",
  "preferential",
] as const;
export const ACTION_LEVELS = [
  "information",
  "adjustment",
  "priority_review",
  "immediate_conservative",
] as const;

export const ClinicalCoverageSchema = z.enum(CLINICAL_COVERAGE);
export const ClinicalRuleKindSchema = z.enum(CLINICAL_RULE_KINDS);
export const ActionLevelSchema = z.enum(ACTION_LEVELS);
export const ClinicalActionLevelSchema = ActionLevelSchema;
export const CLINICAL_CATALOG_VERSION = "clinical-selective-v2" as const;

export const ClinicalRuleSchema = z
  .object({
    actionLevel: ActionLevelSchema,
    code: z.string().regex(/^[A-Z][A-Z0-9_]{0,79}$/),
    coverage: ClinicalCoverageSchema,
    evidenceRefs: z.array(z.string().min(1).max(256)).min(1).max(20),
    id: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,127}$/),
    kind: ClinicalRuleKindSchema,
  })
  .strict();

const ClinicalDetectedFlagsSchema = z
  .object({
    anabolic: z.boolean(),
    anticoagulant: z.boolean(),
    cardiac: z.boolean(),
    diuretic: z.boolean(),
    fluidRestriction: z.boolean(),
    glp1: z.boolean(),
    hypertension: z.boolean(),
    hyponatremia: z.boolean(),
    lactation: z.boolean(),
    magnesiumInteraction: z.boolean(),
    menopause: z.boolean(),
    preconception: z.boolean(),
    pregnancy: z.boolean(),
    renal: z.boolean(),
    retatrutide: z.boolean(),
  })
  .strict();

export const ClinicalUncertaintySchema = z
  .object({
    code: z.string().regex(/^[A-Z][A-Z0-9_]{0,79}$/),
    messageKey: z.string().min(1).max(160),
  })
  .strict();

export const ClinicalSafetyFindingSchema = z
  .object({
    actionLevel: ActionLevelSchema,
    code: z.string().regex(/^[A-Z][A-Z0-9_]{0,79}$/),
    coverage: ClinicalCoverageSchema,
    evidenceRef: z.string().min(1).max(256),
    messageKey: z.string().min(1).max(160),
    ruleKind: ClinicalRuleKindSchema,
  })
  .strict();

export const ClinicalResultSchema = z
  .object({
    catalogVersion: z.literal(CLINICAL_CATALOG_VERSION),
    coverage: ClinicalCoverageSchema,
    detected: ClinicalDetectedFlagsSchema,
    safetyFindings: z.array(ClinicalSafetyFindingSchema).max(20),
    strategies: z.array(z.string().min(1).max(80)).max(20),
    strictestActionLevel: ActionLevelSchema,
    uncertainties: z.array(ClinicalUncertaintySchema).max(20),
  })
  .strict();

const AempsIdentifierSchema = z.string().regex(/^[0-9A-Z]{1,32}$/);
export const AempsMedicationSearchResultSchema = z
  .object({
    activeIngredients: z.array(z.string().min(1).max(200)).max(20),
    administrationRoutes: z.array(z.string().min(1).max(200)).max(20),
    aempsId: AempsIdentifierSchema,
    commercialized: z.boolean().nullable(),
    name: z.string().min(1).max(500),
    prescriptionCondition: z.string().min(1).max(500).nullable(),
    prescriptionRequired: z.boolean().nullable(),
    registrationNumber: AempsIdentifierSchema,
  })
  .strict()
  .refine(({ aempsId, registrationNumber }) => aempsId === registrationNumber, {
    message: "aemps_identifier_mismatch",
  });
export const AempsMedicationSearchResponseSchema = z
  .object({
    results: z.array(AempsMedicationSearchResultSchema).max(20),
    source: z.literal("AEMPS_CIMA"),
  })
  .strict();

export type ClinicalCoverage = z.infer<typeof ClinicalCoverageSchema>;
export type ClinicalRuleKind = z.infer<typeof ClinicalRuleKindSchema>;
export type ActionLevel = z.infer<typeof ActionLevelSchema>;
export type ClinicalRule = z.infer<typeof ClinicalRuleSchema>;
export type ClinicalUncertainty = z.infer<typeof ClinicalUncertaintySchema>;
export type ClinicalSafetyFinding = z.infer<typeof ClinicalSafetyFindingSchema>;
export type ClinicalResult = z.infer<typeof ClinicalResultSchema>;
export type AempsMedicationSearchResult = z.infer<
  typeof AempsMedicationSearchResultSchema
>;
export type AempsMedicationSearchResponse = z.infer<
  typeof AempsMedicationSearchResponseSchema
>;

export type ClinicalCatalogEntry = Readonly<{
  aliases: readonly string[];
  code: string;
  coverage: ClinicalCoverage;
  kind: ClinicalRuleKind;
  actionLevel: ActionLevel;
}>;

/** Selective aliases only; this is not an exhaustive clinical verifier. */
export const CLINICAL_CATALOG = [
  {
    aliases: ["restriccion de liquidos", "restriccion de fluidos", "fluid restriction"],
    code: "FLUID_RESTRICTION_ACTIVE",
    coverage: "partial",
    kind: "mandatory",
    actionLevel: "immediate_conservative",
  },
  {
    aliases: ["enfermedad renal", "insuficiencia renal", "renal", "kidney"],
    code: "RENAL_CONTEXT_PARTIAL",
    coverage: "partial",
    kind: "conditional",
    actionLevel: "priority_review",
  },
  {
    aliases: [
      "enfermedad cardiaca",
      "insuficiencia cardiaca",
      "cardiaca",
      "heart failure",
    ],
    code: "CARDIAC_CONTEXT_PARTIAL",
    coverage: "partial",
    kind: "conditional",
    actionLevel: "priority_review",
  },
  {
    aliases: ["hiponatremia", "hyponatremia", "low sodium"],
    code: "HYPONATREMIA_CONTEXT_PARTIAL",
    coverage: "partial",
    kind: "conditional",
    actionLevel: "priority_review",
  },
  {
    aliases: [
      "hipertension",
      "hipertension arterial",
      "presion arterial alta",
      "hypertension",
      "high blood pressure",
    ],
    code: "HYPERTENSION_CONTEXT_PARTIAL",
    coverage: "partial",
    kind: "conditional",
    actionLevel: "priority_review",
  },
  {
    aliases: [
      "semaglutida",
      "semaglutide",
      "ozempic",
      "wegovy",
      "rybelsus",
      "tirzepatida",
      "tirzepatide",
      "mounjaro",
    ],
    code: "GLP1_CONTEXT_PARTIAL",
    coverage: "partial",
    kind: "conditional",
    actionLevel: "adjustment",
  },
  {
    aliases: [],
    code: "PREGNANCY_CONTEXT_PARTIAL",
    coverage: "partial",
    kind: "conditional",
    actionLevel: "priority_review",
  },
  {
    aliases: [],
    code: "LACTATION_CONTEXT_PARTIAL",
    coverage: "partial",
    kind: "conditional",
    actionLevel: "priority_review",
  },
  {
    aliases: [],
    code: "PRECONCEPTION_CONTEXT_PARTIAL",
    coverage: "partial",
    kind: "conditional",
    actionLevel: "adjustment",
  },
  {
    aliases: [],
    code: "MENOPAUSE_CONTEXT_PARTIAL",
    coverage: "partial",
    kind: "conditional",
    actionLevel: "adjustment",
  },
  {
    aliases: [
      "diuretico",
      "furosemida",
      "hidroclorotiazida",
      "hydrochlorothiazide",
      "bumetanida",
      "bumetanide",
      "torasemida",
      "torsemide",
      "indapamida",
      "indapamide",
      "clortalidona",
      "chlorthalidone",
      "espironolactona",
      "spironolactone",
      "amilorida",
      "amiloride",
      "triamtereno",
      "triamterene",
      "acetazolamida",
      "acetazolamide",
      "metolazona",
      "metolazone",
    ],
    code: "DIURETIC_CONTEXT_PARTIAL",
    coverage: "partial",
    kind: "conditional",
    actionLevel: "adjustment",
  },
  {
    aliases: [
      "apixaban",
      "rivaroxaban",
      "edoxaban",
      "dabigatran",
      "warfarina",
      "warfarin",
      "acenocumarol",
      "acenocoumarol",
      "heparina",
      "heparin",
      "enoxaparina",
      "enoxaparin",
    ],
    code: "ANTICOAGULANT_CONTEXT_PARTIAL",
    coverage: "partial",
    kind: "conditional",
    actionLevel: "priority_review",
  },
  {
    aliases: [
      "tetraciclina",
      "tetracycline",
      "doxiciclina",
      "doxycycline",
      "minociclina",
      "minocycline",
      "ciprofloxacino",
      "ciprofloxacin",
      "levofloxacino",
      "levofloxacin",
      "moxifloxacino",
      "moxifloxacin",
      "ofloxacino",
      "ofloxacin",
      "alendronato",
      "alendronate",
      "risedronato",
      "risedronate",
      "ibandronato",
      "ibandronate",
      "omeprazol",
      "omeprazole",
      "esomeprazol",
      "esomeprazole",
      "pantoprazol",
      "pantoprazole",
      "lansoprazol",
      "lansoprazole",
      "rabeprazol",
      "rabeprazole",
    ],
    code: "MAGNESIUM_INTERACTION_PARTIAL",
    coverage: "partial",
    kind: "conditional",
    actionLevel: "priority_review",
  },
  {
    aliases: ["retatrutida", "retatrutide"],
    code: "RETATRUTIDE_CONTEXT_UNMODELED",
    coverage: "unmodeled",
    kind: "conditional",
    actionLevel: "priority_review",
  },
  {
    aliases: [
      "testosterona",
      "testosterone",
      "anabolizante",
      "anabolic",
      "esteroide anabolico",
      "sarm",
      "sarms",
      "nandrolona",
      "nandrolone",
      "oxandrolona",
      "oxandrolone",
      "estanozolol",
      "stanozolol",
      "trenbolona",
      "trenbolone",
      "boldenona",
      "boldenone",
      "metandienona",
      "methandienone",
      "ostarina",
      "ostarine",
      "ligandrol",
      "andarine",
    ],
    code: "ANABOLIC_CONTEXT_PARTIAL",
    coverage: "partial",
    kind: "preferential",
    actionLevel: "adjustment",
  },
] as const satisfies readonly ClinicalCatalogEntry[];
