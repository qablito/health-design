import { describe, expect, it } from "vitest";

import {
  QUESTIONNAIRE_PUBLIC_SCHEMA_V2,
  QuestionnaireAnswersSchema,
  QuestionnaireDraftSaveRequestSchema,
} from "@health-design/contracts";
import {
  normalizeQuestionnaireMultiAnswer,
  NUMERIC_FIELD_CONSTRAINTS,
} from "../apps/web/src/features/questionnaire/QuestionnaireField";

describe("contratos del cuestionario", () => {
  it("rechaza valores y combinaciones contradictorias de movimiento", () => {
    expect(
      QuestionnaireAnswersSchema.safeParse({
        generatedTrainingEquipment: ["none", "full_gym"],
      }).success,
    ).toBe(false);
    expect(
      QuestionnaireAnswersSchema.safeParse({
        generatedTrainingStyles: ["no_preference", "strength"],
      }).success,
    ).toBe(false);
    expect(
      QuestionnaireAnswersSchema.safeParse({
        generatedTrainingEquipment: ["laser"],
      }).success,
    ).toBe(false);
    expect(
      QuestionnaireAnswersSchema.safeParse({
        ownTrainingTypes: ["no_preference", "strength"],
      }).success,
    ).toBe(false);
    expect(
      QuestionnaireAnswersSchema.safeParse({
        ownTrainingAnchors: ["variable", "evening"],
      }).success,
    ).toBe(false);
    expect(
      QuestionnaireAnswersSchema.safeParse({
        activeModules: ["nutrition"],
        trainingMode: "generated",
      }).success,
    ).toBe(false);
    expect(
      QuestionnaireAnswersSchema.safeParse({
        activeModules: ["nutrition"],
        trainingMode: "own",
      }).success,
    ).toBe(true);
  });

  it("normaliza estados exclusivos heredados del borrador", () => {
    expect(
      normalizeQuestionnaireMultiAnswer("generatedTrainingEquipment", [
        "none",
        "home_basic",
      ]),
    ).toEqual(["none"]);
    expect(
      normalizeQuestionnaireMultiAnswer("generatedTrainingStyles", [
        "no_preference",
        "strength",
      ]),
    ).toEqual(["no_preference"]);
  });

  it("cubre todos los campos numéricos publicados con límites de entrada", () => {
    const numericIds = QUESTIONNAIRE_PUBLIC_SCHEMA_V2.questions
      .filter(({ kind }) => kind === "number")
      .map(({ id }) => id);

    expect(numericIds.every((id) => id in NUMERIC_FIELD_CONSTRAINTS)).toBe(true);
    for (const id of numericIds) {
      const constraints = NUMERIC_FIELD_CONSTRAINTS[id];
      expect(constraints).toBeDefined();
      if (!constraints) continue;
      expect(constraints.min).toBeTypeOf("number");
      expect(constraints.max).toBeTypeOf("number");
      expect(constraints.step === "any" || constraints.step > 0).toBe(true);
    }
  });

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
    expect(
      QuestionnaireAnswersSchema.safeParse({
        hydrationFluidRestriction: "unknown",
      }).success,
    ).toBe(true);
    expect(
      QuestionnaireAnswersSchema.safeParse({
        hydrationFluidRestriction: true,
      }).success,
    ).toBe(true);
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

  it.each([
    ["hasConditions", "conditions", [{ name: "Hipertensión" }]],
    ["hasMedications", "medications", [{ name: "Furosemida" }]],
    ["hasCurrentSupplements", "currentSupplements", [{ name: "Multivitamínico" }]],
    [
      "hasLabValues",
      "labValues",
      [{ dateApproximate: "2026-07", name: "eGFR", unit: "mL/min", value: "55" }],
    ],
  ] as const)("rechaza %s=false cuando %s contiene datos", (flag, entries, value) => {
    expect(
      QuestionnaireAnswersSchema.safeParse({
        [entries]: value,
        [flag]: false,
      }).success,
    ).toBe(false);
  });

  it("conserva una identidad AEMPS/CIMA confirmada y rechaza identificadores libres", () => {
    expect(
      QuestionnaireAnswersSchema.safeParse({
        medications: [
          {
            aempsId: "117251002",
            name: "OZEMPIC 0,25 MG SOLUCION INYECTABLE EN PLUMA PRECARGADA",
          },
        ],
      }).success,
    ).toBe(true);
    expect(
      QuestionnaireAnswersSchema.safeParse({
        medications: [{ aempsId: "../../inventado", name: "Entrada libre" }],
      }).success,
    ).toBe(false);
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
      QUESTIONNAIRE_PUBLIC_SCHEMA_V2.questions.find(
        ({ id }) => id === "generatedTrainingExperience",
      ),
    ).toMatchObject({
      kind: "single",
      visibleWhen: { answerId: "trainingMode", includes: "generated" },
    });
    expect(
      QUESTIONNAIRE_PUBLIC_SCHEMA_V2.questions
        .find(({ id }) => id === "generatedTrainingStyles")
        ?.options?.map(({ value }) => value),
    ).toEqual([
      "strength",
      "hypertrophy",
      "strength_hypertrophy",
      "bodyweight",
      "endurance",
      "pilates",
      "yoga",
      "functional_hiit",
      "sport_preparation",
      "no_preference",
      "other",
    ]);
    expect(
      QUESTIONNAIRE_PUBLIC_SCHEMA_V2.questions.find(
        ({ id }) => id === "generatedTrainingOtherStyle",
      )?.visibleWhen,
    ).toEqual({ answerId: "generatedTrainingStyles", includes: "other" });
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
    ).toEqual(["Mercadona", "DIA", "ALDI"]);
    expect(
      QUESTIONNAIRE_PUBLIC_SCHEMA_V2.questions.find(
        ({ id }) => id === "hydrationFluidRestriction",
      ),
    ).toMatchObject({
      kind: "single",
      options: [{ value: "none" }, { value: "declared" }, { value: "unknown" }],
    });
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
