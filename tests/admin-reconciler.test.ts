import { describe, expect, it } from "vitest";

import {
  handleAdminReconciliation,
  type AdminReconciliationDependencies,
  type PendingAuditIdentity,
} from "../supabase/functions/admin-reconciler/index";

const pendingOutbox: PendingAuditIdentity = {
  action: "impersonation_start",
  effectiveProfileId: "51000000-0000-4000-8000-000000005101",
  impersonationSessionId: "71000000-0000-4000-8000-000000005101",
  intentRecordHash: "a".repeat(64),
  originalActorId: "31000000-0000-4000-8000-000000005101",
  requestId: "61000000-0000-4000-8000-000000005104",
  targetId: "51000000-0000-4000-8000-000000005101",
  targetType: "profile",
};

const orphanIntent: PendingAuditIdentity = {
  action: "impersonation_start",
  effectiveProfileId: "51000000-0000-4000-8000-000000005102",
  impersonationSessionId: null,
  intentRecordHash: "b".repeat(64),
  originalActorId: "31000000-0000-4000-8000-000000005101",
  requestId: "61000000-0000-4000-8000-000000005105",
  targetId: "51000000-0000-4000-8000-000000005102",
  targetType: "profile",
};

function request() {
  return new Request(
    "https://project.supabase.co/functions/v1/admin-reconciler/v1/admin-audit/reconcile",
    {
      body: JSON.stringify({ schemaVersion: 1 }),
      headers: { "content-type": "application/json" },
      method: "POST",
    },
  );
}

function setup(): {
  calls: string[];
  dependencies: AdminReconciliationDependencies;
} {
  const calls: string[] = [];
  return {
    calls,
    dependencies: {
      authenticate: () => {
        calls.push("authenticate");
        return Promise.resolve(true);
      },
      closeFailure: (item) => {
        calls.push(`failure:${item.requestId}`);
        return Promise.resolve();
      },
      closeSuccess: (item) => {
        calls.push(`success:${item.requestId}`);
        return Promise.resolve();
      },
      listExternalPending: () => {
        calls.push("external:list");
        return Promise.resolve([orphanIntent]);
      },
      listPendingOutbox: () => {
        calls.push("outbox:list");
        return Promise.resolve([pendingOutbox]);
      },
      requestState: (requestId) => {
        calls.push(`state:${requestId}`);
        return Promise.resolve(null);
      },
    },
  };
}

describe("reconciliador administrativo", () => {
  it("rechaza llamadas que no superan la autenticación de servicio", async () => {
    const state = setup();
    state.dependencies.authenticate = () => Promise.resolve(false);

    const response = await handleAdminReconciliation(request(), state.dependencies);

    expect(response.status).toBe(401);
    expect(state.calls).toEqual([]);
  });

  it("vacía el outbox y cierra como fallo un intent huérfano", async () => {
    const state = setup();

    const response = await handleAdminReconciliation(request(), state.dependencies);

    expect(response.status).toBe(200);
    expect(state.calls).toEqual([
      "authenticate",
      "outbox:list",
      `success:${pendingOutbox.requestId}`,
      "external:list",
      `state:${orphanIntent.requestId}`,
      `failure:${orphanIntent.requestId}`,
    ]);
    await expect(response.json()).resolves.toEqual({
      closed: 1,
      pending: 0,
      reconciledFailures: 1,
    });
  });

  it("mantiene pendiente un cierre transitoriamente indisponible", async () => {
    const state = setup();
    state.dependencies.listExternalPending = () => Promise.resolve([]);
    state.dependencies.closeSuccess = () =>
      Promise.reject(new Error("dependency_unavailable"));

    const response = await handleAdminReconciliation(request(), state.dependencies);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      closed: 0,
      pending: 1,
      reconciledFailures: 0,
    });
  });
});
