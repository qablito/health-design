import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { RUNTIME_SMOKE_EXAMPLE, RuntimeSmokeSchema } from "@health-design/contracts";
import { getWebRuntimeSmoke } from "../apps/web/src/runtime-smoke";
import { handleRuntimeSmoke } from "../supabase/functions/runtime-smoke/index";

const expectedPayload = {
  schemaVersion: 1,
  kind: "runtime-smoke",
  message: "contrato compartido",
} as const;

describe("contrato compartido entre runtimes", () => {
  it("interpreta el mismo payload en Node, navegador y Edge", async () => {
    const nodePayload = RuntimeSmokeSchema.parse(RUNTIME_SMOKE_EXAMPLE);
    const webPayload = getWebRuntimeSmoke();
    const edgeResponse = await handleRuntimeSmoke(
      new Request("http://localhost/runtime-smoke", {
        body: JSON.stringify(RUNTIME_SMOKE_EXAMPLE),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
    );

    expect(nodePayload).toEqual(expectedPayload);
    expect(webPayload).toEqual(expectedPayload);
    expect(edgeResponse.status).toBe(200);
    await expect(edgeResponse.json()).resolves.toEqual(expectedPayload);
  });

  it("rechaza propiedades adicionales en tiempo de ejecución", async () => {
    const payloadWithExtraField = {
      ...RUNTIME_SMOKE_EXAMPLE,
      unexpected: true,
    };

    expect(() => RuntimeSmokeSchema.parse(payloadWithExtraField)).toThrow();

    const edgeResponse = await handleRuntimeSmoke(
      new Request("http://localhost/runtime-smoke", {
        body: JSON.stringify(payloadWithExtraField),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
    );

    expect(edgeResponse.status).toBe(400);
    await expect(edgeResponse.json()).resolves.toEqual({
      error: "invalid_runtime_smoke_payload",
    });
  });

  it("rechaza tipos MIME que solo contienen el texto application/json", async () => {
    const edgeResponse = await handleRuntimeSmoke(
      new Request("http://localhost/runtime-smoke", {
        body: JSON.stringify(RUNTIME_SMOKE_EXAMPLE),
        headers: { "content-type": "text/application/json-ish" },
        method: "POST",
      }),
    );

    expect(edgeResponse.status).toBe(415);
    await expect(edgeResponse.json()).resolves.toEqual({
      error: "content_type_must_be_json",
    });
  });

  it("interrumpe el cuerpo en streaming al superar el límite", async () => {
    let pulls = 0;
    const body = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          pulls += 1;
          if (pulls === 1) {
            controller.enqueue(new Uint8Array(1_025));
            return;
          }
          throw new Error("el handler no debe leer después de superar el límite");
        },
      },
      { highWaterMark: 0 },
    );
    const request = new Request("http://localhost/runtime-smoke", {
      body,
      headers: { "content-type": "application/json" },
      method: "POST",
      // Node exige duplex para cuerpos ReadableStream; Deno y navegadores lo ignoran.
      duplex: "half",
    } as RequestInit & { duplex: "half" });

    const edgeResponse = await handleRuntimeSmoke(request);

    expect(edgeResponse.status).toBe(413);
    await expect(edgeResponse.json()).resolves.toEqual({
      error: "payload_too_large",
    });
    expect(pulls).toBe(1);
  });

  it("mantiene JWT obligatorio en la configuración desplegable", async () => {
    const config = await readFile(
      new URL("../supabase/config.toml", import.meta.url),
      "utf8",
    );

    expect(config).toMatch(/\[functions\.runtime-smoke\][\s\S]*?verify_jwt\s*=\s*true/);
  });

  it("aplica CORS exacto y rechaza orígenes ajenos", async () => {
    const allowedRequest = new Request("http://localhost/runtime-smoke", {
      body: JSON.stringify(RUNTIME_SMOKE_EXAMPLE),
      headers: {
        "content-type": "application/json",
        origin: "https://health-design.pages.dev",
      },
      method: "POST",
    });
    const allowedResponse = await handleRuntimeSmoke(allowedRequest, "production");
    expect(allowedResponse.status).toBe(200);
    expect(allowedResponse.headers.get("access-control-allow-origin")).toBe(
      "https://health-design.pages.dev",
    );

    const rejectedResponse = await handleRuntimeSmoke(
      new Request("http://localhost/runtime-smoke", {
        headers: { origin: "https://attacker.invalid" },
        method: "OPTIONS",
      }),
      "production",
    );
    expect(rejectedResponse.status).toBe(403);
    expect(rejectedResponse.headers.has("access-control-allow-origin")).toBe(false);
  });
});
