import { createHash } from "node:crypto";

const PROJECT_REF = /^[a-z0-9]{20}$/;

function parsedUrl(value, protocols, code) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(code);
  }
  if (
    !protocols.has(url.protocol) ||
    url.hash ||
    (url.pathname !== "/" && protocols.has("https:"))
  ) {
    throw new Error(code);
  }
  return url;
}

function loopback(hostname) {
  return ["127.0.0.1", "[::1]", "localhost"].includes(hostname);
}

function supabaseIdentity(value, allowLoopback) {
  const url = parsedUrl(
    value,
    allowLoopback ? new Set(["http:", "https:"]) : new Set(["https:"]),
    "invalid_supabase_url",
  );
  if (url.username || url.password || url.search) {
    throw new Error("invalid_supabase_url");
  }
  const match = /^([a-z0-9]{20})\.supabase\.co$/.exec(url.hostname);
  if (match) return { key: `project:${match[1]}`, origin: url.origin };
  if (allowLoopback && loopback(url.hostname)) {
    return { key: `loopback:${url.hostname}`, origin: url.origin };
  }
  throw new Error("invalid_supabase_url");
}

function databaseIdentity(value, allowLoopback) {
  const url = parsedUrl(
    value,
    new Set(["postgres:", "postgresql:"]),
    "invalid_database_url",
  );
  const direct = /^db\.([a-z0-9]{20})\.supabase\.co$/.exec(url.hostname);
  const pooled =
    url.hostname.endsWith(".pooler.supabase.com") &&
    PROJECT_REF.test(url.username.split(".").at(-1) ?? "")
      ? url.username.split(".").at(-1)
      : undefined;
  const key = direct?.[1] ?? pooled;
  if (key) {
    return {
      descriptor: {
        database: url.pathname.slice(1),
        host: url.hostname,
        port: url.port,
        protocol: url.protocol,
        user: url.username,
      },
      key: `project:${key}`,
    };
  }
  if (allowLoopback && loopback(url.hostname)) {
    return {
      descriptor: {
        database: url.pathname.slice(1),
        host: url.hostname,
        port: url.port,
        protocol: url.protocol,
        user: url.username,
      },
      key: `loopback:${url.hostname}`,
    };
  }
  throw new Error("invalid_database_url");
}

export function assertBackupSourceIdentity(input) {
  if (
    !PROJECT_REF.test(input.projectRef) ||
    !PROJECT_REF.test(input.productionProjectRef)
  ) {
    throw new Error("backup_source_identity_mismatch");
  }
  let storage;
  let database;
  try {
    storage = supabaseIdentity(input.supabaseUrl, false);
    database = databaseIdentity(input.databaseUrl, false);
  } catch {
    throw new Error("backup_source_identity_mismatch");
  }
  const expected = `project:${input.projectRef}`;
  if (
    storage.key !== expected ||
    database.key !== expected ||
    input.projectRef === input.productionProjectRef
  ) {
    throw new Error("backup_source_identity_mismatch");
  }
  return input.projectRef;
}

export function targetIdentityFingerprint(input) {
  let storage;
  let database;
  try {
    storage = supabaseIdentity(input.targetSupabaseUrl, true);
    database = databaseIdentity(input.targetDatabaseUrl, true);
  } catch {
    throw new Error("restore_target_identity_mismatch");
  }
  if (
    storage.key !== database.key ||
    !Array.isArray(input.knownProjectRefs) ||
    input.knownProjectRefs.includes(storage.key.replace(/^project:/, "")) ||
    input.knownProjectRefs.includes(input.targetRef)
  ) {
    throw new Error("restore_target_identity_mismatch");
  }
  return createHash("sha256")
    .update(
      JSON.stringify({
        database: database.descriptor,
        storageOrigin: storage.origin,
        targetRef: input.targetRef,
      }),
    )
    .digest("hex");
}

export function assertRestoreTargetIdentity(input) {
  const fingerprint = targetIdentityFingerprint(input);
  if (fingerprint !== input.targetFingerprint) {
    throw new Error("restore_target_identity_mismatch");
  }
  return fingerprint;
}
