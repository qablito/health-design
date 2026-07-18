import { expect, test, type Page } from "@playwright/test";

import { QUESTIONNAIRE_PUBLIC_SCHEMA_V1 } from "@health-design/contracts";
import { evaluateQuestionnaire } from "@health-design/domain";

const userId = "00000000-0000-4000-8000-000000000902";
const sessionId = "21000000-0000-4000-8000-000000000902";
const profileId = "51000000-0000-4000-8000-000000000902";
const draftId = "71000000-0000-4000-8000-000000000902";

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
    refresh_token: "questionnaire-refresh-token",
    token_type: "bearer",
    user: {
      app_metadata: { provider: "anonymous", providers: ["anonymous"] },
      aud: "authenticated",
      created_at: new Date().toISOString(),
      id: userId,
      is_anonymous: true,
      role: "authenticated",
      updated_at: new Date().toISOString(),
      user_metadata: {},
    },
  };
}

async function installSession(page: Page) {
  await page.addInitScript((session) => {
    window.localStorage.setItem("sb-127-auth-token", JSON.stringify(session));
  }, browserSession());
}

async function mockQuestionnaire(page: Page) {
  let draft: Record<string, unknown> | null = null;
  let version = 0;
  let failNextSave = false;
  await page.route("http://127.0.0.1:54321/functions/v1/access/**", (route) =>
    route.fulfill({
      body: JSON.stringify([
        { accessScope: "owner", alias: "Perfil T6", profileId, status: "active" },
      ]),
      contentType: "application/json",
      status: 200,
    }),
  );
  await page.route("http://127.0.0.1:54321/functions/v1/plans/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path.endsWith("/v1/questionnaire/schema")) {
      await route.fulfill({
        body: JSON.stringify(QUESTIONNAIRE_PUBLIC_SCHEMA_V1),
        contentType: "application/json",
        status: 200,
      });
      return;
    }
    if (request.method() === "GET") {
      await route.fulfill({
        body: JSON.stringify(draft),
        contentType: "application/json",
        status: 200,
      });
      return;
    }
    if (failNextSave) {
      failNextSave = false;
      await route.abort("internetdisconnected");
      return;
    }
    const body = request.postDataJSON() as {
      answers?: Record<string, unknown>;
      confirmedBlockIds?: string[];
      currentBlockId?: string;
    };
    const answers = body.answers ?? (draft?.answers as Record<string, unknown>);
    const evaluation = evaluateQuestionnaire(answers ?? {});
    version += 1;
    const ack = {
      completeness: evaluation.completeness,
      confirmedBlockIds:
        body.confirmedBlockIds ?? (draft?.confirmedBlockIds as string[]) ?? [],
      currentBlockId: body.currentBlockId ?? draft?.currentBlockId ?? "summary",
      hardErrors: evaluation.hardErrors,
      profileId,
      schemaVersion: 1,
      status: path.endsWith("/submit") ? "submitted" : "editing",
      uncertainties: evaluation.uncertainties,
      updatedAt: new Date().toISOString(),
      version,
    };
    draft = { ...ack, answers, id: draftId };
    await route.fulfill({
      body: JSON.stringify(ack),
      contentType: "application/json",
      status: 200,
    });
  });
  return { failNextSave: () => (failNextSave = true) };
}

test("reanuda, ramifica, edita el resumen y no persiste respuestas clínicas", async ({
  page,
}) => {
  await installSession(page);
  await mockQuestionnaire(page);
  await page.goto("/questionnaire");

  await expect(
    page.getByRole("heading", { name: "Tu contexto, paso a paso" }),
  ).toBeVisible();
  await page.getByLabel("Edad").fill("35");
  await page.getByLabel("Sexo fisiológico").selectOption("male");
  await page.getByLabel("Altura (cm)").fill("175");
  await page.getByLabel("Peso (kg)").fill("80");
  await page.getByLabel("Actividad cotidiana").selectOption("moderate");
  await page.getByLabel("Horario habitual").selectOption("regular");
  await page.getByRole("button", { name: "Continuar" }).click();
  await expect(page.getByRole("heading", { name: "Objetivos" })).toBeVisible();

  await page.reload();
  await expect(page.getByRole("heading", { name: "Objetivos" })).toBeVisible();
  await page.getByLabel("Objetivo principal").selectOption("body_composition_lose_fat");
  await page.getByRole("button", { name: "Continuar" }).click();
  await page.getByLabel("Alimentación").check();
  await page.getByLabel("Sueño y descanso").check();
  await page.getByRole("button", { name: "Continuar" }).click();

  await page.getByLabel("Comidas al día").fill("4");
  await page.getByLabel("Alergias y contaminación cruzada").selectOption("none");
  await page.getByLabel("Intolerancias").selectOption("none");
  await page.getByLabel("Ansiedad alimentaria").selectOption("no");
  await page.getByLabel("Preferencia de proteína").selectOption("food_only");
  await page.getByLabel("Supermercado habitual (opcional)").fill("Mercadona");
  await page
    .getByLabel("Comparar precios con otros supermercados")
    .selectOption("true");
  await page.getByLabel("Alimentos preferidos").fill("alimento-secreto-e2e");
  await page.getByRole("button", { name: "Añadir alimento preferido" }).click();
  await page.getByRole("button", { name: "Continuar" }).click();

  await page.getByLabel("Relación actual con el entrenamiento").selectOption("none");
  await expect(page.getByLabel("Estilos preferidos")).toHaveCount(0);
  await page.getByRole("button", { name: "Continuar" }).click();

  await page.getByLabel("Horas de sueño").fill("7.5");
  await page.getByLabel("Regularidad del sueño").selectOption("regular");
  await page.getByLabel("Calidad percibida").selectOption("good");
  await page.getByRole("button", { name: "Continuar" }).click();

  await page
    .getByLabel("Tienes condiciones o enfermedades declaradas")
    .selectOption("false");
  await page
    .getByLabel("Tomas medicación o tratamientos hormonales")
    .selectOption("false");
  await page.getByRole("button", { name: "Continuar" }).click();
  await page.getByLabel("Quieres añadir analíticas manuales").selectOption("false");
  await page.getByRole("button", { name: "Continuar" }).click();

  await expect(page.getByRole("heading", { name: "Resumen" })).toBeVisible();
  await expect(page.getByText("alimento-secreto-e2e")).toBeVisible();
  await page.getByRole("button", { name: "Editar Objetivos" }).click();
  await expect(page.getByLabel("Objetivo principal")).toHaveValue(
    "body_composition_lose_fat",
  );

  const leaked = await page.evaluate(async () => {
    const local = Array.from({ length: localStorage.length }, (_, index) => {
      const key = localStorage.key(index);
      return key ? `${key}:${localStorage.getItem(key)}` : "";
    }).join("\n");
    const databases = indexedDB.databases ? await indexedDB.databases() : [];
    const cacheNames = "caches" in window ? await caches.keys() : [];
    return { cacheNames, databases, local, url: location.href };
  });
  expect(JSON.stringify(leaked)).not.toContain("alimento-secreto-e2e");
});

test("un fallo de red conserva el cambio solo en memoria y recarga lo remoto", async ({
  page,
}) => {
  await installSession(page);
  const remote = await mockQuestionnaire(page);
  await page.goto("/questionnaire");
  await page.getByLabel("Edad").fill("35");
  await page.getByLabel("Sexo fisiológico").selectOption("male");
  await page.getByLabel("Altura (cm)").fill("175");
  await page.getByLabel("Peso (kg)").fill("80");
  await page.getByLabel("Actividad cotidiana").selectOption("moderate");
  await page.getByLabel("Horario habitual").selectOption("regular");
  await page.getByRole("button", { name: "Continuar" }).click();

  await page.getByLabel("Objetivo principal").selectOption("wellbeing_energy");
  remote.failNextSave();
  await page.getByRole("button", { name: "Continuar" }).click();
  await expect(page.getByRole("alert")).toContainText("conexión");
  await expect(page.getByLabel("Objetivo principal")).toHaveValue("wellbeing_energy");

  await page.reload();
  await expect(page.getByRole("heading", { name: "Objetivos" })).toBeVisible();
  await expect(page.getByLabel("Objetivo principal")).toHaveValue("");
  const persisted = await page.evaluate(() => JSON.stringify(localStorage));
  expect(persisted).not.toContain("wellbeing_energy");
});

test("confirmar otra sección no arrastra una edición todavía no confirmada", async ({
  page,
}) => {
  await installSession(page);
  await mockQuestionnaire(page);
  await page.goto("/questionnaire");
  await page.getByLabel("Edad").fill("35");
  await page.getByLabel("Sexo fisiológico").selectOption("male");
  await page.getByLabel("Altura (cm)").fill("175");
  await page.getByLabel("Peso (kg)").fill("80");
  await page.getByLabel("Actividad cotidiana").selectOption("moderate");
  await page.getByLabel("Horario habitual").selectOption("regular");
  await page.getByRole("button", { name: "Continuar" }).click();

  await page.getByLabel("Objetivo principal").selectOption("wellbeing_energy");
  await page.getByRole("button", { name: "Anterior" }).click();
  await page.getByRole("button", { name: "Continuar" }).click();

  await expect(page.getByRole("heading", { name: "Objetivos" })).toBeVisible();
  await expect(page.getByLabel("Objetivo principal")).toHaveValue("");
  await page.reload();
  await expect(page.getByLabel("Objetivo principal")).toHaveValue("");
});

test("expone un primer paso accesible por teclado y adaptable a móvil", async ({
  page,
}) => {
  await page.setViewportSize({ height: 780, width: 360 });
  await installSession(page);
  await mockQuestionnaire(page);
  await page.goto("/questionnaire");

  await expect(
    page.getByRole("region", { name: "Progreso del cuestionario" }),
  ).toBeVisible();
  await expect(page.getByRole("progressbar")).toHaveAttribute("max", "7");
  await page.getByLabel("Edad").focus();
  await expect(page.getByLabel("Edad")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByLabel("Sexo fisiológico")).toBeFocused();

  const unnamedControls = await page
    .locator("input, select, button")
    .evaluateAll((controls) =>
      controls
        .filter((control) => {
          const element = control as HTMLInputElement;
          const labelled = element.labels && element.labels.length > 0;
          return (
            !labelled &&
            !element.getAttribute("aria-label") &&
            !element.getAttribute("aria-labelledby") &&
            !element.textContent?.trim()
          );
        })
        .map((control) => control.outerHTML),
    );
  expect(unnamedControls).toEqual([]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});
