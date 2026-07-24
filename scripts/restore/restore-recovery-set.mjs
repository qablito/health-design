import { chmod, lstat, mkdir, readdir, realpath, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import {
  assertContainedPath,
  assertSafeLogicalPath,
  canonicalJson,
  signOperatorAttestation,
  verifyOperatorAttestation,
  verifyRecoverySet,
} from "../backup/recovery-set.mjs";
import {
  verifyDeletionTombstones,
  verifyLedgerContinuity,
} from "../operations/ledger-verifiers.mjs";
import { SECURITY_POLICY_MANIFEST_DIGEST } from "./supabase-operator-adapter.mjs";

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
    knownProjectRefs.length === 0 ||
    new Set(knownProjectRefs).size !== knownProjectRefs.length ||
    knownProjectRefs.some(
      (value) =>
        typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value),
    )
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

function assertLedgerHead(actual, embedded, remote, code) {
  if (
    !embedded ||
    !remote ||
    embedded.hash !== actual.head ||
    embedded.sequence !== actual.sequence ||
    remote.hash !== actual.head ||
    remote.sequence !== actual.sequence
  ) {
    throw new Error(code);
  }
}

function stableAudit(records) {
  const byId = new Map();
  const bySequence = new Map();
  for (const record of records) {
    if (
      !record ||
      typeof record !== "object" ||
      typeof record.id !== "string" ||
      !Number.isInteger(record.sequence)
    ) {
      throw new Error("invalid_audit_record");
    }
    const existingId = byId.get(record.id);
    if (existingId && canonicalJson(existingId) !== canonicalJson(record)) {
      throw new Error("audit_record_collision");
    }
    const existingSequence = bySequence.get(record.sequence);
    if (existingSequence && canonicalJson(existingSequence) !== canonicalJson(record)) {
      throw new Error("audit_sequence_collision");
    }
    byId.set(record.id, record);
    bySequence.set(record.sequence, record);
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
    database.security?.aal2Required !== true ||
    database.security?.policyDigest !== SECURITY_POLICY_MANIFEST_DIGEST
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
    ledgerHeadProvider: input.ledgerHeadProvider,
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
    !Array.isArray(adminAudit.incompleteRanges) ||
    (adminAudit.completedRanges !== undefined &&
      !Array.isArray(adminAudit.completedRanges))
  ) {
    throw new Error("invalid_ledger_shape");
  }
  if (adminAudit.pendingIntents.length > 0) {
    throw new Error("pending_ledger_intent");
  }
  if (adminAudit.incompleteRanges.length > 0) {
    throw new Error("incomplete_audit_range");
  }
  if (!(input.knownTombstoneKeyVersions instanceof Set)) {
    throw new Error("known_tombstone_key_versions_required");
  }
  const deletionHead = verifyDeletionTombstones(
    [...deletions.records, ...verified.ledgerHeads.deletions.suffixRecords],
    input.knownTombstoneKeyVersions,
  );
  if (deletionHead.incompleteAuditRanges.length > 0) {
    throw new Error("incomplete_audit_range");
  }
  const completeAuditRecords = [
    ...adminAudit.records,
    ...verified.ledgerHeads["admin-audit"].suffixRecords,
  ];
  const auditHead = verifyLedgerContinuity(completeAuditRecords, {
    gaps: deletionHead.completedAuditRanges,
    stream: "admin-audit",
  });
  const embeddedDeletionHead = verifyLedgerContinuity(deletions.records, {
    stream: "deletions",
  });
  const embeddedAuditHead = verifyLedgerContinuity(adminAudit.records, {
    gaps: adminAudit.completedRanges ?? [],
    stream: "admin-audit",
  });
  assertLedgerHead(
    embeddedDeletionHead,
    deletions.head,
    {
      hash: verified.ledgerHeads.deletions.requested.recordHash,
      sequence: verified.ledgerHeads.deletions.requested.sequence,
    },
    "deletions_ledger_head_mismatch",
  );
  assertLedgerHead(
    embeddedAuditHead,
    adminAudit.head,
    {
      hash: verified.ledgerHeads["admin-audit"].requested.recordHash,
      sequence: verified.ledgerHeads["admin-audit"].requested.sequence,
    },
    "admin_audit_ledger_head_mismatch",
  );
  if (
    deletionHead.head !== verified.ledgerHeads.deletions.current.recordHash ||
    deletionHead.sequence !== verified.ledgerHeads.deletions.current.sequence
  ) {
    throw new Error("deletions_ledger_current_head_mismatch");
  }
  if (
    auditHead.head !== verified.ledgerHeads["admin-audit"].current.recordHash ||
    auditHead.sequence !== verified.ledgerHeads["admin-audit"].current.sequence
  ) {
    throw new Error("admin_audit_ledger_current_head_mismatch");
  }
  const deletedMarkers = new Set(deletionHead.activeProfileMarkers);
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
  database.audit = stableAudit([
    ...database.audit,
    ...completeAuditRecords.map((record) =>
      typeof record.payload.id === "string"
        ? { id: record.payload.id, sequence: record.sequence }
        : {
            ...record.payload,
            id: `${record.payload.requestId}:${record.payload.phase}`,
            sequence: record.sequence,
          },
    ),
  ]);

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

  const unsignedResult = {
    backupId: verified.envelope.backupId,
    database,
    restoredStoragePaths,
    status: "ready_for_promotion",
    targetEnvironment: "local-isolated",
    targetRef: input.targetRef,
    trafficEnabled: false,
  };
  if (
    typeof input.backupJobId !== "string" ||
    typeof input.restoreJobId !== "string" ||
    typeof input.targetFingerprint !== "string" ||
    !/^[a-f0-9]{64}$/.test(input.targetFingerprint)
  ) {
    throw new Error("restore_promotion_identity_required");
  }
  const promotionPayload = {
    aal2Required: true,
    adminAuditHead: verified.ledgerHeads["admin-audit"].requested.recordHash,
    backupJobId: input.backupJobId,
    deletedProfilesAbsent: database.profiles.every(
      (profile) => !deletedMarkers.has(profile.marker),
    ),
    deletionsHead: verified.ledgerHeads.deletions.requested.recordHash,
    incompleteRanges: 0,
    manifestDigest: verified.envelope.manifest.plaintextHash,
    pendingIntents: 0,
    restoreJobId: input.restoreJobId,
    rlsVerified: database.security.rlsEnabled === true,
    schemaVersion: 1,
    securityPolicyDigest: database.security.policyDigest,
    sessionsRevoked: database.sessions.every((session) => session.revoked === true),
    storageComplete:
      restoredStoragePaths.length +
        verified.decryptedObjects.filter(
          (object) =>
            object.type === "storage" &&
            object.profileMarker !== undefined &&
            deletedMarkers.has(object.profileMarker),
        ).length ===
      verified.manifest.objects.filter((object) => object.type === "storage").length,
    targetFingerprint: input.targetFingerprint,
    targetIsolated: true,
    trafficEnabled: false,
  };
  const result = {
    ...unsignedResult,
    attestation: await signOperatorAttestation(input.keyring, unsignedResult),
    promotion: {
      attestation: await signOperatorAttestation(input.keyring, promotionPayload),
      payload: promotionPayload,
    },
  };
  await writeFile(
    join(targetPath, "restore-validation.json"),
    `${canonicalJson(result)}\n`,
    { flag: "wx", mode: 0o600 },
  );
  return result;
}

export async function verifyRestoreValidation(validation, keyring) {
  if (!validation || typeof validation !== "object" || Array.isArray(validation)) {
    throw new Error("restore_validation_failed");
  }
  const { attestation, promotion, ...unsigned } = validation;
  if (
    validation.status !== "ready_for_promotion" ||
    validation.targetEnvironment !== "local-isolated" ||
    validation.trafficEnabled !== false ||
    validation.database?.security?.rlsEnabled !== true ||
    validation.database?.security?.aal2Required !== true ||
    validation.database?.security?.policyDigest !== SECURITY_POLICY_MANIFEST_DIGEST ||
    !Array.isArray(validation.database?.sessions) ||
    validation.database.sessions.some((session) => session.revoked !== true) ||
    !(await verifyOperatorAttestation(keyring, unsigned, attestation)) ||
    !promotion ||
    !(await verifyOperatorAttestation(
      keyring,
      promotion.payload,
      promotion.attestation,
    )) ||
    promotion.payload?.targetIsolated !== true ||
    promotion.payload?.trafficEnabled !== false ||
    promotion.payload?.pendingIntents !== 0 ||
    promotion.payload?.incompleteRanges !== 0 ||
    promotion.payload?.sessionsRevoked !== true ||
    promotion.payload?.deletedProfilesAbsent !== true ||
    promotion.payload?.storageComplete !== true ||
    promotion.payload?.rlsVerified !== true ||
    promotion.payload?.aal2Required !== true ||
    promotion.payload?.securityPolicyDigest !== SECURITY_POLICY_MANIFEST_DIGEST
  ) {
    throw new Error("restore_validation_failed");
  }
  return true;
}
