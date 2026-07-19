import { describe, expect, it } from "vitest";

import {
  TrainingPlanSchema,
  type ContextSnapshotInternal,
} from "@health-design/contracts";
import { EXERCISE_BY_ID } from "@health-design/domain";
import { generateTrainingPlan, runDeterministicEngine } from "@health-design/engine";

const hash = (pair: string) => pair.repeat(32);

function conflictsWithArea(exerciseId: string, excludedAreas: readonly string[]) {
  const exercise = EXERCISE_BY_ID.get(exerciseId);
  if (!exercise) throw new Error(`exercise_missing_${exerciseId}`);
  return [...exercise.areas, ...exercise.limitationAreas].some((area) =>
    excludedAreas.includes(area),
  );
}

function isExecutableAlternative(sourceId: string, alternativeId: string) {
  const source = EXERCISE_BY_ID.get(sourceId);
  const alternative = EXERCISE_BY_ID.get(alternativeId);
  if (!source || !alternative) return false;
  return (
    source.areas.some((area) => alternative.areas.includes(area)) &&
    (source.defaultDurationSeconds !== undefined) ===
      (alternative.defaultDurationSeconds !== undefined)
  );
}

function context(answers: ContextSnapshotInternal["answers"]): ContextSnapshotInternal {
  return {
    answers,
    canonicalizationVersion: "canonical-json-v1",
    completeness: "complete",
    createdAt: "2026-07-19T12:00:00.000Z",
    effectiveAt: "2026-07-19T12:00:00.000Z",
    id: "50000000-0000-4000-8000-000000000111",
    inputHash: hash("11"),
    normalizationVersion: "normalization-v1",
    profileId: "10000000-0000-4000-8000-000000000111",
    schemaVersion: 2,
    sourceDraftId: "40000000-0000-4000-8000-000000000111",
    sourceDraftVersion: 1,
  };
}

describe("motor de entrenamiento T11", () => {
  it("genera un bloque ejecutable de cuatro semanas dentro de la disponibilidad", () => {
    const plan = TrainingPlanSchema.parse(
      generateTrainingPlan({
        activeModules: ["training", "mobility"],
        generatedTrainingDaysPerWeek: 3,
        generatedTrainingEquipment: ["none"],
        generatedTrainingExperience: "beginner",
        generatedTrainingSessionMinutes: 40,
        generatedTrainingStyles: ["bodyweight"],
        hasConditions: false,
        hasMedications: false,
        trainingLimitationsStatus: "none",
        trainingMode: "generated",
      }),
    );

    expect(plan.mode).toBe("generated");
    if (plan.mode !== "generated") throw new Error("generated_plan_expected");
    expect(plan.weeks).toHaveLength(4);
    expect(plan.weeks.every(({ sessions }) => sessions.length === 3)).toBe(true);
    expect(
      plan.weeks
        .flatMap(({ sessions }) => sessions)
        .every(
          ({ cooldown, durationMinutes, main, warmup }) =>
            durationMinutes <= 40 &&
            warmup.length > 0 &&
            main.length > 0 &&
            cooldown.length > 0,
        ),
    ).toBe(true);
    expect(
      plan.weeks
        .flatMap(({ sessions }) => sessions)
        .flatMap(({ cooldown, main, warmup }) => [...warmup, ...main, ...cooldown])
        .every(
          ({
            alternatives,
            exerciseId,
            progression,
            steps,
            technique,
            tempo,
            visual,
          }) =>
            alternatives.every(({ exerciseId: alternativeId }) =>
              isExecutableAlternative(exerciseId, alternativeId),
            ) &&
            progression.length > 0 &&
            steps.length >= 2 &&
            technique.length > 0 &&
            tempo.length > 0 &&
            visual.alt.length > 0 &&
            visual.src.startsWith("/assets/exercises/"),
        ),
    ).toBe(true);
    expect(plan.weeks[2]!.sessions[0]!.main[0]!.sets).toBeGreaterThanOrEqual(
      plan.weeks[0]!.sessions[0]!.main[0]!.sets,
    );
  });

  it("evita patrones incompatibles con una limitación declarada y mantiene provisionalidad", () => {
    const plan = TrainingPlanSchema.parse(
      generateTrainingPlan({
        activeModules: ["training"],
        generatedTrainingDaysPerWeek: 2,
        generatedTrainingEquipment: ["none"],
        generatedTrainingExperience: "intermediate",
        generatedTrainingSessionMinutes: 30,
        generatedTrainingStyles: ["bodyweight"],
        hasConditions: false,
        hasMedications: false,
        trainingLimitations: ["dolor de rodilla"],
        trainingLimitationsStatus: "declared",
        trainingMode: "generated",
      }),
    );

    expect(plan.mode).toBe("generated");
    if (plan.mode !== "generated") throw new Error("generated_plan_expected");
    expect(plan.completeness).toBe("provisional");
    expect(plan.uncertainties).toContainEqual({
      code: "TRAINING_LIMITATION_REVIEW_REQUIRED",
      messageKey: "training.uncertainty.limitation_review_required",
    });
    expect(
      plan.weeks
        .flatMap(({ sessions }) => sessions)
        .flatMap(({ cooldown, main, warmup }) => [...warmup, ...main, ...cooldown])
        .every(
          ({ alternatives, exerciseId }) =>
            !conflictsWithArea(exerciseId, ["knees"]) &&
            alternatives.every(
              ({ exerciseId: alternativeId }) =>
                !conflictsWithArea(alternativeId, ["knees"]),
            ),
        ),
    ).toBe(true);
  });

  it.each([
    {
      days: 2,
      details: "dolor de cadera",
      excludedAreas: ["hips"],
      label: "cadera",
    },
    {
      days: 2,
      details: "dolor de rodilla",
      excludedAreas: ["knees"],
      label: "rodilla",
    },
    {
      days: 7,
      details: "dolor de hombro",
      excludedAreas: ["shoulders"],
      label: "hombro",
    },
  ] as const)(
    "excluye áreas funcionales y alternativas relacionadas con $label",
    ({ days, details, excludedAreas }) => {
      const plan = generateTrainingPlan({
        activeModules: ["training"],
        generatedTrainingDaysPerWeek: days,
        generatedTrainingEquipment: ["none"],
        generatedTrainingExperience: "beginner",
        generatedTrainingSessionMinutes: 30,
        generatedTrainingStyles: ["bodyweight"],
        hasConditions: false,
        hasMedications: false,
        trainingLimitations: [details],
        trainingLimitationsStatus: "declared",
        trainingMode: "generated",
      });
      if (plan.mode !== "generated") throw new Error("generated_plan_expected");

      const prescriptions = plan.weeks
        .flatMap(({ sessions }) => sessions)
        .flatMap(({ cooldown, main, warmup }) => [...warmup, ...main, ...cooldown]);
      expect(prescriptions.length).toBeGreaterThan(0);
      expect(
        prescriptions.every(
          ({ alternatives, exerciseId }) =>
            !conflictsWithArea(exerciseId, excludedAreas) &&
            alternatives.every(
              ({ exerciseId: alternativeId }) =>
                !conflictsWithArea(alternativeId, excludedAreas),
            ),
        ),
      ).toBe(true);
    },
  );

  it.each([
    {
      details: [] as string[],
      expectedError: "training_limitation_details_missing",
    },
    {
      details: ["molestia sin zona identificable"],
      expectedError: "training_limitation_unmapped",
    },
  ])(
    "no prescribe una rutina estándar si la limitación declarada no es utilizable: $expectedError",
    ({ details, expectedError }) => {
      expect(() =>
        generateTrainingPlan({
          activeModules: ["training"],
          generatedTrainingDaysPerWeek: 2,
          generatedTrainingEquipment: ["none"],
          generatedTrainingExperience: "beginner",
          generatedTrainingSessionMinutes: 30,
          generatedTrainingStyles: ["bodyweight"],
          hasConditions: false,
          hasMedications: false,
          trainingLimitations: details,
          trainingLimitationsStatus: "declared",
          trainingMode: "generated",
        }),
      ).toThrow(expectedError);
    },
  );

  it("mapea ligamento cruzado y LCA a rodilla antes de seleccionar ejercicios", () => {
    const plan = generateTrainingPlan({
      activeModules: ["training"],
      generatedTrainingDaysPerWeek: 2,
      generatedTrainingEquipment: ["none"],
      generatedTrainingExperience: "intermediate",
      generatedTrainingSessionMinutes: 30,
      generatedTrainingStyles: ["bodyweight"],
      hasConditions: false,
      hasMedications: false,
      trainingLimitations: ["lesión de ligamento cruzado anterior (LCA)"],
      trainingLimitationsStatus: "declared",
      trainingMode: "generated",
    });
    if (plan.mode !== "generated") throw new Error("generated_plan_expected");

    expect(
      plan.weeks
        .flatMap(({ sessions }) => sessions)
        .flatMap(({ cooldown, main, warmup }) => [...warmup, ...main, ...cooldown])
        .every(
          ({ alternatives, exerciseId }) =>
            !conflictsWithArea(exerciseId, ["knees"]) &&
            alternatives.every(
              ({ exerciseId: alternativeId }) =>
                !conflictsWithArea(alternativeId, ["knees"]),
            ),
        ),
    ).toBe(true);
  });

  it("trata el codo como carga de miembro superior sin fingir una zona de catálogo", () => {
    const plan = generateTrainingPlan({
      activeModules: ["training"],
      generatedTrainingDaysPerWeek: 2,
      generatedTrainingEquipment: ["none"],
      generatedTrainingExperience: "beginner",
      generatedTrainingSessionMinutes: 30,
      generatedTrainingStyles: ["bodyweight"],
      hasConditions: false,
      hasMedications: false,
      trainingLimitations: ["dolor de codo"],
      trainingLimitationsStatus: "declared",
      trainingMode: "generated",
    });
    if (plan.mode !== "generated") throw new Error("generated_plan_expected");

    expect(
      plan.weeks
        .flatMap(({ sessions }) => sessions)
        .flatMap(({ cooldown, main, warmup }) => [...warmup, ...main, ...cooldown])
        .every(({ exerciseId }) => {
          return !conflictsWithArea(exerciseId, ["shoulders", "wrists"]);
        }),
    ).toBe(true);
  });

  it("solo conserva alternativas compatibles sin devolver una sesión inválida", () => {
    const plan = TrainingPlanSchema.parse(
      generateTrainingPlan({
        activeModules: ["training"],
        generatedTrainingDaysPerWeek: 2,
        generatedTrainingEquipment: ["none"],
        generatedTrainingExperience: "intermediate",
        generatedTrainingSessionMinutes: 40,
        generatedTrainingStyles: ["bodyweight"],
        hasConditions: false,
        hasMedications: false,
        trainingLimitations: ["dolor de espalda"],
        trainingLimitationsStatus: "declared",
        trainingMode: "generated",
      }),
    );

    expect(plan.mode).toBe("generated");
    if (plan.mode !== "generated") throw new Error("generated_plan_expected");
    expect(
      plan.weeks
        .flatMap(({ sessions }) => sessions)
        .flatMap(({ cooldown, main, warmup }) => [...warmup, ...main, ...cooldown])
        .every(({ alternatives, exerciseId }) =>
          alternatives.every(({ exerciseId: alternativeId }) =>
            isExecutableAlternative(exerciseId, alternativeId),
          ),
        ),
    ).toBe(true);
  });

  it("nunca devuelve un payload inválido al combinar limitaciones declaradas", () => {
    const areas = [
      "tobillo",
      "espalda",
      "cadera",
      "rodilla",
      "cuello",
      "hombro",
      "muñeca",
    ];
    for (let mask = 1; mask < 2 ** areas.length; mask += 1) {
      let candidate: unknown;
      try {
        candidate = generateTrainingPlan({
          activeModules: ["training"],
          generatedTrainingDaysPerWeek: 2,
          generatedTrainingEquipment: ["none"],
          generatedTrainingExperience: "beginner",
          generatedTrainingSessionMinutes: 40,
          generatedTrainingStyles: ["bodyweight"],
          hasConditions: false,
          hasMedications: false,
          trainingLimitations: areas.filter((_, index) => mask & (1 << index)),
          trainingLimitationsStatus: "declared",
          trainingMode: "generated",
        });
      } catch {
        continue;
      }
      expect(TrainingPlanSchema.safeParse(candidate).success).toBe(true);
    }
  });

  it("convierte una cobertura agotada en fallback provisional explícito", async () => {
    const result = await runDeterministicEngine({
      baseContext: null,
      baseModuleResults: null,
      change: null,
      context: context({
        activeModules: ["training"],
        generatedTrainingDaysPerWeek: 2,
        generatedTrainingEquipment: ["none"],
        generatedTrainingExperience: "beginner",
        generatedTrainingSessionMinutes: 40,
        generatedTrainingStyles: ["bodyweight"],
        hasConditions: false,
        hasMedications: false,
        trainingLimitations: [
          "tobillo",
          "espalda",
          "cadera",
          "rodilla",
          "cuello",
          "hombro",
          "muñeca",
        ],
        trainingLimitationsStatus: "declared",
        trainingMode: "generated",
      }),
    });

    expect(
      result.moduleResults.find(({ module }) => module === "training"),
    ).toMatchObject({
      confidence: "unknown",
      payload: { requested: true, stage: "training_engine" },
      status: "provisional",
      uncertainties: [
        {
          code: "TRAINING_CATALOG_COVERAGE_INSUFFICIENT",
          messageKey: "training.uncertainty.catalog_coverage_insufficient",
          module: "training",
        },
      ],
    });
  });

  it.each([
    {
      details: [] as string[],
      expectedCode: "TRAINING_LIMITATION_DETAILS_MISSING",
    },
    {
      details: ["limitación no reconocible"],
      expectedCode: "TRAINING_LIMITATION_UNMAPPED",
    },
  ])(
    "convierte datos de limitación inseguros en fallback provisional: $expectedCode",
    async ({ details, expectedCode }) => {
      const result = await runDeterministicEngine({
        baseContext: null,
        baseModuleResults: null,
        change: null,
        context: context({
          activeModules: ["training"],
          generatedTrainingDaysPerWeek: 2,
          generatedTrainingEquipment: ["none"],
          generatedTrainingExperience: "beginner",
          generatedTrainingSessionMinutes: 30,
          generatedTrainingStyles: ["bodyweight"],
          hasConditions: false,
          hasMedications: false,
          trainingLimitations: details,
          trainingLimitationsStatus: "declared",
          trainingMode: "generated",
        }),
      });

      expect(
        result.moduleResults.find(({ module }) => module === "training"),
      ).toMatchObject({
        confidence: "unknown",
        payload: { requested: true, stage: "training_engine" },
        status: "provisional",
        uncertainties: [
          {
            code: expectedCode,
            messageKey: `training.uncertainty.${expectedCode.toLowerCase()}`,
            module: "training",
          },
        ],
      });
    },
  );

  it("rechaza incoherencias entre disponibilidad, sesiones y provisionalidad", () => {
    const valid = generateTrainingPlan({
      activeModules: ["training"],
      generatedTrainingDaysPerWeek: 2,
      generatedTrainingEquipment: ["none"],
      generatedTrainingExperience: "beginner",
      generatedTrainingSessionMinutes: 30,
      generatedTrainingStyles: ["bodyweight"],
      hasConditions: false,
      hasMedications: false,
      trainingLimitationsStatus: "none",
      trainingMode: "generated",
    });
    if (valid.mode !== "generated") throw new Error("generated_plan_expected");
    const wrongSessions = structuredClone(valid);
    wrongSessions.weeks[0]!.sessions.pop();
    const wrongCompleteness = structuredClone(valid);
    wrongCompleteness.uncertainties.push({
      code: "INJECTED_UNCERTAINTY",
      messageKey: "training.test.injected",
    });
    const wrongDuration = structuredClone(valid);
    wrongDuration.weeks[0]!.sessions[0]!.durationMinutes =
      valid.availability.sessionMinutes + 1;
    const incompleteEffortPair = structuredClone(valid);
    delete incompleteEffortPair.weeks[0]!.sessions[0]!.main[0]!.rir;
    const ambiguousDose = structuredClone(valid);
    const firstExercise = ambiguousDose.weeks[0]!.sessions[0]!.main[0]!;
    firstExercise.durationSeconds ??= 30;
    firstExercise.repetitions ??= "8";

    expect(TrainingPlanSchema.safeParse(wrongSessions).success).toBe(false);
    expect(TrainingPlanSchema.safeParse(wrongCompleteness).success).toBe(false);
    expect(TrainingPlanSchema.safeParse(wrongDuration).success).toBe(false);
    expect(TrainingPlanSchema.safeParse(incompleteEffortPair).success).toBe(false);
    expect(TrainingPlanSchema.safeParse(ambiguousDose).success).toBe(false);
  });

  it("integra la rutina generada como resultado válido del plan determinista", async () => {
    const result = await runDeterministicEngine({
      baseContext: null,
      baseModuleResults: null,
      change: null,
      context: context({
        activeModules: ["training"],
        generatedTrainingDaysPerWeek: 2,
        generatedTrainingEquipment: ["none"],
        generatedTrainingExperience: "beginner",
        generatedTrainingSessionMinutes: 30,
        generatedTrainingStyles: ["bodyweight"],
        hasConditions: false,
        hasMedications: false,
        trainingLimitationsStatus: "none",
        trainingMode: "generated",
      }),
    });

    const training = result.moduleResults.find(({ module }) => module === "training");
    expect(training).toMatchObject({ confidence: "high", status: "valid" });
    expect(TrainingPlanSchema.parse(training?.payload).mode).toBe("generated");
    expect(result.validation).toMatchObject({
      recalculatedModules: [
        "nutrition",
        "training",
        "hydration",
        "sleep",
        "mobility",
        "supplements",
      ],
    });
  });

  it("reduce la estructura de una sesión corta sin eliminar calentamiento ni vuelta a la calma", () => {
    const plan = TrainingPlanSchema.parse(
      generateTrainingPlan({
        activeModules: ["training"],
        generatedTrainingDaysPerWeek: 1,
        generatedTrainingEquipment: ["none"],
        generatedTrainingExperience: "beginner",
        generatedTrainingSessionMinutes: 10,
        generatedTrainingStyles: ["bodyweight"],
        hasConditions: false,
        hasMedications: false,
        trainingLimitationsStatus: "none",
        trainingMode: "generated",
      }),
    );
    if (plan.mode !== "generated") throw new Error("generated_plan_expected");
    const session = plan.weeks[0]!.sessions[0]!;
    expect(session.warmup).toHaveLength(1);
    expect(session.main).toHaveLength(2);
    expect(session.cooldown).toHaveLength(1);
  });

  it("limita una disponibilidad extrema a un bloque conservador y lo explica", () => {
    const plan = TrainingPlanSchema.parse(
      generateTrainingPlan({
        activeModules: ["training"],
        generatedTrainingDaysPerWeek: 2,
        generatedTrainingEquipment: ["none"],
        generatedTrainingExperience: "advanced",
        generatedTrainingSessionMinutes: 240,
        generatedTrainingStyles: ["strength"],
        hasConditions: false,
        hasMedications: false,
        trainingLimitationsStatus: "none",
        trainingMode: "generated",
      }),
    );
    if (plan.mode !== "generated") throw new Error("generated_plan_expected");

    expect(plan.availability).toMatchObject({
      durationBasis: "dose_estimate_v1",
      requestedSessionMinutes: 240,
    });
    expect(plan.availability.sessionMinutes).toBeLessThanOrEqual(60);
    expect(plan.availability.sessionMinutes).toBeGreaterThan(0);
    expect(
      plan.weeks
        .flatMap(({ sessions }) => sessions)
        .every(
          ({ durationMinutes }) => durationMinutes <= plan.availability.sessionMinutes,
        ),
    ).toBe(true);
    expect(plan.uncertainties).toContainEqual({
      code: "TRAINING_DURATION_CATALOG_LIMITED",
      messageKey: "training.uncertainty.duration_catalog_limited",
    });
  });

  it("ajusta la dosis al nivel declarado sin cambiar la disponibilidad", () => {
    const common = {
      activeModules: ["training"],
      generatedTrainingDaysPerWeek: 2,
      generatedTrainingEquipment: ["none"],
      generatedTrainingSessionMinutes: 30,
      generatedTrainingStyles: ["bodyweight"],
      hasConditions: false,
      hasMedications: false,
      trainingLimitationsStatus: "none",
      trainingMode: "generated",
    } satisfies ContextSnapshotInternal["answers"];
    const beginner = TrainingPlanSchema.parse(
      generateTrainingPlan({ ...common, generatedTrainingExperience: "beginner" }),
    );
    const advanced = TrainingPlanSchema.parse(
      generateTrainingPlan({ ...common, generatedTrainingExperience: "advanced" }),
    );
    if (beginner.mode !== "generated" || advanced.mode !== "generated") {
      throw new Error("generated_plan_expected");
    }

    expect(advanced.weeks[0]!.sessions[0]!.main[0]!.sets).toBeGreaterThan(
      beginner.weeks[0]!.sessions[0]!.main[0]!.sets,
    );
    expect(advanced.weeks[0]!.sessions[0]!.main[0]!.rpe).toBeGreaterThan(
      beginner.weeks[0]!.sessions[0]!.main[0]!.rpe!,
    );
    expect(advanced.availability.daysPerWeek).toBe(beginner.availability.daysPerWeek);
    expect(advanced.availability.requestedSessionMinutes).toBe(
      beginner.availability.requestedSessionMinutes,
    );
    expect(advanced.availability.sessionMinutes).toBeGreaterThanOrEqual(
      beginner.availability.sessionMinutes,
    );
  });

  it("prioriza el material declarado sin introducirlo cuando no está disponible", () => {
    const common = {
      activeModules: ["training"],
      generatedTrainingDaysPerWeek: 2,
      generatedTrainingExperience: "intermediate",
      generatedTrainingSessionMinutes: 35,
      generatedTrainingStyles: ["strength"],
      hasConditions: false,
      hasMedications: false,
      trainingLimitationsStatus: "none",
      trainingMode: "generated",
    } as const satisfies ContextSnapshotInternal["answers"];
    const withoutEquipment = generateTrainingPlan({
      ...common,
      generatedTrainingEquipment: ["none"],
    });
    const withEquipment = generateTrainingPlan({
      ...common,
      generatedTrainingEquipment: ["home_basic"],
    });
    if (withoutEquipment.mode !== "generated" || withEquipment.mode !== "generated") {
      throw new Error("generated_plan_expected");
    }
    const weighted = new Set([
      "dumbbell-floor-press",
      "dumbbell-goblet-squat",
      "dumbbell-row",
      "resistance-band-row",
    ]);
    const withoutIds = withoutEquipment.weeks.flatMap(({ sessions }) =>
      sessions.flatMap(({ main }) => main.map(({ exerciseId }) => exerciseId)),
    );
    const withIds = withEquipment.weeks.flatMap(({ sessions }) =>
      sessions.flatMap(({ main }) => main.map(({ exerciseId }) => exerciseId)),
    );

    expect(withoutIds.some((id) => weighted.has(id))).toBe(false);
    expect(withIds.some((id) => weighted.has(id))).toBe(true);
  });

  it("rota ejercicios y alterna carga reducida cuando se solicitan seis días", () => {
    const plan = generateTrainingPlan({
      activeModules: ["training"],
      generatedTrainingDaysPerWeek: 6,
      generatedTrainingEquipment: ["none"],
      generatedTrainingExperience: "intermediate",
      generatedTrainingSessionMinutes: 35,
      generatedTrainingStyles: ["bodyweight"],
      hasConditions: false,
      hasMedications: false,
      trainingLimitationsStatus: "none",
      trainingMode: "generated",
    });
    if (plan.mode !== "generated") throw new Error("generated_plan_expected");
    const firstWeek = plan.weeks[0]!.sessions;

    expect(firstWeek[0]!.main.map(({ exerciseId }) => exerciseId)).not.toEqual(
      firstWeek[1]!.main.map(({ exerciseId }) => exerciseId),
    );
    expect(firstWeek.map(({ recoveryRole }) => recoveryRole)).toEqual([
      "standard",
      "reduced_load",
      "standard",
      "reduced_load",
      "standard",
      "reduced_load",
    ]);
    expect(firstWeek[1]!.main[0]!.sets).toBeLessThanOrEqual(
      firstWeek[0]!.main[0]!.sets,
    );
  });

  it("traduce un objetivo compatible a foco y dosis sin reemplazar el estilo", () => {
    const plan = generateTrainingPlan({
      activeModules: ["training"],
      generatedTrainingDaysPerWeek: 2,
      generatedTrainingEquipment: ["none"],
      generatedTrainingExperience: "beginner",
      generatedTrainingSessionMinutes: 30,
      generatedTrainingStyles: ["bodyweight"],
      hasConditions: false,
      hasMedications: false,
      primaryObjective: "performance_strength",
      trainingLimitationsStatus: "none",
      trainingMode: "generated",
    });
    if (plan.mode !== "generated") throw new Error("generated_plan_expected");

    expect(plan.availability.primaryObjective).toBe("performance_strength");
    expect(plan.weeks[0]!.sessions[0]!.focus).toContain("apoyo a fuerza");
    expect(plan.weeks[0]!.sessions[0]!.main[0]).toMatchObject({
      repetitions: "5-8",
      restSeconds: 90,
    });
    expect(
      plan.weeks[0]!.sessions[0]!.main.every(({ exerciseId }) =>
        EXERCISE_BY_ID.get(exerciseId)?.styles.includes("bodyweight"),
      ),
    ).toBe(true);
  });

  it.each([
    {
      primaryObjective: "performance_strength",
      secondaryObjectives: [],
    },
    {
      primaryObjective: "wellbeing_sleep",
      secondaryObjectives: ["performance_strength"],
    },
  ] as const)(
    "usa el objetivo principal o secundario para concretar una preferencia abierta",
    ({ primaryObjective, secondaryObjectives }) => {
      const plan = generateTrainingPlan({
        activeModules: ["training"],
        generatedTrainingDaysPerWeek: 2,
        generatedTrainingEquipment: ["none"],
        generatedTrainingExperience: "beginner",
        generatedTrainingSessionMinutes: 30,
        generatedTrainingStyles: ["no_preference"],
        hasConditions: false,
        hasMedications: false,
        primaryObjective,
        secondaryObjectives: [...secondaryObjectives],
        trainingLimitationsStatus: "none",
        trainingMode: "generated",
      });
      if (plan.mode !== "generated") throw new Error("generated_plan_expected");

      expect(
        plan.weeks
          .flatMap(({ sessions }) => sessions)
          .flatMap(({ main }) => main)
          .every(({ exerciseId }) =>
            EXERCISE_BY_ID.get(exerciseId)?.styles.includes("strength"),
          ),
      ).toBe(true);
    },
  );

  it("convierte el estilo funcional en intervalos ejecutables", () => {
    const plan = generateTrainingPlan({
      activeModules: ["training"],
      generatedTrainingDaysPerWeek: 2,
      generatedTrainingEquipment: ["none"],
      generatedTrainingExperience: "beginner",
      generatedTrainingSessionMinutes: 20,
      generatedTrainingStyles: ["functional_hiit"],
      hasConditions: false,
      hasMedications: false,
      trainingLimitationsStatus: "none",
      trainingMode: "generated",
    });
    if (plan.mode !== "generated") throw new Error("generated_plan_expected");

    expect(
      plan.weeks
        .flatMap(({ sessions }) => sessions)
        .flatMap(({ main }) => main)
        .every(
          ({ durationSeconds, repetitions, restSeconds }) =>
            durationSeconds !== undefined &&
            repetitions === undefined &&
            restSeconds === 30,
        ),
    ).toBe(true);
  });

  it.each(["pilates", "yoga"] as const)(
    "mantiene la modalidad %s en todos los ejercicios principales",
    (style) => {
      const plan = TrainingPlanSchema.parse(
        generateTrainingPlan({
          activeModules: ["training"],
          generatedTrainingDaysPerWeek: 2,
          generatedTrainingEquipment: ["none"],
          generatedTrainingExperience: "beginner",
          generatedTrainingSessionMinutes: 30,
          generatedTrainingStyles: [style],
          hasConditions: false,
          hasMedications: false,
          trainingLimitationsStatus: "none",
          trainingMode: "generated",
        }),
      );
      if (plan.mode !== "generated") throw new Error("generated_plan_expected");

      expect(
        plan.weeks
          .flatMap(({ sessions }) => sessions)
          .flatMap(({ main }) => main)
          .every(({ exerciseId }) =>
            EXERCISE_BY_ID.get(exerciseId)?.styles.includes(style),
          ),
      ).toBe(true);
    },
  );

  it("cubre la matriz de modalidad, equipamiento, nivel y duración sin salir del contrato", () => {
    const styles = [
      "bodyweight",
      "endurance",
      "functional_hiit",
      "hypertrophy",
      "no_preference",
      "other",
      "pilates",
      "sport_preparation",
      "strength",
      "strength_hypertrophy",
      "yoga",
    ];
    const equipment = ["none", "home_basic", "full_gym"];
    const levels = ["beginner", "intermediate", "advanced"] as const;
    const durations = [10, 30, 40];

    for (const style of styles) {
      for (const equipmentItem of equipment) {
        for (const level of levels) {
          for (const duration of durations) {
            let generated: unknown;
            try {
              generated = generateTrainingPlan({
                activeModules: ["training"],
                generatedTrainingDaysPerWeek: 2,
                generatedTrainingEquipment: [equipmentItem],
                generatedTrainingExperience: level,
                generatedTrainingOtherStyle:
                  style === "other" ? "Escalada recreativa" : undefined,
                generatedTrainingSessionMinutes: duration,
                generatedTrainingStyles: [style],
                hasConditions: false,
                hasMedications: false,
                trainingLimitationsStatus: "none",
                trainingMode: "generated",
              });
            } catch (error) {
              throw new Error(
                `matrix_failed:${style}:${equipmentItem}:${level}:${duration}:${String(error)}`,
                { cause: error },
              );
            }
            const plan = TrainingPlanSchema.parse(generated);
            if (plan.mode !== "generated") throw new Error("generated_plan_expected");
            const expectedStyles =
              style === "strength_hypertrophy"
                ? ["strength", "hypertrophy"]
                : style === "other"
                  ? ["bodyweight"]
                  : style === "no_preference"
                    ? []
                    : [style];
            expect(
              plan.weeks
                .flatMap(({ sessions }) => sessions)
                .flatMap(({ main }) => main)
                .every(
                  ({ exerciseId }) =>
                    expectedStyles.length === 0 ||
                    EXERCISE_BY_ID.get(exerciseId)?.styles.some((candidate) =>
                      expectedStyles.includes(candidate),
                    ),
                ),
            ).toBe(true);
          }
        }
      }
    }
  });

  it("mantiene otra modalidad como provisional aunque exista una descripción breve", () => {
    const plan = TrainingPlanSchema.parse(
      generateTrainingPlan({
        activeModules: ["training"],
        generatedTrainingDaysPerWeek: 2,
        generatedTrainingEquipment: ["none"],
        generatedTrainingExperience: "beginner",
        generatedTrainingOtherStyle: "Escalada recreativa",
        generatedTrainingSessionMinutes: 30,
        generatedTrainingStyles: ["other"],
        hasConditions: false,
        hasMedications: false,
        trainingLimitationsStatus: "none",
        trainingMode: "generated",
      }),
    );
    if (plan.mode !== "generated") throw new Error("generated_plan_expected");

    expect(plan.availability.otherStyle).toBe("Escalada recreativa");
    expect(plan.completeness).toBe("provisional");
    expect(plan.uncertainties).toContainEqual({
      code: "TRAINING_STYLE_OTHER_UNMODELED",
      messageKey: "training.uncertainty.style_other_unmodeled",
    });
  });

  it("resume el entrenamiento propio sin prescribir ninguna sesión", () => {
    const plan = TrainingPlanSchema.parse(
      generateTrainingPlan({
        activeModules: ["nutrition", "training", "hydration", "mobility"],
        ownTrainingDaysPerWeek: 4,
        ownTrainingAnchors: ["evening"],
        ownTrainingIntensity: "moderate",
        ownTrainingSessionMinutes: 55,
        ownTrainingTypes: ["strength"],
        hasConditions: false,
        hasMedications: false,
        trainingLimitationsStatus: "none",
        trainingMode: "own",
      }),
    );
    expect(plan).toMatchObject({
      completeness: "complete",
      mode: "own",
      routineGenerated: false,
      sessions: [],
      weeklyContext: { daysPerWeek: 4, sessionMinutes: 55 },
    });
  });

  it("no considera completo un anclaje propio fuera del catálogo", () => {
    const plan = generateTrainingPlan({
      activeModules: ["training"],
      hasConditions: false,
      hasMedications: false,
      ownTrainingAnchors: ["momento no reconocido"],
      ownTrainingDaysPerWeek: 4,
      ownTrainingIntensity: "moderate",
      ownTrainingSessionMinutes: 55,
      ownTrainingTypes: ["strength"],
      trainingLimitationsStatus: "none",
      trainingMode: "own",
    });
    if (plan.mode !== "own") throw new Error("own_plan_expected");

    expect(plan.completeness).toBe("provisional");
    expect(plan.weeklyContext.anchors).toEqual([]);
    expect(plan.uncertainties).toContainEqual(
      expect.objectContaining({ code: "OWN_TRAINING_ANCHORS_MISSING" }),
    );
  });

  it.each([
    {
      expectedCode: "TRAINING_LIMITATION_REVIEW_REQUIRED",
      limitations: ["dolor de rodilla"],
      status: "declared" as const,
    },
    {
      expectedCode: "TRAINING_LIMITATION_DETAILS_MISSING",
      limitations: [] as string[],
      status: "declared" as const,
    },
    {
      expectedCode: "TRAINING_LIMITATION_UNMAPPED",
      limitations: ["limitación no reconocible"],
      status: "declared" as const,
    },
    {
      expectedCode: "TRAINING_LIMITATIONS_UNKNOWN",
      limitations: undefined,
      status: "unknown" as const,
    },
    {
      expectedCode: "TRAINING_LIMITATIONS_MISSING",
      limitations: undefined,
      status: undefined,
    },
  ])(
    "mantiene entrenamiento propio provisional cuando la limitación no es segura: $expectedCode",
    ({ expectedCode, limitations, status }) => {
      const plan = generateTrainingPlan({
        activeModules: ["training"],
        ownTrainingDaysPerWeek: 4,
        ownTrainingIntensity: "moderate",
        ownTrainingSessionMinutes: 55,
        ownTrainingTypes: ["strength"],
        hasConditions: false,
        hasMedications: false,
        trainingLimitations: limitations,
        trainingLimitationsStatus: status,
        trainingMode: "own",
      });

      expect(plan).toMatchObject({
        completeness: "provisional",
        mode: "own",
        routineGenerated: false,
        sessions: [],
      });
      if (plan.mode !== "own") throw new Error("own_plan_expected");
      expect(plan.uncertainties).toEqual(
        expect.arrayContaining([expect.objectContaining({ code: expectedCode })]),
      );
    },
  );

  it("rechaza entrenamiento propio completo si conserva una incertidumbre", () => {
    const valid = generateTrainingPlan({
      activeModules: ["training"],
      hasConditions: false,
      hasMedications: false,
      ownTrainingAnchors: ["evening"],
      ownTrainingDaysPerWeek: 3,
      ownTrainingIntensity: "moderate",
      ownTrainingSessionMinutes: 45,
      ownTrainingTypes: ["strength"],
      trainingLimitationsStatus: "none",
      trainingMode: "own",
    });
    if (valid.mode !== "own") throw new Error("own_plan_expected");
    const incoherent = structuredClone(valid);
    incoherent.uncertainties.push({
      code: "INJECTED_UNCERTAINTY",
      messageKey: "training.test.injected",
    });

    expect(TrainingPlanSchema.safeParse(incoherent).success).toBe(false);
  });

  it("no inventa el nivel ausente y etiqueta el bloque conservador como provisional", () => {
    const plan = TrainingPlanSchema.parse(
      generateTrainingPlan({
        activeModules: ["training"],
        generatedTrainingDaysPerWeek: 2,
        generatedTrainingEquipment: ["none"],
        generatedTrainingSessionMinutes: 30,
        generatedTrainingStyles: ["bodyweight"],
        hasConditions: false,
        hasMedications: false,
        trainingLimitationsStatus: "none",
        trainingMode: "generated",
      }),
    );
    expect(plan).toMatchObject({
      availability: { level: "unknown" },
      completeness: "provisional",
      mode: "generated",
      uncertainties: [
        {
          code: "TRAINING_LEVEL_MISSING",
          messageKey: "training.uncertainty.level_missing",
        },
      ],
    });
  });

  it.each([
    {
      extra: {},
      expectedCode: "TRAINING_LIMITATIONS_MISSING",
    },
    {
      extra: {
        hasConditions: false,
        hasMedications: true,
        trainingLimitationsStatus: "none" as const,
      },
      expectedCode: "MEDICATIONS_DETAILS_MISSING",
    },
    {
      extra: {
        hasConditions: false,
        hasMedications: false,
        pregnancyLactation: "pregnant" as const,
        trainingLimitationsStatus: "none" as const,
      },
      expectedCode: "PREGNANCY_CONTEXT_PARTIAL",
    },
  ])(
    "degrada a provisional cuando falta modelado: $expectedCode",
    ({ extra, expectedCode }) => {
      const plan = TrainingPlanSchema.parse(
        generateTrainingPlan({
          activeModules: ["training"],
          generatedTrainingDaysPerWeek: 2,
          generatedTrainingEquipment: ["none"],
          generatedTrainingExperience: "beginner",
          generatedTrainingSessionMinutes: 30,
          generatedTrainingStyles: ["bodyweight"],
          trainingMode: "generated",
          ...extra,
        }),
      );
      if (plan.mode !== "generated") throw new Error("generated_plan_expected");
      expect(plan.completeness).toBe("provisional");
      expect(plan.uncertainties).toEqual(
        expect.arrayContaining([expect.objectContaining({ code: expectedCode })]),
      );
    },
  );

  it("representa la ausencia de entrenamiento sin sesiones ni métricas", () => {
    expect(
      TrainingPlanSchema.parse(generateTrainingPlan({ trainingMode: "none" })),
    ).toEqual({
      mode: "none",
      reason: "training_disabled_by_user",
      routineGenerated: false,
      sessions: [],
    });
  });
});
