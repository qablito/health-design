import { readFile } from "node:fs/promises";

import { describe, expect, it, vi } from "vitest";

import {
  ShoppingResolutionInputSchema,
  type ShoppingResolutionInput,
} from "@health-design/contracts";
import {
  resolveShopping,
  SHOPPING_RESOLVER_VERSION,
} from "@health-design/engine/shopping";

const uuid = (value: number) =>
  `${String(value).padStart(8, "0")}-0000-4000-8000-000000000001`;

function input(): ShoppingResolutionInput {
  return ShoppingResolutionInputSchema.parse({
    basketSeedRevisionId: uuid(2),
    catalogItems: [
      {
        canonicalFoodKey: "food:rice-dry",
        matchState: "allowed",
        matchedEdiblePart: "dry_product",
        matchedFoodState: "raw",
        matchedPurchaseForm: "dry",
        projection: {
          basePriceEur: "1.5",
          categoryPath: ["Arroz"],
          chain: "mercadona",
          exclusionReasons: [],
          externalSku: "rice-b",
          formatText: "1 kg",
          gtin14: null,
          market: "ES",
          name: "Arroz redondo",
          normalizedPrice: { dimension: "mass", unit: "EUR/kg", value: "1.5" },
          package: {
            equivalenceEvidenceRef: null,
            equivalentEdibleMassG: null,
            saleMeasure: { dimension: "mass", quantity: "1000", unit: "g" },
          },
          purchaseForm: "dry",
          schemaVersion: 1,
          skuId: uuid(20),
          usability: "calculable",
        },
      },
      {
        canonicalFoodKey: "food:apple-raw",
        matchState: "exact",
        matchedEdiblePart: "whole_edible_product",
        matchedFoodState: "raw",
        matchedPurchaseForm: "fresh",
        projection: {
          basePriceEur: "2",
          categoryPath: ["Fruta"],
          chain: "mercadona",
          exclusionReasons: [],
          externalSku: "apple-a",
          formatText: "1 kg",
          gtin14: null,
          market: "ES",
          name: "Manzana",
          normalizedPrice: { dimension: "mass", unit: "EUR/kg", value: "2" },
          package: {
            equivalenceEvidenceRef: null,
            equivalentEdibleMassG: null,
            saleMeasure: { dimension: "mass", quantity: "1000", unit: "g" },
          },
          purchaseForm: "fresh",
          schemaVersion: 1,
          skuId: uuid(21),
          usability: "calculable",
        },
      },
    ],
    catalogPublicationIds: [uuid(31), uuid(30)],
    leftovers: [
      {
        canonicalFoodKey: "food:rice-dry",
        confirmedEquivalentG: "100",
        evidenceRef: "Confirmado",
      },
      {
        canonicalFoodKey: "food:apple-raw",
        confirmedEquivalentG: "50",
        evidenceRef: "Confirmado",
      },
    ],
    manualSelections: [
      { canonicalFoodKey: "food:rice-dry", skuId: uuid(20) },
      { canonicalFoodKey: "food:apple-raw", skuId: uuid(21) },
    ],
    planVersionId: uuid(4),
    preferenceRevision: {
      comparedChains: [],
      createdAt: "2026-07-22T10:00:00.000Z",
      createdBy: uuid(5),
      id: uuid(6),
      mode: "single",
      preferredChain: "mercadona",
      profileId: uuid(7),
      schemaVersion: 1,
      sorting: "name_asc",
      supersedesId: null,
      version: 2,
    },
    profileId: uuid(7),
    resolutionMetadata: {
      createdAt: "2026-07-22T11:00:00.000Z",
      createdBy: uuid(5),
      id: uuid(8),
      itemIds: [
        { canonicalFoodKey: "food:rice-dry", shoppingItemId: uuid(10) },
        { canonicalFoodKey: "food:apple-raw", shoppingItemId: uuid(9) },
      ],
      resolverVersion: SHOPPING_RESOLVER_VERSION,
      revision: 1,
      status: "active",
      supersedesId: null,
    },
    schemaVersion: 1,
    shoppingList: [
      {
        amountG: "500",
        canonicalFoodKey: "food:rice-dry",
        ediblePart: "dry_product",
        foodState: "raw",
        name: "Arroz",
        purchaseForm: "dry",
      },
      {
        amountG: "700",
        canonicalFoodKey: "food:apple-raw",
        ediblePart: "whole_edible_product",
        foodState: "raw",
        name: "Manzana",
        purchaseForm: "fresh",
      },
    ],
  });
}

const reverse = <T>(values: readonly T[]) => [...values].reverse();

describe("determinismo del resolver T17C", () => {
  it("produce el mismo snapshot al permutar todos los conjuntos semánticos", async () => {
    const original = input();
    const permuted = ShoppingResolutionInputSchema.parse({
      ...original,
      catalogItems: reverse(original.catalogItems),
      catalogPublicationIds: reverse(original.catalogPublicationIds),
      leftovers: reverse(original.leftovers),
      manualSelections: reverse(original.manualSelections),
      resolutionMetadata: {
        ...original.resolutionMetadata,
        itemIds: reverse(original.resolutionMetadata.itemIds),
      },
      shoppingList: reverse(original.shoppingList),
    });

    expect(await resolveShopping(permuted)).toEqual(await resolveShopping(original));
  });

  it("acepta objetos congelados y no modifica la entrada", async () => {
    const original = input();
    const before = structuredClone(original);
    Object.freeze(original.catalogItems);
    Object.freeze(original.catalogPublicationIds);
    Object.freeze(original.leftovers);
    Object.freeze(original.manualSelections);
    Object.freeze(original.shoppingList);
    Object.freeze(original);

    await expect(resolveShopping(original)).resolves.toBeDefined();
    expect(original).toEqual(before);
  });

  it("mantiene el digest lógico aunque cambie el sobre de persistencia", async () => {
    const firstInput = input();
    const secondInput = ShoppingResolutionInputSchema.parse({
      ...firstInput,
      resolutionMetadata: {
        ...firstInput.resolutionMetadata,
        createdAt: "2026-07-23T12:00:00.000Z",
        createdBy: uuid(50),
        id: uuid(51),
        itemIds: firstInput.resolutionMetadata.itemIds.map((item, index) => ({
          ...item,
          shoppingItemId: uuid(60 + index),
        })),
        revision: 4,
        status: "archived",
        supersedesId: uuid(52),
      },
    });

    const [first, second] = await Promise.all([
      resolveShopping(firstInput),
      resolveShopping(secondInput),
    ]);
    expect(second.inputDigest).toBe(first.inputDigest);
    expect(second.id).not.toBe(first.id);
  });

  it("normaliza Unicode de forma compatible con el hash canónico", async () => {
    const composed = input();
    const decomposed = ShoppingResolutionInputSchema.parse({
      ...composed,
      shoppingList: composed.shoppingList.map((line) => ({
        ...line,
        name: line.name.replace("Manzana", "Manzan\u0061\u0301"),
      })),
    });
    const normalized = ShoppingResolutionInputSchema.parse({
      ...decomposed,
      shoppingList: decomposed.shoppingList.map((line) => ({
        ...line,
        name: line.name.normalize("NFC"),
      })),
    });
    expect((await resolveShopping(decomposed)).inputDigest).toBe(
      (await resolveShopping(normalized)).inputDigest,
    );
  });

  it("no consulta reloj, aleatoriedad, red ni entorno", async () => {
    const dateNow = vi.spyOn(Date, "now").mockImplementation(() => {
      throw new Error("date_forbidden");
    });
    const random = vi.spyOn(Math, "random").mockImplementation(() => {
      throw new Error("random_forbidden");
    });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(() => Promise.reject(new Error("fetch_forbidden")));
    try {
      await expect(resolveShopping(input())).resolves.toBeDefined();
    } finally {
      dateNow.mockRestore();
      random.mockRestore();
      globalThis.fetch = originalFetch;
    }

    const source = await readFile(
      new URL("../packages/engine/src/shopping/index.ts", import.meta.url),
      "utf8",
    );
    expect(source).not.toMatch(
      /Date\.now|new Date|Math\.random|fetch\s*\(|process\.env/,
    );
  });
});
