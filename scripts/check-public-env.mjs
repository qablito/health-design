import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const PUBLIC_VARIABLES = new Set([
  "VITE_APP_ENV",
  "VITE_SUPABASE_PUBLISHABLE_KEY",
  "VITE_SUPABASE_URL",
  "VITE_TURNSTILE_SITE_KEY",
]);

const SUPABASE_URLS = {
  development: "https://nwoivdxdupklervtnovd.supabase.co",
  local: "http://127.0.0.1:54321",
  production: "https://rbfrpgafytexrarcfmmp.supabase.co",
};

const FRONTEND_ORIGINS = {
  development: "https://task-02-environments.health-design.pages.dev",
  local: "http://127.0.0.1:5173",
  production: "https://health-design.pages.dev",
};

const TURNSTILE_TEST_SITE_KEY = "1x00000000000000000000AA";
const TURNSTILE_PRODUCTION_SITE_KEY = "0x4AAAAAAD3xKl1OIN65uGzw";
const LOCAL_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH";
const PUBLISHABLE_KEY_SHA256 = {
  development: "f0fa3d7ec106837814068ac746fcdf0d215c35853141163851dd1914805ef678",
  local: "9705102db0d5f99ee08daa19a73e510d9877a2a9add9369da247cbbe6c2a0140",
  production: "c462f5c6d4b09a830d565c8463c195d5abb3feea4d17e3831f9749a4d5ffd291",
};

const FORBIDDEN_PUBLIC_CONTENT = [
  /service[_-]?role/i,
  /sb_secret_/i,
  /pepper/i,
  /backup[_-]?(?:key|secret|kek)/i,
  /luna[_-]?(?:api[_-]?)?(?:key|token)/i,
  /cloudflare[_-]?api[_-]?token/i,
  /r2[_-]?(?:access|secret)/i,
];

function assertPublicContent(value, source) {
  if (FORBIDDEN_PUBLIC_CONTENT.some((pattern) => pattern.test(value))) {
    throw new Error(`Material privilegiado detectado en ${source}.`);
  }
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function resolvePublicEnvironment(environment) {
  for (const name of Object.keys(environment)) {
    if (name.startsWith("VITE_") && !PUBLIC_VARIABLES.has(name)) {
      throw new Error(`Variable pública no permitida: ${name}.`);
    }
  }

  const appEnvironment = environment.VITE_APP_ENV ?? "local";
  if (!Object.hasOwn(SUPABASE_URLS, appEnvironment)) {
    throw new Error(`Entorno público no permitido: ${appEnvironment}.`);
  }

  const deployTarget =
    environment.PUBLIC_DEPLOY_TARGET ??
    (appEnvironment === "local"
      ? "local"
      : appEnvironment === "development"
        ? "preview"
        : "production");
  const targetEnvironments = {
    local: "local",
    preview: "development",
    production: "production",
  };

  if (!Object.hasOwn(targetEnvironments, deployTarget)) {
    throw new Error(`Destino de despliegue no permitido: ${deployTarget}.`);
  }
  const expectedEnvironment = targetEnvironments[deployTarget];
  if (appEnvironment !== expectedEnvironment) {
    throw new Error(
      `El destino ${deployTarget} no puede usar el entorno ${appEnvironment}.`,
    );
  }

  const supabaseUrl = environment.VITE_SUPABASE_URL ?? SUPABASE_URLS[appEnvironment];
  const publishableKey =
    environment.VITE_SUPABASE_PUBLISHABLE_KEY ??
    (appEnvironment === "local" ? LOCAL_SUPABASE_PUBLISHABLE_KEY : undefined);
  const turnstileSiteKey =
    environment.VITE_TURNSTILE_SITE_KEY ??
    (appEnvironment === "local" ? "1x00000000000000000000AA" : undefined);

  if (supabaseUrl !== SUPABASE_URLS[appEnvironment]) {
    throw new Error(`URL de Supabase incorrecta para ${appEnvironment}.`);
  }
  if (!publishableKey?.startsWith("sb_publishable_")) {
    throw new Error("El navegador exige una clave publicable de Supabase.");
  }
  if (sha256(publishableKey) !== PUBLISHABLE_KEY_SHA256[appEnvironment]) {
    throw new Error(`Clave publicable de Supabase incorrecta para ${appEnvironment}.`);
  }
  if (!turnstileSiteKey) {
    throw new Error("Falta la clave pública de Turnstile.");
  }
  const expectedTurnstileSiteKey =
    appEnvironment === "production"
      ? TURNSTILE_PRODUCTION_SITE_KEY
      : TURNSTILE_TEST_SITE_KEY;
  if (turnstileSiteKey !== expectedTurnstileSiteKey) {
    throw new Error(`Clave de Turnstile incorrecta para ${appEnvironment}.`);
  }

  for (const [name, value] of Object.entries(environment)) {
    if (name.startsWith("VITE_") && value !== undefined) {
      assertPublicContent(value, name);
    }
  }

  return {
    appEnvironment,
    deployTarget,
    publishableKey,
    supabaseUrl,
    turnstileSiteKey,
  };
}

export async function checkPublicBundle(directory, configuration) {
  async function visit(path) {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const entryPath = resolve(path, entry.name);
      if (entry.isDirectory()) {
        await visit(entryPath);
        continue;
      }
      if (!entry.isFile()) continue;

      const content = await readFile(entryPath);
      if (!content.includes(0)) {
        const text = content.toString("utf8");
        assertPublicContent(text, entryPath);
        for (const [environment, url] of Object.entries(SUPABASE_URLS)) {
          if (
            configuration &&
            environment !== configuration.appEnvironment &&
            text.includes(url)
          ) {
            throw new Error(
              `El bundle contiene la URL del entorno ${environment}: ${entryPath}.`,
            );
          }
        }
      }
    }
  }

  await visit(resolve(directory));
}

export function renderPagesHeaders(configuration) {
  const supabase = new URL(configuration.supabaseUrl);
  const websocketProtocol = supabase.protocol === "https:" ? "wss:" : "ws:";
  const websocketOrigin = `${websocketProtocol}//${supabase.host}`;
  const csp = [
    "default-src 'self'",
    "base-uri 'none'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "script-src 'self' https://challenges.cloudflare.com",
    "frame-src https://challenges.cloudflare.com",
    `connect-src 'self' ${supabase.origin} ${websocketOrigin} https://challenges.cloudflare.com`,
    `img-src 'self' data: blob: ${supabase.origin}`,
    "style-src 'self'",
    "font-src 'self'",
    "manifest-src 'self'",
    "worker-src 'self' blob:",
    ...(configuration.appEnvironment === "production"
      ? ["upgrade-insecure-requests"]
      : []),
  ].join("; ");
  const headers = [
    "/*",
    `  Access-Control-Allow-Origin: ${FRONTEND_ORIGINS[configuration.appEnvironment]}`,
    "  Vary: Origin",
    `  Content-Security-Policy: ${csp}`,
    "  Referrer-Policy: no-referrer",
    "  X-Content-Type-Options: nosniff",
    "  Permissions-Policy: camera=(self), microphone=(), geolocation=(), payment=()",
  ];

  if (configuration.appEnvironment === "production") {
    headers.push("  Strict-Transport-Security: max-age=31536000; includeSubDomains");
  }

  return `${headers.join("\n")}\n`;
}

async function main() {
  const configuration = resolvePublicEnvironment(process.env);
  await checkPublicBundle(process.argv[2] ?? "apps/web/dist", configuration);
  process.stdout.write("Entorno público y bundle verificados.\n");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
