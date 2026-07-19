import { describe, expect, it } from "vitest";

import {
  detectContextChange,
  isActivatablePlanVersion,
  type QuestionnaireAnswers,
} from "@health-design/domain";

const base: QuestionnaireAnswers = {
  activeModules: ["nutrition", "training", "hydration"],
  activityLevel: "moderate",
  age: 35,
  country: "ES",
  hasConditions: false,
  hasMedications: false,
  heightCm: 178,
  mealsPerDay: 4,
  nutritionAllergiesStatus: "none",
  nutritionFoodAnxiety: "no",
  nutritionIntolerancesStatus: "none",
  physiologicalSex: "male",
  preferredFoods: ["arroz", "pollo"],
  primaryObjective: "body_composition_maintain",
  proteinPreference: "food_only",
  trainingMode: "generated",
  weightKg: 82,
};

describe("ciclo de vida de planes", () => {
  it("detecta contextos iguales sin inventar impacto", () => {
    expect(detectContextChange(base, structuredClone(base))).toEqual({
      affectedModules: [],
      changedFields: [],
      impact: "unaffected",
    });
  });

  it("limita una preferencia alimentaria al módulo de nutrición", () => {
    const current = { ...base, preferredFoods: ["arroz", "huevos"] };

    expect(detectContextChange(base, current)).toEqual({
      affectedModules: ["nutrition"],
      changedFields: ["preferredFoods"],
      impact: "module_only",
    });
  });

  it("limita cambios de horas, fases y horario al módulo de sueño", () => {
    const previous: QuestionnaireAnswers = {
      ...base,
      activeModules: ["nutrition", "training", "hydration", "sleep"],
      sleepHours: 8,
      sleepQuality: "good",
      sleepRegularity: "regular",
      sleepTracking: true,
      sleepRemMinutes: 90,
      sleepBedTime: "23:00",
      sleepWakeTime: "07:00",
    };
    const current: QuestionnaireAnswers = {
      ...previous,
      sleepHours: 7,
      sleepRemMinutes: 75,
      sleepBedTime: "23:30",
    };

    expect(detectContextChange(previous, current)).toEqual({
      affectedModules: ["sleep"],
      changedFields: ["sleepBedTime", "sleepHours", "sleepRemMinutes"],
      impact: "module_only",
    });
  });

  it("propaga un cambio corporal a los módulos dependientes activos", () => {
    const current = { ...base, weightKg: 80 };

    expect(detectContextChange(base, current)).toEqual({
      affectedModules: ["nutrition", "training", "hydration"],
      changedFields: ["weightKg"],
      impact: "dependent_modules",
    });
  });

  it("marca como estructural un cambio en la selección de módulos", () => {
    const current: QuestionnaireAnswers = {
      ...base,
      activeModules: ["nutrition", "sleep"],
    };

    expect(detectContextChange(base, current)).toEqual({
      affectedModules: ["nutrition", "training", "hydration", "sleep"],
      changedFields: ["activeModules"],
      impact: "structural",
    });
  });

  it("no modifica ninguno de los dos contextos comparados", () => {
    const previous = structuredClone(base);
    const current = { ...structuredClone(base), weightKg: 81 };
    const previousBefore = structuredClone(previous);
    const currentBefore = structuredClone(current);

    detectContextChange(previous, current);

    expect(previous).toEqual(previousBefore);
    expect(current).toEqual(currentBefore);
  });

  it("permite activar versiones válidas tanto completas como provisionales", () => {
    expect(
      isActivatablePlanVersion({
        completeness: "complete",
        status: "draft",
        validationStatus: "valid",
      }),
    ).toBe(true);
    expect(
      isActivatablePlanVersion({
        completeness: "provisional",
        status: "draft",
        validationStatus: "valid",
      }),
    ).toBe(true);
    expect(
      isActivatablePlanVersion({
        completeness: "complete",
        status: "active",
        validationStatus: "valid",
      }),
    ).toBe(false);
    expect(
      isActivatablePlanVersion({
        completeness: "complete",
        status: "draft",
        validationStatus: "invalid",
      }),
    ).toBe(false);
  });
});
