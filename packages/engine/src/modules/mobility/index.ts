import type { MobilityPlanContract } from "@health-design/contracts";
import type { ExerciseCatalogEntry, QuestionnaireAnswers } from "@health-design/domain";
import { EXERCISE_BY_ID, EXERCISE_CATALOG } from "@health-design/domain";

import {
  analyzeMovementLimitations,
  conflictsWithMovementLimitations,
} from "../movement-limitations.ts";
import { clinicalContextReviewCodes } from "../clinical-context.ts";

const mobilityCatalog = EXERCISE_CATALOG.filter((entry) =>
  entry.phases.includes("mobility"),
);
const MOBILITY_ANCHORS = [
  "after_training",
  "before_training",
  "daily_break",
  "evening",
  "morning",
] as const;
type MobilityAnchor = (typeof MOBILITY_ANCHORS)[number];
const MOBILITY_AREAS = [
  "ankles",
  "hips",
  "knees",
  "neck",
  "shoulders",
  "spine",
] as const;

function isMobilityAnchor(value: string): value is MobilityAnchor {
  return MOBILITY_ANCHORS.some((anchor) => anchor === value);
}

function isMobilityArea(value: string): boolean {
  return MOBILITY_AREAS.some((area) => area === value);
}

function isFunctionalAlternative(
  source: ExerciseCatalogEntry,
  candidate: ExerciseCatalogEntry,
  excludedAreas: ReadonlySet<string>,
): boolean {
  return (
    candidate.id !== source.id &&
    candidate.phases.includes("mobility") &&
    candidate.areas.some((area) => source.areas.includes(area)) &&
    !conflictsWithMovementLimitations(candidate, excludedAreas)
  );
}

function hasFunctionalAlternative(
  entry: ExerciseCatalogEntry,
  excludedAreas: ReadonlySet<string>,
): boolean {
  return mobilityCatalog.some((candidate) =>
    isFunctionalAlternative(entry, candidate, excludedAreas),
  );
}

function selectExercises(
  areas: readonly string[],
  excludedAreas: ReadonlySet<string>,
): ExerciseCatalogEntry[] {
  const available = mobilityCatalog.filter(
    (entry) => !conflictsWithMovementLimitations(entry, excludedAreas),
  );
  const selected: ExerciseCatalogEntry[] = [];
  const uncoveredAreas = new Set(areas);
  while (selected.length < 3 && uncoveredAreas.size > 0) {
    const candidate = available
      .filter((entry) => !selected.some(({ id }) => id === entry.id))
      .map((entry) => ({
        coverage: entry.areas.filter((area) => uncoveredAreas.has(area)).length,
        entry,
      }))
      .sort(
        (left, right) =>
          right.coverage - left.coverage || left.entry.id.localeCompare(right.entry.id),
      )[0];
    if (!candidate || candidate.coverage === 0) break;
    selected.push(candidate.entry);
    for (const area of candidate.entry.areas) uncoveredAreas.delete(area);
  }
  for (const entry of available) {
    if (selected.length >= 3) break;
    if (
      hasFunctionalAlternative(entry, excludedAreas) &&
      !selected.some(({ id }) => id === entry.id)
    ) {
      selected.push(entry);
    }
  }
  for (const entry of available) {
    if (selected.length >= 3) break;
    if (!selected.some(({ id }) => id === entry.id)) selected.push(entry);
  }
  if (selected.length === 0) throw new Error("mobility_catalog_empty");
  return selected.slice(0, 3);
}

function item(
  entry: ExerciseCatalogEntry,
  durationSeconds: number,
  excludedAreas: ReadonlySet<string>,
) {
  const explicit = entry.alternativeIds.flatMap((exerciseId) => {
    const alternative = EXERCISE_BY_ID.get(exerciseId);
    return alternative && isFunctionalAlternative(entry, alternative, excludedAreas)
      ? [alternative]
      : [];
  });
  const fallback = mobilityCatalog.filter(
    (alternative) =>
      alternative.id !== entry.id &&
      !explicit.some(({ id }) => id === alternative.id) &&
      isFunctionalAlternative(entry, alternative, excludedAreas),
  );
  const alternatives = [...explicit, ...fallback]
    .slice(0, 3)
    .map(({ id, name }) => ({ exerciseId: id, name }));
  return {
    alternatives,
    durationSeconds,
    exerciseId: entry.id,
    name: entry.name,
    steps: [...entry.steps],
    technique: entry.technique,
    visual: { alt: entry.visual.alt, src: entry.visual.src },
  };
}

function fiveMinuteBlock(
  entries: readonly ExerciseCatalogEntry[],
  excludedAreas: ReadonlySet<string>,
) {
  const base = Math.floor(300 / entries.length);
  return entries.map((entry, index) =>
    item(
      entry,
      base + (index === entries.length - 1 ? 300 - base * entries.length : 0),
      excludedAreas,
    ),
  );
}

export function generateMobilityPlan(
  answers: QuestionnaireAnswers,
): MobilityPlanContract {
  const totalMinutes = answers.mobilityMinutes ?? 5;
  const uncertainties: Array<{ code: string; messageKey: string }> = [];
  const discomfort = analyzeMovementLimitations(answers.mobilityDiscomfortDetails);
  const trainingLimitations = analyzeMovementLimitations(answers.trainingLimitations);
  const selectedAnchors = (answers.mobilityAnchors ?? []).filter(isMobilityAnchor);
  const selectedAreas = (answers.mobilityAreas ?? []).filter(isMobilityArea);
  if (answers.mobilityDiscomfortStatus === "declared") {
    if (discomfort.detailsMissing) {
      throw new Error("mobility_discomfort_details_missing");
    }
    if (discomfort.unmapped.length > 0) {
      throw new Error("mobility_discomfort_unmapped");
    }
  }
  if (answers.trainingLimitationsStatus === "declared") {
    if (trainingLimitations.detailsMissing) {
      throw new Error("mobility_training_limitation_details_missing");
    }
    if (trainingLimitations.unmapped.length > 0) {
      throw new Error("mobility_training_limitation_unmapped");
    }
  }
  const excludedAreas: ReadonlySet<string> = new Set([
    ...(answers.mobilityDiscomfortStatus === "declared" ? discomfort.areas : []),
    ...(answers.trainingLimitationsStatus === "declared"
      ? trainingLimitations.areas
      : []),
  ]);
  if (answers.mobilityMinutes === undefined) {
    uncertainties.push({
      code: "MOBILITY_DURATION_MISSING",
      messageKey: "mobility.uncertainty.duration_missing",
    });
  }
  if (selectedAreas.length === 0) {
    uncertainties.push({
      code: "MOBILITY_AREAS_MISSING",
      messageKey: "mobility.uncertainty.areas_missing",
    });
  } else if (selectedAreas.length !== answers.mobilityAreas?.length) {
    uncertainties.push({
      code: "MOBILITY_AREAS_UNMODELED",
      messageKey: "mobility.uncertainty.areas_unmodeled",
    });
  }
  if (selectedAnchors.length === 0) {
    uncertainties.push({
      code: "MOBILITY_ANCHORS_MISSING",
      messageKey: "mobility.uncertainty.anchors_missing",
    });
  }
  if (answers.mobilityDiscomfortStatus === "declared") {
    uncertainties.push({
      code: "MOBILITY_DISCOMFORT_REVIEW_REQUIRED",
      messageKey: "mobility.uncertainty.discomfort_review_required",
    });
  } else if (answers.mobilityDiscomfortStatus === "unknown") {
    uncertainties.push({
      code: "MOBILITY_DISCOMFORT_UNKNOWN",
      messageKey: "mobility.uncertainty.discomfort_unknown",
    });
  } else if (answers.mobilityDiscomfortStatus === undefined) {
    uncertainties.push({
      code: "MOBILITY_DISCOMFORT_MISSING",
      messageKey: "mobility.uncertainty.discomfort_missing",
    });
  }
  if (answers.trainingLimitationsStatus === "declared") {
    uncertainties.push({
      code: "MOBILITY_TRAINING_LIMITATION_REVIEW_REQUIRED",
      messageKey: "mobility.uncertainty.training_limitation_review_required",
    });
  } else if (answers.trainingLimitationsStatus === "unknown") {
    uncertainties.push({
      code: "MOBILITY_TRAINING_LIMITATIONS_UNKNOWN",
      messageKey: "mobility.uncertainty.training_limitations_unknown",
    });
  } else if (
    answers.trainingLimitationsStatus === undefined &&
    (answers.trainingMode === "generated" || answers.trainingMode === "own")
  ) {
    uncertainties.push({
      code: "MOBILITY_TRAINING_LIMITATIONS_MISSING",
      messageKey: "mobility.uncertainty.training_limitations_missing",
    });
  }
  for (const code of clinicalContextReviewCodes(answers).filter(
    (value) => value !== "MAGNESIUM_INTERACTION_PARTIAL",
  )) {
    if (uncertainties.some((uncertainty) => uncertainty.code === code)) continue;
    uncertainties.push({
      code,
      messageKey: `mobility.uncertainty.${code.toLowerCase()}`,
    });
  }
  const coreEntries = selectExercises(selectedAreas, excludedAreas);
  const remaining = mobilityCatalog.filter(
    (entry) =>
      !coreEntries.some(({ id }) => id === entry.id) &&
      !conflictsWithMovementLimitations(entry, excludedAreas),
  );
  const safeMobilityCatalog = mobilityCatalog.filter(
    (entry) => !conflictsWithMovementLimitations(entry, excludedAreas),
  );
  const functionalRemaining = remaining.filter((entry) =>
    hasFunctionalAlternative(entry, excludedAreas),
  );
  const functionalSafeCatalog = safeMobilityCatalog.filter((entry) =>
    hasFunctionalAlternative(entry, excludedAreas),
  );
  const extensionSource =
    functionalRemaining.length >= 3
      ? functionalRemaining
      : functionalSafeCatalog.length > 0
        ? functionalSafeCatalog
        : remaining.length > 0
          ? remaining
          : safeMobilityCatalog;
  const extensionCount = (totalMinutes - 5) / 5;
  if (extensionCount > 0 && extensionSource.length === 0) {
    throw new Error("mobility_catalog_coverage_insufficient");
  }
  const defaultAnchors =
    answers.trainingMode === "generated" || answers.trainingMode === "own"
      ? (["after_training", "morning"] as const)
      : (["daily_break", "morning"] as const);
  const extensions = Array.from({ length: extensionCount }, (_, index) => ({
    exercises: fiveMinuteBlock(
      Array.from(
        { length: Math.min(3, extensionSource.length) },
        (__, itemIndex) =>
          extensionSource[(index * 3 + itemIndex) % extensionSource.length]!,
      ),
      excludedAreas,
    ),
    label:
      index === 0 ? "Extensión de zonas prioritarias" : "Extensión global opcional",
    minutes: 5 as const,
  }));
  const coveredAreas = new Set(
    [
      ...coreEntries,
      ...extensions.flatMap(({ exercises }) =>
        exercises.flatMap(({ exerciseId }) => {
          const entry = EXERCISE_BY_ID.get(exerciseId);
          return entry ? [entry] : [];
        }),
      ),
    ].flatMap(({ areas }) => areas),
  );
  if (selectedAreas.some((area) => !coveredAreas.has(area))) {
    uncertainties.push({
      code: "MOBILITY_SELECTED_AREAS_PARTIAL",
      messageKey: "mobility.uncertainty.selected_areas_partial",
    });
  }
  const core = fiveMinuteBlock(coreEntries, excludedAreas);
  if (
    [...core, ...extensions.flatMap(({ exercises }) => exercises)].some(
      ({ alternatives }) => alternatives.length === 0,
    )
  ) {
    uncertainties.push({
      code: "MOBILITY_ALTERNATIVE_COVERAGE_PARTIAL",
      messageKey: "mobility.uncertainty.alternative_coverage_partial",
    });
  }

  return {
    anchorSource: selectedAnchors.length ? "selected" : "default",
    completeness: uncertainties.length === 0 ? "complete" : "provisional",
    core,
    coreMinutes: 5,
    extensions,
    suggestedAnchors: selectedAnchors.length ? selectedAnchors : [...defaultAnchors],
    totalMinutes,
    uncertainties,
  };
}
