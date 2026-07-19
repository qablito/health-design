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

function clinicalEntryParts(value: string): string[] {
  return value
    .split(/\s+(?:y|and|con|\/)\s+|\s*[+;|&]\s*/iu)
    .map((part) => part.trim())
    .filter(Boolean);
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
  const conditionEntries = entries(answers, "conditions");
  const medicationEntries = entries(answers, "medications");
  const conditionTexts = conditionEntries.map(normalizeClinicalText);
  const medicationTexts = medicationEntries.map(normalizeClinicalText);
  const conditionsConfirmed = answers.hasConditions;
  const medicationsConfirmed = answers.hasMedications;
  const conditionsDetailsMissing =
    conditionsConfirmed === true && conditionTexts.length === 0;
  const medicationsDetailsMissing =
    medicationsConfirmed === true && medicationTexts.length === 0;
  const allTexts = [...conditionTexts, ...medicationTexts];
  const catalogEntry = (code: string) =>
    CLINICAL_CATALOG.find((entry) => entry.code === code)!;
  const fluidRule = catalogEntry("FLUID_RESTRICTION_ACTIVE");
  const renalRule = catalogEntry("RENAL_CONTEXT_PARTIAL");
  const cardiacRule = catalogEntry("CARDIAC_CONTEXT_PARTIAL");
  const sodiumRule = catalogEntry("HYPONATREMIA_CONTEXT_PARTIAL");
  const hypertensionRule = catalogEntry("HYPERTENSION_CONTEXT_PARTIAL");
  const glp1Rule = catalogEntry("GLP1_CONTEXT_PARTIAL");
  const diureticRule = catalogEntry("DIURETIC_CONTEXT_PARTIAL");
  const anticoagulantRule = catalogEntry("ANTICOAGULANT_CONTEXT_PARTIAL");
  const magnesiumRule = catalogEntry("MAGNESIUM_INTERACTION_PARTIAL");
  const retatrutideRule = catalogEntry("RETATRUTIDE_CONTEXT_UNMODELED");
  const anabolicRule = catalogEntry("ANABOLIC_CONTEXT_PARTIAL");
  const pregnancyRule = catalogEntry("PREGNANCY_CONTEXT_PARTIAL");
  const lactationRule = catalogEntry("LACTATION_CONTEXT_PARTIAL");
  const preconceptionRule = catalogEntry("PRECONCEPTION_CONTEXT_PARTIAL");
  const menopauseRule = catalogEntry("MENOPAUSE_CONTEXT_PARTIAL");
  const fluidRestriction =
    answers.hydrationFluidRestriction === true ||
    answers.hydrationFluidRestriction === "declared" ||
    answers.fluidRestriction === true ||
    answers.liquidRestriction === true ||
    hasAlias(allTexts, fluidRule.aliases);
  const renal = hasAlias(conditionTexts, renalRule.aliases);
  const cardiac = hasAlias(conditionTexts, cardiacRule.aliases);
  const hyponatremia = hasAlias(conditionTexts, sodiumRule.aliases);
  const hypertension = hasAlias(conditionTexts, hypertensionRule.aliases);
  const glp1 = hasAlias(medicationTexts, glp1Rule.aliases);
  const diuretic = hasAlias(medicationTexts, diureticRule.aliases);
  const anticoagulant = hasAlias(medicationTexts, anticoagulantRule.aliases);
  const magnesiumInteraction = hasAlias(medicationTexts, magnesiumRule.aliases);
  const retatrutide = hasAlias(medicationTexts, retatrutideRule.aliases);
  const anabolic = hasAlias(medicationTexts, anabolicRule.aliases);
  const pregnancy = answers.pregnancyLactation === "pregnant";
  const lactation = answers.pregnancyLactation === "lactating";
  const preconception = answers.pregnancyLactation === "trying_to_conceive";
  const menopause =
    answers.menopauseStage === "peri" || answers.menopauseStage === "post";
  const physiologicalContextUnmodeled =
    answers.pregnancyLactation === "unknown" || answers.menopauseStage === "unknown";

  const safetyFindings: ClinicalSafetyFinding[] = [];
  const uncertainties: ClinicalUncertainty[] = [];
  const strategies: string[] = [];
  let strictestActionLevel: ActionLevel = "information";

  if (fluidRestriction) {
    const finding = findingFor(fluidRule);
    safetyFindings.push(finding);
    strictestActionLevel = actionMax(strictestActionLevel, finding.actionLevel);
    pushUnique(uncertainties, uncertainty("FLUID_LIMIT_NOT_PROVIDED"));
    strategies.push("fluid_limit_precedes_reference");
  }
  if (renal) {
    const finding = findingFor(renalRule);
    safetyFindings.push(finding);
    strictestActionLevel = actionMax(strictestActionLevel, finding.actionLevel);
  }
  if (cardiac) {
    const finding = findingFor(cardiacRule);
    safetyFindings.push(finding);
    strictestActionLevel = actionMax(strictestActionLevel, finding.actionLevel);
  }
  if (hyponatremia) {
    const finding = findingFor(sodiumRule);
    safetyFindings.push(finding);
    strictestActionLevel = actionMax(strictestActionLevel, finding.actionLevel);
  }
  if (hypertension) {
    const finding = findingFor(hypertensionRule);
    safetyFindings.push(finding);
    strictestActionLevel = actionMax(strictestActionLevel, finding.actionLevel);
    pushUnique(uncertainties, uncertainty("HYPERTENSION_CONTEXT_PARTIAL"));
    strategies.push("sodium_target_not_verified");
  }
  if ((renal || cardiac || hyponatremia) && !fluidRestriction) {
    pushUnique(uncertainties, uncertainty("CLINICAL_FLUID_LIMIT_MISSING"));
    strategies.push("clinical_limit_required");
  }
  if (glp1) {
    const finding = findingFor(glp1Rule);
    safetyFindings.push(finding);
    strictestActionLevel = actionMax(strictestActionLevel, finding.actionLevel);
    pushUnique(uncertainties, uncertainty("GLP1_CONTEXT_PARTIAL"));
    strategies.push("glp1_context_only");
  }
  if (diuretic) {
    const finding = findingFor(diureticRule);
    safetyFindings.push(finding);
    strictestActionLevel = actionMax(strictestActionLevel, finding.actionLevel);
    pushUnique(uncertainties, uncertainty("DIURETIC_CONTEXT_PARTIAL"));
    strategies.push("diuretic_mechanism_only");
  }
  if (anticoagulant) {
    const finding = findingFor(anticoagulantRule);
    safetyFindings.push(finding);
    strictestActionLevel = actionMax(strictestActionLevel, finding.actionLevel);
    pushUnique(uncertainties, uncertainty("ANTICOAGULANT_CONTEXT_PARTIAL"));
    strategies.push("anticoagulant_interaction_review");
  }
  if (magnesiumInteraction) {
    const finding = findingFor(magnesiumRule);
    safetyFindings.push(finding);
    strictestActionLevel = actionMax(strictestActionLevel, finding.actionLevel);
    pushUnique(uncertainties, uncertainty("MAGNESIUM_INTERACTION_PARTIAL"));
    strategies.push("magnesium_interaction_review");
  }
  if (retatrutide) {
    const finding = findingFor(retatrutideRule);
    safetyFindings.push(finding);
    strictestActionLevel = actionMax(strictestActionLevel, finding.actionLevel);
    pushUnique(uncertainties, uncertainty("RETATRUTIDE_CONTEXT_UNMODELED"));
    strategies.push("retatrutide_unmodeled");
  }
  if (anabolic) {
    const finding = findingFor(anabolicRule);
    safetyFindings.push(finding);
    strictestActionLevel = actionMax(strictestActionLevel, finding.actionLevel);
    pushUnique(uncertainties, uncertainty("ANABOLIC_CONTEXT_PARTIAL"));
    strategies.push("high_side_only");
  }
  if (pregnancy) {
    const finding = findingFor(pregnancyRule);
    safetyFindings.push(finding);
    strictestActionLevel = actionMax(strictestActionLevel, finding.actionLevel);
    strategies.push("pregnancy_context_only");
  }
  if (lactation) {
    const finding = findingFor(lactationRule);
    safetyFindings.push(finding);
    strictestActionLevel = actionMax(strictestActionLevel, finding.actionLevel);
    strategies.push("lactation_context_only");
  }
  if (preconception) {
    const finding = findingFor(preconceptionRule);
    safetyFindings.push(finding);
    strictestActionLevel = actionMax(strictestActionLevel, finding.actionLevel);
    strategies.push("preconception_context_only");
  }
  if (menopause) {
    const finding = findingFor(menopauseRule);
    safetyFindings.push(finding);
    strictestActionLevel = actionMax(strictestActionLevel, finding.actionLevel);
    strategies.push("menopause_context_only");
  }
  if (answers.pregnancyLactation === "unknown") {
    pushUnique(uncertainties, uncertainty("PREGNANCY_LACTATION_STATUS_UNKNOWN"));
    strategies.push("pregnancy_lactation_status_required");
  }
  if (answers.menopauseStage === "unknown") {
    pushUnique(uncertainties, uncertainty("MENOPAUSE_STATUS_UNKNOWN"));
    strategies.push("menopause_status_required");
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
  const contextParts = [...conditionEntries, ...medicationEntries].flatMap(
    clinicalEntryParts,
  );
  const hasUnknownContext = contextParts.some(
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
    hasUnknownContext ||
    physiologicalContextUnmodeled ||
    contextCoverage === "unmodeled" ||
    safetyFindings.some(
      ({ coverage: findingCoverage }) => findingCoverage === "unmodeled",
    )
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
      anticoagulant,
      cardiac,
      diuretic,
      fluidRestriction,
      glp1,
      hypertension,
      hyponatremia,
      lactation,
      magnesiumInteraction,
      menopause,
      preconception,
      pregnancy,
      renal,
      retatrutide,
    },
    safetyFindings,
    strategies,
    strictestActionLevel,
    uncertainties,
  };
}

export const evaluateClinicalContext = detectClinicalContext;
export const evaluateClinicalRules = detectClinicalContext;
