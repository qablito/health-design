import { describe, expect, it } from "vitest";

import {
  EXPORT_MAX_ARTIFACT_BYTES,
  EXPORT_RENDERER_VERSION,
} from "@health-design/contracts";
import {
  exportNutrition,
  exportShoppingSnapshots,
} from "@health-design/test-fixtures/exports";
import {
  handlePlanExports,
  type ExportEdgeDependencies,
} from "../supabase/functions/exports/index";

const userId = "00000000-0000-4000-8000-000000015201";
const sessionId = "21000000-0000-4000-8000-000000015201";
const planVersionId = "22000000-0000-4000-8000-000000015201";
const artifactId = "23000000-0000-4000-8000-000000015201";
const jobId = "24000000-0000-4000-8000-000000015201";
const createdAt = "2026-07-20T16:45:00.000Z";
const storagePath = `51000000-0000-4000-8000-000000015201/${artifactId}.pdf`;
const pdfBytes = new TextEncoder().encode("%PDF-1.7\nprivate");

const config = {
  choices: [],
  detail: "compact",
  format: "pdf",
  includeShopping: true,
  includeWeeklyPreparation: false,
  presentation: "ingredients",
  range: { kind: "week" },
  schemaVersion: 1,
} as const;

const source = {
  nutrition: exportNutrition,
  outputHash: "ab".repeat(32),
  planId: "25000000-0000-4000-8000-000000015201",
  planVersionId,
  profileId: "51000000-0000-4000-8000-000000015201",
};
const shoppingSnapshot = {
  ...exportShoppingSnapshots.complete,
  snapshot: {
    ...exportShoppingSnapshots.complete.snapshot,
    planVersionId,
    profileId: source.profileId,
  },
};

const reservation = {
  actorId: "31000000-0000-4000-8000-000000015201",
  artifactId,
  config,
  createdAt,
  detail: "compact",
  format: "pdf",
  mimeType: "application/pdf",
  outcome: "reserved",
  planId: source.planId,
  planVersionId,
  presentation: "ingredients",
  profileId: "51000000-0000-4000-8000-000000015201",
  rendererVersion: EXPORT_RENDERER_VERSION,
  schemaVersion: 1,
  sizeBytes: null,
  status: "pending",
  storagePath,
};

const ready = {
  ...reservation,
  contentDigest: "cd".repeat(32),
  outcome: "ready",
  sizeBytes: pdfBytes.byteLength,
  status: "ready",
};

type SetupOptions = Readonly<{
  authorizeService?: boolean;
  downloadError?: boolean;
  outcome?: "pending" | "ready" | "reserved";
  removeError?: boolean;
  renderError?: boolean;
  renderedBytes?: Uint8Array;
  rpcError?: Readonly<{ code?: string; message?: string }>;
  uploadError?: boolean;
  shoppingSnapshot?: unknown;
}>;

function setup(options: SetupOptions = {}) {
  const calls: Array<{ args: Record<string, unknown>; name: string }> = [];
  const events: string[] = [];
  const ips: string[] = [];
  const renderedModels: unknown[] = [];
  const dependencies: ExportEdgeDependencies = {
    authenticate: () => Promise.resolve({ sessionId, userId }),
    authorizeService: (token) =>
      token === "service-role-token" && options.authorizeService !== false,
    digestIp: (ip) => {
      ips.push(ip);
      return Promise.resolve("ef".repeat(32));
    },
    download: () => {
      events.push("download");
      if (options.downloadError) return Promise.reject(new Error("storage_failed"));
      return Promise.resolve(pdfBytes);
    },
    environment: "local",
    randomUUID: () => "26000000-0000-4000-8000-000000015201",
    remove: (paths) => {
      events.push(`remove:${paths.join(",")}`);
      if (options.removeError) return Promise.reject(new Error("storage_failed"));
      return Promise.resolve();
    },
    renderPdf: (model) => {
      events.push("render-pdf");
      renderedModels.push(model);
      if (options.renderError) return Promise.reject(new Error("render_failed"));
      return Promise.resolve(options.renderedBytes ?? pdfBytes);
    },
    renderXlsx: (model) => {
      events.push("render-xlsx");
      renderedModels.push(model);
      return Promise.resolve(options.renderedBytes ?? new Uint8Array([80, 75]));
    },
    rpc: (name, args) => {
      calls.push({ args, name });
      events.push(`rpc:${name}`);
      if (options.rpcError) {
        return Promise.resolve({ data: null, error: options.rpcError });
      }
      const data: Record<string, unknown> = {
        internal_complete_plan_export: [
          { ...ready, outcome: undefined, sizeBytes: args.p_size_bytes },
        ],
        internal_confirm_profile_export_purge: [2],
        internal_fail_plan_export: [null],
        internal_get_plan_export: [{ ...ready, outcome: undefined }],
        internal_get_plan_export_source: [source],
        internal_get_shopping_snapshot: [options.shoppingSnapshot ?? shoppingSnapshot],
        internal_list_profile_export_purge_paths: [
          [
            { artifactId, storagePath },
            {
              artifactId: "23000000-0000-4000-8000-000000015202",
              storagePath:
                "51000000-0000-4000-8000-000000015201/23000000-0000-4000-8000-000000015202.xlsx",
            },
          ],
        ],
        internal_reserve_plan_export: [
          {
            ...(options.outcome === "ready" ? ready : reservation),
            outcome: options.outcome ?? "reserved",
            status: options.outcome === "ready" ? "ready" : "pending",
          },
        ],
      };
      return Promise.resolve({ data: data[name], error: null });
    },
    upload: () => {
      events.push("upload");
      if (options.uploadError) return Promise.reject(new Error("storage_failed"));
      return Promise.resolve();
    },
  };
  return { calls, dependencies, events, ips, renderedModels };
}

function request(
  path: string,
  init: Readonly<{
    authorization?: string;
    body?: unknown;
    headers?: Record<string, string>;
    method?: "GET" | "POST";
  }> = {},
): Request {
  const body = init.body === undefined ? undefined : JSON.stringify(init.body);
  return new Request(`https://api.test/exports${path}`, {
    ...(body === undefined ? {} : { body }),
    headers: {
      authorization: init.authorization ?? "Bearer valid-user-jwt",
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      "cf-connecting-ip": "203.0.113.20",
      "idempotency-key": "export-idempotency-key-0001",
      origin: "http://127.0.0.1:5173",
      ...init.headers,
    },
    method: init.method ?? "POST",
  });
}

describe("Edge de exportaciones privadas", () => {
  it("rechaza rutas, consultas, bearer y cuerpos no válidos de forma uniforme", async () => {
    const current = setup();
    const malformed = await handlePlanExports(
      request(`/v1/plans/${planVersionId}/exports?leak=true`, { body: config }),
      current.dependencies,
    );
    const unauthenticated = await handlePlanExports(
      request(`/v1/plans/${planVersionId}/exports`, {
        authorization: "",
        body: config,
      }),
      current.dependencies,
    );
    const invalid = await handlePlanExports(
      request(`/v1/plans/${planVersionId}/exports`, {
        body: { ...config, unexpected: true },
      }),
      current.dependencies,
    );

    expect(malformed.status).toBe(404);
    expect(unauthenticated.status).toBe(401);
    expect(invalid.status).toBe(422);
    expect(current.calls).toEqual([]);
  });

  it("interrumpe el cuerpo antes de analizar más de 16 KiB", async () => {
    let pulls = 0;
    const body = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          pulls += 1;
          controller.enqueue(new Uint8Array(16 * 1024 + 1));
        },
      },
      { highWaterMark: 0 },
    );
    const current = setup();
    const response = await handlePlanExports(
      new Request(`https://api.test/exports/v1/plans/${planVersionId}/exports`, {
        body,
        duplex: "half",
        headers: {
          authorization: "Bearer valid-user-jwt",
          "content-type": "application/json",
          "idempotency-key": "export-idempotency-key-0001",
          origin: "http://127.0.0.1:5173",
        },
        method: "POST",
      } as RequestInit & { duplex: "half" }),
      current.dependencies,
    );

    expect(response.status).toBe(413);
    expect(pulls).toBe(1);
    expect(current.calls).toEqual([]);
  });

  it("genera desde la nutrición autorizada, sube y completa sin enviar IP en claro", async () => {
    const current = setup();
    const response = await handlePlanExports(
      request(`/v1/plans/${planVersionId}/exports`, { body: config }),
      current.dependencies,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      artifactId,
      createdAt,
      detail: "compact",
      format: "pdf",
      planVersionId,
      presentation: "ingredients",
      schemaVersion: 1,
      status: "ready",
    });
    expect(current.calls.map(({ name }) => name)).toEqual([
      "internal_get_plan_export_source",
      "internal_reserve_plan_export",
      "internal_complete_plan_export",
    ]);
    expect(current.calls[1]?.args.p_ip_digest).toMatch(/^\\x[0-9a-f]{64}$/);
    expect(JSON.stringify(current.calls[1]?.args)).not.toContain("203.0.113.20");
    expect(current.ips).toEqual(["203.0.113.20"]);
    expect(current.renderedModels[0]).toMatchObject({
      planOutputHash: source.outputHash,
      planVersionId,
      rendererVersion: EXPORT_RENDERER_VERSION,
    });
    expect(current.events).toContain("upload");
    expect(response.headers.get("cache-control")).toBe("no-store, private");
  });

  it("carga el snapshot autorizado antes de reservar y lo incorpora al modelo", async () => {
    const current = setup();
    const response = await handlePlanExports(
      request(`/v1/plans/${planVersionId}/exports`, {
        body: {
          ...config,
          shoppingSnapshotId: exportShoppingSnapshots.complete.snapshot.id,
        },
      }),
      current.dependencies,
    );

    expect(response.status).toBe(200);
    expect(current.calls.map(({ name }) => name)).toEqual([
      "internal_get_plan_export_source",
      "internal_get_shopping_snapshot",
      "internal_reserve_plan_export",
      "internal_complete_plan_export",
    ]);
    expect(current.calls[1]?.args).toMatchObject({
      p_snapshot_id: exportShoppingSnapshots.complete.snapshot.id,
    });
    expect(current.renderedModels[0]).toMatchObject({
      shopping: { kind: "snapshot" },
    });
  });

  it("rechaza otro plan antes de reserva, cuota o Storage", async () => {
    const current = setup({
      shoppingSnapshot: {
        ...exportShoppingSnapshots.complete,
        snapshot: {
          ...exportShoppingSnapshots.complete.snapshot,
          planVersionId: "22000000-0000-4000-8000-000000015299",
        },
      },
    });
    const response = await handlePlanExports(
      request(`/v1/plans/${planVersionId}/exports`, {
        body: {
          ...config,
          shoppingSnapshotId: exportShoppingSnapshots.complete.snapshot.id,
        },
      }),
      current.dependencies,
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "SHOPPING_SNAPSHOT_MISMATCH" },
    });
    expect(current.calls.map(({ name }) => name)).toEqual([
      "internal_get_plan_export_source",
      "internal_get_shopping_snapshot",
    ]);
    expect(current.events).not.toContain("upload");
  });

  it("rechaza otro perfil antes de reserva, cuota o Storage", async () => {
    const current = setup({
      shoppingSnapshot: {
        ...exportShoppingSnapshots.complete,
        snapshot: {
          ...exportShoppingSnapshots.complete.snapshot,
          planVersionId,
          profileId: "51000000-0000-4000-8000-000000015299",
        },
      },
    });
    const response = await handlePlanExports(
      request(`/v1/plans/${planVersionId}/exports`, {
        body: {
          ...config,
          shoppingSnapshotId: exportShoppingSnapshots.complete.snapshot.id,
        },
      }),
      current.dependencies,
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "SHOPPING_SNAPSHOT_MISMATCH" },
    });
    expect(current.calls.map(({ name }) => name)).toEqual([
      "internal_get_plan_export_source",
      "internal_get_shopping_snapshot",
    ]);
    expect(current.events).not.toContain("upload");
  });

  it("acepta archivados y excluye lifecycle del digest de reutilización", async () => {
    const active = setup();
    const archived = setup({
      shoppingSnapshot: {
        ...exportShoppingSnapshots.archived,
        snapshot: {
          ...exportShoppingSnapshots.archived.snapshot,
          planVersionId,
          profileId: source.profileId,
        },
      },
    });
    const body = {
      ...config,
      shoppingSnapshotId: exportShoppingSnapshots.complete.snapshot.id,
    };
    await handlePlanExports(
      request(`/v1/plans/${planVersionId}/exports`, { body }),
      active.dependencies,
    );
    await handlePlanExports(
      request(`/v1/plans/${planVersionId}/exports`, { body }),
      archived.dependencies,
    );

    const activeReservation = active.calls.find(
      ({ name }) => name === "internal_reserve_plan_export",
    )!;
    const archivedReservation = archived.calls.find(
      ({ name }) => name === "internal_reserve_plan_export",
    )!;
    expect(activeReservation.args.p_config_digest).toBe(
      archivedReservation.args.p_config_digest,
    );
    expect(activeReservation.args.p_request_digest).toBe(
      archivedReservation.args.p_request_digest,
    );
  });

  it("devuelve conflicto para un duplicado pendiente", async () => {
    const current = setup({ outcome: "pending" });
    const response = await handlePlanExports(
      request(`/v1/plans/${planVersionId}/exports`, { body: config }),
      current.dependencies,
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "EXPORT_IN_PROGRESS" },
    });
    expect(current.events).not.toContain("render-pdf");
  });

  it("marca la reserva como fallida si falla el renderizador o Storage", async () => {
    for (const options of [{ renderError: true }, { uploadError: true }]) {
      const current = setup(options);
      const response = await handlePlanExports(
        request(`/v1/plans/${planVersionId}/exports`, { body: config }),
        current.dependencies,
      );
      expect(response.status).toBe(503);
      const publicError = await response.text();
      expect(publicError).not.toContain("choices");
      expect(publicError).not.toContain("valid-user-jwt");
      expect(current.calls.map(({ name }) => name)).toContain(
        "internal_fail_plan_export",
      );
    }
  });

  it("rechaza más de 25 MiB antes de subir el archivo", async () => {
    const current = setup({
      renderedBytes: new Uint8Array(EXPORT_MAX_ARTIFACT_BYTES + 1),
    });
    const response = await handlePlanExports(
      request(`/v1/plans/${planVersionId}/exports`, { body: config }),
      current.dependencies,
    );

    expect(response.status).toBe(422);
    expect(current.events).not.toContain("upload");
    expect(current.calls.map(({ name }) => name)).toContain(
      "internal_fail_plan_export",
    );
  });

  it("descarga bytes por el proxy autenticado sin redirección ni URL firmada", async () => {
    const current = setup();
    const response = await handlePlanExports(
      request(`/v1/exports/${artifactId}/content`, { method: "GET" }),
      current.dependencies,
    );

    expect(response.status).toBe(200);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(pdfBytes);
    expect(response.headers.has("location")).toBe(false);
    expect(response.headers.get("content-disposition")).toBe(
      `attachment; filename="plan-${artifactId}.pdf"`,
    );
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(current.calls.map(({ name }) => name)).toEqual(["internal_get_plan_export"]);
    expect(current.calls[0]?.args).toMatchObject({
      p_auth_session_id: sessionId,
      p_auth_subject: userId,
    });
  });

  it("purga rutas exactas con bearer de servicio y confirma solo después de Storage", async () => {
    const forbidden = setup({ authorizeService: false });
    const forbiddenResponse = await handlePlanExports(
      request(`/v1/internal/deletion-jobs/${jobId}/export-purge`),
      forbidden.dependencies,
    );
    expect(forbiddenResponse.status).toBe(403);
    expect(forbidden.calls).toEqual([]);

    const current = setup();
    const response = await handlePlanExports(
      request(`/v1/internal/deletion-jobs/${jobId}/export-purge`, {
        authorization: "Bearer service-role-token",
      }),
      current.dependencies,
    );

    expect(response.status).toBe(200);
    expect(current.events).toEqual([
      "rpc:internal_list_profile_export_purge_paths",
      expect.stringMatching(/^remove:/),
      "rpc:internal_confirm_profile_export_purge",
    ]);

    const failed = setup({ removeError: true });
    const failedResponse = await handlePlanExports(
      request(`/v1/internal/deletion-jobs/${jobId}/export-purge`, {
        authorization: "Bearer service-role-token",
      }),
      failed.dependencies,
    );
    expect(failedResponse.status).toBe(503);
    expect(failed.calls.map(({ name }) => name)).not.toContain(
      "internal_confirm_profile_export_purge",
    );
  });

  it("mapea el límite a 429 con Retry-After acotado", async () => {
    const current = setup({
      rpcError: { code: "PT429", message: "export_rate_limited" },
    });
    const response = await handlePlanExports(
      request(`/v1/plans/${planVersionId}/exports`, { body: config }),
      current.dependencies,
    );

    expect(response.status).toBe(429);
    expect(Number(response.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(Number(response.headers.get("retry-after"))).toBeLessThanOrEqual(3600);
  });
});
