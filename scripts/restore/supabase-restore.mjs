import { spawn } from "node:child_process";
import { chmod, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  canonicalJson,
  signOperatorAttestation,
  verifyRecoverySet,
} from "../backup/recovery-set.mjs";
import {
  verifyAdminAuditClosure,
  verifyDeletionTombstones,
  verifyLedgerContinuity,
} from "../operations/ledger-verifiers.mjs";
import { assertRestoreTargetIdentity } from "../operations/supabase-project-identity.mjs";
import { assertIsolatedRestoreTarget } from "./restore-recovery-set.mjs";

const decoder = new TextDecoder();
const PROFILE_UUID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;

function requiredObject(objects, type) {
  const matching = objects.filter((object) => object.type === type);
  if (matching.length !== 1) throw new Error(`${type}_object_required`);
  return matching[0];
}

function jsonObject(bytes, code) {
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

export function runPgRestore({ args, environment }) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn("pg_restore", args, {
      env: { PATH: process.env.PATH, PGDATABASE: environment.PGDATABASE },
      stdio: ["ignore", "ignore", "pipe"],
    });
    child.stderr.resume();
    child.once("error", () => reject(new Error("pg_restore_unavailable")));
    child.once("close", (code) => {
      if (code === 0) resolvePromise();
      else reject(new Error("pg_restore_failed"));
    });
  });
}

function storageIdentity(logicalPath) {
  const parts = logicalPath.split("/");
  if (parts.length < 3 || parts[0] !== "storage") {
    throw new Error("invalid_storage_logical_path");
  }
  return { bucket: parts[1], path: parts.slice(2).join("/") };
}

export async function restoreSupabaseRecoverySet(input, dependencies) {
  assertRestoreTargetIdentity({
    knownProjectRefs: input.knownProjectRefs,
    targetDatabaseUrl: input.databaseUrl,
    targetFingerprint: input.targetFingerprint,
    targetRef: input.targetRef,
    targetSupabaseUrl: input.targetSupabaseUrl,
  });
  const targetPath = await assertIsolatedRestoreTarget(input);
  await dependencies.assertDatabaseEmpty();
  const verified = await verifyRecoverySet({
    directory: input.directory,
    keyring: input.keyring,
    ledgerHeadProvider: input.ledgerHeadProvider,
  });
  if (!["local", "development"].includes(verified.manifest.sourceEnvironment)) {
    throw new Error("restore_source_environment_forbidden");
  }
  const storageObjects = verified.decryptedObjects.filter(
    (object) => object.type === "storage",
  );
  if (storageObjects.some((object) => !/^[a-f0-9]{64}$/.test(object.profileMarker))) {
    throw new Error("storage_profile_marker_required");
  }
  for (const object of storageObjects) {
    const profileId = storageIdentity(object.logicalPath).path.split("/", 1)[0];
    if (
      !PROFILE_UUID.test(profileId) ||
      !(await dependencies.isStorageProfileMarkerValid?.({
        profileId,
        profileMarker: object.profileMarker,
      }))
    ) {
      throw new Error("storage_profile_marker_binding_invalid");
    }
  }
  await dependencies.onRecoveryVerified?.(verified);
  const database = requiredObject(verified.decryptedObjects, "database");
  const deletions = jsonObject(
    requiredObject(verified.decryptedObjects, "deletions-ledger").bytes,
    "invalid_deletions_ledger",
  );
  const audit = jsonObject(
    requiredObject(verified.decryptedObjects, "admin-audit-ledger").bytes,
    "invalid_admin_audit_ledger",
  );
  if (
    !Array.isArray(deletions.records) ||
    !Array.isArray(audit.records) ||
    !Array.isArray(audit.pendingIntents) ||
    !Array.isArray(audit.incompleteRanges) ||
    audit.pendingIntents.length > 0 ||
    audit.incompleteRanges.length > 0
  ) {
    throw new Error("restore_ledger_not_closed");
  }
  const deletionRecords = [
    ...deletions.records,
    ...verified.ledgerHeads.deletions.suffixRecords,
  ];
  const auditRecords = [
    ...audit.records,
    ...verified.ledgerHeads["admin-audit"].suffixRecords,
  ];
  const deletionState = verifyDeletionTombstones(
    deletionRecords,
    input.knownTombstoneKeyVersions,
  );
  if (deletionState.incompleteAuditRanges.length > 0) {
    throw new Error("incomplete_audit_range");
  }
  verifyLedgerContinuity(auditRecords, {
    gaps: deletionState.completedAuditRanges,
    stream: "admin-audit",
  });
  const auditClosure = verifyAdminAuditClosure(auditRecords);
  if (auditClosure.pendingRequestIds.length > 0) {
    throw new Error("restore_ledger_not_closed");
  }
  const deletedMarkers = new Set(deletionState.activeProfileMarkers);
  const dumpPath = join(targetPath, "postgres.restore.dump");
  try {
    await writeFile(dumpPath, database.bytes, { flag: "wx", mode: 0o600 });
    await chmod(dumpPath, 0o600);
    await (dependencies.runPgRestore ?? runPgRestore)({
      args: ["--exit-on-error", dumpPath],
      environment: { PGDATABASE: input.databaseUrl },
      inputPath: dumpPath,
    });
  } finally {
    await rm(dumpPath, { force: true });
  }

  await dependencies.applyCurrentMigrations();
  await dependencies.onDatabaseRestored?.();
  await dependencies.applyTombstones([...deletedMarkers].sort());
  await dependencies.applyAuditRecords(auditRecords);
  await dependencies.revokeSessions();
  let restoredStorageObjects = 0;
  let suppressedStorageObjects = 0;
  for (const object of storageObjects) {
    if (object.profileMarker && deletedMarkers.has(object.profileMarker)) {
      suppressedStorageObjects += 1;
      continue;
    }
    const identity = storageIdentity(object.logicalPath);
    await dependencies.uploadStorageObject({ ...identity, bytes: object.bytes });
    restoredStorageObjects += 1;
  }
  await dependencies.registerValidationKey({
    keyVersion: input.keyring.signingKeyVersion,
  });
  const invariants = await dependencies.verifyAbsenceAndSecurity({
    deletedMarkers: [...deletedMarkers].sort(),
    expectedStorageObjects: restoredStorageObjects,
  });
  if (
    invariants.aal2Required !== true ||
    invariants.deletedProfilesAbsent !== true ||
    invariants.rlsVerified !== true ||
    !/^[a-f0-9]{64}$/.test(invariants.securityPolicyDigest) ||
    invariants.sessionsRevoked !== true ||
    invariants.storageComplete !== true
  ) {
    throw new Error("restore_invariant_failed");
  }
  if (
    typeof input.backupJobId !== "string" ||
    typeof input.restoreJobId !== "string" ||
    !/^[a-f0-9]{64}$/.test(input.targetFingerprint)
  ) {
    throw new Error("restore_promotion_identity_required");
  }
  const unsigned = {
    backupId: verified.envelope.backupId,
    restoredStorageObjects,
    status: "ready_for_promotion",
    suppressedStorageObjects,
    targetEnvironment: "local-isolated",
    targetRef: input.targetRef,
    trafficEnabled: false,
  };
  const promotionPayload = {
    aal2Required: true,
    adminAuditHead: verified.ledgerHeads["admin-audit"].current.recordHash,
    backupJobId: input.backupJobId,
    deletedProfilesAbsent: true,
    deletionsHead: verified.ledgerHeads.deletions.current.recordHash,
    incompleteRanges: 0,
    manifestDigest: verified.envelope.manifest.plaintextHash,
    pendingIntents: 0,
    restoreJobId: input.restoreJobId,
    rlsVerified: true,
    schemaVersion: 1,
    securityPolicyDigest: invariants.securityPolicyDigest,
    sessionsRevoked: true,
    storageComplete: true,
    targetFingerprint: input.targetFingerprint,
    targetIsolated: true,
    trafficEnabled: false,
  };
  return {
    ...unsigned,
    attestation: await signOperatorAttestation(input.keyring, unsigned),
    promotion: {
      attestation: await signOperatorAttestation(input.keyring, promotionPayload),
      payload: promotionPayload,
    },
    validationDigest: await crypto.subtle
      .digest("SHA-256", new TextEncoder().encode(canonicalJson(promotionPayload)))
      .then((bytes) => Buffer.from(bytes).toString("hex")),
  };
}
