import { describe, expect, it } from "vitest";

import {
  MobilityPlanSchema,
  type ContextSnapshotInternal,
} from "@health-design/contracts";
import { EXERCISE_BY_ID } from "@health-design/domain";
import { generateMobilityPlan, runDeterministicEngine } from "@health-design/engine";

const hash = (pair: string) => pair.repeat(32);

function conflictsWithArea(exerciseId: string, excludedAreas: readonly string[]) {
  const exercise = EXERCISE_BY_ID.get(exerciseId);
  if (!exercise) throw new Error(`exercise_missing_${exerciseId}`);
  return [...exercise.areas, ...exercise.limitationAreas].some((area) =>
    excludedAreas.includes(area),
  );
}

describe("motor de movilidad T11", () => {
  it("mantiene un núcleo exacto de cinco minutos sin extensiones ocultas", () => {
    const plan = MobilityPlanSchema.parse(
      generateMobilityPlan({
        activeModules: ["mobility"],
        mobilityAreas: ["shoulders", "spine", "hips"],
        mobilityDiscomfortStatus: "none",
        mobilityMinutes: 5,
        hasConditions: false,
        hasMedications: false,
        trainingMode: "none",
      }),
    );

    expect(plan.coreMinutes).toBe(5);
    expect(plan.totalMinutes).toBe(5);
    expect(plan.core.reduce((total, item) => total + item.durationSeconds, 0)).toBe(
      300,
    );
    expect(plan.extensions).toEqual([]);
    expect(
      plan.core.every(({ alternatives, exerciseId }) => {
        const source = EXERCISE_BY_ID.get(exerciseId);
        return alternatives.every(({ exerciseId: alternativeId }) => {
          const alternative = EXERCISE_BY_ID.get(alternativeId);
          return Boolean(
            source &&
            alternative &&
            source.areas.some((area) => alternative.areas.includes(area)),
          );
        });
      }),
    ).toBe(true);
  });

  it.each([10, 15] as const)(
    "añade únicamente las extensiones elegidas hasta %i minutos",
    (mobilityMinutes) => {
      const plan = MobilityPlanSchema.parse(
        generateMobilityPlan({
          activeModules: ["mobility"],
          mobilityAreas: ["shoulders"],
          mobilityDiscomfortStatus: "none",
          mobilityMinutes,
          hasConditions: false,
          hasMedications: false,
          trainingMode: "own",
        }),
      );
      expect(plan.extensions).toHaveLength((mobilityMinutes - 5) / 5);
      expect(
        plan.extensions.every(
          ({ exercises }) =>
            exercises.reduce((total, item) => total + item.durationSeconds, 0) === 300,
        ),
      ).toBe(true);
    },
  );

  it.each([5, 10, 15] as const)(
    "cubre todas las zonas explícitas cuando el catálogo lo permite en %i minutos",
    (mobilityMinutes) => {
      const selectedAreas = ["ankles", "hips", "knees", "neck", "shoulders", "spine"];
      const plan = generateMobilityPlan({
        activeModules: ["mobility"],
        hasConditions: false,
        hasMedications: false,
        mobilityAnchors: ["morning"],
        mobilityAreas: selectedAreas,
        mobilityDiscomfortStatus: "none",
        mobilityMinutes,
        trainingMode: "none",
      });
      const exerciseIds = [
        ...plan.core.map(({ exerciseId }) => exerciseId),
        ...plan.extensions.flatMap(({ exercises }) =>
          exercises.map(({ exerciseId }) => exerciseId),
        ),
      ];
      const coveredAreas = new Set(
        exerciseIds.flatMap(
          (exerciseId) => EXERCISE_BY_ID.get(exerciseId)?.areas ?? [],
        ),
      );

      expect(selectedAreas.every((area) => coveredAreas.has(area))).toBe(true);
      expect(plan.uncertainties).not.toContainEqual(
        expect.objectContaining({ code: "MOBILITY_SELECTED_AREAS_PARTIAL" }),
      );
    },
  );

  it("expone provisionalidad cuando una zona elegida queda fuera por limitación", () => {
    const plan = generateMobilityPlan({
      activeModules: ["mobility"],
      hasConditions: false,
      hasMedications: false,
      mobilityAnchors: ["morning"],
      mobilityAreas: ["shoulders"],
      mobilityDiscomfortDetails: ["dolor de hombro"],
      mobilityDiscomfortStatus: "declared",
      mobilityMinutes: 5,
      trainingMode: "none",
    });

    expect(plan.completeness).toBe("provisional");
    expect(plan.uncertainties).toContainEqual({
      code: "MOBILITY_SELECTED_AREAS_PARTIAL",
      messageKey: "mobility.uncertainty.selected_areas_partial",
    });
  });

  it("mantiene visible y provisional una zona sin alternativa funcional", () => {
    const plan = generateMobilityPlan({
      activeModules: ["mobility"],
      hasConditions: false,
      hasMedications: false,
      mobilityAnchors: ["morning"],
      mobilityAreas: ["neck"],
      mobilityDiscomfortStatus: "none",
      mobilityMinutes: 5,
      trainingMode: "none",
    });

    expect(plan.core.some(({ exerciseId }) => exerciseId === "neck-nod")).toBe(true);
    expect(plan.completeness).toBe("provisional");
    expect(plan.uncertainties).toContainEqual({
      code: "MOBILITY_ALTERNATIVE_COVERAGE_PARTIAL",
      messageKey: "mobility.uncertainty.alternative_coverage_partial",
    });
  });

  it("adapta la selección cuando la molestia declarada identifica una zona", () => {
    const plan = MobilityPlanSchema.parse(
      generateMobilityPlan({
        activeModules: ["mobility"],
        hasConditions: false,
        hasMedications: false,
        mobilityAreas: ["hips"],
        mobilityDiscomfortDetails: ["dolor de cadera"],
        mobilityDiscomfortStatus: "declared",
        mobilityMinutes: 5,
        trainingMode: "none",
      }),
    );

    expect(plan.completeness).toBe("provisional");
    expect(
      plan.core.every(
        ({ alternatives, exerciseId }) =>
          !conflictsWithArea(exerciseId, ["hips"]) &&
          alternatives.every(
            ({ exerciseId: alternativeId }) =>
              !conflictsWithArea(alternativeId, ["hips"]),
          ),
      ),
    ).toBe(true);
  });

  it.each([
    {
      details: [] as string[],
      expectedError: "mobility_discomfort_details_missing",
    },
    {
      details: ["molestia sin zona identificable"],
      expectedError: "mobility_discomfort_unmapped",
    },
  ])(
    "no prescribe movilidad estándar si la molestia declarada no es utilizable: $expectedError",
    ({ details, expectedError }) => {
      expect(() =>
        generateMobilityPlan({
          activeModules: ["mobility"],
          hasConditions: false,
          hasMedications: false,
          mobilityAreas: ["hips"],
          mobilityDiscomfortDetails: details,
          mobilityDiscomfortStatus: "declared",
          mobilityMinutes: 5,
          trainingMode: "none",
        }),
      ).toThrow(expectedError);
    },
  );

  it("mantiene separadas molestias y limitaciones sin ocultar una fuente no mapeada", () => {
    expect(() =>
      generateMobilityPlan({
        activeModules: ["mobility"],
        hasConditions: false,
        hasMedications: false,
        mobilityAreas: ["hips"],
        mobilityDiscomfortDetails: ["dolor de cadera"],
        mobilityDiscomfortStatus: "declared",
        mobilityMinutes: 5,
        trainingLimitations: ["limitación no reconocible"],
        trainingLimitationsStatus: "declared",
        trainingMode: "own",
      }),
    ).toThrow("mobility_training_limitation_unmapped");
  });

  it("mapea LCA a rodilla al adaptar movilidad", () => {
    const plan = generateMobilityPlan({
      activeModules: ["mobility"],
      hasConditions: false,
      hasMedications: false,
      mobilityAreas: ["hips"],
      mobilityDiscomfortDetails: ["lesión de LCA"],
      mobilityDiscomfortStatus: "declared",
      mobilityMinutes: 5,
      trainingMode: "none",
    });

    expect(
      plan.core.every(
        ({ alternatives, exerciseId }) =>
          !conflictsWithArea(exerciseId, ["knees"]) &&
          alternatives.every(
            ({ exerciseId: alternativeId }) =>
              !conflictsWithArea(alternativeId, ["knees"]),
          ),
      ),
    ).toBe(true);
  });

  it("usa un subconjunto conservador cuando se declara un problema de equilibrio", () => {
    const plan = generateMobilityPlan({
      activeModules: ["mobility"],
      hasConditions: false,
      hasMedications: false,
      mobilityAreas: ["shoulders"],
      mobilityDiscomfortDetails: ["problemas de equilibrio"],
      mobilityDiscomfortStatus: "declared",
      mobilityMinutes: 5,
      trainingMode: "none",
    });

    expect(
      plan.core.every(({ exerciseId }) => {
        return !conflictsWithArea(exerciseId, ["ankles", "hips", "knees"]);
      }),
    ).toBe(true);
  });

  it("rechaza minutos, extensiones o provisionalidad incoherentes", () => {
    const valid = generateMobilityPlan({
      activeModules: ["mobility"],
      hasConditions: false,
      hasMedications: false,
      mobilityAreas: ["shoulders"],
      mobilityAnchors: ["morning"],
      mobilityDiscomfortStatus: "none",
      mobilityMinutes: 15,
      trainingMode: "none",
    });
    const wrongExtensions = { ...valid, extensions: [] };
    const wrongDuration = structuredClone(valid);
    wrongDuration.core[0]!.durationSeconds -= 1;
    const wrongCompleteness = structuredClone(valid);
    wrongCompleteness.completeness =
      valid.completeness === "complete" ? "provisional" : "complete";

    expect(MobilityPlanSchema.safeParse(wrongExtensions).success).toBe(false);
    expect(MobilityPlanSchema.safeParse(wrongDuration).success).toBe(false);
    expect(MobilityPlanSchema.safeParse(wrongCompleteness).success).toBe(false);
  });

  it("integra movilidad como módulo independiente aunque entrenamiento esté apagado", async () => {
    const context: ContextSnapshotInternal = {
      answers: {
        activeModules: ["mobility"],
        mobilityAreas: ["ankles", "hips"],
        mobilityAnchors: ["daily_break"],
        mobilityDiscomfortStatus: "none",
        mobilityMinutes: 10,
        hasConditions: false,
        hasMedications: false,
        trainingMode: "none",
      },
      canonicalizationVersion: "canonical-json-v1",
      completeness: "complete",
      createdAt: "2026-07-19T12:00:00.000Z",
      effectiveAt: "2026-07-19T12:00:00.000Z",
      id: "50000000-0000-4000-8000-000000000112",
      inputHash: hash("12"),
      normalizationVersion: "normalization-v1",
      profileId: "10000000-0000-4000-8000-000000000112",
      schemaVersion: 2,
      sourceDraftId: "40000000-0000-4000-8000-000000000112",
      sourceDraftVersion: 1,
    };
    const result = await runDeterministicEngine({
      baseContext: null,
      baseModuleResults: null,
      change: null,
      context,
    });
    const mobility = result.moduleResults.find(({ module }) => module === "mobility");
    expect(mobility).toMatchObject({ confidence: "high", status: "valid" });
    expect(MobilityPlanSchema.parse(mobility?.payload).totalMinutes).toBe(10);
    expect(
      result.moduleResults.find(({ module }) => module === "training"),
    ).toMatchObject({ status: "not_requested" });
  });

  it("respeta anclajes elegidos y marca como provisional los predeterminados", () => {
    const selected = generateMobilityPlan({
      activeModules: ["mobility"],
      hasConditions: false,
      hasMedications: false,
      mobilityAnchors: ["evening"],
      mobilityAreas: ["hips"],
      mobilityDiscomfortStatus: "none",
      mobilityMinutes: 5,
      trainingMode: "none",
    });
    const defaulted = generateMobilityPlan({
      activeModules: ["mobility"],
      hasConditions: false,
      hasMedications: false,
      mobilityAreas: ["hips"],
      mobilityDiscomfortStatus: "none",
      mobilityMinutes: 5,
      trainingMode: "none",
    });
    const unmodeled = generateMobilityPlan({
      activeModules: ["mobility"],
      hasConditions: false,
      hasMedications: false,
      mobilityAnchors: ["momento no reconocido"],
      mobilityAreas: ["hips"],
      mobilityDiscomfortStatus: "none",
      mobilityMinutes: 5,
      trainingMode: "none",
    });

    expect(selected).toMatchObject({
      anchorSource: "selected",
      completeness: "complete",
      suggestedAnchors: ["evening"],
    });
    expect(defaulted).toMatchObject({
      anchorSource: "default",
      completeness: "provisional",
    });
    expect(defaulted.uncertainties).toContainEqual(
      expect.objectContaining({ code: "MOBILITY_ANCHORS_MISSING" }),
    );
    expect(unmodeled).toMatchObject({
      anchorSource: "default",
      completeness: "provisional",
    });
    expect(unmodeled.uncertainties).toContainEqual(
      expect.objectContaining({ code: "MOBILITY_ANCHORS_MISSING" }),
    );
  });

  it("no presenta como completa una rutina sin zonas prioritarias", () => {
    const plan = generateMobilityPlan({
      activeModules: ["mobility"],
      hasConditions: false,
      hasMedications: false,
      mobilityAnchors: ["morning"],
      mobilityDiscomfortStatus: "none",
      mobilityMinutes: 5,
      trainingMode: "none",
    });

    expect(plan.completeness).toBe("provisional");
    expect(plan.uncertainties).toContainEqual(
      expect.objectContaining({ code: "MOBILITY_AREAS_MISSING" }),
    );

    const partiallyModeled = generateMobilityPlan({
      activeModules: ["mobility"],
      hasConditions: false,
      hasMedications: false,
      mobilityAnchors: ["morning"],
      mobilityAreas: ["hips", "zona no reconocida"],
      mobilityDiscomfortStatus: "none",
      mobilityMinutes: 5,
      trainingMode: "none",
    });
    expect(partiallyModeled.completeness).toBe("provisional");
    expect(partiallyModeled.uncertainties).toContainEqual(
      expect.objectContaining({ code: "MOBILITY_AREAS_UNMODELED" }),
    );
  });

  it("convierte una cobertura segura agotada en fallback provisional explícito", async () => {
    const context: ContextSnapshotInternal = {
      answers: {
        activeModules: ["mobility"],
        hasConditions: false,
        hasMedications: false,
        mobilityAreas: ["hips"],
        mobilityDiscomfortDetails: [
          "tobillo espalda cadera rodilla cuello hombro muñeca",
        ],
        mobilityDiscomfortStatus: "declared",
        mobilityMinutes: 10,
        trainingMode: "none",
      },
      canonicalizationVersion: "canonical-json-v1",
      completeness: "complete",
      createdAt: "2026-07-19T12:00:00.000Z",
      effectiveAt: "2026-07-19T12:00:00.000Z",
      id: "50000000-0000-4000-8000-000000000113",
      inputHash: hash("13"),
      normalizationVersion: "normalization-v1",
      profileId: "10000000-0000-4000-8000-000000000113",
      schemaVersion: 2,
      sourceDraftId: "40000000-0000-4000-8000-000000000113",
      sourceDraftVersion: 1,
    };
    const result = await runDeterministicEngine({
      baseContext: null,
      baseModuleResults: null,
      change: null,
      context,
    });

    expect(
      result.moduleResults.find(({ module }) => module === "mobility"),
    ).toMatchObject({
      confidence: "unknown",
      payload: { requested: true, stage: "mobility_engine" },
      status: "provisional",
      uncertainties: [
        {
          code: "MOBILITY_CATALOG_COVERAGE_INSUFFICIENT",
          messageKey: "mobility.uncertainty.catalog_coverage_insufficient",
          module: "mobility",
        },
      ],
    });
  });

  it.each([
    {
      details: [] as string[],
      expectedCode: "MOBILITY_DISCOMFORT_DETAILS_MISSING",
    },
    {
      details: ["molestia no reconocible"],
      expectedCode: "MOBILITY_DISCOMFORT_UNMAPPED",
    },
  ])(
    "convierte molestias inseguras en fallback provisional: $expectedCode",
    async ({ details, expectedCode }) => {
      const context: ContextSnapshotInternal = {
        answers: {
          activeModules: ["mobility"],
          hasConditions: false,
          hasMedications: false,
          mobilityAreas: ["hips"],
          mobilityDiscomfortDetails: details,
          mobilityDiscomfortStatus: "declared",
          mobilityMinutes: 5,
          trainingMode: "none",
        },
        canonicalizationVersion: "canonical-json-v1",
        completeness: "complete",
        createdAt: "2026-07-19T12:00:00.000Z",
        effectiveAt: "2026-07-19T12:00:00.000Z",
        id: "50000000-0000-4000-8000-000000000114",
        inputHash: hash("14"),
        normalizationVersion: "normalization-v1",
        profileId: "10000000-0000-4000-8000-000000000114",
        schemaVersion: 2,
        sourceDraftId: "40000000-0000-4000-8000-000000000114",
        sourceDraftVersion: 1,
      };
      const result = await runDeterministicEngine({
        baseContext: null,
        baseModuleResults: null,
        change: null,
        context,
      });

      expect(
        result.moduleResults.find(({ module }) => module === "mobility"),
      ).toMatchObject({
        confidence: "unknown",
        payload: { requested: true, stage: "mobility_engine" },
        status: "provisional",
        uncertainties: [
          {
            code: expectedCode,
            messageKey: `mobility.uncertainty.${expectedCode.toLowerCase()}`,
            module: "mobility",
          },
        ],
      });
    },
  );

  it("mantiene el código de la fuente de entrenamiento no mapeada en el pipeline", async () => {
    const context: ContextSnapshotInternal = {
      answers: {
        activeModules: ["mobility"],
        hasConditions: false,
        hasMedications: false,
        mobilityAreas: ["hips"],
        mobilityDiscomfortDetails: ["dolor de cadera"],
        mobilityDiscomfortStatus: "declared",
        mobilityMinutes: 5,
        trainingLimitations: ["limitación no reconocible"],
        trainingLimitationsStatus: "declared",
        trainingMode: "own",
      },
      canonicalizationVersion: "canonical-json-v1",
      completeness: "complete",
      createdAt: "2026-07-19T12:00:00.000Z",
      effectiveAt: "2026-07-19T12:00:00.000Z",
      id: "50000000-0000-4000-8000-000000000115",
      inputHash: hash("15"),
      normalizationVersion: "normalization-v1",
      profileId: "10000000-0000-4000-8000-000000000115",
      schemaVersion: 2,
      sourceDraftId: "40000000-0000-4000-8000-000000000115",
      sourceDraftVersion: 1,
    };
    const result = await runDeterministicEngine({
      baseContext: null,
      baseModuleResults: null,
      change: null,
      context,
    });

    expect(
      result.moduleResults.find(({ module }) => module === "mobility"),
    ).toMatchObject({
      confidence: "unknown",
      status: "provisional",
      uncertainties: [
        {
          code: "MOBILITY_TRAINING_LIMITATION_UNMAPPED",
          messageKey: "mobility.uncertainty.mobility_training_limitation_unmapped",
          module: "mobility",
        },
      ],
    });
  });

  it.each([
    {
      extra: {},
      expectedCode: "MOBILITY_DISCOMFORT_MISSING",
    },
    {
      extra: {
        hasConditions: true,
        hasMedications: false,
        mobilityDiscomfortStatus: "none" as const,
      },
      expectedCode: "CONDITIONS_DETAILS_MISSING",
    },
    {
      extra: {
        hasConditions: false,
        hasMedications: false,
        pregnancyLactation: "lactating" as const,
        mobilityDiscomfortStatus: "none" as const,
      },
      expectedCode: "LACTATION_CONTEXT_PARTIAL",
    },
  ])(
    "mantiene provisionalidad cuando falta modelado: $expectedCode",
    ({ extra, expectedCode }) => {
      const plan = MobilityPlanSchema.parse(
        generateMobilityPlan({
          activeModules: ["mobility"],
          mobilityAreas: ["shoulders"],
          mobilityMinutes: 5,
          trainingMode: "none",
          ...extra,
        }),
      );

      expect(plan.completeness).toBe("provisional");
      expect(plan.uncertainties).toEqual(
        expect.arrayContaining([expect.objectContaining({ code: expectedCode })]),
      );
    },
  );
});
