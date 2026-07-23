import { describe, expect, it } from "vitest";

import {
  executeAuditRangeDeletion,
  prepareAuditRangeManifest,
  verifyAuditRangeGap,
} from "../../scripts/operations/audit-range.mjs";
import {
  cleanupEligibleAuth,
  selectAuthCleanupCandidates,
} from "../../scripts/operations/auth-cleanup.mjs";
import {
  buildOperationalEvent,
  operationalAlerts,
} from "../../scripts/operations/telemetry.mjs";
import {
  buildSyntheticLedger,
  verifyDeletionTombstones,
  verifyLedgerContinuity,
} from "../../scripts/operations/ledger-verifiers.mjs";

describe("verificadores de continuidad", () => {
  it("detecta divergencia y replay de tombstones", () => {
    const records = buildSyntheticLedger(
      [
        {
          markerKeyVersion: 1,
          operationId: "operation-1",
          profileMarker: "a".repeat(64),
          recordType: "profile_deletion",
          schemaVersion: 1,
          stream: "deletions",
        },
      ],
      "deletions",
    );
    expect(verifyDeletionTombstones(records, new Set([1])).sequence).toBe(1);
    expect(() =>
      verifyLedgerContinuity([{ ...records[0]!, previousHash: "f".repeat(64) }], {
        stream: "deletions",
      }),
    ).toThrow("ledger_divergence");
    const replay = buildSyntheticLedger(
      [records[0]!.payload, records[0]!.payload],
      "deletions",
    );
    expect(() => verifyDeletionTombstones(replay, new Set([1]))).toThrow(
      "tombstone_replay",
    );
  });
});

describe("borrado excepcional de auditoría", () => {
  const records = [
    {
      objectKey: "admin-audit/development/00000000000000000002.json",
      recordHash: "2".repeat(64),
      sequence: 2,
    },
    {
      objectKey: "admin-audit/development/00000000000000000003.json",
      recordHash: "3".repeat(64),
      sequence: 3,
    },
  ];

  it("prepara un rango contiguo y solo acepta el par intent/complete exacto", async () => {
    const manifest = await prepareAuditRangeManifest({
      hashBeforeRange: "1".repeat(64),
      records: [...records].reverse(),
    });
    expect(manifest.fromSequence).toBe(2);
    expect(manifest.toSequence).toBe(3);
    expect(manifest.terminalRecordHash).toBe("3".repeat(64));
    expect(manifest.records.map((record) => record.sequence)).toEqual([2, 3]);

    expect(() =>
      verifyAuditRangeGap({
        complete: null,
        intent: { ...manifest, operationId: crypto.randomUUID() },
        manifest,
      }),
    ).toThrow("audit_range_incomplete");
    const operationId = crypto.randomUUID();
    expect(
      verifyAuditRangeGap({
        complete: { ...manifest, operationId },
        intent: { ...manifest, operationId },
        manifest,
      }),
    ).toBe(true);
    expect(() =>
      verifyAuditRangeGap({
        complete: { ...manifest, operationId, toSequence: 4 },
        intent: { ...manifest, operationId },
        manifest,
      }),
    ).toThrow("audit_range_receipt_mismatch");
  });

  it("revoca siempre la credencial JIT y deja un fallo parcial reanudable", async () => {
    const manifest = await prepareAuditRangeManifest({
      hashBeforeRange: "1".repeat(64),
      records,
    });
    const calls: string[] = [];
    await expect(
      executeAuditRangeDeletion(
        {
          confirmationId: "audit-job-1",
          environment: "development",
          manifest,
          operationId: "audit-job-1",
        },
        {
          appendComplete: () => {
            calls.push("complete");
            return Promise.resolve();
          },
          appendIntent: () => {
            calls.push("intent");
            return Promise.resolve();
          },
          createJitCredential: (scope) => {
            calls.push(`jit:${scope.objectKeys.length}`);
            return Promise.resolve({ id: "opaque-credential" });
          },
          deleteObjects: (_credential, objectKeys) => {
            calls.push(`delete:${objectKeys.length}`);
            return Promise.reject(new Error("synthetic_partial_failure"));
          },
          revokeJitCredential: () => {
            calls.push("revoke");
            return Promise.resolve();
          },
          verifyAbsent: () => Promise.resolve(false),
        },
      ),
    ).rejects.toThrow("audit_range_delete_partial");
    expect(calls).toEqual(["intent", "jit:2", "delete:2", "revoke"]);
  });
});

describe("limpieza Auth", () => {
  const now = "2026-07-23T12:00:00.000Z";

  it("dry-run no elimina, limita a 100 y excluye membresías, SU y operaciones", async () => {
    const candidates = Array.from({ length: 130 }, (_, index) => ({
      actorDisabled: false,
      actorRole: index === 0 ? ("superadmin" as const) : ("device" as const),
      anonymous: true,
      authPresent: true,
      authSubject: crypto.randomUUID(),
      createdAt: "2026-07-20T00:00:00.000Z",
      hasActiveInvitation: index === 1,
      hasActiveMembership: index === 2,
      hasPendingOperation: index === 3,
      lastActiveAt: null,
    }));
    const selected = selectAuthCleanupCandidates(candidates, { limit: 100, now });
    expect(selected).toHaveLength(100);
    expect(selected.some((candidate) => candidate.actorRole === "superadmin")).toBe(
      false,
    );
    let deletions = 0;
    const result = await cleanupEligibleAuth(
      { candidates, dryRun: true, limit: 100, now },
      {
        deleteAuthUser: () => {
          deletions += 1;
          return Promise.resolve();
        },
        disableActor: () => Promise.resolve(),
      },
    );
    expect(result).toEqual({
      attempted: 0,
      eligible: 100,
      failed: 0,
      mode: "dry-run",
      succeeded: 0,
    });
    expect(deletions).toBe(0);
  });

  it("elimina Auth antes de deshabilitar actor, es idempotente y redacta resultados", async () => {
    const candidate = {
      actorDisabled: false,
      actorRole: "device" as const,
      anonymous: true,
      authPresent: true,
      authSubject: crypto.randomUUID(),
      createdAt: "2026-07-20T00:00:00.000Z",
      hasActiveInvitation: false,
      hasActiveMembership: false,
      hasPendingOperation: false,
      lastActiveAt: null,
    };
    const calls: string[] = [];
    const result = await cleanupEligibleAuth(
      { candidates: [candidate], dryRun: false, limit: 100, now },
      {
        deleteAuthUser: () => {
          calls.push("auth");
          candidate.authPresent = false;
          return Promise.resolve();
        },
        disableActor: () => {
          calls.push("actor");
          candidate.actorDisabled = true;
          return Promise.resolve();
        },
      },
    );
    const repeated = await cleanupEligibleAuth(
      { candidates: [candidate], dryRun: false, limit: 100, now },
      {
        deleteAuthUser: () => {
          calls.push("unexpected");
          return Promise.resolve();
        },
        disableActor: () => Promise.resolve(),
      },
    );
    expect(calls).toEqual(["actor", "auth"]);
    expect(result).toEqual({
      attempted: 1,
      eligible: 1,
      failed: 0,
      mode: "apply",
      succeeded: 1,
    });
    expect(repeated.attempted).toBe(0);
  });
});

describe("observabilidad allowlisted", () => {
  it("rechaza campos libres y no deja pasar canarios sensibles", () => {
    const canary = {
      alias: "CANARY_ALIAS",
      authorization: "Bearer CANARY_TOKEN",
      medication: "CANARY_MEDICATION",
      profileMarker: "CANARY_MARKER",
      storagePath: "CANARY_STORAGE_PATH",
      totp: "123456",
    };
    const requestId = crypto.randomUUID();
    const event = buildOperationalEvent({
      counter: 1,
      durationMs: 12,
      environment: "development",
      errorCode: null,
      jobType: "backup",
      opaqueId: "job_opaque_1",
      operation: "backup_verify",
      requestId,
      state: "ready",
      ...canary,
    });
    const serialized = JSON.stringify(event);
    for (const value of Object.values(canary)) {
      expect(serialized).not.toContain(value);
    }
    expect(event).toEqual({
      counter: 1,
      duration_ms: 12,
      environment: "development",
      error_code: null,
      job_type: "backup",
      opaque_id: "job_opaque_1",
      operation: "backup_verify",
      request_id: requestId,
      state: "ready",
    });
  });

  it("calcula alertas técnicas sin datos sensibles", () => {
    expect(
      operationalAlerts({
        backupReadyAgeHours: 169,
        cleanupFailures: 1,
        incompleteAuditRanges: 1,
        ledgerDiverged: true,
        pendingIntentAgeSeconds: 301,
        restoreBlocked: true,
        rotationPrunePending: true,
        rtoHours: 24,
      }),
    ).toEqual([
      "pending_intent_over_5m",
      "ledger_divergence",
      "backup_rpo_over_7d",
      "restore_blocked",
      "audit_range_incomplete",
      "auth_cleanup_failed",
      "rotation_prune_pending",
      "restore_rto_over_24h",
    ]);
  });
});
