import { describe, expect, it } from "vitest";

import {
  AdminBarcodeCorrectionApproveRequestSchema,
  AdminBarcodeCorrectionDetailSchema,
  AdminBarcodeCorrectionListSchema,
  AdminBarcodeCorrectionMutationAckSchema,
  AdminBarcodeCorrectionRejectRequestSchema,
  AdminBarcodeCorrectionRequestSchema,
  AdminMatchingRuleActivateRequestSchema,
  type LedgerReceipt,
} from "@health-design/contracts";
import { COMMERCIAL_PRODUCT_FIXTURE } from "@health-design/test-fixtures/products";
import {
  handleAdmin,
  type AdminDependencies,
  type AdminIntentInput,
} from "../supabase/functions/admin/index";

const correctionId = "82000000-0000-4000-8000-000000000001";
const revisionId = "82000000-0000-4000-8000-000000000002";
const profileId = "82000000-0000-4000-8000-000000000003";
const productId = "82000000-0000-4000-8000-000000000004";
const actorId = "82000000-0000-4000-8000-000000000006";
const requestId = "82000000-0000-4000-8000-000000000007";
const sessionId = "82000000-0000-4000-8000-000000000008";
const matchingRuleId = "82000000-0000-4000-8000-000000000005";
const now = new Date("2026-07-21T12:05:00.000Z");

const receipt: LedgerReceipt = {
  environment: "local",
  idempotencyHash: "a".repeat(64),
  keyVersion: 1,
  recordHash: "b".repeat(64),
  sequence: 1,
  signature: "A".repeat(86),
  stream: "admin-audit",
  timestamp: now.toISOString(),
};

function edgeSetup(aal: "aal1" | "aal2" = "aal2") {
  const calls: string[] = [];
  const intents: AdminIntentInput[] = [];
  const dependencies: AdminDependencies = {
    appendFailureOutcome: () => Promise.resolve({ ...receipt, sequence: 2 }),
    appendIntent: (input) => {
      calls.push("ledger:intent");
      intents.push(input);
      return Promise.resolve(receipt);
    },
    appendSuccessOutcome: () => {
      calls.push("ledger:success");
      return Promise.resolve({ ...receipt, recordHash: "c".repeat(64), sequence: 2 });
    },
    authenticate: () =>
      Promise.resolve({
        aal,
        mfaVerifiedAt: Math.floor(now.getTime() / 1_000) - 10,
        sessionId,
        userId: actorId,
      }),
    environment: "local",
    now: () => now,
    rpc: (name, args) => {
      calls.push(`rpc:${name}`);
      if (name === "internal_admin_list_barcode_corrections") {
        return Promise.resolve({
          data: [
            {
              completeness: "provisional",
              correction_id: correctionId,
              created_at: now.toISOString(),
              duplicate_count: "1",
              gtin14: COMMERCIAL_PRODUCT_FIXTURE.gtin.gtin14,
              name: COMMERCIAL_PRODUCT_FIXTURE.name,
              profile_id: profileId,
              status: "pending",
              version: 1,
            },
          ],
          error: null,
        });
      }
      if (name === "internal_admin_product_audit_context") {
        const action = args.p_action;
        return Promise.resolve({
          data: [
            {
              audit_target_id:
                action === "matching_rule_activate"
                  ? matchingRuleId
                  : action === "barcode_correction_approve"
                    ? revisionId
                    : correctionId,
              audit_target_type:
                action === "matching_rule_activate"
                  ? "product_matching_rule"
                  : action === "barcode_correction_approve"
                    ? "commercial_product_revision"
                    : "barcode_correction",
              effective_profile_id: profileId,
              original_actor_id: actorId,
            },
          ],
          error: null,
        });
      }
      if (name === "internal_admin_activate_product_matching_rule") {
        return Promise.resolve({
          data: {
            matchingRuleId,
            schemaVersion: 1,
            status: "active",
            version: 2,
          },
          error: null,
        });
      }
      if (name.startsWith("internal_admin_") && name.includes("barcode_correction")) {
        const status = name.includes("reject")
          ? "rejected"
          : name.includes("approve")
            ? "approved"
            : "pending";
        return Promise.resolve({
          data: {
            correctionId,
            globalRevisionId: name.includes("reject") ? null : revisionId,
            matchingRuleId: name.includes("approve") ? matchingRuleId : null,
            schemaVersion: 1,
            status,
            version: 2,
          },
          error: null,
        });
      }
      if (name === "internal_admin_finalize_audit_outbox") {
        return Promise.resolve({ data: true, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    },
    verifyIntentReceipt: () => Promise.resolve(true),
    verifyOutcomeReceipt: () => Promise.resolve(true),
  };
  return { calls, dependencies, intents };
}

function edgeRequest(path: string, body?: unknown) {
  return new Request(`https://api.test/admin${path}`, {
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    headers: {
      authorization: "Bearer test",
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      "idempotency-key": requestId,
      origin: "http://127.0.0.1:5173",
    },
    method: body === undefined ? "GET" : "POST",
  });
}

describe("contratos de revisión administrativa de productos", () => {
  it("mantiene una cola cerrada, paginada y sin convertir desconocidos en cero", () => {
    const parsed = AdminBarcodeCorrectionListSchema.parse({
      items: [
        {
          brand: "Marca prueba",
          completeness: "provisional",
          correctionId,
          createdAt: "2026-07-21T12:00:00.000Z",
          duplicateCount: 2,
          gtin14: COMMERCIAL_PRODUCT_FIXTURE.gtin.gtin14,
          name: "Producto prueba",
          profileId,
          status: "pending",
          version: 1,
        },
      ],
      nextCursor: correctionId,
      schemaVersion: 1,
    });

    expect(parsed.items[0]?.duplicateCount).toBe(2);
    expect(
      AdminBarcodeCorrectionListSchema.safeParse({ ...parsed, extra: true }).success,
    ).toBe(false);
  });

  it("compara snapshots completos y exige concurrencia en cada mutación", () => {
    const detail = AdminBarcodeCorrectionDetailSchema.parse({
      baseSnapshot: null,
      correctionId,
      createdAt: "2026-07-21T12:00:00.000Z",
      globalSnapshot: null,
      profileId,
      productId,
      proposedSnapshot: COMMERCIAL_PRODUCT_FIXTURE,
      reviewRevisionId: revisionId,
      schemaVersion: 1,
      status: "pending",
      version: 1,
    });
    expect(detail.proposedSnapshot.nutrients.fiberG).toEqual({ state: "unknown" });

    expect(
      AdminBarcodeCorrectionRequestSchema.safeParse({
        expectedVersion: 1,
        schemaVersion: 1,
        snapshot: COMMERCIAL_PRODUCT_FIXTURE,
      }).success,
    ).toBe(true);
    expect(
      AdminBarcodeCorrectionApproveRequestSchema.safeParse({
        canonicalFoodKey: "food:pollo.pechuga",
        evidence: ["revisión_etiqueta_v1"],
        expectedVersion: 2,
        matchState: "exact",
        schemaVersion: 1,
      }).success,
    ).toBe(true);
    expect(
      AdminBarcodeCorrectionRejectRequestSchema.safeParse({
        expectedVersion: 1,
        reason: "invalid_data",
        schemaVersion: 1,
      }).success,
    ).toBe(true);
    expect(
      AdminMatchingRuleActivateRequestSchema.safeParse({
        expectedVersion: 1,
        schemaVersion: 1,
      }).success,
    ).toBe(true);
    expect(
      AdminBarcodeCorrectionRejectRequestSchema.safeParse({
        reason: "lo_que_sea",
        schemaVersion: 1,
      }).success,
    ).toBe(false);
  });

  it("devuelve identificadores de publicación sin snapshots en el acuse", () => {
    const ack = AdminBarcodeCorrectionMutationAckSchema.parse({
      auditClosure: "pending",
      correctionId,
      globalRevisionId: revisionId,
      matchingRuleId: "82000000-0000-4000-8000-000000000005",
      schemaVersion: 1,
      status: "approved",
      version: 3,
    });
    expect(JSON.stringify(ack)).not.toContain("nutrients");
  });
});

describe("Edge de revisión administrativa de productos", () => {
  it("rechaza AAL1 y queries fuera del allowlist antes de consultar la cola", async () => {
    const aal1 = edgeSetup("aal1");
    const rejected = await handleAdmin(
      edgeRequest("/v1/admin/barcode-corrections?status=pending"),
      aal1.dependencies,
    );
    expect(rejected.status).toBe(403);
    expect(aal1.calls).toEqual([]);

    const invalid = edgeSetup();
    const invalidQuery = await handleAdmin(
      edgeRequest("/v1/admin/barcode-corrections?status=pending&hash=private"),
      invalid.dependencies,
    );
    expect(invalidQuery.status).toBe(400);
    expect(invalid.calls).toEqual([]);
  });

  it("lista la cola con AAL2 sin exponer snapshots completos", async () => {
    const state = edgeSetup();
    const response = await handleAdmin(
      edgeRequest("/v1/admin/barcode-corrections?status=pending"),
      state.dependencies,
    );
    expect(response.status).toBe(200);
    const body = AdminBarcodeCorrectionListSchema.parse(await response.json());
    expect(body.items).toHaveLength(1);
    expect(JSON.stringify(body)).not.toContain("nutrients");
  });

  it.each([
    {
      action: "barcode_correction_correct",
      body: {
        expectedVersion: 1,
        schemaVersion: 1,
        snapshot: COMMERCIAL_PRODUCT_FIXTURE,
      },
      path: `/v1/admin/barcode-corrections/${correctionId}/correct`,
      rpc: "internal_admin_correct_barcode_correction",
    },
    {
      action: "barcode_correction_approve",
      body: {
        canonicalFoodKey: "food:pollo.pechuga",
        evidence: ["revisión_etiqueta_v1"],
        expectedVersion: 1,
        matchState: "exact",
        schemaVersion: 1,
      },
      path: `/v1/admin/barcode-corrections/${correctionId}/approve`,
      rpc: "internal_admin_approve_barcode_correction",
    },
    {
      action: "barcode_correction_reject",
      body: { expectedVersion: 1, reason: "invalid_data", schemaVersion: 1 },
      path: `/v1/admin/barcode-corrections/${correctionId}/reject`,
      rpc: "internal_admin_reject_barcode_correction",
    },
    {
      action: "matching_rule_activate",
      body: { expectedVersion: 1, schemaVersion: 1 },
      path: `/v1/admin/matching-rules/${matchingRuleId}/activate`,
      rpc: "internal_admin_activate_product_matching_rule",
    },
  ])("registra intent antes de $action y cierra outcome", async (example) => {
    const state = edgeSetup();
    const response = await handleAdmin(
      edgeRequest(example.path, example.body),
      state.dependencies,
    );
    expect(response.status).toBe(200);
    expect(state.calls.indexOf("ledger:intent")).toBeLessThan(
      state.calls.indexOf(`rpc:${example.rpc}`),
    );
    expect(state.calls).toContain("ledger:success");
    expect(state.intents[0]?.action).toBe(example.action);
  });
});
