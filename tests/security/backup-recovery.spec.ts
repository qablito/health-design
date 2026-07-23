import { mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  createFixtureKeyring,
  createRecoverySet,
  planRotation,
  verifyRecoverySet,
} from "../../scripts/backup/recovery-set.mjs";

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

describe("conjuntos de recuperación cifrados", () => {
  it("cifra dump, Storage y prefijos de ledger con envelope mínimo firmado", async () => {
    const directory = await temporaryDirectory("health-design-backup-");
    const keyring = await createFixtureKeyring({ keyVersion: 3 });
    const result = await createRecoverySet({
      backupId: "backup-weekly-001",
      createdAt: "2026-07-23T10:00:00.000Z",
      destinationDirectory: directory,
      keyVersion: 3,
      keyring,
      kind: "weekly",
      objects: [
        {
          bytes: new TextEncoder().encode("logical database dump"),
          logicalPath: "database/postgres.dump",
          type: "database",
        },
        {
          bytes: new TextEncoder().encode("private export"),
          logicalPath: "storage/plan-exports/opaque/object.pdf",
          type: "storage",
        },
        {
          bytes: new TextEncoder().encode('{"head":"deletion-head"}'),
          logicalPath: "ledgers/deletions.json",
          prefix: { hash: "deletion-head", sequence: 8 },
          type: "deletions-ledger",
        },
        {
          bytes: new TextEncoder().encode('{"head":"audit-head"}'),
          logicalPath: "ledgers/admin-audit.json",
          prefix: { hash: "audit-head", sequence: 19 },
          type: "admin-audit-ledger",
        },
      ],
      schemaVersion: 18,
      sourceEnvironment: "development",
      toolVersion: "t18-test",
    });

    const verification = await verifyRecoverySet({
      directory,
      keyring,
      remoteLedgerHeads: {
        "admin-audit": { hash: "audit-head", sequence: 19 },
        deletions: { hash: "deletion-head", sequence: 8 },
      },
    });

    expect(result.envelope.backupId).toBe("backup-weekly-001");
    expect(verification.manifest.objects).toHaveLength(4);
    expect(verification.manifest.objects.map((item) => item.logicalPath)).toEqual([
      "ledgers/admin-audit.json",
      "database/postgres.dump",
      "ledgers/deletions.json",
      "storage/plan-exports/opaque/object.pdf",
    ]);
    const envelopeText = await readFile(join(directory, "envelope.json"), "utf8");
    expect(envelopeText).not.toContain("plan-exports");
    expect(envelopeText).not.toContain("postgres.dump");
    expect(envelopeText).not.toContain("logical database dump");
    expect(envelopeText).not.toContain("private export");
    expect((await stat(directory)).mode & 0o777).toBe(0o700);
    expect((await readdir(directory)).every((name) => !name.endsWith(".plain"))).toBe(
      true,
    );
  });

  it("falla ante corrupción, objeto ausente, clave desconocida y prefijo divergente", async () => {
    const directory = await temporaryDirectory("health-design-backup-");
    const keyring = await createFixtureKeyring();
    const result = await createRecoverySet({
      backupId: "backup-weekly-002",
      createdAt: "2026-07-23T10:00:00.000Z",
      destinationDirectory: directory,
      keyVersion: 1,
      keyring,
      kind: "weekly",
      objects: [
        {
          bytes: new TextEncoder().encode("db"),
          logicalPath: "database/postgres.dump",
          type: "database",
        },
        {
          bytes: new TextEncoder().encode("ledger"),
          logicalPath: "ledgers/deletions.json",
          prefix: { hash: "prefix-ok", sequence: 3 },
          type: "deletions-ledger",
        },
      ],
      schemaVersion: 18,
      sourceEnvironment: "development",
      toolVersion: "t18-test",
    });
    const objectName = result.envelope.objects[0]?.file;
    expect(objectName).toBeTruthy();

    await expect(
      verifyRecoverySet({
        directory,
        keyring,
        remoteLedgerHeads: {
          deletions: { hash: "wrong", sequence: 3 },
        },
      }),
    ).rejects.toThrow("ledger_prefix_mismatch");

    const unknownKeyring = { ...keyring, keks: new Map() };
    await expect(
      verifyRecoverySet({ directory, keyring: unknownKeyring }),
    ).rejects.toThrow("unknown_key_version");

    const objectPath = join(directory, objectName as string);
    const bytes = new Uint8Array(await readFile(objectPath));
    bytes[bytes.length - 1] = (bytes[bytes.length - 1] ?? 0) ^ 1;
    await writeFile(objectPath, bytes);
    await expect(verifyRecoverySet({ directory, keyring })).rejects.toThrow(
      /ciphertext_hash_mismatch|aead_verification_failed/,
    );

    await rm(objectPath);
    await expect(verifyRecoverySet({ directory, keyring })).rejects.toThrow(
      "encrypted_object_missing",
    );
  });
});

describe("rotación", () => {
  it("conserva cuatro ready y propone el más antiguo solo tras verificar el nuevo", () => {
    const existing = [
      {
        backupId: "weekly-1",
        createdAt: "2026-06-01T00:00:00.000Z",
        status: "ready" as const,
      },
      {
        backupId: "weekly-2",
        createdAt: "2026-06-08T00:00:00.000Z",
        status: "ready" as const,
      },
      {
        backupId: "weekly-3",
        createdAt: "2026-06-15T00:00:00.000Z",
        status: "ready" as const,
      },
      {
        backupId: "precritical-1",
        createdAt: "2026-06-20T00:00:00.000Z",
        status: "ready" as const,
      },
      {
        backupId: "failed-1",
        createdAt: "2026-05-01T00:00:00.000Z",
        status: "failed" as const,
      },
    ];

    expect(
      planRotation(existing, {
        backupId: "weekly-4",
        createdAt: "2026-06-22T00:00:00.000Z",
        status: "verifying",
      }),
    ).toEqual({
      activeReadyIds: ["weekly-1", "weekly-2", "weekly-3", "precritical-1"],
      pruneCandidateId: null,
    });
    expect(
      planRotation(existing, {
        backupId: "weekly-4",
        createdAt: "2026-06-22T00:00:00.000Z",
        status: "ready",
      }),
    ).toEqual({
      activeReadyIds: ["weekly-2", "weekly-3", "precritical-1", "weekly-4"],
      pruneCandidateId: "weekly-1",
    });
  });
});
