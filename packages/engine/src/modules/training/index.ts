import {
  estimateTrainingSessionMinutes,
  type ExercisePrescriptionContract,
  type TrainingPlanContract,
} from "@health-design/contracts";
import type { QuestionnaireAnswers, TrainingExperience } from "@health-design/domain";
import { EXERCISE_BY_ID, EXERCISE_CATALOG } from "@health-design/domain";

import {
  analyzeMovementLimitations,
  conflictsWithMovementLimitations,
} from "../movement-limitations.ts";
import { clinicalContextReviewCodes } from "../clinical-context.ts";

const WEEK_PROGRESSION = [
  {
    mainSets: 2,
    progression: "Aprende el recorrido y termina cada serie con margen cómodo.",
    rir: 4,
    rpe: 6,
  },
  {
    mainSets: 3,
    progression: "Añade una serie solo si mantienes la misma técnica.",
    rir: 3,
    rpe: 7,
  },
  {
    mainSets: 3,
    progression: "Suma una repetición por serie sin superar el esfuerzo indicado.",
    rir: 2,
    rpe: 7,
  },
  {
    mainSets: 2,
    progression: "Consolida el bloque con menos volumen y ejecución precisa.",
    rir: 3,
    rpe: 6,
  },
] as const;

const SUPPORTED_STYLES = new Set([
  "bodyweight",
  "endurance",
  "functional_hiit",
  "hypertrophy",
  "pilates",
  "sport_preparation",
  "strength",
  "yoga",
]);

function stylesForObjective(objective: string | undefined): readonly string[] {
  if (objective === "performance_strength") return ["strength"];
  if (
    [
      "body_composition_gain_muscle",
      "body_composition_recomposition",
      "performance_hypertrophy",
    ].includes(objective ?? "")
  ) {
    return ["hypertrophy"];
  }
  if (objective === "performance_endurance") return ["endurance"];
  if (objective === "body_composition_lose_fat") {
    return ["endurance", "strength"];
  }
  if (
    [
      "body_composition_maintain",
      "performance_general_fitness",
      "wellbeing_energy",
      "wellbeing_healthy_habits",
    ].includes(objective ?? "")
  ) {
    return ["bodyweight", "endurance"];
  }
  return [];
}

function resolveStylePreferences(
  requestedStyles: readonly string[],
  primaryObjective: string | undefined,
  secondaryObjectives: readonly string[] | undefined,
) {
  const matchingStyles = new Set<string>();
  let matchAny = false;
  let unmodeled = false;
  for (const style of requestedStyles) {
    if (style === "strength_hypertrophy") {
      matchingStyles.add("strength");
      matchingStyles.add("hypertrophy");
    } else if (style === "no_preference") {
      const objectiveStyles = [
        primaryObjective,
        ...(secondaryObjectives ?? []),
      ].flatMap(stylesForObjective);
      if (objectiveStyles.length > 0) {
        for (const objectiveStyle of objectiveStyles) {
          matchingStyles.add(objectiveStyle);
        }
      } else {
        matchAny = true;
      }
    } else if (style === "other" || !SUPPORTED_STYLES.has(style)) {
      matchingStyles.add("bodyweight");
      unmodeled = true;
    } else {
      matchingStyles.add(style);
    }
  }
  if (!matchAny && matchingStyles.size === 0) matchingStyles.add("bodyweight");
  return { matchAny, matchingStyles: [...matchingStyles], unmodeled };
}

type TrainingPhase = "cooldown" | "main" | "warmup";
type DoseMode =
  "combined" | "control" | "general" | "hypertrophy" | "interval" | "strength";
type RecoveryRole = "reduced_load" | "standard";

const OBJECTIVE_LABELS: Readonly<Record<string, string>> = {
  body_composition_gain_muscle: "ganancia de masa muscular",
  body_composition_lose_fat: "pérdida de grasa",
  body_composition_maintain: "mantenimiento corporal",
  body_composition_recomposition: "recomposición corporal",
  performance_endurance: "resistencia",
  performance_general_fitness: "condición física general",
  performance_hypertrophy: "hipertrofia",
  performance_strength: "fuerza",
  wellbeing_energy: "energía cotidiana",
  wellbeing_healthy_habits: "hábitos saludables",
  wellbeing_sleep: "descanso",
  wellbeing_stress: "gestión del estrés",
};
const OWN_TRAINING_ANCHORS = new Set([
  "afternoon",
  "early_morning",
  "evening",
  "midday",
  "morning",
  "variable",
]);

function doseMode(styles: readonly string[], primaryObjective: string | undefined) {
  if (styles.includes("functional_hiit") || styles.includes("endurance")) {
    return "interval" as const;
  }
  if (
    styles.includes("strength_hypertrophy") ||
    (styles.includes("strength") && styles.includes("hypertrophy"))
  ) {
    return "combined" as const;
  }
  if (styles.includes("strength")) return "strength" as const;
  if (styles.includes("hypertrophy")) return "hypertrophy" as const;
  if (styles.includes("pilates") || styles.includes("yoga")) {
    return "control" as const;
  }
  if (
    ["performance_strength"].includes(primaryObjective ?? "") &&
    (styles.includes("bodyweight") || styles.includes("no_preference"))
  ) {
    return "strength" as const;
  }
  if (
    [
      "body_composition_gain_muscle",
      "body_composition_recomposition",
      "performance_hypertrophy",
    ].includes(primaryObjective ?? "") &&
    (styles.includes("bodyweight") || styles.includes("no_preference"))
  ) {
    return "hypertrophy" as const;
  }
  if (
    primaryObjective === "performance_endurance" &&
    (styles.includes("bodyweight") || styles.includes("no_preference"))
  ) {
    return "interval" as const;
  }
  return "general" as const;
}

function trainingFocus(
  styles: readonly string[],
  primaryObjective: string | undefined,
  recoveryRole: RecoveryRole,
): string {
  let focus = "Preparación física general";
  if (styles.includes("strength_hypertrophy")) {
    focus = "Fuerza e hipertrofia combinadas";
  } else if (styles.includes("strength")) {
    focus = "Fuerza general";
  } else if (styles.includes("hypertrophy")) {
    focus = "Hipertrofia general";
  } else if (styles.includes("functional_hiit")) {
    focus = "Preparación funcional por intervalos";
  } else if (styles.includes("sport_preparation")) {
    focus = "Preparación física para deporte";
  } else if (styles.includes("endurance")) {
    focus = "Resistencia cardiovascular";
  } else if (styles.includes("pilates")) {
    focus = "Control corporal inspirado en Pilates";
  } else if (styles.includes("yoga")) {
    focus = "Fuerza y control inspirados en yoga";
  } else if (styles.includes("bodyweight")) {
    focus = "Fuerza general con peso corporal";
  }
  const objective = primaryObjective
    ? (OBJECTIVE_LABELS[primaryObjective] ?? primaryObjective)
    : null;
  return [
    focus,
    objective ? `apoyo a ${objective}` : null,
    recoveryRole === "reduced_load" ? "carga reducida" : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

function isCompatibleAlternative(
  candidate: (typeof EXERCISE_CATALOG)[number],
  phase: TrainingPhase,
  excludedAreas: ReadonlySet<string>,
  equipment: readonly string[],
  level: TrainingExperience,
  styles: readonly string[],
  matchAnyStyle: boolean,
) {
  return (
    candidate.phases.includes(phase) &&
    candidate.levels.includes(level) &&
    candidate.equipment.some((item) => equipment.includes(item)) &&
    !conflictsWithMovementLimitations(candidate, excludedAreas) &&
    (phase !== "main" ||
      matchAnyStyle ||
      candidate.styles.some((style) => styles.includes(style)))
  );
}

function alternativeNames(
  exerciseId: string,
  phase: TrainingPhase,
  excludedAreas: ReadonlySet<string>,
  equipment: readonly string[],
  level: TrainingExperience,
  styles: readonly string[],
  matchAnyStyle: boolean,
) {
  const entry = EXERCISE_BY_ID.get(exerciseId);
  if (!entry) throw new Error(`exercise_missing_${exerciseId}`);
  const compatible = (candidateId: string) => {
    const candidate = EXERCISE_BY_ID.get(candidateId);
    return candidate &&
      candidate.id !== exerciseId &&
      candidate.areas.some((area) => entry.areas.includes(area)) &&
      (candidate.defaultDurationSeconds !== undefined) ===
        (entry.defaultDurationSeconds !== undefined) &&
      isCompatibleAlternative(
        candidate,
        phase,
        excludedAreas,
        equipment,
        level,
        styles,
        matchAnyStyle,
      )
      ? candidate
      : null;
  };
  const explicit = entry.alternativeIds.flatMap((candidateId) => {
    const candidate = compatible(candidateId);
    return candidate ? [candidate] : [];
  });
  const fallback = EXERCISE_CATALOG.filter(
    (candidate) =>
      !explicit.some(({ id }) => id === candidate.id) &&
      compatible(candidate.id) !== null,
  );
  const alternatives = [...explicit, ...fallback]
    .slice(0, 3)
    .map(({ id, name }) => ({ exerciseId: id, name }));
  return alternatives;
}

function prescription(
  exerciseId: string,
  weekIndex: number,
  phase: "cooldown" | "main" | "warmup",
  excludedAreas: ReadonlySet<string>,
  level: TrainingExperience | "unknown",
  equipment: readonly string[],
  styles: readonly string[],
  matchAnyStyle: boolean,
  mode: DoseMode,
  recoveryRole: RecoveryRole,
  maximumMainSets: number,
): ExercisePrescriptionContract {
  const entry = EXERCISE_BY_ID.get(exerciseId);
  if (!entry) throw new Error(`exercise_missing_${exerciseId}`);
  const progression = WEEK_PROGRESSION[weekIndex]!;
  const isMain = phase === "main";
  const effectiveLevel = level === "unknown" ? "beginner" : level;
  const setAdjustment = level === "advanced" ? 1 : 0;
  const effortAdjustment =
    level === "advanced" ? 1 : level === "intermediate" ? 0.5 : 0;
  const rirAdjustment = level === "advanced" ? -1 : 0;
  const baseSets = isMain ? progression.mainSets + setAdjustment : 1;
  const sets = isMain
    ? Math.min(
        maximumMainSets,
        Math.max(1, baseSets - (recoveryRole === "reduced_load" ? 1 : 0)),
      )
    : 1;
  const intervalSeconds = 30 + weekIndex * 5;
  const repetitions =
    entry.defaultDurationSeconds !== undefined
      ? undefined
      : !isMain || mode === "general" || mode === "control"
        ? entry.defaultRepetitions
        : mode === "strength"
          ? "5-8"
          : mode === "combined"
            ? "6-10"
            : mode === "hypertrophy"
              ? "8-12"
              : undefined;
  const durationSeconds =
    isMain && mode === "interval" ? intervalSeconds : entry.defaultDurationSeconds;
  const restSeconds = !isMain
    ? 15
    : mode === "strength"
      ? 90
      : mode === "interval"
        ? 30
        : mode === "control"
          ? 30
          : 60;
  const recoveryRpeAdjustment = recoveryRole === "reduced_load" ? -1 : 0;
  const recoveryRirAdjustment = recoveryRole === "reduced_load" ? 1 : 0;
  return {
    alternatives: alternativeNames(
      entry.id,
      phase,
      excludedAreas,
      equipment,
      effectiveLevel,
      styles,
      matchAnyStyle,
    ),
    ...(durationSeconds === undefined ? {} : { durationSeconds }),
    exerciseId: entry.id,
    name: entry.name,
    progression: isMain
      ? progression.progression
      : "Amplía el recorrido únicamente si sigue siendo cómodo y controlado.",
    ...(repetitions === undefined ? {} : { repetitions }),
    restSeconds,
    ...(isMain
      ? {
          rir: Math.min(
            5,
            Math.max(1, progression.rir + rirAdjustment + recoveryRirAdjustment),
          ),
          rpe: Math.max(
            1,
            Math.min(8, progression.rpe + effortAdjustment + recoveryRpeAdjustment),
          ),
        }
      : {}),
    sets,
    steps: [...entry.steps],
    technique: entry.technique,
    technicalTerms: [
      {
        explanation:
          "El tempo indica cuánto dura cada parte del movimiento; prioriza siempre el control.",
        term: "Tempo",
      },
      ...(isMain
        ? [
            {
              explanation:
                "RPE es el esfuerzo percibido de 1 a 10; 7 significa exigente pero controlado.",
              term: "RPE",
            },
            {
              explanation:
                durationSeconds === undefined
                  ? "RIR son las repeticiones que podrías hacer antes de perder una técnica sólida."
                  : "En una serie por tiempo, RIR representa el margen técnico equivalente: los segundos de trabajo que aún podrías sostener sin perder una ejecución sólida.",
              term: "RIR",
            },
          ]
        : []),
    ],
    tempo: entry.tempo,
    visual: { alt: entry.visual.alt, src: entry.visual.src },
  };
}

function fitSessionToAvailability(
  session: {
    cooldown: ExercisePrescriptionContract[];
    main: ExercisePrescriptionContract[];
    warmup: ExercisePrescriptionContract[];
  },
  maximumMinutes: number,
) {
  const fitted = {
    cooldown: [...session.cooldown],
    main: session.main.map((exercise) => ({ ...exercise })),
    warmup: [...session.warmup],
  };
  let guard = 0;
  while (estimateTrainingSessionMinutes(fitted) > maximumMinutes && guard < 100) {
    guard += 1;
    const reducible = fitted.main
      .map((exercise, index) => ({ index, sets: exercise.sets }))
      .filter(({ sets }) => sets > 1)
      .sort((left, right) => right.sets - left.sets)[0];
    if (reducible) {
      const exercise = fitted.main[reducible.index]!;
      fitted.main[reducible.index] = { ...exercise, sets: exercise.sets - 1 };
      continue;
    }
    const interval = fitted.main.findIndex(
      ({ durationSeconds }) => (durationSeconds ?? 0) > 20,
    );
    if (interval >= 0) {
      const exercise = fitted.main[interval]!;
      fitted.main[interval] = {
        ...exercise,
        durationSeconds: Math.max(20, (exercise.durationSeconds ?? 25) - 5),
      };
      continue;
    }
    if (fitted.main.length > 1) {
      fitted.main.pop();
      continue;
    }
    break;
  }
  if (estimateTrainingSessionMinutes(fitted) > maximumMinutes) {
    throw new Error("training_session_duration_insufficient");
  }
  return { ...fitted, durationMinutes: estimateTrainingSessionMinutes(fitted) };
}

function appendClinicalReviewUncertainties(
  answers: QuestionnaireAnswers,
  uncertainties: Array<{ code: string; messageKey: string }>,
): void {
  const codes = clinicalContextReviewCodes(answers).filter(
    (code) => code !== "MAGNESIUM_INTERACTION_PARTIAL",
  );
  for (const code of codes) {
    if (uncertainties.some((uncertainty) => uncertainty.code === code)) continue;
    uncertainties.push({
      code,
      messageKey: `training.uncertainty.${code.toLowerCase()}`,
    });
  }
}

function candidateOrder(level: TrainingExperience, equipment: readonly string[]) {
  const targetDifficulty = {
    advanced: 3,
    beginner: 1,
    intermediate: 2,
  }[level];
  const equipmentAvailable = equipment.some((item) => item !== "none");
  return (
    left: (typeof EXERCISE_CATALOG)[number],
    right: (typeof EXERCISE_CATALOG)[number],
  ) => {
    const equipmentDifference = equipmentAvailable
      ? Number(left.equipment.includes("none")) -
        Number(right.equipment.includes("none"))
      : 0;
    if (equipmentDifference !== 0) return equipmentDifference;
    const difficultyDifference =
      Math.abs(left.difficulty - targetDifficulty) -
      Math.abs(right.difficulty - targetDifficulty);
    return difficultyDifference !== 0
      ? difficultyDifference
      : left.id.localeCompare(right.id);
  };
}

function rotatedIds(
  entries: readonly (typeof EXERCISE_CATALOG)[number][],
  count: number,
  offset: number,
): string[] {
  return Array.from(
    { length: Math.min(count, entries.length) },
    (_, index) => entries[(offset + index) % entries.length]!.id,
  );
}

function generatedPlan(answers: QuestionnaireAnswers): TrainingPlanContract {
  const uncertainties: Array<{ code: string; messageKey: string }> = [];
  const daysPerWeek = answers.generatedTrainingDaysPerWeek ?? 2;
  const requestedSessionMinutes = answers.generatedTrainingSessionMinutes ?? 30;
  const catalogSessionCeiling = Math.min(requestedSessionMinutes, 60);
  const styles = answers.generatedTrainingStyles?.length
    ? answers.generatedTrainingStyles
    : ["bodyweight"];
  const styleResolution = resolveStylePreferences(
    styles,
    answers.primaryObjective,
    answers.secondaryObjectives,
  );
  const equipment = answers.generatedTrainingEquipment?.length
    ? answers.generatedTrainingEquipment
    : ["none"];
  const level = answers.generatedTrainingExperience ?? "unknown";
  const effectiveLevel = level === "unknown" ? "beginner" : level;
  const primaryObjective = answers.primaryObjective;
  const selectedDoseMode = doseMode(styleResolution.matchingStyles, primaryObjective);
  const limitationAnalysis = analyzeMovementLimitations(answers.trainingLimitations);
  if (answers.trainingLimitationsStatus === "declared") {
    if (limitationAnalysis.detailsMissing) {
      throw new Error("training_limitation_details_missing");
    }
    if (limitationAnalysis.unmapped.length > 0) {
      throw new Error("training_limitation_unmapped");
    }
  }
  const excludedAreas: ReadonlySet<string> =
    answers.trainingLimitationsStatus === "declared"
      ? limitationAnalysis.areas
      : new Set<string>();
  if (answers.generatedTrainingDaysPerWeek === undefined) {
    uncertainties.push({
      code: "TRAINING_DAYS_MISSING",
      messageKey: "training.uncertainty.days_missing",
    });
  }
  if (answers.generatedTrainingSessionMinutes === undefined) {
    uncertainties.push({
      code: "TRAINING_DURATION_MISSING",
      messageKey: "training.uncertainty.duration_missing",
    });
  } else if (requestedSessionMinutes > 60) {
    uncertainties.push({
      code: "TRAINING_DURATION_CATALOG_LIMITED",
      messageKey: "training.uncertainty.duration_catalog_limited",
    });
  }
  if (!answers.generatedTrainingStyles?.length) {
    uncertainties.push({
      code: "TRAINING_STYLE_MISSING",
      messageKey: "training.uncertainty.style_missing",
    });
  }
  if (styleResolution.unmodeled) {
    uncertainties.push({
      code: "TRAINING_STYLE_OTHER_UNMODELED",
      messageKey: "training.uncertainty.style_other_unmodeled",
    });
  }
  if (!answers.generatedTrainingEquipment?.length) {
    uncertainties.push({
      code: "TRAINING_EQUIPMENT_MISSING",
      messageKey: "training.uncertainty.equipment_missing",
    });
  }
  if (level === "unknown") {
    uncertainties.push({
      code: "TRAINING_LEVEL_MISSING",
      messageKey: "training.uncertainty.level_missing",
    });
  }
  if (answers.trainingLimitationsStatus === "declared") {
    uncertainties.push({
      code: "TRAINING_LIMITATION_REVIEW_REQUIRED",
      messageKey: "training.uncertainty.limitation_review_required",
    });
  } else if (answers.trainingLimitationsStatus === "unknown") {
    uncertainties.push({
      code: "TRAINING_LIMITATIONS_UNKNOWN",
      messageKey: "training.uncertainty.limitations_unknown",
    });
  } else if (answers.trainingLimitationsStatus === undefined) {
    uncertainties.push({
      code: "TRAINING_LIMITATIONS_MISSING",
      messageKey: "training.uncertainty.limitations_missing",
    });
  }
  appendClinicalReviewUncertainties(answers, uncertainties);

  const availableCatalog = EXERCISE_CATALOG.filter(
    (entry) =>
      !conflictsWithMovementLimitations(entry, excludedAreas) &&
      entry.levels.includes(effectiveLevel) &&
      entry.equipment.some((item) => equipment.includes(item)),
  );
  const structure =
    catalogSessionCeiling <= 15
      ? { cooldown: 1, main: 2, warmup: 1 }
      : catalogSessionCeiling <= 30
        ? { cooldown: 1, main: 3, warmup: 1 }
        : { cooldown: 2, main: 4, warmup: 2 };
  const preferFunctionalAlternatives = (
    entries: readonly (typeof EXERCISE_CATALOG)[number][],
    phase: TrainingPhase,
  ) => {
    const functional = entries.filter(
      (entry) =>
        alternativeNames(
          entry.id,
          phase,
          excludedAreas,
          equipment,
          effectiveLevel,
          styleResolution.matchingStyles,
          styleResolution.matchAny,
        ).length > 0,
    );
    return functional.length > 0 ? functional : entries;
  };
  const mainCandidates = availableCatalog
    .filter(
      (entry) =>
        entry.phases.includes("main") &&
        (styleResolution.matchAny ||
          entry.styles.some((style) => styleResolution.matchingStyles.includes(style))),
    )
    .sort(candidateOrder(effectiveLevel, equipment));
  if (mainCandidates.length === 0) {
    throw new Error("training_catalog_coverage_insufficient");
  }
  const warmupCandidates = availableCatalog
    .filter((entry) => entry.phases.includes("warmup"))
    .sort(candidateOrder(effectiveLevel, equipment));
  const cooldownCandidates = availableCatalog
    .filter((entry) => entry.phases.includes("cooldown"))
    .sort(candidateOrder(effectiveLevel, equipment));
  if (warmupCandidates.length === 0 || cooldownCandidates.length === 0) {
    throw new Error("training_catalog_coverage_insufficient");
  }
  const mainPool = preferFunctionalAlternatives(mainCandidates, "main");
  const warmupPool = preferFunctionalAlternatives(warmupCandidates, "warmup");
  const cooldownPool = preferFunctionalAlternatives(cooldownCandidates, "cooldown");
  const maximumMainSets = catalogSessionCeiling <= 15 ? 1 : 10;
  const weeks = WEEK_PROGRESSION.map((progression, weekIndex) => ({
    sessions: Array.from({ length: daysPerWeek }, (_, dayIndex) => {
      const recoveryRole: RecoveryRole =
        daysPerWeek > 4 && dayIndex % 2 === 1 ? "reduced_load" : "standard";
      const mainIds = rotatedIds(mainPool, structure.main, dayIndex);
      const warmupIds = rotatedIds(warmupPool, structure.warmup, dayIndex);
      const cooldownIds = rotatedIds(cooldownPool, structure.cooldown, dayIndex);
      const fitted = fitSessionToAvailability(
        {
          cooldown: cooldownIds.map((id) =>
            prescription(
              id,
              weekIndex,
              "cooldown",
              excludedAreas,
              level,
              equipment,
              styleResolution.matchingStyles,
              styleResolution.matchAny,
              selectedDoseMode,
              recoveryRole,
              maximumMainSets,
            ),
          ),
          main: mainIds.map((id) =>
            prescription(
              id,
              weekIndex,
              "main",
              excludedAreas,
              level,
              equipment,
              styleResolution.matchingStyles,
              styleResolution.matchAny,
              selectedDoseMode,
              recoveryRole,
              maximumMainSets,
            ),
          ),
          warmup: warmupIds.map((id) =>
            prescription(
              id,
              weekIndex,
              "warmup",
              excludedAreas,
              level,
              equipment,
              styleResolution.matchingStyles,
              styleResolution.matchAny,
              selectedDoseMode,
              recoveryRole,
              maximumMainSets,
            ),
          ),
        },
        catalogSessionCeiling,
      );
      return {
        ...fitted,
        day: dayIndex + 1,
        focus: trainingFocus(
          styleResolution.matchingStyles,
          primaryObjective,
          recoveryRole,
        ),
        id: `week-${weekIndex + 1}-session-${dayIndex + 1}`,
        progression:
          recoveryRole === "reduced_load"
            ? `${progression.progression} Hoy reduce la carga para favorecer la recuperación.`
            : progression.progression,
        recoveryRole,
        week: weekIndex + 1,
      };
    }),
    week: weekIndex + 1,
  }));
  const sessionMinutes = Math.max(
    ...weeks.flatMap(({ sessions }) =>
      sessions.map(({ durationMinutes }) => durationMinutes),
    ),
  );
  if (
    weeks
      .flatMap(({ sessions }) => sessions)
      .flatMap(({ cooldown, main, warmup }) => [...warmup, ...main, ...cooldown])
      .some(({ alternatives }) => alternatives.length === 0)
  ) {
    uncertainties.push({
      code: "TRAINING_ALTERNATIVE_COVERAGE_PARTIAL",
      messageKey: "training.uncertainty.alternative_coverage_partial",
    });
  }

  return {
    availability: {
      daysPerWeek,
      durationBasis: "dose_estimate_v1",
      equipment,
      level,
      otherStyle: answers.generatedTrainingOtherStyle ?? null,
      primaryObjective: primaryObjective ?? null,
      requestedSessionMinutes,
      sessionMinutes,
      styles,
    },
    completeness: uncertainties.length === 0 ? "complete" : "provisional",
    mode: "generated",
    routineGenerated: true,
    uncertainties,
    weeks,
  };
}

export function generateTrainingPlan(
  answers: QuestionnaireAnswers,
): TrainingPlanContract {
  if (answers.trainingMode === "generated") return generatedPlan(answers);
  if (answers.trainingMode === "own") {
    const uncertainties: Array<{ code: string; messageKey: string }> = [];
    const anchors = (answers.ownTrainingAnchors ?? []).filter((anchor) =>
      OWN_TRAINING_ANCHORS.has(anchor),
    );
    if (
      answers.ownTrainingDaysPerWeek === undefined ||
      answers.ownTrainingIntensity === undefined ||
      answers.ownTrainingSessionMinutes === undefined ||
      !answers.ownTrainingTypes?.length
    ) {
      uncertainties.push({
        code: "OWN_TRAINING_CONTEXT_INCOMPLETE",
        messageKey: "training.uncertainty.own_context_incomplete",
      });
    }
    if (anchors.length === 0) {
      uncertainties.push({
        code: "OWN_TRAINING_ANCHORS_MISSING",
        messageKey: "training.uncertainty.own_training_anchors_missing",
      });
    }
    if (answers.trainingLimitationsStatus === "declared") {
      const analysis = analyzeMovementLimitations(answers.trainingLimitations);
      if (analysis.detailsMissing) {
        uncertainties.push({
          code: "TRAINING_LIMITATION_DETAILS_MISSING",
          messageKey: "training.uncertainty.training_limitation_details_missing",
        });
      } else if (analysis.unmapped.length > 0) {
        uncertainties.push({
          code: "TRAINING_LIMITATION_UNMAPPED",
          messageKey: "training.uncertainty.training_limitation_unmapped",
        });
      } else {
        uncertainties.push({
          code: "TRAINING_LIMITATION_REVIEW_REQUIRED",
          messageKey: "training.uncertainty.limitation_review_required",
        });
      }
    } else if (answers.trainingLimitationsStatus === "unknown") {
      uncertainties.push({
        code: "TRAINING_LIMITATIONS_UNKNOWN",
        messageKey: "training.uncertainty.limitations_unknown",
      });
    } else if (answers.trainingLimitationsStatus === undefined) {
      uncertainties.push({
        code: "TRAINING_LIMITATIONS_MISSING",
        messageKey: "training.uncertainty.limitations_missing",
      });
    }
    appendClinicalReviewUncertainties(answers, uncertainties);
    const days = answers.ownTrainingDaysPerWeek;
    const minutes = answers.ownTrainingSessionMinutes;
    const intensity = answers.ownTrainingIntensity;
    const weeklyMinutes =
      days !== undefined && minutes !== undefined ? days * minutes : null;
    const loadDescription =
      weeklyMinutes === null || intensity === undefined
        ? "la carga semanal pendiente de confirmar"
        : `${weeklyMinutes} minutos semanales a intensidad ${intensity}`;
    const anchorDescription = anchors.length
      ? `los anclajes ${anchors.join(", ")}`
      : "un horario todavía pendiente";
    return {
      adaptations: {
        hydration: `Se conserva ${loadDescription} y ${anchorDescription} como contexto. T11 no genera una pauta de hidratación; se resolverá en T12.`,
        mobility: `Se conserva ${anchorDescription} para coordinar una futura revisión, sin sustituir ni modificar tus sesiones propias.`,
        nutrition: `El centro energético considera de forma acotada ${loadDescription} dentro de tu banda de actividad. Los anclajes del entrenamiento quedan registrados, pero no reorganizan las comidas en T11.`,
        sleep: `Se conserva ${loadDescription} como contexto. T11 no genera una pauta de descanso; se resolverá en T12.`,
      },
      completeness: uncertainties.length === 0 ? "complete" : "provisional",
      mode: "own",
      routineGenerated: false,
      sessions: [],
      uncertainties,
      weeklyContext: {
        anchors,
        daysPerWeek: answers.ownTrainingDaysPerWeek ?? null,
        intensity: answers.ownTrainingIntensity ?? null,
        sessionMinutes: answers.ownTrainingSessionMinutes ?? null,
        types: answers.ownTrainingTypes ?? [],
      },
    };
  }
  return {
    mode: "none",
    reason: "training_disabled_by_user",
    routineGenerated: false,
    sessions: [],
  };
}
