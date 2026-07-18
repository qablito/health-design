import type { QuestionnaireAnswers } from "../questionnaire/index.ts";

export const CONTEXT_NORMALIZATION_VERSION = "normalization-v1" as const;
export const CONTEXT_CANONICALIZATION_VERSION = "canonical-json-v1" as const;

export type ContextSnapshotState = Readonly<{
  answers: Readonly<QuestionnaireAnswers>;
  canonicalizationVersion: typeof CONTEXT_CANONICALIZATION_VERSION;
  completeness: "complete" | "provisional";
  createdAt: string;
  effectiveAt: string;
  hashAlgorithm: "sha256";
  id: string;
  inputHash: string;
  normalizationVersion: typeof CONTEXT_NORMALIZATION_VERSION;
  profileId: string;
  schemaVersion: 1;
  sourceDraftId: string;
  sourceDraftVersion: number;
}>;
