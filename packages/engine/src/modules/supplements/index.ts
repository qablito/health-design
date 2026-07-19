import {
  SupplementsPlanSchema,
  type ClinicalResult,
  type LabSummary,
  type SupplementExperimentalOption,
  type SupplementRecommendation,
  type SupplementsPlanContract,
} from "@health-design/contracts";
import type { LabValueEntry, QuestionnaireAnswers } from "@health-design/domain";

import { detectClinicalContext, normalizeClinicalText } from "../../clinical/index.ts";

type Answers = Partial<QuestionnaireAnswers> & Record<string, unknown>;
type Input = Answers | Readonly<{ answers: Answers; clinical?: ClinicalResult }>;

const B12_SOURCE = "source:nih-ods-vitamin-b12-fact-sheet@1.0.0";
const FOLATE_SOURCE = "source:who-cdc-folic-acid-preconception@1.0.0";
const CREATINE_SOURCE = "source:nih-ods-exercise-creatine-issn-position@1.0.0";
const OMEGA3_SOURCE = "source:nih-ods-omega-3-fact-sheet@1.0.0";
const CAFFEINE_SOURCE = "source:efsa-caffeine-scientific-opinion@1.0.0";
const ELECTROLYTE_SOURCE = "source:acsm-hydration-exercise-position@1.0.0";
const MELATONIN_SOURCE = "source:aemps-ema-nccih-melatonin-safety@1.0.0";
const MAGNESIUM_SOURCE = "source:nih-ods-magnesium-fact-sheet@1.0.0";
const EXPERIMENTAL_SOURCES = [
  "source:pubmed-beta-alanine-review@1.0.0",
  "source:pubmed-glycine-sleep-review@1.0.0",
  "source:pubmed-theanine-sleep-review@1.0.0",
  "source:pubmed-ashwagandha-review@1.0.0",
] as const;

const NOT_RECOMMENDED = [
  {
    id: "fat_burners",
    reason: "No es una recomendación segura ni necesaria en V1.",
    evidenceRefs: ["contract:t12-supplements-not-recommended-v1"],
  },
  {
    id: "testosterone_boosters",
    reason: "No hay base para recomendar potenciadores hormonales comerciales.",
    evidenceRefs: ["contract:t12-supplements-not-recommended-v1"],
  },
  {
    id: "sarms",
    reason: "No se recomiendan moduladores selectivos de receptores androgénicos.",
    evidenceRefs: ["contract:t12-supplements-not-recommended-v1"],
  },
  {
    id: "peptides",
    reason: "No se recomiendan péptidos ni se ajustan tratamientos.",
    evidenceRefs: ["contract:t12-supplements-not-recommended-v1"],
  },
  {
    id: "opaque_blends",
    reason: "No se recomiendan mezclas opacas sin composición verificable.",
    evidenceRefs: ["contract:t12-supplements-not-recommended-v1"],
  },
] as const;

const EXPERIMENTAL: ReadonlyArray<{
  id: "beta_alanine" | "glycine" | "l_theanine" | "ashwagandha";
  purpose: string;
  expectedBenefit: string;
  form: string;
  risks: string[];
  interactions: string[];
  metric: string;
}> = [
  {
    id: "beta_alanine",
    purpose: "Explorar tolerancia a esfuerzos intensos repetidos.",
    expectedBenefit: "Beneficio pequeño e incierto en esfuerzos de alta intensidad.",
    form: "Beta-alanina; detalle no prescriptivo.",
    risks: ["Parestesia y molestias gastrointestinales."],
    interactions: ["Revisión individual si existe medicación o condición no modelada."],
    metric: "Rendimiento en sesiones comparables.",
  },
  {
    id: "glycine",
    purpose: "Explorar una estrategia contextual de descanso.",
    expectedBenefit: "Beneficio pequeño e incierto para la percepción del descanso.",
    form: "Glicina; detalle no prescriptivo.",
    risks: ["Molestias gastrointestinales o somnolencia subjetiva."],
    interactions: ["Revisión individual con otros sedantes."],
    metric: "Calidad de sueño percibida y funcionamiento diurno.",
  },
  {
    id: "l_theanine",
    purpose: "Explorar una estrategia contextual de descanso y funcionamiento diurno.",
    expectedBenefit: "Beneficio pequeño e incierto para la calidad del sueño.",
    form: "L-teanina; detalle no prescriptivo.",
    risks: ["Somnolencia o cefalea."],
    interactions: ["Revisión individual con sedantes o antihipertensivos."],
    metric: "Calidad de sueño percibida y funcionamiento diurno.",
  },
  {
    id: "ashwagandha",
    purpose: "Explorar una estrategia contextual de sueño.",
    expectedBenefit:
      "Beneficio pequeño e incierto para el sueño, con riesgos clínicos no triviales.",
    form: "Withania somnifera; detalle no prescriptivo.",
    risks: ["Molestias gastrointestinales y posibles efectos hepáticos o tiroideos."],
    interactions: [
      "Revisión individual obligatoria con tratamientos tiroideos, sedantes o inmunomoduladores.",
    ],
    metric: "Calidad de sueño percibida, funcionamiento diurno y tolerancia.",
  },
];
const EXPERIMENTAL_SOURCE_BY_ID: Record<(typeof EXPERIMENTAL)[number]["id"], string> = {
  beta_alanine: EXPERIMENTAL_SOURCES[0],
  glycine: EXPERIMENTAL_SOURCES[1],
  l_theanine: EXPERIMENTAL_SOURCES[2],
  ashwagandha: EXPERIMENTAL_SOURCES[3],
};

function asAnswers(input: Input): Answers {
  const record = input as Record<string, unknown>;
  return ("answers" in record ? record.answers : record) as Answers;
}

function clinicalFor(input: Input, answers: Answers): ClinicalResult {
  const record = input as Record<string, unknown>;
  return "clinical" in record && record.clinical !== undefined
    ? (record.clinical as ClinicalResult)
    : detectClinicalContext(answers);
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function textOf(answers: Answers): string {
  return [
    ...(Array.isArray(answers.supplementGoals) ? answers.supplementGoals : []),
    typeof answers.primaryObjective === "string" ? answers.primaryObjective : "",
    ...(Array.isArray(answers.secondaryObjectives) ? answers.secondaryObjectives : []),
  ]
    .filter((value): value is string => typeof value === "string")
    .map(normalizeClinicalText)
    .join(" ");
}

function hasText(answers: Answers, aliases: readonly string[]): boolean {
  const text = textOf(answers);
  return aliases.some((alias) => text.includes(normalizeClinicalText(alias)));
}

function performanceContext(answers: Answers): boolean {
  const text = textOf(answers);
  const performanceGoal =
    text.includes("performance") ||
    text.includes("strength") ||
    text.includes("hypertrophy") ||
    text.includes("fuerza") ||
    text.includes("hipertrofia") ||
    text.includes("rendimiento") ||
    text.includes("musculo") ||
    text.includes("musculo") ||
    text.includes("muscle");
  const realTraining =
    (answers.trainingMode === "own" || answers.trainingMode === "generated") &&
    ((typeof answers.ownTrainingSessionMinutes === "number" &&
      answers.ownTrainingSessionMinutes > 0) ||
      (typeof answers.generatedTrainingSessionMinutes === "number" &&
        answers.generatedTrainingSessionMinutes > 0) ||
      (typeof answers.ownTrainingDaysPerWeek === "number" &&
        answers.ownTrainingDaysPerWeek > 0) ||
      (typeof answers.generatedTrainingDaysPerWeek === "number" &&
        answers.generatedTrainingDaysPerWeek > 0));
  return performanceGoal && realTraining;
}

function caffeinePerformanceContext(answers: Answers): boolean {
  return (
    performanceContext(answers) &&
    (answers.primaryObjective === "performance_strength" ||
      answers.primaryObjective === "performance_hypertrophy" ||
      answers.primaryObjective === "performance_endurance" ||
      answers.primaryObjective === "performance_general_fitness" ||
      hasText(answers, ["cafeina", "caffeine", "rendimiento"]))
  );
}

function healthyClinicalContext(clinical: ClinicalResult): boolean {
  const unknownCoverage = clinical.uncertainties.some(({ code }) =>
    [
      "CLINICAL_CONTEXT_UNMODELED",
      "CONDITIONS_CONFIRMATION_MISSING",
      "CONDITIONS_DETAILS_MISSING",
      "MEDICATIONS_CONFIRMATION_MISSING",
      "MEDICATIONS_DETAILS_MISSING",
      "RETATRUTIDE_CONTEXT_UNMODELED",
    ].includes(code),
  );
  return (
    !unknownCoverage &&
    !clinical.detected.renal &&
    !clinical.detected.cardiac &&
    !clinical.detected.hyponatremia &&
    !clinical.detected.fluidRestriction &&
    !clinical.detected.diuretic
  );
}

function recommendation(
  value: Omit<SupplementRecommendation, "action"> & {
    action?: SupplementRecommendation["action"];
  },
): SupplementRecommendation {
  return { action: "review_later", ...value };
}

function experimentalOption(
  value: (typeof EXPERIMENTAL)[number],
): SupplementExperimentalOption {
  return {
    ...value,
    action: "review_later",
    contraindications: ["No usar para sustituir valoración clínica."],
    confidence: "low",
    doseReference: null,
    duration: null,
    evidence: "limited",
    evidenceRefs: [EXPERIMENTAL_SOURCE_BY_ID[value.id]],
    stopCondition: "Suspender ante intolerancia o empeoramiento y revisar.",
    tier: "experimental",
  };
}

function normalizedUnit(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[μµ]/g, "u")
    .replace(/\s+/g, "")
    .replace(/·/g, "")
    .replace(/per/g, "/");
  const aliases: Record<string, string> = {
    "pg/ml": "pg/mL",
    pgml: "pg/mL",
    "pmol/l": "pmol/L",
    "pmol/litro": "pmol/L",
    "ng/ml": "ng/mL",
    ngml: "ng/mL",
    "nmol/l": "nmol/L",
    "mg/dl": "mg/dL",
    mgdl: "mg/dL",
    "mg/l": "mg/L",
    "mmol/l": "mmol/L",
    "umol/l": "umol/L",
    "umol/litro": "umol/L",
    "ml/min/1.73m2": "mL/min/1.73m²",
    "ml/min/1.73m²": "mL/min/1.73m²",
  };
  return aliases[normalized] ?? null;
}

type Analyte = "b12" | "folate" | "magnesium" | "creatinine" | "egfr";

const ANALYTE_UNITS: Readonly<Record<Analyte, readonly string[]>> = {
  b12: ["pg/mL", "pmol/L"],
  folate: ["ng/mL", "nmol/L"],
  magnesium: ["mg/dL", "mmol/L"],
  creatinine: ["mg/dL", "umol/L"],
  egfr: ["mL/min/1.73m²"],
};

function analyteFor(name: unknown): Analyte | null {
  if (typeof name !== "string") return null;
  const value = normalizeClinicalText(name);
  if (["b12", "vitamina b12", "vitamin b12", "cobalamina"].includes(value))
    return "b12";
  if (["folato", "folate", "acido folico", "vitamina b9", "vitamin b9"].includes(value))
    return "folate";
  if (["magnesio", "magnesium"].includes(value)) return "magnesium";
  if (["creatinina", "creatinine"].includes(value)) return "creatinine";
  if (
    [
      "egfr",
      "filtrado glomerular",
      "filtrado glomerular estimado",
      "tasa de filtrado glomerular",
    ].includes(value)
  )
    return "egfr";
  return null;
}

const UNIT_CONVERSIONS: Record<string, Record<string, number>> = {
  "pg/mL": { "pg/mL": 1, "pmol/L": 0.7378 },
  "pmol/L": { "pmol/L": 1, "pg/mL": 1 / 0.7378 },
  "ng/mL": { "ng/mL": 1, "nmol/L": 2.266 },
  "nmol/L": { "nmol/L": 1, "ng/mL": 1 / 2.266 },
  "mg/dL": { "mg/dL": 1, "mmol/L": 0.4114 },
  "mmol/L": { "mmol/L": 1, "mg/dL": 1 / 0.4114 },
  "mg/L": { "mg/L": 1 },
  "umol/L": { "umol/L": 1 },
  "mL/min/1.73m²": { "mL/min/1.73m²": 1 },
};

const ANALYTE_UNIT_CONVERSIONS: Readonly<
  Partial<Record<Analyte, Record<string, Record<string, number>>>>
> = {
  creatinine: {
    "mg/dL": { "mg/dL": 1, "umol/L": 88.4 },
    "umol/L": { "umol/L": 1, "mg/dL": 1 / 88.4 },
  },
};

function parseNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const trimmed = value.trim().replace(",", ".");
  return /^[-+]?\d+(?:\.\d+)?$/.test(trimmed) ? Number(trimmed) : null;
}

function parseRange(
  value: unknown,
  fallbackUnit: string,
): { minimum: number; maximum: number; unit: string } | null {
  if (typeof value !== "string") return null;
  const range = value.trim().replace(/,/g, ".");
  const match = range.match(
    /^\s*([-+]?\d+(?:\.\d+)?)\s*(?:-|–|—|to)\s*([-+]?\d+(?:\.\d+)?)\s*([^\d]*)?$/i,
  );
  if (!match) return null;
  const unit = normalizedUnit(match[3]?.trim() || fallbackUnit);
  if (!unit) return null;
  const minimum = Number(match[1]);
  const maximum = Number(match[2]);
  return minimum <= maximum ? { minimum, maximum, unit } : null;
}

function convert(
  value: number,
  analyte: Analyte,
  from: string,
  to: string,
): number | null {
  const factor =
    ANALYTE_UNIT_CONVERSIONS[analyte]?.[from]?.[to] ?? UNIT_CONVERSIONS[from]?.[to];
  return factor === undefined ? null : value * factor;
}

function normalizeLabs(answers: Answers): LabSummary[] {
  const values = Array.isArray(answers.labValues) ? answers.labValues : [];
  return values.map((entry) => {
    const record = (entry ?? {}) as Partial<LabValueEntry> & Record<string, unknown>;
    const name =
      typeof record.name === "string" && record.name.trim()
        ? record.name.trim()
        : "Analítica sin nombre";
    const analyte = analyteFor(record.name);
    if (!analyte) return { name, reason: "analyte", status: "unrecognized" } as const;
    const rawValue = record.value;
    if (
      rawValue === undefined ||
      rawValue === null ||
      (typeof rawValue === "string" && rawValue.trim().length === 0)
    )
      return { name, reason: "missing_value", status: "incomplete" } as const;
    const rawUnit = record.unit;
    if (
      rawUnit === undefined ||
      rawUnit === null ||
      (typeof rawUnit === "string" && rawUnit.trim().length === 0)
    )
      return { name, reason: "missing_unit", status: "incomplete" } as const;
    const value = parseNumber(record.value);
    if (value === null || value < 0)
      return { name, reason: "value", status: "unrecognized" } as const;
    const unit = normalizedUnit(record.unit);
    if (!unit) return { name, reason: "unit", status: "unrecognized" } as const;
    if (!ANALYTE_UNITS[analyte].includes(unit))
      return { name, reason: "unit", status: "unrecognized" } as const;
    const range = parseRange(record.referenceRange, unit);
    if (!record.referenceRange)
      return { name, reason: "missing_reference_range", status: "incomplete" } as const;
    if (!range)
      return {
        name,
        reason: "ambiguous_reference_range",
        status: "incomplete",
      } as const;
    if (!ANALYTE_UNITS[analyte].includes(range.unit))
      return { name, reason: "unit", status: "unrecognized" } as const;
    const convertedValue = convert(value, analyte, unit, range.unit);
    const finalValue = convertedValue ?? (unit === range.unit ? value : null);
    if (finalValue === null)
      return { name, reason: "unit", status: "unrecognized" } as const;
    const interpretation =
      finalValue < range.minimum
        ? "below_range"
        : finalValue > range.maximum
          ? "above_range"
          : "within_range";
    return {
      analyte,
      interpretation,
      name,
      referenceRange: range,
      status: "recognized",
      unit: range.unit,
      value: finalValue,
    } as const;
  });
}

function emptyNotRequested(): SupplementsPlanContract {
  return {
    clinicalCoverage: "modeled",
    completeness: "complete",
    currentSupplements: [],
    experimentalOptions: [],
    labSummary: [],
    notRecommended: [],
    recommendations: [],
    status: "not_requested",
    stopConditions: [],
    strictestActionLevel: "information",
    uncertainties: [],
  };
}

export function generateSupplementsPlan(input: Input): SupplementsPlanContract {
  const answers = asAnswers(input);
  if (
    !Array.isArray(answers.activeModules) ||
    !answers.activeModules.includes("supplements")
  ) {
    return emptyNotRequested();
  }
  const clinical = clinicalFor(input, answers);
  const preference = answers.supplementRecommendationPreference ?? "contextual";
  const labs = normalizeLabs(answers);
  const recommendations: SupplementRecommendation[] = [];
  const experimentalOptions: SupplementExperimentalOption[] = [];
  const uncertainties: string[] = [];
  const currentSupplements = Array.isArray(answers.currentSupplements)
    ? answers.currentSupplements
        .filter(
          (entry): entry is { name: string; note?: string } =>
            !!entry && typeof entry.name === "string" && entry.name.trim().length > 0,
        )
        .map((entry) => ({
          classification:
            /creatina|creatine|omega|melatonina|magnesio|b12|folato|cafeina|caffeine/i.test(
              entry.name,
            )
              ? ("known_context" as const)
              : ("opaque_context" as const),
          status: "recorded_context" as const,
        }))
    : [];
  const clinicalUnmodeled = clinical.coverage !== "modeled";
  if (clinicalUnmodeled) uncertainties.push("clinical_coverage_partial_or_unmodeled");
  if (
    answers.hasCurrentSupplements === true &&
    (!Array.isArray(answers.currentSupplements) ||
      answers.currentSupplements.length === 0)
  )
    uncertainties.push("current_supplements_details_missing");
  if (
    answers.hasCurrentSupplements === false &&
    Array.isArray(answers.currentSupplements) &&
    answers.currentSupplements.length > 0
  )
    uncertainties.push("current_supplements_confirmation_conflict");
  const currentNames = Array.isArray(answers.currentSupplements)
    ? answers.currentSupplements
        .map((entry) =>
          entry && typeof entry.name === "string"
            ? normalizeClinicalText(entry.name)
            : "",
        )
        .filter(Boolean)
    : [];
  const hasCurrent = (aliases: readonly string[]) =>
    aliases.some((alias) =>
      currentNames.some((name) => name.includes(normalizeClinicalText(alias))),
    );
  const supplementContextMissing =
    answers.dietaryPattern === undefined &&
    answers.primaryObjective === undefined &&
    answers.trainingMode === undefined &&
    (!Array.isArray(answers.supplementGoals) || answers.supplementGoals.length === 0);
  if (supplementContextMissing) uncertainties.push("supplement_context_missing");

  const relevantIncompleteLab = labs.some(
    (lab) =>
      lab.status === "incomplete" &&
      ["b12", "folate", "magnesium", "creatinine", "egfr"].includes(
        analyteFor(lab.name) ?? "",
      ),
  );
  if (relevantIncompleteLab) uncertainties.push("relevant_lab_incomplete");

  const lowB12 = labs.some(
    (lab) =>
      lab.status === "recognized" &&
      lab.analyte === "b12" &&
      lab.interpretation === "below_range",
  );
  const lowMagnesium = labs.some(
    (lab) =>
      lab.status === "recognized" &&
      lab.analyte === "magnesium" &&
      lab.interpretation === "below_range",
  );
  const renalLabConcern = labs.some(
    (lab) =>
      lab.status === "recognized" &&
      ((lab.analyte === "creatinine" && lab.interpretation === "above_range") ||
        (lab.analyte === "egfr" && lab.interpretation === "below_range")),
  );
  if (renalLabConcern) uncertainties.push("renal_lab_context_requires_review");

  const deficiencyB12 = answers.dietaryPattern === "vegan" || lowB12;
  const preconception = answers.pregnancyLactation === "trying_to_conceive";
  const pregnancyOrLactation =
    answers.pregnancyLactation === "pregnant" ||
    answers.pregnancyLactation === "lactating";
  const healthy = healthyClinicalContext(clinical) && !renalLabConcern;
  const foodFirst =
    "Alimentos fortificados primero; no se automatiza una dosis sin revisión de la analítica y el contexto.";

  if (
    preconception &&
    preference !== "none" &&
    !hasCurrent(["folato", "acido folico", "folic"])
  ) {
    recommendations.push(
      recommendation({
        action: "trial_candidate",
        confidence: "high",
        contraindications: [
          "No sustituye atención prenatal ni indicación clínica individual.",
        ],
        doseReference:
          "400 µg/día desde al menos 1 mes antes hasta 12 semanas de gestación.",
        duration: "Desde ≥1 mes antes de la concepción hasta 12 semanas.",
        evidence: "high",
        evidenceRefs: [FOLATE_SOURCE],
        expectedBenefit: "Reducir el riesgo de defectos del tubo neural.",
        form: "Ácido fólico; alimentos y suplemento de formulación validada.",
        id: "folic_acid_preconception",
        interactions: [
          "Revisar tratamientos y antecedentes antes de cambiar la pauta.",
        ],
        metric: "Confirmación de la ventana preconcepcional y seguimiento prenatal.",
        purpose: "Prevención periconcepcional.",
        risks: ["No se escala automáticamente a una pauta de alta dosis."],
        stopCondition:
          "Revisar al alcanzar 12 semanas o ante indicación clínica distinta.",
        tier: "deficiency",
      }),
    );
  }
  if (
    deficiencyB12 &&
    preference !== "none" &&
    !hasCurrent(["b12", "vitamina b12", "cobalamina"])
  ) {
    recommendations.push(
      recommendation({
        action: recommendations.length === 0 ? "trial_candidate" : "review_later",
        confidence: lowB12 ? "medium" : "high",
        contraindications: [
          "Si existe déficit confirmado, la corrección queda subordinada a su causa, absorción, medicación y analítica; T12 no automatiza la dosis.",
        ],
        doseReference: null,
        duration: null,
        evidence: "high",
        evidenceRefs: [B12_SOURCE],
        expectedBenefit:
          "Cubrir una necesidad potencial de vitamina B12 sin desplazar la alimentación.",
        form: foodFirst,
        id: "vitamin_b12",
        interactions: [
          "Revisar absorción, medicación y analítica si el déficit está confirmado.",
        ],
        metric: "Valor actual de B12 con rango aportado y síntomas relevantes declarados.",
        purpose: "Prevención o revisión de carencia asociada a veganismo o valor bajo.",
        risks: ["No se automatiza dosis."],
        stopCondition:
          "Revisar si la analítica no confirma necesidad o aparecen efectos adversos.",
        tier: "deficiency",
      }),
    );
  }
  if (preference !== "none" && preference === "contextual") {
    if (
      performanceContext(answers) &&
      healthy &&
      !hasCurrent(["creatina", "creatine"])
    ) {
      recommendations.push(
        recommendation({
          action: recommendations.length === 0 ? "trial_candidate" : "review_later",
          confidence: "medium",
          contraindications: [
            "Revisión prioritaria si hay enfermedad renal, restricción de líquidos o cobertura clínica incompleta.",
          ],
          doseReference:
            "Referencia contextual: 3 g/día, sin carga; no es una pauta automática.",
          duration: null,
          evidence: "moderate",
          evidenceRefs: [CREATINE_SOURCE],
          expectedBenefit:
            "Posible mejora modesta del rendimiento de fuerza en personas sanas.",
          form: "Creatina monohidrato.",
          id: "creatine_monohydrate",
          interactions: ["No combinar con incertidumbre renal sin revisión."],
          metric: "Rendimiento en levantamientos o sesiones comparables.",
          purpose: "Rendimiento y fuerza.",
          risks: ["Retención de agua o molestias gastrointestinales."],
          stopCondition:
            "Suspender y revisar si aparece intolerancia o cambia el contexto renal.",
          tier: "contextual",
        }),
      );
    } else if (performanceContext(answers) && !healthy) {
      uncertainties.push("creatine_blocked_by_clinical_or_renal_uncertainty");
    }
    if (
      (answers.dietaryPattern === "vegetarian" ||
        answers.dietaryPattern === "vegan" ||
        hasText(answers, ["poco pescado", "bajo consumo de pescado", "low fish"])) &&
      !hasCurrent(["omega", "epa", "dha"])
    ) {
      recommendations.push(
        recommendation({
          action: clinical.detected.anticoagulant
            ? "review_required"
            : recommendations.length === 0
              ? "trial_candidate"
              : "review_later",
          confidence: "medium",
          contraindications: [
            "Revisar medicación, embarazo y objetivo antes de elegir una fuente.",
          ],
          doseReference: null,
          duration: null,
          evidence: "moderate",
          evidenceRefs: [OMEGA3_SOURCE],
          expectedBenefit:
            "Cubrir una ingesta baja de EPA/DHA cuando la alimentación no la aporta.",
          form: "EPA/DHA de fuente validada; priorizar alimentos cuando sea posible.",
          id: "omega_3_epa_dha",
          interactions: ["Revisar anticoagulantes y procedimientos clínicos."],
          metric: "Registro de consumo de pescado o fuente de EPA/DHA.",
          purpose: "Contexto de bajo consumo de pescado o patrón vegetariano/vegano.",
          risks: [
            "No se formula una afirmación universal de prevención cardiovascular.",
          ],
          stopCondition: "Revisar si cambia el patrón alimentario o la medicación.",
          tier: "contextual",
        }),
      );
    }
    const poorSleep =
      answers.sleepQuality === "poor" ||
      answers.sleepQuality === "very_poor" ||
      (typeof answers.sleepHours === "number" && answers.sleepHours < 7);
    if (
      caffeinePerformanceContext(answers) &&
      !poorSleep &&
      healthy &&
      !hasCurrent(["cafeina", "caffeine"])
    ) {
      recommendations.push(
        recommendation({
          action: recommendations.length === 0 ? "trial_candidate" : "review_later",
          confidence: "medium",
          contraindications: [
            "No usar para compensar privación de sueño, ansiedad o síntomas clínicos.",
          ],
          doseReference:
            "Referencia inicial contextual: 2 mg/kg, máximo 200 mg por toma y 400 mg/día en adulto sano.",
          duration: null,
          evidence: "moderate",
          evidenceRefs: [CAFFEINE_SOURCE],
          expectedBenefit:
            "Mejora puntual del rendimiento en tareas o sesiones seleccionadas.",
          form: "Bebida o alimento con cafeína; nunca polvo puro.",
          id: "caffeine_performance",
          interactions: ["Revisar ansiedad, presión arterial, medicación y sueño."],
          metric: "Rendimiento y calidad de sueño posterior.",
          purpose: "Rendimiento, no recomendación general de energía.",
          risks: ["Insomnio, ansiedad, palpitaciones y tolerancia."],
          stopCondition:
            "Reducir o retirar si empeora sueño, ansiedad o síntomas cardiovasculares.",
          tier: "contextual",
        }),
      );
    } else if (caffeinePerformanceContext(answers) && poorSleep) {
      uncertainties.push("caffeine_sleep_reduction_strategy");
    }
    const longTraining = (answers.ownTrainingSessionMinutes ??
      answers.generatedTrainingSessionMinutes) as unknown;
    const electrolytesTrigger =
      (answers.hydrationClimate === "hot" && answers.hydrationSweat === "high") ||
      (typeof longTraining === "number" && longTraining > 60);
    const electrolyteBlocked =
      clinical.detected.renal ||
      clinical.detected.cardiac ||
      clinical.detected.hyponatremia ||
      clinical.detected.fluidRestriction ||
      clinical.detected.diuretic ||
      clinical.coverage !== "modeled";
    if (
      electrolytesTrigger &&
      !electrolyteBlocked &&
      !hasCurrent(["electrolito", "electrolyte"])
    ) {
      recommendations.push(
        recommendation({
          action: recommendations.length === 0 ? "trial_candidate" : "review_later",
          confidence: "medium",
          contraindications: [
            "Revisión obligatoria si hay enfermedad renal, cardiaca, hiponatremia, restricción de líquidos o diuréticos.",
          ],
          doseReference: null,
          duration: null,
          evidence: "moderate",
          evidenceRefs: [ELECTROLYTE_SOURCE],
          expectedBenefit:
            "Apoyar una estrategia de hidratación contextual en calor y sudoración alta o sesiones largas.",
          form: "Bebida o alimento con electrolitos de composición transparente.",
          id: "electrolytes_contextual",
          interactions: ["No usar una dosis diaria fija."],
          metric: "Duración, calor, sudoración y tolerancia de la sesión.",
          purpose: "Contexto específico de calor/sudoración o entrenamiento >1 hora.",
          risks: ["Exceso de sodio o líquidos; no sustituye una valoración clínica."],
          stopCondition:
            "Revisar si aparecen cefalea, náuseas, edema o síntomas clínicos.",
          tier: "contextual",
        }),
      );
    } else if (electrolytesTrigger && electrolyteBlocked) {
      uncertainties.push("electrolytes_clinical_override");
    }
    const shiftOrPoorSleep =
      answers.dailySchedule === "shift_work" ||
      answers.sleepQuality === "poor" ||
      answers.sleepQuality === "very_poor";
    if (shiftOrPoorSleep && !hasCurrent(["melatonina", "melatonin"])) {
      recommendations.push(
        recommendation({
          action: clinical.detected.anticoagulant ? "review_required" : "review_later",
          confidence: "low",
          contraindications: [
            "Revisión clínica y de medicación antes de usar melatonina.",
          ],
          doseReference: null,
          duration: null,
          evidence: "limited",
          evidenceRefs: [MELATONIN_SOURCE],
          expectedBenefit:
            "Posible ayuda contextual en sueño alterado, con beneficio variable.",
          form: "Melatonina; sin dosis automática en V1.",
          id: "melatonin_sleep_context",
          interactions: ["Revisar sedantes, embarazo, lactancia y conducción."],
          metric: "Latencia, duración y funcionamiento diurno del sueño.",
          purpose: "Contexto de sueño pobre o trabajo a turnos.",
          risks: ["Somnolencia, sueños vívidos y variabilidad de respuesta."],
          stopCondition:
            "Suspender si produce somnolencia residual o empeora el funcionamiento.",
          tier: "contextual",
        }),
      );
    }
    const ppiContext =
      Array.isArray(answers.medications) &&
      answers.medications.some(
        (entry) =>
          typeof entry?.name === "string" &&
          /omeprazol|omeprazole|esomeprazol|esomeprazole|pantoprazol|pantoprazole|lansoprazol|lansoprazole|rabeprazol|rabeprazole/i.test(
            entry.name,
          ),
      );
    if (
      (lowMagnesium ||
        hasText(answers, ["bajo magnesio", "insuficiencia de magnesio"]) ||
        ppiContext) &&
      !clinical.detected.renal &&
      !hasCurrent(["magnesio", "magnesium"])
    ) {
      recommendations.push(
        recommendation({
          action: recommendations.length === 0 ? "trial_candidate" : "review_later",
          confidence: lowMagnesium ? "medium" : "low",
          contraindications: ["Nunca usar automáticamente con enfermedad renal."],
          doseReference: null,
          duration: null,
          evidence: "moderate",
          evidenceRefs: [MAGNESIUM_SOURCE],
          expectedBenefit:
            "Revisar una posible carencia de magnesio sin desplazar fuentes alimentarias.",
          form: "Alimentos ricos en magnesio; suplemento solo tras revisión.",
          id: "magnesium_context",
          interactions: [
            "Separar y revisar con tetraciclinas, quinolonas, bisfosfonatos y PPIs.",
          ],
          metric: "Valor de magnesio con rango aportado y tolerancia.",
          purpose: "Insuficiencia alimentaria, valor bajo reconocido o contexto PPI.",
          risks: ["Diarrea y riesgo clínico si existe enfermedad renal."],
          stopCondition:
            "Suspender ante diarrea o cambio del contexto renal/medicamentoso.",
          tier: "contextual",
        }),
      );
    }
    const relevantExperimental = EXPERIMENTAL.filter(({ id }) =>
      id === "beta_alanine"
        ? performanceContext(answers)
        : id === "glycine"
          ? answers.sleepQuality === "poor" || answers.sleepQuality === "very_poor"
          : id === "l_theanine"
            ? answers.sleepQuality === "poor" || answers.sleepQuality === "very_poor"
            : answers.sleepQuality === "poor" || answers.sleepQuality === "very_poor",
    );
    for (const option of relevantExperimental) {
      if (hasCurrent([option.id.replace("_", " "), option.id])) continue;
      if (experimentalOptions.some(({ id }) => id === option.id)) continue;
      experimentalOptions.push(experimentalOption(option));
    }
  }
  if (pregnancyOrLactation) {
    uncertainties.push("pregnancy_or_lactation_context_requires_review");
    const blockedIds = new Set([
      "creatine_monohydrate",
      "caffeine_performance",
      "electrolytes_contextual",
    ]);
    recommendations.splice(
      0,
      recommendations.length,
      ...recommendations
        .filter(({ id }) => !blockedIds.has(id))
        .map((item) =>
          item.tier === "contextual"
            ? { ...item, action: "review_required" as const, doseReference: null }
            : item,
        ),
    );
    experimentalOptions.length = 0;
  }
  if (preference === "none") {
    recommendations.length = 0;
    experimentalOptions.length = 0;
  }
  const filteredRecommendations =
    preference === "only_deficiencies"
      ? recommendations.filter(({ tier }) => tier === "deficiency")
      : recommendations;
  const preconceptionFolateTrialAllowed =
    preconception &&
    clinicalUnmodeled &&
    clinical.safetyFindings.length === 1 &&
    clinical.safetyFindings[0]?.code === "PRECONCEPTION_CONTEXT_PARTIAL" &&
    uncertainties.every((code) => code === "clinical_coverage_partial_or_unmodeled");
  const conservativeRecommendations =
    clinicalUnmodeled || relevantIncompleteLab
      ? filteredRecommendations.map((item) =>
          item.action === "trial_candidate" &&
          !(preconceptionFolateTrialAllowed && item.id === "folic_acid_preconception")
            ? { ...item, action: "review_required" as const }
            : item,
        )
      : filteredRecommendations;
  const status =
    uncertainties.length > 0 || clinicalUnmodeled || relevantIncompleteLab
      ? "provisional"
      : "complete";
  const result = {
    clinicalCoverage: clinical.coverage,
    completeness: status === "complete" ? "complete" : "provisional",
    currentSupplements,
    experimentalOptions,
    labSummary: labs,
    notRecommended: NOT_RECOMMENDED.map(({ evidenceRefs, id, reason }) => ({
      evidenceRefs: [...evidenceRefs],
      id,
      reason,
    })),
    recommendations: conservativeRecommendations,
    status: status === "complete" ? "complete" : "provisional",
    stopConditions: conservativeRecommendations.map(
      ({ stopCondition }) => stopCondition,
    ),
    strictestActionLevel: clinical.strictestActionLevel,
    uncertainties: unique(uncertainties),
  } satisfies SupplementsPlanContract;
  return SupplementsPlanSchema.parse(result);
}

export { normalizeLabs };
export const normalizeCurrentLabs = normalizeLabs;
export const normalizeLabValues = normalizeLabs;
export default generateSupplementsPlan;
