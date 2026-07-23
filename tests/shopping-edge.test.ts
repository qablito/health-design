import { describe, expect, it, vi } from "vitest";

import type { ShoppingResolutionInput } from "@health-design/contracts";
import { resolveShopping } from "@health-design/engine/shopping";
import {
  createCatalogConcurrencyGuard,
  handleShoppingCatalog,
  type ShoppingEdgeDependencies,
} from "../supabase/functions/catalogs/shopping.ts";

const USER_ID = "00000000-0000-4000-8000-000000017601";
const SESSION_ID = "21000000-0000-4000-8000-000000017601";
const ACTOR_ID = "31000000-0000-4000-8000-000000017601";
const PROFILE_ID = "51000000-0000-4000-8000-000000017601";
const PLAN_VERSION_ID = "82000000-0000-4000-8000-000000017601";
const PREFERENCE_ID = "71000000-0000-4000-8000-000000017601";
const SEED_ID = "87000000-0000-4000-8000-000000017601";
const PUBLICATION_ID = "8e000000-0000-4000-8000-000000017601";
const SNAPSHOT_ID = "91000000-0000-4000-8000-000000017601";
const ITEM_ID = "92000000-0000-4000-8000-000000017601";
const SKU_ID = "8b000000-0000-4000-8000-000000017601";
const NOW = "2026-07-22T12:00:00.000Z";
const IDEMPOTENCY_KEY = "shopping-request-key-0001";

const projection = {
  basePriceEur: "3.25",
  categoryPath: ["Carne", "Pollo"],
  chain: "mercadona",
  exclusionReasons: [],
  externalSku: "pollo-500",
  formatText: "500 g",
  gtin14: "08400000000001",
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
  createdBy: ACTOR_ID,
  id: PREFERENCE_ID,
  mode: "single",
  preferredChain: "mercadona",
  profileId: PROFILE_ID,
  schemaVersion: 1,
  sorting: "normalized_price_asc",
  supersedesId: null,
  version: 1,
} as const;

const source = {
  basketSeedRevisionId: SEED_ID,
  catalogItems: [
    {
      canonicalFoodKey: "food:test.chicken",
      matchState: "exact",
      matchedEdiblePart: "edible",
      matchedFoodState: "raw",
      matchedPurchaseForm: "fresh",
      projection,
    },
  ],
  catalogPublicationIds: [PUBLICATION_ID],
  createdBy: ACTOR_ID,
  expectedRevision: 0,
  leftovers: [],
  leftoversForPersistence: [],
  manualSelections: [],
  planVersionId: PLAN_VERSION_ID,
  preferenceRevision: preference,
  profileId: PROFILE_ID,
  selectionsForPersistence: [],
  shoppingList: [
    {
      amountG: "1000",
      canonicalFoodKey: "food:test.chicken",
      name: "Pollo",
      purchaseContext: {
        ediblePart: "edible",
        foodState: "raw",
        purchaseForm: "fresh",
      },
    },
  ],
  supersedesId: null,
} as const;

const envelope = {
  lifecycle: { archivedAt: null, status: "active" },
  schemaVersion: 1,
  snapshot: {
    basketSeedRevisionId: SEED_ID,
    catalogPublicationIds: [PUBLICATION_ID],
    comparison: null,
    completeness: "complete",
    createdAt: NOW,
    createdBy: ACTOR_ID,
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
        shoppingItemId: ITEM_ID,
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

type SetupOptions = Readonly<{
  prepare?: unknown;
  rpcError?: Readonly<{ code?: string; message?: string }>;
  snapshot?: unknown;
}>;

function setup(options: SetupOptions = {}) {
  const calls: Array<{ args: Record<string, unknown>; name: string }> = [];
  const resolvedInputs: unknown[] = [];
  let generated = 0;
  const resolve = vi.fn((input: ShoppingResolutionInput) => {
    resolvedInputs.push(input);
    return resolveShopping(input);
  });
  const rpc = vi.fn((name: string, args: Record<string, unknown>) => {
    calls.push({ args, name });
    if (options.rpcError) {
      return Promise.resolve({ data: null, error: options.rpcError });
    }
    const data: Record<string, unknown> = {
      internal_get_shopping_preference: {
        legacyHint: null,
        preference: null,
        schemaVersion: 1,
      },
      internal_get_shopping_snapshot: options.snapshot ?? envelope,
      internal_list_shopping_catalog: {
        hasMore: false,
        items: [projection],
        publicationId: PUBLICATION_ID,
      },
      internal_persist_shopping_resolution: {
        schemaVersion: 1,
        snapshotId: SNAPSHOT_ID,
        status: "active",
        version: 1,
      },
      internal_prepare_shopping_resolution: options.prepare ?? {
        replay: false,
        source,
      },
      internal_put_shopping_preference: {
        preferenceRevisionId: PREFERENCE_ID,
        schemaVersion: 1,
        version: 1,
      },
    };
    return Promise.resolve({ data: data[name], error: null });
  });
  const dependencies: ShoppingEdgeDependencies = {
    authenticate: vi.fn().mockResolvedValue({ sessionId: SESSION_ID, userId: USER_ID }),
    catalogGuard: createCatalogConcurrencyGuard(4),
    digestIp: vi.fn().mockResolvedValue("ef".repeat(32)),
    environment: "local",
    hashCanonical: vi.fn().mockResolvedValue("cd".repeat(32)),
    now: () => NOW,
    randomUUID: () => {
      generated += 1;
      return generated === 1 ? SNAPSHOT_ID : ITEM_ID;
    },
    resolveShopping: resolve,
    rpc,
  };
  return { calls, dependencies, resolve, resolvedInputs, rpc };
}

function request(
  path: string,
  init: Readonly<{
    authorization?: string;
    body?: unknown;
    headers?: Record<string, string>;
    method?: "GET" | "POST" | "PUT";
  }> = {},
): Request {
  const body = init.body === undefined ? undefined : JSON.stringify(init.body);
  return new Request(`http://localhost/functions/v1/catalogs${path}`, {
    ...(body === undefined ? {} : { body }),
    headers: {
      authorization: init.authorization ?? "Bearer user-token",
      "cf-connecting-ip": "203.0.113.20",
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      "idempotency-key": IDEMPOTENCY_KEY,
      origin: "http://127.0.0.1:5173",
      ...init.headers,
    },
    method: init.method ?? "GET",
  });
}

describe("Edge público de compra", () => {
  it("exige autenticación y no enumera recursos ajenos", async () => {
    const anonymous = setup();
    const unauthenticated = await handleShoppingCatalog(
      request(`/v1/shopping/${SNAPSHOT_ID}`, { authorization: "" }),
      anonymous.dependencies,
    );
    expect(unauthenticated.status).toBe(401);

    const foreign = setup({
      rpcError: { code: "42501", message: "access_not_granted" },
    });
    const notFound = await handleShoppingCatalog(
      request(`/v1/shopping/${SNAPSHOT_ID}`),
      foreign.dependencies,
    );
    expect(notFound.status).toBe(404);
  });

  it("lee preferencia nula y conserva un hint heredado incompatible", async () => {
    const current = setup();
    current.rpc.mockResolvedValueOnce({
      data: {
        legacyHint: { compatible: false, value: "Lidl" },
        preference: null,
        schemaVersion: 1,
      },
      error: null,
    });
    const response = await handleShoppingCatalog(
      request(`/v1/profiles/${PROFILE_ID}/shopping-preference`),
      current.dependencies,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      legacyHint: { compatible: false, value: "Lidl" },
      preference: null,
      schemaVersion: 1,
    });
    expect(current.resolve).not.toHaveBeenCalled();
  });

  it("guarda la primera preferencia sin default y rechaza campos adicionales", async () => {
    const invalid = setup();
    const rejected = await handleShoppingCatalog(
      request(`/v1/profiles/${PROFILE_ID}/shopping-preference`, {
        body: {
          comparedChains: [],
          expectedVersion: null,
          mode: "single",
          preferredChain: "mercadona",
          schemaVersion: 1,
          sorting: "normalized_price_asc",
          unexpected: true,
        },
        method: "PUT",
      }),
      invalid.dependencies,
    );
    expect(rejected.status).toBe(422);
    expect(invalid.rpc).not.toHaveBeenCalled();

    const current = setup();
    const response = await handleShoppingCatalog(
      request(`/v1/profiles/${PROFILE_ID}/shopping-preference`, {
        body: {
          comparedChains: [],
          expectedVersion: null,
          mode: "single",
          preferredChain: "mercadona",
          schemaVersion: 1,
          sorting: "normalized_price_asc",
        },
        method: "PUT",
      }),
      current.dependencies,
    );
    expect(response.status).toBe(200);
    expect(current.calls[0]).toMatchObject({
      args: { p_expected_version: null, p_preferred_chain: "mercadona" },
      name: "internal_put_shopping_preference",
    });
    expect(JSON.stringify(current.calls[0])).not.toContain(IDEMPOTENCY_KEY);
  });

  it("pagina el catálogo por skuId con cursor opaco y sin metadatos internos", async () => {
    const current = setup();
    current.rpc.mockResolvedValueOnce({
      data: { hasMore: true, items: [projection], publicationId: PUBLICATION_ID },
      error: null,
    });
    const first = await handleShoppingCatalog(
      request("/v1/catalogs?chain=mercadona&limit=1"),
      current.dependencies,
    );
    const page = (await first.json()) as { nextCursor: string };
    expect(first.status).toBe(200);
    expect(page.nextCursor).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(JSON.stringify(page)).not.toMatch(/manifest|R2|Sevilla|stock|availability/i);

    const second = await handleShoppingCatalog(
      request(`/v1/catalogs?chain=mercadona&limit=1&cursor=${page.nextCursor}`),
      current.dependencies,
    );
    expect(second.status).toBe(200);
    expect(current.calls.at(-1)?.args).toMatchObject({
      p_cursor_publication_id: PUBLICATION_ID,
      p_cursor_sku_id: SKU_ID,
      p_limit: 1,
    });
  });

  it("limita catálogo a 50 por defecto, 100 máximo y rechaza cursor obsoleto", async () => {
    const current = setup();
    await handleShoppingCatalog(
      request("/v1/catalogs?chain=mercadona"),
      current.dependencies,
    );
    expect(current.calls[0]?.args.p_limit).toBe(50);

    const invalidLimit = await handleShoppingCatalog(
      request("/v1/catalogs?chain=mercadona&limit=101"),
      current.dependencies,
    );
    expect(invalidLimit.status).toBe(422);

    const stale = setup({ rpcError: { message: "stale_catalog_cursor" } });
    const cursor = btoa(
      JSON.stringify({ publicationId: PUBLICATION_ID, skuId: SKU_ID, v: 1 }),
    )
      .replaceAll("+", "-")
      .replaceAll("/", "_")
      .replace(/=+$/, "");
    const response = await handleShoppingCatalog(
      request(`/v1/catalogs?chain=mercadona&cursor=${cursor}`),
      stale.dependencies,
    );
    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "INVALID_INPUT" },
    });
  });

  it("rechaza la quinta lectura concurrente del isolate y siempre libera slots", async () => {
    let release: (() => void) | undefined;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const current = setup();
    const delayedRpc = vi.fn(async () => {
      await pending;
      return {
        data: { hasMore: false, items: [projection], publicationId: PUBLICATION_ID },
        error: null,
      };
    });
    current.dependencies.rpc = delayedRpc;
    const firstFour = Array.from({ length: 4 }, () =>
      handleShoppingCatalog(
        request("/v1/catalogs?chain=mercadona"),
        current.dependencies,
      ),
    );
    await vi.waitFor(() => expect(delayedRpc).toHaveBeenCalledTimes(4));
    const fifth = await handleShoppingCatalog(
      request("/v1/catalogs?chain=mercadona"),
      current.dependencies,
    );
    expect(fifth.status).toBe(429);
    release?.();
    await Promise.all(firstFour);
    const afterRelease = await handleShoppingCatalog(
      request("/v1/catalogs?chain=mercadona"),
      current.dependencies,
    );
    expect(afterRelease.status).toBe(200);
  });

  it("construye el input solo desde RPC, llama una vez al resolver y persiste validado", async () => {
    const current = setup();
    const response = await handleShoppingCatalog(
      request(`/v1/plans/${PLAN_VERSION_ID}/shopping`, {
        body: { preferenceRevisionId: PREFERENCE_ID, schemaVersion: 1 },
        method: "POST",
      }),
      current.dependencies,
    );

    expect(response.status).toBe(200);
    expect(current.resolve).toHaveBeenCalledTimes(1);
    expect(current.resolvedInputs[0]).toMatchObject({
      basketSeedRevisionId: SEED_ID,
      catalogItems: source.catalogItems,
      planVersionId: PLAN_VERSION_ID,
      profileId: PROFILE_ID,
      resolutionMetadata: {
        createdBy: ACTOR_ID,
        id: SNAPSHOT_ID,
        itemIds: [{ shoppingItemId: ITEM_ID }],
        revision: 1,
      },
      shoppingList: source.shoppingList,
    });
    expect(current.calls.map(({ name }) => name)).toEqual([
      "internal_prepare_shopping_resolution",
      "internal_persist_shopping_resolution",
    ]);
    expect(current.calls[1]?.args.p_snapshot).toMatchObject({
      id: SNAPSHOT_ID,
      resolverVersion: "shopping-resolver-v2",
    });
    expect(JSON.stringify(current.calls)).not.toContain("203.0.113.20");
  });

  it("rechaza inyección de líneas, precios o publicaciones desde el cliente", async () => {
    const current = setup();
    const response = await handleShoppingCatalog(
      request(`/v1/plans/${PLAN_VERSION_ID}/shopping`, {
        body: {
          catalogPublicationIds: [PUBLICATION_ID],
          preferenceRevisionId: PREFERENCE_ID,
          schemaVersion: 1,
          shoppingList: source.shoppingList,
        },
        method: "POST",
      }),
      current.dependencies,
    );
    expect(response.status).toBe(422);
    expect(current.rpc).not.toHaveBeenCalled();
    expect(current.resolve).not.toHaveBeenCalled();
  });

  it("reproduce el ACK sin resolver cuando PostgreSQL encuentra un replay", async () => {
    const current = setup({
      prepare: {
        replay: true,
        response: {
          schemaVersion: 1,
          snapshotId: SNAPSHOT_ID,
          status: "active",
          version: 1,
        },
      },
    });
    const response = await handleShoppingCatalog(
      request(`/v1/plans/${PLAN_VERSION_ID}/shopping`, {
        body: { preferenceRevisionId: PREFERENCE_ID, schemaVersion: 1 },
        method: "POST",
      }),
      current.dependencies,
    );
    expect(response.status).toBe(200);
    expect(current.resolve).not.toHaveBeenCalled();
    expect(current.calls.map(({ name }) => name)).toEqual([
      "internal_prepare_shopping_resolution",
    ]);
  });

  it("permite que PostgreSQL reproduzca una mutación cuya base ya fue archivada", async () => {
    const archivedEnvelope = {
      ...envelope,
      lifecycle: {
        archivedAt: "2026-07-23T09:01:00.000Z",
        status: "archived" as const,
      },
    };
    const current = setup({
      prepare: {
        replay: true,
        response: {
          schemaVersion: 1,
          snapshotId: SNAPSHOT_ID,
          status: "active",
          version: 2,
        },
      },
      snapshot: archivedEnvelope,
    });
    const response = await handleShoppingCatalog(
      request(`/v1/shopping/${SNAPSHOT_ID}/leftovers`, {
        body: {
          action: "clear",
          canonicalFoodKey: "food:test.chicken",
          expectedVersion: 1,
          schemaVersion: 1,
        },
        method: "POST",
      }),
      current.dependencies,
    );
    expect(response.status).toBe(200);
    expect(current.resolve).not.toHaveBeenCalled();
    expect(current.calls.map(({ name }) => name)).toEqual([
      "internal_get_shopping_snapshot",
      "internal_prepare_shopping_resolution",
    ]);
  });

  it("valida fuente y snapshot antes de persistir", async () => {
    const badSource = setup({
      prepare: { replay: false, source: { ...source, shoppingList: [] } },
    });
    const invalidInput = await handleShoppingCatalog(
      request(`/v1/plans/${PLAN_VERSION_ID}/shopping`, {
        body: { preferenceRevisionId: PREFERENCE_ID, schemaVersion: 1 },
        method: "POST",
      }),
      badSource.dependencies,
    );
    expect(invalidInput.status).toBe(503);
    expect(badSource.resolve).not.toHaveBeenCalled();

    const badSnapshot = setup();
    badSnapshot.dependencies.resolveShopping = vi.fn().mockResolvedValue({});
    const invalidOutput = await handleShoppingCatalog(
      request(`/v1/plans/${PLAN_VERSION_ID}/shopping`, {
        body: { preferenceRevisionId: PREFERENCE_ID, schemaVersion: 1 },
        method: "POST",
      }),
      badSnapshot.dependencies,
    );
    expect(invalidOutput.status).toBe(503);
    expect(badSnapshot.calls.map(({ name }) => name)).not.toContain(
      "internal_persist_shopping_resolution",
    );
  });

  it("devuelve snapshots históricos sin recalcular", async () => {
    const current = setup();
    const response = await handleShoppingCatalog(
      request(`/v1/shopping/${SNAPSHOT_ID}`),
      current.dependencies,
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(envelope);
    expect(current.resolve).not.toHaveBeenCalled();
  });

  it.each([
    [
      "leftovers",
      {
        action: "set",
        canonicalFoodKey: "food:test.chicken",
        declaredMeasure: { dimension: "mass", quantity: "100", unit: "g" },
        expectedVersion: 1,
        schemaVersion: 1,
      },
      "shopping-leftover-set",
    ],
    [
      "leftovers",
      {
        action: "clear",
        canonicalFoodKey: "food:test.chicken",
        expectedVersion: 1,
        schemaVersion: 1,
      },
      "shopping-leftover-set",
    ],
    [
      "product-selection",
      {
        canonicalFoodKey: "food:test.chicken",
        expectedVersion: 1,
        schemaVersion: 1,
        skuId: SKU_ID,
      },
      "shopping-product-select",
    ],
  ] as const)("procesa la mutación controlada %s", async (path, body, operation) => {
    const current = setup();
    const response = await handleShoppingCatalog(
      request(`/v1/shopping/${SNAPSHOT_ID}/${path}`, {
        body,
        method: "POST",
      }),
      current.dependencies,
    );
    expect(response.status).toBe(200);
    expect(current.calls.map(({ name }) => name)).toEqual([
      "internal_get_shopping_snapshot",
      "internal_prepare_shopping_resolution",
      "internal_persist_shopping_resolution",
    ]);
    expect(current.calls[1]?.args).toMatchObject({
      p_base_snapshot_id: SNAPSHOT_ID,
      p_mutation: body,
      p_operation: operation,
      p_plan_version_id: PLAN_VERSION_ID,
    });
  });

  it("corta cuerpos por encima de 16 KiB antes del RPC", async () => {
    const current = setup();
    const response = await handleShoppingCatalog(
      request(`/v1/plans/${PLAN_VERSION_ID}/shopping`, {
        body: {
          preferenceRevisionId: PREFERENCE_ID,
          schemaVersion: 1,
          value: "x".repeat(17 * 1024),
        },
        method: "POST",
      }),
      current.dependencies,
    );
    expect(response.status).toBe(413);
    expect(current.rpc).not.toHaveBeenCalled();
  });

  it.each([
    ["stale_plan_version", 409, "STALE_PLAN_VERSION"],
    ["nutrition_module_required", 422, "NUTRITION_MODULE_REQUIRED"],
    ["active_basket_seed_required", 503, "DEPENDENCY_UNAVAILABLE"],
    ["catalog_not_published", 409, "CATALOG_NOT_PUBLISHED"],
    ["stale_shopping_snapshot", 409, "SHOPPING_SNAPSHOT_MISMATCH"],
    ["shopping_selection_not_calculable", 422, "SHOPPING_SKU_NOT_CALCULABLE"],
    ["shopping_sku_match_excluded", 422, "SHOPPING_SKU_MATCH_EXCLUDED"],
    ["shopping_sku_match_review_required", 422, "SHOPPING_SKU_MATCH_REVIEW_REQUIRED"],
    ["idempotency_key_reused", 409, "IDEMPOTENCY_KEY_REUSED"],
    ["shopping_profile_rate_limited", 429, "RATE_LIMITED"],
  ] as const)("mapea %s a HTTP estable", async (message, status, code) => {
    const current = setup({ rpcError: { message } });
    const response = await handleShoppingCatalog(
      request(`/v1/plans/${PLAN_VERSION_ID}/shopping`, {
        body: { preferenceRevisionId: PREFERENCE_ID, schemaVersion: 1 },
        method: "POST",
      }),
      current.dependencies,
    );
    expect(response.status).toBe(status);
    await expect(response.json()).resolves.toMatchObject({ error: { code } });
    if (status === 429) {
      expect(Number(response.headers.get("retry-after"))).toBeGreaterThanOrEqual(1);
      expect(Number(response.headers.get("retry-after"))).toBeLessThanOrEqual(3600);
    }
  });

  it("aplica cabeceras privadas a éxito y error", async () => {
    for (const current of [
      setup(),
      setup({ rpcError: { message: "catalog_not_published" } }),
    ]) {
      const response = await handleShoppingCatalog(
        request("/v1/catalogs?chain=mercadona"),
        current.dependencies,
      );
      expect(response.headers.get("cache-control")).toBe("no-store, private");
      expect(response.headers.get("referrer-policy")).toBe("no-referrer");
      expect(response.headers.get("x-content-type-options")).toBe("nosniff");
      expect(response.headers.get("vary")).toContain("Authorization");
    }
  });
});
