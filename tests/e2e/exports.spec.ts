import { expect, test, type Page } from "@playwright/test";

import { PlanVersionDetailSchema } from "@health-design/contracts";
import type { QuestionnaireAnswers } from "@health-design/domain";
import { generateNutritionWeek } from "@health-design/engine";
import { effectiveNutritionFoods } from "@health-design/test-fixtures/nutrition-plan";

const userId = "00000000-0000-4000-8000-000000001501";
const sessionId = "21000000-0000-4000-8000-000000001501";
const profileId = "51000000-0000-4000-8000-000000001501";
const contextSnapshotId = "52000000-0000-4000-8000-000000001501";
const planId = "53000000-0000-4000-8000-000000001501";
const planVersionId = "54000000-0000-4000-8000-000000001501";
const artifactId = "55000000-0000-4000-8000-000000001501";
const createdAt = "2026-07-20T17:15:00.000Z";

const answers = {
  activeModules: ["nutrition"],
  activityLevel: "moderate" as const,
  age: 35,
  country: "ES" as const,
  dietaryPattern: "omnivore" as const,
  hasConditions: false,
  hasMedications: false,
  heightCm: 175,
  mealsPerDay: 4,
  nutritionAllergiesStatus: "none" as const,
  nutritionFoodAnxiety: "no" as const,
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

async function installSession(page: Page) {
  const now = Math.floor(Date.now() / 1_000);
  await page.addInitScript(
    ({ session, timestamp }) => {
      window.localStorage.setItem("sb-127-auth-token", JSON.stringify(session));
      Object.defineProperty(window, "print", {
        configurable: true,
        value: () => document.documentElement.setAttribute("data-printed", timestamp),
      });
    },
    {
      session: {
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
        refresh_token: "export-refresh-token",
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
      },
      timestamp: createdAt,
    },
  );
}

async function mockApplication(page: Page) {
  const exports: unknown[] = [];
  let requestedFormat: "pdf" | "xlsx" = "pdf";
  await page.route("http://127.0.0.1:54321/functions/v1/access/**", (route) =>
    route.fulfill({
      body: JSON.stringify([
        {
          accessScope: "owner",
          alias: "Perfil exportable",
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
    if (path.endsWith(`/v1/profiles/${profileId}/plans/current`)) {
      await route.fulfill({
        body: JSON.stringify({
          activeVersionId: planVersionId,
          aggregateVersion: 2,
          planId,
          profileId,
          versions: [
            {
              activatedAt: createdAt,
              archivedAt: null,
              canonicalizationVersion: "canonical-json-v1",
              completeness: "complete",
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
              status: "active",
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
    if (path.endsWith(`/v1/plans/${planId}/versions/${planVersionId}`)) {
      const detail = PlanVersionDetailSchema.parse({
        activatedAt: createdAt,
        archivedAt: null,
        canonicalizationVersion: "canonical-json-v1",
        completeness: "complete",
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
            id: "56000000-0000-4000-8000-000000001501",
            module: "nutrition",
            payload: nutritionWeek,
            status: "valid",
            uncertainties: [],
          },
        ],
        ordinal: 1,
        outputHash: "b".repeat(64),
        planId,
        ruleSetRevisionId: "04edd58c-5fff-4f6b-85ad-472ec538885c",
        safetyFindings: [],
        sourceManifestId: "90000000-0000-4000-8000-000000000001",
        status: "active",
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
    await route.fulfill({ status: 404 });
  });
  await page.route("http://127.0.0.1:54321/functions/v1/exports/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path.endsWith(`/v1/plans/${planVersionId}/exports`)) {
      const body = request.postDataJSON() as Record<string, unknown>;
      exports.push(body);
      requestedFormat = body.format === "xlsx" ? "xlsx" : "pdf";
      await route.fulfill({
        body: JSON.stringify({
          artifactId,
          createdAt,
          detail: body.detail,
          format: body.format,
          planVersionId,
          presentation: body.presentation,
          schemaVersion: 1,
          status: "ready",
        }),
        contentType: "application/json",
        status: 200,
      });
      return;
    }
    if (path.endsWith(`/v1/exports/${artifactId}/content`)) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      await route.fulfill({
        body: requestedFormat === "xlsx" ? "PK" : "%PDF-1.7",
        contentType:
          requestedFormat === "xlsx"
            ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            : "application/pdf",
        status: 200,
      });
      return;
    }
    await route.fulfill({ status: 404 });
  });
  return exports;
}

test("exporta elecciones actuales y mantiene impresión, PDF y XLSX en el mismo orden", async ({
  page,
}) => {
  await installSession(page);
  const requests = await mockApplication(page);
  await page.goto("/nutrition");

  await expect(page.getByRole("region", { name: "Exportar el plan" })).toBeVisible();
  await page.getByRole("radio", { name: "Completo" }).check();
  await page.getByRole("radio", { name: "Preparación breve en archivo" }).check();
  await page.getByRole("radio", { name: "Un día" }).check();
  await page.getByLabel("Día que quieres exportar").selectOption("1");
  await expect(page.getByLabel("Añadir preparación semanal")).toBeDisabled();

  await page
    .getByRole("combobox", { name: /^Sustituir / })
    .first()
    .selectOption("1");
  const pdfButton = page.getByRole("button", { name: /PDF/ });
  const pdfDownload = page.waitForEvent("download");
  await pdfButton.click();
  await expect(pdfButton).toHaveText("Preparando PDF…");
  await expect(pdfButton).toBeDisabled();
  await pdfDownload;
  await expect(
    page.getByRole("status").filter({ hasText: "PDF preparado" }),
  ).toContainText("PDF preparado y descargado");

  expect(requests[0]).toMatchObject({
    choices: [[0, 0, 0, 1]],
    detail: "complete",
    format: "pdf",
    includeWeeklyPreparation: false,
    presentation: "preparation",
    range: { day: 1, kind: "day" },
  });

  const xlsxButton = page.getByRole("button", { name: /XLSX/ });
  const xlsxDownload = page.waitForEvent("download");
  await xlsxButton.click();
  await expect(xlsxButton).toHaveText("Preparando XLSX…");
  await expect(xlsxButton).toBeDisabled();
  await xlsxDownload;
  await expect(
    page.getByRole("status").filter({ hasText: "XLSX preparado" }),
  ).toContainText("XLSX preparado y descargado");
  expect(requests[1]).toMatchObject({
    choices: [[0, 0, 0, 1]],
    detail: "complete",
    format: "xlsx",
    presentation: "preparation",
    range: { day: 1, kind: "day" },
  });

  await page.getByRole("button", { name: "Imprimir" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-printed", createdAt);
  const screenRows = await page.locator(".nutrition-days .food-row").count();
  const printRows = await page.locator(".export-print-sheet tbody tr").count();
  expect(printRows).toBeGreaterThan(0);
  expect(printRows).toBeLessThan(screenRows);
  await page.emulateMedia({ media: "print" });
  await expect(page.locator(".nutrition-header")).toBeHidden();
  await expect(page.locator(".export-grid")).toBeHidden();
  await expect(page.locator(".export-print-sheet")).toBeVisible();
  await page.emulateMedia({ media: "screen" });
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain(
    nutritionWeek.days[0]!.meals[0]!.foods[0]!.name,
  );
});

test("panel accesible expone controles nativos, estados y alcance semanal por teclado", async ({
  page,
}) => {
  await installSession(page);
  await mockApplication(page);
  await page.goto("/nutrition");

  const range = page.getByRole("group", { name: "Periodo" });
  const week = page.getByRole("radio", { name: "Semana completa" });
  const day = page.getByRole("radio", { name: "Un día" });
  await expect(range).toBeVisible();
  await expect(week).toBeChecked();
  await week.focus();
  await page.keyboard.press("ArrowRight");
  await expect(day).toBeChecked();
  await page.keyboard.press("ArrowLeft");
  await expect(week).toBeChecked();

  await page.getByLabel("Añadir preparación semanal").check();
  await expect(page.getByRole("button", { name: "Descargar XLSX" })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Imprimir" })).toBeEnabled();
});
