#!/usr/bin/env node
import { createLiveLedgerHeadProvider } from "../backup/live-ledger-heads.mjs";
import {
  parseArguments,
  printResult,
  readOperatorBundle,
  requiredValue,
} from "../backup/operator-input.mjs";
import { createOperatorJobs } from "../operations/operator-jobs.mjs";
import { assertRestoreTargetIdentity } from "../operations/supabase-project-identity.mjs";
import {
  clearQuarantinedRetry,
  prepareQuarantinedRetry,
  quarantineFailedRestore,
} from "./restore-failure.mjs";
import { createSupabaseRestoreDependencies } from "./supabase-operator-adapter.mjs";
import { restoreSupabaseRecoverySet } from "./supabase-restore.mjs";

function bytea(hex) {
  return `\\x${hex}`;
}

const parsed = parseArguments(process.argv.slice(2));
let dependencies;
let job;
let jobs;
let restoreId;
let targetDirectory;
try {
  restoreId = requiredValue(parsed, "--restore-id");
  const backupId = requiredValue(parsed, "--backup-id");
  const targetFingerprint = requiredValue(parsed, "--target-fingerprint");
  const targetRef = requiredValue(parsed, "--target-ref");
  targetDirectory = requiredValue(parsed, "--target-directory");
  const directory = requiredValue(parsed, "--backup");
  if (requiredValue(parsed, "--target-environment") !== "local-isolated") {
    throw new Error("restore_target_not_isolated");
  }
  printResult({
    backupId,
    mode: parsed.flags.has("--apply") ? "apply" : "dry-run",
    restoreId,
    targetEnvironment: "local-isolated",
    targetRef,
    trafficEnabled: false,
  });
  if (!parsed.flags.has("--apply")) process.exit(0);
  if (parsed.values.get("--confirm") !== restoreId) {
    throw new Error("restore_confirmation_mismatch");
  }
  if (!parsed.flags.has("--secrets-stdin")) {
    throw new Error("operator_secrets_stdin_required");
  }
  const { bundle, keyring } = await readOperatorBundle({ requirePrivate: true });
  if (
    !Array.isArray(bundle.knownProjectRefs) ||
    !bundle.knownProjectRefs.includes(bundle.projectRef) ||
    !bundle.knownProjectRefs.includes(bundle.productionProjectRef)
  ) {
    throw new Error("known_project_refs_required");
  }
  const targetIdentity = {
    knownProjectRefs: bundle.knownProjectRefs,
    targetDatabaseUrl: bundle.targetDatabaseUrl,
    targetFingerprint,
    targetRef,
    targetSupabaseUrl: bundle.targetSupabaseUrl,
  };
  assertRestoreTargetIdentity(targetIdentity);
  jobs = createOperatorJobs(bundle);
  job = await jobs.createRestore(restoreId, backupId, targetFingerprint);
  const retryingQuarantined = job.status === "blocked" || job.status === "failed";
  if (retryingQuarantined) {
    if (!parsed.flags.has("--retry-quarantined")) {
      throw new Error("restore_retry_confirmation_required");
    }
    await prepareQuarantinedRetry({ restoreId, targetDirectory });
  }
  job = await jobs.transitionRestore(restoreId, job.version, "verifying");
  if (retryingQuarantined) {
    await clearQuarantinedRetry({ restoreId, targetDirectory });
  }
  dependencies = createSupabaseRestoreDependencies(
    { ...bundle, ...targetIdentity },
    { operatorJobs: jobs },
  );
  dependencies.onRecoveryVerified = async () => {
    job = await jobs.transitionRestore(restoreId, job.version, "restoring");
  };
  dependencies.onDatabaseRestored = async () => {
    job = await jobs.transitionRestore(restoreId, job.version, "validating");
  };
  const result = await restoreSupabaseRecoverySet(
    {
      backupJobId: backupId,
      databaseUrl: bundle.targetDatabaseUrl,
      directory,
      keyring,
      knownProjectRefs: bundle.knownProjectRefs,
      knownTombstoneKeyVersions: new Set(
        Object.keys(bundle.tombstoneHmacKeys).map(Number),
      ),
      ledgerHeadProvider: createLiveLedgerHeadProvider(bundle),
      restoreJobId: restoreId,
      targetDirectory,
      targetEnvironment: "local-isolated",
      targetFingerprint,
      targetRef,
      targetSupabaseUrl: bundle.targetSupabaseUrl,
    },
    dependencies,
  );
  const payloadBytes = new TextEncoder().encode(
    JSON.stringify(
      Object.fromEntries(
        Object.entries(result.promotion.payload).sort(([left], [right]) =>
          left.localeCompare(right, "en"),
        ),
      ),
    ),
  );
  job = await jobs.transitionRestore(restoreId, job.version, "ready_for_promotion", {
    p_admin_audit_head: bytea(result.promotion.payload.adminAuditHead),
    p_deleted_profiles_absent: true,
    p_deletions_head: bytea(result.promotion.payload.deletionsHead),
    p_incomplete_ranges: 0,
    p_manifest_digest: bytea(result.promotion.payload.manifestDigest),
    p_pending_intents: 0,
    p_rls_verified: true,
    p_sessions_revoked: true,
    p_storage_complete: true,
    p_target_fingerprint: bytea(targetFingerprint),
    p_validation_digest: bytea(result.validationDigest),
    p_validation_key_version: result.promotion.attestation.keyVersion,
    p_validation_payload: bytea(Buffer.from(payloadBytes).toString("hex")),
    p_validation_signature: bytea(
      Buffer.from(result.promotion.attestation.signature, "base64").toString("hex"),
    ),
  });
  printResult({
    restoreId,
    status: job.status,
    trafficEnabled: false,
  });
} catch (error) {
  const recovery =
    restoreId && targetDirectory && jobs && job
      ? await quarantineFailedRestore({
          dependencies,
          job,
          jobs,
          restoreId,
          targetDirectory,
        })
      : {
          jobBlocked: false,
          sessionsRevoked: false,
          targetQuarantined: false,
        };
  process.stderr.write(
    `${JSON.stringify({
      error: error instanceof Error ? error.message : "restore_failed",
      ...recovery,
      status: "RESTORE_FAILED",
    })}\n`,
  );
  process.exitCode = 1;
}
