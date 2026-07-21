import { expect, test, type Page } from "@playwright/test";

const userId = "00000000-0000-4000-8000-000000005101";
const sessionId = "21000000-0000-4000-8000-000000005102";
const profileId = "51000000-0000-4000-8000-000000005101";
const impersonationSessionId = "71000000-0000-4000-8000-000000005101";

function base64Url(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function adminSession() {
  const now = Math.floor(Date.now() / 1_000);
  const accessToken = `${base64Url({ alg: "HS256", typ: "JWT" })}.${base64Url({
    aal: "aal2",
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
    refresh_token: "admin-test-refresh-token",
    token_type: "bearer",
    user: {
      app_metadata: { provider: "email", providers: ["email"] },
      aud: "authenticated",
      created_at: new Date().toISOString(),
      email: "admin@example.test",
      id: userId,
      is_anonymous: false,
      role: "authenticated",
      updated_at: new Date().toISOString(),
      user_metadata: {},
    },
  };
}

async function installAdminSession(page: Page) {
  await page.addInitScript((session) => {
    window.localStorage.setItem("sb-127-auth-token", JSON.stringify(session));
  }, adminSession());
}

async function installTurnstileStub(page: Page) {
  await page.addInitScript(() => {
    const target = window as Window & {
      turnstile?: {
        execute(widgetId: string): void;
        remove(widgetId: string): void;
        render(
          container: HTMLElement,
          options: { callback(token: string): void },
        ): string;
      };
    };
    target.turnstile = {
      execute() {},
      remove() {},
      render(_container, options) {
        setTimeout(() => options.callback("admin-turnstile-token"), 0);
        return "admin-turnstile-widget";
      },
    };
  });
}

test("el acceso SU envía el desafío Turnstile a Supabase Auth", async ({ page }) => {
  await installTurnstileStub(page);
  let captchaToken: unknown;
  await page.route("http://127.0.0.1:54321/auth/v1/token**", async (route) => {
    const body = route.request().postDataJSON() as {
      gotrue_meta_security?: { captcha_token?: unknown };
    };
    captchaToken = body.gotrue_meta_security?.captcha_token;
    await route.fulfill({
      body: JSON.stringify({ error_code: "invalid_credentials" }),
      contentType: "application/json",
      status: 400,
    });
  });

  await page.goto("/admin");
  await page.getByLabel("Correo").fill("admin@example.test");
  await page.getByLabel("Contraseña").fill("test-password");
  await page.getByRole("button", { name: "Continuar" }).click();

  await expect.poll(() => captchaToken).toBe("admin-turnstile-token");
});

test("el indicador de impersonación persiste al refrescar y salir restaura admin", async ({
  page,
}) => {
  let active = false;
  await installAdminSession(page);
  await page.route("http://127.0.0.1:54321/functions/v1/admin/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const respond = (body: unknown, status = 200) =>
      route.fulfill({
        body: JSON.stringify(body),
        contentType: "application/json",
        status,
      });

    if (path.endsWith("/v1/admin/context")) {
      await respond(
        active
          ? {
              active: true,
              effectiveProfileId: profileId,
              impersonationSessionId,
              startedAt: "2026-07-17T16:00:00.000Z",
            }
          : { active: false },
      );
      return;
    }
    if (path.endsWith("/v1/admin/profiles")) {
      await respond([
        {
          alias: "Perfil Admin Test",
          createdAt: "2026-07-17T15:00:00.000Z",
          profileId,
          status: "active",
        },
      ]);
      return;
    }
    if (path.endsWith("/v1/admin/barcode-corrections")) {
      await respond({ items: [], nextCursor: null });
      return;
    }
    if (path.endsWith(`/v1/admin/profiles/${profileId}/impersonations`)) {
      active = true;
      await respond(
        {
          active: true,
          effectiveProfileId: profileId,
          impersonationSessionId,
          startedAt: "2026-07-17T16:00:00.000Z",
        },
        201,
      );
      return;
    }
    if (path.endsWith(`/v1/admin/impersonations/${impersonationSessionId}/end`)) {
      active = false;
      await respond({ active: false });
      return;
    }
    await respond({ error: { code: "NOT_FOUND" } }, 404);
  });

  await page.goto("/admin");
  await expect(
    page.getByRole("heading", { name: "Administración privada" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Acceder como este perfil" }).click();
  await expect(page.getByRole("status")).toContainText(
    "Estás operando como Perfil Admin Test",
  );

  await page.reload();
  await expect(page.getByRole("status")).toContainText(
    "Estás operando como Perfil Admin Test",
  );
  await page.getByRole("button", { name: "Salir de la impersonación" }).click();
  await expect(page.getByRole("status")).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Administración privada" }),
  ).toBeVisible();
});

test("un desafío AAL2 caducado vuelve a mostrar la confirmación TOTP", async ({
  page,
}) => {
  await installAdminSession(page);
  await page.route("http://127.0.0.1:54321/auth/v1/user", async (route) => {
    await route.fulfill({
      body: JSON.stringify({
        ...adminSession().user,
        factors: [
          {
            created_at: "2026-07-17T15:00:00.000Z",
            factor_type: "totp",
            id: "factor-totp-test",
            status: "verified",
            updated_at: "2026-07-17T15:00:00.000Z",
          },
        ],
      }),
      contentType: "application/json",
      status: 200,
    });
  });
  await page.route("http://127.0.0.1:54321/functions/v1/admin/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/v1/admin/context")) {
      await route.fulfill({ body: JSON.stringify({ active: false }), status: 200 });
      return;
    }
    if (path.endsWith("/v1/admin/profiles")) {
      await route.fulfill({
        body: JSON.stringify([
          {
            alias: "Perfil Admin Test",
            createdAt: "2026-07-17T15:00:00.000Z",
            profileId,
            status: "active",
          },
        ]),
        contentType: "application/json",
        status: 200,
      });
      return;
    }
    if (path.endsWith("/v1/admin/barcode-corrections")) {
      await route.fulfill({
        body: JSON.stringify({ items: [], nextCursor: null }),
        contentType: "application/json",
        status: 200,
      });
      return;
    }
    await route.fulfill({
      body: JSON.stringify({ error: { code: "AAL2_REQUIRED" } }),
      contentType: "application/json",
      status: 403,
    });
  });

  await page.goto("/admin");
  await page.getByRole("button", { name: "Acceder como este perfil" }).click();

  await expect(page.getByRole("heading", { name: "Confirmación TOTP" })).toBeVisible();
});
