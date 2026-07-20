import { expect, test, type Page } from "@playwright/test";

import { PlanVersionDetailSchema } from "@health-design/contracts";
import type { QuestionnaireAnswers } from "@health-design/domain";
import { generateNutritionWeek } from "@health-design/engine";
import { effectiveNutritionFoods } from "@health-design/test-fixtures/nutrition-plan";

const userId = "00000000-0000-4000-8000-000000001001";
const sessionId = "21000000-0000-4000-8000-000000001001";
const profileId = "51000000-0000-4000-8000-000000001001";
const draftId = "71000000-0000-4000-8000-000000001001";
const contextSnapshotId = "52000000-0000-4000-8000-000000001001";
const planId = "53000000-0000-4000-8000-000000001001";
const planVersionId = "54000000-0000-4000-8000-000000001001";
const createdAt = "2026-07-19T10:00:00.000Z";

const answers = {
  activeModules: ["nutrition"],
  activityLevel: "moderate" as const,
  age: 35,
  country: "ES" as const,
  dailySchedule: "regular" as const,
  dietaryPattern: "omnivore" as const,
  hasConditions: false,
  hasMedications: false,
  heightCm: 175,
  mealsPerDay: 4,
  nutritionAllergiesStatus: "none" as const,
  nutritionFoodAnxiety: "sometimes" as const,
  nutritionIntolerancesStatus: "none" as const,
  nutritionMealAnchors: ["wake_up", "midday", "afternoon", "evening"],
  nutritionMode: "balanced" as const,
  physiologicalSex: "male" as const,
  primaryObjective: "body_composition_maintain" as const,
  proteinPreference: "food_only" as const,
  trainingMode: "none" as const,
  weightKg: 80,
} satisfies QuestionnaireAnswers;

const nutritionWeek = generateNutritionWeek({
  answers,
  catalog: effectiveNutritionFoods,
});

function base64Url(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function browserSession() {
  const now = Math.floor(Date.now() / 1_000);
  return {
    access_token: `${base64Url({ alg: "HS256", typ: "JWT" })}.${base64Url({
      aud: "authenticated",
      exp: now + 3_600,
      iat: now,
      role: "authenticated",
      session_id: sessionId,
      sub: userId,
    })}.test-signature`,
    expires_at: now + 3_600,
    expires_in: 3_600,
    refresh_token: "nutrition-refresh-token",
    token_type: "bearer",
    user: {
      app_metadata: { provider: "anonymous", providers: ["anonymous"] },
      aud: "authenticated",
      created_at: createdAt,
      id: userId,
      is_anonymous: true,
      role: "authenticated",
      updated_at: createdAt,
      user_metadata: {},
    },
  };
}

async function installSession(page: Page) {
  await page.addInitScript((session) => {
    window.localStorage.setItem("sb-127-auth-token", JSON.stringify(session));
  }, browserSession());
}

function mutationAck(
  status: "active" | "draft",
  aggregateVersion: number,
  completeness: "complete" | "provisional" = "complete",
) {
  return {
    activatedAt: status === "active" ? "2026-07-19T10:05:00.000Z" : null,
    activeVersionId: status === "active" ? planVersionId : null,
    aggregateVersion,
    archivedAt: null,
    completeness,
    contextSnapshotId,
    createdAt,
    ordinal: 1,
    planId,
    planVersionId,
    status,
    validationStatus: "valid",
  };
}

async function mockNutritionApi(page: Page, options: { provisional?: boolean } = {}) {
  const completeness = options.provisional ? "provisional" : "complete";
  const selectedWeek = options.provisional
    ? {
        ...nutritionWeek,
        strategies: [
          "regular_meal_anchors",
          "protein_fiber_pairing",
          "sodium_target_not_verified",
        ],
        targets: {
          ...nutritionWeek.targets,
          completeness,
          uncertainties: [
            {
              code: "NUTRITION_SODIUM_NOT_VERIFIED",
              messageKey: "nutrition.private.raw_message_key",
            },
          ],
        },
      }
    : nutritionWeek;
  const seenRequests: Array<{ body: unknown; method: string; path: string }> = [];
  let currentStatus: "active" | "draft" | undefined;
  let currentAggregateVersion = 1;
  await page.route("http://127.0.0.1:54321/functions/v1/access/**", (route) =>
    route.fulfill({
      body: JSON.stringify([
        {
          accessScope: "owner",
          alias: "Perfil nutricional",
          profileId,
          status: "active",
        },
      ]),
      contentType: "application/json",
      status: 200,
    }),
  );
  await page.route("http://127.0.0.1:54321/functions/v1/plans/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const body: unknown = request.postData()
      ? (request.postDataJSON() as unknown)
      : null;
    seenRequests.push({ body, method: request.method(), path });

    if (
      path.endsWith(`/v1/profiles/${profileId}/plans/current`) &&
      request.method() === "GET"
    ) {
      if (!currentStatus) {
        await route.fulfill({
          body: JSON.stringify({ error: { code: "NOT_FOUND" } }),
          contentType: "application/json",
          status: 404,
        });
        return;
      }
      await route.fulfill({
        body: JSON.stringify({
          activeVersionId: currentStatus === "active" ? planVersionId : null,
          aggregateVersion: currentAggregateVersion,
          planId,
          profileId,
          versions: [
            {
              activatedAt:
                currentStatus === "active" ? "2026-07-19T10:05:00.000Z" : null,
              archivedAt: null,
              canonicalizationVersion: "canonical-json-v1",
              completeness,
              contextSnapshotId,
              createdAt,
              engineVersion: "engine-v3",
              hashAlgorithm: "sha256",
              id: planVersionId,
              inputHash: "a".repeat(64),
              ordinal: 1,
              outputHash: "b".repeat(64),
              planId,
              ruleSetRevisionId: "04edd58c-5fff-4f6b-85ad-472ec538885c",
              sourceManifestId: "90000000-0000-4000-8000-000000000001",
              status: currentStatus,
              validatedAt: createdAt,
              validation: { status: "valid" },
              validationStatus: "valid",
            },
          ],
        }),
        contentType: "application/json",
        status: 200,
      });
      return;
    }

    if (
      path.endsWith(`/v1/profiles/${profileId}/draft`) &&
      request.method() === "GET"
    ) {
      await route.fulfill({
        body: JSON.stringify({
          answers,
          completeness,
          confirmedBlockIds: ["core", "goals", "modules", "nutrition"],
          currentBlockId: "summary",
          hardErrors: [],
          id: draftId,
          profileId,
          schemaVersion: 2,
          status: "submitted",
          uncertainties: [],
          updatedAt: createdAt,
          version: 4,
        }),
        contentType: "application/json",
        status: 200,
      });
      return;
    }
    if (path.endsWith(`/v1/profiles/${profileId}/contexts/snapshot`)) {
      await route.fulfill({
        body: JSON.stringify({
          canonicalizationVersion: "canonical-json-v1",
          completeness,
          createdAt,
          effectiveAt: createdAt,
          id: contextSnapshotId,
          inputHash: "a".repeat(64),
          normalizationVersion: "normalization-v1",
          profileId,
          schemaVersion: 1,
          sourceDraftId: draftId,
          sourceDraftVersion: 4,
        }),
        contentType: "application/json",
        status: 201,
      });
      return;
    }
    if (path.endsWith(`/v1/profiles/${profileId}/plans/generate`)) {
      currentStatus = "draft";
      currentAggregateVersion = 1;
      await route.fulfill({
        body: JSON.stringify(mutationAck("draft", 1, completeness)),
        contentType: "application/json",
        status: 201,
      });
      return;
    }
    if (path.endsWith(`/v1/plans/${planId}/versions/${planVersionId}`)) {
      const detail = PlanVersionDetailSchema.parse({
        activatedAt: null,
        archivedAt: null,
        canonicalizationVersion: "canonical-json-v1",
        completeness,
        contextSnapshotId,
        createdAt,
        engineVersion: "engine-v3",
        hashAlgorithm: "sha256",
        id: planVersionId,
        inputHash: "a".repeat(64),
        moduleResults: [
          {
            confidence: "high",
            createdAt,
            id: "56000000-0000-4000-8000-000000001001",
            module: "nutrition",
            payload: selectedWeek,
            status: options.provisional ? "provisional" : "valid",
            uncertainties: options.provisional
              ? [
                  {
                    code: "NUTRITION_CLINICAL_CONTEXT_REVIEW",
                    privateName: "nombre clínico privado",
                  },
                ]
              : [],
          },
        ],
        ordinal: 1,
        outputHash: "b".repeat(64),
        planId,
        ruleSetRevisionId: "04edd58c-5fff-4f6b-85ad-472ec538885c",
        safetyFindings: options.provisional
          ? [
              {
                actionLevel: "priority_review",
                code: "HYPERTENSION_CONTEXT_PARTIAL",
                createdAt,
                evidenceRef: "private://clinical-source",
                id: "57000000-0000-4000-8000-000000001001",
                messageKey: "clinical.private.raw_message_key",
                module: "nutrition",
              },
            ]
          : [],
        sourceManifestId: "90000000-0000-4000-8000-000000000001",
        status: "draft",
        validatedAt: createdAt,
        validation: { status: "valid" },
        validationStatus: "valid",
      });
      await route.fulfill({
        body: JSON.stringify(detail),
        contentType: "application/json",
        status: 200,
      });
      return;
    }
    if (path.endsWith(`/v1/plans/${planVersionId}/explanation`)) {
      await route.fulfill({
        body: JSON.stringify({
          planOutputHash: "b".repeat(64),
          planVersionId,
          schemaVersion: 1,
          segments: [
            {
              messageKey: `ai.explanation.summary.${completeness}`,
              slot: "summary",
              text:
                completeness === "complete"
                  ? "Tu plan está completo y ha superado la validación interna."
                  : "Tu plan es provisional porque todavía contiene incertidumbres visibles.",
            },
            {
              messageKey: `ai.explanation.nutrition.${options.provisional ? "provisional" : "valid"}`,
              slot: "nutrition",
              text: options.provisional
                ? "La alimentación se mantiene provisional y conserva sus incertidumbres visibles."
                : "La alimentación está validada para el contexto registrado.",
            },
          ],
          source: "luna",
        }),
        contentType: "application/json",
        status: 200,
      });
      return;
    }
    if (path.endsWith(`/v1/plans/${planId}/versions/${planVersionId}/activate`)) {
      currentStatus = "active";
      currentAggregateVersion = 2;
      await route.fulfill({
        body: JSON.stringify(mutationAck("active", 2, completeness)),
        contentType: "application/json",
        status: 200,
      });
      return;
    }
    await route.fulfill({
      body: JSON.stringify({ error: { code: "NOT_FOUND" } }),
      contentType: "application/json",
      status: 404,
    });
  });
  return seenRequests;
}

test("genera, recalcula una sustitución y activa solo el borrador original", async ({
  page,
}) => {
  await installSession(page);
  const requests = await mockNutritionApi(page);
  await page.goto("/nutrition");

  await expect(
    page.getByRole("heading", { name: "Tu semana de alimentación" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Generar semana estable" }).click();
  await expect(
    page.getByRole("region", { name: "Objetivos nutricionales" }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Día 7", exact: true })).toBeVisible();
  await expect(page.getByRole("option", { name: /·/ }).first()).toBeAttached();

  await page.getByRole("button", { name: "Explicar mi plan" }).click();
  await expect(page.getByText("Explicación seleccionada por Luna")).toBeVisible();
  await expect(
    page.getByText("La alimentación está validada para el contexto registrado."),
  ).toBeVisible();

  const dailyBefore = await page.locator(".nutrition-toolbar span").textContent();
  const firstSubstitution = page.getByRole("combobox", { name: /^Sustituir / }).first();
  await firstSubstitution.selectOption({ index: 1 });
  await expect(page.getByText("Vista previa recalculada.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Activar plan" })).toBeDisabled();
  expect(await page.locator(".nutrition-toolbar span").textContent()).not.toBe(
    dailyBefore,
  );

  await page.getByRole("button", { name: "Restablecer elecciones" }).click();
  await expect(page.locator(".nutrition-toolbar span")).toHaveText(dailyBefore ?? "");
  await page.getByRole("button", { name: "Activar plan" }).click();
  await expect(page.getByRole("button", { name: "Plan activo" })).toBeVisible();

  const activation = requests.find(({ path }) => path.endsWith("/activate"));
  expect(activation).toMatchObject({
    body: { expectedVersion: 1, schemaVersion: 1 },
    method: "POST",
  });
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain(
    "Pechuga de pollo",
  );
});

test("selector accesible alterna ingredientes y preparación sin ocultar nutrientes", async ({
  page,
}) => {
  await installSession(page);
  await mockNutritionApi(page);
  await page.goto("/nutrition");
  await page.getByRole("button", { name: "Generar semana estable" }).click();

  const ingredients = page.getByRole("radio", {
    name: "Ingredientes y cantidades",
  });
  const preparation = page.getByRole("radio", {
    exact: true,
    name: "Preparación breve",
  });
  const firstFood = nutritionWeek.days[0]!.meals[0]!.foods[0]!;
  const firstReplacement = firstFood.substitutes[0]!;

  await expect(page.getByRole("group", { name: "Vista de las comidas" })).toBeVisible();
  await expect(ingredients).toBeChecked();
  await expect(preparation).not.toBeChecked();
  await expect(page.getByText(firstFood.preparation.instruction).first()).toHaveCount(
    0,
  );

  await ingredients.focus();
  await page.keyboard.press("ArrowRight");
  await expect(preparation).toBeChecked();
  await expect(page.getByText(firstFood.preparation.instruction).first()).toBeVisible();
  await expect(page.getByText(/kcal · P /).first()).toBeVisible();

  const firstSubstitution = page.getByRole("combobox", { name: /^Sustituir / }).first();
  await firstSubstitution.selectOption({ index: 1 });
  await expect(
    page.getByText(firstReplacement.preparation.instruction).first(),
  ).toBeVisible();

  const visible = await page.locator("body").innerText();
  expect(visible).not.toContain(firstReplacement.preparation.ruleId);
  expect(visible).not.toContain(firstReplacement.preparation.ruleSetVersion);
});

test("presenta y activa un plan provisional validado sin exponer códigos internos", async ({
  page,
}) => {
  await installSession(page);
  await mockNutritionApi(page, { provisional: true });
  await page.goto("/nutrition");
  await page.getByRole("button", { name: "Generar semana estable" }).click();

  await expect(page.getByText("PLAN PROVISIONAL", { exact: true })).toBeVisible();
  await expect(page.getByText(/puede activarse manualmente/i)).toBeVisible();
  await expect(
    page.getByText(/objetivo de sodio aún no está verificado/i),
  ).toBeVisible();
  await expect(page.getByText(/anclajes regulares de comida/i)).toBeVisible();
  await expect(page.getByText(/proteína y fibra/i)).toBeVisible();
  await expect(page.getByText(/presión arterial/i)).toBeVisible();

  const visible = await page.locator("body").innerText();
  expect(visible).not.toContain("NUTRITION_SODIUM_NOT_VERIFIED");
  expect(visible).not.toContain("HYPERTENSION_CONTEXT_PARTIAL");
  expect(visible).not.toContain("nombre clínico privado");
  expect(visible).not.toContain("private://clinical-source");
  await page.getByRole("button", { name: "Activar plan" }).click();
  await expect(page.getByRole("button", { name: "Plan activo" })).toBeVisible();
});

test("recarga el plan actual de nutrición sin volver a ofrecer generación", async ({
  page,
}) => {
  await installSession(page);
  const requests = await mockNutritionApi(page);
  await page.goto("/nutrition");
  await page.getByRole("button", { name: "Generar semana estable" }).click();
  await expect(
    page.getByRole("region", { name: "Objetivos nutricionales" }),
  ).toBeVisible();

  await page.reload();

  await expect(
    page.getByRole("region", { name: "Objetivos nutricionales" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Activar plan" })).toBeEnabled();
  await expect(
    page.getByRole("button", { name: "Generar semana estable" }),
  ).toHaveCount(0);
  expect(
    requests.some(
      ({ method, path }) =>
        method === "GET" && path.endsWith(`/v1/profiles/${profileId}/plans/current`),
    ),
  ).toBe(true);
});
