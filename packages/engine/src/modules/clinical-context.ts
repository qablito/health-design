import type { QuestionnaireAnswers } from "@health-design/domain";

import { detectClinicalContext } from "../clinical/index.ts";

type Answers = Partial<QuestionnaireAnswers> & Record<string, unknown>;

const MODULE_REVIEW_CODES = new Set([
  "FLUID_RESTRICTION_ACTIVE",
  "RENAL_CONTEXT_PARTIAL",
  "CARDIAC_CONTEXT_PARTIAL",
  "HYPONATREMIA_CONTEXT_PARTIAL",
  "HYPERTENSION_CONTEXT_PARTIAL",
  "GLP1_CONTEXT_PARTIAL",
  "DIURETIC_CONTEXT_PARTIAL",
  "ANTICOAGULANT_CONTEXT_PARTIAL",
  "RETATRUTIDE_CONTEXT_UNMODELED",
  "ANABOLIC_CONTEXT_PARTIAL",
  "PREGNANCY_CONTEXT_PARTIAL",
  "LACTATION_CONTEXT_PARTIAL",
  "PRECONCEPTION_CONTEXT_PARTIAL",
  "MENOPAUSE_CONTEXT_PARTIAL",
  "CLINICAL_CONTEXT_UNMODELED",
  "CONDITIONS_DETAILS_MISSING",
  "MEDICATIONS_DETAILS_MISSING",
  "PREGNANCY_LACTATION_STATUS_UNKNOWN",
  "MENOPAUSE_STATUS_UNKNOWN",
]);

/**
 * Returns explicit review codes only. It never turns a selective catalog match into
 * a dose change or a clinical diagnosis.
 */
export function clinicalContextReviewCodes(answers: Answers): string[] {
  const result = detectClinicalContext(answers);
  const codes: string[] = [];
  if (answers.hasConditions === undefined || answers.hasMedications === undefined) {
    codes.push("CLINICAL_CONTEXT_MISSING");
  }
  for (const code of [
    ...result.safetyFindings.map(({ code }) => code),
    ...result.uncertainties.map(({ code }) => code),
  ]) {
    if (MODULE_REVIEW_CODES.has(code)) codes.push(code);
  }
  return [...new Set(codes)];
}
