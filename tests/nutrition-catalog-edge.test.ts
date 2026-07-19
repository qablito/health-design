import { describe, expect, it, vi } from "vitest";

import {
  handleNutritionCatalog,
  type NutritionCatalogDependencies,
} from "../supabase/functions/catalogs/nutrition.ts";

const USER_ID = "00000000-0000-4000-8000-000000009201";
const SESSION_ID = "21000000-0000-4000-8000-000000009201";
const REVISION_ID = "39000000-0000-4000-8000-000000009201";
const REVIEW_ID = "49000000-0000-4000-8000-000000009201";
const REQUEST_ID = "59000000-0000-4000-8000-000000009201";

function request(
  path: string,
  init: RequestInit = {},
  idempotencyKey = REQUEST_ID,
): Request {
  return new Request(`http://localhost/functions/v1/catalogs${path}`, {
    ...init,
    headers: {
      authorization: "Bearer token",
      "content-type": "application/json",
      "idempotency-key": idempotencyKey,
      origin: "http://127.0.0.1:5173",
      ...init.headers,
    },
  });
}

function dependencies(
  overrides: Partial<NutritionCatalogDependencies> = {},
): NutritionCatalogDependencies {
  return {
    authenticate: vi.fn().mockResolvedValue({
      aal: "aal2",
      sessionId: SESSION_ID,
      userId: USER_ID,
    }),
    environment: "local",
    hashCanonical: vi.fn().mockResolvedValue("ab".repeat(32)),
    rpc: vi.fn().mockResolvedValue({ data: {}, error: null }),
    ...overrides,
  };
}

describe("API Edge del catálogo nutricional", () => {
  it("rechaza AAL1 antes de ejecutar cualquier RPC", async () => {
    const deps = dependencies({
      authenticate: vi.fn().mockResolvedValue({
        aal: "aal1",
        sessionId: SESSION_ID,
        userId: USER_ID,
      }),
    });
    const response = await handleNutritionCatalog(
      request("/v1/admin/nutrition/reviews/open", { method: "GET" }),
      deps,
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "AAL2_REQUIRED" },
    });
    expect(deps.rpc).not.toHaveBeenCalled();
  });

  it("importa un lote normalizado solo a cuarentena", async () => {
    const deps = dependencies({
      rpc: vi.fn().mockResolvedValue({
        data: { publication_count: 0, revision_count: 1, status: "quarantined" },
        error: null,
      }),
    });
    const batch = {
      manifest: { id: `manifest:${"a".repeat(64)}` },
      publicationCount: 0,
      revisions: [{ id: `revision:${"b".repeat(64)}` }],
      status: "quarantined",
      violations: [],
    };
    const response = await handleNutritionCatalog(
      request("/v1/admin/nutrition/imports", {
        body: JSON.stringify(batch),
        method: "POST",
      }),
      deps,
    );

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      publication_count: 0,
      status: "quarantined",
    });
    expect(deps.rpc).toHaveBeenCalledWith("internal_nutrition_stage_batch", {
      p_auth_session_id: SESSION_ID,
      p_auth_subject: USER_ID,
      p_batch: batch,
      p_request_id: REQUEST_ID,
    });
  });

  it("lista revisiones abiertas sin exponer tablas directamente", async () => {
    const reviews = [{ review_id: REVIEW_ID, status: "open" }];
    const deps = dependencies({
      rpc: vi.fn().mockResolvedValue({ data: reviews, error: null }),
    });
    const response = await handleNutritionCatalog(
      request("/v1/admin/nutrition/reviews/open", { method: "GET" }),
      deps,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ reviews });
    expect(deps.rpc).toHaveBeenCalledWith("internal_nutrition_list_reviews", {
      p_auth_session_id: SESSION_ID,
      p_auth_subject: USER_ID,
      p_status: "open",
    });
  });

  it("abre una revisión material mediante una mutación AAL2 idempotente", async () => {
    const deps = dependencies({
      rpc: vi.fn().mockResolvedValue({
        data: { review_id: REVIEW_ID, status: "open" },
        error: null,
      }),
    });
    const comparison = {
      anchor: "13",
      basis: "per_100_g",
      candidate: "20",
      unit: "g",
    };
    const response = await handleNutritionCatalog(
      request("/v1/admin/nutrition/reviews", {
        body: JSON.stringify({
          anchorRevisionId: REVISION_ID,
          candidateRevisionId: "39000000-0000-4000-8000-000000009202",
          comparison,
          nutrientKey: "protein",
          reason: "La diferencia supera el umbral contractual",
          reviewKind: "manual_review",
        }),
        method: "POST",
      }),
      deps,
    );

    expect(response.status).toBe(201);
    expect(deps.rpc).toHaveBeenCalledWith("internal_nutrition_open_review", {
      p_anchor_revision_id: REVISION_ID,
      p_auth_session_id: SESSION_ID,
      p_auth_subject: USER_ID,
      p_candidate_revision_id: "39000000-0000-4000-8000-000000009202",
      p_comparison: comparison,
      p_nutrient_key: "protein",
      p_reason: "La diferencia supera el umbral contractual",
      p_request_id: REQUEST_ID,
      p_review_kind: "manual_review",
    });
  });

  it("resuelve una revisión solo mediante una decisión explícita", async () => {
    const deps = dependencies({
      rpc: vi.fn().mockResolvedValue({
        data: { review_id: REVIEW_ID, status: "resolved_approved" },
        error: null,
      }),
    });
    const response = await handleNutritionCatalog(
      request(`/v1/admin/nutrition/reviews/${REVIEW_ID}/resolve`, {
        body: JSON.stringify({
          decision: "Aceptar la revisión",
          justification: "Procedencia y método compatibles tras revisión manual",
          resolution: "approved",
        }),
        method: "POST",
      }),
      deps,
    );

    expect(response.status).toBe(200);
    expect(deps.rpc).toHaveBeenCalledWith("internal_nutrition_resolve_review", {
      p_auth_session_id: SESSION_ID,
      p_auth_subject: USER_ID,
      p_decision: "Aceptar la revisión",
      p_justification: "Procedencia y método compatibles tras revisión manual",
      p_request_id: REQUEST_ID,
      p_resolution: "approved",
      p_review_id: REVIEW_ID,
    });
  });

  it("calcula el hash canónico del contexto antes de activar manualmente", async () => {
    const context = {
      basis: "per_100_g",
      ediblePart: "whole_edible_product",
      foodState: "raw",
      method: "source_declared",
    };
    const deps = dependencies({
      rpc: vi.fn().mockResolvedValue({
        data: { revision_id: REVISION_ID, status: "active" },
        error: null,
      }),
    });
    const response = await handleNutritionCatalog(
      request(`/v1/admin/nutrition/revisions/${REVISION_ID}/activate`, {
        body: JSON.stringify({
          precedenceReason: "Fuente prioritaria compatible y revisión cerrada",
          resolutionContext: context,
        }),
        method: "POST",
      }),
      deps,
    );

    expect(response.status).toBe(200);
    expect(deps.hashCanonical).toHaveBeenCalledWith(context);
    expect(deps.rpc).toHaveBeenCalledWith(
      "internal_nutrition_activate_revision",
      expect.objectContaining({
        p_auth_session_id: SESSION_ID,
        p_auth_subject: USER_ID,
        p_precedence_reason: "Fuente prioritaria compatible y revisión cerrada",
        p_request_id: REQUEST_ID,
        p_resolution_context: context,
        p_resolution_context_hash: `\\x${"ab".repeat(32)}`,
        p_revision_id: REVISION_ID,
      }),
    );
  });

  it("mapea una revisión abierta a conflicto sin filtrar el error interno", async () => {
    const deps = dependencies({
      rpc: vi.fn().mockResolvedValue({
        data: null,
        error: { code: "55000", message: "nutrition_review_open" },
      }),
    });
    const response = await handleNutritionCatalog(
      request(`/v1/admin/nutrition/revisions/${REVISION_ID}/activate`, {
        body: JSON.stringify({
          precedenceReason: "Intento bloqueado",
          resolutionContext: {
            basis: "per_100_g",
            ediblePart: "whole_edible_product",
            foodState: "raw",
            method: "source_declared",
          },
        }),
        method: "POST",
      }),
      deps,
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "REVIEW_OPEN", retryable: false },
    });
  });
});
