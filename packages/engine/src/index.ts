import {
  CLINICAL_CATALOG_VERSION,
  HydrationPlanSchema,
  MobilityPlanSchema,
  SleepPlanSchema,
  SupplementsPlanSchema,
  TrainingPlanSchema,
  type ContextSnapshotInternal,
  type PlanContextChange,
  type PlanEngineResult,
  type PlanModuleResultInput,
} from "@health-design/contracts";
import {
  CONTEXT_CANONICALIZATION_VERSION,
  QUESTIONNAIRE_MODULES,
  type EffectiveNutritionFood,
  type QuestionnaireModule,
} from "@health-design/domain";

import {
  absoluteDecimal,
  compareDecimals,
  multiplyDecimals,
  normalizeDecimal,
  subtractDecimals,
  sumDecimals,
} from "./decimal.ts";
import { generateMobilityPlan } from "./modules/mobility/index.ts";
import { generateNutritionWeek } from "./modules/nutrition/index.ts";
import { generateHydrationPlan } from "./modules/hydration/index.ts";
import { generateSleepPlan } from "./modules/sleep/index.ts";
import { detectClinicalContext } from "./clinical/index.ts";
import type { GeneratedTrainingLoad } from "./modules/nutrition/index.ts";
import { generateTrainingPlan } from "./modules/training/index.ts";
import { generateSupplementsPlan } from "./modules/supplements/index.ts";

export * from "./decimal.ts";

export const UNIT_CONVERSION_VERSION = "unit-conversion-v1" as const;

export type QuantityUnit =
  "EUR" | "cent" | "g" | "kJ" | "kcal" | "kg" | "l" | "mg" | "ml" | "ug";
export type QuantityState = "conflicting" | "estimated" | "known" | "missing" | "stale";
export type QuantityBasis =
  "absolute" | "per_100_g" | "per_100_ml" | "per_kg" | "per_l" | "per_serving";
export type FoodState = "cooked" | "raw" | "unspecified";
export type Quantity = Readonly<{
  basis: QuantityBasis;
  foodState: FoodState;
  method?: string;
  state: QuantityState;
  unit: QuantityUnit;
  value: string | null;
}>;

const CONVERSION_FACTORS: Readonly<Record<string, string>> = {
  "EUR:cent": "100",
  "cent:EUR": "0.01",
  "g:kg": "0.001",
  "g:mg": "1000",
  "g:ug": "1000000",
  "kJ:kcal": "0.2390057361",
  "kcal:kJ": "4.184",
  "kg:g": "1000",
  "l:ml": "1000",
  "mg:g": "0.001",
  "mg:ug": "1000",
  "ml:l": "0.001",
  "ug:g": "0.000001",
  "ug:mg": "0.001",
};

const BASIS_FACTORS: Readonly<Record<string, string>> = {
  "per_100_g:per_kg": "10",
  "per_100_ml:per_l": "10",
  "per_kg:per_100_g": "0.1",
  "per_l:per_100_ml": "0.1",
};

function conversionFactor(from: QuantityUnit, to: QuantityUnit): string | null {
  if (from === to) return "1";
  return CONVERSION_FACTORS[`${from}:${to}`] ?? null;
}

function basisFactor(from: QuantityBasis, to: QuantityBasis): string | null {
  if (from === to) return "1";
  return BASIS_FACTORS[`${from}:${to}`] ?? null;
}

export function normalizeQuantity(
  quantity: Quantity,
  targetUnit: QuantityUnit,
  targetBasis: QuantityBasis = quantity.basis,
): Quantity & {
  conversionVersion: typeof UNIT_CONVERSION_VERSION;
  original: Pick<Quantity, "basis" | "unit" | "value">;
} {
  const unitFactor = conversionFactor(quantity.unit, targetUnit);
  const denominatorFactor = basisFactor(quantity.basis, targetBasis);
  if (unitFactor === null) throw new Error("incompatible_units");
  if (denominatorFactor === null) throw new Error("incompatible_basis");
  const original = {
    basis: quantity.basis,
    unit: quantity.unit,
    value: quantity.value,
  };
  if (quantity.state === "missing") {
    if (quantity.value !== null) throw new Error("invalid_quantity_state");
    return {
      ...quantity,
      basis: targetBasis,
      conversionVersion: UNIT_CONVERSION_VERSION,
      original,
      unit: targetUnit,
    };
  }
  if (quantity.value === null) throw new Error("invalid_quantity_state");
  return {
    ...quantity,
    basis: targetBasis,
    conversionVersion: UNIT_CONVERSION_VERSION,
    original,
    unit: targetUnit,
    value: multiplyDecimals(
      multiplyDecimals(quantity.value, unitFactor),
      denominatorFactor,
    ),
  };
}

export function quantitiesAreCompatible(left: Quantity, right: Quantity): boolean {
  return (
    left.basis === right.basis &&
    left.foodState === right.foodState &&
    conversionFactor(left.unit, right.unit) !== null
  );
}

export type NutrientClass =
  | "carbohydrates"
  | "fiber"
  | "mineral"
  | "monounsaturated_fat"
  | "polyunsaturated_fat"
  | "protein"
  | "salt"
  | "saturated_fat"
  | "sodium"
  | "sugars"
  | "total_fat"
  | "vitamin";
export type DiscrepancyStatus =
  "informative_discrepancy" | "manual_review" | "no_conflict" | "priority_review";

function exceedsAbsolute(difference: string, threshold: string): boolean {
  return compareDecimals(difference, threshold) > 0;
}

function exceedsRelative(
  difference: string,
  anchor: string,
  percentage: string,
): boolean {
  return (
    compareDecimals(
      multiplyDecimals(difference, "100"),
      multiplyDecimals(absoluteDecimal(anchor), percentage),
    ) > 0
  );
}

function macronutrientThreshold(
  anchor: string,
  difference: string,
  lowThreshold: string,
): boolean {
  if (compareDecimals(anchor, "10") < 0) {
    return exceedsAbsolute(difference, lowThreshold);
  }
  if (compareDecimals(anchor, "40") <= 0) {
    return exceedsRelative(difference, anchor, "20");
  }
  return exceedsAbsolute(difference, "8");
}

export function classifyNutrientDiscrepancy(
  nutrient: NutrientClass,
  anchor: string,
  candidate: string,
): DiscrepancyStatus {
  if (compareDecimals(anchor, "0") < 0 || compareDecimals(candidate, "0") < 0) {
    return "priority_review";
  }
  const difference = absoluteDecimal(subtractDecimals(candidate, anchor));
  if (compareDecimals(difference, "0") === 0) return "no_conflict";

  let exceeds: boolean;
  if (["protein", "carbohydrates", "sugars", "fiber"].includes(nutrient)) {
    exceeds = macronutrientThreshold(anchor, difference, "2");
  } else if (nutrient === "total_fat") {
    exceeds = macronutrientThreshold(anchor, difference, "1.5");
  } else if (
    ["saturated_fat", "monounsaturated_fat", "polyunsaturated_fat"].includes(nutrient)
  ) {
    exceeds =
      compareDecimals(anchor, "4") < 0
        ? exceedsAbsolute(difference, "0.8")
        : exceedsRelative(difference, anchor, "20");
  } else if (nutrient === "sodium") {
    exceeds =
      compareDecimals(anchor, "0.5") < 0
        ? exceedsAbsolute(difference, "0.15")
        : exceedsRelative(difference, anchor, "20");
  } else if (nutrient === "salt") {
    exceeds =
      compareDecimals(anchor, "1.25") < 0
        ? exceedsAbsolute(difference, "0.375")
        : exceedsRelative(difference, anchor, "20");
  } else {
    const upper = nutrient === "vitamin" ? "1.5" : "1.45";
    exceeds =
      compareDecimals(candidate, multiplyDecimals(anchor, upper)) > 0 ||
      compareDecimals(candidate, multiplyDecimals(anchor, "0.65")) < 0;
  }
  return exceeds ? "manual_review" : "informative_discrepancy";
}

export function intervalsOverlap(
  left: Readonly<{ maximum: string; minimum: string }>,
  right: Readonly<{ maximum: string; minimum: string }>,
): boolean {
  if (
    compareDecimals(left.minimum, left.maximum) > 0 ||
    compareDecimals(right.minimum, right.maximum) > 0
  ) {
    throw new Error("invalid_interval");
  }
  return (
    compareDecimals(left.minimum, right.maximum) <= 0 &&
    compareDecimals(right.minimum, left.maximum) <= 0
  );
}

type MassBalanceComponents = Readonly<{
  alcohol: string | null;
  ash: string | null;
  carbohydrates: string | null;
  fat: string | null;
  fiber: string | null;
  protein: string | null;
  water: string | null;
}>;

export function checkMassBalance(components: MassBalanceComponents): {
  status: "acceptable" | "not_evaluable" | "preferred" | "priority_review";
  total: string | null;
} {
  const values = Object.values(components);
  if (values.some((value) => value === null)) {
    return { status: "not_evaluable", total: null };
  }
  const knownValues = values as string[];
  const total = sumDecimals(knownValues);
  if (knownValues.some((value) => compareDecimals(value, "0") < 0)) {
    return { status: "priority_review", total };
  }
  if (compareDecimals(total, "97") >= 0 && compareDecimals(total, "103") <= 0) {
    return { status: "preferred", total };
  }
  if (compareDecimals(total, "95") >= 0 && compareDecimals(total, "105") <= 0) {
    return { status: "acceptable", total };
  }
  return { status: "priority_review", total };
}

function canonicalValue(value: unknown): unknown {
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "string") return value.normalize("NFC");
  if (typeof value === "number" && Number.isFinite(value)) {
    return normalizeDecimal(String(value));
  }
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (typeof value !== "object") throw new Error("invalid_canonical_value");

  const prototype = Reflect.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new Error("invalid_canonical_value");
  }

  const entries = Object.entries(value as Record<string, unknown>).map(
    ([key, entryValue]) => [key.normalize("NFC"), canonicalValue(entryValue)] as const,
  );
  const keys = entries.map(([key]) => key);
  if (new Set(keys).size !== keys.length) throw new Error("canonical_key_collision");

  return Object.fromEntries(
    entries.sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0)),
  );
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalValue(value));
}

export async function sha256CanonicalJson(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalJson(value));
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export const HISTORICAL_ENGINE_VERSION = "engine-v3" as const;
export const ENGINE_VERSION = "engine-v4" as const;
export const HISTORICAL_SOURCE_MANIFEST_ID =
  "cb644399-1275-47de-86b6-195711946f66" as const;
export const SOURCE_MANIFEST_ID = "d46591cd-ae2a-4330-a037-c39436cae923" as const;

export type RuleRevision = Readonly<{
  evidenceRefs: readonly string[];
  id: string;
  kind: "conditional" | "mandatory" | "preferential";
  reviewedAt: string;
  ruleId: string;
  scope: readonly QuestionnaireModule[];
  status: "active" | "inactive";
  version: string;
}>;

export type ScientificSourceRevision = Readonly<{
  applicability: readonly string[];
  citation: string;
  confidence: "low" | "moderate" | "moderate_high" | "high";
  doi?: string;
  evidenceType:
    | "consensus_statement"
    | "joint_advisory"
    | "position_stand_overview_of_reviews"
    | "public_health_guideline"
    | "regulatory_product_information"
    | "systematic_review"
    | "systematic_review_meta_analysis"
    | "systematic_review_meta_analysis_meta_regression";
  exclusions: readonly string[];
  hierarchy:
    | "advisory"
    | "guideline"
    | "regulatory"
    | "systematic_review"
    | "systematic_review_meta_analysis";
  id: string;
  population: string;
  reviewedAt: string;
  status: "active" | "inactive";
  url: string;
}>;

const WHO_PHYSICAL_ACTIVITY_SOURCE_ID =
  "source:who-physical-activity-guidelines-2020@1.0.0" as const;
const ACSM_RESISTANCE_TRAINING_SOURCE_ID =
  "source:acsm-resistance-training-position-2026@1.0.0" as const;
const INGRAM_STATIC_STRETCHING_SOURCE_ID =
  "source:ingram-static-stretching-meta-analysis-2025@1.0.0" as const;
const EFSA_WATER_SOURCE_ID =
  "source:efsa-dietary-reference-values-water-2010@1.0.0" as const;
const AASM_SRS_SLEEP_SOURCE_ID =
  "source:aasm-srs-adult-sleep-duration-consensus-2015@1.0.0" as const;
const NIH_ODS_B12_SOURCE_ID = "source:nih-ods-vitamin-b12-fact-sheet@1.0.0" as const;
const WHO_CDC_FOLATE_SOURCE_ID =
  "source:who-cdc-folic-acid-preconception@1.0.0" as const;
const NIH_ODS_CREATINE_SOURCE_ID =
  "source:nih-ods-exercise-creatine-issn-position@1.0.0" as const;
const NIH_ODS_OMEGA3_SOURCE_ID = "source:nih-ods-omega-3-fact-sheet@1.0.0" as const;
const EFSA_CAFFEINE_SOURCE_ID =
  "source:efsa-caffeine-scientific-opinion@1.0.0" as const;
const ACSM_HYDRATION_SOURCE_ID =
  "source:acsm-hydration-exercise-position@1.0.0" as const;
const MELATONIN_SOURCE_ID = "source:aemps-ema-nccih-melatonin-safety@1.0.0" as const;
const NIH_ODS_MAGNESIUM_SOURCE_ID =
  "source:nih-ods-magnesium-fact-sheet@1.0.0" as const;
const PUBMED_BETA_ALANINE_SOURCE_ID =
  "source:pubmed-beta-alanine-review@1.0.0" as const;
const PUBMED_GLYCINE_SOURCE_ID = "source:pubmed-glycine-sleep-review@1.0.0" as const;
const PUBMED_THEANINE_SOURCE_ID = "source:pubmed-theanine-sleep-review@1.0.0" as const;
const PUBMED_ASHWAGANDHA_SOURCE_ID = "source:pubmed-ashwagandha-review@1.0.0" as const;
const WHO_SODIUM_SOURCE_ID = "source:who-sodium-intake-guideline-2012@1.0.0" as const;
const GLP1_NUTRITION_ADVISORY_SOURCE_ID =
  "source:glp1-nutrition-joint-advisory-2025@1.0.0" as const;
const EMA_OZEMPIC_SOURCE_ID = "source:ema-ozempic-product-information@1.0.0" as const;
const EMA_MOUNJARO_SOURCE_ID = "source:ema-mounjaro-product-information@1.0.0" as const;
const AEMPS_CIMA_SOURCE_ID = "source:aemps-cima-medicines-catalog@1.0.0" as const;

export const CORE_SOURCE_REVISIONS = [
  {
    applicability: [
      "Recomendaciones poblacionales de actividad física, fuerza semanal y progresión gradual.",
    ],
    citation:
      "World Health Organization. WHO guidelines on physical activity and sedentary behaviour. 2020. ISBN 9789240015128.",
    confidence: "moderate",
    evidenceType: "public_health_guideline",
    exclusions: [
      "No demuestra que una semana generada por T11 alcance toda la actividad aeróbica semanal recomendada.",
      "No sustituye reglas clínicas individualizadas para subpoblaciones específicas.",
    ],
    hierarchy: "guideline",
    id: WHO_PHYSICAL_ACTIVITY_SOURCE_ID,
    population: "Personas adultas, mayores y subpoblaciones específicas.",
    reviewedAt: "2026-07-19",
    status: "active",
    url: "https://www.who.int/publications/i/item/9789240015128",
  },
  {
    applicability: [
      "Frecuencia, esfuerzo, volumen básico, progresión y diferencias por objetivo en entrenamiento de fuerza general.",
    ],
    citation:
      "Currier BS, D'Souza AC, Fiatarone Singh MA, et al. American College of Sports Medicine Position Stand. Resistance Training Prescription for Muscle Function, Hypertrophy, and Physical Performance in Healthy Adults: An Overview of Reviews. Med Sci Sports Exerc. 2026;58(4):851-872.",
    confidence: "moderate_high",
    doi: "10.1249/MSS.0000000000003897",
    evidenceType: "position_stand_overview_of_reviews",
    exclusions: [
      "Personas con condiciones clínicas que requieren adaptación individualizada.",
      "No valida como óptima una pauta sin cuantificar carga o volumen efectivo por grupo muscular.",
    ],
    hierarchy: "systematic_review_meta_analysis",
    id: ACSM_RESISTANCE_TRAINING_SOURCE_ID,
    population: "Personas adultas sanas en programas de entrenamiento de fuerza.",
    reviewedAt: "2026-07-19",
    status: "active",
    url: "https://doi.org/10.1249/MSS.0000000000003897",
  },
  {
    applicability: [
      "Efecto y volumen acumulado del estiramiento estático para mejorar la flexibilidad.",
    ],
    citation:
      "Ingram LA, Tomkinson GR, d'Unienville NMA, et al. Optimising the Dose of Static Stretching to Improve Flexibility: A Systematic Review, Meta-analysis and Multivariate Meta-regression. Sports Med. 2025;55(3):597-617.",
    confidence: "moderate",
    doi: "10.1007/s40279-024-02143-9",
    evidenceType: "systematic_review_meta_analysis_meta_regression",
    exclusions: [
      "No valida como óptimos los bloques mixtos de movilidad de 5, 10 o 15 minutos.",
      "No estudia tratamiento del dolor, rehabilitación, prevención de lesiones ni seguridad clínica individual.",
    ],
    hierarchy: "systematic_review_meta_analysis",
    id: INGRAM_STATIC_STRETCHING_SOURCE_ID,
    population: "Personas adultas; edad media de 26,8 años en los estudios incluidos.",
    reviewedAt: "2026-07-19",
    status: "active",
    url: "https://doi.org/10.1007/s40279-024-02143-9",
  },
  {
    applicability: [
      "Valores de referencia de agua total para personas adultas, embarazo y lactancia; no sustituyen límites clínicos individuales.",
    ],
    citation:
      "EFSA Panel on Dietetic Products, Nutrition, and Allergies. Scientific Opinion on Dietary Reference Values for water. EFSA Journal. 2010;8(3):1459.",
    confidence: "moderate_high",
    evidenceType: "public_health_guideline",
    exclusions: [
      "No establece límites de líquidos para enfermedad renal, cardiaca o hiponatremia.",
      "No determina una pauta individual de bebidas ni electrolitos.",
    ],
    hierarchy: "guideline",
    id: EFSA_WATER_SOURCE_ID,
    population: "Personas adultas, embarazo y lactancia.",
    reviewedAt: "2026-07-19",
    status: "active",
    url: "https://doi.org/10.2903/j.efsa.2010.1459",
  },
  {
    applicability: [
      "Ventana poblacional de sueño para personas adultas y su interpretación contextual.",
    ],
    citation:
      "Watson NF, Badr MS, Belenky G, et al. Recommended Amount of Sleep for a Healthy Adult: A Joint Consensus Statement of the American Academy of Sleep Medicine and Sleep Research Society. Sleep. 2015;38(6):843-844.",
    confidence: "moderate_high",
    evidenceType: "consensus_statement",
    exclusions: [
      "La recomendación de 7 o más horas no diagnostica trastornos del sueño ni sustituye una evaluación clínica.",
      "Dormir más de 9 horas puede ser apropiado en algunas personas y no es por sí mismo una patología.",
    ],
    hierarchy: "guideline",
    id: AASM_SRS_SLEEP_SOURCE_ID,
    population: "Personas adultas sanas; consenso AASM/SRS.",
    reviewedAt: "2026-07-19",
    status: "active",
    url: "https://aasm.org/resources/pdf/pressroom/adult-sleep-duration-consensus.pdf",
  },
  {
    applicability: [
      "Vitamina B12 en personas con riesgo dietético o analítico; alimentos fortificados primero.",
    ],
    citation:
      "National Institutes of Health, Office of Dietary Supplements. Vitamin B12 Fact Sheet for Health Professionals.",
    confidence: "high",
    evidenceType: "public_health_guideline",
    exclusions: [
      "No determina una dosis individual ni diagnostica una carencia con un valor aislado.",
    ],
    hierarchy: "guideline",
    id: NIH_ODS_B12_SOURCE_ID,
    population: "Personas adultas y grupos con riesgo dietético.",
    reviewedAt: "2026-07-19",
    status: "active",
    url: "https://ods.od.nih.gov/factsheets/VitaminB12-HealthProfessional/",
  },
  {
    applicability: [
      "Ácido fólico periconcepcional para prevención de defectos del tubo neural.",
    ],
    citation:
      "World Health Organization. Guideline: optimal serum and red blood cell folate concentrations in women of reproductive age; Centers for Disease Control and Prevention folic acid guidance.",
    confidence: "high",
    evidenceType: "public_health_guideline",
    exclusions: [
      "No justifica 5 mg automáticos ni sustituye indicación prenatal individual.",
    ],
    hierarchy: "guideline",
    id: WHO_CDC_FOLATE_SOURCE_ID,
    population: "Personas que buscan embarazo y embarazo temprano.",
    reviewedAt: "2026-07-19",
    status: "active",
    url: "https://www.cdc.gov/folic-acid/about/index.html",
  },
  {
    applicability: [
      "Creatina monohidrato para fuerza y rendimiento en personas sanas.",
    ],
    citation:
      "National Institutes of Health, Office of Dietary Supplements. Exercise and Athletic Performance; International Society of Sports Nutrition position stand on creatine.",
    confidence: "moderate_high",
    evidenceType: "position_stand_overview_of_reviews",
    exclusions: [
      "No aplica automáticamente a enfermedad renal, restricción de líquidos o cobertura clínica incierta.",
    ],
    hierarchy: "systematic_review_meta_analysis",
    id: NIH_ODS_CREATINE_SOURCE_ID,
    population: "Adultos sanos con objetivos de fuerza o rendimiento.",
    reviewedAt: "2026-07-19",
    status: "active",
    url: "https://ods.od.nih.gov/factsheets/ExerciseAndAthleticPerformance-HealthProfessional/",
  },
  {
    applicability: [
      "EPA/DHA cuando la ingesta de pescado es baja o el patrón es vegetariano/vegano.",
    ],
    citation:
      "National Institutes of Health, Office of Dietary Supplements. Omega-3 Fatty Acids Fact Sheet for Health Professionals.",
    confidence: "moderate",
    evidenceType: "public_health_guideline",
    exclusions: [
      "No hace una afirmación universal de prevención cardiovascular ni una dosis general automática.",
    ],
    hierarchy: "guideline",
    id: NIH_ODS_OMEGA3_SOURCE_ID,
    population: "Personas adultas con ingesta dietética variable.",
    reviewedAt: "2026-07-19",
    status: "active",
    url: "https://ods.od.nih.gov/factsheets/Omega3FattyAcids-HealthProfessional/",
  },
  {
    applicability: ["Cafeína para rendimiento puntual en adultos sanos."],
    citation:
      "EFSA Panel on Dietetic Products, Nutrition and Allergies. Scientific Opinion on the safety of caffeine. EFSA Journal. 2015;13(5):4102.",
    confidence: "moderate_high",
    evidenceType: "public_health_guideline",
    exclusions: ["No recomienda polvo puro ni compensa el mal descanso."],
    hierarchy: "guideline",
    id: EFSA_CAFFEINE_SOURCE_ID,
    population: "Adultos sanos; límites de seguridad poblacionales.",
    reviewedAt: "2026-07-19",
    status: "active",
    url: "https://doi.org/10.2903/j.efsa.2015.4102",
  },
  {
    applicability: [
      "Hidratación y electrolitos en calor, sudoración alta y ejercicio prolongado.",
    ],
    citation:
      "American College of Sports Medicine. Exercise and Fluid Replacement position stand.",
    confidence: "moderate",
    evidenceType: "consensus_statement",
    exclusions: ["No establece una dosis diaria fija y requiere override clínico."],
    hierarchy: "guideline",
    id: ACSM_HYDRATION_SOURCE_ID,
    population: "Adultos durante actividad física y exposición al calor.",
    reviewedAt: "2026-07-19",
    status: "active",
    url: "https://pubmed.ncbi.nlm.nih.gov/17277604/",
  },
  {
    applicability: [
      "Melatonina y sueño alterado como revisión contextual, no pauta automática.",
    ],
    citation: "AEMPS, EMA and NCCIH public safety information on melatonin.",
    confidence: "moderate",
    evidenceType: "public_health_guideline",
    exclusions: [
      "No se automatiza dosis ni se sustituye una evaluación clínica del sueño.",
    ],
    hierarchy: "guideline",
    id: MELATONIN_SOURCE_ID,
    population: "Adultos con sueño pobre o trabajo a turnos; aplicabilidad contextual.",
    reviewedAt: "2026-07-19",
    status: "active",
    url: "https://www.ema.europa.eu/en/medicines/human/referrals/melatonin-containing-medicines",
  },
  {
    applicability: [
      "Magnesio en insuficiencia dietética, valor bajo reconocido o contexto PPI.",
    ],
    citation:
      "National Institutes of Health, Office of Dietary Supplements. Magnesium Fact Sheet for Health Professionals.",
    confidence: "moderate",
    evidenceType: "public_health_guideline",
    exclusions: [
      "No se recomienda automáticamente con enfermedad renal ni se inventa un rango de laboratorio.",
    ],
    hierarchy: "guideline",
    id: NIH_ODS_MAGNESIUM_SOURCE_ID,
    population: "Personas adultas con ingesta o contexto clínico relevante.",
    reviewedAt: "2026-07-19",
    status: "active",
    url: "https://ods.od.nih.gov/factsheets/Magnesium-HealthProfessional/",
  },
  {
    applicability: ["Opciones experimentales de beta-alanina para rendimiento."],
    citation:
      "PubMed-indexed systematic review of beta-alanine supplementation and exercise performance.",
    confidence: "low",
    evidenceType: "systematic_review",
    exclusions: ["No pauta automática; beneficio pequeño e incierto."],
    hierarchy: "systematic_review",
    id: PUBMED_BETA_ALANINE_SOURCE_ID,
    population: "Adultos físicamente activos en estudios experimentales.",
    reviewedAt: "2026-07-19",
    status: "active",
    url: "https://pubmed.ncbi.nlm.nih.gov/40995761/",
  },
  {
    applicability: ["Opciones experimentales de glicina para sueño."],
    citation: "PubMed-indexed systematic review of glycine and sleep outcomes.",
    confidence: "low",
    evidenceType: "systematic_review",
    exclusions: ["No pauta automática; beneficio pequeño e incierto."],
    hierarchy: "systematic_review",
    id: PUBMED_GLYCINE_SOURCE_ID,
    population: "Adultos en estudios experimentales de sueño.",
    reviewedAt: "2026-07-19",
    status: "active",
    url: "https://pubmed.ncbi.nlm.nih.gov/37851316/",
  },
  {
    applicability: [
      "Opciones experimentales de L-teanina para calidad y funcionamiento del sueño.",
    ],
    citation:
      "PubMed-indexed systematic review and meta-analysis of L-theanine and sleep outcomes.",
    confidence: "low",
    evidenceType: "systematic_review_meta_analysis",
    exclusions: ["No pauta automática; beneficio pequeño e incierto."],
    hierarchy: "systematic_review_meta_analysis",
    id: PUBMED_THEANINE_SOURCE_ID,
    population: "Adultos en estudios experimentales de sueño.",
    reviewedAt: "2026-07-19",
    status: "active",
    url: "https://pubmed.ncbi.nlm.nih.gov/40056718/",
  },
  {
    applicability: [
      "Opciones experimentales de ashwagandha para calidad y funcionamiento del sueño.",
    ],
    citation:
      "PubMed-indexed systematic review and meta-analysis of Withania somnifera and sleep outcomes.",
    confidence: "low",
    evidenceType: "systematic_review_meta_analysis",
    exclusions: [
      "No pauta automática; beneficio pequeño e incierto y posibles riesgos clínicos.",
    ],
    hierarchy: "systematic_review_meta_analysis",
    id: PUBMED_ASHWAGANDHA_SOURCE_ID,
    population: "Adultos en estudios experimentales de sueño.",
    reviewedAt: "2026-07-19",
    status: "active",
    url: "https://pubmed.ncbi.nlm.nih.gov/34559859/",
  },
  {
    applicability: [
      "Contexto poblacional de sodio para personas adultas, incluida la reducción de presión arterial; la pauta individual sigue subordinada al contexto clínico.",
    ],
    citation:
      "World Health Organization. Guideline: Sodium intake for adults and children. Geneva: WHO; 2012.",
    confidence: "high",
    evidenceType: "public_health_guideline",
    exclusions: [
      "No autoriza a inferir sodio dietético a partir de un cuestionario incompleto.",
      "No sustituye una indicación clínica individual ni valida por sí sola una dieta generada.",
    ],
    hierarchy: "guideline",
    id: WHO_SODIUM_SOURCE_ID,
    population:
      "Personas adultas y niñas y niños; T12 usa únicamente el contexto adulto.",
    reviewedAt: "2026-07-19",
    status: "active",
    url: "https://www.who.int/publications/i/item/9789241504836",
  },
  {
    applicability: [
      "Contexto nutricional, tolerancia gastrointestinal, masa magra e hidratación durante el tratamiento con agonistas GLP-1 en personas adultas.",
    ],
    citation:
      "Mozaffarian D, Agarwal M, Aggarwal M, et al. Nutritional priorities to support GLP-1 therapy for obesity: a joint advisory. Am J Clin Nutr. 2025.",
    confidence: "moderate",
    evidenceType: "joint_advisory",
    exclusions: [
      "No prescribe, suspende ni modifica medicación.",
      "No permite asumir síntomas, dosis, frecuencia ni tolerancia que la persona no haya declarado.",
    ],
    hierarchy: "advisory",
    id: GLP1_NUTRITION_ADVISORY_SOURCE_ID,
    population: "Personas adultas que reciben tratamiento GLP-1 para obesidad.",
    reviewedAt: "2026-07-19",
    status: "active",
    url: "https://pubmed.ncbi.nlm.nih.gov/40445127/",
  },
  {
    applicability: [
      "Identidad regulatoria y contexto de seguridad de semaglutida cuando el nombre declarado coincide con Ozempic.",
    ],
    citation: "European Medicines Agency. Ozempic: EPAR product information.",
    confidence: "high",
    evidenceType: "regulatory_product_information",
    exclusions: [
      "No constituye un verificador farmacológico exhaustivo.",
      "No autoriza cambios de dosis, frecuencia, vía, horario ni tratamiento.",
    ],
    hierarchy: "regulatory",
    id: EMA_OZEMPIC_SOURCE_ID,
    population: "Personas adultas dentro de la indicación regulatoria del producto.",
    reviewedAt: "2026-07-19",
    status: "active",
    url: "https://www.ema.europa.eu/en/medicines/human/EPAR/ozempic",
  },
  {
    applicability: [
      "Identidad regulatoria y contexto de seguridad de tirzepatida cuando el nombre declarado coincide con Mounjaro.",
    ],
    citation: "European Medicines Agency. Mounjaro: EPAR product information.",
    confidence: "high",
    evidenceType: "regulatory_product_information",
    exclusions: [
      "No constituye un verificador farmacológico exhaustivo.",
      "No autoriza cambios de dosis, frecuencia, vía, horario ni tratamiento.",
    ],
    hierarchy: "regulatory",
    id: EMA_MOUNJARO_SOURCE_ID,
    population: "Personas adultas dentro de la indicación regulatoria del producto.",
    reviewedAt: "2026-07-19",
    status: "active",
    url: "https://www.ema.europa.eu/en/medicines/human/EPAR/mounjaro",
  },
  {
    applicability: [
      "Catálogo canónico de identidades de medicamentos autorizados en España y acceso a sus fichas técnicas oficiales.",
    ],
    citation:
      "Agencia Española de Medicamentos y Productos Sanitarios. CIMA REST API v1.23 y Centro de Información online de Medicamentos.",
    confidence: "high",
    evidenceType: "regulatory_product_information",
    exclusions: [
      "La cobertura selectiva de reglas T12 no equivale a validar todas las interacciones del catálogo CIMA.",
      "La identidad del medicamento no autoriza cambios de tratamiento ni inferencias de dosis o frecuencia.",
    ],
    hierarchy: "regulatory",
    id: AEMPS_CIMA_SOURCE_ID,
    population: "Medicamentos de uso humano autorizados y registrados en España.",
    reviewedAt: "2026-07-19",
    status: "active",
    url: "https://cima.aemps.es/cima/resources/docs/CIMA_REST_API.pdf",
  },
] as const satisfies readonly ScientificSourceRevision[];

export const HISTORICAL_CLINICAL_RULE_REVISION = {
  evidenceRefs: ["contract:t12-clinical-selective-v1"],
  id: "rule.clinical-selective@1.0.0",
  kind: "conditional",
  reviewedAt: "2026-07-19",
  ruleId: "rule.clinical-selective",
  scope: ["hydration", "nutrition", "training", "mobility", "supplements"],
  status: "active",
  version: "1.0.0",
} as const satisfies RuleRevision;

export const CORE_RULE_REVISIONS = [
  {
    evidenceRefs: ["contract:questionnaire-module-selection-v1"],
    id: "rule.module-selection@1.0.0",
    kind: "preferential",
    reviewedAt: "2026-07-18",
    ruleId: "rule.module-selection",
    scope: QUESTIONNAIRE_MODULES,
    status: "active",
    version: "1.0.0",
  },
  {
    evidenceRefs: ["contract:training-optional-v1"],
    id: "rule.training-none@1.0.0",
    kind: "mandatory",
    reviewedAt: "2026-07-18",
    ruleId: "rule.training-none",
    scope: ["training"],
    status: "active",
    version: "1.0.0",
  },
  {
    evidenceRefs: ["contract:t10-nutrition-targets-v1"],
    id: "rule.nutrition-targets@1.0.0",
    kind: "mandatory",
    reviewedAt: "2026-07-19",
    ruleId: "rule.nutrition-targets",
    scope: ["nutrition"],
    status: "active",
    version: "1.0.0",
  },
  {
    evidenceRefs: ["contract:t10-two-substitutes-v1"],
    id: "rule.nutrition-substitutions@1.0.0",
    kind: "mandatory",
    reviewedAt: "2026-07-19",
    ruleId: "rule.nutrition-substitutions",
    scope: ["nutrition"],
    status: "active",
    version: "1.0.0",
  },
  {
    evidenceRefs: [
      "contract:t11-generated-four-week-block-v1",
      WHO_PHYSICAL_ACTIVITY_SOURCE_ID,
      ACSM_RESISTANCE_TRAINING_SOURCE_ID,
    ],
    id: "rule.training-generated-block@1.0.0",
    kind: "mandatory",
    reviewedAt: "2026-07-19",
    ruleId: "rule.training-generated-block",
    scope: ["training"],
    status: "active",
    version: "1.0.0",
  },
  {
    evidenceRefs: ["contract:t11-declared-limitations-v1"],
    id: "rule.training-declared-limitations@1.0.0",
    kind: "conditional",
    reviewedAt: "2026-07-19",
    ruleId: "rule.training-declared-limitations",
    scope: ["training", "mobility"],
    status: "active",
    version: "1.0.0",
  },
  {
    evidenceRefs: [
      "contract:t11-mobility-modular-duration-v1",
      INGRAM_STATIC_STRETCHING_SOURCE_ID,
    ],
    id: "rule.mobility-modular-duration@1.0.0",
    kind: "mandatory",
    reviewedAt: "2026-07-19",
    ruleId: "rule.mobility-modular-duration",
    scope: ["mobility"],
    status: "active",
    version: "1.0.0",
  },
  {
    evidenceRefs: ["contract:t12-hydration-reference-v1", EFSA_WATER_SOURCE_ID],
    id: "rule.hydration-reference@1.0.0",
    kind: "mandatory",
    reviewedAt: "2026-07-19",
    ruleId: "rule.hydration-reference",
    scope: ["hydration"],
    status: "active",
    version: "1.0.0",
  },
  {
    evidenceRefs: ["contract:t12-clinical-selective-v2", AEMPS_CIMA_SOURCE_ID],
    id: "rule.clinical-selective@2.0.0",
    kind: "conditional",
    reviewedAt: "2026-07-19",
    ruleId: "rule.clinical-selective",
    scope: ["hydration", "nutrition", "training", "mobility", "sleep", "supplements"],
    status: "active",
    version: "2.0.0",
  },
  {
    evidenceRefs: ["contract:t12-sleep-window-v1", AASM_SRS_SLEEP_SOURCE_ID],
    id: "rule.sleep-window@1.0.0",
    kind: "mandatory",
    reviewedAt: "2026-07-19",
    ruleId: "rule.sleep-window",
    scope: ["sleep"],
    status: "active",
    version: "1.0.0",
  },
  {
    evidenceRefs: [
      "contract:t12-supplements-catalog-v1",
      NIH_ODS_B12_SOURCE_ID,
      WHO_CDC_FOLATE_SOURCE_ID,
      NIH_ODS_CREATINE_SOURCE_ID,
      NIH_ODS_OMEGA3_SOURCE_ID,
      EFSA_CAFFEINE_SOURCE_ID,
      ACSM_HYDRATION_SOURCE_ID,
      MELATONIN_SOURCE_ID,
      NIH_ODS_MAGNESIUM_SOURCE_ID,
    ],
    id: "rule.supplements-catalog@1.0.0",
    kind: "mandatory",
    reviewedAt: "2026-07-19",
    ruleId: "rule.supplements-catalog",
    scope: ["supplements"],
    status: "active",
    version: "1.0.0",
  },
  {
    evidenceRefs: [
      "contract:t12-supplements-experimental-v1",
      PUBMED_BETA_ALANINE_SOURCE_ID,
      PUBMED_GLYCINE_SOURCE_ID,
      PUBMED_THEANINE_SOURCE_ID,
      PUBMED_ASHWAGANDHA_SOURCE_ID,
    ],
    id: "rule.supplements-experimental@1.0.0",
    kind: "conditional",
    reviewedAt: "2026-07-19",
    ruleId: "rule.supplements-experimental",
    scope: ["supplements"],
    status: "active",
    version: "1.0.0",
  },
  {
    evidenceRefs: ["contract:t12-supplements-lab-context-v1"],
    id: "rule.supplements-lab-context@1.0.0",
    kind: "conditional",
    reviewedAt: "2026-07-19",
    ruleId: "rule.supplements-lab-context",
    scope: ["supplements"],
    status: "active",
    version: "1.0.0",
  },
  {
    evidenceRefs: ["contract:t12-hypertension-context-v1", WHO_SODIUM_SOURCE_ID],
    id: "rule.clinical-hypertension-context@1.0.0",
    kind: "conditional",
    reviewedAt: "2026-07-19",
    ruleId: "rule.clinical-hypertension-context",
    scope: ["nutrition", "hydration", "training", "mobility", "sleep", "supplements"],
    status: "active",
    version: "1.0.0",
  },
  {
    evidenceRefs: [
      "contract:t12-glp1-context-v1",
      GLP1_NUTRITION_ADVISORY_SOURCE_ID,
      EMA_OZEMPIC_SOURCE_ID,
      EMA_MOUNJARO_SOURCE_ID,
    ],
    id: "rule.clinical-glp1-context@1.0.0",
    kind: "conditional",
    reviewedAt: "2026-07-19",
    ruleId: "rule.clinical-glp1-context",
    scope: ["nutrition", "hydration", "training", "mobility", "sleep", "supplements"],
    status: "active",
    version: "1.0.0",
  },
  {
    evidenceRefs: ["contract:t12-physiological-context-v1"],
    id: "rule.clinical-physiological-context@1.0.0",
    kind: "conditional",
    reviewedAt: "2026-07-19",
    ruleId: "rule.clinical-physiological-context",
    scope: ["nutrition", "hydration", "training", "mobility", "sleep", "supplements"],
    status: "active",
    version: "1.0.0",
  },
] as const satisfies readonly RuleRevision[];

export const HISTORICAL_RULE_SET_REVISION = {
  id: "04edd58c-5fff-4f6b-85ad-472ec538885c",
  ruleRevisionIds: [
    "rule.module-selection@1.0.0",
    "rule.training-none@1.0.0",
    "rule.nutrition-targets@1.0.0",
    "rule.nutrition-substitutions@1.0.0",
    "rule.training-generated-block@1.0.0",
    "rule.training-declared-limitations@1.0.0",
    "rule.mobility-modular-duration@1.0.0",
  ],
  status: "active",
  version: "3.0.0",
} as const;
export const HISTORICAL_SOURCE_MANIFEST = {
  id: HISTORICAL_SOURCE_MANIFEST_ID,
  sourceRevisionIds: [
    "source:who-physical-activity-guidelines-2020@1.0.0",
    "source:acsm-resistance-training-position-2026@1.0.0",
    "source:ingram-static-stretching-meta-analysis-2025@1.0.0",
  ],
  version: "core-with-training-mobility-v1",
} as const;
export const HISTORICAL_ENGINE_SNAPSHOT = {
  engineVersion: HISTORICAL_ENGINE_VERSION,
  ruleSetRevision: HISTORICAL_RULE_SET_REVISION,
  sourceManifest: HISTORICAL_SOURCE_MANIFEST,
} as const;
export const T12_INITIAL_RULE_SET_REVISION = {
  id: "a4b0f4bd-2bb9-4b79-98c3-22ad65b07f27",
  ruleRevisionIds: [
    "rule.module-selection@1.0.0",
    "rule.training-none@1.0.0",
    "rule.nutrition-targets@1.0.0",
    "rule.nutrition-substitutions@1.0.0",
    "rule.training-generated-block@1.0.0",
    "rule.training-declared-limitations@1.0.0",
    "rule.mobility-modular-duration@1.0.0",
    "rule.hydration-reference@1.0.0",
    "rule.clinical-selective@1.0.0",
    "rule.sleep-window@1.0.0",
    "rule.supplements-catalog@1.0.0",
    "rule.supplements-experimental@1.0.0",
    "rule.supplements-lab-context@1.0.0",
  ],
  status: "active",
  version: "4.2.0",
} as const;
export const T12_INITIAL_SOURCE_MANIFEST = {
  id: "c7aa1da4-2fa1-4e7b-86b4-5e03f44e7f4c",
  sourceRevisionIds: [
    "source:who-physical-activity-guidelines-2020@1.0.0",
    "source:acsm-resistance-training-position-2026@1.0.0",
    "source:ingram-static-stretching-meta-analysis-2025@1.0.0",
    "source:efsa-dietary-reference-values-water-2010@1.0.0",
    "source:aasm-srs-adult-sleep-duration-consensus-2015@1.0.0",
    "source:nih-ods-vitamin-b12-fact-sheet@1.0.0",
    "source:who-cdc-folic-acid-preconception@1.0.0",
    "source:nih-ods-exercise-creatine-issn-position@1.0.0",
    "source:nih-ods-omega-3-fact-sheet@1.0.0",
    "source:efsa-caffeine-scientific-opinion@1.0.0",
    "source:acsm-hydration-exercise-position@1.0.0",
    "source:aemps-ema-nccih-melatonin-safety@1.0.0",
    "source:nih-ods-magnesium-fact-sheet@1.0.0",
    "source:pubmed-beta-alanine-review@1.0.0",
    "source:pubmed-glycine-sleep-review@1.0.0",
    "source:pubmed-theanine-sleep-review@1.0.0",
    "source:pubmed-ashwagandha-review@1.0.0",
  ],
  version: "core-with-training-mobility-hydration-sleep-supplements-v1",
} as const;
export const T12_INITIAL_ENGINE_SNAPSHOT = {
  engineVersion: ENGINE_VERSION,
  ruleSetRevision: T12_INITIAL_RULE_SET_REVISION,
  sourceManifest: T12_INITIAL_SOURCE_MANIFEST,
} as const;
export const CORE_RULE_SET_REVISION = {
  id: "9cf98aae-0f9f-452f-9577-72283eeff4d5",
  ruleRevisionIds: CORE_RULE_REVISIONS.map(({ id }) => id),
  status: "active",
  version: "4.3.0",
} as const;
export const RULE_SET_REVISION_ID = CORE_RULE_SET_REVISION.id;

export const CORE_SOURCE_MANIFEST = {
  id: SOURCE_MANIFEST_ID,
  sourceRevisionIds: CORE_SOURCE_REVISIONS.map(({ id }) => id),
  version: "core-with-contextual-wellness-v1",
} as const;

export const CLINICAL_CATALOG_DESCRIPTOR_HASH =
  "af2fb4b04376b25e6054e0c12bc9df144a5ee8a0df585813c871f9505530752e" as const;

export type ClinicalCatalogDescriptor = Readonly<{
  canonicalizationVersion: typeof CONTEXT_CANONICALIZATION_VERSION;
  clinicalCatalogVersion: typeof CLINICAL_CATALOG_VERSION;
  descriptorHash: string;
  hashAlgorithm: "sha256";
  ruleSetRevisionId: typeof RULE_SET_REVISION_ID;
  schemaVersion: 1;
  sourceManifestId: typeof SOURCE_MANIFEST_ID;
}>;

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

function clinicalCatalogDescriptorCore() {
  return {
    canonicalizationVersion: CONTEXT_CANONICALIZATION_VERSION,
    clinicalCatalogVersion: CLINICAL_CATALOG_VERSION,
    hashAlgorithm: "sha256" as const,
    ruleSetRevisionId: RULE_SET_REVISION_ID,
    schemaVersion: 1 as const,
    sourceManifestId: SOURCE_MANIFEST_ID,
  };
}

export function createClinicalCatalogDescriptor(): ClinicalCatalogDescriptor {
  return {
    ...clinicalCatalogDescriptorCore(),
    descriptorHash: CLINICAL_CATALOG_DESCRIPTOR_HASH,
  };
}

async function assertClinicalCatalogDescriptor(
  descriptor: ClinicalCatalogDescriptor,
): Promise<void> {
  const expected = createClinicalCatalogDescriptor();
  if (
    descriptor.canonicalizationVersion !== expected.canonicalizationVersion ||
    descriptor.clinicalCatalogVersion !== expected.clinicalCatalogVersion ||
    descriptor.hashAlgorithm !== expected.hashAlgorithm ||
    descriptor.ruleSetRevisionId !== expected.ruleSetRevisionId ||
    descriptor.schemaVersion !== expected.schemaVersion ||
    descriptor.sourceManifestId !== expected.sourceManifestId ||
    descriptor.descriptorHash !== expected.descriptorHash ||
    (await sha256CanonicalJson(clinicalCatalogDescriptorCore())) !==
      expected.descriptorHash
  ) {
    throw new Error("clinical_catalog_descriptor_mismatch");
  }
}

function resolveCanonicalMedicationContext(
  context: ContextSnapshotInternal,
  identities: readonly CanonicalMedicationIdentity[] | undefined,
) {
  const byId = new Map<string, CanonicalMedicationIdentity>();
  for (const identity of identities ?? []) {
    const valid =
      /^[0-9A-Z]{1,32}$/.test(identity.aempsId) &&
      identity.canonicalName.trim().length > 0 &&
      identity.canonicalName.length <= 500 &&
      identity.activeIngredients.length <= 20 &&
      identity.activeIngredients.every(
        (value) => value.trim().length > 0 && value.length <= 200,
      ) &&
      identity.administrationRoutes.length <= 20 &&
      identity.administrationRoutes.every(
        (value) => value.trim().length > 0 && value.length <= 200,
      ) &&
      /^[0-9a-f]{64}$/.test(identity.sourceHash) &&
      identity.sourceVersion === "CIMA_REST_API_1_23" &&
      Number.isFinite(Date.parse(identity.retrievedAt)) &&
      !byId.has(identity.aempsId);
    if (!valid) throw new Error("canonical_medication_identity_invalid");
    byId.set(identity.aempsId, identity);
  }

  const medications = context.answers.medications ?? [];
  let declaredCount = 0;
  let resolvedCount = 0;
  let unresolvedCount = 0;
  const resolvedMedications = medications.map((medication) => {
    if (!medication.aempsId) return medication;
    declaredCount += 1;
    const identity = byId.get(medication.aempsId);
    if (!identity) {
      unresolvedCount += 1;
      return { ...medication, name: "aemps identity unresolved" };
    }
    resolvedCount += 1;
    return {
      ...medication,
      name: [identity.canonicalName, ...identity.activeIngredients].join(" "),
    };
  });

  return {
    context: {
      ...context,
      answers: { ...context.answers, medications: resolvedMedications },
    },
    hashInput: [...byId.values()]
      .map(
        ({
          activeIngredients,
          administrationRoutes,
          aempsId,
          canonicalName,
          commercialized,
          prescriptionRequired,
          sourceHash,
          sourceVersion,
        }) => ({
          activeIngredients: [...activeIngredients].sort(),
          administrationRoutes: [...administrationRoutes].sort(),
          aempsId,
          canonicalName,
          commercialized,
          prescriptionRequired,
          sourceHash,
          sourceVersion,
        }),
      )
      .sort((left, right) => left.aempsId.localeCompare(right.aempsId)),
    summary: {
      declaredCount,
      resolvedCount,
      sourceVersion: "CIMA_REST_API_1_23" as const,
      unresolvedCount,
    },
  };
}

const ACTION_LEVELS = [
  "information",
  "adjustment",
  "priority_review",
  "immediate_conservative",
] as const;
type ActionLevel = (typeof ACTION_LEVELS)[number];

type ConstraintRule<Choice extends string> = Readonly<{
  actionLevel: ActionLevel;
  active?: boolean | null;
  allowed: readonly Choice[];
  id: string;
  kind: "conditional" | "mandatory";
}>;

type PreferentialRule<Choice extends string> = Readonly<{
  actionLevel: ActionLevel;
  id: string;
  kind: "preferential";
  order: readonly Choice[];
}>;

export type ChoiceRule<Choice extends string> =
  ConstraintRule<Choice> | PreferentialRule<Choice>;

export function resolveChoice<Choice extends string>(input: {
  options: readonly Choice[];
  rules: readonly ChoiceRule<Choice>[];
}): {
  appliedRuleIds: string[];
  choice: Choice | null;
  options: Choice[];
  strictestActionLevel: ActionLevel;
  unresolvedRuleIds: string[];
} {
  let options = [...input.options];
  const appliedRuleIds: string[] = [];
  const unresolvedRuleIds: string[] = [];
  let strictestActionLevel: ActionLevel = "information";

  const applyLevel = (level: ActionLevel) => {
    if (ACTION_LEVELS.indexOf(level) > ACTION_LEVELS.indexOf(strictestActionLevel)) {
      strictestActionLevel = level;
    }
  };

  for (const rule of input.rules) {
    if (rule.kind === "conditional" && rule.active === null) {
      unresolvedRuleIds.push(rule.id);
      continue;
    }
    if (rule.kind === "conditional" && rule.active === false) continue;

    appliedRuleIds.push(rule.id);
    applyLevel(rule.actionLevel);
    if (rule.kind === "preferential") {
      const rank = new Map(rule.order.map((choice, index) => [choice, index]));
      options = options
        .map((choice, index) => ({ choice, index }))
        .sort(
          (left, right) =>
            (rank.get(left.choice) ?? Number.MAX_SAFE_INTEGER) -
              (rank.get(right.choice) ?? Number.MAX_SAFE_INTEGER) ||
            left.index - right.index,
        )
        .map(({ choice }) => choice);
      continue;
    }
    const allowed = new Set(rule.allowed);
    options = options.filter((choice) => allowed.has(choice));
  }

  return {
    appliedRuleIds,
    choice: options[0] ?? null,
    options,
    strictestActionLevel,
    unresolvedRuleIds,
  };
}

export type DeterministicEngineInput = Readonly<{
  baseContext: ContextSnapshotInternal | null;
  baseModuleResults: readonly PlanModuleResultInput[] | null;
  canonicalMedicationIdentities?: readonly CanonicalMedicationIdentity[];
  change: PlanContextChange | null;
  clinicalCatalogDescriptor?: ClinicalCatalogDescriptor;
  context: ContextSnapshotInternal;
  nutritionCatalog?: readonly EffectiveNutritionFood[];
}>;

function moduleChoice(
  module: QuestionnaireModule,
  context: ContextSnapshotInternal,
): "not_requested" | "requested" {
  const selected = context.answers.activeModules?.includes(module) ?? false;
  const rules: ChoiceRule<"not_requested" | "requested">[] = [];
  if (module === "training" && context.answers.trainingMode === "none") {
    rules.push({
      actionLevel: "adjustment",
      allowed: ["not_requested"],
      id: "rule.training-none@1.0.0",
      kind: "mandatory",
    });
  }
  rules.push({
    actionLevel: "information",
    id: "rule.module-selection@1.0.0",
    kind: "preferential",
    order: selected ? ["requested", "not_requested"] : ["not_requested", "requested"],
  });
  return resolveChoice({
    options: ["requested", "not_requested"],
    rules,
  }).choice!;
}

function provisionalModuleResult(
  module: QuestionnaireModule,
  context: ContextSnapshotInternal,
  nutritionCatalog: readonly EffectiveNutritionFood[] | undefined,
  generatedTrainingLoad: GeneratedTrainingLoad | null | undefined,
): PlanModuleResultInput {
  if (moduleChoice(module, context) === "requested") {
    if (module === "hydration") {
      try {
        const plan = HydrationPlanSchema.parse(
          generateHydrationPlan({ answers: context.answers }),
        );
        return {
          confidence: plan.completeness === "complete" ? "high" : "medium",
          module,
          payload: { ...plan },
          status: plan.completeness === "complete" ? "valid" : "provisional",
          uncertainties: plan.uncertainties.map((uncertainty) => ({
            ...uncertainty,
            module,
          })),
        };
      } catch {
        return {
          confidence: "unknown",
          module,
          payload: { requested: true, stage: "hydration_engine" },
          status: "provisional",
          uncertainties: [
            {
              code: "HYDRATION_ENGINE_UNAVAILABLE",
              messageKey: "hydration.uncertainty.engine_unavailable",
              module,
            },
          ],
        };
      }
    }
    if (module === "nutrition" && nutritionCatalog !== undefined) {
      try {
        const week = generateNutritionWeek({
          answers: context.answers,
          catalog: nutritionCatalog,
          ...(generatedTrainingLoad === undefined ? {} : { generatedTrainingLoad }),
        });
        return {
          confidence: week.targets.completeness === "complete" ? "high" : "medium",
          module,
          payload: { ...week },
          status: week.targets.completeness === "complete" ? "valid" : "provisional",
          uncertainties: week.targets.uncertainties.map((uncertainty) => ({
            ...uncertainty,
            module,
          })),
        };
      } catch (error) {
        const code =
          error instanceof Error &&
          ["CATALOG_COVERAGE_INSUFFICIENT", "nutrition_context_incomplete"].includes(
            error.message,
          )
            ? error.message.toUpperCase()
            : "NUTRITION_ENGINE_UNAVAILABLE";
        return {
          confidence: "unknown",
          module,
          payload: { requested: true, stage: "nutrition_engine" },
          status: "provisional",
          uncertainties: [
            {
              code,
              messageKey: `nutrition.uncertainty.${code.toLowerCase()}`,
              module,
            },
          ],
        };
      }
    }
    if (module === "training") {
      try {
        const plan = TrainingPlanSchema.parse(generateTrainingPlan(context.answers));
        if (plan.mode === "none") throw new Error("training_mode_none_unreachable");
        return {
          confidence: plan.completeness === "complete" ? "high" : "medium",
          module,
          payload: { ...plan },
          status: plan.completeness === "complete" ? "valid" : "provisional",
          uncertainties: plan.uncertainties.map((uncertainty) => ({
            ...uncertainty,
            module,
          })),
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "";
        const code =
          errorMessage === "training_limitation_details_missing"
            ? "TRAINING_LIMITATION_DETAILS_MISSING"
            : errorMessage === "training_limitation_unmapped"
              ? "TRAINING_LIMITATION_UNMAPPED"
              : errorMessage.startsWith("training_catalog_coverage_insufficient") ||
                  errorMessage.startsWith("training_alternative_coverage_insufficient")
                ? "TRAINING_CATALOG_COVERAGE_INSUFFICIENT"
                : "TRAINING_ENGINE_UNAVAILABLE";
        return {
          confidence: "unknown",
          module,
          payload: { requested: true, stage: "training_engine" },
          status: "provisional",
          uncertainties: [
            {
              code,
              messageKey:
                code === "TRAINING_CATALOG_COVERAGE_INSUFFICIENT"
                  ? "training.uncertainty.catalog_coverage_insufficient"
                  : code === "TRAINING_ENGINE_UNAVAILABLE"
                    ? "training.uncertainty.engine_unavailable"
                    : `training.uncertainty.${code.toLowerCase()}`,
              module,
            },
          ],
        };
      }
    }
    if (module === "mobility") {
      try {
        const plan = MobilityPlanSchema.parse(generateMobilityPlan(context.answers));
        return {
          confidence: plan.completeness === "complete" ? "high" : "medium",
          module,
          payload: { ...plan },
          status: plan.completeness === "complete" ? "valid" : "provisional",
          uncertainties: plan.uncertainties.map((uncertainty) => ({
            ...uncertainty,
            module,
          })),
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "";
        const movementCode = {
          mobility_discomfort_details_missing: "MOBILITY_DISCOMFORT_DETAILS_MISSING",
          mobility_discomfort_unmapped: "MOBILITY_DISCOMFORT_UNMAPPED",
          mobility_training_limitation_details_missing:
            "MOBILITY_TRAINING_LIMITATION_DETAILS_MISSING",
          mobility_training_limitation_unmapped:
            "MOBILITY_TRAINING_LIMITATION_UNMAPPED",
        }[errorMessage];
        const code = movementCode
          ? movementCode
          : errorMessage.startsWith("mobility_catalog_") ||
              errorMessage.startsWith("mobility_alternative_missing_")
            ? "MOBILITY_CATALOG_COVERAGE_INSUFFICIENT"
            : "MOBILITY_ENGINE_UNAVAILABLE";
        return {
          confidence: "unknown",
          module,
          payload: { requested: true, stage: "mobility_engine" },
          status: "provisional",
          uncertainties: [
            {
              code,
              messageKey:
                code === "MOBILITY_CATALOG_COVERAGE_INSUFFICIENT"
                  ? "mobility.uncertainty.catalog_coverage_insufficient"
                  : code === "MOBILITY_ENGINE_UNAVAILABLE"
                    ? "mobility.uncertainty.engine_unavailable"
                    : `mobility.uncertainty.${code.toLowerCase()}`,
              module,
            },
          ],
        };
      }
    }
    if (module === "sleep") {
      try {
        const plan = SleepPlanSchema.parse(generateSleepPlan(context.answers));
        return {
          confidence: plan.confidence,
          module,
          payload: { ...plan },
          status: plan.status,
          uncertainties: plan.uncertainties.map((uncertainty) => ({
            ...uncertainty,
            module,
          })),
        };
      } catch {
        return {
          confidence: "unknown",
          module,
          payload: { requested: true, stage: "sleep_engine" },
          status: "provisional",
          uncertainties: [
            {
              code: "SLEEP_ENGINE_UNAVAILABLE",
              messageKey: "sleep.uncertainty.engine_unavailable",
              module,
            },
          ],
        };
      }
    }
    if (module === "supplements") {
      try {
        const plan = SupplementsPlanSchema.parse(
          generateSupplementsPlan({ answers: context.answers }),
        );
        return {
          confidence:
            plan.status === "complete"
              ? "high"
              : plan.status === "provisional"
                ? "medium"
                : "high",
          module,
          payload: { ...plan },
          status: plan.status === "complete" ? "valid" : "provisional",
          uncertainties: plan.uncertainties.map((reason) => ({
            code: reason.toUpperCase().replace(/[^A-Z0-9]+/g, "_"),
            messageKey: `supplements.uncertainty.${reason}`,
            module,
          })),
        };
      } catch {
        return {
          confidence: "unknown",
          module,
          payload: { requested: true, stage: "supplements_engine" },
          status: "provisional",
          uncertainties: [
            {
              code: "SUPPLEMENTS_ENGINE_UNAVAILABLE",
              messageKey: "supplements.uncertainty.engine_unavailable",
              module,
            },
          ],
        };
      }
    }
    return {
      confidence: "unknown",
      module,
      payload: { requested: true, stage: "deterministic_core" },
      status: "provisional",
      uncertainties: [
        {
          code: "MODULE_IMPLEMENTATION_PENDING",
          messageKey: "plan.module.implementation_pending",
          module,
        },
      ],
    };
  }
  return {
    confidence: "high",
    module,
    payload: {
      reason:
        module === "training" && context.answers.trainingMode === "none"
          ? "training_disabled_by_user"
          : "module_not_selected",
    },
    status: "not_requested",
    uncertainties: [],
  };
}

function normativeContext(context: ContextSnapshotInternal) {
  return {
    answers: context.answers,
    canonicalizationVersion: context.canonicalizationVersion,
    completeness: context.completeness,
    inputHash: context.inputHash,
    normalizationVersion: context.normalizationVersion,
    schemaVersion: context.schemaVersion,
  };
}

export async function runDeterministicEngine(
  input: DeterministicEngineInput,
): Promise<PlanEngineResult> {
  if (input.clinicalCatalogDescriptor !== undefined) {
    await assertClinicalCatalogDescriptor(input.clinicalCatalogDescriptor);
  }
  const medicationResolution = resolveCanonicalMedicationContext(
    input.context,
    input.canonicalMedicationIdentities,
  );
  const effectiveContext = medicationResolution.context;
  const affectedModules = new Set(
    input.change?.affectedModules ?? QUESTIONNAIRE_MODULES,
  );
  const baseResults = new Map(
    (input.baseModuleResults ?? []).map((result) => [result.module, result]),
  );
  const preservedModules: QuestionnaireModule[] = [];
  const recalculatedModules: QuestionnaireModule[] = [];
  let generatedTrainingLoad: GeneratedTrainingLoad | null | undefined;
  if (effectiveContext.answers.trainingMode === "generated") {
    generatedTrainingLoad = null;
    if (moduleChoice("training", effectiveContext) === "requested") {
      try {
        const trainingPlan = TrainingPlanSchema.parse(
          generateTrainingPlan(effectiveContext.answers),
        );
        if (trainingPlan.mode === "generated") {
          generatedTrainingLoad = {
            daysPerWeek: trainingPlan.availability.daysPerWeek,
            experience: trainingPlan.availability.level,
            sessionMinutes: trainingPlan.availability.sessionMinutes,
          };
        }
      } catch {
        generatedTrainingLoad = null;
      }
    }
  }
  const moduleResults = QUESTIONNAIRE_MODULES.map((module) => {
    const baseResult = baseResults.get(module);
    if (
      input.baseContext &&
      input.change &&
      !affectedModules.has(module) &&
      baseResult
    ) {
      preservedModules.push(module);
      return baseResult;
    }
    recalculatedModules.push(module);
    return provisionalModuleResult(
      module,
      effectiveContext,
      input.nutritionCatalog,
      generatedTrainingLoad,
    );
  });
  const errors = input.context.answers.activeModules?.length
    ? []
    : ["modules_required"];
  const validationStatus: "invalid" | "valid" =
    errors.length === 0 ? "valid" : "invalid";
  const moduleCompleteness =
    input.context.completeness === "provisional" ||
    moduleResults.some(({ status }) => status === "provisional")
      ? ("provisional" as const)
      : ("complete" as const);
  const inputHash = await sha256CanonicalJson({
    base:
      input.baseContext === null
        ? null
        : {
            context: normativeContext(input.baseContext),
            moduleResults: input.baseModuleResults ?? [],
          },
    change: input.change,
    configuration: {
      canonicalizationVersion: CONTEXT_CANONICALIZATION_VERSION,
      engineVersion: ENGINE_VERSION,
      ruleSetRevision: CORE_RULE_SET_REVISION,
      sourceManifest: CORE_SOURCE_MANIFEST,
      clinicalCatalogDescriptor: input.clinicalCatalogDescriptor ?? null,
      canonicalMedicationIdentities: medicationResolution.hashInput,
      nutritionCatalog: input.nutritionCatalog ?? null,
    },
    context: normativeContext(input.context),
  });
  const selectedClinicalModules = new Set(
    moduleResults
      .filter(({ status }) => status !== "not_requested")
      .map(({ module }) => module),
  );
  const clinical =
    selectedClinicalModules.size === 0
      ? null
      : detectClinicalContext(effectiveContext.answers);
  const safetyFindings = clinical
    ? (() => {
        const commonContextCodes = [
          "FLUID_RESTRICTION_ACTIVE",
          "RENAL_CONTEXT_PARTIAL",
          "CARDIAC_CONTEXT_PARTIAL",
          "HYPONATREMIA_CONTEXT_PARTIAL",
          "HYPERTENSION_CONTEXT_PARTIAL",
          "DIURETIC_CONTEXT_PARTIAL",
          "ANABOLIC_CONTEXT_PARTIAL",
          "GLP1_CONTEXT_PARTIAL",
          "ANTICOAGULANT_CONTEXT_PARTIAL",
          "PREGNANCY_CONTEXT_PARTIAL",
          "LACTATION_CONTEXT_PARTIAL",
          "PRECONCEPTION_CONTEXT_PARTIAL",
          "MENOPAUSE_CONTEXT_PARTIAL",
          "CLINICAL_CONTEXT_UNMODELED",
          "RETATRUTIDE_CONTEXT_UNMODELED",
        ];
        const moduleCodes: Record<QuestionnaireModule, ReadonlySet<string>> = {
          hydration: new Set([
            "FLUID_RESTRICTION_ACTIVE",
            "RENAL_CONTEXT_PARTIAL",
            "CARDIAC_CONTEXT_PARTIAL",
            "HYPONATREMIA_CONTEXT_PARTIAL",
            "DIURETIC_CONTEXT_PARTIAL",
            "ANABOLIC_CONTEXT_PARTIAL",
            "GLP1_CONTEXT_PARTIAL",
            "PREGNANCY_CONTEXT_PARTIAL",
            "LACTATION_CONTEXT_PARTIAL",
            "CLINICAL_CONTEXT_UNMODELED",
            "RETATRUTIDE_CONTEXT_UNMODELED",
          ]),
          mobility: new Set(commonContextCodes),
          nutrition: new Set(commonContextCodes),
          sleep: new Set(commonContextCodes),
          supplements: new Set([
            ...commonContextCodes,
            "MAGNESIUM_INTERACTION_PARTIAL",
          ]),
          training: new Set(commonContextCodes),
        };
        const findings: PlanEngineResult["safetyFindings"] = [];
        for (const finding of clinical.safetyFindings) {
          for (const module of selectedClinicalModules) {
            if (!moduleCodes[module].has(finding.code)) continue;
            if (
              findings.some(
                (item) => item.module === module && item.code === finding.code,
              )
            ) {
              continue;
            }
            findings.push({
              actionLevel: finding.actionLevel,
              code: finding.code,
              evidenceRef: finding.evidenceRef,
              messageKey: finding.messageKey,
              module,
            });
          }
        }
        return findings;
      })()
    : [];
  const clinicalRequiresProvisional =
    clinical !== null && clinical.coverage !== "modeled" && safetyFindings.length > 0;
  const completeness =
    moduleCompleteness === "provisional" || clinicalRequiresProvisional
      ? ("provisional" as const)
      : ("complete" as const);
  const provisionalReasons = [
    ...new Set([
      ...moduleResults.flatMap(({ uncertainties }) =>
        uncertainties.flatMap((uncertainty) => {
          if (
            uncertainty !== null &&
            typeof uncertainty === "object" &&
            "code" in uncertainty &&
            typeof uncertainty.code === "string"
          ) {
            return [uncertainty.code.toLowerCase()];
          }
          return [];
        }),
      ),
      ...safetyFindings.map(({ code }) => code.toLowerCase()),
      ...(clinicalRequiresProvisional && clinical
        ? [`clinical_context_${clinical.coverage}`]
        : []),
    ]),
  ];
  if (input.context.completeness === "provisional") {
    provisionalReasons.push("context_snapshot_provisional");
  }
  const validation = {
    checks: [
      "canonical_input",
      "module_coverage",
      "nutrition_catalog_effective_only",
      "training_optional",
      ...(input.clinicalCatalogDescriptor === undefined
        ? []
        : ["clinical_catalog_descriptor_exact_match"]),
    ],
    clinicalCatalogDescriptor: input.clinicalCatalogDescriptor ?? null,
    medicationIdentityResolution: medicationResolution.summary,
    completeness,
    errors,
    preservedModules,
    provisionalReasons,
    recalculatedModules,
    warnings: [],
  };
  const normativeOutput = {
    canonicalizationVersion: CONTEXT_CANONICALIZATION_VERSION,
    completeness,
    engineVersion: ENGINE_VERSION,
    inputHash,
    moduleResults,
    ruleSetRevisionId: RULE_SET_REVISION_ID,
    safetyFindings,
    sourceManifestId: SOURCE_MANIFEST_ID,
    validation,
    validationStatus,
  };

  return {
    ...normativeOutput,
    outputHash: await sha256CanonicalJson(normativeOutput),
  };
}

export * from "./modules/nutrition/index.ts";
export * from "./modules/hydration/index.ts";
export * from "./modules/mobility/index.ts";
export * from "./modules/sleep/index.ts";
export * from "./modules/training/index.ts";
export * from "./modules/supplements/index.ts";
