import { describe, expect, it, vi } from "vitest";

import {
  handleMedicationSearch,
  type MedicationSearchDependencies,
} from "../supabase/functions/medications/search.ts";

function request(query: string, mode = "name"): Request {
  return new Request(
    `http://localhost/functions/v1/medications/v1/search?q=${encodeURIComponent(query)}&mode=${mode}`,
    {
      headers: {
        authorization: "Bearer token",
        origin: "http://127.0.0.1:5173",
      },
    },
  );
}

function dependencies(
  overrides: Partial<MedicationSearchDependencies> = {},
): MedicationSearchDependencies {
  return {
    authenticate: vi.fn().mockResolvedValue({ userId: "user-id" }),
    cacheIdentities: vi.fn().mockResolvedValue(undefined),
    environment: "local",
    fetchCima: vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          pagina: 1,
          resultados: [
            {
              comerc: true,
              cpresc: "Medicamento sujeto a prescripción médica",
              nombre: "OZEMPIC 0,25 MG SOLUCION INYECTABLE",
              nregistro: "117251002",
              pactivos: "SEMAGLUTIDA",
              receta: true,
              viasAdministracion: [{ id: 58, nombre: "VÍA SUBCUTÁNEA" }],
            },
          ],
          tamanioPagina: 200,
          totalFilas: 1,
        }),
        { headers: { "content-type": "application/json" }, status: 200 },
      ),
    ),
    hashCanonical: vi.fn().mockResolvedValue("ab".repeat(32)),
    now: () => new Date("2026-07-19T19:00:00.000Z"),
    ...overrides,
  };
}

describe("búsqueda canónica AEMPS/CIMA", () => {
  it("devuelve solo identidad canónica y atributos de selección permitidos", async () => {
    const deps = dependencies();
    const response = await handleMedicationSearch(request("ozempic"), deps);

    expect(response.status).toBe(200);
    const body = (await response.json()) as unknown;
    expect(body).toEqual({
      results: [
        {
          activeIngredients: ["SEMAGLUTIDA"],
          administrationRoutes: ["VÍA SUBCUTÁNEA"],
          aempsId: "117251002",
          commercialized: true,
          name: "OZEMPIC 0,25 MG SOLUCION INYECTABLE",
          prescriptionCondition: "Medicamento sujeto a prescripción médica",
          prescriptionRequired: true,
          registrationNumber: "117251002",
        },
      ],
      source: "AEMPS_CIMA",
    });
    expect(JSON.stringify(body).toLowerCase()).not.toContain("docs");
    expect(deps.cacheIdentities).toHaveBeenCalledWith([
      {
        activeIngredients: ["SEMAGLUTIDA"],
        administrationRoutes: ["VÍA SUBCUTÁNEA"],
        aempsId: "117251002",
        canonicalName: "OZEMPIC 0,25 MG SOLUCION INYECTABLE",
        commercialized: true,
        prescriptionRequired: true,
        retrievedAt: "2026-07-19T19:00:00.000Z",
        sourceHash: "ab".repeat(32),
        sourceVersion: "CIMA_REST_API_1_23",
      },
    ]);
    expect(deps.hashCanonical).toHaveBeenCalledWith({
      activeIngredients: ["SEMAGLUTIDA"],
      administrationRoutes: ["VÍA SUBCUTÁNEA"],
      aempsId: "117251002",
      canonicalName: "OZEMPIC 0,25 MG SOLUCION INYECTABLE",
      commercialized: true,
      prescriptionRequired: true,
    });
    expect(deps.fetchCima).toHaveBeenCalledWith(
      expect.stringContaining("https://cima.aemps.es/cima/rest/medicamentos?"),
      expect.objectContaining({
        headers: { accept: "application/json" },
      }),
    );
    const fetchCall = vi.mocked(deps.fetchCima).mock.calls[0];
    expect(fetchCall?.[1]?.signal).toBeInstanceOf(AbortSignal);
    const url = new URL(fetchCall?.[0] ?? "");
    expect(url.searchParams.get("nombre")).toBe("ozempic");
    expect(url.searchParams.get("pagina")).toBe("1");
  });

  it("permite buscar por principio activo sin combinar filtros upstream", async () => {
    const deps = dependencies();
    const response = await handleMedicationSearch(
      request("semaglutida", "active_ingredient"),
      deps,
    );

    expect(response.status).toBe(200);
    const url = new URL(vi.mocked(deps.fetchCima).mock.calls[0]?.[0] ?? "");
    expect(url.searchParams.get("practiv1")).toBe("semaglutida");
    expect(url.searchParams.has("nombre")).toBe(false);
  });

  it("acepta la forma CIMA 1.23 real de Ozempic con principio activo VTM", async () => {
    const deps = dependencies({
      fetchCima: vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            pagina: 1,
            resultados: [
              {
                comerc: true,
                cpresc: "Medicamento Sujeto A Prescripción Médica",
                nombre: "OZEMPIC 0,25 MG SOLUCION INYECTABLE EN PLUMA PRECARGADA",
                nregistro: "117251002",
                receta: true,
                viasAdministracion: [{ id: 58, nombre: "VÍA SUBCUTÁNEA" }],
                vtm: { id: 214891000140109, nombre: "semaglutida" },
              },
            ],
          }),
          { headers: { "content-type": "application/json" } },
        ),
      ),
    });

    const response = await handleMedicationSearch(request("ozempic"), deps);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      results: [
        {
          activeIngredients: ["semaglutida"],
          aempsId: "117251002",
        },
      ],
      source: "AEMPS_CIMA",
    });
    expect(deps.cacheIdentities).toHaveBeenCalledWith([
      expect.objectContaining({ activeIngredients: ["semaglutida"] }),
    ]);
  });

  it("rechaza consultas cortas y límites excesivos antes de llamar a CIMA", async () => {
    const deps = dependencies();
    const short = await handleMedicationSearch(request("a"), deps);
    const excessive = await handleMedicationSearch(
      new Request(
        "http://localhost/functions/v1/medications/v1/search?q=ozempic&limit=21",
        {
          headers: {
            authorization: "Bearer token",
            origin: "http://127.0.0.1:5173",
          },
        },
      ),
      deps,
    );

    expect(short.status).toBe(400);
    expect(excessive.status).toBe(400);
    expect(deps.fetchCima).not.toHaveBeenCalled();
  });

  it("devuelve una búsqueda válida vacía sin escribir una caché vacía", async () => {
    const deps = dependencies({
      fetchCima: vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ pagina: 1, resultados: [] }), {
          headers: { "content-type": "application/json" },
        }),
      ),
    });

    const response = await handleMedicationSearch(request("inexistente"), deps);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      results: [],
      source: "AEMPS_CIMA",
    });
    expect(deps.cacheIdentities).not.toHaveBeenCalled();
  });

  it("falla cerrado ante respuestas CIMA mal formadas o demasiado grandes", async () => {
    const malformed = dependencies({
      fetchCima: vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ resultados: [{ nombre: "sin id" }] }), {
          headers: { "content-type": "application/json" },
        }),
      ),
    });
    const oversized = dependencies({
      fetchCima: vi.fn().mockResolvedValue(
        new Response("x".repeat(1_000_001), {
          headers: { "content-type": "application/json" },
        }),
      ),
    });
    const multibyteOversized = dependencies({
      fetchCima: vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            padding: "é".repeat(500_001),
            pagina: 1,
            resultados: [
              {
                nombre: "Medicamento",
                nregistro: "1234",
                pactivos: "PRINCIPIO ACTIVO",
              },
            ],
          }),
          { headers: { "content-type": "application/json" } },
        ),
      ),
    });
    const schemaInvalid = dependencies({
      fetchCima: vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            pagina: 1,
            resultados: [
              {
                nombre: "Medicamento",
                nregistro: "1234",
                pactivos: "A".repeat(201),
              },
            ],
          }),
          { headers: { "content-type": "application/json" } },
        ),
      ),
    });

    expect((await handleMedicationSearch(request("ozempic"), malformed)).status).toBe(
      502,
    );
    expect((await handleMedicationSearch(request("ozempic"), oversized)).status).toBe(
      502,
    );
    expect(
      (await handleMedicationSearch(request("ozempic"), multibyteOversized)).status,
    ).toBe(502);
    expect(
      (await handleMedicationSearch(request("ozempic"), schemaInvalid)).status,
    ).toBe(502);
  });

  it("requiere sesión y traduce timeout o fallo upstream sin filtrar detalles", async () => {
    const unauthenticated = dependencies({
      authenticate: vi.fn().mockRejectedValue(new Error("jwt detail")),
    });
    const unavailable = dependencies({
      fetchCima: vi.fn().mockRejectedValue(new DOMException("timeout", "TimeoutError")),
    });

    const denied = await handleMedicationSearch(request("ozempic"), unauthenticated);
    const failed = await handleMedicationSearch(request("ozempic"), unavailable);

    expect(denied.status).toBe(401);
    expect(failed.status).toBe(503);
    expect(JSON.stringify(await failed.json())).not.toContain("timeout");
  });

  it("no entrega una identidad si la caché autoritativa no puede persistirla", async () => {
    const deps = dependencies({
      cacheIdentities: vi.fn().mockRejectedValue(new Error("database detail")),
    });

    const response = await handleMedicationSearch(request("ozempic"), deps);

    expect(response.status).toBe(503);
    expect(JSON.stringify(await response.json())).not.toContain("database detail");
  });
});
