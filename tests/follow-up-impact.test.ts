import { describe, expect, it } from "vitest";

import {
  analyzeFollowUpImpact,
  analyzeLabHistory,
  labFreshness,
} from "@health-design/engine";

describe("impacto selectivo T13", () => {
  it("rechaza valores de módulos que no están activos", () => {
    expect(() =>
      analyzeFollowUpImpact({
        activeModules: ["nutrition"],
        requestRecalculation: false,
        scope: "weekly",
        values: {
          common: {
            adherence: 4,
            importantSymptoms: [],
            materialChanges: [],
          },
          training: {
            completedSessions: 2,
            fatigue: 2,
            pain: "none",
            perceivedEffort: 7,
            plannedSessions: 3,
            volumeChangePercent: 5,
          },
        },
      }),
    ).toThrow("inactive_follow_up_module");
  });

  it("propone hasta 10 % sin mutar el plan y escala un cambio mayor", () => {
    const base: Parameters<typeof analyzeFollowUpImpact>[0] = {
      activeModules: ["nutrition", "training", "hydration", "mobility"],
      requestRecalculation: false,
      scope: "weekly",
      values: {
        common: {
          adherence: 4,
          importantSymptoms: [],
          materialChanges: [],
        },
        training: {
          completedSessions: 3,
          fatigue: 2,
          pain: "none",
          perceivedEffort: 7,
          plannedSessions: 4,
          volumeChangePercent: 10,
        },
      },
    };
    expect(analyzeFollowUpImpact(base)).toMatchObject({
      candidateRequired: false,
      minorTrainingAdjustmentPercent: 10,
    });
    expect(
      analyzeFollowUpImpact({
        ...base,
        requestRecalculation: false,
        values: {
          ...base.values,
          training: { ...base.values.training, volumeChangePercent: 11 },
        },
      }),
    ).toMatchObject({
      affectedModules: ["nutrition", "training", "hydration", "mobility"],
      candidateRequired: true,
      impact: "dependent_modules",
      minorTrainingAdjustmentPercent: null,
    });
  });

  it("no crea candidato vacío en la revisión de cuatro semanas", () => {
    expect(
      analyzeFollowUpImpact({
        activeModules: ["sleep"],
        requestRecalculation: false,
        scope: "four_week",
        values: {
          common: {
            adherence: 4,
            importantSymptoms: [],
            materialChanges: [],
          },
        },
      }),
    ).toMatchObject({ candidateRequired: false, impact: "unaffected" });
  });

  it("activa alternativa conservadora solo en módulos señalados", () => {
    expect(
      analyzeFollowUpImpact({
        activeModules: ["nutrition", "hydration", "sleep"],
        requestRecalculation: false,
        scope: "weekly",
        values: {
          common: {
            adherence: 3,
            importantSymptoms: [{ modules: ["hydration"], severity: "important" }],
            materialChanges: [],
          },
        },
      }),
    ).toMatchObject({
      affectedModules: ["hydration"],
      candidateRequired: true,
      conservativeModules: ["hydration"],
      impact: "module_only",
    });
  });

  it("calcula tendencia solo entre valores compatibles y sin predicción", () => {
    const history = analyzeLabHistory([
      {
        analyte: "b12",
        measuredAt: "2026-06-01",
        referenceRange: { maximum: "900", minimum: "200", unit: "pg/mL" },
        unit: "pg/mL",
        value: "220",
      },
      {
        analyte: "b12",
        measuredAt: "2026-07-01",
        referenceRange: { maximum: "900", minimum: "200", unit: "pg/mL" },
        unit: "pmol/L",
        value: "147.56",
      },
    ]);
    expect(history).toMatchObject({
      interpretation: "within_range",
      latestValue: "200",
      trend: "down",
      unit: "pg/mL",
    });
    expect(history).not.toHaveProperty("prediction");

    expect(
      analyzeLabHistory([
        { analyte: "b12", measuredAt: "2026-06-01", unit: "pg/mL", value: "220" },
        { analyte: "b12", measuredAt: "2026-07-01", unit: "mg/dL", value: "2" },
      ]).trend,
    ).toBe("insufficient");

    expect(
      analyzeLabHistory([
        {
          analyte: "b12",
          measuredAt: "2026-06-01",
          recordedAt: "2026-06-01T08:00:00.000Z",
          unit: "pg/mL",
          value: "220",
        },
        {
          analyte: "b12",
          measuredAt: null,
          recordedAt: "2026-07-20T08:00:00.000Z",
          unit: "pg/mL",
          value: "180",
        },
      ]).trend,
    ).toBe("insufficient");
  });

  it("usa vigencia curada y deja desconocido lo no modelado", () => {
    expect(
      labFreshness({
        analyte: "b12",
        contextTags: ["b12_replacement"],
        measuredAt: "2026-04-01",
        now: "2026-07-20T00:00:00.000Z",
      }),
    ).toMatchObject({ confidence: "low", ruleId: "b12-replacement-nice-ng239" });
    expect(
      labFreshness({
        analyte: "folate",
        contextTags: [],
        measuredAt: "2026-04-01",
        now: "2026-07-20T00:00:00.000Z",
      }),
    ).toMatchObject({ confidence: "unknown", ruleId: null });
  });
});
