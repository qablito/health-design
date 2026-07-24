import { describe, expect, it } from "vitest";

import {
  handleAdmin,
  latestTotpTimestamp,
  type AdminDependencies,
  type AdminIntentInput,
} from "../supabase/functions/admin/index";
import type { LedgerReceipt } from "@health-design/contracts";

const userId = "00000000-0000-4000-8000-000000005101";
const actorId = "31000000-0000-4000-8000-000000005101";
const sessionId = "21000000-0000-4000-8000-000000005102";
const profileId = "51000000-0000-4000-8000-000000005101";
const impersonationSessionId = "71000000-0000-4000-8000-000000005101";
const requestId = "61000000-0000-4000-8000-000000005104";
const now = new Date("2026-07-17T16:00:00.000Z");
const nowSeconds = Math.floor(now.getTime() / 1_000);

const receipt: LedgerReceipt = {
  environment: "local",
  idempotencyHash: "a".repeat(64),
  keyVersion: 1,
  recordHash: "b".repeat(64),
  sequence: 1,
  signature: "A".repeat(86),
  stream: "admin-audit",
  timestamp: "2026-07-17T16:00:00.000Z",
};
const outcomeReceipt: LedgerReceipt = {
  ...receipt,
  idempotencyHash: "c".repeat(64),
  recordHash: "d".repeat(64),
  sequence: 2,
  timestamp: "2026-07-17T16:00:01.000Z",
};

function setup(
  options: {
    aal?: "aal1" | "aal2";
    mfaVerifiedAt?: number | null;
    receiptValid?: boolean;
  } = {},
) {
  const calls: string[] = [];
  const intents: AdminIntentInput[] = [];
  const failureOutcomes: Array<{ errorCode: string; requestId: string }> = [];
  const dependencies: AdminDependencies = {
    appendDeletionTombstone: () => {
      calls.push("ledger:deletion");
      return Promise.resolve({ ...receipt, stream: "deletions" });
    },
    appendFailureOutcome: (input) => {
      calls.push("ledger:failure");
      failureOutcomes.push({ errorCode: input.errorCode, requestId: input.requestId });
      return Promise.resolve(outcomeReceipt);
    },
    appendIntent: (input) => {
      calls.push("ledger:intent");
      intents.push(input);
      return Promise.resolve(receipt);
    },
    appendSuccessOutcome: () => {
      calls.push("ledger:success");
      return Promise.resolve(outcomeReceipt);
    },
    authenticate: () => {
      calls.push("auth");
      return Promise.resolve({
        aal: options.aal ?? "aal2",
        mfaVerifiedAt: options.mfaVerifiedAt ?? nowSeconds - 300,
        sessionId,
        userId,
      });
    },
    deleteAuthUser: () => {
      calls.push("auth:delete");
      return Promise.resolve();
    },
    deletePrivateObjects: () => {
      calls.push("storage:delete");
      return Promise.resolve();
    },
    environment: "local",
    now: () => now,
    rpc: (name) => {
      calls.push(`rpc:${name}`);
      if (name === "internal_admin_authorize") {
        return Promise.resolve({ data: actorId, error: null });
      }
      if (name === "internal_admin_start_impersonation") {
        return Promise.resolve({
          data: [
            {
              effective_profile_id: profileId,
              impersonation_session_id: impersonationSessionId,
              started_at: "2026-07-17T16:00:00.000Z",
            },
          ],
          error: null,
        });
      }
      if (name === "internal_admin_end_impersonation") {
        return Promise.resolve({
          data: [
            {
              effective_profile_id: profileId,
              ended_at: "2026-07-17T16:01:00.000Z",
              impersonation_session_id: impersonationSessionId,
            },
          ],
          error: null,
        });
      }
      if (name === "internal_admin_current_context") {
        return Promise.resolve({
          data: [
            {
              effective_profile_id: profileId,
              impersonation_session_id: impersonationSessionId,
              started_at: "2026-07-17T16:00:00.000Z",
            },
          ],
          error: null,
        });
      }
      if (name === "internal_admin_list_profiles") {
        return Promise.resolve({
          data: [
            {
              alias: "Perfil Admin Test",
              created_at: "2026-07-17T15:00:00.000Z",
              profile_id: profileId,
              status: "active",
            },
          ],
          error: null,
        });
      }
      if (name === "internal_admin_finalize_audit_outbox") {
        return Promise.resolve({ data: true, error: null });
      }
      if (name === "internal_admin_mark_t18_audit_outcome") {
        return Promise.resolve({ data: true, error: null });
      }
      if (name === "internal_admin_finalize_t18_audit_outbox") {
        return Promise.resolve({ data: true, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    },
    verifyIntentReceipt: () => {
      calls.push("receipt:verify");
      return Promise.resolve(options.receiptValid ?? true);
    },
    verifyDeletionReceipt: () => {
      calls.push("deletion-receipt:verify");
      return Promise.resolve(options.receiptValid ?? true);
    },
    verifyOutcomeReceipt: () => {
      calls.push("outcome:verify");
      return Promise.resolve(options.receiptValid ?? true);
    },
  };
  return { calls, dependencies, failureOutcomes, intents };
}

function mutationRequest(path: string): Request {
  return new Request(`https://api.test/admin${path}`, {
    body: JSON.stringify({ schemaVersion: 1 }),
    headers: {
      authorization: "Bearer test-jwt",
      "content-type": "application/json",
      "idempotency-key": requestId,
      origin: "http://127.0.0.1:5173",
    },
    method: "POST",
  });
}

describe("Edge administrativa", () => {
  it("purga un perfil en orden, conserva el job y cierra el outcome", async () => {
    const state = setup();
    let version = 1;
    let status = "queued";
    const completed = new Set<string>();
    const job = () => ({
      attempts: 0,
      completedAt: status === "purged" ? "2026-07-17T16:05:00.000Z" : null,
      errorCode: null,
      jobId: "71000000-0000-4000-8000-000000005101",
      profileId: status === "purged" ? null : profileId,
      requestedAt: "2026-07-17T15:00:00.000Z",
      schemaVersion: 1,
      status,
      steps: [
        "ledger",
        "access",
        "exports",
        "storage",
        "profile_data",
        "auth",
        "verification",
      ].map((name) => ({ completed: completed.has(name), name })),
      version,
    });
    state.dependencies.rpc = (name, args) => {
      state.calls.push(`rpc:${name}`);
      if (name === "internal_admin_authorize") {
        return Promise.resolve({ data: actorId, error: null });
      }
      if (name === "internal_admin_get_profile_deletion_secret") {
        return Promise.resolve({
          data: {
            job: job(),
            profileMarker: "a".repeat(64),
            profileMarkerKeyVersion: 1,
          },
          error: null,
        });
      }
      if (name === "internal_admin_complete_deletion_step") {
        completed.add(String(args.p_step_name));
        version += 1;
        return Promise.resolve({ data: job(), error: null });
      }
      if (name === "internal_admin_transition_deletion_job") {
        status = String(args.p_next_status);
        version += 1;
        return Promise.resolve({ data: job(), error: null });
      }
      if (name === "internal_list_profile_export_purge_paths") {
        return Promise.resolve({
          data: [{ artifactId: crypto.randomUUID(), storagePath: "private/a.pdf" }],
          error: null,
        });
      }
      if (name === "internal_admin_list_orphan_auth_subjects") {
        return Promise.resolve({
          data: ["00000000-0000-4000-8000-000000005199"],
          error: null,
        });
      }
      if (name === "internal_admin_verify_profile_purge") {
        return Promise.resolve({ data: true, error: null });
      }
      if (name === "internal_admin_finalize_audit_outbox") {
        return Promise.resolve({ data: true, error: null });
      }
      if (name === "internal_admin_mark_t18_audit_outcome") {
        return Promise.resolve({ data: true, error: null });
      }
      if (name === "internal_admin_finalize_t18_audit_outbox") {
        return Promise.resolve({ data: true, error: null });
      }
      return Promise.resolve({ data: job(), error: null });
    };

    const response = await handleAdmin(
      new Request(`https://api.test/admin/v1/admin/profiles/${profileId}/permanent`, {
        body: JSON.stringify({
          confirmationPhrase: "PURGAR PERFIL PERMANENTEMENTE",
          confirmed: true,
          expectedVersion: 1,
          schemaVersion: 1,
        }),
        headers: {
          authorization: "Bearer test-jwt",
          "content-type": "application/json",
          "idempotency-key": requestId,
          origin: "http://127.0.0.1:5173",
        },
        method: "DELETE",
      }),
      state.dependencies,
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      jobId: "71000000-0000-4000-8000-000000005101",
      profileId: null,
      status: "purged",
    });
    expect(state.calls.indexOf("ledger:deletion")).toBeLessThan(
      state.calls.indexOf("rpc:internal_admin_revoke_profile_access"),
    );
    expect(state.calls).toContain("storage:delete");
    expect(state.calls).toContain("auth:delete");
    expect(state.calls.slice(-3)).toEqual([
      "ledger:success",
      "outcome:verify",
      "rpc:internal_admin_finalize_t18_audit_outbox",
    ]);
  });

  it("reanuda por jobId después de purgar el perfil", async () => {
    const state = setup();
    const jobId = "71000000-0000-4000-8000-000000005101";
    let version = 8;
    let status = "failed";
    const completed = new Set([
      "ledger",
      "access",
      "exports",
      "storage",
      "profile_data",
    ]);
    const job = () => ({
      attempts: 1,
      completedAt: status === "purged" ? "2026-07-17T16:05:00.000Z" : null,
      errorCode: status === "failed" ? "auth_cleanup_pending" : null,
      jobId,
      profileId: null,
      requestedAt: "2026-07-17T15:00:00.000Z",
      schemaVersion: 1,
      status,
      steps: [
        "ledger",
        "access",
        "exports",
        "storage",
        "profile_data",
        "auth",
        "verification",
      ].map((name) => ({ completed: completed.has(name), name })),
      version,
    });
    state.dependencies.rpc = (name, args) => {
      state.calls.push(`rpc:${name}`);
      if (name === "internal_admin_authorize") {
        return Promise.resolve({ data: actorId, error: null });
      }
      if (name === "internal_admin_get_profile_deletion_secret") {
        expect(args).toMatchObject({
          p_job_id: jobId,
          p_profile_id: null,
        });
        return Promise.resolve({
          data: {
            job: job(),
            profileMarker: "a".repeat(64),
            profileMarkerKeyVersion: 1,
          },
          error: null,
        });
      }
      if (name === "internal_admin_complete_deletion_step") {
        completed.add(String(args.p_step_name));
        version += 1;
        return Promise.resolve({ data: job(), error: null });
      }
      if (name === "internal_admin_transition_deletion_job") {
        status = String(args.p_next_status);
        version += 1;
        return Promise.resolve({ data: job(), error: null });
      }
      if (name === "internal_admin_list_orphan_auth_subjects") {
        return Promise.resolve({
          data: ["00000000-0000-4000-8000-000000005199"],
          error: null,
        });
      }
      if (name === "internal_admin_verify_profile_purge") {
        return Promise.resolve({ data: true, error: null });
      }
      if (
        name === "internal_record_t18_admin_intent" ||
        name === "internal_admin_mark_t18_audit_outcome" ||
        name === "internal_admin_finalize_t18_audit_outbox"
      ) {
        return Promise.resolve({ data: true, error: null });
      }
      return Promise.resolve({ data: job(), error: null });
    };

    const response = await handleAdmin(
      new Request(`https://api.test/admin/v1/admin/deletion-jobs/${jobId}`, {
        body: JSON.stringify({
          confirmationPhrase: "PURGAR PERFIL PERMANENTEMENTE",
          confirmed: true,
          expectedVersion: 8,
          schemaVersion: 1,
        }),
        headers: {
          authorization: "Bearer test-jwt",
          "content-type": "application/json",
          "idempotency-key": requestId,
          origin: "http://127.0.0.1:5173",
        },
        method: "DELETE",
      }),
      state.dependencies,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      jobId,
      profileId: null,
      status: "purged",
    });
    expect(state.calls).not.toContain("ledger:deletion");
    expect(state.calls).not.toContain("storage:delete");
    expect(state.calls).toContain("auth:delete");
  });

  it("rechaza el borrado permanente en Production antes de mutar", async () => {
    const state = setup();
    state.dependencies.environment = "production";
    const response = await handleAdmin(
      new Request(`https://api.test/admin/v1/admin/profiles/${profileId}/permanent`, {
        body: JSON.stringify({
          confirmationPhrase: "PURGAR PERFIL PERMANENTEMENTE",
          confirmed: true,
          expectedVersion: 1,
          schemaVersion: 1,
        }),
        headers: {
          authorization: "Bearer test-jwt",
          "content-type": "application/json",
          "idempotency-key": requestId,
          origin: "https://health-design.pages.dev",
        },
        method: "DELETE",
      }),
      state.dependencies,
    );

    expect(response.status).toBe(409);
    expect(state.calls).toEqual(["auth"]);
  });

  it("extrae solo la verificación TOTP más reciente del JWT validado", () => {
    expect(
      latestTotpTimestamp([
        { method: "password", timestamp: nowSeconds - 600 },
        { method: "totp", timestamp: nowSeconds - 200 },
        { method: "totp", timestamp: nowSeconds - 100 },
        "totp",
      ]),
    ).toBe(nowSeconds - 100);
    expect(latestTotpTimestamp(["password", "totp"])).toBeNull();
  });

  it("rechaza AAL1 antes de tocar ledger o base de datos", async () => {
    const state = setup({ aal: "aal1" });
    const response = await handleAdmin(
      mutationRequest(`/v1/admin/profiles/${profileId}/impersonations`),
      state.dependencies,
    );

    expect(response.status).toBe(403);
    expect(state.calls).toEqual(["auth"]);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "AAL2_REQUIRED" },
    });
  });

  it("rechaza AAL2 si el último TOTP supera los cinco minutos", async () => {
    const state = setup({ mfaVerifiedAt: nowSeconds - 301 });
    const response = await handleAdmin(
      mutationRequest(`/v1/admin/profiles/${profileId}/impersonations`),
      state.dependencies,
    );

    expect(response.status).toBe(403);
    expect(state.calls).toEqual(["auth"]);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "AAL2_REQUIRED" },
    });
  });

  it("no muta si el intent no devuelve un recibo verificable", async () => {
    const state = setup({ receiptValid: false });
    const response = await handleAdmin(
      mutationRequest(`/v1/admin/profiles/${profileId}/impersonations`),
      state.dependencies,
    );

    expect(response.status).toBe(503);
    expect(state.calls).toEqual([
      "auth",
      "rpc:internal_admin_authorize",
      "ledger:intent",
      "receipt:verify",
    ]);
    expect(state.calls).not.toContain("rpc:internal_admin_start_impersonation");
  });

  it("persiste intent antes de iniciar y conserva todos los identificadores", async () => {
    const state = setup();
    const response = await handleAdmin(
      mutationRequest(`/v1/admin/profiles/${profileId}/impersonations`),
      state.dependencies,
    );

    expect(response.status).toBe(201);
    expect(state.calls).toEqual([
      "auth",
      "rpc:internal_admin_authorize",
      "ledger:intent",
      "receipt:verify",
      "rpc:internal_admin_start_impersonation",
      "ledger:success",
      "outcome:verify",
      "rpc:internal_admin_finalize_audit_outbox",
    ]);
    expect(state.intents).toEqual([
      {
        action: "impersonation_start",
        effectiveProfileId: profileId,
        originalActorId: actorId,
        requestId,
        targetId: profileId,
        targetType: "profile",
      },
    ]);
    await expect(response.json()).resolves.toEqual({
      active: true,
      effectiveProfileId: profileId,
      impersonationSessionId,
      startedAt: "2026-07-17T16:00:00.000Z",
    });
  });

  it("deja el outbox pendiente y responde 202 si el outcome no está disponible", async () => {
    const state = setup();
    state.dependencies.appendSuccessOutcome = () => {
      state.calls.push("ledger:success");
      return Promise.reject(new Error("ledger_unavailable"));
    };
    const response = await handleAdmin(
      mutationRequest(`/v1/admin/profiles/${profileId}/impersonations`),
      state.dependencies,
    );

    expect(response.status).toBe(202);
    expect(state.calls).toContain("rpc:internal_admin_start_impersonation");
    expect(state.calls).toContain("ledger:success");
    expect(state.calls).not.toContain("rpc:internal_admin_finalize_audit_outbox");
    await expect(response.json()).resolves.toMatchObject({
      active: true,
      auditClosure: "pending",
    });
  });

  it("cierra el intent con fallo si Postgres revierte antes del outbox", async () => {
    const state = setup();
    state.dependencies.rpc = (name) => {
      state.calls.push(`rpc:${name}`);
      if (name === "internal_admin_authorize") {
        return Promise.resolve({ data: actorId, error: null });
      }
      if (name === "internal_admin_mark_t18_audit_outcome") {
        return Promise.resolve({ data: false, error: null });
      }
      return Promise.resolve({
        data: null,
        error: { code: "22023", message: "profile_not_impersonable" },
      });
    };

    const response = await handleAdmin(
      mutationRequest(`/v1/admin/profiles/${profileId}/impersonations`),
      state.dependencies,
    );

    expect(response.status).toBe(409);
    expect(state.calls.slice(-2)).toEqual(["ledger:failure", "outcome:verify"]);
    expect(state.failureOutcomes).toEqual([
      { errorCode: "domain_constraint", requestId },
    ]);
  });

  it("recupera el indicador y finaliza en contexto administrativo", async () => {
    const state = setup();
    const context = await handleAdmin(
      new Request("https://api.test/admin/v1/admin/context", {
        headers: {
          authorization: "Bearer test-jwt",
          origin: "http://127.0.0.1:5173",
        },
      }),
      state.dependencies,
    );
    const ended = await handleAdmin(
      mutationRequest(`/v1/admin/impersonations/${impersonationSessionId}/end`),
      state.dependencies,
    );

    expect(context.status).toBe(200);
    await expect(context.json()).resolves.toMatchObject({
      active: true,
      impersonationSessionId,
    });
    expect(ended.status).toBe(200);
    await expect(ended.json()).resolves.toEqual({ active: false });
  });

  it("lista solo los metadatos administrativos allowlisted", async () => {
    const state = setup();
    const response = await handleAdmin(
      new Request("https://api.test/admin/v1/admin/profiles", {
        headers: {
          authorization: "Bearer test-jwt",
          origin: "http://127.0.0.1:5173",
        },
      }),
      state.dependencies,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual([
      {
        alias: "Perfil Admin Test",
        createdAt: "2026-07-17T15:00:00.000Z",
        profileId,
        status: "active",
      },
    ]);
  });

  it("crea y consulta BackupJob sin exponer material criptográfico", async () => {
    const state = setup();
    const backup = {
      backupId: requestId,
      createdAt: "2026-07-23T16:00:00.000Z",
      kind: "weekly",
      schemaVersion: 1,
      status: "queued",
      verifiedAt: null,
      version: 1,
    };
    state.dependencies.rpc = (name) => {
      state.calls.push(`rpc:${name}`);
      if (name === "internal_admin_authorize") {
        return Promise.resolve({ data: actorId, error: null });
      }
      if (name === "internal_admin_list_backup_jobs") {
        return Promise.resolve({ data: [backup], error: null });
      }
      if (name === "internal_admin_create_backup_job") {
        return Promise.resolve({ data: backup, error: null });
      }
      if (name === "internal_admin_finalize_audit_outbox") {
        return Promise.resolve({ data: true, error: null });
      }
      return Promise.resolve({ data: true, error: null });
    };

    const created = await handleAdmin(
      new Request("https://api.test/admin/v1/admin/backups", {
        body: JSON.stringify({ kind: "weekly", schemaVersion: 1 }),
        headers: {
          authorization: "Bearer test-jwt",
          "content-type": "application/json",
          "idempotency-key": requestId,
          origin: "http://127.0.0.1:5173",
        },
        method: "POST",
      }),
      state.dependencies,
    );
    const listed = await handleAdmin(
      new Request("https://api.test/admin/v1/admin/backups", {
        headers: {
          authorization: "Bearer test-jwt",
          origin: "http://127.0.0.1:5173",
        },
      }),
      state.dependencies,
    );

    expect(created.status).toBe(201);
    await expect(created.json()).resolves.toEqual(backup);
    expect(listed.status).toBe(200);
    await expect(listed.json()).resolves.toEqual([backup]);
    expect(state.intents.at(-1)).toMatchObject({
      action: "backup_create",
      effectiveProfileId: null,
      targetType: "backup_job",
    });
  });

  it("crea un restore aislado y autoriza su promoción por separado", async () => {
    const state = setup();
    const backupId = "71000000-0000-4000-8000-000000005188";
    let restore = {
      backupId,
      createdAt: "2026-07-23T16:00:00.000Z",
      restoreId: requestId,
      schemaVersion: 1,
      status: "queued",
      verifiedAt: null as string | null,
      version: 1,
    };
    state.dependencies.rpc = (name) => {
      state.calls.push(`rpc:${name}`);
      if (name === "internal_admin_authorize") {
        return Promise.resolve({ data: actorId, error: null });
      }
      if (name === "internal_admin_create_restore_job") {
        return Promise.resolve({ data: restore, error: null });
      }
      if (name === "internal_admin_promote_restore_job") {
        restore = {
          ...restore,
          status: "promoted",
          verifiedAt: "2026-07-23T16:10:00.000Z",
          version: 2,
        };
        return Promise.resolve({ data: restore, error: null });
      }
      if (name === "internal_admin_finalize_audit_outbox") {
        return Promise.resolve({ data: true, error: null });
      }
      return Promise.resolve({ data: true, error: null });
    };

    const created = await handleAdmin(
      new Request("https://api.test/admin/v1/admin/restores", {
        body: JSON.stringify({
          backupId,
          schemaVersion: 1,
          targetFingerprint: "e".repeat(64),
        }),
        headers: {
          authorization: "Bearer test-jwt",
          "content-type": "application/json",
          "idempotency-key": requestId,
          origin: "http://127.0.0.1:5173",
        },
        method: "POST",
      }),
      state.dependencies,
    );
    const promoted = await handleAdmin(
      new Request(`https://api.test/admin/v1/admin/restores/${requestId}/promote`, {
        body: JSON.stringify({
          confirmationPhrase: "PROMOVER RESTAURACIÓN VERIFICADA",
          confirmed: true,
          expectedVersion: 1,
          schemaVersion: 1,
        }),
        headers: {
          authorization: "Bearer test-jwt",
          "content-type": "application/json",
          "idempotency-key": "61000000-0000-4000-8000-000000005105",
          origin: "http://127.0.0.1:5173",
        },
        method: "POST",
      }),
      state.dependencies,
    );

    expect(created.status).toBe(201);
    expect(promoted.status).toBe(200);
    await expect(promoted.json()).resolves.toMatchObject({
      restoreId: requestId,
      status: "promoted",
    });
    expect(state.intents.slice(-2).map((intent) => intent.action)).toEqual([
      "restore_create",
      "restore_promote",
    ]);
  });
});
