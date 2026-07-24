#!/usr/bin/env node
import { lstat, mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";

import {
  createFixtureKeyring,
  createFixtureLedgerHead,
  createFixtureLedgerHeadProvider,
  createRecoverySet,
  verifyRecoverySet,
} from "./recovery-set.mjs";
import { createLiveLedgerHeadProvider } from "./live-ledger-heads.mjs";
import { captureLiveBackupInputs } from "./supabase-capture.mjs";
import { createOperatorJobs } from "../operations/operator-jobs.mjs";
import {
  parseArguments,
  printResult,
  readJson,
  readOperatorBundle,
  requiredValue,
} from "./operator-input.mjs";

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "health-design-t18-backup-"));
  try {
    const directory = join(root, "fixture-backup");
    const keyring = await createFixtureKeyring();
    const created = await createRecoverySet({
      backupId: "fixture-backup",
      createdAt: "2026-07-23T00:00:00.000Z",
      destinationDirectory: directory,
      keyVersion: 1,
      keyring,
      kind: "weekly",
      objects: [
        {
          bytes: new TextEncoder().encode('{"profiles":[]}'),
          logicalPath: "database/fixture.json",
          type: "database",
        },
        {
          bytes: new TextEncoder().encode('{"records":[]}'),
          logicalPath: "ledgers/deletions.json",
          prefix: { hash: "d".repeat(64), sequence: 0 },
          type: "deletions-ledger",
        },
        {
          bytes: new TextEncoder().encode(
            '{"incompleteRanges":[],"pendingIntents":[],"records":[]}',
          ),
          logicalPath: "ledgers/admin-audit.json",
          prefix: { hash: "a".repeat(64), sequence: 0 },
          type: "admin-audit-ledger",
        },
      ],
      schemaVersion: 18,
      sourceEnvironment: "local",
      storageInventory: [
        { bucket: "plan-exports", enumerated: true, logicalPaths: [] },
      ],
      toolVersion: "t18-fixture",
    });
    const prefixes = Object.fromEntries(
      created.manifest.objects
        .filter((object) => object.type.endsWith("-ledger"))
        .map((object) => [
          object.type === "deletions-ledger" ? "deletions" : "admin-audit",
          object.prefix,
        ]),
    );
    const heads = {
      "admin-audit": await createFixtureLedgerHead({
        environment: "local",
        ...prefixes["admin-audit"],
        keyring,
        stream: "admin-audit",
      }),
      deletions: await createFixtureLedgerHead({
        environment: "local",
        ...prefixes.deletions,
        keyring,
        stream: "deletions",
      }),
    };
    const verified = await verifyRecoverySet({
      directory,
      keyring,
      ledgerHeadProvider: createFixtureLedgerHeadProvider(heads),
    });
    printResult({
      backupId: verified.envelope.backupId,
      objectCount: verified.manifest.objects.length,
      status: "BACKUP_FIXTURE_PASS",
    });
  } finally {
    await rm(root, { force: true, recursive: true });
  }
}

async function createFromDescriptor(parsed) {
  const backupId = requiredValue(parsed, "--backup-id");
  const destinationDirectory = requiredValue(parsed, "--destination");
  const environment = requiredValue(parsed, "--environment");
  const descriptorPath = requiredValue(parsed, "--descriptor");
  const sourceRoot = await realpath(requiredValue(parsed, "--source-root"));
  const kind = requiredValue(parsed, "--kind");
  const confirmation = parsed.values.get("--confirm");
  if (!["local", "development"].includes(environment)) {
    throw new Error("backup_environment_forbidden");
  }
  printResult({
    backupId,
    destinationDirectory,
    environment,
    kind,
    mode: parsed.flags.has("--apply") ? "apply" : "dry-run",
  });
  if (!parsed.flags.has("--apply")) return;
  if (confirmation !== backupId) throw new Error("backup_confirmation_mismatch");
  if (!parsed.flags.has("--secrets-stdin")) {
    throw new Error("operator_secrets_stdin_required");
  }
  const descriptor = await readJson(descriptorPath, "invalid_backup_descriptor");
  if (!Array.isArray(descriptor.objects)) {
    throw new Error("invalid_backup_descriptor");
  }
  const { bundle, keyring } = await readOperatorBundle({ requirePrivate: true });
  const objects = await Promise.all(
    descriptor.objects.map(async (object) => {
      const sourceFile = resolve(object.sourceFile);
      const actualSourceFile = await realpath(sourceFile);
      const contained = relative(sourceRoot, actualSourceFile);
      if (
        contained.startsWith("..") ||
        contained === "" ||
        (await lstat(sourceFile)).isSymbolicLink()
      ) {
        throw new Error("backup_source_path_forbidden");
      }
      return {
        ...object,
        bytes: new Uint8Array(await readFile(actualSourceFile)),
        sourceFile: undefined,
      };
    }),
  );
  await createRecoverySet({
    backupId,
    createdAt: descriptor.createdAt,
    destinationDirectory,
    keyVersion: descriptor.keyVersion,
    keyring,
    kind,
    objects,
    schemaVersion: descriptor.schemaVersion,
    sourceEnvironment: environment,
    storageInventory: descriptor.storageInventory,
    toolVersion: descriptor.toolVersion,
  });
  const verified = await verifyRecoverySet({
    directory: destinationDirectory,
    keyring,
    ledgerHeadProvider: createLiveLedgerHeadProvider(bundle),
  });
  printResult({
    backupId,
    objectCount: verified.manifest.objects.length,
    status: "BACKUP_DESCRIPTOR_VERIFIED",
  });
}

async function createFromLiveSource(parsed) {
  const backupId = requiredValue(parsed, "--backup-id");
  const destinationDirectory = requiredValue(parsed, "--destination");
  const environment = requiredValue(parsed, "--environment");
  const kind = requiredValue(parsed, "--kind");
  const confirmation = parsed.values.get("--confirm");
  if (environment !== "development") {
    throw new Error("backup_environment_forbidden");
  }
  printResult({
    backupId,
    destinationDirectory,
    environment,
    kind,
    mode: parsed.flags.has("--apply") ? "apply" : "dry-run",
    source: "live",
  });
  if (!parsed.flags.has("--apply")) return;
  if (confirmation !== backupId) throw new Error("backup_confirmation_mismatch");
  if (!parsed.flags.has("--secrets-stdin")) {
    throw new Error("operator_secrets_stdin_required");
  }
  const { bundle, keyring } = await readOperatorBundle({ requirePrivate: true });
  const keyVersion = Number(requiredValue(parsed, "--key-version"));
  const schemaVersion = Number(requiredValue(parsed, "--schema-version"));
  const ledgerHeadProvider = createLiveLedgerHeadProvider(bundle);
  const jobs = createOperatorJobs(bundle);
  let job = await jobs.createBackup(backupId, kind);
  try {
    job = await jobs.transitionBackup(backupId, job.version, "capturing");
    const captured = await captureLiveBackupInputs(bundle, { ledgerHeadProvider });
    const created = await createRecoverySet({
      backupId,
      createdAt: new Date().toISOString(),
      destinationDirectory,
      keyVersion,
      keyring,
      kind,
      objects: captured.objects,
      schemaVersion,
      sourceEnvironment: environment,
      storageInventory: captured.storageInventory,
      toolVersion: "t18-live-v1",
    });
    job = await jobs.transitionBackup(backupId, job.version, "verifying");
    const verified = await verifyRecoverySet({
      directory: destinationDirectory,
      keyring,
      ledgerHeadProvider,
    });
    job = await jobs.transitionBackup(backupId, job.version, "ready", {
      p_key_version: keyVersion,
      p_manifest_digest: `\\x${created.envelope.manifest.plaintextHash}`,
    });
    printResult({
      backupId,
      objectCount: verified.manifest.objects.length,
      status: "BACKUP_READY",
    });
  } catch (error) {
    if (job?.status === "capturing" || job?.status === "verifying") {
      try {
        await jobs.transitionBackup(backupId, job.version, "failed", {
          p_error_code:
            job.status === "capturing" ? "capture_failed" : "manifest_invalid",
        });
      } catch {
        // El job conserva el último estado duradero para reanudación manual.
      }
    }
    throw error;
  }
}

const parsed = parseArguments(process.argv.slice(2));
try {
  if (parsed.flags.has("--fixture") || process.argv.length === 2) {
    await fixture();
  } else if (parsed.flags.has("--capture-live")) {
    await createFromLiveSource(parsed);
  } else {
    await createFromDescriptor(parsed);
  }
} catch (error) {
  process.stderr.write(
    `${JSON.stringify({
      error: error instanceof Error ? error.message : "backup_failed",
      status: "BACKUP_FAILED",
    })}\n`,
  );
  process.exitCode = 1;
}
