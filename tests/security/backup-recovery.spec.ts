import { createHmac } from "node:crypto";
import {
  chmod,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  createFixtureKeyring,
  createFixtureLedgerHead,
  createFixtureLedgerHeadProvider,
  createRecoverySet,
  planRotation,
  verifyRecoverySet,
} from "../../scripts/backup/recovery-set.mjs";
import { buildSyntheticLedger } from "../../scripts/operations/ledger-verifiers.mjs";
import { createLiveLedgerHeadProvider } from "../../scripts/backup/live-ledger-heads.mjs";
import {
  captureLiveBackupInputs,
  runPgDump,
} from "../../scripts/backup/supabase-capture.mjs";

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

it("entrega la conexión remota a libpq sin exponer secretos en argumentos", async () => {
  const directory = await temporaryDirectory("health-design-pg-dump-env-");
  const executable = join(directory, "pg_dump");
  const outputPath = join(directory, "postgres.dump");
  await writeFile(
    executable,
    `#!/usr/bin/env node
const { writeFileSync } = require("node:fs");
const output = process.argv[process.argv.indexOf("--file") + 1];
writeFileSync(output, JSON.stringify({
  args: process.argv.slice(2),
  database: process.env.PGDATABASE,
  host: process.env.PGHOST,
  password: process.env.PGPASSWORD,
  port: process.env.PGPORT,
  sslmode: process.env.PGSSLMODE,
  user: process.env.PGUSER,
}));
`,
  );
  await chmod(executable, 0o700);
  const originalPath = process.env.PATH;
  process.env.PATH = `${directory}:${originalPath}`;
  try {
    await runPgDump({
      args: ["--format=custom", "--file", outputPath],
      environment: {
        PGDATABASE:
          "postgresql://postgres.nwoivdxdupklervtnovd:database-secret@aws-0-eu-west-3.pooler.supabase.com:5432/postgres?sslmode=require",
      },
    });
  } finally {
    process.env.PATH = originalPath;
  }
  const captured = JSON.parse(await readFile(outputPath, "utf8")) as {
    args: string[];
    database: string;
    host: string;
    password: string;
    port: string;
    sslmode: string;
    user: string;
  };
  expect(captured).toEqual({
    args: ["--format=custom", "--file", outputPath],
    database: "postgres",
    host: "aws-0-eu-west-3.pooler.supabase.com",
    password: "database-secret",
    port: "5432",
    sslmode: "require",
    user: "postgres.nwoivdxdupklervtnovd",
  });
  expect(captured.args.join(" ")).not.toContain("database-secret");
});

function auditGapFixture() {
  const requestId = "61000000-0000-4000-8000-000000005214";
  const intent = {
    action: "profile_deletion_permanent",
    createdAt: "2026-07-24T00:00:00.000Z",
    effectiveProfileId: "51000000-0000-4000-8000-000000005101",
    originalActorId: "31000000-0000-4000-8000-000000005101",
    phase: "intent",
    requestId,
    result: "pending",
    schemaVersion: 1,
    stream: "admin-audit",
    targetId: "51000000-0000-4000-8000-000000005101",
    targetType: "deletion_job",
  };
  const firstAudit = buildSyntheticLedger([intent], "admin-audit")[0]!;
  const auditRecords = buildSyntheticLedger(
    [
      intent,
      {
        ...intent,
        createdAt: "2026-07-24T00:00:01.000Z",
        intentRecordHash: firstAudit.recordHash,
        phase: "outcome",
        result: "success",
      },
    ],
    "admin-audit",
  );
  const jobId = "61000000-0000-4000-8000-000000005215";
  const rangeIntent = {
    auditDeletionJobId: jobId,
    fromSequence: 1,
    hashBeforeRange: "0".repeat(64),
    operationId: jobId,
    rangeHash: "c".repeat(64),
    recordType: "audit_range_delete_intent",
    schemaVersion: 1,
    stream: "deletions",
    terminalRecordHash: auditRecords.at(-1)!.recordHash,
    toSequence: 2,
  };
  const firstDeletion = buildSyntheticLedger([rangeIntent], "deletions")[0]!;
  return {
    auditRecords,
    deletionRecords: buildSyntheticLedger(
      [
        rangeIntent,
        {
          ...rangeIntent,
          intentRecordHash: firstDeletion.recordHash,
          recordType: "audit_range_delete_complete",
        },
      ],
      "deletions",
    ),
  };
}

describe("conjuntos de recuperación cifrados", () => {
  const developmentProjectRef = "nwoivdxdupklervtnovd";
  const productionProjectRef = "abcdefghijklmnopqrst";
  const developmentDatabaseUrl = `postgresql://postgres:secret@db.${developmentProjectRef}.supabase.co/postgres`;
  const developmentSupabaseUrl = `https://${developmentProjectRef}.supabase.co`;

  it("propaga ausencias del ledger remoto sin confundirlas con registros vacíos", async () => {
    const provider = createLiveLedgerHeadProvider(
      {
        continuityLedgerHmacKey: "ledger-hmac-key-with-at-least-256-bits",
        continuityLedgerUrl: "https://ledger.example",
      },
      (input: URL | RequestInfo) => {
        const path = new URL(
          input instanceof URL
            ? input.href
            : typeof input === "string"
              ? input
              : input.url,
        ).pathname;
        return Promise.resolve(
          path.includes("/head/")
            ? new Response(
                JSON.stringify({
                  current: { recordHash: "b".repeat(64), sequence: 2 },
                  requested: { recordHash: "0".repeat(64), sequence: 0 },
                }),
              )
            : new Response(
                JSON.stringify({ missingSequences: [2], records: [{ sequence: 1 }] }),
              ),
        );
      },
    );

    await expect(provider("admin-audit", 0)).resolves.toMatchObject({
      missingSequences: [2],
      suffixRecords: [{ sequence: 1 }],
    });
  });

  it("captura una cesta de recuperación con un rango auditado ya eliminado", async () => {
    const { auditRecords, deletionRecords } = auditGapFixture();
    const captureInput = {
      authorizedPrivateBuckets: ["plan-exports"],
      databaseUrl: developmentDatabaseUrl,
      productionProjectRef,
      projectRef: developmentProjectRef,
      serviceRoleKey: "service-role-secret",
      supabaseUrl: developmentSupabaseUrl,
      tombstoneHmacKeys: { 1: "fixture-key" },
    };
    let missingSequences = [1, 2];
    const dependencies = {
      fetcher: (input: URL | RequestInfo) => {
        const path = new URL(
          input instanceof URL
            ? input.href
            : typeof input === "string"
              ? input
              : input.url,
        ).pathname;
        return Promise.resolve(
          new Response(
            path === "/storage/v1/bucket"
              ? JSON.stringify([{ id: "plan-exports", public: false }])
              : "[]",
          ),
        );
      },
      ledgerHeadProvider: ((stream: string, sequence: number) =>
        Promise.resolve({
          current:
            stream === "deletions"
              ? {
                  recordHash: deletionRecords.at(-1)!.recordHash,
                  sequence: 2,
                  stream,
                }
              : {
                  recordHash: auditRecords.at(-1)!.recordHash,
                  sequence: 2,
                  stream,
                },
          missingSequences: stream === "admin-audit" ? missingSequences : [],
          requested: {
            recordHash: "0".repeat(64),
            sequence,
            stream,
          },
          suffixRecords: stream === "deletions" ? deletionRecords : [],
        })) as never,
      runPgDump: async ({ outputPath }: { outputPath: string }) => {
        await writeFile(outputPath, "dump");
      },
    };
    const result = await captureLiveBackupInputs(captureInput, dependencies);
    const adminAudit = result.objects.find(
      (object) => object.type === "admin-audit-ledger",
    )!;
    const snapshot = JSON.parse(new TextDecoder().decode(adminAudit.bytes)) as {
      completedRanges: unknown[];
      head: { hash: string; sequence: number };
      records: unknown[];
    };

    expect(snapshot.completedRanges).toHaveLength(1);
    expect(snapshot.records).toEqual([]);
    expect(snapshot.head).toEqual({
      hash: auditRecords.at(-1)!.recordHash,
      sequence: 2,
    });

    missingSequences = [1];
    await expect(captureLiveBackupInputs(captureInput, dependencies)).rejects.toThrow(
      "admin_audit_ledger_snapshot_invalid",
    );
  });

  it("captura pg_dump y todos los objetos de buckets privados sin exponer secretos", async () => {
    const profileId = "11111111-1111-4111-8111-111111111111";
    const calls: Array<{ args: string[]; env: Record<string, string> }> = [];
    const fetcher = (input: URL | RequestInfo, init?: RequestInit) => {
      const rawUrl =
        input instanceof URL
          ? input.href
          : typeof input === "string"
            ? input
            : input.url;
      const url = new URL(rawUrl);
      if (url.pathname === "/storage/v1/bucket") {
        return Promise.resolve(
          new Response(
            JSON.stringify([
              { id: "plan-exports", public: false },
              { id: "public-assets", public: true },
            ]),
            { status: 200 },
          ),
        );
      }
      if (url.pathname === "/storage/v1/object/list/plan-exports") {
        if (typeof init?.body !== "string") throw new Error("missing_body");
        const body = JSON.parse(init.body) as { offset: number; prefix: string };
        return Promise.resolve(
          new Response(
            JSON.stringify(
              body.offset !== 0
                ? []
                : body.prefix === ""
                  ? [{ name: profileId, metadata: null }]
                  : [{ name: "opaque.pdf", metadata: { size: 7 } }],
            ),
            { status: 200 },
          ),
        );
      }
      if (url.pathname === `/storage/v1/object/plan-exports/${profileId}/opaque.pdf`) {
        return Promise.resolve(new Response("private", { status: 200 }));
      }
      throw new Error(`unexpected_url:${url.pathname}`);
    };
    const ledgerHeadProvider = (stream: string, sequence: number) =>
      Promise.resolve({
        current: {
          recordHash: "0".repeat(64),
          sequence: 0,
          stream,
        },
        requested: {
          recordHash: "0".repeat(64),
          sequence,
          stream,
        },
        suffixRecords: [],
      });
    const result = await captureLiveBackupInputs(
      {
        authorizedPrivateBuckets: ["plan-exports"],
        databaseUrl: developmentDatabaseUrl,
        productionProjectRef,
        projectRef: developmentProjectRef,
        serviceRoleKey: "service-role-secret",
        supabaseUrl: developmentSupabaseUrl,
        tombstoneHmacKeys: { 1: "fixture-key" },
      },
      {
        fetcher,
        ledgerHeadProvider: ledgerHeadProvider as never,
        runPgDump: async ({ args, environment, outputPath }) => {
          expect(args).not.toContain("--no-owner");
          expect(args).not.toContain("--no-privileges");
          calls.push({ args, env: environment });
          await writeFile(outputPath, "dump");
        },
      },
    );

    expect(calls).toHaveLength(1);
    expect(calls[0]!.args.join(" ")).not.toContain("secret.example");
    expect(calls[0]!.env.PGDATABASE).toBe(developmentDatabaseUrl);
    expect(result.storageInventory).toEqual([
      {
        bucket: "plan-exports",
        enumerated: true,
        logicalPaths: [`storage/plan-exports/${profileId}/opaque.pdf`],
      },
    ]);
    expect(result.objects.find((object) => object.type === "storage")).toMatchObject({
      profileMarker: createHmac("sha256", "fixture-key")
        .update(profileId)
        .digest("hex"),
    });
    expect(result.objects.map((object) => object.type).sort()).toEqual([
      "admin-audit-ledger",
      "database",
      "deletions-ledger",
      "storage",
    ]);

    const deletionRecords = buildSyntheticLedger(
      [
        {
          markerKeyVersion: 1,
          operationId: "61000000-0000-4000-8000-000000005212",
          profileMarker: "a".repeat(64),
          recordType: "profile_deletion",
          schemaVersion: 1,
          stream: "deletions",
        },
      ],
      "deletions",
    );
    const rotated = await captureLiveBackupInputs(
      {
        authorizedPrivateBuckets: ["plan-exports"],
        databaseUrl: developmentDatabaseUrl,
        productionProjectRef,
        projectRef: developmentProjectRef,
        serviceRoleKey: "service-role-secret",
        supabaseUrl: developmentSupabaseUrl,
        tombstoneHmacKeys: { 1: "fixture-key", 2: "staged-key" },
      },
      {
        fetcher,
        ledgerHeadProvider: ((stream: string, sequence: number) =>
          Promise.resolve({
            current:
              stream === "deletions"
                ? {
                    recordHash: deletionRecords.at(-1)!.recordHash,
                    sequence: deletionRecords.length,
                    stream,
                  }
                : { recordHash: "0".repeat(64), sequence: 0, stream },
            requested: {
              recordHash: "0".repeat(64),
              sequence,
              stream,
            },
            suffixRecords: stream === "deletions" ? deletionRecords : [],
          })) as never,
        runPgDump: async ({ outputPath }) => {
          await writeFile(outputPath, "dump");
        },
      },
    );

    expect(rotated.objects.find((object) => object.type === "storage")).toMatchObject({
      profileMarker: createHmac("sha256", "fixture-key")
        .update(profileId)
        .digest("hex"),
    });

    const mixedDeletionRecords = buildSyntheticLedger(
      [
        deletionRecords[0]!.payload,
        {
          markerKeyVersion: 2,
          operationId: "61000000-0000-4000-8000-000000005213",
          profileMarker: "b".repeat(64),
          recordType: "profile_deletion",
          schemaVersion: 1,
          stream: "deletions",
        },
      ],
      "deletions",
    );
    await expect(
      captureLiveBackupInputs(
        {
          authorizedPrivateBuckets: ["plan-exports"],
          databaseUrl: developmentDatabaseUrl,
          productionProjectRef,
          projectRef: developmentProjectRef,
          serviceRoleKey: "service-role-secret",
          supabaseUrl: developmentSupabaseUrl,
          tombstoneHmacKeys: { 1: "fixture-key", 2: "staged-key" },
        },
        {
          fetcher,
          ledgerHeadProvider: ((stream: string, sequence: number) =>
            Promise.resolve({
              current:
                stream === "deletions"
                  ? {
                      recordHash: mixedDeletionRecords.at(-1)!.recordHash,
                      sequence: mixedDeletionRecords.length,
                      stream,
                    }
                  : { recordHash: "0".repeat(64), sequence: 0, stream },
              requested: {
                recordHash: "0".repeat(64),
                sequence,
                stream,
              },
              suffixRecords: stream === "deletions" ? mixedDeletionRecords : [],
            })) as never,
          runPgDump: async ({ outputPath }) => {
            await writeFile(outputPath, "dump");
          },
        },
      ),
    ).rejects.toThrow("tombstone_key_rotation_incomplete");
  });

  it("rechaza entradas Storage ambiguas en vez de omitirlas del backup", async () => {
    await expect(
      captureLiveBackupInputs(
        {
          authorizedPrivateBuckets: ["plan-exports"],
          databaseUrl: developmentDatabaseUrl,
          productionProjectRef,
          projectRef: developmentProjectRef,
          serviceRoleKey: "service-role-secret",
          supabaseUrl: developmentSupabaseUrl,
          tombstoneHmacKeys: { 1: "fixture-key" },
        },
        {
          fetcher: (input, init) => {
            const url = new URL(
              input instanceof URL
                ? input.href
                : typeof input === "string"
                  ? input
                  : input.url,
            );
            if (url.pathname === "/storage/v1/bucket") {
              return Promise.resolve(
                new Response(JSON.stringify([{ id: "plan-exports", public: false }]), {
                  status: 200,
                }),
              );
            }
            const body =
              typeof init?.body === "string"
                ? (JSON.parse(init.body) as { prefix: string })
                : { prefix: "" };
            return Promise.resolve(
              new Response(
                JSON.stringify(body.prefix === "" ? [{ name: "opaque.pdf" }] : []),
                { status: 200 },
              ),
            );
          },
          ledgerHeadProvider: () => Promise.reject(new Error("ledger_should_not_run")),
          runPgDump: () => Promise.reject(new Error("pg_dump_should_not_run")),
        },
      ),
    ).rejects.toThrow("storage_object_metadata_unverified");
  });

  it("rechaza objetos privados sin propietario de perfil canónico", async () => {
    await expect(
      captureLiveBackupInputs(
        {
          authorizedPrivateBuckets: ["plan-exports"],
          databaseUrl: developmentDatabaseUrl,
          productionProjectRef,
          projectRef: developmentProjectRef,
          serviceRoleKey: "service-role-secret",
          supabaseUrl: developmentSupabaseUrl,
          tombstoneHmacKeys: { 1: "fixture-key" },
        },
        {
          fetcher: (input) => {
            const url = new URL(
              input instanceof URL
                ? input.href
                : typeof input === "string"
                  ? input
                  : input.url,
            );
            if (url.pathname === "/storage/v1/bucket") {
              return Promise.resolve(
                new Response(JSON.stringify([{ id: "plan-exports", public: false }]), {
                  status: 200,
                }),
              );
            }
            return Promise.resolve(
              new Response(
                JSON.stringify([{ name: "opaque.pdf", metadata: { size: 7 } }]),
                { status: 200 },
              ),
            );
          },
          ledgerHeadProvider: () => Promise.reject(new Error("ledger_should_not_run")),
          runPgDump: () => Promise.reject(new Error("pg_dump_should_not_run")),
        },
      ),
    ).rejects.toThrow("storage_profile_owner_required");
  });

  it("rechaza buckets privados no autorizados antes de descargar", async () => {
    await expect(
      captureLiveBackupInputs(
        {
          authorizedPrivateBuckets: ["plan-exports"],
          databaseUrl: developmentDatabaseUrl,
          productionProjectRef,
          projectRef: developmentProjectRef,
          serviceRoleKey: "service-role-secret",
          supabaseUrl: developmentSupabaseUrl,
          tombstoneHmacKeys: { 1: "fixture-key" },
        },
        {
          fetcher: () =>
            Promise.resolve(
              new Response(
                JSON.stringify([
                  { id: "plan-exports", public: false },
                  { id: "unknown-private", public: false },
                ]),
                { status: 200 },
              ),
            ),
          ledgerHeadProvider: () => Promise.reject(new Error("ledger_should_not_run")),
          runPgDump: () => Promise.reject(new Error("pg_dump_should_not_run")),
        },
      ),
    ).rejects.toThrow("private_bucket_allowlist_mismatch");
  });

  it("rechaza endpoints que no pertenecen al proyecto Development antes de leer", async () => {
    let reads = 0;
    let dumps = 0;
    await expect(
      captureLiveBackupInputs(
        {
          authorizedPrivateBuckets: ["plan-exports"],
          databaseUrl:
            "postgresql://postgres:secret@db.abcdefghijklmnopqrst.supabase.co/postgres",
          productionProjectRef: "abcdefghijklmnopqrst",
          projectRef: "nwoivdxdupklervtnovd",
          serviceRoleKey: "service-role-secret",
          supabaseUrl: "https://abcdefghijklmnopqrst.supabase.co",
          tombstoneHmacKeys: { 1: "fixture-key" },
        },
        {
          fetcher: () => {
            reads += 1;
            return Promise.reject(new Error("fetch_should_not_run"));
          },
          ledgerHeadProvider: () => Promise.reject(new Error("ledger_should_not_run")),
          runPgDump: () => {
            dumps += 1;
            return Promise.reject(new Error("pg_dump_should_not_run"));
          },
        },
      ),
    ).rejects.toThrow("backup_source_identity_mismatch");
    expect({ dumps, reads }).toEqual({ dumps: 0, reads: 0 });
  });
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
          prefix: { hash: "d".repeat(64), sequence: 8 },
          type: "deletions-ledger",
        },
        {
          bytes: new TextEncoder().encode('{"head":"audit-head"}'),
          logicalPath: "ledgers/admin-audit.json",
          prefix: { hash: "a".repeat(64), sequence: 19 },
          type: "admin-audit-ledger",
        },
      ],
      schemaVersion: 18,
      sourceEnvironment: "development",
      storageInventory: [
        {
          bucket: "plan-exports",
          enumerated: true,
          logicalPaths: ["storage/plan-exports/opaque/object.pdf"],
        },
      ],
      toolVersion: "t18-test",
    });

    const heads = {
      "admin-audit": await createFixtureLedgerHead({
        environment: "development",
        hash: "a".repeat(64),
        keyring,
        sequence: 19,
        stream: "admin-audit",
      }),
      deletions: await createFixtureLedgerHead({
        environment: "development",
        hash: "d".repeat(64),
        keyring,
        sequence: 8,
        stream: "deletions",
      }),
    };
    const verification = await verifyRecoverySet({
      directory,
      keyring,
      ledgerHeadProvider: createFixtureLedgerHeadProvider(heads),
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

  it("verifica un backup anterior cuando el sufijo contiene un rango borrado completo", async () => {
    const directory = await temporaryDirectory("health-design-gap-backup-");
    const keyring = await createFixtureKeyring();
    const zero = { hash: "0".repeat(64), sequence: 0 };
    await createRecoverySet({
      backupId: "backup-before-audit-gap",
      createdAt: "2026-07-24T00:00:00.000Z",
      destinationDirectory: directory,
      keyVersion: 1,
      keyring,
      kind: "precritical",
      objects: [
        {
          bytes: new TextEncoder().encode("db"),
          logicalPath: "database/postgres.dump",
          type: "database",
        },
        {
          bytes: new TextEncoder().encode('{"head":{"hash":"0","sequence":0}}'),
          logicalPath: "ledgers/deletions.json",
          prefix: zero,
          type: "deletions-ledger",
        },
        {
          bytes: new TextEncoder().encode(
            '{"completedRanges":[],"head":{"hash":"0","sequence":0},"incompleteRanges":[],"pendingIntents":[],"records":[]}',
          ),
          logicalPath: "ledgers/admin-audit.json",
          prefix: zero,
          type: "admin-audit-ledger",
        },
      ],
      schemaVersion: 18,
      sourceEnvironment: "development",
      storageInventory: [
        { bucket: "plan-exports", enumerated: true, logicalPaths: [] },
      ],
      toolVersion: "t18-test",
    });
    const { auditRecords, deletionRecords } = auditGapFixture();
    const requested = {
      "admin-audit": await createFixtureLedgerHead({
        environment: "development",
        ...zero,
        keyring,
        stream: "admin-audit",
      }),
      deletions: await createFixtureLedgerHead({
        environment: "development",
        ...zero,
        keyring,
        stream: "deletions",
      }),
    };
    const current = {
      "admin-audit": {
        ...(await createFixtureLedgerHead({
          environment: "development",
          hash: auditRecords.at(-1)!.recordHash,
          keyring,
          sequence: 2,
          stream: "admin-audit",
        })),
        missingSequences: [1, 2],
        suffixRecords: [],
      },
      deletions: {
        ...(await createFixtureLedgerHead({
          environment: "development",
          hash: deletionRecords.at(-1)!.recordHash,
          keyring,
          sequence: 2,
          stream: "deletions",
        })),
        suffixRecords: deletionRecords,
      },
    };

    await expect(
      verifyRecoverySet({
        directory,
        keyring,
        ledgerHeadProvider: createFixtureLedgerHeadProvider(requested, current),
      }),
    ).resolves.toMatchObject({
      ledgerHeads: {
        "admin-audit": { current: { sequence: 2 }, missingSequences: [1, 2] },
      },
    });
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
          prefix: { hash: "d".repeat(64), sequence: 3 },
          type: "deletions-ledger",
        },
        {
          bytes: new TextEncoder().encode("audit-ledger"),
          logicalPath: "ledgers/admin-audit.json",
          prefix: { hash: "a".repeat(64), sequence: 4 },
          type: "admin-audit-ledger",
        },
      ],
      schemaVersion: 18,
      sourceEnvironment: "development",
      storageInventory: [
        { bucket: "plan-exports", enumerated: true, logicalPaths: [] },
      ],
      toolVersion: "t18-test",
    });
    const objectName = result.envelope.objects[0]?.file;
    expect(objectName).toBeTruthy();
    const heads = {
      "admin-audit": await createFixtureLedgerHead({
        environment: "development",
        hash: "a".repeat(64),
        keyring,
        sequence: 4,
        stream: "admin-audit",
      }),
      deletions: await createFixtureLedgerHead({
        environment: "development",
        hash: "d".repeat(64),
        keyring,
        sequence: 3,
        stream: "deletions",
      }),
    };

    await expect(
      verifyRecoverySet({
        directory,
        keyring,
        ledgerHeadProvider: createFixtureLedgerHeadProvider({
          "admin-audit": heads["admin-audit"],
          deletions: {
            ...heads.deletions,
            hash: "wrong",
            receipt: {
              ...heads.deletions.receipt,
              recordHash: "wrong",
            },
          },
        }),
      }),
    ).rejects.toThrow("ledger_prefix_mismatch");
    await expect(
      verifyRecoverySet({
        directory,
        keyring,
        ledgerHeadProvider: createFixtureLedgerHeadProvider({
          ...heads,
          deletions: {
            ...heads.deletions,
            receipt: {
              ...heads.deletions.receipt,
              signature: "A".repeat(86),
            },
          },
        }),
      }),
    ).rejects.toThrow("ledger_receipt_signature_invalid");

    const suffixRecords = buildSyntheticLedger(
      [
        {
          markerKeyVersion: 1,
          operationId: "61000000-0000-4000-8000-000000005211",
          profileMarker: "e".repeat(64),
          recordType: "profile_deletion",
          schemaVersion: 1,
          stream: "deletions",
        },
      ],
      "deletions",
      {
        initialHead: heads.deletions.receipt.recordHash,
        initialSequence: heads.deletions.receipt.sequence,
      },
    );
    const advancedHeads = {
      ...heads,
      deletions: {
        ...(await createFixtureLedgerHead({
          environment: "development",
          hash: suffixRecords.at(-1)!.recordHash,
          keyring,
          sequence: suffixRecords.at(-1)!.sequence,
          stream: "deletions",
        })),
        suffixRecords,
      },
    };
    await expect(
      verifyRecoverySet({
        directory,
        keyring,
        ledgerHeadProvider: createFixtureLedgerHeadProvider(heads, advancedHeads),
      }),
    ).resolves.toMatchObject({
      ledgerHeads: {
        deletions: {
          current: { sequence: suffixRecords.at(-1)!.sequence },
        },
      },
    });
    advancedHeads.deletions.suffixRecords = [
      { ...suffixRecords[0]!, previousHash: "f".repeat(64) },
    ];
    await expect(
      verifyRecoverySet({
        directory,
        keyring,
        ledgerHeadProvider: createFixtureLedgerHeadProvider(heads, advancedHeads),
      }),
    ).rejects.toThrow("ledger_divergence");

    const unknownKeyring = { ...keyring, keks: new Map() };
    await expect(
      verifyRecoverySet({
        directory,
        keyring: unknownKeyring,
        ledgerHeadProvider: createFixtureLedgerHeadProvider(heads),
      }),
    ).rejects.toThrow("unknown_key_version");

    const objectPath = join(directory, objectName as string);
    const bytes = new Uint8Array(await readFile(objectPath));
    bytes[bytes.length - 1] = (bytes[bytes.length - 1] ?? 0) ^ 1;
    await writeFile(objectPath, bytes);
    await expect(
      verifyRecoverySet({
        directory,
        keyring,
        ledgerHeadProvider: createFixtureLedgerHeadProvider(heads),
      }),
    ).rejects.toThrow(/ciphertext_hash_mismatch|aead_verification_failed/);

    await rm(objectPath);
    await expect(
      verifyRecoverySet({
        directory,
        keyring,
        ledgerHeadProvider: createFixtureLedgerHeadProvider(heads),
      }),
    ).rejects.toThrow("encrypted_object_missing");
  });

  it("exige el núcleo completo, ambos heads remotos y rechaza envelope symlink", async () => {
    const incompleteDirectory = await temporaryDirectory(
      "health-design-backup-incomplete-",
    );
    const keyring = await createFixtureKeyring();
    await expect(
      createRecoverySet({
        backupId: "backup-incomplete",
        createdAt: "2026-07-23T10:00:00.000Z",
        destinationDirectory: incompleteDirectory,
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
            bytes: new TextEncoder().encode("deletions"),
            logicalPath: "ledgers/deletions.json",
            prefix: { hash: "d".repeat(64), sequence: 0 },
            type: "deletions-ledger",
          },
        ],
        schemaVersion: 18,
        sourceEnvironment: "development",
        storageInventory: [
          { bucket: "plan-exports", enumerated: true, logicalPaths: [] },
        ],
        toolVersion: "t18-test",
      }),
    ).rejects.toThrow("admin-audit-ledger_object_required");

    const inventoryDirectory = await temporaryDirectory(
      "health-design-backup-inventory-",
    );
    await expect(
      createRecoverySet({
        backupId: "backup-inventory-mismatch",
        createdAt: "2026-07-23T10:00:00.000Z",
        destinationDirectory: inventoryDirectory,
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
            bytes: new TextEncoder().encode("unlisted"),
            logicalPath: "storage/plan-exports/unlisted.bin",
            type: "storage",
          },
          {
            bytes: new TextEncoder().encode("deletions"),
            logicalPath: "ledgers/deletions.json",
            prefix: { hash: "d".repeat(64), sequence: 0 },
            type: "deletions-ledger",
          },
          {
            bytes: new TextEncoder().encode("audit"),
            logicalPath: "ledgers/admin-audit.json",
            prefix: { hash: "a".repeat(64), sequence: 0 },
            type: "admin-audit-ledger",
          },
        ],
        schemaVersion: 18,
        sourceEnvironment: "development",
        storageInventory: [
          { bucket: "plan-exports", enumerated: true, logicalPaths: [] },
        ],
        toolVersion: "t18-test",
      }),
    ).rejects.toThrow("storage_inventory_mismatch");

    const directory = await temporaryDirectory("health-design-backup-symlink-");
    await createRecoverySet({
      backupId: "backup-symlink",
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
          bytes: new TextEncoder().encode("deletions"),
          logicalPath: "ledgers/deletions.json",
          prefix: { hash: "d".repeat(64), sequence: 0 },
          type: "deletions-ledger",
        },
        {
          bytes: new TextEncoder().encode("audit"),
          logicalPath: "ledgers/admin-audit.json",
          prefix: { hash: "a".repeat(64), sequence: 0 },
          type: "admin-audit-ledger",
        },
      ],
      schemaVersion: 18,
      sourceEnvironment: "development",
      storageInventory: [
        { bucket: "plan-exports", enumerated: true, logicalPaths: [] },
      ],
      toolVersion: "t18-test",
    });
    await expect(
      verifyRecoverySet({
        directory,
        keyring,
        ledgerHeadProvider: undefined as never,
      }),
    ).rejects.toThrow("live_ledger_head_provider_required");

    const realEnvelope = join(directory, "envelope.real.json");
    await rename(join(directory, "envelope.json"), realEnvelope);
    await symlink(realEnvelope, join(directory, "envelope.json"));
    await expect(
      verifyRecoverySet({
        directory,
        keyring,
        ledgerHeadProvider: createFixtureLedgerHeadProvider({
          "admin-audit": await createFixtureLedgerHead({
            environment: "development",
            hash: "a".repeat(64),
            keyring,
            sequence: 0,
            stream: "admin-audit",
          }),
          deletions: await createFixtureLedgerHead({
            environment: "development",
            hash: "d".repeat(64),
            keyring,
            sequence: 0,
            stream: "deletions",
          }),
        }),
      }),
    ).rejects.toThrow("envelope_symlink");
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
