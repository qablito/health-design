import { describe, expect, it, vi } from "vitest";

import {
  handleNutritionCatalog,
  type NutritionCatalogDependencies,
} from "../supabase/functions/catalogs/nutrition.ts";

const USER_ID = "00000000-0000-4000-8000-000000009401";
const SESSION_ID = "21000000-0000-4000-8000-000000009401";
const REVISION_ID = "c1200000-0000-4000-8000-000000009401";
const REQUEST_ID = "91000000-0000-4000-8000-000000009401";

function request(path: string, body: unknown): Request {
  return new Request(`http://localhost/functions/v1/catalogs${path}`, {
    body: JSON.stringify(body),
    headers: {
      authorization: "Bearer token",
      "content-type": "application/json",
      "idempotency-key": REQUEST_ID,
      origin: "http://127.0.0.1:5173",
    },
    method: "POST",
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
    rpc: vi.fn().mockResolvedValue({
      data: { revision_id: REVISION_ID, status: "staged" },
      error: null,
    }),
    ...overrides,
  };
}

describe("administración Edge del descriptor clínico", () => {
  it("prepara una revisión descriptor sin aceptar reglas ejecutables", async () => {
    const deps = dependencies();
    const payload = {
      clinicalCatalogVersion: "clinical-selective-v3",
      ruleSetRevisionId: "9cf98aae-0f9f-452f-9577-72283eeff4d6",
      sourceManifestId: "d46591cd-ae2a-4330-a037-c39436cae924",
    };
    const response = await handleNutritionCatalog(
      request("/v1/admin/clinical/revisions", payload),
      deps,
    );

    expect(response.status).toBe(201);
    expect(deps.rpc).toHaveBeenCalledWith("internal_clinical_rule_catalog_stage", {
      p_auth_session_id: SESSION_ID,
      p_auth_subject: USER_ID,
      p_clinical_catalog_version: payload.clinicalCatalogVersion,
      p_request_id: REQUEST_ID,
      p_rule_set_revision_id: payload.ruleSetRevisionId,
      p_source_manifest_id: payload.sourceManifestId,
    });

    const rejected = await handleNutritionCatalog(
      request("/v1/admin/clinical/revisions", {
        ...payload,
        executableRules: [],
      }),
      deps,
    );
    expect(rejected.status).toBe(422);
  });

  it("valida y activa mediante acciones AAL2 separadas", async () => {
    const deps = dependencies({
      rpc: vi.fn().mockResolvedValue({
        data: { revision_id: REVISION_ID, status: "validated" },
        error: null,
      }),
    });
    const validated = await handleNutritionCatalog(
      request(`/v1/admin/clinical/revisions/${REVISION_ID}/validate`, {
        justification: "Fuentes y reglas cotejadas manualmente",
      }),
      deps,
    );
    const activated = await handleNutritionCatalog(
      request(`/v1/admin/clinical/revisions/${REVISION_ID}/activate`, {}),
      deps,
    );

    expect(validated.status).toBe(200);
    expect(activated.status).toBe(200);
    expect(deps.rpc).toHaveBeenNthCalledWith(
      1,
      "internal_clinical_rule_catalog_validate",
      expect.objectContaining({
        p_justification: "Fuentes y reglas cotejadas manualmente",
        p_revision_id: REVISION_ID,
      }),
    );
    expect(deps.rpc).toHaveBeenNthCalledWith(
      2,
      "internal_clinical_rule_catalog_activate",
      expect.objectContaining({ p_revision_id: REVISION_ID }),
    );
  });

  it("rechaza AAL1 antes de cualquier mutación clínica", async () => {
    const deps = dependencies({
      authenticate: vi.fn().mockResolvedValue({
        aal: "aal1",
        sessionId: SESSION_ID,
        userId: USER_ID,
      }),
    });

    const response = await handleNutritionCatalog(
      request("/v1/admin/clinical/revisions", {
        clinicalCatalogVersion: "clinical-selective-v3",
        ruleSetRevisionId: "9cf98aae-0f9f-452f-9577-72283eeff4d6",
        sourceManifestId: "d46591cd-ae2a-4330-a037-c39436cae924",
      }),
      deps,
    );

    expect(response.status).toBe(403);
    expect(deps.rpc).not.toHaveBeenCalled();
  });

  it("traduce una colisión de descriptor a conflicto de dominio", async () => {
    const deps = dependencies({
      rpc: vi.fn().mockResolvedValue({
        data: null,
        error: { code: "23505", message: "duplicate key" },
      }),
    });

    const response = await handleNutritionCatalog(
      request("/v1/admin/clinical/revisions", {
        clinicalCatalogVersion: "clinical-selective-v3",
        ruleSetRevisionId: "9cf98aae-0f9f-452f-9577-72283eeff4d6",
        sourceManifestId: "d46591cd-ae2a-4330-a037-c39436cae924",
      }),
      deps,
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "DOMAIN_CONSTRAINT", retryable: false },
    });
  });
});
