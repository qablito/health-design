import { describe, expect, it, vi } from "vitest";

import type { ExportCreateRequestContract } from "@health-design/contracts";

import { createExportClient } from "../apps/web/src/features/exports/export-client";

const planVersionId = "22000000-0000-4000-8000-000000015301";
const artifactId = "23000000-0000-4000-8000-000000015301";
const createdAt = "2026-07-20T17:10:00.000Z";
const config: ExportCreateRequestContract = {
  choices: [[0, 0, 0, 1]],
  detail: "complete",
  format: "pdf",
  includeShopping: true,
  includeWeeklyPreparation: true,
  presentation: "preparation",
  range: { kind: "week" },
  schemaVersion: 1,
};
const ack = {
  artifactId,
  createdAt,
  detail: "complete",
  format: "pdf",
  planVersionId,
  presentation: "preparation",
  schemaVersion: 1,
  status: "ready",
} as const;

function setup(fetcher: typeof fetch) {
  const events: string[] = [];
  const client = createExportClient({
    baseUrl: "https://api.test/functions/v1/exports",
    createObjectURL: () => {
      events.push("create-url");
      return "blob:private-export";
    },
    fetcher,
    getAccessToken: () => Promise.resolve("private-user-jwt"),
    publishableKey: "publishable-key",
    revokeObjectURL: (url) => events.push(`revoke:${url}`),
    triggerDownload: (url, filename) => events.push(`download:${url}:${filename}`),
  });
  return { client, events };
}

describe("cliente de exportaciones privadas", () => {
  it("rechaza rutas manipuladas antes de obtener credenciales", async () => {
    const getAccessToken = vi.fn(() => Promise.resolve("private-user-jwt"));
    const client = createExportClient({
      baseUrl: "https://api.test/functions/v1/exports",
      createObjectURL: (blob) => URL.createObjectURL(blob),
      fetcher: vi.fn<typeof fetch>(),
      getAccessToken,
      publishableKey: "publishable-key",
      revokeObjectURL: (url) => URL.revokeObjectURL(url),
      triggerDownload: vi.fn(),
    });

    await expect(client.download(`${artifactId}?redirect=true`, "pdf")).rejects.toThrow(
      "invalid_export_identifier",
    );
    await expect(client.create(`${planVersionId}#fragment`, config)).rejects.toThrow(
      "invalid_export_identifier",
    );
    expect(getAccessToken).not.toHaveBeenCalled();
  });

  it("envía JWT, apikey, JSON, no-referrer e idempotencia y valida el recibo", async () => {
    const fetcher = vi.fn<typeof fetch>(() =>
      Promise.resolve(
        new Response(JSON.stringify(ack), {
          headers: { "content-type": "application/json" },
          status: 200,
        }),
      ),
    );
    const { client } = setup(fetcher);

    await expect(client.create(planVersionId, config)).resolves.toEqual(ack);
    const [url, init] = fetcher.mock.calls[0]!;
    expect(url).toBe(
      `https://api.test/functions/v1/exports/v1/plans/${planVersionId}/exports`,
    );
    expect(init).toMatchObject({ method: "POST", referrerPolicy: "no-referrer" });
    expect(new Headers(init?.headers).get("authorization")).toBe(
      "Bearer private-user-jwt",
    );
    expect(new Headers(init?.headers).get("apikey")).toBe("publishable-key");
    expect(new Headers(init?.headers).get("content-type")).toBe("application/json");
    expect(new Headers(init?.headers).get("idempotency-key")).toMatch(
      /^[0-9a-f-]{36}$/,
    );
  });

  it("rechaza recibos con URL firmada o propiedades no contratadas", async () => {
    const fetcher = vi.fn<typeof fetch>(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({ ...ack, signedUrl: "https://storage.test/file" }),
          {
            headers: { "content-type": "application/json" },
            status: 200,
          },
        ),
      ),
    );
    const { client } = setup(fetcher);

    await expect(client.create(planVersionId, config)).rejects.toThrow();
  });

  it("obtiene el proxy sin redirecciones y revoca la URL local tras descargar", async () => {
    const fetcher = vi.fn<typeof fetch>(() =>
      Promise.resolve(
        new Response(new Uint8Array([37, 80, 68, 70]), {
          headers: { "content-type": "application/pdf" },
          status: 200,
        }),
      ),
    );
    const { client, events } = setup(fetcher);

    await client.download(artifactId, "pdf");
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({
      method: "GET",
      redirect: "error",
      referrerPolicy: "no-referrer",
    });
    expect(events).toEqual([
      "create-url",
      `download:blob:private-export:plan-${artifactId}.pdf`,
      "revoke:blob:private-export",
    ]);
  });

  it("no crea Blob si la respuesta intenta redirigir", async () => {
    const fetcher = vi.fn<typeof fetch>(() =>
      Promise.resolve(
        new Response(null, {
          headers: { location: "https://storage.test/signed" },
          status: 302,
        }),
      ),
    );
    const { client, events } = setup(fetcher);

    await expect(client.download(artifactId, "pdf")).rejects.toThrow(
      "export_redirect_rejected",
    );
    expect(events).toEqual([]);
  });
});
