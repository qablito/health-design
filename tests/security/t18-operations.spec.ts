import { describe, expect, it } from "vitest";

import {
  executeAuditRangeDeletion,
  prepareAuditRangeManifest,
  verifyAuditRangeGap,
} from "../../scripts/operations/audit-range.mjs";
import {
  assertDevelopmentCleanupTarget,
  cleanupEligibleAuth,
  selectAuthCleanupCandidates,
} from "../../scripts/operations/auth-cleanup.mjs";
import {
  buildOperationalEvent,
  operationalAlerts,
} from "../../scripts/operations/telemetry.mjs";
import {
  assertT18DevelopmentBoundary,
  t18RemoteDryRun,
} from "../../scripts/t18-remote-smoke.mjs";
import {
  buildSyntheticLedger,
  verifyAdminAuditClosure,
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

  it("acepta rekey y rangos completos, pero bloquea rangos incompletos", () => {
    const operationId = crypto.randomUUID();
    const rangeJobId = crypto.randomUUID();
    const records = buildSyntheticLedger(
      [
        {
          markerKeyVersion: 1,
          operationId,
          profileMarker: "a".repeat(64),
          recordType: "profile_deletion",
          schemaVersion: 1,
          stream: "deletions",
        },
        {
          markerKeyVersion: 2,
          operationId,
          previousMarkerKeyVersion: 1,
          previousProfileMarker: "a".repeat(64),
          profileMarker: "b".repeat(64),
          recordType: "profile_marker_rekey",
          schemaVersion: 1,
          stream: "deletions",
        },
        {
          auditDeletionJobId: rangeJobId,
          fromSequence: 4,
          hashBeforeRange: "a".repeat(64),
          operationId: rangeJobId,
          rangeHash: "c".repeat(64),
          recordType: "audit_range_delete_intent",
          schemaVersion: 1,
          stream: "deletions",
          terminalRecordHash: "b".repeat(64),
          toSequence: 5,
        },
      ],
      "deletions",
    );
    const incomplete = verifyDeletionTombstones(records, new Set([1, 2]));
    expect(incomplete.activeProfileMarkers).toEqual(["b".repeat(64)]);
    expect(incomplete.activeProfileMarkerKeyVersions).toEqual([2]);
    expect(incomplete.incompleteAuditRanges).toEqual([
      {
        fromSequence: 4,
        jobId: rangeJobId,
        toSequence: 5,
      },
    ]);
    const completed = buildSyntheticLedger(
      [
        ...records.map((record) => record.payload),
        {
          auditDeletionJobId: rangeJobId,
          fromSequence: 4,
          hashBeforeRange: "a".repeat(64),
          intentRecordHash: records[2]!.recordHash,
          operationId: rangeJobId,
          rangeHash: "c".repeat(64),
          recordType: "audit_range_delete_complete",
          schemaVersion: 1,
          stream: "deletions",
          terminalRecordHash: "b".repeat(64),
          toSequence: 5,
        },
      ],
      "deletions",
    );
    const verified = verifyDeletionTombstones(completed, new Set([1, 2]));
    expect(verified.incompleteAuditRanges).toEqual([]);
    expect(verified.completedAuditRanges).toEqual([
      {
        complete: {
          fromSequence: 4,
          hashBeforeRange: "a".repeat(64),
          manifestDigest: "c".repeat(64),
          operationId: rangeJobId,
          terminalRecordHash: "b".repeat(64),
          toSequence: 5,
        },
        intent: {
          fromSequence: 4,
          hashBeforeRange: "a".repeat(64),
          manifestDigest: "c".repeat(64),
          operationId: rangeJobId,
          terminalRecordHash: "b".repeat(64),
          toSequence: 5,
        },
        manifest: {
          fromSequence: 4,
          hashBeforeRange: "a".repeat(64),
          manifestDigest: "c".repeat(64),
          terminalRecordHash: "b".repeat(64),
          toSequence: 5,
        },
      },
    ]);
    const mismatchedOperation = buildSyntheticLedger(
      [
        ...records.map((record) => record.payload),
        {
          ...completed.at(-1)!.payload,
          operationId: crypto.randomUUID(),
        },
      ],
      "deletions",
    );
    expect(() =>
      verifyDeletionTombstones(mismatchedOperation, new Set([1, 2])),
    ).toThrow("audit_range_receipt_mismatch");
  });

  it("cierra un hueco autorizado al final del ledger sin convertir ausencias en cero", () => {
    const operationId = crypto.randomUUID();
    const receipt = {
      fromSequence: 1,
      hashBeforeRange: "0".repeat(64),
      manifestDigest: "c".repeat(64),
      operationId,
      terminalRecordHash: "b".repeat(64),
      toSequence: 2,
    };
    const gap = {
      complete: receipt,
      intent: { ...receipt },
      manifest: {
        fromSequence: 1,
        hashBeforeRange: "0".repeat(64),
        manifestDigest: "c".repeat(64),
        terminalRecordHash: "b".repeat(64),
        toSequence: 2,
      },
    };

    expect(
      verifyLedgerContinuity([], {
        gaps: [gap],
        stream: "admin-audit",
      }),
    ).toEqual({ head: "b".repeat(64), sequence: 2 });
    expect(() =>
      verifyLedgerContinuity([], {
        gaps: [
          {
            ...gap,
            manifest: { ...gap.manifest, hashBeforeRange: "f".repeat(64) },
          },
        ],
        stream: "admin-audit",
      }),
    ).toThrow();
    expect(() =>
      verifyLedgerContinuity(
        buildSyntheticLedger(
          [
            {
              action: "impersonation_start",
              requestId: crypto.randomUUID(),
              stream: "admin-audit",
            },
          ],
          "admin-audit",
        ),
        {
          gaps: [
            {
              ...gap,
              complete: { ...gap.complete, fromSequence: 3, toSequence: 4 },
              intent: { ...gap.intent, fromSequence: 3, toSequence: 4 },
              manifest: { ...gap.manifest, fromSequence: 3, toSequence: 4 },
            },
          ],
          stream: "admin-audit",
        },
      ),
    ).toThrow("ledger_gap");
    expect(() =>
      verifyLedgerContinuity([], {
        gaps: [gap],
        initialHead: "b".repeat(64),
        initialSequence: 2,
        stream: "admin-audit",
      }),
    ).toThrow("audit_range_outside_anchor");
  });

  it("rechaza outcomes que cambian la identidad inmutable del intent", () => {
    const requestId = crypto.randomUUID();
    const intent = {
      action: "impersonation_start",
      createdAt: "2026-07-23T00:00:00.000Z",
      effectiveProfileId: "51000000-0000-4000-8000-000000005101",
      originalActorId: "31000000-0000-4000-8000-000000005101",
      phase: "intent",
      requestId,
      result: "pending",
      schemaVersion: 1,
      stream: "admin-audit",
      targetId: "51000000-0000-4000-8000-000000005101",
      targetType: "profile",
    };
    const intentRecord = buildSyntheticLedger([intent], "admin-audit")[0]!;
    const records = buildSyntheticLedger(
      [
        intent,
        {
          ...intent,
          createdAt: "2026-07-23T00:00:01.000Z",
          intentRecordHash: intentRecord.recordHash,
          originalActorId: "31000000-0000-4000-8000-000000005102",
          phase: "outcome",
          result: "success",
        },
      ],
      "admin-audit",
    );

    expect(() => verifyAdminAuditClosure(records)).toThrow(
      "admin_audit_outcome_mismatch",
    );
  });
});

describe("borrado excepcional de auditoría", () => {
  const records = [
    {
      objectKey: "admin-audit/00000000000000000002.json",
      recordHash: "2".repeat(64),
      sequence: 2,
    },
    {
      objectKey: "admin-audit/00000000000000000003.json",
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
    expect(() =>
      verifyAuditRangeGap({
        complete: { ...manifest, operationId },
        intent: { ...manifest, operationId },
        manifest: { ...manifest, records: [] },
      }),
    ).toThrow("invalid_audit_range");
  });

  it("rechaza una clave de objeto que no corresponde a la secuencia firmada", async () => {
    await expect(
      prepareAuditRangeManifest({
        hashBeforeRange: "1".repeat(64),
        records: [
          {
            objectKey: "admin-audit/00000000000000000099.json",
            recordHash: "2".repeat(64),
            sequence: 2,
          },
        ],
      }),
    ).rejects.toThrow("invalid_audit_range_record");
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

  it("solo admite el proyecto canónico de Development", () => {
    expect(() =>
      assertDevelopmentCleanupTarget({
        environment: "development",
        projectRef: "nwoivdxdupklervtnovd",
        supabaseUrl: "https://nwoivdxdupklervtnovd.supabase.co",
      }),
    ).not.toThrow();
    expect(() =>
      assertDevelopmentCleanupTarget({
        environment: "development",
        projectRef: "otro-proyecto",
        supabaseUrl: "https://otro-proyecto.supabase.co",
      }),
    ).toThrow("cleanup_project_boundary_failed");
    expect(() =>
      assertDevelopmentCleanupTarget({
        environment: "production",
        projectRef: "nwoivdxdupklervtnovd",
        supabaseUrl: "https://nwoivdxdupklervtnovd.supabase.co",
      }),
    ).toThrow("cleanup_project_boundary_failed");
  });

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
      {
        candidates,
        dryRun: true,
        limit: 100,
        now,
        requestIdForCandidate: () => crypto.randomUUID(),
      },
      {
        appendIntent: () => Promise.resolve({ recordHash: "a".repeat(64) }),
        appendOutcome: () => Promise.resolve({ recordHash: "b".repeat(64) }),
        deleteAuthUser: () => {
          deletions += 1;
          return Promise.resolve();
        },
        disableActor: () => Promise.resolve(),
        finalizeOutcome: () => Promise.resolve(),
        markOutcome: () => Promise.resolve(),
        recordIntent: () => Promise.resolve(),
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

  it("nunca selecciona una identidad no anónima aunque esté inactiva", () => {
    expect(
      selectAuthCleanupCandidates(
        [
          {
            actorDisabled: false,
            actorRole: "device",
            anonymous: false,
            authPresent: true,
            authSubject: crypto.randomUUID(),
            createdAt: "2025-01-01T00:00:00.000Z",
            hasActiveInvitation: false,
            hasActiveMembership: false,
            hasPendingOperation: false,
            lastActiveAt: "2025-01-01T00:00:00.000Z",
          },
        ],
        { limit: 100, now },
      ),
    ).toEqual([]);
  });

  it("deshabilita el actor antes de eliminar Auth, es idempotente y redacta resultados", async () => {
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
      {
        candidates: [candidate],
        dryRun: false,
        limit: 100,
        now,
        requestIdForCandidate: () => "cleanup-request",
      },
      {
        appendIntent: () => {
          calls.push("intent");
          return Promise.resolve({ recordHash: "a".repeat(64) });
        },
        appendOutcome: (_candidate, _requestId, _receipt, result) => {
          calls.push(`outcome:${result}`);
          return Promise.resolve({ recordHash: "b".repeat(64) });
        },
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
        finalizeOutcome: (_requestId, _receipt, outcome) => {
          calls.push(`finalize:${outcome}`);
          return Promise.resolve();
        },
        markOutcome: (_requestId, outcome) => {
          calls.push(`mark:${outcome}`);
          return Promise.resolve();
        },
        recordIntent: () => {
          calls.push("record");
          return Promise.resolve();
        },
      },
    );
    const repeated = await cleanupEligibleAuth(
      {
        candidates: [candidate],
        dryRun: false,
        limit: 100,
        now,
        requestIdForCandidate: () => "cleanup-request",
      },
      {
        appendIntent: () => Promise.resolve({ recordHash: "a".repeat(64) }),
        appendOutcome: () => Promise.resolve({ recordHash: "b".repeat(64) }),
        deleteAuthUser: () => {
          calls.push("unexpected");
          return Promise.resolve();
        },
        disableActor: () => Promise.resolve(),
        finalizeOutcome: () => Promise.resolve(),
        markOutcome: () => Promise.resolve(),
        recordIntent: () => Promise.resolve(),
      },
    );
    expect(calls).toEqual([
      "intent",
      "record",
      "actor",
      "auth",
      "mark:success",
      "outcome:success",
      "finalize:success",
    ]);
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

describe("preflight remoto T18", () => {
  it("no usa red ni mutaciones y delimita Development", () => {
    expect(t18RemoteDryRun({})).toMatchObject({
      allowedEnvironment: {
        projectRef: "nwoivdxdupklervtnovd",
      },
      mode: "dry-run",
      mutations: false,
      network: false,
      status: "T18_REMOTE_PREFLIGHT_READY",
    });
  });

  it("rechaza cualquier referencia de Production", () => {
    expect(() =>
      assertT18DevelopmentBoundary({
        SUPABASE_PROJECT_REF: "rbfrpgafytexrarcfmmp",
      }),
    ).toThrow("production_is_forbidden");
    expect(() =>
      assertT18DevelopmentBoundary({
        SUPABASE_URL: "https://rbfrpgafytexrarcfmmp.supabase.co",
      }),
    ).toThrow("production_is_forbidden");
  });
});
