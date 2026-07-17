import { expect, test, type Page, type Request } from "@playwright/test";

const userId = "00000000-0000-4000-8000-000000000901";
const sessionId = "21000000-0000-4000-8000-000000000901";
const profileId = "51000000-0000-4000-8000-000000000901";
const profileAccessId = "61000000-0000-4000-8000-000000000901";
const deviceSessionId = "41000000-0000-4000-8000-000000000901";
const invitationSecret = "invitation-secret-128-bits-e2e";
const privateCode = "ABCD-EF01-2345-6789-ABCD-EF01-2345-6789";
const qrPayload = "healthdesign-link-v1.ABCDEFGHIJKLMNOPQRSTUV";

function base64Url(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function browserSession() {
  const now = Math.floor(Date.now() / 1_000);
  const accessToken = `${base64Url({ alg: "HS256", typ: "JWT" })}.${base64Url({
    aud: "authenticated",
    exp: now + 3_600,
    iat: now,
    role: "authenticated",
    session_id: sessionId,
    sub: userId,
  })}.test-signature`;
  return {
    access_token: accessToken,
    expires_at: now + 3_600,
    expires_in: 3_600,
    refresh_token: "test-refresh-token",
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

async function installTurnstileStub(page: Page) {
  await page.addInitScript(() => {
    type Callback = (token: string) => void;
    const callbacks = new Map<string, Callback>();
    let counter = 0;
    Object.defineProperty(window, "turnstile", {
      configurable: true,
      value: {
        execute(widgetId: string) {
          callbacks.get(widgetId)?.(`turnstile-${widgetId}`);
        },
        remove(widgetId: string) {
          callbacks.delete(widgetId);
        },
        render(_container: HTMLElement, options: { callback: Callback }) {
          counter += 1;
          const widgetId = `widget-${counter}`;
          callbacks.set(widgetId, options.callback);
          return widgetId;
        },
      },
    });
  });
}

test("un navegador nuevo empieza limpio y sin falso error de sesión", async ({
  page,
}) => {
  await installTurnstileStub(page);
  await page.goto("/");

  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: /Crear perfil invitado/ }),
  ).toBeVisible();
});

test("un JWT residual rechazado se elimina del dispositivo", async ({ page }) => {
  await installTurnstileStub(page);
  await page.addInitScript((session) => {
    window.localStorage.setItem("sb-127-auth-token", JSON.stringify(session));
  }, browserSession());
  await page.route("http://127.0.0.1:54321/functions/v1/access/**", (route) =>
    route.fulfill({
      body: JSON.stringify({
        error: {
          code: "UNAUTHENTICATED",
          message_key: "common.unauthenticated",
          retryable: false,
        },
      }),
      contentType: "application/json",
      status: 401,
    }),
  );

  await page.goto("/");

  await expect
    .poll(() => page.evaluate(() => window.localStorage.getItem("sb-127-auth-token")))
    .toBeNull();
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("alta, código de un solo vistazo y QR sin secretos en URL o almacenamiento", async ({
  page,
}) => {
  const capturedMutations: Request[] = [];
  let profileCreated = false;

  await installTurnstileStub(page);
  await page.addInitScript((session) => {
    window.localStorage.setItem("sb-127-auth-token", JSON.stringify(session));
  }, browserSession());

  await page.route("http://127.0.0.1:54321/functions/v1/access/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const json = (body: unknown, status = 200) =>
      route.fulfill({
        body: JSON.stringify(body),
        contentType: "application/json",
        status,
      });

    if (request.method() === "POST") capturedMutations.push(request);
    if (path.endsWith("/v1/me/profiles")) {
      await json(
        profileCreated
          ? [
              {
                accessScope: "owner",
                alias: "Pablo Salud",
                profileId,
                status: "active",
              },
            ]
          : [],
      );
      return;
    }
    if (path.endsWith(`/v1/profiles/${profileId}/sessions`)) {
      await json([
        {
          createdAt: "2026-07-17T10:00:00.000Z",
          deviceSessionId,
          isCurrent: true,
          label: "Portatil",
          lastSeenAt: "2026-07-17T10:00:00.000Z",
        },
      ]);
      return;
    }
    if (path.endsWith("/v1/invitations/redeem")) {
      profileCreated = true;
      await json(
        {
          accessScope: "owner",
          alias: "Pablo Salud",
          deviceSessionId,
          privateCode,
          profileAccessId,
          profileId,
        },
        201,
      );
      return;
    }
    if (path.endsWith(`/v1/profiles/${profileId}/device-links/qr`)) {
      await json(
        { expiresAt: new Date(Date.now() + 300_000).toISOString(), qrPayload },
        201,
      );
      return;
    }
    await json({ error: { code: "NOT_FOUND" } }, 404);
  });

  await page.goto("/");
  await expect(
    page.getByRole("heading", {
      name: "Tus perfiles, disponibles donde los necesites",
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: /Crear perfil invitado/ }).click();
  await page.getByLabel("Alias").fill("Pablo Salud");
  await page.getByLabel("Código de invitación").fill(invitationSecret);
  await page.getByLabel("Nombre de este dispositivo").fill("Portatil");
  await page.getByLabel("Confirmo que tengo 18 años o más.").check();
  await page.getByRole("button", { name: "Crear perfil" }).click();

  await expect(page.getByText(privateCode)).toBeVisible();
  await page.getByRole("button", { name: "Ya lo he guardado" }).click();
  await expect(page.getByText(privateCode)).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Perfiles vinculados" }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Crear QR de 5 minutos" }).click();
  await expect(
    page.getByAltText("QR temporal para vincular otro dispositivo"),
  ).toBeVisible();
  await expect(page.getByText("QR temporal listo")).toBeVisible();

  const invitationRequest = capturedMutations.find((request) =>
    request.url().endsWith("/v1/invitations/redeem"),
  );
  const qrRequest = capturedMutations.find((request) =>
    request.url().endsWith(`/v1/profiles/${profileId}/device-links/qr`),
  );
  expect(invitationRequest).toBeDefined();
  expect(qrRequest).toBeDefined();
  expect(new URL(invitationRequest!.url()).search).toBe("");
  expect(invitationRequest!.postDataJSON()).toMatchObject({
    invitationSecret,
    schemaVersion: 1,
  });
  expect(invitationRequest!.headers()).not.toHaveProperty("referer");
  expect(invitationRequest!.headers()["idempotency-key"]).toMatch(/^[0-9a-f-]{36}$/);
  expect(qrRequest!.postDataJSON()).toEqual({ schemaVersion: 1 });
  expect(page.url()).not.toContain(invitationSecret);

  const persistedBrowserState = await page.evaluate(() =>
    Array.from({ length: window.localStorage.length }, (_, index) => {
      const key = window.localStorage.key(index);
      return key ? `${key}:${window.localStorage.getItem(key)}` : "";
    }).join("\n"),
  );
  expect(persistedBrowserState).not.toContain(invitationSecret);
  expect(persistedBrowserState).not.toContain(privateCode);
  expect(persistedBrowserState).not.toContain(qrPayload);
});
