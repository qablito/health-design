import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  assertSafeLogicalPath,
  createFixtureKeyring,
  createRecoverySet,
} from "../../scripts/backup/recovery-set.mjs";
import {
  assertIsolatedRestoreTarget,
  restoreFixtureRecoverySet,
} from "../../scripts/restore/restore-recovery-set.mjs";

const temporaryPaths: string[] = [];

async function temporaryDirectory(prefix: string) {
  const path = await mkdtemp(join(tmpdir(), prefix));
  temporaryPaths.push(path);
  return path;
}

afterEach(async () => {
  await Promise.all(
    temporaryPaths.splice(0).map((path) => rm(path, { force: true, recursive: true })),
  );
});

async function fixtureBackup(
  backupId: string,
  marker: string,
  options: {
    auditRangeIncomplete?: boolean;
    pendingIntent?: boolean;
  } = {},
) {
  const directory = await temporaryDirectory("health-design-recovery-set-");
  const keyring = await createFixtureKeyring();
  const database = {
    audit: [{ id: "audit-before", sequence: 1 }],
    profiles: [
      { alias: "Perfil borrado", marker },
      { alias: "Perfil válido", marker: "retained-marker" },
    ],
    security: { aal2Required: true, rlsEnabled: true },
    sessions: [{ id: "restored-session", revoked: false }],
  };
  await createRecoverySet({
    backupId,
    createdAt: "2026-07-01T00:00:00.000Z",
    destinationDirectory: directory,
    keyVersion: 1,
    keyring,
    kind: "weekly",
    objects: [
      {
        bytes: new TextEncoder().encode(JSON.stringify(database)),
        logicalPath: "database/fixture.json",
        type: "database",
      },
      {
        bytes: new TextEncoder().encode("private object"),
        logicalPath: `storage/plan-exports/${marker}/file.pdf`,
        profileMarker: marker,
        type: "storage",
      },
      {
        bytes: new TextEncoder().encode(
          JSON.stringify({
            head: { hash: "deletion-head", sequence: 4 },
            records: [{ profileMarker: marker, sequence: 4 }],
          }),
        ),
        logicalPath: "ledgers/deletions.json",
        prefix: { hash: "deletion-head", sequence: 4 },
        type: "deletions-ledger",
      },
      {
        bytes: new TextEncoder().encode(
          JSON.stringify({
            head: { hash: "audit-head", sequence: 2 },
            incompleteRanges: options.auditRangeIncomplete ? ["range-1"] : [],
            pendingIntents: options.pendingIntent ? ["intent-1"] : [],
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
    ],
    schemaVersion: 18,
    sourceEnvironment: "development",
    toolVersion: "t18-test",
  });
  return { directory, keyring };
}

describe("restore aislado fail-closed", () => {
  it("rechaza refs conocidos, destinos no vacíos y symlinks", async () => {
    const target = await temporaryDirectory("health-design-restore-");
    await expect(
      assertIsolatedRestoreTarget({
        knownProjectRefs: ["development-ref", "production-ref"],
        targetDirectory: target,
        targetEnvironment: "local-isolated",
        targetRef: "development-ref",
      }),
    ).rejects.toThrow("known_project_ref");

    await writeFile(join(target, "occupied"), "x");
    await expect(
      assertIsolatedRestoreTarget({
        knownProjectRefs: [],
        targetDirectory: target,
        targetEnvironment: "local-isolated",
        targetRef: "local-drill",
      }),
    ).rejects.toThrow("restore_target_not_empty");

    const symlinkRoot = await temporaryDirectory("health-design-symlink-");
    const realTarget = await temporaryDirectory("health-design-real-");
    await import("node:fs/promises").then(({ symlink }) =>
      symlink(realTarget, join(symlinkRoot, "linked")),
    );
    await expect(
      assertIsolatedRestoreTarget({
        knownProjectRefs: [],
        targetDirectory: join(symlinkRoot, "linked"),
        targetEnvironment: "local-isolated",
        targetRef: "local-drill",
      }),
    ).rejects.toThrow("restore_target_symlink");
  });

  it("elimina perfiles y objetos tombstoned, repone auditoría y revoca sesiones", async () => {
    const marker = "deleted-marker";
    for (const backupId of ["rotation-1", "rotation-2", "rotation-3", "rotation-4"]) {
      const fixture = await fixtureBackup(backupId, marker);
      const target = await temporaryDirectory("health-design-restore-");
      const result = await restoreFixtureRecoverySet({
        directory: fixture.directory,
        keyring: fixture.keyring,
        knownProjectRefs: ["development-ref", "production-ref"],
        remoteLedgerHeads: {
          "admin-audit": { hash: "audit-head", sequence: 2 },
          deletions: { hash: "deletion-head", sequence: 4 },
        },
        targetDirectory: target,
        targetEnvironment: "local-isolated",
        targetRef: `isolated-${backupId}`,
      });

      expect(result.status).toBe("ready_for_promotion");
      expect(result.database.profiles).toEqual([
        { alias: "Perfil válido", marker: "retained-marker" },
      ]);
      expect(result.database.sessions).toEqual([
        { id: "restored-session", revoked: true },
      ]);
      expect(result.database.audit).toEqual([
        { id: "audit-before", sequence: 1 },
        { id: "audit-after", sequence: 2 },
      ]);
      expect(result.restoredStoragePaths).toEqual([]);
      expect(result.database.security).toEqual({
        aal2Required: true,
        rlsEnabled: true,
      });
    }
  });

  it("bloquea intent pendiente y rango parcial", async () => {
    const pending = await fixtureBackup("pending", "deleted", {
      pendingIntent: true,
    });
    await expect(
      restoreFixtureRecoverySet({
        directory: pending.directory,
        keyring: pending.keyring,
        knownProjectRefs: [],
        targetDirectory: await temporaryDirectory("health-design-restore-"),
        targetEnvironment: "local-isolated",
        targetRef: "isolated-pending",
      }),
    ).rejects.toThrow("pending_ledger_intent");

    const partial = await fixtureBackup("partial", "deleted", {
      auditRangeIncomplete: true,
    });
    await expect(
      restoreFixtureRecoverySet({
        directory: partial.directory,
        keyring: partial.keyring,
        knownProjectRefs: [],
        targetDirectory: await temporaryDirectory("health-design-restore-"),
        targetEnvironment: "local-isolated",
        targetRef: "isolated-partial",
      }),
    ).rejects.toThrow("incomplete_audit_range");
  });

  it("rechaza path traversal del manifiesto antes de escribir", () => {
    expect(() => assertSafeLogicalPath("../outside")).toThrow("unsafe_manifest_path");
    expect(() => assertSafeLogicalPath("storage/../../outside")).toThrow(
      "unsafe_manifest_path",
    );
  });
});
