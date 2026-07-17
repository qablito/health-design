import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  checkPublicBundle,
  renderPagesHeaders,
  resolvePublicEnvironment,
} from "../scripts/check-public-env.mjs";
import { resolveCors } from "../supabase/functions/_shared/cors.ts";
import { verifyTurnstile } from "../supabase/functions/_shared/turnstile.ts";
import ledgerWorker, {
  ContinuityLedger,
} from "../workers/continuity-ledger/src/index.js";

const developmentEnvironment = {
  PUBLIC_DEPLOY_TARGET: "preview",
  VITE_APP_ENV: "development",
  VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_pFyx9I4sbAeBfx4WtIx6vQ_cvi3SND2",
  VITE_SUPABASE_URL: "https://nwoivdxdupklervtnovd.supabase.co",
  VITE_TURNSTILE_SITE_KEY: "1x00000000000000000000AA",
};

const productionEnvironment = {
  PUBLIC_DEPLOY_TARGET: "production",
  VITE_APP_ENV: "production",
  VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_bmjg_U263vf58UFGMVV_BA_ddSKXyTt",
  VITE_SUPABASE_URL: "https://rbfrpgafytexrarcfmmp.supabase.co",
  VITE_TURNSTILE_SITE_KEY: "0x4AAAAAAD3xKl1OIN65uGzw",
};

describe("frontera de configuración pública", () => {
  it("impide secretos y el proyecto de producción en previews", () => {
    expect(resolvePublicEnvironment(developmentEnvironment).appEnvironment).toBe(
      "development",
    );

    expect(() =>
      resolvePublicEnvironment({
        ...developmentEnvironment,
        VITE_APP_ENV: "production",
        VITE_SUPABASE_URL: "https://rbfrpgafytexrarcfmmp.supabase.co",
      }),
    ).toThrow(/preview/i);

    expect(() =>
      resolvePublicEnvironment({
        ...developmentEnvironment,
        VITE_APP_ENV: "toString",
      }),
    ).toThrow(/entorno público/i);

    expect(() =>
      resolvePublicEnvironment({
        ...developmentEnvironment,
        VITE_INTERNAL_TOKEN: "sb_" + "secret_example",
      }),
    ).toThrow(/variable pública no permitida/i);

    expect(() =>
      resolvePublicEnvironment({
        ...developmentEnvironment,
        VITE_TURNSTILE_SITE_KEY: productionEnvironment.VITE_TURNSTILE_SITE_KEY,
      }),
    ).toThrow(/Turnstile/i);

    expect(() =>
      resolvePublicEnvironment({
        ...developmentEnvironment,
        VITE_SUPABASE_PUBLISHABLE_KEY:
          productionEnvironment.VITE_SUPABASE_PUBLISHABLE_KEY,
      }),
    ).toThrow(/clave publicable/i);

    expect(() =>
      resolvePublicEnvironment({
        ...productionEnvironment,
        VITE_TURNSTILE_SITE_KEY: developmentEnvironment.VITE_TURNSTILE_SITE_KEY,
      }),
    ).toThrow(/Turnstile/i);
  });

  it("detecta material privilegiado dentro del bundle", async () => {
    const directory = await mkdtemp(join(tmpdir(), "health-design-bundle-"));
    try {
      await writeFile(join(directory, "app.js"), "console.log('safe')");
      await expect(checkPublicBundle(directory)).resolves.toBeUndefined();

      await writeFile(join(directory, "app.js"), "const role='service_" + "role'");
      await expect(checkPublicBundle(directory)).rejects.toThrow(/app\.js/);
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it("genera CSP exacta y HSTS solo para producción", () => {
    const headers = renderPagesHeaders(resolvePublicEnvironment(productionEnvironment));

    expect(headers).toContain(
      "connect-src 'self' https://rbfrpgafytexrarcfmmp.supabase.co wss://rbfrpgafytexrarcfmmp.supabase.co https://challenges.cloudflare.com",
    );
    expect(headers).toContain("script-src 'self' https://challenges.cloudflare.com");
    expect(headers).toContain(
      "Strict-Transport-Security: max-age=31536000; includeSubDomains",
    );
    expect(headers).toContain(
      "Access-Control-Allow-Origin: https://health-design.pages.dev",
    );
    expect(headers).not.toContain("Access-Control-Allow-Origin: *");
    expect(headers).not.toContain("*.supabase.co");
    expect(headers).not.toContain("unsafe-eval");
  });
});

describe("configuración local reproducible", () => {
  it("fija Auth a 15 minutos, rotación 10 segundos y seed sintético", async () => {
    const [config, seed] = await Promise.all([
      readFile(new URL("../supabase/config.toml", import.meta.url), "utf8"),
      readFile(new URL("../supabase/seed.sql", import.meta.url), "utf8"),
    ]);

    expect(config).toMatch(/jwt_expiry\s*=\s*900/);
    expect(config).toMatch(/enable_refresh_token_rotation\s*=\s*true/);
    expect(config).toMatch(/refresh_token_reuse_interval\s*=\s*10/);
    expect(config).toMatch(/enable_anonymous_sign_ins\s*=\s*true/);
    expect(config).toMatch(/\[auth\.email\][\s\S]*?enable_signup\s*=\s*false/);
    expect(config).toMatch(/\[auth\.sms\][\s\S]*?enable_signup\s*=\s*false/);
    expect(seed).toContain("synthetic-only");
    expect(seed).not.toMatch(/\binsert\b/i);
  });

  it("incluye una clave publicable funcional del stack local", () => {
    expect(resolvePublicEnvironment({})).toMatchObject({
      appEnvironment: "local",
      publishableKey: "sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH",
      supabaseUrl: "http://127.0.0.1:54321",
    });
  });
});

describe("Turnstile", () => {
  it("valida Siteverify y falla cerrado si el contexto no coincide", async () => {
    const fetcher = vi.fn(async () =>
      Response.json({
        action: "anonymous-sign-in",
        hostname: "health-design.pages.dev",
        success: true,
      }),
    );

    await expect(
      verifyTurnstile(
        {
          expectedAction: "anonymous-sign-in",
          expectedHostname: "health-design.pages.dev",
          secret: "test-turnstile-secret",
          token: "test-turnstile-token",
        },
        fetcher,
      ),
    ).resolves.toEqual({ ok: true });

    expect(fetcher).toHaveBeenCalledWith(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      expect.objectContaining({
        method: "POST",
        signal: expect.any(AbortSignal),
      }),
    );

    await expect(
      verifyTurnstile(
        {
          expectedAction: "link-profile",
          expectedHostname: "health-design.pages.dev",
          secret: "test-turnstile-secret",
          token: "test-turnstile-token",
        },
        fetcher,
      ),
    ).resolves.toEqual({ ok: false });
  });
});

describe("CORS de Edge Functions", () => {
  it("refleja solo los orígenes exactos del entorno", () => {
    expect(resolveCors("https://health-design.pages.dev", "production")).toMatchObject({
      allowed: true,
      headers: {
        "access-control-allow-origin": "https://health-design.pages.dev",
        vary: "Origin",
      },
    });
    expect(
      resolveCors(
        "https://task-02-environments.health-design.pages.dev",
        "development",
      ),
    ).toMatchObject({ allowed: true });
    expect(resolveCors("https://attacker.invalid", "production")).toEqual({
      allowed: false,
      headers: {},
    });
    expect(resolveCors(null, "production")).toEqual({
      allowed: true,
      headers: {},
    });
  });
});

describe("ledger todavía inerte", () => {
  it("publica salud sin habilitar ninguna mutación", async () => {
    const health = await ledgerWorker.fetch(
      new Request("https://ledger.invalid/health"),
    );
    expect(health.status).toBe(200);
    await expect(health.json()).resolves.toEqual({
      mutationsEnabled: false,
      status: "ready",
    });

    const append = await ledgerWorker.fetch(
      new Request("https://ledger.invalid/append", { method: "POST" }),
    );
    expect(append.status).toBe(404);

    const object = new ContinuityLedger();
    const objectResponse = await object.fetch(
      new Request("https://ledger.invalid/append", { method: "POST" }),
    );
    expect(objectResponse.status).toBe(503);
  });
});
