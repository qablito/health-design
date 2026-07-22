import { describe, expect, it } from "vitest";

import {
  ShoppingResolutionInputSchema,
  type CatalogSkuProjection,
  type ShoppingResolutionInput,
  type ShoppingSort,
  type SupermarketChain,
} from "@health-design/contracts";
import {
  resolveShopping,
  SHOPPING_RESOLVER_VERSION,
} from "@health-design/engine/shopping";

const uuid = (value: number) =>
  `${String(value).padStart(8, "0")}-0000-4000-8000-000000000001`;

type CatalogItem = ShoppingResolutionInput["catalogItems"][number];
type ShoppingLine = ShoppingResolutionInput["shoppingList"][number];

function line(key: string, name: string, amountG = "1000"): ShoppingLine {
  return {
    amountG,
    canonicalFoodKey: `food:${key}`,
    name,
    purchaseContext: {
      ediblePart: "whole_edible_product",
      foodState: "raw",
      purchaseForm: "fresh",
    },
  };
}

function catalogItem(
  food: ShoppingLine,
  chain: SupermarketChain,
  basePriceEur: string,
  sku: number,
  options: {
    normalizedPrice?: string | null;
    packageG?: string;
  } = {},
): CatalogItem {
  const packageG = options.packageG ?? "500";
  return {
    canonicalFoodKey: food.canonicalFoodKey,
    matchState: "exact",
    matchedEdiblePart: food.purchaseContext!.ediblePart,
    matchedFoodState: food.purchaseContext!.foodState,
    matchedPurchaseForm: food.purchaseContext!.purchaseForm,
    projection: {
      basePriceEur,
      categoryPath: ["Fixture"],
      chain,
      exclusionReasons: [],
      externalSku: `${food.canonicalFoodKey}-${chain}-${sku}`,
      formatText: `${packageG} g`,
      gtin14: null,
      market: "ES",
      name: `${food.name} ${chain}`,
      normalizedPrice:
        options.normalizedPrice === null
          ? null
          : {
              dimension: "mass",
              unit: "EUR/kg",
              value: options.normalizedPrice ?? basePriceEur,
            },
      package: {
        equivalenceEvidenceRef: null,
        equivalentEdibleMassG: null,
        saleMeasure: { dimension: "mass", quantity: packageG, unit: "g" },
      },
      purchaseForm: food.purchaseContext!.purchaseForm,
      schemaVersion: 1,
      skuId: uuid(sku),
      usability: "calculable",
    } satisfies CatalogSkuProjection,
  };
}

function input({
  catalogItems,
  comparedChains = [],
  lines,
  manualSelections = [],
  mode = "single",
  preferredChain = "mercadona",
  sorting = "name_asc",
}: {
  catalogItems: CatalogItem[];
  comparedChains?: SupermarketChain[];
  lines: ShoppingLine[];
  manualSelections?: ShoppingResolutionInput["manualSelections"];
  mode?: "single" | "multistore";
  preferredChain?: SupermarketChain;
  sorting?: ShoppingSort;
}): ShoppingResolutionInput {
  return ShoppingResolutionInputSchema.parse({
    basketSeedRevisionId: uuid(2),
    catalogItems,
    catalogPublicationIds: [uuid(3), uuid(4), uuid(5)],
    leftovers: [],
    manualSelections,
    planVersionId: uuid(6),
    preferenceRevision: {
      comparedChains,
      createdAt: "2026-07-22T10:00:00.000Z",
      createdBy: uuid(7),
      id: uuid(8),
      mode,
      preferredChain,
      profileId: uuid(9),
      schemaVersion: 1,
      sorting,
      supersedesId: null,
      version: 1,
    },
    profileId: uuid(9),
    resolutionMetadata: {
      createdAt: "2026-07-22T11:00:00.000Z",
      createdBy: uuid(7),
      id: uuid(10),
      itemIds: [...lines]
        .sort((left, right) =>
          left.canonicalFoodKey.localeCompare(right.canonicalFoodKey),
        )
        .map((food, index) => ({
          canonicalFoodKey: food.canonicalFoodKey,
          shoppingItemId: uuid(100 + index),
        })),
      resolverVersion: SHOPPING_RESOLVER_VERSION,
      revision: 1,
      supersedesId: null,
    },
    schemaVersion: 1,
    shoppingList: lines,
  });
}

describe("tienda única y comparación T17C.2", () => {
  it("compara universos automáticos equivalentes sin sustituir la selección manual", async () => {
    const apple = line("apple", "Manzana");
    const automatic = catalogItem(apple, "mercadona", "2", 15);
    const manual = catalogItem(apple, "mercadona", "4", 16);
    const dia = catalogItem(apple, "dia", "1.5", 17);
    const snapshot = await resolveShopping(
      input({
        catalogItems: [manual, dia, automatic],
        lines: [apple],
        manualSelections: [
          { canonicalFoodKey: apple.canonicalFoodKey, skuId: manual.projection.skuId },
        ],
      }),
    );

    expect(snapshot.items[0]?.selected?.projection.skuId).toBe(
      manual.projection.skuId,
    );
    expect(snapshot.comparison).toMatchObject({
      basis: "automatic_equivalent",
      baselineSubtotalEur: "4",
      candidateSubtotalEur: "3",
      savingsEur: "1",
    });
  });

  it("conserva la tienda habitual y avisa de un ahorro completo de 0,01 EUR", async () => {
    const apple = line("apple", "Manzana");
    const snapshot = await resolveShopping(
      input({
        catalogItems: [
          catalogItem(apple, "mercadona", "3.26", 20, {
            normalizedPrice: "6.52",
          }),
          catalogItem(apple, "dia", "3.255", 21, {
            normalizedPrice: "6.51",
          }),
        ],
        lines: [apple],
      }),
    );

    expect(snapshot.items[0]?.selected?.projection.chain).toBe("mercadona");
    expect(snapshot.totals).toMatchObject({ estimatedTotalEur: "6.52" });
    expect(snapshot.comparison).toEqual({
      basis: "automatic_equivalent",
      baselineChains: ["mercadona"],
      baselineSubtotalEur: "6.52",
      candidateChains: ["dia"],
      candidateKind: "chain",
      candidateSubtotalEur: "6.51",
      comparableItems: 1,
      savingsEur: "0.01",
      scope: "complete",
      totalItems: 1,
    });
  });

  it("mantiene pendientes de la tienda habitual y solo expone comparación parcial", async () => {
    const apple = line("apple", "Manzana");
    const banana = line("banana", "Plátano");
    const snapshot = await resolveShopping(
      input({
        catalogItems: [
          catalogItem(apple, "mercadona", "4", 22),
          catalogItem(apple, "dia", "3.5", 23),
          catalogItem(banana, "dia", "2", 24),
        ],
        lines: [banana, apple],
      }),
    );

    expect(snapshot.items.map(({ state }) => state)).toEqual([
      "resolved",
      "no_confirmed_product",
    ]);
    expect(snapshot.items[0]?.selected?.projection.chain).toBe("mercadona");
    expect(snapshot.comparison).toEqual({
      basis: "automatic_equivalent",
      baselineChains: ["mercadona"],
      baselineSubtotalEur: "8",
      candidateChains: ["dia"],
      candidateKind: "chain",
      candidateSubtotalEur: "7",
      comparableItems: 1,
      savingsEur: null,
      scope: "partial",
      totalItems: 2,
    });
    expect(snapshot.totals).toEqual({
      coverage: { resolvedItems: 1, totalItems: 2 },
      kind: "partial",
      partialSubtotalEur: "8",
      resolvedItems: 1,
      unresolvedItems: 1,
    });
  });
});

describe("multiestablecimiento T17C.2", () => {
  it("usa solo cadenas seleccionadas, sin penalizar paradas y agrupando la habitual primero", async () => {
    const apple = line("apple", "Manzana");
    const banana = line("banana", "Plátano");
    const carrot = line("carrot", "Zanahoria");
    const lines = [carrot, apple, banana];
    const catalogItems = [
      catalogItem(apple, "mercadona", "3", 30),
      catalogItem(apple, "dia", "2.5", 31),
      catalogItem(apple, "aldi", "0.5", 32),
      catalogItem(banana, "mercadona", "2", 33),
      catalogItem(banana, "dia", "2.5", 34),
      catalogItem(banana, "aldi", "0.5", 35),
      catalogItem(carrot, "mercadona", "4", 36),
      catalogItem(carrot, "dia", "3.5", 37),
      catalogItem(carrot, "aldi", "0.5", 38),
    ];
    const snapshot = await resolveShopping(
      input({
        catalogItems,
        comparedChains: ["dia", "mercadona"],
        lines,
        mode: "multistore",
      }),
    );

    expect(
      snapshot.items.map(({ canonicalFoodKey, selected }) => ({
        chain: selected?.projection.chain,
        food: canonicalFoodKey,
      })),
    ).toEqual([
      { chain: "mercadona", food: "food:banana" },
      { chain: "dia", food: "food:apple" },
      { chain: "dia", food: "food:carrot" },
    ]);
    expect(
      snapshot.items.every(({ selected }) => selected?.projection.chain !== "aldi"),
    ).toBe(true);
    expect(snapshot.totals).toMatchObject({ estimatedTotalEur: "16" });
    expect(snapshot.comparison).toEqual({
      basis: "automatic_equivalent",
      baselineChains: ["mercadona"],
      baselineSubtotalEur: "18",
      candidateChains: ["dia", "mercadona"],
      candidateKind: "multistore",
      candidateSubtotalEur: "16",
      comparableItems: 3,
      savingsEur: "2",
      scope: "complete",
      totalItems: 3,
    });
  });

  it("conserva todas las líneas en una cesta parcial y coloca pendientes al final", async () => {
    const apple = line("apple", "Manzana");
    const banana = line("banana", "Plátano");
    const snapshot = await resolveShopping(
      input({
        catalogItems: [catalogItem(apple, "dia", "2", 40)],
        comparedChains: ["mercadona", "dia"],
        lines: [banana, apple],
        mode: "multistore",
      }),
    );
    expect(snapshot.items.map(({ canonicalFoodKey }) => canonicalFoodKey)).toEqual([
      "food:apple",
      "food:banana",
    ]);
    expect(snapshot.totals.resolvedItems + snapshot.totals.unresolvedItems).toBe(
      snapshot.items.length,
    );
    expect(snapshot.totals).toMatchObject({
      kind: "partial",
      partialSubtotalEur: "4",
    });
    expect(snapshot.totals).not.toHaveProperty("estimatedTotalEur");
  });
});

describe("orden de presentación congelado en el snapshot", () => {
  const apple = line("apple", "Árbol");
  const banana = line("banana", "Banana");
  const carrot = line("carrot", "Calabaza");
  const catalogItems = [
    catalogItem(apple, "mercadona", "3", 50, {
      normalizedPrice: null,
      packageG: "500",
    }),
    catalogItem(banana, "mercadona", "5", 51, {
      normalizedPrice: "2",
      packageG: "1000",
    }),
    catalogItem(carrot, "mercadona", "2", 52, {
      normalizedPrice: "1",
      packageG: "500",
    }),
  ];

  it.each([
    ["normalized_price_asc", ["food:carrot", "food:banana", "food:apple"]],
    ["price_asc", ["food:carrot", "food:banana", "food:apple"]],
    ["price_desc", ["food:apple", "food:banana", "food:carrot"]],
    ["name_asc", ["food:banana", "food:carrot", "food:apple"]],
    ["name_desc", ["food:apple", "food:carrot", "food:banana"]],
  ] as const)("aplica %s con desempate estable", async (sorting, expected) => {
    const snapshot = await resolveShopping(
      input({ catalogItems, lines: [apple, carrot, banana], sorting }),
    );
    expect(snapshot.items.map(({ canonicalFoodKey }) => canonicalFoodKey)).toEqual(
      expected,
    );
  });

  it("normaliza nombres Unicode equivalentes y desempata por identidad", async () => {
    const composed = line("a-food", "Árbol");
    const decomposed = line("b-food", "A\u0301rbol");
    const first = await resolveShopping(
      input({
        catalogItems: [
          catalogItem(decomposed, "mercadona", "1", 60),
          catalogItem(composed, "mercadona", "1", 61),
        ],
        lines: [decomposed, composed],
        sorting: "name_asc",
      }),
    );
    const second = await resolveShopping(
      input({
        catalogItems: [
          catalogItem(composed, "mercadona", "1", 61),
          catalogItem(decomposed, "mercadona", "1", 60),
        ],
        lines: [composed, decomposed],
        sorting: "name_asc",
      }),
    );
    expect(second.items).toEqual(first.items);
    expect(first.items.map(({ canonicalFoodKey }) => canonicalFoodKey)).toEqual([
      "food:a-food",
      "food:b-food",
    ]);
  });
});
