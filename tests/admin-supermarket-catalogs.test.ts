import { describe, expect, it } from "vitest";

import {
  AdminCatalogPublicationMutationAckSchema,
  AdminCatalogRevisionListSchema,
  type LedgerReceipt,
} from "@health-design/contracts";
import {
  handleAdmin,
  type AdminDependencies,
  type AdminIntentInput,
} from "../supabase/functions/admin/index";
import {
  adminSupermarketMatchingRuleListFromRows,
  supermarketMatchCandidateBatchFromRows,
} from "../supabase/functions/admin/supermarket-catalogs";

const actorId = "83000000-0000-4000-8000-000000000001";
const profileId = "83000000-0000-4000-8000-000000000002";
const sessionId = "83000000-0000-4000-8000-000000000003";
const catalogRevisionId = "83000000-0000-4000-8000-000000000004";
const publicationId = "83000000-0000-4000-8000-000000000005";
const requestId = "83000000-0000-4000-8000-000000000006";
const matchingRuleId = "83000000-0000-4000-8000-000000000007";
const now = new Date("2026-07-21T20:00:00.000Z");

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

function request(path: string, body?: unknown): Request {
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

function setup(input?: {
  aal?: "aal1" | "aal2";
  auditError?: { code: string; message: string };
  mfaVerifiedAt?: number | null;
  publishError?: { code: string; message: string };
}) {
  const calls: string[] = [];
  const intents: AdminIntentInput[] = [];
  const rpcArguments: Array<{ args: Record<string, unknown>; name: string }> = [];
  const dependencies: AdminDependencies = {
    appendFailureOutcome: () => Promise.resolve({ ...receipt, sequence: 2 }),
    appendIntent: (intent) => {
      calls.push("ledger:intent");
      intents.push(intent);
      return Promise.resolve(receipt);
    },
    appendSuccessOutcome: () => {
      calls.push("ledger:success");
      return Promise.resolve({ ...receipt, recordHash: "c".repeat(64), sequence: 2 });
    },
    authenticate: () =>
      Promise.resolve({
        aal: input?.aal ?? "aal2",
        mfaVerifiedAt:
          input?.mfaVerifiedAt === undefined
            ? Math.floor(now.getTime() / 1_000) - 10
            : input.mfaVerifiedAt,
        sessionId,
        userId: actorId,
      }),
    environment: "local",
    now: () => now,
    rpc: (name, args) => {
      calls.push(`rpc:${name}`);
      rpcArguments.push({ args, name });
      if (name === "internal_admin_list_supermarket_catalog_revisions") {
        return Promise.resolve({
          data: [
            {
              active_publication_id: null,
              basket_seed_hash: `\\x${"2".repeat(64)}`,
              basket_seed_revision_id: profileId,
              catalog_hash: `\\x${"1".repeat(64)}`,
              catalog_revision_id: catalogRevisionId,
              chain: "mercadona",
              coverage: {
                dynamicRequired: 20,
                dynamicUsable: 18,
                fixedRequired: 60,
                fixedUsable: 54,
                groups: [{ groupKey: "protein", required: 20, usable: 15 }],
                publishable: true,
                totalRequired: 80,
                totalUsable: 72,
              },
              coverage_hash: `\\x${"3".repeat(64)}`,
              error_count: 2,
              license_status: "approved",
              publication_version: null,
              quality_status: "current",
              record_count: 4314,
              revision_number: 1,
              source_terms_status: "approved",
              state: "publishable",
              usable_count: 4200,
            },
          ],
          error: null,
        });
      }
      if (name === "internal_admin_supermarket_audit_context") {
        if (input?.auditError) {
          return Promise.resolve({ data: null, error: input.auditError });
        }
        return Promise.resolve({
          data: [
            {
              audit_target_id:
                args.p_action === "matching_rule_review" ||
                args.p_action === "matching_rule_activate"
                  ? matchingRuleId
                  : catalogRevisionId,
              audit_target_type:
                args.p_action === "matching_rule_review" ||
                args.p_action === "matching_rule_activate"
                  ? "product_matching_rule"
                  : "catalog_revision",
              effective_profile_id: profileId,
              mutation_scope:
                args.p_action === "matching_rule_activate" ? "supermarket" : undefined,
              original_actor_id: actorId,
            },
          ],
          error: null,
        });
      }
      if (name === "internal_admin_product_audit_context") {
        return Promise.resolve({
          data: null,
          error: { code: "22023", message: "matching_rule_not_found" },
        });
      }
      if (name === "internal_admin_supermarket_match_inputs") {
        return Promise.resolve({
          data: {
            basketSeedRevisionId: profileId,
            skus: [
              {
                allergenData: "known",
                categoryPath: ["protein"],
                crossContactData: "known",
                excludedTerms: [],
                externalSku: "sku-001",
                foodState: "raw",
                formatText: "500 g",
                gtinFoodKey: null,
                ingredients: ["pollo"],
                name: "Pollo fresco",
                purchaseForm: "fresh",
                skuContentHash: "4".repeat(64),
                skuId: matchingRuleId,
              },
            ],
            targets: [
              {
                canonicalFoodKey: "food:pollo",
                categoryTerms: ["protein"],
                ediblePart: "whole",
                foodState: "raw",
                name: "Pollo",
                purchaseForm: "fresh",
              },
            ],
          },
          error: null,
        });
      }
      if (name === "internal_admin_generate_supermarket_match_candidates") {
        return Promise.resolve({
          data: {
            candidatesCreated: 1,
            catalogRevisionId,
            hasMore: false,
            schemaVersion: 1,
            skusProcessed: 1,
            version: 1,
          },
          error: null,
        });
      }
      if (name === "internal_admin_list_supermarket_matching_rules") {
        return Promise.resolve({
          data: [
            {
              canonical_food_key: "food:pollo",
              canonical_food_name: "Pollo",
              chain: "mercadona",
              critical_issue_open: false,
              external_sku: "sku-001",
              food_state: "raw",
              gtin_consistency: "not_available",
              match_state: "review",
              matching_rule_id: matchingRuleId,
              purchase_form: "fresh",
              reasons: ["allergen_data_unknown"],
              reviewed: false,
              sku_name: "Pollo fresco",
              status: "draft",
              version: 1,
            },
          ],
          error: null,
        });
      }
      if (name === "internal_admin_review_supermarket_matching_rule") {
        return Promise.resolve({
          data: {
            matchingRuleId,
            matchState: "exact",
            schemaVersion: 1,
            status: "draft",
            version: 2,
          },
          error: null,
        });
      }
      if (name === "internal_admin_activate_supermarket_matching_rule") {
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
      if (name === "internal_admin_publish_supermarket_catalog") {
        if (input?.publishError) {
          return Promise.resolve({ data: null, error: input.publishError });
        }
        return Promise.resolve({
          data: {
            catalogPublicationId: publicationId,
            chain: "mercadona",
            schemaVersion: 1,
            status: "active",
            version: 1,
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
  return { calls, dependencies, intents, rpcArguments };
}

describe("administración de catálogos de supermercado", () => {
  it("rechaza usuario AAL1 antes de cualquier RPC", async () => {
    const state = setup({ aal: "aal1" });
    const response = await handleAdmin(
      request("/v1/admin/catalog-revisions?chain=mercadona&state=review"),
      state.dependencies,
    );
    expect(response.status).toBe(403);
    expect(state.calls).toEqual([]);
  });

  it("lista 80 objetivos, cobertura y manifest sin filtrar metadatos internos", async () => {
    const state = setup();
    const response = await handleAdmin(
      request("/v1/admin/catalog-revisions?chain=mercadona&state=publishable"),
      state.dependencies,
    );
    expect(response.status).toBe(200);
    const body = AdminCatalogRevisionListSchema.parse(await response.json());
    expect(body.items[0]?.coverage?.totalRequired).toBe(80);
    expect(body.items[0]?.manifest.errorCount).toBe(2);
    expect(JSON.stringify(body)).not.toMatch(
      /objectRef|sourceLocation|price|externalSku/i,
    );
  });

  it("exige TOTP reciente para publicar antes de consultar el catálogo", async () => {
    const state = setup({ mfaVerifiedAt: Math.floor(now.getTime() / 1_000) - 301 });
    const response = await handleAdmin(
      request(`/v1/admin/catalog-revisions/${catalogRevisionId}/publish`, {
        expectedCatalogHash: "1".repeat(64),
        expectedCoverageHash: "3".repeat(64),
        expectedSeedHash: "2".repeat(64),
        expectedVersion: 1,
        schemaVersion: 1,
        sourceUseDecision: "development_approved",
      }),
      state.dependencies,
    );
    expect(response.status).toBe(403);
    expect(state.calls).toEqual([]);
  });

  it("exige TOTP reciente para revisar, activar y ocultar antes de mutar", async () => {
    const requests = [
      request(`/v1/admin/matching-rules/${matchingRuleId}/review`, {
        expectedVersion: 1,
        matchState: "exact",
        schemaVersion: 1,
      }),
      request(`/v1/admin/matching-rules/${matchingRuleId}/activate`, {
        expectedVersion: 1,
        schemaVersion: 1,
      }),
      request(`/v1/admin/catalog-publications/${publicationId}/hide`, {
        expectedVersion: 1,
        schemaVersion: 1,
      }),
    ];
    for (const pendingRequest of requests) {
      const state = setup({
        mfaVerifiedAt: Math.floor(now.getTime() / 1_000) - 301,
      });
      const response = await handleAdmin(pendingRequest, state.dependencies);
      expect(response.status).toBe(403);
      expect(state.calls).toEqual([]);
    }
  });

  it("rechaza a quien no es superadministrador antes de mutar", async () => {
    const state = setup({
      auditError: { code: "42501", message: "superadmin_required" },
    });
    const response = await handleAdmin(
      request(`/v1/admin/catalog-revisions/${catalogRevisionId}/publish`, {
        expectedCatalogHash: "1".repeat(64),
        expectedCoverageHash: "3".repeat(64),
        expectedSeedHash: "2".repeat(64),
        expectedVersion: 1,
        schemaVersion: 1,
        sourceUseDecision: "development_approved",
      }),
      state.dependencies,
    );
    expect(response.status).toBe(403);
    expect(state.calls).not.toContain("rpc:internal_admin_publish_supermarket_catalog");
    expect(state.calls).not.toContain("ledger:intent");
  });

  it("distingue publicación de matching y registra intent antes de mutar", async () => {
    const state = setup();
    const response = await handleAdmin(
      request(`/v1/admin/catalog-revisions/${catalogRevisionId}/publish`, {
        expectedCatalogHash: "1".repeat(64),
        expectedCoverageHash: "3".repeat(64),
        expectedSeedHash: "2".repeat(64),
        expectedVersion: 1,
        schemaVersion: 1,
        sourceUseDecision: "development_approved",
      }),
      state.dependencies,
    );
    expect(response.status).toBe(200);
    AdminCatalogPublicationMutationAckSchema.parse(await response.json());
    expect(state.calls.indexOf("ledger:intent")).toBeLessThan(
      state.calls.indexOf("rpc:internal_admin_publish_supermarket_catalog"),
    );
    expect(state.calls).toContain("ledger:success");
    expect(state.intents[0]).toMatchObject({
      action: "catalog_revision_publish",
      targetType: "catalog_revision",
    });
    expect(JSON.stringify(state.intents[0])).not.toMatch(/price|sku|payload|name/i);
  });

  it("genera con el motor puro, audita y permite listar y revisar candidatos", async () => {
    const state = setup();
    const generated = await handleAdmin(
      request(`/v1/admin/catalog-revisions/${catalogRevisionId}/match-candidates`, {
        expectedVersion: 1,
        schemaVersion: 1,
      }),
      state.dependencies,
    );
    expect(generated.status).toBe(201);
    await expect(generated.json()).resolves.toMatchObject({
      candidatesCreated: 1,
      skusProcessed: 1,
    });
    expect(state.calls.indexOf("ledger:intent")).toBeLessThan(
      state.calls.indexOf("rpc:internal_admin_generate_supermarket_match_candidates"),
    );
    expect(state.intents[0]).toMatchObject({
      action: "catalog_match_candidates_generate",
      targetType: "catalog_revision",
    });
    expect(
      state.rpcArguments.find(
        ({ name }) => name === "internal_admin_generate_supermarket_match_candidates",
      )?.args,
    ).toMatchObject({
      p_basket_seed_revision_id: profileId,
      p_candidates: [
        expect.objectContaining({
          canonicalFoodKey: "food:pollo",
          foodState: "raw",
          purchaseForm: "fresh",
          skuContentHash: "4".repeat(64),
        }),
      ],
      p_processed_skus: [{ skuContentHash: "4".repeat(64), skuId: matchingRuleId }],
    });

    const listed = await handleAdmin(
      request(`/v1/admin/matching-rules?catalogRevisionId=${catalogRevisionId}`),
      state.dependencies,
    );
    expect(listed.status).toBe(200);
    await expect(listed.json()).resolves.toMatchObject({
      items: [{ matchingRuleId, reviewed: false }],
      nextCursor: null,
    });

    const reviewed = await handleAdmin(
      request(`/v1/admin/matching-rules/${matchingRuleId}/review`, {
        expectedVersion: 1,
        matchState: "exact",
        schemaVersion: 1,
      }),
      state.dependencies,
    );
    expect(reviewed.status).toBe(200);
    await expect(reviewed.json()).resolves.toMatchObject({
      matchState: "exact",
      matchingRuleId,
      version: 2,
    });
    expect(state.intents.at(-1)).toMatchObject({
      action: "matching_rule_review",
      targetType: "product_matching_rule",
    });
  });

  it("activa matching de supermercado por fallback sin confundirlo con T16", async () => {
    const state = setup();
    const response = await handleAdmin(
      request(`/v1/admin/matching-rules/${matchingRuleId}/activate`, {
        expectedVersion: 2,
        schemaVersion: 1,
      }),
      state.dependencies,
    );
    expect(response.status).toBe(200);
    expect(state.calls).toContain("rpc:internal_admin_product_audit_context");
    expect(state.calls).toContain("rpc:internal_admin_supermarket_audit_context");
    expect(state.calls).toContain(
      "rpc:internal_admin_activate_supermarket_matching_rule",
    );
    expect(state.intents[0]).toMatchObject({
      action: "matching_rule_activate",
      targetType: "product_matching_rule",
    });
  });

  it("distingue conflicto idempotente de otras restricciones únicas", async () => {
    const reused = setup({
      publishError: { code: "23505", message: "idempotency_conflict" },
    });
    const uniqueConstraint = setup({
      publishError: { code: "23505", message: "publication_conflict" },
    });
    const body = {
      expectedCatalogHash: "1".repeat(64),
      expectedCoverageHash: "3".repeat(64),
      expectedSeedHash: "2".repeat(64),
      expectedVersion: 1,
      schemaVersion: 1,
      sourceUseDecision: "development_approved",
    };

    const reusedResponse = await handleAdmin(
      request(`/v1/admin/catalog-revisions/${catalogRevisionId}/publish`, body),
      reused.dependencies,
    );
    const uniqueResponse = await handleAdmin(
      request(`/v1/admin/catalog-revisions/${catalogRevisionId}/publish`, body),
      uniqueConstraint.dependencies,
    );

    expect(reusedResponse.status).toBe(409);
    await expect(reusedResponse.json()).resolves.toMatchObject({
      error: { code: "IDEMPOTENCY_KEY_REUSED" },
    });
    expect(uniqueResponse.status).toBe(409);
    await expect(uniqueResponse.json()).resolves.toMatchObject({
      error: { code: "DOMAIN_CONSTRAINT" },
    });
  });

  it("mantiene alérgenos desconocidos en revisión al consumir JSONB directo", () => {
    const batch = supermarketMatchCandidateBatchFromRows({
      basketSeedRevisionId: profileId,
      skus: [
        {
          allergenData: "unknown",
          categoryPath: ["protein"],
          crossContactData: "known",
          excludedTerms: [],
          externalSku: "sku-unknown-allergens",
          foodState: "raw",
          formatText: "500 g",
          gtinFoodKey: null,
          ingredients: [],
          name: "Pollo fresco",
          purchaseForm: "fresh",
          skuContentHash: "4".repeat(64),
          skuId: matchingRuleId,
        },
      ],
      targets: [
        {
          canonicalFoodKey: "food:pollo",
          categoryTerms: ["protein"],
          ediblePart: "whole",
          foodState: "raw",
          name: "Pollo",
          purchaseForm: "fresh",
        },
      ],
    });

    expect(batch.candidates).toEqual([
      expect.objectContaining({
        canonicalFoodKey: "food:pollo",
        matchState: "review",
        reason: "allergen_data_unknown",
      }),
    ]);
    expect(batch.processedSkus).toEqual([
      { skuContentHash: "4".repeat(64), skuId: matchingRuleId },
    ]);
    expect(batch.basketSeedRevisionId).toBe(profileId);
  });

  it("pagina candidatos con 50 filas y cursor en la última incluida", () => {
    const rows = Array.from({ length: 51 }, (_, index) => ({
      canonical_food_key: `food:test-${index + 1}`,
      canonical_food_name: `Alimento ${index + 1}`,
      chain: "mercadona",
      critical_issue_open: false,
      external_sku: `sku-${index + 1}`,
      food_state: "raw",
      gtin_consistency: "not_available",
      match_state: "review",
      matching_rule_id: `83000000-0000-4000-8000-${String(index + 100).padStart(12, "0")}`,
      purchase_form: "fresh",
      reasons: ["weak_identity_evidence"],
      reviewed: false,
      sku_name: `Producto ${index + 1}`,
      status: "draft",
      version: 1,
    }));

    const result = adminSupermarketMatchingRuleListFromRows(rows);
    expect(result.items).toHaveLength(50);
    expect(result.nextCursor).toBe(rows[49]?.matching_rule_id);
  });
});
