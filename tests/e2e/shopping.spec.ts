import { expect, test, type Page } from "@playwright/test";

import type {
  CatalogSkuProjection,
  ShoppingPreferencePut,
  ShoppingPreferenceRevision,
  ShoppingSnapshotResponse,
  SupermarketChain,
} from "@health-design/contracts";
import { PlanVersionDetailSchema } from "@health-design/contracts";
import { exportNutrition } from "@health-design/test-fixtures/exports";

const USER_ID = "00000000-0000-4000-8000-000000017801";
const SESSION_ID = "21000000-0000-4000-8000-000000017801";
const ACTOR_ID = "31000000-0000-4000-8000-000000017801";
const PROFILE_ID = "51000000-0000-4000-8000-000000017801";
const PLAN_ID = "53000000-0000-4000-8000-000000017801";
const PLAN_VERSION_ID = "82000000-0000-4000-8000-000000017801";
const PREFERENCE_ID = "71000000-0000-4000-8000-000000017801";
const PUBLICATION_ID = "8e000000-0000-4000-8000-000000017801";
const SNAPSHOT_ID = "91000000-0000-4000-8000-000000017801";
const NOW = "2026-07-23T09:00:00.000Z";

function uuid(index: number): string {
  return `92000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
}

function projection(
  index: number,
  name: string,
  chain: SupermarketChain = "mercadona",
): CatalogSkuProjection {
  return {
    basePriceEur: "3.25",
    categoryPath: ["Alimentación"],
    chain,
    exclusionReasons: [],
    externalSku: `sku-${index}`,
    formatText: "500 g",
    gtin14: null,
    market: "ES",
    name,
    normalizedPrice: { dimension: "mass", unit: "EUR/kg", value: "6.5" },
    package: {
      equivalenceEvidenceRef: null,
      equivalentEdibleMassG: null,
      saleMeasure: { dimension: "mass", quantity: "500", unit: "g" },
    },
    purchaseForm: "fresh",
    schemaVersion: 1,
    skuId: uuid(index),
    usability: "calculable",
  };
}

const preference: ShoppingPreferenceRevision = {
  comparedChains: [],
  createdAt: NOW,
  createdBy: ACTOR_ID,
  id: PREFERENCE_ID,
  mode: "single",
  preferredChain: "mercadona",
  profileId: PROFILE_ID,
  schemaVersion: 1,
  sorting: "normalized_price_asc",
  supersedesId: null,
  version: 1,
};

function completeEnvelope(): ShoppingSnapshotResponse {
  const selectedProjection = projection(1, "Pechuga de pollo");
  return {
    lifecycle: { archivedAt: null, status: "active" },
    schemaVersion: 1,
    snapshot: {
      basketSeedRevisionId: uuid(90),
      catalogPublicationIds: [PUBLICATION_ID],
      comparison: {
        basis: "automatic_equivalent",
        baselineChains: ["mercadona"],
        baselineSubtotalEur: "6.5",
        candidateChains: ["dia"],
        candidateKind: "chain",
        candidateSubtotalEur: "6.49",
        comparableItems: 1,
        savingsEur: "0.01",
        scope: "complete",
        totalItems: 1,
      },
      completeness: "complete",
      createdAt: NOW,
      createdBy: ACTOR_ID,
      id: SNAPSHOT_ID,
      inputDigest: "ab".repeat(32),
      items: [
        {
          alternatives: [
            {
              selection: {
                estimatedRemainderG: "0",
                packageCount: "2",
                projection: projection(2, "Pollo familiar"),
                requiredAfterLeftoverG: "1000",
                totalCostEur: "7",
              },
              state: "resolved",
              uncertainties: [],
            },
          ],
          amountG: "1000",
          canonicalFoodKey: "food:test.chicken",
          name: "Pollo",
          selected: {
            estimatedRemainderG: "0",
            packageCount: "2",
            projection: selectedProjection,
            requiredAfterLeftoverG: "1000",
            totalCostEur: "6.5",
          },
          selectionOrigin: "manual",
          shoppingItemId: uuid(20),
          state: "resolved",
          uncertainties: [],
        },
      ],
      planVersionId: PLAN_VERSION_ID,
      preference: {
        comparedChains: [],
        mode: "single",
        preferredChain: "mercadona",
        sorting: "normalized_price_asc",
      },
      preferenceRevisionId: PREFERENCE_ID,
      profileId: PROFILE_ID,
      resolverVersion: "shopping-resolver-v2",
      revision: 1,
      schemaVersion: 1,
      supersedesId: null,
      totals: {
        coverage: { resolvedItems: 1, totalItems: 1 },
        estimatedTotalEur: "6.5",
        kind: "complete",
        resolvedItems: 1,
        unresolvedItems: 0,
      },
    },
  };
}

function partialEnvelope(): ShoppingSnapshotResponse {
  const complete = completeEnvelope();
  const resolved = {
    ...complete.snapshot.items[0]!,
    name: "Zanahoria",
    selectionOrigin: "automatic" as const,
  };
  const unresolved = [
    ["Arroz", "price_unavailable", "shopping_price_unavailable"],
    ["Leche", "package_unconfirmed", "shopping_package_unconfirmed"],
    ["Tomate", "no_confirmed_product", "shopping_sku_missing"],
  ] as const;
  return {
    ...complete,
    snapshot: {
      ...complete.snapshot,
      comparison: null,
      completeness: "partial",
      items: [
        resolved,
        ...unresolved.map(([name, state, uncertainty], index) => ({
          alternatives: [],
          amountG: "500",
          canonicalFoodKey: `food:test.pending-${index}`,
          name,
          selected: null,
          selectionOrigin: index === 2 ? ("manual" as const) : ("automatic" as const),
          shoppingItemId: uuid(30 + index),
          state,
          uncertainties:
            index === 2 ? ["shopping_manual_selection_stale"] : [uncertainty],
        })),
      ],
      totals: {
        coverage: { resolvedItems: 1, totalItems: 4 },
        kind: "partial",
        partialSubtotalEur: "6.5",
        resolvedItems: 1,
        unresolvedItems: 3,
      },
    },
  };
}

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
      session_id: SESSION_ID,
      sub: USER_ID,
    })}.test-signature`,
    expires_at: now + 3_600,
    expires_in: 3_600,
    refresh_token: "shopping-refresh-token",
    token_type: "bearer",
    user: {
      app_metadata: { provider: "anonymous", providers: ["anonymous"] },
      aud: "authenticated",
      created_at: NOW,
      id: USER_ID,
      is_anonymous: true,
      role: "authenticated",
      updated_at: NOW,
      user_metadata: {},
    },
  };
}

async function installSession(page: Page): Promise<void> {
  await page.addInitScript((session) => {
    window.localStorage.setItem("sb-127-auth-token", JSON.stringify(session));
    Object.defineProperty(window, "print", {
      configurable: true,
      value: () => document.documentElement.setAttribute("data-printed", "true"),
    });
  }, browserSession());
}

type MockOptions = Readonly<{
  envelope?: ShoppingSnapshotResponse;
  failSecondResolution?: boolean;
  initialPreference?: ShoppingPreferenceRevision | null;
  legacyHint?: { compatible: boolean; value: string } | null;
  publishedChains?: readonly SupermarketChain[];
}>;

async function mockShoppingApi(page: Page, options: MockOptions = {}) {
  const calls: Array<{
    body: unknown;
    idempotencyKey: string | null;
    method: string;
    path: string;
  }> = [];
  const publishedChains = new Set(options.publishedChains ?? ["mercadona", "dia"]);
  let currentEnvelope = options.envelope ?? completeEnvelope();
  let preferenceValue = options.initialPreference ?? null;
  let resolutions = 0;

  await page.route("http://127.0.0.1:54321/functions/v1/access/**", (route) =>
    route.fulfill({
      body: JSON.stringify([
        {
          accessScope: "owner",
          alias: "Perfil de compra",
          profileId: PROFILE_ID,
          status: "active",
        },
      ]),
      contentType: "application/json",
      status: 200,
    }),
  );

  await page.route("http://127.0.0.1:54321/functions/v1/plans/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith(`/v1/profiles/${PROFILE_ID}/plans/current`)) {
      return route.fulfill({
        body: JSON.stringify({
          activeVersionId: PLAN_VERSION_ID,
          aggregateVersion: 1,
          planId: PLAN_ID,
          profileId: PROFILE_ID,
          versions: [
            {
              activatedAt: NOW,
              archivedAt: null,
              canonicalizationVersion: "canonical-json-v1",
              completeness: "complete",
              contextSnapshotId: uuid(80),
              createdAt: NOW,
              engineVersion: "engine-v3",
              hashAlgorithm: "sha256",
              id: PLAN_VERSION_ID,
              inputHash: "a".repeat(64),
              ordinal: 1,
              outputHash: "b".repeat(64),
              planId: PLAN_ID,
              ruleSetRevisionId: uuid(81),
              sourceManifestId: uuid(82),
              status: "active",
              validatedAt: NOW,
              validation: { status: "valid" },
              validationStatus: "valid",
            },
          ],
        }),
        contentType: "application/json",
        status: 200,
      });
    }
    if (path.endsWith(`/v1/plans/${PLAN_ID}/versions/${PLAN_VERSION_ID}`)) {
      return route.fulfill({
        body: JSON.stringify(
          PlanVersionDetailSchema.parse({
            activatedAt: NOW,
            archivedAt: null,
            canonicalizationVersion: "canonical-json-v1",
            completeness: "complete",
            contextSnapshotId: uuid(80),
            createdAt: NOW,
            engineVersion: "engine-v3",
            hashAlgorithm: "sha256",
            id: PLAN_VERSION_ID,
            inputHash: "a".repeat(64),
            moduleResults: [
              {
                confidence: "high",
                createdAt: NOW,
                id: uuid(83),
                module: "nutrition",
                payload: exportNutrition,
                status: "valid",
                uncertainties: [],
              },
            ],
            ordinal: 1,
            outputHash: "b".repeat(64),
            planId: PLAN_ID,
            ruleSetRevisionId: uuid(81),
            safetyFindings: [],
            sourceManifestId: uuid(82),
            status: "active",
            validatedAt: NOW,
            validation: { status: "valid" },
            validationStatus: "valid",
          }),
        ),
        contentType: "application/json",
        status: 200,
      });
    }
    return route.fulfill({ status: 404 });
  });

  await page.route("http://127.0.0.1:54321/functions/v1/exports/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const body: unknown = request.postData()
      ? (request.postDataJSON() as unknown)
      : null;
    calls.push({
      body,
      idempotencyKey: request.headers()["idempotency-key"] ?? null,
      method: request.method(),
      path,
    });
    if (path.endsWith(`/v1/plans/${PLAN_VERSION_ID}/exports`)) {
      return route.fulfill({
        body: JSON.stringify({
          artifactId: uuid(84),
          createdAt: NOW,
          detail: (body as { detail: string }).detail,
          format: (body as { format: string }).format,
          planVersionId: PLAN_VERSION_ID,
          presentation: (body as { presentation: string }).presentation,
          schemaVersion: 1,
          status: "ready",
        }),
        contentType: "application/json",
        status: 200,
      });
    }
    if (path.endsWith(`/v1/exports/${uuid(84)}/content`)) {
      return route.fulfill({
        body: "%PDF-1.7",
        contentType: "application/pdf",
        status: 200,
      });
    }
    return route.fulfill({ status: 404 });
  });

  await page.route("http://127.0.0.1:54321/functions/v1/catalogs/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const body: unknown = request.postData()
      ? (request.postDataJSON() as unknown)
      : null;
    calls.push({
      body,
      idempotencyKey: request.headers()["idempotency-key"] ?? null,
      method: request.method(),
      path: `${path}${url.search}`,
    });

    if (path.endsWith("/v1/catalogs")) {
      const chain = url.searchParams.get("chain") as SupermarketChain;
      if (!publishedChains.has(chain)) {
        return route.fulfill({
          body: JSON.stringify({
            error: {
              code: "CATALOG_NOT_PUBLISHED",
              message_key: "shopping.catalog_not_published",
              request_id: `request-${chain}`,
              retryable: false,
            },
          }),
          contentType: "application/json",
          status: 409,
        });
      }
      return route.fulfill({
        body: JSON.stringify({
          chain,
          items: [
            projection(chain === "mercadona" ? 1 : 3, `Producto ${chain}`, chain),
          ],
          nextCursor: null,
          publicationId: PUBLICATION_ID,
          schemaVersion: 1,
        }),
        contentType: "application/json",
        status: 200,
      });
    }
    if (path.endsWith(`/v1/profiles/${PROFILE_ID}/shopping-preference`)) {
      if (request.method() === "GET") {
        return route.fulfill({
          body: JSON.stringify({
            legacyHint: options.legacyHint ?? null,
            preference: preferenceValue,
            schemaVersion: 1,
          }),
          contentType: "application/json",
          status: 200,
        });
      }
      const next = body as ShoppingPreferencePut;
      preferenceValue = {
        ...preference,
        comparedChains: next.comparedChains,
        mode: next.mode,
        preferredChain: next.preferredChain,
        sorting: next.sorting,
        version: (next.expectedVersion ?? 0) + 1,
      };
      return route.fulfill({
        body: JSON.stringify({
          preferenceRevisionId: PREFERENCE_ID,
          schemaVersion: 1,
          version: preferenceValue.version,
        }),
        contentType: "application/json",
        status: 200,
      });
    }
    if (path.endsWith(`/v1/plans/${PLAN_VERSION_ID}/shopping`)) {
      resolutions += 1;
      if (options.failSecondResolution && resolutions === 2) {
        return route.fulfill({
          body: JSON.stringify({
            error: {
              code: "DEPENDENCY_UNAVAILABLE",
              message_key: "shopping.dependency_unavailable",
              request_id: "request-failed-resolution",
              retryable: true,
            },
          }),
          contentType: "application/json",
          status: 503,
        });
      }
      return route.fulfill({
        body: JSON.stringify({
          schemaVersion: 1,
          snapshotId: SNAPSHOT_ID,
          status: "active",
          version: currentEnvelope.snapshot.revision,
        }),
        contentType: "application/json",
        status: 200,
      });
    }
    if (path.endsWith(`/v1/shopping/${SNAPSHOT_ID}`)) {
      return route.fulfill({
        body: JSON.stringify(currentEnvelope),
        contentType: "application/json",
        status: 200,
      });
    }
    if (
      path.endsWith(`/v1/shopping/${SNAPSHOT_ID}/leftovers`) ||
      path.endsWith(`/v1/shopping/${SNAPSHOT_ID}/product-selection`)
    ) {
      currentEnvelope = {
        ...currentEnvelope,
        snapshot: {
          ...currentEnvelope.snapshot,
          revision: currentEnvelope.snapshot.revision + 1,
        },
      };
      return route.fulfill({
        body: JSON.stringify({
          schemaVersion: 1,
          snapshotId: SNAPSHOT_ID,
          status: "active",
          version: currentEnvelope.snapshot.revision,
        }),
        contentType: "application/json",
        status: 200,
      });
    }
    return route.fulfill({ status: 404 });
  });
  return calls;
}

test.beforeEach(async ({ page }) => {
  await installSession(page);
});

test("exige una elección explícita y limita multitienda a cadenas publicadas", async ({
  page,
}) => {
  const calls = await mockShoppingApi(page, {
    legacyHint: { compatible: false, value: "Lidl" },
    publishedChains: ["mercadona"],
  });
  await page.goto(`/shopping?version=${PLAN_VERSION_ID}&profile=${PROFILE_ID}`);

  await expect(page.getByRole("heading", { name: "Compra semanal" })).toBeVisible();
  await expect(page.getByText(/Lidl.*no es compatible/i)).toBeVisible();
  await expect(page.getByLabel("Mercadona")).not.toBeChecked();
  await expect(page.getByLabel("Varios supermercados")).toBeDisabled();
  await expect(page.getByText(/se necesitan al menos dos cadenas/i)).toBeVisible();

  await page.getByLabel("Mercadona").check();
  await page.getByRole("button", { name: "Guardar y calcular" }).click();
  const basketHeading = page.getByRole("heading", { name: "Tu cesta orientativa" });
  await expect(basketHeading).toBeFocused();
  await expect(
    page.locator(".shopping-basket").getByText("Total orientativo"),
  ).toBeVisible();
  await expect(page.locator(".shopping-total strong")).toHaveText("6,50 €");
  expect(
    calls.some(
      ({ method, path }) => method === "PUT" && path.includes("shopping-preference"),
    ),
  ).toBe(true);
  expect(
    calls.some(
      ({ method, path }) =>
        method === "POST" && path.includes(`/plans/${PLAN_VERSION_ID}/shopping`),
    ),
  ).toBe(true);

  const text = await page.locator("main").innerText();
  expect(text).not.toMatch(/Sevilla|fecha de catálogo|cupones|ofertas|fidelización/i);
});

test("presenta una cesta parcial sin llamar total al subtotal y conserva el orden", async ({
  page,
}) => {
  await mockShoppingApi(page, {
    envelope: partialEnvelope(),
    initialPreference: preference,
  });
  await page.goto(`/shopping?version=${PLAN_VERSION_ID}&profile=${PROFILE_ID}`);

  await expect(
    page.locator(".shopping-basket").getByText("Subtotal de productos confirmados"),
  ).toBeVisible();
  await expect(page.getByText("1 de 4 productos resueltos")).toBeVisible();
  const basket = page.locator(".shopping-basket");
  await expect(basket.getByText("Precio no disponible")).toBeVisible();
  await expect(basket.getByText("Envase pendiente de confirmar")).toBeVisible();
  await expect(basket.getByText("Selección manual pendiente")).toBeVisible();
  const names = await page.locator("[data-shopping-item-name]").allTextContents();
  expect(names).toEqual(["Zanahoria", "Arroz", "Leche", "Tomate"]);
});

test("exporta la cesta congelada sin enviar filas ni permitir día o sustituciones", async ({
  page,
}) => {
  const calls = await mockShoppingApi(page, { initialPreference: preference });
  await page.goto(`/shopping?version=${PLAN_VERSION_ID}&profile=${PROFILE_ID}`);

  const panel = page.getByRole("region", { name: "Exportar el plan" });
  await expect(panel).toBeVisible();
  await expect(
    page.getByRole("radio", { name: "Cesta orientativa actual" }),
  ).toBeChecked();
  await expect(page.getByRole("radio", { name: "Un día" })).toBeDisabled();
  await expect(page.getByLabel("Añadir lista de la compra")).toBeDisabled();

  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Descargar PDF" }).click();
  await download;
  const request = calls.find(({ path }) =>
    path.endsWith(`/v1/plans/${PLAN_VERSION_ID}/exports`),
  )?.body as Record<string, unknown>;
  expect(request).toMatchObject({
    choices: [],
    includeShopping: true,
    range: { kind: "week" },
    shoppingSnapshotId: SNAPSHOT_ID,
  });
  expect(request).not.toHaveProperty("shoppingRows");

  await page.getByRole("button", { name: "Imprimir" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-printed", "true");
  const printedShopping = page.locator(".export-print-shopping");
  await expect(printedShopping.locator("tbody tr")).toHaveCount(1);
  await expect(printedShopping).toContainText("3.25 EUR");
  await expect(printedShopping).toContainText("6.5 EUR/kg");
  await expect(printedShopping).toContainText("Elección manual");
  await expect(printedShopping).toContainText("Ahorro orientativo: 0.01 EUR");
  await expect(printedShopping).toContainText(
    "La tienda habitual sigue siendo Mercadona",
  );
});

test("explica la elección manual y mantiene la habitual ante un ahorro de un céntimo", async ({
  page,
}) => {
  await mockShoppingApi(page, { initialPreference: preference });
  await page.goto(`/shopping?version=${PLAN_VERSION_ID}&profile=${PROFILE_ID}`);

  await expect(page.getByText("Tu producto elegido se mantiene.")).toBeVisible();
  await expect(page.getByText(/ahorro orientativo.*0,01/i)).toBeVisible();
  await expect(
    page.getByText(/tu tienda habitual sigue siendo Mercadona/i),
  ).toBeVisible();
});

test("mantiene el snapshot anterior si guardar preferencia funciona y resolver falla", async ({
  page,
}) => {
  const calls = await mockShoppingApi(page, {
    failSecondResolution: true,
    initialPreference: preference,
  });
  await page.goto(`/shopping?version=${PLAN_VERSION_ID}&profile=${PROFILE_ID}`);
  await expect(
    page.locator(".shopping-basket").getByText("Pechuga de pollo"),
  ).toBeVisible();

  await page.getByLabel("Orden de la cesta").selectOption("name_desc");
  await page.getByRole("button", { name: "Guardar y recalcular" }).click();
  await expect(
    page.locator(".shopping-basket").getByText("Pechuga de pollo"),
  ).toBeVisible();
  await expect(page.getByText(/preferencia se ha guardado.*reintentar/i)).toBeVisible();
  await page.getByRole("button", { name: "Reintentar cálculo" }).click();
  await expect(
    page.getByRole("heading", { name: "Tu cesta orientativa" }),
  ).toBeFocused();

  const createCalls = calls.filter(({ path }) =>
    path.includes(`/plans/${PLAN_VERSION_ID}/shopping`),
  );
  expect(createCalls).toHaveLength(3);
  expect(createCalls[1]?.idempotencyKey).not.toBeNull();
  expect(createCalls[1]?.idempotencyKey).toBe(createCalls[2]?.idempotencyKey);
});

test("cada apertura nueva usa una clave de resolución distinta", async ({ page }) => {
  const calls = await mockShoppingApi(page, { initialPreference: preference });
  await page.goto(`/shopping?version=${PLAN_VERSION_ID}&profile=${PROFILE_ID}`);
  await expect(
    page.locator(".shopping-basket").getByText("Pechuga de pollo"),
  ).toBeVisible();

  await page.reload();
  await expect(
    page.locator(".shopping-basket").getByText("Pechuga de pollo"),
  ).toBeVisible();

  const createCalls = calls.filter(({ method, path }) => {
    return method === "POST" && path.endsWith(`/v1/plans/${PLAN_VERSION_ID}/shopping`);
  });
  expect(createCalls).toHaveLength(2);
  expect(createCalls[0]?.idempotencyKey).not.toBeNull();
  expect(createCalls[1]?.idempotencyKey).not.toBeNull();
  expect(createCalls[0]?.idempotencyKey).not.toBe(createCalls[1]?.idempotencyKey);
});

test("envía cambio de producto y set/clear de sobrante como mutaciones controladas", async ({
  page,
}) => {
  const calls = await mockShoppingApi(page, { initialPreference: preference });
  await page.goto(`/shopping?version=${PLAN_VERSION_ID}&profile=${PROFILE_ID}`);

  await page.getByRole("button", { name: "Cambiar producto de Pollo" }).click();
  await page.getByLabel("Producto alternativo para Pollo").selectOption(uuid(2));
  await page.getByRole("button", { name: "Confirmar producto" }).click();

  await page.getByRole("button", { name: "Declarar sobrante de Pollo" }).click();
  await page.getByLabel("Cantidad sobrante de Pollo").fill("100");
  await page.getByRole("button", { name: "Confirmar sobrante" }).click();
  await page.getByRole("button", { name: "Eliminar sobrante de Pollo" }).click();

  await expect
    .poll(() => calls.filter(({ path }) => path.endsWith("leftovers")).length)
    .toBe(2);
  expect(
    calls.some(
      ({ body, path }) =>
        path.endsWith("product-selection") &&
        (body as { skuId?: string }).skuId === uuid(2),
    ),
  ).toBe(true);
  expect(
    calls.filter(({ path }) => path.endsWith("leftovers")).map(({ body }) => body),
  ).toMatchObject([
    {
      action: "set",
      declaredMeasure: { dimension: "mass", quantity: "100", unit: "g" },
    },
    { action: "clear" },
  ]);
});

test("la pantalla es accesible por teclado y no desborda en móvil", async ({
  page,
}) => {
  await mockShoppingApi(page, { initialPreference: preference });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/shopping?version=${PLAN_VERSION_ID}&profile=${PROFILE_ID}`);

  await page.keyboard.press("Tab");
  await expect(page.locator(":focus")).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
});
