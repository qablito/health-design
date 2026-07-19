import { expect, test, type Page } from "@playwright/test";

import { PlanVersionDetailSchema } from "@health-design/contracts";
import type { QuestionnaireAnswers } from "@health-design/domain";
import { generateMobilityPlan, generateTrainingPlan } from "@health-design/engine";

const userId = "00000000-0000-4000-8000-000000001101";
const sessionId = "21000000-0000-4000-8000-000000001101";
const profileId = "51000000-0000-4000-8000-000000001101";
const draftId = "71000000-0000-4000-8000-000000001101";
const contextSnapshotId = "52000000-0000-4000-8000-000000001101";
const planId = "53000000-0000-4000-8000-000000001101";
const planVersionId = "54000000-0000-4000-8000-000000001101";
const createdAt = "2026-07-19T10:00:00.000Z";

const generatedAnswers = {
  activeModules: ["training", "mobility"],
  activityLevel: "moderate",
  age: 35,
  country: "ES",
  dailySchedule: "regular",
  generatedTrainingDaysPerWeek: 2,
  generatedTrainingEquipment: ["none"],
  generatedTrainingExperience: "beginner",
  generatedTrainingSessionMinutes: 30,
  generatedTrainingStyles: ["bodyweight"],
  hasConditions: false,
  hasMedications: false,
  heightCm: 175,
  mobilityAreas: ["hips", "shoulders"],
  mobilityAnchors: ["after_training", "morning"],
  mobilityDiscomfortStatus: "none",
  mobilityMinutes: 15,
  physiologicalSex: "male",
  primaryObjective: "performance_strength",
  trainingLimitationsStatus: "none",
  trainingMode: "generated",
  weightKg: 80,
} satisfies QuestionnaireAnswers;

const ownAnswers = {
  ...generatedAnswers,
  activeModules: ["training"],
  ownTrainingDaysPerWeek: 3,
  ownTrainingAnchors: ["afternoon"],
  ownTrainingIntensity: "moderate",
  ownTrainingSessionMinutes: 45,
  ownTrainingTypes: ["bodyweight"],
  trainingMode: "own",
} satisfies QuestionnaireAnswers;

const noTrainingAnswers = {
  ...generatedAnswers,
  activeModules: ["training"],
  trainingMode: "none",
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
    refresh_token: "training-refresh-token",
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

function mutationAck(status: "active" | "draft", aggregateVersion: number) {
  return {
    activatedAt: status === "active" ? "2026-07-19T10:05:00.000Z" : null,
    activeVersionId: status === "active" ? planVersionId : null,
    aggregateVersion,
    archivedAt: null,
    completeness: "complete",
    contextSnapshotId,
    createdAt,
    ordinal: 1,
    planId,
    planVersionId,
    status,
    validationStatus: "valid",
  };
}

async function mockTrainingApi(page: Page, answers: QuestionnaireAnswers) {
  const requests: Array<{ method: string; path: string }> = [];
  await page.route("http://127.0.0.1:54321/functions/v1/access/**", (route) =>
    route.fulfill({
      body: JSON.stringify([
        {
          accessScope: "owner",
          alias: "Perfil movimiento",
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
    requests.push({ method: request.method(), path });

    if (
      path.endsWith(`/v1/profiles/${profileId}/draft`) &&
      request.method() === "GET"
    ) {
      await route.fulfill({
        body: JSON.stringify({
          answers,
          completeness: "complete",
          confirmedBlockIds: ["core", "goals", "modules", "training"],
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
          completeness: "complete",
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
      await route.fulfill({
        body: JSON.stringify(mutationAck("draft", 1)),
        contentType: "application/json",
        status: 201,
      });
      return;
    }
    if (path.endsWith(`/v1/plans/${planId}/versions/${planVersionId}`)) {
      const training = generateTrainingPlan(answers);
      const moduleResults = [
        {
          confidence:
            "completeness" in training && training.completeness === "provisional"
              ? "medium"
              : "high",
          createdAt,
          id: "56000000-0000-4000-8000-000000001101",
          module: "training",
          payload:
            training.mode === "none"
              ? { reason: "training_disabled_by_user" }
              : training,
          status: training.mode === "none" ? "not_requested" : "valid",
          uncertainties: "uncertainties" in training ? training.uncertainties : [],
        },
        ...(answers.activeModules?.includes("mobility")
          ? [
              {
                confidence: "high",
                createdAt,
                id: "56000000-0000-4000-8000-000000001102",
                module: "mobility",
                payload: generateMobilityPlan(answers),
                status: "valid",
                uncertainties: [],
              },
            ]
          : []),
      ];
      const detail = PlanVersionDetailSchema.parse({
        activatedAt: null,
        archivedAt: null,
        canonicalizationVersion: "canonical-json-v1",
        completeness: "complete",
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
        sourceManifestId: "cb644399-1275-47de-86b6-195711946f66",
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
    if (path.endsWith(`/v1/plans/${planId}/versions/${planVersionId}/activate`)) {
      await route.fulfill({
        body: JSON.stringify(mutationAck("active", 2)),
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

test("muestra un plan accesible de cuatro semanas, movilidad modular y activación manual", async ({
  page,
}) => {
  await installSession(page);
  const requests = await mockTrainingApi(page, generatedAnswers);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/training");

  await expect(page).toHaveTitle(/Entrenamiento y movilidad/);
  await expect(
    page.getByRole("heading", { name: "Entrenamiento y movilidad" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Generar plan de movimiento" }).click();
  await expect(
    page.getByRole("heading", { name: "Versión 1 lista para revisar" }),
  ).toBeFocused();
  await expect(page.locator(".movement-announcement")).toHaveText(
    "Plan de movimiento generado y listo para revisar.",
  );
  await expect(
    page.getByRole("heading", { name: "Bloque de 4 semanas" }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { level: 3, name: "Semana 1" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 5 }).first()).toBeVisible();
  await expect(page.getByText("Semana 4", { exact: true })).toBeVisible();
  await expect(page.getByRole("img", { name: /Secuencia/ }).first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "Movilidad diaria" })).toBeVisible();

  await page.getByRole("button", { exact: true, name: "5 min" }).click();
  await expect(page.getByText("Extensión de zonas prioritarias")).toBeHidden();
  await page.getByRole("button", { exact: true, name: "15 min" }).click();
  await expect(page.getByText("Extensión global opcional")).toBeVisible();

  const weekSummary = page.locator("details.training-week > summary").first();
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  for (let index = 0; index < 10; index += 1) {
    await page.keyboard.press("Tab");
    if (await weekSummary.evaluate((node) => node === document.activeElement)) break;
  }
  await expect(weekSummary).toBeFocused();
  expect(
    await weekSummary.evaluate((node) => getComputedStyle(node).outlineWidth),
  ).toBe("3px");
  await page.keyboard.press("Enter");
  await expect(page.locator("details.training-week").first()).not.toHaveAttribute(
    "open",
    "",
  );
  expect(
    await weekSummary.evaluate((node) =>
      Number.parseFloat(getComputedStyle(node).transitionDuration),
    ),
  ).toBeLessThanOrEqual(0.001);

  await page.setViewportSize({ height: 780, width: 360 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "Activar plan" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: "Plan activo" })).toBeVisible();
  await expect(page.locator(".movement-announcement")).toHaveText(
    "Plan activo. Esta versión ya es la seleccionada.",
  );
  expect(requests.some(({ path }) => path.endsWith("/activate"))).toBe(true);
});

test("mantiene la explicación textual cuando un activo visual no carga", async ({
  page,
}) => {
  await installSession(page);
  await mockTrainingApi(page, generatedAnswers);
  await page.route("**/assets/exercises/*.svg", (route) => route.abort());
  await page.goto("/training");
  await page.getByRole("button", { name: "Generar plan de movimiento" }).click();

  await expect(page.getByRole("img", { name: /Secuencia/ }).first()).toContainText(
    "Guía visual no disponible",
  );
  expect(
    await page.locator(".exercise-steps").first().getByRole("listitem").count(),
  ).toBeGreaterThanOrEqual(2);
});

for (const scenario of [
  {
    answers: ownAnswers,
    expected: "Tu entrenamiento se mantiene",
    name: "entrenamiento propio",
  },
  {
    answers: noTrainingAnswers,
    expected: "Sin rutina de entrenamiento",
    name: "entrenamiento desactivado",
  },
] as const) {
  test(`respeta el estado ${scenario.name} sin inventar sesiones`, async ({ page }) => {
    await installSession(page);
    await mockTrainingApi(page, scenario.answers);
    await page.goto("/training");
    await page.getByRole("button", { name: "Generar plan de movimiento" }).click();

    await expect(page.getByRole("heading", { name: scenario.expected })).toBeVisible();
    await expect(page.getByText("Semana 1", { exact: true })).toHaveCount(0);
  });
}
