import { describe, expect, it } from "vitest";

import {
  evaluateQuestionnaire,
  getQuestionnaireProgress,
  getVisibleBlockIds,
  getVisibleQuestionIds,
  QUESTIONNAIRE_SCHEMA_VERSION,
  type QuestionnaireAnswers,
} from "@health-design/domain";

const baseAnswers: QuestionnaireAnswers = {
  activeModules: ["nutrition"],
  activityLevel: "moderate",
  age: 35,
  country: "ES",
  hasConditions: false,
  hasMedications: false,
  heightCm: 175,
  mealsPerDay: 4,
  nutritionAllergiesStatus: "none",
  nutritionFoodAnxiety: "no",
  nutritionIntolerancesStatus: "none",
  physiologicalSex: "male",
  primaryObjective: "body_composition_lose_fat",
  proteinPreference: "food_only",
  trainingMode: "none",
  weightKg: 80,
};

describe("cuestionario adaptativo V2", () => {
  it("mantiene una versión canónica explícita", () => {
    expect(QUESTIONNAIRE_SCHEMA_VERSION).toBe(2);
  });

  it("rechaza cero módulos sin modificar el borrador", () => {
    const answers: QuestionnaireAnswers = {
      ...baseAnswers,
      activeModules: [],
    };

    const result = evaluateQuestionnaire(answers);

    expect(result.hardErrors).toContainEqual({
      answerId: "activeModules",
      code: "modules_required",
    });
    expect(answers.activeModules).toEqual([]);
  });

  it("oculta las preguntas de rutina generada cuando no hay entrenamiento", () => {
    const visible = getVisibleQuestionIds({
      ...baseAnswers,
      activeModules: ["nutrition", "sleep"],
      trainingMode: "none",
    });

    expect(visible).toContain("trainingMode");
    expect(visible).not.toContain("generatedTrainingStyles");
    expect(visible).not.toContain("generatedTrainingDaysPerWeek");
    expect(visible).not.toContain("generatedTrainingExperience");
    expect(visible).not.toContain("generatedTrainingOtherStyle");
    expect(visible).not.toContain("generatedTrainingEquipment");
  });

  it("abre una descripción breve solo al elegir otra modalidad", () => {
    const answers: QuestionnaireAnswers = {
      ...baseAnswers,
      activeModules: ["training"],
      generatedTrainingDaysPerWeek: 3,
      generatedTrainingEquipment: ["none"],
      generatedTrainingExperience: "beginner",
      generatedTrainingSessionMinutes: 30,
      generatedTrainingStyles: ["other"],
      trainingLimitationsStatus: "none",
      trainingMode: "generated",
    };

    expect(getVisibleQuestionIds(answers)).toContain("generatedTrainingOtherStyle");
    expect(evaluateQuestionnaire(answers).uncertainties).toContainEqual({
      affectedModules: ["training"],
      answerId: "generatedTrainingOtherStyle",
      blockId: "training",
      reason: "questionnaire.missing.generatedTrainingOtherStyle",
    });
    expect(
      getVisibleQuestionIds({
        ...answers,
        generatedTrainingStyles: ["strength"],
      }),
    ).not.toContain("generatedTrainingOtherStyle");
  });

  it("pide el nivel de experiencia solo para una rutina generada y no lo infiere", () => {
    const answers: QuestionnaireAnswers = {
      ...baseAnswers,
      activeModules: ["training"],
      generatedTrainingDaysPerWeek: 3,
      generatedTrainingEquipment: ["none"],
      generatedTrainingSessionMinutes: 35,
      generatedTrainingStyles: ["bodyweight"],
      trainingMode: "generated",
    };

    expect(getVisibleQuestionIds(answers)).toContain("generatedTrainingExperience");
    expect(evaluateQuestionnaire(answers).uncertainties).toContainEqual({
      affectedModules: ["training"],
      answerId: "generatedTrainingExperience",
      blockId: "training",
      reason: "questionnaire.missing.generatedTrainingExperience",
    });
  });

  it("activa únicamente el detalle clínico o farmacológico declarado", () => {
    const conditionVisible = getVisibleQuestionIds({
      ...baseAnswers,
      hasConditions: true,
      hasMedications: false,
    });
    const medicationVisible = getVisibleQuestionIds({
      ...baseAnswers,
      hasConditions: false,
      hasMedications: true,
    });

    expect(conditionVisible).toContain("conditions");
    expect(conditionVisible).not.toContain("medications");
    expect(medicationVisible).toContain("medications");
    expect(medicationVisible).not.toContain("conditions");
  });

  it("convierte una respuesta crítica ausente en incertidumbre provisional", () => {
    const answers = { ...baseAnswers };
    delete answers.weightKg;

    const result = evaluateQuestionnaire(answers);

    expect(result.completeness).toBe("provisional");
    expect(result.hardErrors).toEqual([]);
    expect(result.uncertainties).toContainEqual({
      affectedModules: ["nutrition"],
      answerId: "weightKg",
      blockId: "core",
      reason: "questionnaire.missing.weightKg",
    });
    expect("weightKg" in answers).toBe(false);
  });

  it("pide y conserva como incertidumbre el peso objetivo cuando la meta lo necesita", () => {
    const visibleForLoss = getVisibleQuestionIds(baseAnswers);
    const visibleForMaintenance = getVisibleQuestionIds({
      ...baseAnswers,
      primaryObjective: "body_composition_maintain",
    });
    const result = evaluateQuestionnaire(baseAnswers);

    expect(visibleForLoss).toContain("targetWeightKg");
    expect(visibleForMaintenance).not.toContain("targetWeightKg");
    expect(result.uncertainties).toContainEqual({
      affectedModules: ["nutrition"],
      answerId: "targetWeightKg",
      blockId: "goals",
      reason: "questionnaire.missing.targetWeightKg",
    });
  });

  it("limita los objetivos secundarios a dos", () => {
    const result = evaluateQuestionnaire({
      ...baseAnswers,
      secondaryObjectives: [
        "performance_strength",
        "wellbeing_sleep",
        "wellbeing_energy",
      ],
    });

    expect(result.hardErrors).toContainEqual({
      answerId: "secondaryObjectives",
      code: "secondary_objectives_limit",
    });
  });

  it("calcula bloques y tiempo restante solo para ramas visibles", () => {
    const blocks = getVisibleBlockIds({
      ...baseAnswers,
      activeModules: ["nutrition", "sleep"],
      trainingMode: "none",
    });
    const progress = getQuestionnaireProgress(blocks, ["core", "goals"]);

    expect(blocks).toEqual([
      "core",
      "goals",
      "modules",
      "nutrition",
      "training",
      "sleep",
      "clinical",
      "labs",
      "summary",
    ]);
    expect(progress.completed).toBe(2);
    expect(progress.total).toBe(9);
    expect(progress.estimatedMinutesRemaining).toBeGreaterThan(0);
  });

  it("incluye las preferencias de compra solo cuando alimentación está activa", () => {
    const nutrition = getVisibleQuestionIds(baseAnswers);
    const sleepOnly = getVisibleQuestionIds({
      ...baseAnswers,
      activeModules: ["sleep"],
    });

    expect(nutrition).toContain("preferredSupermarket");
    expect(nutrition).toContain("compareSupermarkets");
    expect(sleepOnly).not.toContain("preferredSupermarket");
    expect(sleepOnly).not.toContain("compareSupermarkets");
  });

  it("muestra la calorimetría opcional y sus detalles solo cuando se declara", () => {
    const base = getVisibleQuestionIds(baseAnswers);
    const declared = getVisibleQuestionIds({
      ...baseAnswers,
      hasIndirectCalorimetry: true,
    });

    expect(base).toContain("hasIndirectCalorimetry");
    expect(base).not.toContain("indirectCalorimetryRmrKcal");
    expect(declared).toEqual(
      expect.arrayContaining([
        "indirectCalorimetryRmrKcal",
        "indirectCalorimetryDate",
        "indirectCalorimetrySource",
      ]),
    );
  });

  it("muestra los anclajes flexibles solo con alimentación activa", () => {
    expect(getVisibleQuestionIds(baseAnswers)).toContain("nutritionMealAnchors");
    expect(
      getVisibleQuestionIds({ ...baseAnswers, activeModules: ["sleep"] }),
    ).not.toContain("nutritionMealAnchors");
  });
});
