import { describe, expect, it, vi } from "vitest";

import { COMMERCIAL_PRODUCT_FIXTURE } from "@health-design/test-fixtures/products";

import {
  handleProductCatalog,
  fetchOpenFoodFactsProduct,
  type ProductCatalogDependencies,
} from "../supabase/functions/catalogs/products.ts";

const PROFILE_ID = "51000000-0000-4000-8000-000000016101";
const USER_ID = "00000000-0000-4000-8000-000000016101";
const SESSION_ID = "21000000-0000-4000-8000-000000016101";
const REQUEST_ID = "91000000-0000-4000-8000-000000016101";

function request(
  method: "GET" | "POST",
  code = "8412345678905",
  body?: unknown,
): Request {
  return new Request(
    `http://localhost/functions/v1/catalogs/v1/profiles/${PROFILE_ID}/products/barcode/${code}${method === "POST" ? "/confirm" : ""}?symbology=ean_13`,
    {
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      headers: {
        authorization: "Bearer user-token",
        ...(body === undefined ? {} : { "content-type": "application/json" }),
        ...(method === "POST" ? { "idempotency-key": REQUEST_ID } : {}),
        origin: "http://127.0.0.1:5173",
      },
      method,
    },
  );
}

function dependencies(
  overrides: Partial<ProductCatalogDependencies> = {},
): ProductCatalogDependencies {
  return {
    authenticate: vi.fn().mockResolvedValue({ sessionId: SESSION_ID, userId: USER_ID }),
    environment: "local",
    fetchOpenFoodFacts: vi.fn().mockResolvedValue({
      availability: "available",
      snapshot: COMMERCIAL_PRODUCT_FIXTURE,
    }),
    hashCanonical: vi.fn().mockResolvedValue("ab".repeat(32)),
    rpc: vi.fn().mockImplementation((name: string) => {
      if (name === "internal_commercial_product_resolve") {
        return Promise.resolve({ data: null, error: null });
      }
      return Promise.resolve({
        data: {
          completeness: "complete",
          confirmationId: "11000000-0000-4000-8000-000000016101",
          confirmedAt: "2026-07-21T08:00:00.000Z",
          correctionId: null,
          productId: "12000000-0000-4000-8000-000000016101",
          reusedRevision: false,
          revisionId: "13000000-0000-4000-8000-000000016101",
          schemaVersion: 1,
          scope: "profile",
        },
        error: null,
      });
    }),
    ...overrides,
  };
}

describe("productos comerciales Edge", () => {
  it("rechaza GTIN inválido antes de consultar persistencia o proveedor", async () => {
    const deps = dependencies();
    const response = await handleProductCatalog(request("GET", "8412345678907"), deps);

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: "INVALID_GTIN" } });
    expect(deps.rpc).not.toHaveBeenCalled();
    expect(deps.fetchOpenFoodFacts).not.toHaveBeenCalled();
  });

  it("devuelve primero la revisión privada efectiva sin consultar OFF", async () => {
    const internal = {
      completeness: "complete",
      confirmedForProfile: true,
      contentHash: "cd".repeat(32),
      gtin: COMMERCIAL_PRODUCT_FIXTURE.gtin,
      matching: null,
      revisionId: "13000000-0000-4000-8000-000000016101",
      schemaVersion: 1,
      snapshot: COMMERCIAL_PRODUCT_FIXTURE,
      source: "profile",
      sourceAvailability: "available",
      uncertainties: ["fiberG_unknown"],
    };
    const deps = dependencies({
      rpc: vi.fn().mockResolvedValue({ data: internal, error: null }),
    });
    const response = await handleProductCatalog(request("GET"), deps);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(internal);
    expect(deps.fetchOpenFoodFacts).not.toHaveBeenCalled();
    expect(deps.rpc).toHaveBeenCalledWith("internal_commercial_product_resolve", {
      p_auth_session_id: SESSION_ID,
      p_auth_subject: USER_ID,
      p_canonical_food_key: null,
      p_gtin14: "08412345678905",
      p_profile_id: PROFILE_ID,
    });
  });

  it("presenta OFF como borrador efímero y nunca lo confirma al resolver", async () => {
    const deps = dependencies();
    const response = await handleProductCatalog(request("GET"), deps);
    const payload: unknown = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      confirmedForProfile: false,
      revisionId: null,
      source: "open_food_facts",
      sourceAvailability: "available",
    });
    expect(JSON.stringify(payload)).not.toContain("imageUrl");
    expect(deps.rpc).toHaveBeenCalledTimes(1);
  });

  it.each(["not_found", "unavailable"] as const)(
    "abre formulario manual cuando OFF queda %s",
    async (availability) => {
      const deps = dependencies({
        fetchOpenFoodFacts: vi.fn().mockResolvedValue({ availability }),
      });
      const response = await handleProductCatalog(request("GET"), deps);

      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        completeness: "insufficient",
        contentHash: null,
        revisionId: null,
        snapshot: null,
        source: "manual_blank",
        sourceAvailability: availability,
      });
    },
  );

  it("confirma el snapshot completo mediante una mutación idempotente separada", async () => {
    const deps = dependencies();
    const response = await handleProductCatalog(
      request("POST", "8412345678905", {
        expectedContentHash: "cd".repeat(32),
        schemaVersion: 1,
        snapshot: COMMERCIAL_PRODUCT_FIXTURE,
      }),
      deps,
    );

    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ scope: "profile" });
    expect(deps.rpc).toHaveBeenCalledWith(
      "internal_commercial_product_confirm",
      expect.objectContaining({
        p_auth_session_id: SESSION_ID,
        p_auth_subject: USER_ID,
        p_completeness: "complete",
        p_gtin14: "08412345678905",
        p_profile_id: PROFILE_ID,
        p_request_id: REQUEST_ID,
        p_snapshot: COMMERCIAL_PRODUCT_FIXTURE,
      }),
    );
    expect(deps.fetchOpenFoodFacts).not.toHaveBeenCalled();
  });

  it("rechaza incoherencia, cuerpo distinto para la misma clave y acceso ajeno", async () => {
    const incoherent = {
      ...COMMERCIAL_PRODUCT_FIXTURE,
      nutrients: {
        ...COMMERCIAL_PRODUCT_FIXTURE.nutrients,
        fatG: { state: "known", unit: "g", value: "3" },
        saturatedFatG: { state: "known", unit: "g", value: "4" },
      },
    } as const;
    const invalidDeps = dependencies();
    const invalid = await handleProductCatalog(
      request("POST", "8412345678905", {
        schemaVersion: 1,
        snapshot: incoherent,
      }),
      invalidDeps,
    );
    expect(invalid.status).toBe(422);
    expect(invalidDeps.rpc).not.toHaveBeenCalled();

    for (const [message, status] of [
      ["idempotency_key_reused", 409],
      ["profile_access_denied", 403],
    ] as const) {
      const deps = dependencies({
        rpc: vi.fn().mockResolvedValue({ data: null, error: { message } }),
      });
      const response = await handleProductCatalog(request("GET"), deps);
      expect(response.status).toBe(status);
    }
  });

  it("comparte una única lectura OFF entre resoluciones simultáneas del mismo GTIN", async () => {
    let release: (() => void) | undefined;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fetchOpenFoodFacts = vi.fn().mockImplementation(async () => {
      await pending;
      return { availability: "available", snapshot: COMMERCIAL_PRODUCT_FIXTURE };
    });
    const deps = dependencies({ fetchOpenFoodFacts });
    const first = handleProductCatalog(request("GET"), deps);
    const second = handleProductCatalog(request("GET"), deps);
    await vi.waitFor(() => expect(fetchOpenFoodFacts).toHaveBeenCalledTimes(1));
    release?.();

    const responses = await Promise.all([first, second]);
    expect(responses.map(({ status }) => status)).toEqual([200, 200]);
    expect(fetchOpenFoodFacts).toHaveBeenCalledTimes(1);
  });

  it("mapea únicamente campos estructurados de OFF y omite imágenes", async () => {
    const fetchMock = vi.fn().mockImplementation((input: URL | RequestInfo) => {
      const url =
        input instanceof URL
          ? input
          : typeof input === "string"
            ? new URL(input)
            : new URL(input.url);
      expect(url.origin).toBe("https://world.openfoodfacts.org");
      expect(url.searchParams.get("fields")).not.toContain("image");
      return Promise.resolve(
        new Response(
          JSON.stringify({
            product: {
              allergens_tags: ["en:milk"],
              brands: "Marca OFF",
              images: { front: "no debe leerse" },
              ingredients: [{ text: "Leche" }],
              nutriments: {
                carbohydrates_100g: 4.7,
                "energy-kcal_100g": 63,
                fat_100g: 3.5,
                proteins_100g: 3.4,
                salt_100g: 0.1,
                "saturated-fat_100g": 2.3,
                sugars_100g: 4.7,
              },
              nutrition_data_per: "100g",
              product_name_es: "Yogur natural",
              traces_tags: [],
            },
            status: 1,
          }),
          { headers: { "content-type": "application/json" }, status: 200 },
        ),
      );
    });
    const result = await fetchOpenFoodFactsProduct(COMMERCIAL_PRODUCT_FIXTURE.gtin, {
      fetch: fetchMock,
      userAgent: "HealthDesign/dev-contact",
    });

    expect(result).toMatchObject({
      availability: "available",
      snapshot: {
        name: "Yogur natural",
        nutrients: { fiberG: { state: "unknown" } },
      },
    });
    expect(JSON.stringify(result)).not.toContain("image");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("no llama a OFF sin identificación configurada y rechaza respuestas enormes", async () => {
    const disabledFetch = vi.fn();
    await expect(
      fetchOpenFoodFactsProduct(COMMERCIAL_PRODUCT_FIXTURE.gtin, {
        fetch: disabledFetch,
      }),
    ).resolves.toEqual({ availability: "unavailable" });
    expect(disabledFetch).not.toHaveBeenCalled();

    const oversizedFetch = vi.fn().mockResolvedValue(
      new Response("{}", {
        headers: { "content-length": String(129 * 1024) },
        status: 200,
      }),
    );
    await expect(
      fetchOpenFoodFactsProduct(COMMERCIAL_PRODUCT_FIXTURE.gtin, {
        fetch: oversizedFetch,
        userAgent: "HealthDesign/dev-contact",
      }),
    ).resolves.toEqual({ availability: "unavailable" });
  });
});
