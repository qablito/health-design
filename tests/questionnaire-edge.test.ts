import { describe, expect, it } from "vitest";

import {
  handleQuestionnaire,
  type QuestionnaireDependencies,
} from "../supabase/functions/plans/questionnaire";

const profileId = "10000000-0000-4000-8000-000000000001";
const userId = "20000000-0000-4000-8000-000000000001";
const sessionId = "30000000-0000-4000-8000-000000000001";
const draftId = "40000000-0000-4000-8000-000000000001";

const baseAnswers = {
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
} as const;

function setup(storedAnswers: Record<string, unknown> = baseAnswers): {
  calls: Array<{ args: Record<string, unknown>; name: string }>;
  dependencies: QuestionnaireDependencies;
} {
  const calls: Array<{ args: Record<string, unknown>; name: string }> = [];
  const ack = {
    completeness: "complete",
    confirmedBlockIds: ["core", "goals", "modules"],
    currentBlockId: "nutrition",
    hardErrors: [],
    profileId,
    schemaVersion: 1,
    status: "editing",
    uncertainties: [],
    updatedAt: "2026-07-18T10:00:00.000Z",
    version: 1,
  };
  return {
    calls,
    dependencies: {
      authenticate: () => Promise.resolve({ sessionId, userId }),
      environment: "local",
      now: () => new Date("2026-07-18T10:00:00.000Z"),
      randomUUID: () => "50000000-0000-4000-8000-000000000001",
      rpc: (name, args) => {
        calls.push({ args, name });
        if (name === "internal_get_questionnaire_draft") {
          return Promise.resolve({
            data: [
              {
                ...ack,
                answers: storedAnswers,
                id: draftId,
              },
            ],
            error: null,
          });
        }
        if (name === "internal_submit_questionnaire_draft") {
          return Promise.resolve({
            data: [{ ...ack, status: "submitted", version: 2 }],
            error: null,
          });
        }
        return Promise.resolve({ data: [ack], error: null });
      },
    },
  };
}

function request(
  path: string,
  method: "GET" | "POST" | "PUT",
  body?: unknown,
): Request {
  return new Request(`https://api.test/plans${path}`, {
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    headers: {
      authorization: "Bearer valid-user-jwt",
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...(body !== undefined &&
      typeof body === "object" &&
      body !== null &&
      "expectedVersion" in body
        ? { "if-match": `"${String(body.expectedVersion)}"` }
        : {}),
      "idempotency-key": "60000000-0000-4000-8000-000000000001",
      origin: "http://127.0.0.1:5173",
    },
    method,
  });
}

describe("Edge del cuestionario", () => {
  it("devuelve el schema versionado sin respuestas", async () => {
    const current = setup();
    const response = await handleQuestionnaire(
      request("/v1/questionnaire/schema", "GET"),
      current.dependencies,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ schemaVersion: 1 });
    expect(current.calls).toEqual([]);
    expect(response.headers.get("cache-control")).toBe("no-store, private");
  });

  it("rechaza profundidad superior a 12 antes de invocar persistencia", async () => {
    const current = setup();
    let nested: unknown = "value";
    for (let index = 0; index < 13; index += 1) nested = { nested };
    const response = await handleQuestionnaire(
      request(`/v1/profiles/${profileId}/draft`, "PUT", nested),
      current.dependencies,
    );

    expect(response.status).toBe(422);
    expect(current.calls).toEqual([]);
  });

  it("rechaza arrays superiores a 500 y texto breve superior a 500 grafemas", async () => {
    const arrayCase = setup();
    const arrayResponse = await handleQuestionnaire(
      request(`/v1/profiles/${profileId}/draft`, "PUT", {
        answers: { preferredFoods: Array.from({ length: 501 }, () => "arroz") },
        confirmedBlockIds: [],
        currentBlockId: "nutrition",
        expectedVersion: 0,
        schemaVersion: 1,
      }),
      arrayCase.dependencies,
    );
    const textCase = setup();
    const textResponse = await handleQuestionnaire(
      request(`/v1/profiles/${profileId}/draft`, "PUT", {
        answers: {
          conditions: [{ name: "Condición", note: "x".repeat(501) }],
        },
        confirmedBlockIds: [],
        currentBlockId: "clinical",
        expectedVersion: 0,
        schemaVersion: 1,
      }),
      textCase.dependencies,
    );

    expect(arrayResponse.status).toBe(422);
    expect(textResponse.status).toBe(422);
    expect(arrayCase.calls).toEqual([]);
    expect(textCase.calls).toEqual([]);
  });

  it("corta un cuerpo superior a 256 KiB antes de parsearlo", async () => {
    const current = setup();
    const response = await handleQuestionnaire(
      request(`/v1/profiles/${profileId}/draft`, "PUT", {
        padding: "x".repeat(256 * 1024),
      }),
      current.dependencies,
    );

    expect(response.status).toBe(413);
    expect(current.calls).toEqual([]);
  });

  it("guarda cero módulos como borrador pero impide enviarlo sin perderlo", async () => {
    const answers = { ...baseAnswers, activeModules: [] };
    const save = setup(answers);
    const saveResponse = await handleQuestionnaire(
      request(`/v1/profiles/${profileId}/draft`, "PUT", {
        answers,
        confirmedBlockIds: ["core", "goals", "modules"],
        currentBlockId: "summary",
        expectedVersion: 0,
        schemaVersion: 1,
      }),
      save.dependencies,
    );
    const submit = setup(answers);
    const submitResponse = await handleQuestionnaire(
      request(`/v1/profiles/${profileId}/draft/submit`, "POST", {
        expectedVersion: 1,
        schemaVersion: 1,
      }),
      submit.dependencies,
    );

    expect(saveResponse.status).toBe(200);
    expect(
      save.calls.some(({ name }) => name === "internal_put_questionnaire_draft"),
    ).toBe(true);
    expect(submitResponse.status).toBe(422);
    expect(submit.calls.map(({ name }) => name)).toEqual([
      "internal_get_questionnaire_draft",
    ]);
    expect(await submitResponse.json()).toMatchObject({
      error: { code: "QUESTIONNAIRE_INCOMPLETE" },
    });
  });

  it("permite enviar un plan provisional con incertidumbres clínicas visibles", async () => {
    const answers: Record<string, unknown> = { ...baseAnswers };
    delete answers.weightKg;
    const current = setup(answers);
    const response = await handleQuestionnaire(
      request(`/v1/profiles/${profileId}/draft/submit`, "POST", {
        expectedVersion: 1,
        schemaVersion: 1,
      }),
      current.dependencies,
    );

    expect(response.status).toBe(200);
    expect(
      current.calls.some(
        ({ args, name }) =>
          name === "internal_submit_questionnaire_draft" &&
          args.p_completeness === "provisional",
      ),
    ).toBe(true);
  });
});
