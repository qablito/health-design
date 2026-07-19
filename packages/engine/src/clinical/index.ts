import {
  CLINICAL_CATALOG,
  CLINICAL_CATALOG_VERSION,
  type ActionLevel,
  type ClinicalResult,
  type ClinicalSafetyFinding,
  type ClinicalUncertainty,
} from "@health-design/contracts";

const ACTION_ORDER: readonly ActionLevel[] = [
  "information",
  "adjustment",
  "priority_review",
  "immediate_conservative",
];

/** Unicode NFC/NFD differences and accents never change clinical matching. */
export function normalizeClinicalText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("es-ES")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

function unwrapAnswers(input: unknown): Record<string, unknown> {
  const record = asRecord(input);
  return "answers" in record ? asRecord(record.answers) : record;
}

function entries(record: Record<string, unknown>, key: string): string[] {
  const value = record[key];
  if (!Array.isArray(value)) return [];
  return value
    .map((entry: unknown) => {
      if (typeof entry === "string") return entry;
      const name = asRecord(entry).name;
      return typeof name === "string" ? name : "";
    })
    .filter((value): value is string => value.length > 0);
}

function phraseMatches(text: string, phrase: string): boolean {
  const textTokens = normalizeClinicalText(text).split(" ").filter(Boolean);
  const phraseTokens = normalizeClinicalText(phrase).split(" ").filter(Boolean);
  if (phraseTokens.length === 0 || phraseTokens.length > textTokens.length)
    return false;
  return textTokens.some((_, index) =>
    phraseTokens.every((token, offset) => textTokens[index + offset] === token),
  );
}

function hasAlias(texts: readonly string[], aliases: readonly string[]): boolean {
  return texts.some((text) => aliases.some((alias) => phraseMatches(text, alias)));
}

function pushUnique<T extends { code: string }>(items: T[], item: T): void {
  if (!items.some(({ code }) => code === item.code)) items.push(item);
}

function actionMax(current: ActionLevel, candidate: ActionLevel): ActionLevel {
  return ACTION_ORDER.indexOf(candidate) > ACTION_ORDER.indexOf(current)
    ? candidate
    : current;
}

function findingFor(entry: (typeof CLINICAL_CATALOG)[number]): ClinicalSafetyFinding {
  return {
    actionLevel: entry.actionLevel,
    code: entry.code,
    coverage: entry.coverage,
    evidenceRef: `catalog:${CLINICAL_CATALOG_VERSION}/${entry.code}`,
    messageKey: `clinical.finding.${entry.code.toLowerCase()}`,
    ruleKind: entry.kind,
  };
}

function uncertainty(code: string): ClinicalUncertainty {
  return {
    code,
    messageKey: `clinical.uncertainty.${code.toLowerCase()}`,
  };
}

export type ClinicalContextInput = unknown;

export function detectClinicalContext(input: ClinicalContextInput): ClinicalResult {
  const answers = unwrapAnswers(input);
  const conditionTexts = entries(answers, "conditions").map(normalizeClinicalText);
  const medicationTexts = entries(answers, "medications").map(normalizeClinicalText);
  const conditionsConfirmed = answers.hasConditions;
  const medicationsConfirmed = answers.hasMedications;
  const conditionsDetailsMissing =
    conditionsConfirmed === true && conditionTexts.length === 0;
  const medicationsDetailsMissing =
    medicationsConfirmed === true && medicationTexts.length === 0;
  const allTexts = [...conditionTexts, ...medicationTexts];
  const fluidRestriction =
    answers.hydrationFluidRestriction === true ||
    answers.hydrationFluidRestriction === "declared" ||
    answers.fluidRestriction === true ||
    answers.liquidRestriction === true ||
    hasAlias(allTexts, CLINICAL_CATALOG[0].aliases);
  const renal = hasAlias(conditionTexts, CLINICAL_CATALOG[1].aliases);
  const cardiac = hasAlias(conditionTexts, CLINICAL_CATALOG[2].aliases);
  const hyponatremia = hasAlias(conditionTexts, CLINICAL_CATALOG[3].aliases);
  const glp1 = hasAlias(medicationTexts, CLINICAL_CATALOG[4].aliases);
  const diuretic = hasAlias(medicationTexts, CLINICAL_CATALOG[5].aliases);
  const anabolic = hasAlias(medicationTexts, CLINICAL_CATALOG[6].aliases);

  const safetyFindings: ClinicalSafetyFinding[] = [];
  const uncertainties: ClinicalUncertainty[] = [];
  const strategies: string[] = [];
  let strictestActionLevel: ActionLevel = "information";

  if (fluidRestriction) {
    const finding = findingFor(CLINICAL_CATALOG[0]);
    safetyFindings.push(finding);
    strictestActionLevel = actionMax(strictestActionLevel, finding.actionLevel);
    pushUnique(uncertainties, uncertainty("FLUID_LIMIT_NOT_PROVIDED"));
    strategies.push("fluid_limit_precedes_reference");
  }
  if (renal) {
    const finding = findingFor(CLINICAL_CATALOG[1]);
    safetyFindings.push(finding);
    strictestActionLevel = actionMax(strictestActionLevel, finding.actionLevel);
  }
  if (cardiac) {
    const finding = findingFor(CLINICAL_CATALOG[2]);
    safetyFindings.push(finding);
    strictestActionLevel = actionMax(strictestActionLevel, finding.actionLevel);
  }
  if (hyponatremia) {
    const finding = findingFor(CLINICAL_CATALOG[3]);
    safetyFindings.push(finding);
    strictestActionLevel = actionMax(strictestActionLevel, finding.actionLevel);
  }
  if ((renal || cardiac || hyponatremia) && !fluidRestriction) {
    pushUnique(uncertainties, uncertainty("CLINICAL_FLUID_LIMIT_MISSING"));
    strategies.push("clinical_limit_required");
  }
  if (glp1) {
    const finding = findingFor(CLINICAL_CATALOG[4]);
    safetyFindings.push(finding);
    strictestActionLevel = actionMax(strictestActionLevel, finding.actionLevel);
    pushUnique(uncertainties, uncertainty("GLP1_CONTEXT_PARTIAL"));
    strategies.push("glp1_context_only");
  }
  if (diuretic) {
    const finding = findingFor(CLINICAL_CATALOG[5]);
    safetyFindings.push(finding);
    strictestActionLevel = actionMax(strictestActionLevel, finding.actionLevel);
    pushUnique(uncertainties, uncertainty("DIURETIC_CONTEXT_PARTIAL"));
    strategies.push("diuretic_mechanism_only");
  }
  if (anabolic) {
    const finding = findingFor(CLINICAL_CATALOG[6]);
    safetyFindings.push(finding);
    strictestActionLevel = actionMax(strictestActionLevel, finding.actionLevel);
    pushUnique(uncertainties, uncertainty("ANABOLIC_CONTEXT_PARTIAL"));
    strategies.push("high_side_only");
  }

  if (conditionsConfirmed === undefined) {
    pushUnique(uncertainties, uncertainty("CONDITIONS_CONFIRMATION_MISSING"));
    strategies.push("clinical_conditions_confirmation_required");
  } else if (conditionsDetailsMissing) {
    pushUnique(uncertainties, uncertainty("CONDITIONS_DETAILS_MISSING"));
    strategies.push("clinical_conditions_details_required");
  }
  if (medicationsConfirmed === undefined) {
    pushUnique(uncertainties, uncertainty("MEDICATIONS_CONFIRMATION_MISSING"));
    strategies.push("clinical_medications_confirmation_required");
  } else if (medicationsDetailsMissing) {
    pushUnique(uncertainties, uncertainty("MEDICATIONS_DETAILS_MISSING"));
    strategies.push("clinical_medications_details_required");
  }

  const knownTexts = CLINICAL_CATALOG.flatMap(({ aliases }) => aliases).map(
    normalizeClinicalText,
  );
  const hasUnknownContext = allTexts.some(
    (text) => !knownTexts.some((alias) => phraseMatches(text, alias)),
  );
  if (hasUnknownContext) {
    const finding: ClinicalSafetyFinding = {
      actionLevel: "priority_review",
      code: "CLINICAL_CONTEXT_UNMODELED",
      coverage: "unmodeled",
      evidenceRef: `catalog:${CLINICAL_CATALOG_VERSION}/unmodeled`,
      messageKey: "clinical.finding.context_unmodeled",
      ruleKind: "conditional",
    };
    safetyFindings.push(finding);
    strictestActionLevel = actionMax(strictestActionLevel, finding.actionLevel);
    pushUnique(uncertainties, uncertainty("CLINICAL_CONTEXT_UNMODELED"));
  }

  const contextCoverage =
    conditionsConfirmed === undefined || medicationsConfirmed === undefined
      ? "unmodeled"
      : conditionsDetailsMissing || medicationsDetailsMissing
        ? "partial"
        : "modeled";
  const coverage =
    hasUnknownContext || contextCoverage === "unmodeled"
      ? "unmodeled"
      : contextCoverage === "partial" || safetyFindings.length > 0
        ? "partial"
        : "modeled";
  if (safetyFindings.length === 0) strategies.push("no_selective_clinical_override");

  return {
    catalogVersion: CLINICAL_CATALOG_VERSION,
    coverage,
    detected: {
      anabolic,
      cardiac,
      diuretic,
      fluidRestriction,
      glp1,
      hyponatremia,
      renal,
    },
    safetyFindings,
    strategies,
    strictestActionLevel,
    uncertainties,
  };
}

export const evaluateClinicalContext = detectClinicalContext;
export const evaluateClinicalRules = detectClinicalContext;
