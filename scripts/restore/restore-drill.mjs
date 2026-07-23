#!/usr/bin/env node
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createFixtureKeyring, createRecoverySet } from "../backup/recovery-set.mjs";
import { printResult } from "../backup/operator-input.mjs";
import { restoreFixtureRecoverySet } from "./restore-recovery-set.mjs";

async function createFixture(directory, keyring, backupId) {
  const marker = "fixture-deleted-marker";
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
            security: { aal2Required: true, rlsEnabled: true },
            sessions: [{ id: "session", revoked: false }],
          }),
        ),
        logicalPath: "database/fixture.json",
        type: "database",
      },
      {
        bytes: new TextEncoder().encode(
          JSON.stringify({
            head: { hash: "deletion-head", sequence: 1 },
            records: [{ profileMarker: marker, sequence: 1 }],
          }),
        ),
        logicalPath: "ledgers/deletions.json",
        prefix: { hash: "deletion-head", sequence: 1 },
        type: "deletions-ledger",
      },
      {
        bytes: new TextEncoder().encode(
          JSON.stringify({
            head: { hash: "audit-head", sequence: 2 },
            incompleteRanges: [],
            pendingIntents: [],
            records: [
              { id: "audit-before", sequence: 1 },
              { id: "audit-after", sequence: 2 },
            ],
          }),
        ),
        logicalPath: "ledgers/admin-audit.json",
        prefix: { hash: "audit-head", sequence: 2 },
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
    toolVersion: "t18-fixture",
  });
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
      await createFixture(backupDirectory, keyring, backupId);
      await import("node:fs/promises").then(({ mkdir }) =>
        mkdir(targetDirectory, { mode: 0o700 }),
      );
      const result = await restoreFixtureRecoverySet({
        directory: backupDirectory,
        keyring,
        knownProjectRefs: ["development-ref", "production-ref"],
        remoteLedgerHeads: {
          "admin-audit": { hash: "audit-head", sequence: 2 },
          deletions: { hash: "deletion-head", sequence: 1 },
        },
        targetDirectory,
        targetEnvironment: "local-isolated",
        targetRef: `fixture-isolated-${index}`,
      });
      if (
        result.database.profiles.some(
          (profile) => profile.marker === "fixture-deleted-marker",
        ) ||
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
