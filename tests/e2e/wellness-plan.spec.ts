import { expect, test, type Page } from "@playwright/test";

import { PlanVersionDetailSchema } from "@health-design/contracts";
import type { QuestionnaireAnswers } from "@health-design/domain";
import {
  generateHydrationPlan,
  generateSleepPlan,
  generateSupplementsPlan,
} from "@health-design/engine";

const userId = "00000000-0000-4000-8000-000000001201";
const sessionId = "21000000-0000-4000-8000-000000001201";
const profileId = "51000000-0000-4000-8000-000000001201";
const draftId = "71000000-0000-4000-8000-000000001201";
const contextSnapshotId = "52000000-0000-4000-8000-000000001201";
const planId = "53000000-0000-4000-8000-000000001201";
const planVersionId = "54000000-0000-4000-8000-000000001201";
const createdAt = "2026-07-19T10:00:00.000Z";

const answers = {
  activeModules: ["hydration", "sleep", "supplements"],
  activityLevel: "moderate",
  age: 35,
  country: "ES",
  currentSupplements: [{ name: "Marca privada que no debe aparecer" }],
  dailySchedule: "regular",
  dietaryPattern: "vegan",
  hasConditions: false,
  hasCurrentSupplements: true,
  hasLabValues: true,
  hasMedications: false,
  habitualBeverages: ["agua", "café", "vino"],
  habitualWaterMl: 1_800,
  heightCm: 175,
  hydrationAnchors: ["wake_up", "midday", "evening"],
  hydrationClimate: "temperate",
  hydrationFluidRestriction: false,
  hydrationReminders: false,
  hydrationSweat: "medium",
  labValues: [
    {
      dateApproximate: "julio de 2026",
      name: "Vitamina B12",
      referenceRange: "200-900",
      source: "laboratory",
      unit: "pg/mL",
      value: "175",
    },
  ],
  physiologicalSex: "male",
  primaryObjective: "wellbeing_sleep",
  sleepBedTime: "23:30",
  sleepDeepMinutes: 80,
  sleepHours: 7.5,
  sleepLightMinutes: 275,
  sleepQuality: "poor",
  sleepRegularity: "regular",
  sleepRemMinutes: 95,
  sleepTracking: true,
  sleepWakeTime: "07:00",
  supplementRecommendationPreference: "contextual",
  trainingMode: "none",
  weightKg: 80,
} satisfies QuestionnaireAnswers;

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
    refresh_token: "wellness-refresh-token",
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
  validationStatus: "valid" | "invalid" = "valid",
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
    validationStatus,
  };
}

async function mockWellnessApi(
  page: Page,
  selectedAnswers: QuestionnaireAnswers = answers,
  completeness: "complete" | "provisional" = "complete",
  validationStatus: "valid" | "invalid" = "valid",
) {
  const requests: Array<{ body: unknown; method: string; path: string }> = [];
  let currentStatus: "active" | "draft" = "draft";
  let currentAggregateVersion = 1;
  await page.route("http://127.0.0.1:54321/functions/v1/access/**", (route) =>
    route.fulfill({
      body: JSON.stringify([
        {
          accessScope: "owner",
          alias: "Perfil bienestar",
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
    const body: unknown = request.postData() ? request.postDataJSON() : null;
    requests.push({ body, method: request.method(), path });

    if (
      path.endsWith(`/v1/profiles/${profileId}/draft`) &&
      request.method() === "GET"
    ) {
      await route.fulfill({
        body: JSON.stringify({
          answers: selectedAnswers,
          completeness,
          confirmedBlockIds: [
            "core",
            "goals",
            "modules",
            "hydration",
            "sleep",
            "supplements",
            "labs",
            "summary",
          ],
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
          schemaVersion: 2,
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
        body: JSON.stringify(mutationAck("draft", 1, completeness, validationStatus)),
        contentType: "application/json",
        status: 201,
      });
      return;
    }
    if (path.endsWith(`/v1/plans/${planId}/versions`) && request.method() === "GET") {
      await route.fulfill({
        body: JSON.stringify({
          activeVersionId: currentStatus === "active" ? planVersionId : null,
          aggregateVersion: currentAggregateVersion,
          planId,
          profileId,
          versions: [
            {
              activatedAt: currentStatus === "active" ? createdAt : null,
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
              validationStatus,
            },
          ],
        }),
        contentType: "application/json",
        status: 200,
      });
      return;
    }
    if (path.endsWith(`/v1/plans/${planId}/versions/${planVersionId}`)) {
      const hydration = generateHydrationPlan(selectedAnswers);
      const sleep = generateSleepPlan(selectedAnswers);
      const supplements = generateSupplementsPlan(selectedAnswers);
      const moduleResults = [
        {
          confidence: "high",
          createdAt,
          id: "56000000-0000-4000-8000-000000001201",
          module: "hydration",
          payload: hydration,
          status: hydration.status === "provisional" ? "provisional" : "valid",
          uncertainties: hydration.uncertainties,
        },
        {
          confidence: "medium",
          createdAt,
          id: "56000000-0000-4000-8000-000000001202",
          module: "sleep",
          payload: sleep,
          status: sleep.status === "provisional" ? "provisional" : "valid",
          uncertainties: sleep.uncertainties,
        },
        {
          confidence: "high",
          createdAt,
          id: "56000000-0000-4000-8000-000000001203",
          module: "supplements",
          payload: supplements,
          status: supplements.status === "provisional" ? "provisional" : "valid",
          uncertainties: supplements.uncertainties,
        },
      ];
      const detail = PlanVersionDetailSchema.parse({
        activatedAt: currentStatus === "active" ? createdAt : null,
        archivedAt: null,
        canonicalizationVersion: "canonical-json-v1",
        completeness,
        contextSnapshotId,
        createdAt,
        engineVersion: "engine-v3",
        hashAlgorithm: "sha256",
        id: planVersionId,
        inputHash: "a".repeat(64),
        moduleResults,
        ordinal: 1,
        outputHash: "b".repeat(64),
        planId,
        ruleSetRevisionId: "04edd58c-5fff-4f6b-85ad-472ec538885c",
        safetyFindings: [],
        sourceManifestId: "90000000-0000-4000-8000-000000000001",
        status: currentStatus,
        validatedAt: createdAt,
        validation: { status: "valid" },
        validationStatus,
      });
      await route.fulfill({
        body: JSON.stringify(detail),
        contentType: "application/json",
        status: 200,
      });
      return;
    }
    if (path.endsWith(`/v1/plans/${planId}/versions/${planVersionId}/activate`)) {
      currentStatus = "active";
      currentAggregateVersion = 2;
      await route.fulfill({
        body: JSON.stringify(mutationAck("active", 2, completeness, validationStatus)),
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
  return requests;
}

test("muestra y activa el plan de bienestar sin exponer contexto privado", async ({
  page,
}) => {
  await installSession(page);
  const requests = await mockWellnessApi(page);
  await page.goto("/wellness");

  await expect(
    page.getByRole("heading", { name: "Hidratación, sueño y suplementos" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Generar bienestar" }).click();

  await expect(page.getByText("Agua total de referencia")).toBeVisible();
  await expect(page.getByText("2500 ml", { exact: true }).first()).toBeVisible();
  await expect(page.getByText(/Recordatorios:/)).toContainText("desactivados");
  await expect(page.getByText(/Electrolitos:/)).toContainText("no indicados");

  await expect(page.getByText("7–9 h", { exact: true })).toBeVisible();
  await expect(page.getByText("Percepción manual")).toBeVisible();
  await expect(page.getByText(/estimaciones manuales/).first()).toBeVisible();
  await expect(page.getByText(/no diagnóstico/i).first()).toBeVisible();

  await expect(page.getByRole("heading", { name: "Vitamina B12" })).toBeVisible();
  await expect(page.getByText("175 pg/mL")).toBeVisible();
  await expect(page.getByText("Marca privada que no debe aparecer")).toHaveCount(0);
  await page.getByText("Opciones experimentales", { exact: true }).click();
  await expect(page.getByRole("heading", { name: "Glicina" })).toBeVisible();
  await expect(page.getByText("Limitada / Baja").first()).toBeVisible();
  await expect(page.getByText("SARMs", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Activar plan" }).click();
  await expect(page.getByRole("button", { name: "Plan activo" })).toBeVisible();
  expect(requests.some(({ path }) => path.endsWith("/activate"))).toBe(true);
});

test("mantiene un resultado provisional accesible sin inventar una banda", async ({
  page,
}) => {
  const provisionalAnswers: QuestionnaireAnswers = { ...answers };
  delete provisionalAnswers.habitualWaterMl;
  delete provisionalAnswers.hydrationFluidRestriction;
  delete provisionalAnswers.sleepHours;
  delete provisionalAnswers.sleepQuality;
  delete provisionalAnswers.sleepRegularity;
  await installSession(page);
  await mockWellnessApi(page, provisionalAnswers, "provisional");
  await page.goto("/wellness");

  await expect(page.getByRole("main")).toBeVisible();
  await expect(page.getByLabel("Perfil")).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Revisar cuestionario" }),
  ).toHaveAttribute("href", "/questionnaire");
  await page.getByRole("button", { name: "Generar bienestar" }).click();
  await expect(page.getByText("PLAN PROVISIONAL")).toBeVisible();
  await expect(page.getByText("Sin cifra operativa")).toBeVisible();
  await expect(
    page.getByText(/Falta confirmar si existe una restricción/),
  ).toBeVisible();
  await expect(page.getByText("Parcial", { exact: true }).first()).toBeVisible();
  await expect(
    page.getByText("Revisión prioritaria", { exact: true }).first(),
  ).toBeVisible();
  await expect(
    page.getByText(/datos o restricciones pendientes/).first(),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Activar plan" })).toBeEnabled();
  await page.keyboard.press("Tab");
  await expect(page.locator(":focus")).toBeVisible();
});

test("recarga la versión activa tras refrescar sin ofrecer otra generación", async ({
  page,
}) => {
  await installSession(page);
  const requests = await mockWellnessApi(page);
  await page.goto("/wellness");
  await page.getByRole("button", { name: "Generar bienestar" }).click();
  await page.getByRole("button", { name: "Activar plan" }).click();
  await expect(page.getByRole("button", { name: "Plan activo" })).toBeVisible();

  await page.reload();

  await expect(page.getByText("Agua total de referencia")).toBeVisible();
  await expect(page.getByRole("button", { name: "Plan activo" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Generar bienestar" })).toHaveCount(0);
  expect(
    requests.some(
      ({ method, path }) =>
        method === "GET" && path.endsWith(`/v1/plans/${planId}/versions`),
    ),
  ).toBe(true);
});

test("recarga el borrador tras refrescar y conserva la activación manual", async ({
  page,
}) => {
  await installSession(page);
  await mockWellnessApi(page);
  await page.goto("/wellness");
  await page.getByRole("button", { name: "Generar bienestar" }).click();
  await expect(page.getByRole("button", { name: "Activar plan" })).toBeEnabled();

  await page.reload();

  await expect(page.getByText("Agua total de referencia")).toBeVisible();
  await expect(page.getByRole("button", { name: "Activar plan" })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Generar bienestar" })).toHaveCount(0);
});

test("descarta y bloquea una versión marcada inválida", async ({ page }) => {
  await installSession(page);
  await mockWellnessApi(page, answers, "complete", "invalid");
  await page.goto("/wellness");
  await page.getByRole("button", { name: "Generar bienestar" }).click();

  await expect(page.getByRole("alert")).toContainText("no supera la validación");
  await expect(page.getByText("Agua total de referencia")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Activar plan" })).toBeDisabled();
  await expect(page.getByText("RESULTADO DESCARTADO").first()).toBeVisible();
});
