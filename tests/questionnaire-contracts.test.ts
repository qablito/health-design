import { describe, expect, it } from "vitest";

import {
  QUESTIONNAIRE_PUBLIC_SCHEMA_V2,
  QuestionnaireAnswersSchema,
  QuestionnaireDraftSaveRequestSchema,
} from "@health-design/contracts";

describe("contratos del cuestionario", () => {
  it("acepta un borrador parcial y rechaza campos desconocidos", () => {
    expect(
      QuestionnaireAnswersSchema.safeParse({
        activeModules: [],
        country: "ES",
      }).success,
    ).toBe(true);
    expect(
      QuestionnaireAnswersSchema.safeParse({
        activeModules: [],
        country: "ES",
        inventedClinicalField: true,
      }).success,
    ).toBe(false);
  });

  it("mide texto breve por grafemas y limita búsquedas por separado", () => {
    const combinedGrapheme = "e\u0301";
    const valid = QuestionnaireAnswersSchema.safeParse({
      conditions: [{ name: "Condición", note: combinedGrapheme.repeat(500) }],
    });
    const tooLong = QuestionnaireAnswersSchema.safeParse({
      conditions: [{ name: "Condición", note: combinedGrapheme.repeat(501) }],
    });
    const longSearch = QuestionnaireAnswersSchema.safeParse({
      conditions: [{ name: "a".repeat(121) }],
    });

    expect(valid.success).toBe(true);
    expect(tooLong.success).toBe(false);
    expect(longSearch.success).toBe(false);
  });

  it("limita colecciones clínicas antes de guardar", () => {
    const result = QuestionnaireAnswersSchema.safeParse({
      medications: Array.from({ length: 51 }, (_, index) => ({
        name: `Medicamento ${index}`,
      })),
    });

    expect(result.success).toBe(false);
  });

  it("limita el peso objetivo al mismo dominio humano que el peso actual", () => {
    expect(QuestionnaireAnswersSchema.safeParse({ targetWeightKg: 70 }).success).toBe(
      true,
    );
    expect(QuestionnaireAnswersSchema.safeParse({ targetWeightKg: 10 }).success).toBe(
      false,
    );
  });

  it("versiona el guardado remoto y confirma bloques conocidos", () => {
    const parsed = QuestionnaireDraftSaveRequestSchema.parse({
      answers: { activeModules: ["nutrition"] },
      confirmedBlockIds: ["modules"],
      currentBlockId: "nutrition",
      expectedVersion: 0,
      schemaVersion: 2,
    });

    expect(parsed.expectedVersion).toBe(0);
    expect(
      QuestionnaireDraftSaveRequestSchema.safeParse({
        ...parsed,
        confirmedBlockIds: ["invented"],
      }).success,
    ).toBe(false);
  });

  it("publica opciones y dependencias como parte del schema V2", () => {
    expect(QUESTIONNAIRE_PUBLIC_SCHEMA_V2.schemaVersion).toBe(2);
    expect(QUESTIONNAIRE_PUBLIC_SCHEMA_V2.blocks.at(-1)?.id).toBe("summary");
    expect(
      QUESTIONNAIRE_PUBLIC_SCHEMA_V2.questions.find(
        ({ id }) => id === "generatedTrainingStyles",
      )?.visibleWhen,
    ).toEqual({ answerId: "trainingMode", includes: "generated" });
    expect(
      QUESTIONNAIRE_PUBLIC_SCHEMA_V2.questions.find(({ id }) => id === "activeModules")
        ?.options,
    ).toHaveLength(6);
    expect(
      QUESTIONNAIRE_PUBLIC_SCHEMA_V2.questions.find(
        ({ id }) => id === "indirectCalorimetryDate",
      )?.kind,
    ).toBe("date");
    expect(
      QUESTIONNAIRE_PUBLIC_SCHEMA_V2.questions
        .find(({ id }) => id === "medications")
        ?.options?.some(({ value }) => value === "Semaglutida"),
    ).toBe(true);
    expect(
      QUESTIONNAIRE_PUBLIC_SCHEMA_V2.questions.find(({ id }) => id === "preferredFoods")
        ?.options?.length,
    ).toBeGreaterThan(10);
    expect(
      QUESTIONNAIRE_PUBLIC_SCHEMA_V2.questions
        .find(({ id }) => id === "preferredSupermarket")
        ?.options?.map(({ value }) => value),
    ).toEqual(["Mercadona", "Lidl", "DIA", "Carrefour", "Alcampo"]);
  });

  it("conserva la fuente opcional de una analítica manual", () => {
    const result = QuestionnaireAnswersSchema.safeParse({
      labValues: [
        {
          dateApproximate: "julio de 2026",
          name: "Ferritina",
          source: "laboratory",
          unit: "ng/mL",
          value: "42",
        },
      ],
    });

    expect(result.success).toBe(true);
  });
});
