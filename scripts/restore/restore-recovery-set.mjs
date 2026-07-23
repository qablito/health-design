import { chmod, lstat, mkdir, readdir, realpath, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import {
  assertContainedPath,
  assertSafeLogicalPath,
  canonicalJson,
  verifyRecoverySet,
} from "../backup/recovery-set.mjs";

const decoder = new TextDecoder();

function parseJsonObject(bytes, code) {
  let value;
  try {
    value = JSON.parse(decoder.decode(bytes));
  } catch {
    throw new Error(code);
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(code);
  }
  return value;
}

export async function assertIsolatedRestoreTarget({
  knownProjectRefs,
  targetDirectory,
  targetEnvironment,
  targetRef,
}) {
  if (targetEnvironment !== "local-isolated") {
    throw new Error("restore_target_not_isolated");
  }
  if (
    typeof targetRef !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(targetRef)
  ) {
    throw new Error("invalid_target_ref");
  }
  if (
    !Array.isArray(knownProjectRefs) ||
    knownProjectRefs.some((value) => typeof value !== "string")
  ) {
    throw new Error("known_project_refs_required");
  }
  if (knownProjectRefs.includes(targetRef)) throw new Error("known_project_ref");

  const targetPath = resolve(targetDirectory);
  const targetStat = await lstat(targetPath);
  if (targetStat.isSymbolicLink()) throw new Error("restore_target_symlink");
  if (!targetStat.isDirectory()) throw new Error("restore_target_not_directory");
  await realpath(targetPath);
  if ((await readdir(targetPath)).length > 0) {
    throw new Error("restore_target_not_empty");
  }
  await chmod(targetPath, 0o700);
  return targetPath;
}

function requireObject(objects, type) {
  const matching = objects.filter((object) => object.type === type);
  if (matching.length !== 1) throw new Error(`${type}_object_required`);
  return matching[0];
}

function stableAudit(records) {
  const byId = new Map();
  for (const record of records) {
    if (
      !record ||
      typeof record !== "object" ||
      typeof record.id !== "string" ||
      !Number.isInteger(record.sequence)
    ) {
      throw new Error("invalid_audit_record");
    }
    byId.set(record.id, record);
  }
  return [...byId.values()].sort(
    (left, right) =>
      left.sequence - right.sequence || left.id.localeCompare(right.id, "en"),
  );
}

function validateDatabaseFixture(database) {
  if (
    !Array.isArray(database.profiles) ||
    !Array.isArray(database.sessions) ||
    !Array.isArray(database.audit) ||
    database.security?.rlsEnabled !== true ||
    database.security?.aal2Required !== true
  ) {
    throw new Error("restored_database_invariant_failed");
  }
}

async function restoreStorageObject(targetPath, object) {
  const logicalPath = assertSafeLogicalPath(object.logicalPath);
  const outputPath = join(targetPath, logicalPath);
  assertContainedPath(targetPath, outputPath);
  await mkdir(dirname(outputPath), { mode: 0o700, recursive: true });
  const parent = await lstat(dirname(outputPath));
  if (parent.isSymbolicLink()) throw new Error("restore_path_symlink");
  await writeFile(outputPath, object.bytes, { flag: "wx", mode: 0o600 });
  return logicalPath;
}

export async function restoreFixtureRecoverySet(input) {
  const targetPath = await assertIsolatedRestoreTarget(input);
  const verified = await verifyRecoverySet({
    directory: input.directory,
    keyring: input.keyring,
    remoteLedgerHeads: input.remoteLedgerHeads,
  });
  const databaseObject = requireObject(verified.decryptedObjects, "database");
  const deletionObject = requireObject(verified.decryptedObjects, "deletions-ledger");
  const auditObject = requireObject(verified.decryptedObjects, "admin-audit-ledger");
  const database = parseJsonObject(databaseObject.bytes, "invalid_database_fixture");
  const deletions = parseJsonObject(deletionObject.bytes, "invalid_deletions_ledger");
  const adminAudit = parseJsonObject(auditObject.bytes, "invalid_admin_audit_ledger");

  if (
    !Array.isArray(deletions.records) ||
    !Array.isArray(adminAudit.records) ||
    !Array.isArray(adminAudit.pendingIntents) ||
    !Array.isArray(adminAudit.incompleteRanges)
  ) {
    throw new Error("invalid_ledger_shape");
  }
  if (adminAudit.pendingIntents.length > 0) {
    throw new Error("pending_ledger_intent");
  }
  if (adminAudit.incompleteRanges.length > 0) {
    throw new Error("incomplete_audit_range");
  }
  const deletedMarkers = new Set(
    deletions.records.map((record) => {
      if (
        !record ||
        typeof record !== "object" ||
        typeof record.profileMarker !== "string" ||
        record.profileMarker.length === 0
      ) {
        throw new Error("invalid_deletion_tombstone");
      }
      return record.profileMarker;
    }),
  );
  validateDatabaseFixture(database);

  database.profiles = database.profiles.filter((profile) => {
    if (!profile || typeof profile.marker !== "string") {
      throw new Error("invalid_profile_marker");
    }
    return !deletedMarkers.has(profile.marker);
  });
  database.sessions = database.sessions.map((session) => ({
    ...session,
    revoked: true,
  }));
  database.audit = stableAudit([...database.audit, ...adminAudit.records]);

  const restoredStoragePaths = [];
  for (const object of verified.decryptedObjects.filter(
    (candidate) => candidate.type === "storage",
  )) {
    if (
      object.profileMarker !== undefined &&
      deletedMarkers.has(object.profileMarker)
    ) {
      continue;
    }
    restoredStoragePaths.push(await restoreStorageObject(targetPath, object));
  }
  restoredStoragePaths.sort((left, right) => left.localeCompare(right, "en"));

  const result = {
    backupId: verified.envelope.backupId,
    database,
    restoredStoragePaths,
    status: "ready_for_promotion",
    targetEnvironment: "local-isolated",
    targetRef: input.targetRef,
    trafficEnabled: false,
  };
  await writeFile(
    join(targetPath, "restore-validation.json"),
    `${canonicalJson(result)}\n`,
    { flag: "wx", mode: 0o600 },
  );
  return result;
}
