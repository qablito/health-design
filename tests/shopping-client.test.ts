import { describe, expect, it, vi } from "vitest";

import {
  createShoppingClient,
  ShoppingApiError,
} from "../apps/web/src/features/shopping/shopping-client";

const PROFILE_ID = "51000000-0000-4000-8000-000000017701";
const PLAN_VERSION_ID = "82000000-0000-4000-8000-000000017701";
const PREFERENCE_ID = "71000000-0000-4000-8000-000000017701";
const SNAPSHOT_ID = "91000000-0000-4000-8000-000000017701";
const SKU_ID = "8b000000-0000-4000-8000-000000017701";
const PUBLICATION_ID = "8e000000-0000-4000-8000-000000017701";
const NOW = "2026-07-22T12:00:00.000Z";

const projection = {
  basePriceEur: "3.25",
  categoryPath: ["Carne"],
  chain: "mercadona",
  exclusionReasons: [],
  externalSku: "pollo-500",
  formatText: "500 g",
  gtin14: null,
  market: "ES",
  name: "Pechuga de pollo",
  normalizedPrice: { dimension: "mass", unit: "EUR/kg", value: "6.5" },
  package: {
    equivalenceEvidenceRef: null,
    equivalentEdibleMassG: null,
    saleMeasure: { dimension: "mass", quantity: "500", unit: "g" },
  },
  purchaseForm: "fresh",
  schemaVersion: 1,
  skuId: SKU_ID,
  usability: "calculable",
} as const;

const preference = {
  comparedChains: [],
  createdAt: NOW,
  createdBy: "31000000-0000-4000-8000-000000017701",
  id: PREFERENCE_ID,
  mode: "single",
  preferredChain: "mercadona",
  profileId: PROFILE_ID,
  schemaVersion: 1,
  sorting: "normalized_price_asc",
  supersedesId: null,
  version: 1,
} as const;

const envelope = {
  lifecycle: { archivedAt: null, status: "active" },
  schemaVersion: 1,
  snapshot: {
    basketSeedRevisionId: "87000000-0000-4000-8000-000000017701",
    catalogPublicationIds: [PUBLICATION_ID],
    comparison: null,
    completeness: "complete",
    createdAt: NOW,
    createdBy: preference.createdBy,
    id: SNAPSHOT_ID,
    inputDigest: "ab".repeat(32),
    items: [
      {
        alternatives: [],
        amountG: "1000",
        canonicalFoodKey: "food:test.chicken",
        name: "Pollo",
        selected: {
          estimatedRemainderG: "0",
          packageCount: "2",
          projection,
          requiredAfterLeftoverG: "1000",
          totalCostEur: "6.5",
        },
        selectionOrigin: "automatic",
        shoppingItemId: "92000000-0000-4000-8000-000000017701",
        state: "resolved",
        uncertainties: [],
      },
    ],
    planVersionId: PLAN_VERSION_ID,
    preference: {
      comparedChains: [],
      mode: "single",
      preferredChain: "mercadona",
      sorting: "normalized_price_asc",
    },
    preferenceRevisionId: PREFERENCE_ID,
    profileId: PROFILE_ID,
    resolverVersion: "shopping-resolver-v2",
    revision: 1,
    schemaVersion: 1,
    supersedesId: null,
    totals: {
      coverage: { resolvedItems: 1, totalItems: 1 },
      estimatedTotalEur: "6.5",
      kind: "complete",
      resolvedItems: 1,
      unresolvedItems: 0,
    },
  },
} as const;

function response(body: unknown, status = 200, headers?: HeadersInit): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json", ...headers },
    status,
  });
}

function setup(fetcher = vi.fn()) {
  const client = createShoppingClient({
    baseUrl: "http://localhost/functions/v1/catalogs",
    fetcher,
    getAccessToken: vi.fn().mockResolvedValue("access-token"),
    publishableKey: "publishable-key",
  });
  return { client, fetcher };
}

describe("shopping client", () => {
  it("valida y lee preferencia, catálogo y snapshot", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        response({ legacyHint: null, preference, schemaVersion: 1 }),
      )
      .mockResolvedValueOnce(
        response({
          chain: "mercadona",
          items: [projection],
          nextCursor: null,
          publicationId: PUBLICATION_ID,
          schemaVersion: 1,
        }),
      )
      .mockResolvedValueOnce(response(envelope));
    const { client } = setup(fetcher);

    await expect(client.getPreference(PROFILE_ID)).resolves.toMatchObject({
      preference: { id: PREFERENCE_ID },
    });
    await expect(client.getCatalogPage("mercadona", 1)).resolves.toMatchObject({
      chain: "mercadona",
    });
    await expect(client.getSnapshot(SNAPSHOT_ID)).resolves.toEqual(envelope);
    expect(fetcher.mock.calls.map(([url]) => String(url))).toEqual([
      `http://localhost/functions/v1/catalogs/v1/profiles/${PROFILE_ID}/shopping-preference`,
      "http://localhost/functions/v1/catalogs/v1/catalogs?chain=mercadona&limit=1",
      `http://localhost/functions/v1/catalogs/v1/shopping/${SNAPSHOT_ID}`,
    ]);
  });

  it("envía contratos mínimos y conserva una clave idempotente aportada", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        response({ preferenceRevisionId: PREFERENCE_ID, schemaVersion: 1, version: 1 }),
      )
      .mockResolvedValueOnce(
        response({
          schemaVersion: 1,
          snapshotId: SNAPSHOT_ID,
          status: "active",
          version: 1,
        }),
      )
      .mockResolvedValueOnce(
        response({
          schemaVersion: 1,
          snapshotId: SNAPSHOT_ID,
          status: "active",
          version: 2,
        }),
      );
    const { client } = setup(fetcher);
    const key = "shopping-client-retry-key-0001";

    await client.putPreference(
      PROFILE_ID,
      {
        comparedChains: [],
        expectedVersion: null,
        mode: "single",
        preferredChain: "mercadona",
        schemaVersion: 1,
        sorting: "normalized_price_asc",
      },
      { idempotencyKey: key },
    );
    await client.createSnapshot(
      PLAN_VERSION_ID,
      { preferenceRevisionId: PREFERENCE_ID, schemaVersion: 1 },
      { idempotencyKey: key },
    );
    await client.clearLeftover(
      SNAPSHOT_ID,
      {
        action: "clear",
        canonicalFoodKey: "food:test.chicken",
        expectedVersion: 1,
        schemaVersion: 1,
      },
      { idempotencyKey: key },
    );

    for (const [, init] of fetcher.mock.calls) {
      expect((init as RequestInit).headers).toMatchObject({
        authorization: "Bearer access-token",
        "idempotency-key": key,
      });
    }
    const secondRequest = fetcher.mock.calls[1]?.[1] as RequestInit | undefined;
    const secondBody = secondRequest?.body;
    expect(typeof secondBody).toBe("string");
    if (typeof secondBody !== "string") throw new Error("request_body_missing");
    expect(JSON.parse(secondBody)).toEqual({
      preferenceRevisionId: PREFERENCE_ID,
      schemaVersion: 1,
    });
  });

  it("descubre las tres cadenas en paralelo y omite solo las no publicadas", async () => {
    const pending: string[] = [];
    const fetcher = vi.fn((url: string) => {
      pending.push(url);
      const chain = new URL(url).searchParams.get("chain");
      if (chain === "dia") {
        return Promise.resolve(
          response(
            {
              error: {
                code: "CATALOG_NOT_PUBLISHED",
                message_key: "shopping.catalog_not_published",
                request_id: "request-dia",
                retryable: false,
              },
            },
            409,
          ),
        );
      }
      return Promise.resolve(
        response({
          chain,
          items: [projection],
          nextCursor: null,
          publicationId: PUBLICATION_ID,
          schemaVersion: 1,
        }),
      );
    });
    const { client } = setup(fetcher);

    await expect(client.discoverAvailableChains()).resolves.toEqual([
      "mercadona",
      "aldi",
    ]);
    expect(pending).toHaveLength(3);
  });

  it("no oculta fallos distintos de catálogo no publicado", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      response(
        {
          error: {
            code: "DEPENDENCY_UNAVAILABLE",
            message_key: "shopping.dependency_unavailable",
            request_id: "request-error",
            retryable: true,
          },
        },
        503,
        { "retry-after": "4" },
      ),
    );
    fetcher.mockImplementation(() =>
      Promise.resolve(
        response(
          {
            error: {
              code: "DEPENDENCY_UNAVAILABLE",
              message_key: "shopping.dependency_unavailable",
              request_id: "request-error",
              retryable: true,
            },
          },
          503,
          { "retry-after": "4" },
        ),
      ),
    );
    const { client } = setup(fetcher);
    await expect(client.discoverAvailableChains()).rejects.toMatchObject({
      code: "DEPENDENCY_UNAVAILABLE",
      retryAfterSeconds: 4,
      retryable: true,
    });
  });

  it("rechaza identificadores y respuestas no contractuales", async () => {
    const invalidId = setup();
    expect(() => invalidId.client.getSnapshot("../foreign")).toThrow(
      "invalid_shopping_identifier",
    );
    expect(invalidId.fetcher).not.toHaveBeenCalled();

    const invalidResponse = setup(vi.fn().mockResolvedValue(response({})));
    await expect(invalidResponse.client.getPreference(PROFILE_ID)).rejects.toThrow(
      "invalid_shopping_response",
    );
  });

  it("expone errores HTTP estables sin perder Retry-After", async () => {
    const { client } = setup(
      vi.fn().mockResolvedValue(
        response(
          {
            error: {
              code: "RATE_LIMITED",
              message_key: "shopping.rate_limited",
              request_id: "request-rate",
              retryable: true,
            },
          },
          429,
          { "retry-after": "7" },
        ),
      ),
    );
    let error: unknown;
    try {
      await client.getCatalogPage("mercadona", 1);
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(ShoppingApiError);
    expect(error).toMatchObject({
      code: "RATE_LIMITED",
      requestId: "request-rate",
      retryAfterSeconds: 7,
      status: 429,
    });
  });
});
