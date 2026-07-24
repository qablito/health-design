#!/usr/bin/env node
import { pathToFileURL } from "node:url";

const DEVELOPMENT_PROJECT_REF = "nwoivdxdupklervtnovd";
const DEVELOPMENT_URL = `https://${DEVELOPMENT_PROJECT_REF}.supabase.co`;
const PRODUCTION_PROJECT_REF = "rbfrpgafytexrarcfmmp";
const PRODUCTION_URL = `https://${PRODUCTION_PROJECT_REF}.supabase.co`;

export const T18_REMOTE_STAGES = Object.freeze([
  "crear y verificar copia precrítica mediante autorización independiente",
  "aplicar migraciones y funciones únicamente en Development",
  "borrar un perfil sintético y verificar tombstone, purga y ausencia",
  "crear cuatro copias completas y restaurarlas en destinos locales aislados",
  "probar un rango admin-audit sintético con credencial JIT",
  "ejecutar cleanup Auth dry-run y solicitar autorización separada para apply",
  "medir RPO/RTO y confirmar cero residuos sintéticos",
]);

export function assertT18DevelopmentBoundary(environment = process.env) {
  const values = [
    environment.SUPABASE_URL,
    environment.SUPABASE_PROJECT_REF,
    environment.PRODUCTION_PROJECT_REF,
  ].filter(Boolean);
  if (
    values.some(
      (value) =>
        value === PRODUCTION_URL ||
        value === PRODUCTION_PROJECT_REF ||
        value.includes(PRODUCTION_PROJECT_REF),
    )
  ) {
    throw new Error("production_is_forbidden");
  }
  if (
    environment.SUPABASE_URL !== undefined &&
    environment.SUPABASE_URL !== DEVELOPMENT_URL
  ) {
    throw new Error("development_url_required");
  }
  if (
    environment.SUPABASE_PROJECT_REF !== undefined &&
    environment.SUPABASE_PROJECT_REF !== DEVELOPMENT_PROJECT_REF
  ) {
    throw new Error("development_project_required");
  }
}

export function t18RemoteDryRun(environment = process.env) {
  assertT18DevelopmentBoundary(environment);
  return Object.freeze({
    allowedEnvironment: {
      projectRef: DEVELOPMENT_PROJECT_REF,
      url: DEVELOPMENT_URL,
    },
    forbiddenEnvironment: {
      projectRef: PRODUCTION_PROJECT_REF,
      url: PRODUCTION_URL,
    },
    mode: "dry-run",
    mutations: false,
    network: false,
    secretsRequired: false,
    stages: T18_REMOTE_STAGES,
    status: "T18_REMOTE_PREFLIGHT_READY",
  });
}

function main() {
  const arguments_ = process.argv.slice(2).filter((argument) => argument !== "--");
  if (
    arguments_.length > 1 ||
    (arguments_.length === 1 && arguments_[0] !== "--dry-run")
  ) {
    throw new Error("t18_remote_activation_requires_separate_authorizations");
  }
  process.stdout.write(`${JSON.stringify(t18RemoteDryRun(), null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    process.stderr.write(
      `${JSON.stringify({
        error: error instanceof Error ? error.message : "t18_remote_preflight_failed",
        status: "T18_REMOTE_PREFLIGHT_FAILED",
      })}\n`,
    );
    process.exitCode = 1;
  }
}
