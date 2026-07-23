#!/usr/bin/env node
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createFixtureKeyring,
  createRecoverySet,
  verifyRecoverySet,
} from "./recovery-set.mjs";
import {
  parseArguments,
  printResult,
  readJson,
  readOperatorKeyring,
  requiredValue,
} from "./operator-input.mjs";

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "health-design-t18-backup-"));
  try {
    const directory = join(root, "fixture-backup");
    const keyring = await createFixtureKeyring();
    await createRecoverySet({
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
          prefix: { hash: "fixture-deletions", sequence: 0 },
          type: "deletions-ledger",
        },
        {
          bytes: new TextEncoder().encode(
            '{"incompleteRanges":[],"pendingIntents":[],"records":[]}',
          ),
          logicalPath: "ledgers/admin-audit.json",
          prefix: { hash: "fixture-audit", sequence: 0 },
          type: "admin-audit-ledger",
        },
      ],
      schemaVersion: 18,
      sourceEnvironment: "local",
      toolVersion: "t18-fixture",
    });
    const verified = await verifyRecoverySet({ directory, keyring });
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
  const kind = requiredValue(parsed, "--kind");
  const confirmation = parsed.values.get("--confirm");
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
  const keyring = await readOperatorKeyring({ requirePrivate: true });
  const objects = await Promise.all(
    descriptor.objects.map(async (object) => ({
      ...object,
      bytes: new Uint8Array(await readFile(object.sourceFile)),
      sourceFile: undefined,
    })),
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
    toolVersion: descriptor.toolVersion,
  });
  const verified = await verifyRecoverySet({
    directory: destinationDirectory,
    keyring,
    remoteLedgerHeads: descriptor.remoteLedgerHeads,
  });
  printResult({
    backupId,
    objectCount: verified.manifest.objects.length,
    status: "BACKUP_READY",
  });
}

const parsed = parseArguments(process.argv.slice(2));
try {
  if (parsed.flags.has("--fixture") || process.argv.length === 2) {
    await fixture();
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
