import { expect, test, type Page } from "@playwright/test";

const userId = "00000000-0000-4000-8000-000000001301";
const sessionId = "21000000-0000-4000-8000-000000001301";
const profileId = "51000000-0000-4000-8000-000000001301";
const planId = "53000000-0000-4000-8000-000000001301";
const versionId = "54000000-0000-4000-8000-000000001301";
const candidateVersionId = "54000000-0000-4000-8000-000000001302";
const contextId = "52000000-0000-4000-8000-000000001301";
const candidateContextId = "52000000-0000-4000-8000-000000001302";
const candidateId = "55000000-0000-4000-8000-000000001301";
const changeEventId = "56000000-0000-4000-8000-000000001301";
const createdAt = "2026-07-20T08:00:00.000Z";
const screenshotDirectory = process.env["T13_SCREENSHOT_DIR"];

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
    refresh_token: "follow-up-refresh-token",
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

function planVersion() {
  return {
    activatedAt: createdAt,
    archivedAt: null,
    canonicalizationVersion: "canonical-json-v1",
    completeness: "complete",
    contextSnapshotId: contextId,
    createdAt,
    engineVersion: "engine-v3",
    hashAlgorithm: "sha256",
    id: versionId,
    inputHash: "a".repeat(64),
    ordinal: 1,
    outputHash: "b".repeat(64),
    planId,
    ruleSetRevisionId: "57000000-0000-4000-8000-000000001301",
    sourceManifestId: "58000000-0000-4000-8000-000000001301",
    status: "active",
    validatedAt: createdAt,
    validation: { status: "valid" },
    validationStatus: "valid",
  } as const;
}

function moduleResult(
  module: "nutrition" | "training" | "hydration" | "sleep" | "mobility" | "supplements",
  index: number,
  status: "valid" | "not_requested" = "valid",
) {
  return {
    confidence: status === "valid" ? "high" : "unknown",
    createdAt,
    id: `59000000-0000-4000-8000-${String(1301 + index).padStart(12, "0")}`,
    module,
    payload: {},
    status,
    uncertainties: [],
  } as const;
}

function candidate(status: "pending" | "activated" = "pending") {
  return {
    activatedAt: status === "activated" ? createdAt : null,
    activeVersionId: status === "activated" ? candidateVersionId : versionId,
    aggregateVersion: status === "activated" ? 3 : 2,
    archivedAt: null,
    baseVersionId: versionId,
    candidateId,
    candidateStatus: status,
    changeEventId,
    completeness: "complete",
    contextSnapshotId: candidateContextId,
    createdAt,
    diff: { affectedModules: ["supplements"], changedFields: ["labValues"] },
    impact: "module_only",
    ordinal: 2,
    planId,
    planVersionId: candidateVersionId,
    resolvedAt: status === "activated" ? createdAt : null,
    status: status === "activated" ? "active" : "draft",
    validation: { completeness: "complete" },
    validationStatus: "valid",
  } as const;
}

async function mockFollowUpApi(page: Page) {
  const requests: Array<{
    body: unknown;
    headers: Record<string, string>;
    path: string;
  }> = [];
  let pending = false;
  let followUps: unknown[] = [];
  const previousLab = {
    analyte: "b12",
    confidence: "high",
    createdAt: "2026-06-01T08:00:00.000Z",
    id: "61000000-0000-4000-8000-000000001301",
    measuredFrom: "2026-06-01",
    measuredTo: "2026-06-01",
    measurement: { date: "2026-06-01", kind: "exact" },
    name: "Vitamina B12",
    profileId,
    referenceRange: { maximum: "900", minimum: "200", unit: "pg/mL" },
    source: "laboratory",
    unit: "pg/mL",
    value: "240",
  };
  let observations: unknown[] = [previousLab];
  let labItems: unknown[] = [
    {
      analyte: "b12",
      freshness: {
        ageDays: 49,
        confidence: "unknown",
        evidenceRef: null,
        reviewAfterDays: null,
        ruleId: null,
      },
      interpretation: "within_range",
      latestObservationId: previousLab.id,
      latestValue: "240",
      name: "Vitamina B12",
      trend: "insufficient",
      unit: "pg/mL",
    },
  ];

  await page.route("http://127.0.0.1:54321/functions/v1/access/**", (route) =>
    route.fulfill({
      body: JSON.stringify([
        {
          accessScope: "owner",
          alias: "Perfil seguimiento",
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
    requests.push({ body, headers: request.headers(), path });

    if (path.endsWith(`/v1/profiles/${profileId}/plans/current`)) {
      await route.fulfill({
        body: JSON.stringify({
          activeVersionId: versionId,
          aggregateVersion: pending ? 2 : 1,
          planId,
          profileId,
          versions: [planVersion()],
        }),
        contentType: "application/json",
        status: 200,
      });
      return;
    }

    if (path.endsWith(`/v1/plans/${planId}/versions/${versionId}`)) {
      await route.fulfill({
        body: JSON.stringify({
          ...planVersion(),
          moduleResults: [
            moduleResult("nutrition", 0),
            moduleResult("training", 1, "not_requested"),
            moduleResult("hydration", 2),
            moduleResult("sleep", 3),
            moduleResult("mobility", 4, "not_requested"),
            moduleResult("supplements", 5),
          ],
          safetyFindings: [],
        }),
        contentType: "application/json",
        status: 200,
      });
      return;
    }

    if (
      path.endsWith(`/v1/profiles/${profileId}/follow-ups`) &&
      request.method() === "GET"
    ) {
      await route.fulfill({
        body: JSON.stringify({
          entries: followUps,
          pendingCandidates: pending ? [candidate()] : [],
          profileId,
        }),
        contentType: "application/json",
        status: 200,
      });
      return;
    }

    if (
      path.endsWith(`/v1/profiles/${profileId}/follow-ups`) &&
      request.method() === "POST"
    ) {
      const payload = body as {
        basePlanVersionId: string;
        observedAt: string;
        requestRecalculation?: boolean;
        scope: "daily" | "weekly" | "four_week";
        values: unknown;
      };
      const entry = {
        basePlanVersionId: payload.basePlanVersionId,
        completeness: "complete",
        createdAt,
        id: `62000000-0000-4000-8000-${String(1301 + followUps.length).padStart(12, "0")}`,
        observedAt: payload.observedAt,
        planId,
        profileId,
        requestRecalculation: payload.requestRecalculation ?? false,
        scope: payload.scope,
        values: payload.values,
      };
      followUps = [entry, ...followUps];
      await route.fulfill({
        body: JSON.stringify({
          candidate: null,
          contextUpdateRequired: false,
          entry,
          impact: {
            affectedModules: [],
            candidateRequired: false,
            conservativeModules: [],
            impact: "unaffected",
            minorTrainingAdjustmentPercent: null,
            reasons: [],
          },
        }),
        contentType: "application/json",
        status: 200,
      });
      return;
    }

    if (path.endsWith(`/v1/profiles/${profileId}/labs`) && request.method() === "GET") {
      await route.fulfill({
        body: JSON.stringify({
          items: labItems,
          observations,
          pendingCandidates: pending ? [candidate()] : [],
          profileId,
        }),
        contentType: "application/json",
        status: 200,
      });
      return;
    }

    if (
      path.endsWith(`/v1/profiles/${profileId}/labs`) &&
      request.method() === "POST"
    ) {
      const payload = body as {
        observations: Array<{
          measurement: { date?: string; kind: string };
          referenceRange?: unknown;
          source: string;
          unit?: string;
          value: string;
        }>;
      };
      const posted = payload.observations[0]!;
      const newLab = {
        ...posted,
        analyte: "b12",
        confidence: "high",
        createdAt,
        id: "61000000-0000-4000-8000-000000001302",
        measuredFrom: posted.measurement.date ?? "2026-07-20",
        measuredTo: posted.measurement.date ?? "2026-07-20",
        name: "Vitamina B12",
        profileId,
      };
      observations = [previousLab, newLab];
      labItems = [
        {
          analyte: "b12",
          freshness: {
            ageDays: 0,
            confidence: "unknown",
            evidenceRef: null,
            reviewAfterDays: null,
            ruleId: null,
          },
          interpretation: "below_range",
          latestObservationId: newLab.id,
          latestValue: posted.value,
          name: "Vitamina B12",
          trend: "down",
          unit: "pg/mL",
        },
      ];
      pending = true;
      const history = {
        items: labItems,
        observations,
        pendingCandidates: [candidate()],
        profileId,
      };
      await route.fulfill({
        body: JSON.stringify({ candidate: candidate(), history }),
        contentType: "application/json",
        status: 200,
      });
      return;
    }

    if (path.endsWith(`/v1/candidates/${candidateId}/activate`)) {
      pending = false;
      await route.fulfill({
        body: JSON.stringify(candidate("activated")),
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

test.beforeEach(async ({ page }) => {
  await installSession(page);
});

test("muestra solo módulos activos y registra la revisión mínima", async ({ page }) => {
  const requests = await mockFollowUpApi(page);
  await page.goto("/follow-up");

  await expect(
    page.getByRole("heading", {
      name: "Registra lo importante. Cambia solo lo necesario.",
    }),
  ).toBeVisible();
  await expect(
    page.getByText("Alimentación · Hidratación · Sueño y descanso · Suplementación"),
  ).toBeVisible();
  if (screenshotDirectory) {
    await page.screenshot({
      fullPage: true,
      path: `${screenshotDirectory}/t13-follow-up-review.png`,
    });
  }
  await expect(page.locator('[data-module="training"]')).toHaveCount(0);
  await expect(page.locator('[data-module="mobility"]')).toHaveCount(0);

  await page.getByLabel("Adherencia general").selectOption("4");
  await page.getByRole("button", { name: "Guardar revisión semanal" }).click();
  await expect(
    page.getByText("No ha sido necesario cambiar el plan activo."),
  ).toBeVisible();
  await expect(page.getByText("Adherencia 4/5")).toBeVisible();

  const posted = requests.find(
    ({ body, path }) =>
      body !== null && path.endsWith(`/v1/profiles/${profileId}/follow-ups`),
  );
  expect(posted?.body).toMatchObject({
    basePlanVersionId: versionId,
    scope: "weekly",
    values: { common: { adherence: 4 } },
  });
  expect(JSON.stringify(posted?.body)).not.toContain("training");
});

test("mantiene el diario opcional y activa manualmente una propuesta analítica", async ({
  page,
}) => {
  const requests = await mockFollowUpApi(page);
  await page.goto("/follow-up");

  await page.getByRole("button", { name: "Registro diario opcional" }).click();
  await expect(page.getByLabel("Adherencia general")).toHaveCount(0);
  await page.getByLabel("Horas de sueño").fill("7.5");
  await page.getByRole("button", { name: "Guardar registro diario opcional" }).click();
  await expect(page.getByText("Registro parcial")).toBeVisible();

  await page.getByLabel("Resultado").fill("180");
  await page.getByText("Añadir rango de referencia del informe").click();
  await page.getByLabel("Mínimo").fill("200");
  await page.getByLabel("Máximo").fill("900");
  await page.getByRole("button", { name: "Guardar analíticas" }).click();

  await expect(
    page.getByRole("heading", { name: "Hay una versión candidata para revisar" }),
  ).toBeVisible();
  await expect(page.getByText("Baja respecto al valor anterior")).toBeVisible();
  await expect(page.getByText("Por debajo del rango aportado")).toBeVisible();

  if (screenshotDirectory) {
    await page.screenshot({
      fullPage: true,
      path: `${screenshotDirectory}/t13-follow-up-candidate.png`,
    });
  }

  await page.getByRole("button", { name: "Activar esta versión" }).click();
  await expect(page.getByText("La propuesta se ha activado")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Hay una versión candidata para revisar" }),
  ).toHaveCount(0);

  const activation = requests.find(({ path }) =>
    path.endsWith(`/${candidateId}/activate`),
  );
  expect(activation?.headers["if-match"]).toBe('"2"');
});

test("mantiene el seguimiento accesible y sin desbordamiento en móvil", async ({
  page,
}) => {
  await page.setViewportSize({ height: 844, width: 390 });
  await mockFollowUpApi(page);
  await page.goto("/follow-up");

  await expect(
    page.getByRole("navigation", { name: "Pasos del seguimiento" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { exact: true, name: "Revisión semanal" }),
  ).toHaveAttribute("aria-pressed", "true");
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    ),
  ).toBe(true);

  await page.getByRole("button", { name: "Añadir otro valor" }).click();
  await expect(page.getByRole("group", { name: "Valor 2" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Quitar" })).toHaveCount(1);

  if (screenshotDirectory) {
    await page.screenshot({
      fullPage: true,
      path: `${screenshotDirectory}/t13-follow-up-mobile.png`,
    });
  }
});
