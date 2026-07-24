#!/usr/bin/env node
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createFixtureKeyring,
  createFixtureLedgerHead,
  createFixtureLedgerHeadProvider,
  createRecoverySet,
} from "../backup/recovery-set.mjs";
import { printResult } from "../backup/operator-input.mjs";
import { buildSyntheticLedger } from "../operations/ledger-verifiers.mjs";
import { restoreFixtureRecoverySet } from "./restore-recovery-set.mjs";

async function createFixture(directory, keyring, backupId) {
  const marker = "a".repeat(64);
  const deletionRecords = buildSyntheticLedger(
    [
      {
        markerKeyVersion: 1,
        operationId: `${backupId}-deletion`,
        profileMarker: marker,
        recordType: "profile_deletion",
        schemaVersion: 1,
        stream: "deletions",
      },
    ],
    "deletions",
  );
  const auditRecords = buildSyntheticLedger(
    [{ id: "audit-before" }, { id: "audit-after" }],
    "admin-audit",
  );
  const deletionHead = {
    hash: deletionRecords.at(-1).recordHash,
    sequence: deletionRecords.length,
  };
  const auditHead = {
    hash: auditRecords.at(-1).recordHash,
    sequence: auditRecords.length,
  };
  await createRecoverySet({
    backupId,
    createdAt: "2026-07-23T00:00:00.000Z",
    destinationDirectory: directory,
    keyVersion: 1,
    keyring,
    kind: backupId.endsWith("4") ? "precritical" : "weekly",
    objects: [
      {
        bytes: new TextEncoder().encode(
          JSON.stringify({
            audit: [{ id: "audit-before", sequence: 1 }],
            profiles: [
              { alias: "Borrado", marker },
              { alias: "Conservado", marker: "retained" },
            ],
            security: {
              aal2Required: true,
              policyDigest:
                "de41957f4b5b5fbf2f19ddf15f3909be9e45a42fdba1083fbe5716108a2cfe16",
              rlsEnabled: true,
            },
            sessions: [{ id: "session", revoked: false }],
          }),
        ),
        logicalPath: "database/fixture.json",
        type: "database",
      },
      {
        bytes: new TextEncoder().encode(
          JSON.stringify({
            head: deletionHead,
            records: deletionRecords,
          }),
        ),
        logicalPath: "ledgers/deletions.json",
        prefix: deletionHead,
        type: "deletions-ledger",
      },
      {
        bytes: new TextEncoder().encode(
          JSON.stringify({
            completedRanges: [],
            head: auditHead,
            incompleteRanges: [],
            pendingIntents: [],
            records: auditRecords,
          }),
        ),
        logicalPath: "ledgers/admin-audit.json",
        prefix: auditHead,
        type: "admin-audit-ledger",
      },
      {
        bytes: new TextEncoder().encode("deleted private object"),
        logicalPath: `storage/plan-exports/${marker}/fixture.pdf`,
        profileMarker: marker,
        type: "storage",
      },
    ],
    schemaVersion: 18,
    sourceEnvironment: "local",
    storageInventory: [
      {
        bucket: "plan-exports",
        enumerated: true,
        logicalPaths: [`storage/plan-exports/${marker}/fixture.pdf`],
      },
    ],
    toolVersion: "t18-fixture",
  });
  return {
    auditHead: await createFixtureLedgerHead({
      environment: "local",
      ...auditHead,
      keyring,
      stream: "admin-audit",
    }),
    deletionHead: await createFixtureLedgerHead({
      environment: "local",
      ...deletionHead,
      keyring,
      stream: "deletions",
    }),
    marker,
  };
}

async function main() {
  const root = await mkdtemp(join(tmpdir(), "health-design-t18-restore-drill-"));
  try {
    const keyring = await createFixtureKeyring();
    const results = [];
    for (const index of [1, 2, 3, 4]) {
      const backupId = `fixture-rotation-${index}`;
      const backupDirectory = join(root, backupId);
      const targetDirectory = join(root, `target-${index}`);
      const fixture = await createFixture(backupDirectory, keyring, backupId);
      await import("node:fs/promises").then(({ mkdir }) =>
        mkdir(targetDirectory, { mode: 0o700 }),
      );
      const result = await restoreFixtureRecoverySet({
        backupJobId: crypto.randomUUID(),
        directory: backupDirectory,
        keyring,
        knownTombstoneKeyVersions: new Set([1]),
        knownProjectRefs: ["development-ref", "production-ref"],
        ledgerHeadProvider: createFixtureLedgerHeadProvider({
          "admin-audit": fixture.auditHead,
          deletions: fixture.deletionHead,
        }),
        restoreJobId: crypto.randomUUID(),
        targetDirectory,
        targetEnvironment: "local-isolated",
        targetFingerprint: "f".repeat(64),
        targetRef: `fixture-isolated-${index}`,
      });
      if (
        result.database.profiles.some((profile) => profile.marker === fixture.marker) ||
        result.restoredStoragePaths.length !== 0 ||
        result.database.sessions.some((session) => !session.revoked)
      ) {
        throw new Error("restore_fixture_invariant_failed");
      }
      results.push(result.status);
    }
    printResult({
      rotations: results.length,
      status: "RESTORE_DRILL_FIXTURE_PASS",
      targetEnvironment: "local-isolated",
      trafficEnabled: false,
    });
  } finally {
    await rm(root, { force: true, recursive: true });
  }
}

try {
  await main();
} catch (error) {
  process.stderr.write(
    `${JSON.stringify({
      error: error instanceof Error ? error.message : "restore_drill_failed",
      status: "RESTORE_DRILL_FAILED",
    })}\n`,
  );
  process.exitCode = 1;
}
