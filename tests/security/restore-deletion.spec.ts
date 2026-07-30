import { createHmac } from "node:crypto";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  assertSafeLogicalPath,
  createFixtureKeyring,
  createFixtureLedgerHead,
  createFixtureLedgerHeadProvider,
  createRecoverySet,
} from "../../scripts/backup/recovery-set.mjs";
import { buildSyntheticLedger } from "../../scripts/operations/ledger-verifiers.mjs";
import { targetIdentityFingerprint } from "../../scripts/operations/supabase-project-identity.mjs";
import {
  assertIsolatedRestoreTarget,
  restoreFixtureRecoverySet,
  verifyRestoreValidation,
} from "../../scripts/restore/restore-recovery-set.mjs";
import {
  clearQuarantinedRetry,
  prepareQuarantinedRetry,
  quarantineFailedRestore,
} from "../../scripts/restore/restore-failure.mjs";
import {
  createSupabaseRestoreDependencies,
  runOperatorProcess,
  SECURITY_POLICY_MANIFEST_DIGEST,
} from "../../scripts/restore/supabase-operator-adapter.mjs";
import {
  restoreSupabaseRecoverySet,
  runPgRestore,
} from "../../scripts/restore/supabase-restore.mjs";

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

it("entrega la conexión aislada a pg_restore sin exponer secretos en argumentos", async () => {
  const directory = await temporaryDirectory("health-design-pg-restore-env-");
  const executable = join(directory, "pg_restore");
  const outputPath = join(directory, "captured.json");
  await writeFile(
    executable,
    `#!/usr/bin/env node
const { writeFileSync } = require("node:fs");
const output = process.argv[process.argv.indexOf("--capture") + 1];
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
    await runPgRestore({
      args: ["--exit-on-error", "--capture", outputPath],
      environment: {
        PGDATABASE: "postgresql://postgres:local-secret@127.0.0.1:55422/postgres",
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
    args: ["--exit-on-error", "--capture", outputPath],
    database: "postgres",
    host: "127.0.0.1",
    password: "local-secret",
    port: "55422",
    sslmode: "disable",
    user: "postgres",
  });
  expect(captured.args.join(" ")).not.toContain("local-secret");
});

it("entrega la conexión aislada a psql sin exponer secretos en argumentos", async () => {
  const directory = await temporaryDirectory("health-design-psql-env-");
  const executable = join(directory, "psql");
  const outputPath = join(directory, "captured.json");
  await writeFile(
    executable,
    `#!/usr/bin/env node
const { writeFileSync } = require("node:fs");
writeFileSync(${JSON.stringify(outputPath)}, JSON.stringify({
  args: process.argv.slice(2),
  database: process.env.PGDATABASE,
  host: process.env.PGHOST,
  password: process.env.PGPASSWORD,
  port: process.env.PGPORT,
  sslmode: process.env.PGSSLMODE,
  user: process.env.PGUSER,
}));
process.stdout.write("0\\n");
`,
  );
  await chmod(executable, 0o700);
  const originalPath = process.env.PATH;
  process.env.PATH = `${directory}:${originalPath}`;
  try {
    await runOperatorProcess(
      "psql",
      [
        "--no-psqlrc",
        "--set=ON_ERROR_STOP=1",
        "--quiet",
        "--tuples-only",
        "--no-align",
      ],
      {
        environment: {
          PGDATABASE: "postgresql://postgres:local-secret@127.0.0.1:55422/postgres",
        },
        input: "select 0;\n",
      },
    );
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
    args: [
      "--no-psqlrc",
      "--set=ON_ERROR_STOP=1",
      "--quiet",
      "--tuples-only",
      "--no-align",
    ],
    database: "postgres",
    host: "127.0.0.1",
    password: "local-secret",
    port: "55422",
    sslmode: "disable",
    user: "postgres",
  });
  expect(captured.args.join(" ")).not.toContain("local-secret");
});

async function fixtureBackup(
  backupId: string,
  marker: string,
  options: {
    auditRangeIncomplete?: boolean;
    brokenLedger?: boolean;
    conflictingAudit?: boolean;
    pendingIntent?: boolean;
    storageProfileId?: string;
    storageProfileMarker?: string | null;
    suffixCompletedRange?: boolean;
    suffixPendingIntent?: boolean;
  } = {},
) {
  const directory = await temporaryDirectory("health-design-recovery-set-");
  const keyring = await createFixtureKeyring();
  const storageProfileId =
    options.storageProfileId ?? "51000000-0000-4000-8000-000000005101";
  const database = {
    audit: [
      {
        id: "audit-before",
        sequence: 1,
        ...(options.conflictingAudit ? { result: "forged" } : {}),
      },
    ],
    profiles: [
      { alias: "Perfil borrado", marker },
      { alias: "Perfil válido", marker: "retained-marker" },
    ],
    security: {
      aal2Required: true,
      policyDigest: SECURITY_POLICY_MANIFEST_DIGEST,
      rlsEnabled: true,
    },
    sessions: [{ id: "restored-session", revoked: false }],
  };
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
  const auditRequestId = "61000000-0000-4000-8000-000000005101";
  const auditIntent = buildSyntheticLedger(
    [
      {
        action: "impersonation_start",
        createdAt: "2026-07-23T00:00:00.000Z",
        effectiveProfileId: null,
        id: "audit-before",
        originalActorId: "31000000-0000-4000-8000-000000005101",
        phase: "intent",
        requestId: auditRequestId,
        result: "pending",
        schemaVersion: 1,
        stream: "admin-audit",
        targetId: "51000000-0000-4000-8000-000000005101",
        targetType: "profile",
      },
    ],
    "admin-audit",
  );
  const auditOutcome = buildSyntheticLedger(
    [
      {
        action: "impersonation_start",
        createdAt: "2026-07-23T00:00:01.000Z",
        effectiveProfileId: null,
        id: "audit-after",
        intentRecordHash: auditIntent[0]!.recordHash,
        originalActorId: "31000000-0000-4000-8000-000000005101",
        phase: "outcome",
        requestId: auditRequestId,
        result: "success",
        schemaVersion: 1,
        stream: "admin-audit",
        targetId: "51000000-0000-4000-8000-000000005101",
        targetType: "profile",
      },
    ],
    "admin-audit",
    {
      initialHead: auditIntent[0]!.recordHash,
      initialSequence: 1,
    },
  );
  const auditRecords = [...auditIntent, ...auditOutcome];
  if (options.brokenLedger) {
    deletionRecords[0] = {
      ...deletionRecords[0]!,
      previousHash: "f".repeat(64),
    };
  }
  const deletionHead = {
    hash: deletionRecords.at(-1)!.recordHash,
    sequence: deletionRecords.length,
  };
  const auditHead = {
    hash: auditRecords.at(-1)!.recordHash,
    sequence: auditRecords.length,
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
        logicalPath: `storage/plan-exports/${storageProfileId}/file.pdf`,
        ...(options.storageProfileMarker === null
          ? {}
          : { profileMarker: options.storageProfileMarker ?? marker }),
        type: "storage",
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
            incompleteRanges: options.auditRangeIncomplete ? ["range-1"] : [],
            pendingIntents: options.pendingIntent ? ["intent-1"] : [],
            records: auditRecords,
          }),
        ),
        logicalPath: "ledgers/admin-audit.json",
        prefix: auditHead,
        type: "admin-audit-ledger",
      },
    ],
    schemaVersion: 18,
    sourceEnvironment: "development",
    storageInventory: [
      {
        bucket: "plan-exports",
        enumerated: true,
        logicalPaths: [`storage/plan-exports/${storageProfileId}/file.pdf`],
      },
    ],
    toolVersion: "t18-test",
  });
  const heads = {
    "admin-audit": await createFixtureLedgerHead({
      environment: "development",
      ...auditHead,
      keyring,
      stream: "admin-audit",
    }),
    deletions: await createFixtureLedgerHead({
      environment: "development",
      ...deletionHead,
      keyring,
      stream: "deletions",
    }),
  };
  let currentHeads = heads;
  if (options.suffixCompletedRange) {
    const suffixRequestId = "61000000-0000-4000-8000-000000005198";
    const suffixIntent = buildSyntheticLedger(
      [
        {
          action: "impersonation_start",
          createdAt: "2026-07-23T00:01:00.000Z",
          effectiveProfileId: null,
          originalActorId: "31000000-0000-4000-8000-000000005101",
          phase: "intent",
          requestId: suffixRequestId,
          result: "pending",
          schemaVersion: 1,
          stream: "admin-audit",
          targetId: "51000000-0000-4000-8000-000000005198",
          targetType: "profile",
        },
      ],
      "admin-audit",
      {
        initialHead: auditHead.hash,
        initialSequence: auditHead.sequence,
      },
    )[0]!;
    const suffixRecords = [
      suffixIntent,
      ...buildSyntheticLedger(
        [
          {
            ...suffixIntent.payload,
            createdAt: "2026-07-23T00:01:01.000Z",
            intentRecordHash: suffixIntent.recordHash,
            phase: "outcome",
            result: "success",
          },
        ],
        "admin-audit",
        {
          initialHead: suffixIntent.recordHash,
          initialSequence: suffixIntent.sequence,
        },
      ),
    ];
    const rangeJobId = "61000000-0000-4000-8000-000000005197";
    const rangeIntent = {
      auditDeletionJobId: rangeJobId,
      fromSequence: suffixIntent.sequence,
      hashBeforeRange: auditHead.hash,
      operationId: rangeJobId,
      rangeHash: "c".repeat(64),
      recordType: "audit_range_delete_intent",
      schemaVersion: 1,
      stream: "deletions",
      terminalRecordHash: suffixRecords.at(-1)!.recordHash,
      toSequence: suffixRecords.at(-1)!.sequence,
    };
    const deletionIntent = buildSyntheticLedger([rangeIntent], "deletions", {
      initialHead: deletionHead.hash,
      initialSequence: deletionHead.sequence,
    })[0]!;
    const deletionSuffix = [
      deletionIntent,
      ...buildSyntheticLedger(
        [
          {
            ...rangeIntent,
            intentRecordHash: deletionIntent.recordHash,
            recordType: "audit_range_delete_complete",
          },
        ],
        "deletions",
        {
          initialHead: deletionIntent.recordHash,
          initialSequence: deletionIntent.sequence,
        },
      ),
    ];
    currentHeads = {
      "admin-audit": Object.assign(
        await createFixtureLedgerHead({
          environment: "development",
          hash: suffixRecords.at(-1)!.recordHash,
          keyring,
          sequence: suffixRecords.at(-1)!.sequence,
          stream: "admin-audit",
        }),
        {
          missingSequences: suffixRecords.map((record) => record.sequence),
          suffixRecords: [],
        },
      ),
      deletions: Object.assign(
        await createFixtureLedgerHead({
          environment: "development",
          hash: deletionSuffix.at(-1)!.recordHash,
          keyring,
          sequence: deletionSuffix.at(-1)!.sequence,
          stream: "deletions",
        }),
        { suffixRecords: deletionSuffix },
      ),
    };
  } else if (options.suffixPendingIntent) {
    const suffixRecords = buildSyntheticLedger(
      [
        {
          action: "impersonation_start",
          createdAt: "2026-07-23T00:01:00.000Z",
          effectiveProfileId: null,
          originalActorId: "31000000-0000-4000-8000-000000005101",
          phase: "intent",
          requestId: "61000000-0000-4000-8000-000000005199",
          result: "pending",
          schemaVersion: 1,
          stream: "admin-audit",
          targetId: "51000000-0000-4000-8000-000000005199",
          targetType: "profile",
        },
      ],
      "admin-audit",
      {
        initialHead: auditHead.hash,
        initialSequence: auditHead.sequence,
      },
    );
    const advancedAdminHead = Object.assign(
      await createFixtureLedgerHead({
        environment: "development",
        hash: suffixRecords.at(-1)!.recordHash,
        keyring,
        sequence: suffixRecords.at(-1)!.sequence,
        stream: "admin-audit",
      }),
      { suffixRecords },
    );
    currentHeads = {
      ...heads,
      "admin-audit": advancedAdminHead,
    };
  }
  return {
    directory,
    keyring,
    ledgerHeadProvider: createFixtureLedgerHeadProvider(heads, currentHeads),
    promotionIdentity: {
      backupJobId: crypto.randomUUID(),
      restoreJobId: crypto.randomUUID(),
      targetFingerprint: "f".repeat(64),
    },
  };
}

describe("restore aislado fail-closed", () => {
  const knownProjectRefs = ["nwoivdxdupklervtnovd", "abcdefghijklmnopqrst"];
  const isolatedProjectRef = "qrstuvwxyzabcdefghij";
  const isolatedDatabaseUrl = `postgresql://postgres:secret@db.${isolatedProjectRef}.supabase.co/postgres`;
  const isolatedSupabaseUrl = `https://${isolatedProjectRef}.supabase.co`;

  it("rechaza un origen Storage HTTP arbitrario antes de construir el cliente", () => {
    expect(() =>
      createSupabaseRestoreDependencies({
        knownProjectRefs: ["nwoivdxdupklervtnovd", "abcdefghijklmnopqrst"],
        targetDatabaseUrl:
          "postgresql://postgres:secret@db.qrstuvwxyzabcdefghij.supabase.co/postgres",
        targetFingerprint: "f".repeat(64),
        targetRef: "isolated-restore",
        targetServiceRoleKey: "service-role-secret",
        targetSupabaseUrl: "http://attacker.example",
        tombstoneHmacKeys: { 1: "fixture-key" },
      }),
    ).toThrow("invalid_target_supabase_url");
  });

  it("rechaza endpoints de restore que no comparten una identidad aislada", () => {
    expect(() =>
      createSupabaseRestoreDependencies({
        knownProjectRefs: ["nwoivdxdupklervtnovd", "abcdefghijklmnopqrst"],
        targetDatabaseUrl:
          "postgresql://postgres:secret@db.qrstuvwxyzabcdefghij.supabase.co/postgres",
        targetFingerprint: "f".repeat(64),
        targetRef: "isolated-restore",
        targetServiceRoleKey: "service-role-secret",
        targetSupabaseUrl: "https://zyxwvutsrqponmlkjihg.supabase.co",
        tombstoneHmacKeys: { 1: "fixture-key" },
      }),
    ).toThrow("restore_target_identity_mismatch");
  });

  it("valida el marcador Storage contra el UUID con claves vigentes e históricas", () => {
    const targetRef = "isolated-marker-test";
    const dependencies = createSupabaseRestoreDependencies({
      knownProjectRefs,
      targetDatabaseUrl: isolatedDatabaseUrl,
      targetFingerprint: targetIdentityFingerprint({
        knownProjectRefs,
        targetDatabaseUrl: isolatedDatabaseUrl,
        targetRef,
        targetSupabaseUrl: isolatedSupabaseUrl,
      }),
      targetRef,
      targetServiceRoleKey: "service-role-secret",
      targetSupabaseUrl: isolatedSupabaseUrl,
      tombstoneHmacKeys: { 1: "legacy-key", 2: "current-key" },
    });
    const profileId = "5a000000-0000-4000-8000-000000005101";
    const legacyMarker = createHmac("sha256", "legacy-key")
      .update(profileId)
      .digest("hex");

    expect(
      dependencies.isStorageProfileMarkerValid({
        profileId,
        profileMarker: legacyMarker,
      }),
    ).toBe(true);
    expect(
      dependencies.isStorageProfileMarkerValid({
        profileId: "5b000000-0000-4000-8000-000000005102",
        profileMarker: legacyMarker,
      }),
    ).toBe(false);
    expect(
      dependencies.isStorageProfileMarkerValid({
        profileId: profileId.toUpperCase(),
        profileMarker: legacyMarker,
      }),
    ).toBe(false);
  });

  it("mantiene alineado el digest de política entre restore y SQL", async () => {
    const files = await Promise.all([
      readFile(
        new URL(
          "../../supabase/migrations/20260723160000_backup_restore_operations.sql",
          import.meta.url,
        ),
        "utf8",
      ),
      readFile(
        new URL(
          "../../supabase/migrations/20260730133410_align_restore_policy_digest.sql",
          import.meta.url,
        ),
        "utf8",
      ),
      readFile(
        new URL(
          "../../supabase/tests/database/backup_restore_behavior_test.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    ]);

    for (const file of files) {
      expect(file).toContain(SECURITY_POLICY_MANIFEST_DIGEST);
      expect(file).not.toContain(
        "de41957f4b5b5fbf2f19ddf15f3909be9e45a42fdba1083fbe5716108a2cfe16",
      );
    }
  });

  it("impide redirecciones al enviar la credencial de Storage", async () => {
    const targetRef = "isolated-redirect-test";
    const targetFingerprint = targetIdentityFingerprint({
      knownProjectRefs,
      targetDatabaseUrl: isolatedDatabaseUrl,
      targetRef,
      targetSupabaseUrl: isolatedSupabaseUrl,
    });
    let requests = 0;
    const dependencies = createSupabaseRestoreDependencies(
      {
        knownProjectRefs,
        targetDatabaseUrl: isolatedDatabaseUrl,
        targetFingerprint,
        targetRef,
        targetServiceRoleKey: "service-role-secret",
        targetSupabaseUrl: isolatedSupabaseUrl,
        tombstoneHmacKeys: { 1: "fixture-key" },
      },
      {
        fetcher: (_input, init) => {
          requests += 1;
          expect(init?.redirect).toBe("error");
          return Promise.resolve(
            new Response(null, {
              headers: { location: "https://attacker.example/collect" },
              status: 302,
            }),
          );
        },
      },
    );

    await expect(
      dependencies.uploadStorageObject({
        bucket: "plan-exports",
        bytes: new Uint8Array([1]),
        path: `${crypto.randomUUID()}/artifact.pdf`,
      }),
    ).rejects.toThrow("restore_storage_upload_failed");
    expect(requests).toBe(1);
  });

  it("rechaza Storage con objetos preexistentes aunque el contador esperado sea cero", async () => {
    const targetRef = "isolated-storage-test";
    const targetFingerprint = targetIdentityFingerprint({
      knownProjectRefs,
      targetDatabaseUrl: isolatedDatabaseUrl,
      targetRef,
      targetSupabaseUrl: isolatedSupabaseUrl,
    });
    const dependencies = createSupabaseRestoreDependencies(
      {
        knownProjectRefs,
        targetDatabaseUrl: isolatedDatabaseUrl,
        targetFingerprint,
        targetRef,
        targetServiceRoleKey: "service-role-secret",
        targetSupabaseUrl: isolatedSupabaseUrl,
        tombstoneHmacKeys: { 1: "fixture-key" },
      },
      {
        psql: (_databaseUrl: string, sql: string) => {
          if (sql.includes("from public.profiles")) return Promise.resolve("");
          if (sql.includes("from auth.sessions")) return Promise.resolve("0");
          if (sql.includes("security_policy_manifest")) {
            return Promise.resolve(SECURITY_POLICY_MANIFEST_DIGEST);
          }
          if (sql.includes("from storage.objects")) {
            return Promise.resolve(
              '[{"bucket":"plan-exports","path":"pre-existing.pdf"}]',
            );
          }
          throw new Error("unexpected_sql");
        },
      },
    );

    await expect(
      dependencies.verifyAbsenceAndSecurity({
        deletedMarkers: [],
        expectedStorageObjects: 0,
      }),
    ).resolves.toMatchObject({ storageComplete: false });
  });

  it("rechaza un manifiesto de políticas o AAL2 distinto del esperado", async () => {
    const targetRef = "isolated-policy-test";
    const targetFingerprint = targetIdentityFingerprint({
      knownProjectRefs,
      targetDatabaseUrl: isolatedDatabaseUrl,
      targetRef,
      targetSupabaseUrl: isolatedSupabaseUrl,
    });
    let policyStatement = "";
    const dependencies = createSupabaseRestoreDependencies(
      {
        knownProjectRefs,
        targetDatabaseUrl: isolatedDatabaseUrl,
        targetFingerprint,
        targetRef,
        targetServiceRoleKey: "service-role-secret",
        targetSupabaseUrl: isolatedSupabaseUrl,
        tombstoneHmacKeys: { 1: "fixture-key" },
      },
      {
        psql: (_databaseUrl: string, sql: string) => {
          if (sql.includes("from public.profiles")) return Promise.resolve("");
          if (sql.includes("from auth.sessions")) return Promise.resolve("0");
          if (sql.includes("security_policy_manifest")) {
            policyStatement = sql;
            return Promise.resolve("f".repeat(64));
          }
          if (sql.includes("from storage.objects")) return Promise.resolve("[]");
          throw new Error("unexpected_sql");
        },
      },
    );

    await expect(
      dependencies.verifyAbsenceAndSecurity({
        deletedMarkers: [],
        expectedStorageObjects: 0,
      }),
    ).resolves.toMatchObject({
      aal2Required: false,
      rlsVerified: false,
      securityPolicyDigest: "f".repeat(64),
    });
    expect(policyStatement).toContain(
      "aclexplode(\n        coalesce(relation.relacl, acldefault('r'",
    );
    expect(policyStatement).toContain(
      "aclexplode(\n        coalesce(procedure.proacl, acldefault('f'",
    );
  });

  it("reconstruye ambas fases con identidad y enlace criptográfico exactos", async () => {
    const targetRef = "isolated-audit-test";
    const targetFingerprint = targetIdentityFingerprint({
      knownProjectRefs,
      targetDatabaseUrl: isolatedDatabaseUrl,
      targetRef,
      targetSupabaseUrl: isolatedSupabaseUrl,
    });
    let statement = "";
    const dependencies = createSupabaseRestoreDependencies(
      {
        knownProjectRefs,
        targetDatabaseUrl: isolatedDatabaseUrl,
        targetFingerprint,
        targetRef,
        targetServiceRoleKey: "service-role-secret",
        targetSupabaseUrl: isolatedSupabaseUrl,
        tombstoneHmacKeys: { 1: "fixture-key" },
      },
      {
        psql: (_databaseUrl: string, sql: string) => {
          statement = sql;
          return Promise.resolve("1");
        },
      },
    );
    await dependencies.applyAuditRecords([
      {
        idempotencyHash: "a".repeat(64),
        payload: {
          action: "impersonation_start",
          createdAt: "2026-07-23T00:00:00.000Z",
          effectiveProfileId: null,
          originalActorId: "31000000-0000-4000-8000-000000005101",
          phase: "intent",
          requestId: "61000000-0000-4000-8000-000000005101",
          result: "pending",
          schemaVersion: 1,
          stream: "admin-audit",
          targetId: "51000000-0000-4000-8000-000000005101",
          targetType: "profile",
        },
        receipt: {
          idempotencyHash: "a".repeat(64),
          keyVersion: 1,
          recordHash: "b".repeat(64),
          sequence: 1,
          signature: "c".repeat(86),
          stream: "admin-audit",
          timestamp: "2026-07-23T00:00:00.000Z",
        },
        recordHash: "b".repeat(64),
        sequence: 1,
        timestamp: "2026-07-23T00:00:00.000Z",
      },
    ]);

    expect(statement).toContain("phase, original_actor_id, effective_profile_id");
    expect(statement).toContain("external_record_hash");
    expect(statement).toContain("external_receipt_signature");
    expect(statement).toContain("delete from private.technical_audit_events");
    expect(statement).toContain("disable trigger technical_audit_events_are_immutable");
    expect(statement).toContain("enable trigger technical_audit_events_are_immutable");
    expect(statement).toContain("delete from private.audit_outbox");
    expect(statement.indexOf("delete from private.audit_outbox")).toBeLessThan(
      statement.indexOf("delete from private.technical_audit_events"),
    );
    expect(statement).toContain("where external_sequence is not null");
    expect(statement).toContain("on conflict (request_id, phase) do update");
    expect(statement).toContain("external_sequence = excluded.external_sequence");
    expect(statement).toContain("created_at = excluded.created_at");
    expect(statement).toContain("result = excluded.result");
    expect(statement).not.toContain("where value ->> 'phase' = 'outcome'");
  });

  it("exige un marcador Storage canónico antes de cualquier mutación", async () => {
    const marker = "c".repeat(64);
    for (const [label, storageProfileMarker] of [
      ["missing", null],
      ["malformed", "not-a-canonical-marker"],
    ] as const) {
      const fixture = await fixtureBackup(`live-restore-${label}`, marker, {
        storageProfileMarker,
      });
      const target = await temporaryDirectory(`health-design-restore-${label}-`);
      const targetRef = `isolated-live-restore-${label}`;
      const targetFingerprint = targetIdentityFingerprint({
        knownProjectRefs,
        targetDatabaseUrl: isolatedDatabaseUrl,
        targetRef,
        targetSupabaseUrl: isolatedSupabaseUrl,
      });
      let mutations = 0;
      const mutate = () => {
        mutations += 1;
        return Promise.resolve();
      };

      await expect(
        restoreSupabaseRecoverySet(
          {
            databaseUrl: isolatedDatabaseUrl,
            directory: fixture.directory,
            keyring: fixture.keyring,
            knownProjectRefs,
            knownTombstoneKeyVersions: new Set([1]),
            ledgerHeadProvider: fixture.ledgerHeadProvider,
            backupJobId: fixture.promotionIdentity.backupJobId,
            restoreJobId: fixture.promotionIdentity.restoreJobId,
            targetFingerprint,
            targetDirectory: target,
            targetEnvironment: "local-isolated",
            targetRef,
            targetSupabaseUrl: isolatedSupabaseUrl,
          },
          {
            applyAuditRecords: mutate,
            applyCurrentMigrations: mutate,
            applyTombstones: mutate,
            assertDatabaseEmpty: () => Promise.resolve(),
            isStorageProfileMarkerValid: () => true,
            registerValidationKey: mutate,
            revokeSessions: mutate,
            runPgRestore: mutate,
            uploadStorageObject: mutate,
            verifyAbsenceAndSecurity: () =>
              Promise.resolve({
                aal2Required: true,
                deletedProfilesAbsent: true,
                rlsVerified: true,
                securityPolicyDigest: "d".repeat(64),
                sessionsRevoked: true,
                storageComplete: true,
              }),
          },
        ),
      ).rejects.toThrow("storage_profile_marker_required");
      expect(mutations).toBe(0);
    }
  });

  it("rechaza marcadores Storage no ligados al UUID antes de cualquier mutación", async () => {
    const profileId = "5a000000-0000-4000-8000-000000005101";
    const marker = createHmac("sha256", "fixture-key").update(profileId).digest("hex");
    for (const [label, storageProfileId, storageProfileMarker] of [
      ["wrong-canonical", profileId, "d".repeat(64)],
      ["cross-profile", "5b000000-0000-4000-8000-000000005102", marker],
      ["uppercase-profile", profileId.toUpperCase(), marker],
    ] as const) {
      const fixture = await fixtureBackup(`binding-${label}`, marker, {
        storageProfileId,
        storageProfileMarker,
      });
      const targetRef = `isolated-binding-${label}`;
      const targetFingerprint = targetIdentityFingerprint({
        knownProjectRefs,
        targetDatabaseUrl: isolatedDatabaseUrl,
        targetRef,
        targetSupabaseUrl: isolatedSupabaseUrl,
      });
      const validator = createSupabaseRestoreDependencies({
        knownProjectRefs,
        targetDatabaseUrl: isolatedDatabaseUrl,
        targetFingerprint,
        targetRef,
        targetServiceRoleKey: "service-role-secret",
        targetSupabaseUrl: isolatedSupabaseUrl,
        tombstoneHmacKeys: { 1: "fixture-key" },
      });
      let mutations = 0;
      const mutate = () => {
        mutations += 1;
        return Promise.resolve();
      };

      await expect(
        restoreSupabaseRecoverySet(
          {
            backupJobId: fixture.promotionIdentity.backupJobId,
            databaseUrl: isolatedDatabaseUrl,
            directory: fixture.directory,
            keyring: fixture.keyring,
            knownProjectRefs,
            knownTombstoneKeyVersions: new Set([1]),
            ledgerHeadProvider: fixture.ledgerHeadProvider,
            restoreJobId: fixture.promotionIdentity.restoreJobId,
            targetDirectory: await temporaryDirectory(
              `health-design-restore-binding-${label}-`,
            ),
            targetEnvironment: "local-isolated",
            targetFingerprint,
            targetRef,
            targetSupabaseUrl: isolatedSupabaseUrl,
          },
          {
            applyAuditRecords: mutate,
            applyCurrentMigrations: mutate,
            applyTombstones: mutate,
            assertDatabaseEmpty: () => Promise.resolve(),
            isStorageProfileMarkerValid: (input) =>
              validator.isStorageProfileMarkerValid(input),
            onRecoveryVerified: mutate,
            registerValidationKey: mutate,
            revokeSessions: mutate,
            runPgRestore: mutate,
            uploadStorageObject: mutate,
            verifyAbsenceAndSecurity: () =>
              Promise.resolve({
                aal2Required: true,
                deletedProfilesAbsent: true,
                rlsVerified: true,
                securityPolicyDigest: SECURITY_POLICY_MANIFEST_DIGEST,
                sessionsRevoked: true,
                storageComplete: true,
              }),
          },
        ),
      ).rejects.toThrow("storage_profile_marker_binding_invalid");
      expect(mutations).toBe(0);
    }
  });

  it("ejecuta pg_restore sin secretos en argv y verifica invariantes antes de promover", async () => {
    const profileId = "51000000-0000-4000-8000-000000005101";
    const marker = createHmac("sha256", "fixture-key").update(profileId).digest("hex");
    const fixture = await fixtureBackup("live-restore", marker, {
      storageProfileId: profileId,
      suffixCompletedRange: true,
    });
    const target = await temporaryDirectory("health-design-restore-live-");
    const targetRef = "isolated-live-restore";
    const targetFingerprint = targetIdentityFingerprint({
      knownProjectRefs,
      targetDatabaseUrl: isolatedDatabaseUrl,
      targetRef,
      targetSupabaseUrl: isolatedSupabaseUrl,
    });
    const calls: string[] = [];
    const result = await restoreSupabaseRecoverySet(
      {
        databaseUrl: isolatedDatabaseUrl,
        directory: fixture.directory,
        keyring: fixture.keyring,
        knownProjectRefs,
        knownTombstoneKeyVersions: new Set([1]),
        ledgerHeadProvider: fixture.ledgerHeadProvider,
        backupJobId: fixture.promotionIdentity.backupJobId,
        restoreJobId: fixture.promotionIdentity.restoreJobId,
        targetFingerprint,
        targetDirectory: target,
        targetEnvironment: "local-isolated",
        targetRef,
        targetSupabaseUrl: isolatedSupabaseUrl,
      },
      {
        applyAuditRecords: () => {
          calls.push("audit");
          return Promise.resolve();
        },
        applyCurrentMigrations: () => {
          calls.push("migrate");
          return Promise.resolve();
        },
        applyTombstones: (markers) => {
          calls.push(`tombstones:${markers.length}`);
          return Promise.resolve();
        },
        assertDatabaseEmpty: () => {
          calls.push("empty");
          return Promise.resolve();
        },
        isStorageProfileMarkerValid: ({ profileId: candidateId, profileMarker }) =>
          profileMarker ===
          createHmac("sha256", "fixture-key").update(candidateId).digest("hex"),
        registerValidationKey: () => {
          calls.push("key");
          return Promise.resolve();
        },
        revokeSessions: () => {
          calls.push("sessions");
          return Promise.resolve();
        },
        runPgRestore: ({ args, environment }) => {
          expect(args.join(" ")).not.toContain("isolated-secret");
          expect(args).not.toContain("--no-owner");
          expect(args).not.toContain("--no-privileges");
          expect(environment.PGDATABASE).toBe(isolatedDatabaseUrl);
          calls.push("restore");
          return Promise.resolve();
        },
        uploadStorageObject: () => {
          calls.push("storage");
          return Promise.resolve();
        },
        verifyAbsenceAndSecurity: () => {
          calls.push("verify");
          return Promise.resolve({
            aal2Required: true,
            deletedProfilesAbsent: true,
            rlsVerified: true,
            securityPolicyDigest: SECURITY_POLICY_MANIFEST_DIGEST,
            sessionsRevoked: true,
            storageComplete: true,
          });
        },
      },
    );

    expect(calls).toEqual([
      "empty",
      "restore",
      "migrate",
      "tombstones:1",
      "audit",
      "sessions",
      "key",
      "verify",
    ]);
    expect(result.status).toBe("ready_for_promotion");
    expect(result.trafficEnabled).toBe(false);
    expect(result.promotion.payload).toMatchObject({
      aal2Required: true,
      securityPolicyDigest: SECURITY_POLICY_MANIFEST_DIGEST,
    });
  });

  it("bloquea la promoción si el destino no conserva AAL2", async () => {
    const profileId = "51000000-0000-4000-8000-000000005101";
    const marker = createHmac("sha256", "fixture-key").update(profileId).digest("hex");
    const fixture = await fixtureBackup("live-restore-without-aal2", marker, {
      storageProfileId: profileId,
    });
    const target = await temporaryDirectory("health-design-restore-no-aal2-");
    const targetRef = "isolated-live-restore-no-aal2";
    const targetFingerprint = targetIdentityFingerprint({
      knownProjectRefs,
      targetDatabaseUrl: isolatedDatabaseUrl,
      targetRef,
      targetSupabaseUrl: isolatedSupabaseUrl,
    });
    await expect(
      restoreSupabaseRecoverySet(
        {
          databaseUrl: isolatedDatabaseUrl,
          directory: fixture.directory,
          keyring: fixture.keyring,
          knownProjectRefs,
          knownTombstoneKeyVersions: new Set([1]),
          ledgerHeadProvider: fixture.ledgerHeadProvider,
          backupJobId: fixture.promotionIdentity.backupJobId,
          restoreJobId: fixture.promotionIdentity.restoreJobId,
          targetFingerprint,
          targetDirectory: target,
          targetEnvironment: "local-isolated",
          targetRef,
          targetSupabaseUrl: isolatedSupabaseUrl,
        },
        {
          applyAuditRecords: () => Promise.resolve(),
          applyCurrentMigrations: () => Promise.resolve(),
          applyTombstones: () => Promise.resolve(),
          assertDatabaseEmpty: () => Promise.resolve(),
          isStorageProfileMarkerValid: ({ profileId: candidateId, profileMarker }) =>
            profileMarker ===
            createHmac("sha256", "fixture-key").update(candidateId).digest("hex"),
          registerValidationKey: () => Promise.resolve(),
          revokeSessions: () => Promise.resolve(),
          runPgRestore: () => Promise.resolve(),
          uploadStorageObject: () => Promise.resolve(),
          verifyAbsenceAndSecurity: () =>
            Promise.resolve({
              aal2Required: false,
              deletedProfilesAbsent: true,
              rlsVerified: true,
              securityPolicyDigest: SECURITY_POLICY_MANIFEST_DIGEST,
              sessionsRevoked: true,
              storageComplete: true,
            }),
        },
      ),
    ).rejects.toThrow("restore_invariant_failed");
  });

  it("bloquea el job y cuarentena el destino tras un fallo parcial", async () => {
    const target = await temporaryDirectory("health-design-restore-failed-");
    const transitions: string[] = [];
    const result = await quarantineFailedRestore({
      dependencies: {
        revokeSessions: () => {
          transitions.push("sessions");
          return Promise.resolve();
        },
      },
      job: { status: "restoring", version: 3 },
      jobs: {
        transitionRestore: (_id, version, status, extra) => {
          expect(version).toBe(3);
          expect(status).toBe("blocked");
          expect(extra).toEqual({ p_error_code: "restore_verification_failed" });
          transitions.push("blocked");
          return Promise.resolve({ status: "blocked", version: 4 });
        },
      },
      restoreId: "81000000-0000-4000-8000-000000018301",
      targetDirectory: target,
    });

    expect(result).toEqual({
      jobBlocked: true,
      sessionsRevoked: true,
      targetQuarantined: true,
    });
    expect(transitions).toEqual(["blocked", "sessions"]);
    await expect(
      readFile(`${target}/restore-quarantine.json`, "utf8"),
    ).resolves.toContain('"trafficEnabled":false');
  });

  it("no afirma revocación de sesiones si el adaptador no llegó a crearse", async () => {
    const target = await temporaryDirectory("health-design-restore-no-adapter-");
    await expect(
      quarantineFailedRestore({
        job: { status: "verifying", version: 2 },
        jobs: {
          transitionRestore: () => Promise.resolve({ status: "blocked", version: 3 }),
        },
        restoreId: "81000000-0000-4000-8000-000000018302",
        targetDirectory: target,
      }),
    ).resolves.toEqual({
      jobBlocked: true,
      sessionsRevoked: false,
      targetQuarantined: true,
    });
  });

  it("solo reabre una cuarentena exacta tras rehacer el destino aislado", async () => {
    const restoreId = "81000000-0000-4000-8000-000000018303";
    const target = await temporaryDirectory("health-design-restore-retry-");
    await quarantineFailedRestore({
      job: { status: "verifying", version: 2 },
      jobs: {
        transitionRestore: () => Promise.resolve({ status: "blocked", version: 3 }),
      },
      restoreId,
      targetDirectory: target,
    });

    await expect(
      prepareQuarantinedRetry({ restoreId, targetDirectory: target }),
    ).resolves.toBe(true);
    await expect(
      readFile(`${target}/restore-quarantine.json`, "utf8"),
    ).resolves.toContain(restoreId);
    await expect(
      clearQuarantinedRetry({ restoreId, targetDirectory: target }),
    ).resolves.toBe(true);
    await expect(
      readFile(`${target}/restore-quarantine.json`, "utf8"),
    ).rejects.toMatchObject({ code: "ENOENT" });

    const tampered = await temporaryDirectory("health-design-restore-tampered-");
    await writeFile(
      join(tampered, "restore-quarantine.json"),
      JSON.stringify({
        restoreId: "81000000-0000-4000-8000-000000018304",
        status: "quarantined",
        trafficEnabled: false,
      }),
    );
    await writeFile(join(tampered, "partial-data"), "must-be-reset");
    await expect(
      prepareQuarantinedRetry({ restoreId, targetDirectory: tampered }),
    ).rejects.toThrow("restore_target_reset_required");
  });

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
    ).rejects.toThrow("known_project_refs_required");
    await expect(
      assertIsolatedRestoreTarget({
        knownProjectRefs: ["development-ref", "production-ref"],
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
        knownProjectRefs: ["development-ref", "production-ref"],
        targetDirectory: join(symlinkRoot, "linked"),
        targetEnvironment: "local-isolated",
        targetRef: "local-drill",
      }),
    ).rejects.toThrow("restore_target_symlink");
  });

  it("elimina perfiles y objetos tombstoned, repone auditoría y revoca sesiones", async () => {
    const marker = "b".repeat(64);
    for (const backupId of ["rotation-1", "rotation-2", "rotation-3", "rotation-4"]) {
      const fixture = await fixtureBackup(
        backupId,
        marker,
        backupId === "rotation-4" ? { suffixCompletedRange: true } : {},
      );
      const target = await temporaryDirectory("health-design-restore-");
      const result = await restoreFixtureRecoverySet({
        directory: fixture.directory,
        keyring: fixture.keyring,
        knownTombstoneKeyVersions: new Set([1]),
        knownProjectRefs: ["development-ref", "production-ref"],
        ledgerHeadProvider: fixture.ledgerHeadProvider,
        ...fixture.promotionIdentity,
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
        policyDigest: SECURITY_POLICY_MANIFEST_DIGEST,
        rlsEnabled: true,
      });
      await expect(verifyRestoreValidation(result, fixture.keyring)).resolves.toBe(
        true,
      );
      await expect(
        verifyRestoreValidation(
          {
            ...result,
            database: {
              ...result.database,
              profiles: [{ alias: "Inyectado", marker: "f".repeat(64) }],
            },
          },
          fixture.keyring,
        ),
      ).rejects.toThrow("restore_validation_failed");
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
        knownTombstoneKeyVersions: new Set([1]),
        knownProjectRefs: ["development-ref", "production-ref"],
        ledgerHeadProvider: pending.ledgerHeadProvider,
        ...pending.promotionIdentity,
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
        knownTombstoneKeyVersions: new Set([1]),
        knownProjectRefs: ["development-ref", "production-ref"],
        ledgerHeadProvider: partial.ledgerHeadProvider,
        ...partial.promotionIdentity,
        targetDirectory: await temporaryDirectory("health-design-restore-"),
        targetEnvironment: "local-isolated",
        targetRef: "isolated-partial",
      }),
    ).rejects.toThrow("incomplete_audit_range");
  });

  it("bloquea un intent pendiente añadido en el sufijo vivo", async () => {
    const fixture = await fixtureBackup("suffix-pending", "d".repeat(64), {
      suffixPendingIntent: true,
    });
    const targetRef = "isolated-suffix-pending";
    await expect(
      restoreSupabaseRecoverySet(
        {
          backupJobId: fixture.promotionIdentity.backupJobId,
          databaseUrl: isolatedDatabaseUrl,
          directory: fixture.directory,
          keyring: fixture.keyring,
          knownProjectRefs,
          knownTombstoneKeyVersions: new Set([1]),
          ledgerHeadProvider: fixture.ledgerHeadProvider,
          restoreJobId: fixture.promotionIdentity.restoreJobId,
          targetDirectory: await temporaryDirectory("health-design-restore-"),
          targetEnvironment: "local-isolated",
          targetFingerprint: targetIdentityFingerprint({
            knownProjectRefs,
            targetDatabaseUrl: isolatedDatabaseUrl,
            targetRef,
            targetSupabaseUrl: isolatedSupabaseUrl,
          }),
          targetRef,
          targetSupabaseUrl: isolatedSupabaseUrl,
        },
        {
          assertDatabaseEmpty: () => Promise.resolve(),
          isStorageProfileMarkerValid: () => true,
        } as never,
      ),
    ).rejects.toThrow("restore_ledger_not_closed");
  });

  it("rechaza una cadena de tombstones alterada aunque la copia sea criptográficamente válida", async () => {
    const fixture = await fixtureBackup("broken-ledger", "c".repeat(64), {
      brokenLedger: true,
    });
    await expect(
      restoreFixtureRecoverySet({
        directory: fixture.directory,
        keyring: fixture.keyring,
        knownProjectRefs: ["development-ref", "production-ref"],
        knownTombstoneKeyVersions: new Set([1]),
        ledgerHeadProvider: fixture.ledgerHeadProvider,
        ...fixture.promotionIdentity,
        targetDirectory: await temporaryDirectory("health-design-restore-"),
        targetEnvironment: "local-isolated",
        targetRef: "isolated-broken-ledger",
      }),
    ).rejects.toThrow("ledger_divergence");
  });

  it("rechaza colisiones que intentarían sobrescribir la auditoría restaurada", async () => {
    const fixture = await fixtureBackup("audit-collision", "c".repeat(64), {
      conflictingAudit: true,
    });
    await expect(
      restoreFixtureRecoverySet({
        directory: fixture.directory,
        keyring: fixture.keyring,
        knownProjectRefs: ["development-ref", "production-ref"],
        knownTombstoneKeyVersions: new Set([1]),
        ledgerHeadProvider: fixture.ledgerHeadProvider,
        ...fixture.promotionIdentity,
        targetDirectory: await temporaryDirectory("health-design-restore-"),
        targetEnvironment: "local-isolated",
        targetRef: "isolated-audit-collision",
      }),
    ).rejects.toThrow("audit_record_collision");
  });

  it("rechaza path traversal del manifiesto antes de escribir", () => {
    expect(() => assertSafeLogicalPath("../outside")).toThrow("unsafe_manifest_path");
    expect(() => assertSafeLogicalPath("storage/../../outside")).toThrow(
      "unsafe_manifest_path",
    );
  });
});
