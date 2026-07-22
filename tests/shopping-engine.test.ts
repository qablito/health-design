import { describe, expect, it } from "vitest";

import {
  ShoppingResolutionInputSchema,
  type CatalogSkuProjection,
  type ShoppingResolutionInput,
} from "@health-design/contracts";
import {
  resolveShopping,
  SHOPPING_RESOLVER_VERSION,
} from "@health-design/engine/shopping";

const uuid = (value: number) =>
  `${String(value).padStart(8, "0")}-0000-4000-8000-000000000001`;

type CatalogItem = ShoppingResolutionInput["catalogItems"][number];
type Package = NonNullable<CatalogSkuProjection["package"]>;

const massPackage = (quantity = "500"): Package => ({
  equivalenceEvidenceRef: null,
  equivalentEdibleMassG: null,
  saleMeasure: { dimension: "mass", quantity, unit: "g" },
});

function catalogItem({
  basePriceEur = "3.25",
  chain = "mercadona",
  externalSku = "sku-a",
  matchState = "exact",
  normalizedPrice = "6.5",
  package: confirmedPackage = massPackage(),
  sku = 20,
  usability,
}: {
  basePriceEur?: string | null;
  chain?: CatalogSkuProjection["chain"];
  externalSku?: string;
  matchState?: CatalogItem["matchState"];
  normalizedPrice?: string | null;
  package?: Package | null;
  sku?: number;
  usability?: CatalogSkuProjection["usability"];
} = {}): CatalogItem {
  const effectiveUsability =
    usability ??
    (basePriceEur !== null &&
    confirmedPackage !== null &&
    (confirmedPackage.saleMeasure.dimension === "mass" ||
      confirmedPackage.equivalentEdibleMassG !== null)
      ? "calculable"
      : "visible");
  const normalizedDimension = confirmedPackage?.saleMeasure.dimension ?? "mass";
  const normalizedUnit =
    normalizedDimension === "mass"
      ? "EUR/kg"
      : normalizedDimension === "volume"
        ? "EUR/L"
        : "EUR/unit";
  return {
    canonicalFoodKey: "food:chicken-breast-raw",
    matchState,
    matchedEdiblePart: "meat_without_skin",
    matchedFoodState: "raw",
    matchedPurchaseForm: "fresh",
    projection: {
      basePriceEur,
      categoryPath: ["Carne", "Pollo"],
      chain,
      exclusionReasons:
        basePriceEur === null
          ? ["base_price_missing"]
          : confirmedPackage === null
            ? ["package_unconfirmed"]
            : [],
      externalSku,
      formatText: confirmedPackage === null ? null : "Formato confirmado",
      gtin14: null,
      market: "ES",
      name: `Pechuga ${externalSku}`,
      normalizedPrice:
        normalizedPrice === null
          ? null
          : {
              dimension: normalizedDimension,
              unit: normalizedUnit,
              value: normalizedPrice,
            },
      package: confirmedPackage,
      purchaseForm: "fresh",
      schemaVersion: 1,
      skuId: uuid(sku),
      usability: effectiveUsability,
    } as CatalogSkuProjection,
  };
}

function input({
  amountG = "1000",
  catalogItems = [catalogItem()],
  leftoverG,
  manualSkuId,
}: {
  amountG?: string;
  catalogItems?: CatalogItem[];
  leftoverG?: string;
  manualSkuId?: string;
} = {}): ShoppingResolutionInput {
  return ShoppingResolutionInputSchema.parse({
    basketSeedRevisionId: uuid(2),
    catalogItems,
    catalogPublicationIds: [uuid(3)],
    leftovers:
      leftoverG === undefined
        ? []
        : [
            {
              canonicalFoodKey: "food:chicken-breast-raw",
              confirmedEquivalentG: leftoverG,
              evidenceRef: "Confirmado por la persona",
            },
          ],
    manualSelections:
      manualSkuId === undefined
        ? []
        : [
            {
              canonicalFoodKey: "food:chicken-breast-raw",
              skuId: manualSkuId,
            },
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
      sorting: "normalized_price_asc",
      supersedesId: null,
      version: 1,
    },
    profileId: uuid(7),
    resolutionMetadata: {
      createdAt: "2026-07-22T11:00:00.000Z",
      createdBy: uuid(5),
      id: uuid(8),
      itemIds: [
        {
          canonicalFoodKey: "food:chicken-breast-raw",
          shoppingItemId: uuid(9),
        },
      ],
      resolverVersion: SHOPPING_RESOLVER_VERSION,
      revision: 1,
      status: "active",
      supersedesId: null,
    },
    schemaVersion: 1,
    shoppingList: [
      {
        amountG,
        canonicalFoodKey: "food:chicken-breast-raw",
        ediblePart: "meat_without_skin",
        foodState: "raw",
        name: "Pechuga de pollo",
        purchaseForm: "fresh",
      },
    ],
  });
}

describe("resolver puro de compra T17C.1", () => {
  it("calcula envases completos, coste y remanente con decimal exacto", async () => {
    const snapshot = await resolveShopping(input());
    expect(snapshot.items[0]?.selected).toMatchObject({
      estimatedRemainderG: "0",
      packageCount: "2",
      requiredAfterLeftoverG: "1000",
      totalCostEur: "6.5",
    });
    expect(snapshot.totals).toEqual({
      coverage: { resolvedItems: 1, totalItems: 1 },
      estimatedTotalEur: "6.5",
      kind: "complete",
      resolvedItems: 1,
      unresolvedItems: 0,
    });
  });

  it("descuenta únicamente el sobrante confirmado y nunca reutiliza remanentes", async () => {
    const snapshot = await resolveShopping(input({ leftoverG: "100" }));
    expect(snapshot.items[0]?.selected).toMatchObject({
      estimatedRemainderG: "100",
      packageCount: "2",
      requiredAfterLeftoverG: "900",
      totalCostEur: "6.5",
    });
  });

  it("produce cero envases, coste y remanente cuando el sobrante cubre la necesidad", async () => {
    for (const leftoverG of ["1000", "1200"]) {
      const snapshot = await resolveShopping(input({ leftoverG }));
      expect(snapshot.items[0]?.selected).toMatchObject({
        estimatedRemainderG: "0",
        packageCount: "0",
        requiredAfterLeftoverG: "0",
        totalCostEur: "0",
      });
    }
  });

  it("acepta volumen únicamente con equivalencia comestible confirmada", async () => {
    const confirmedVolume: Package = {
      equivalenceEvidenceRef: "Etiqueta confirmada",
      equivalentEdibleMassG: "720",
      saleMeasure: { dimension: "volume", quantity: "750", unit: "ml" },
    };
    const confirmed = await resolveShopping(
      input({
        catalogItems: [
          catalogItem({
            basePriceEur: "2",
            normalizedPrice: "2.666666",
            package: confirmedVolume,
          }),
        ],
      }),
    );
    expect(confirmed.items[0]?.selected).toMatchObject({
      estimatedRemainderG: "440",
      packageCount: "2",
      totalCostEur: "4",
    });

    const unconfirmed = await resolveShopping(
      input({
        catalogItems: [
          catalogItem({
            basePriceEur: "2",
            normalizedPrice: "2.666666",
            package: {
              equivalenceEvidenceRef: null,
              equivalentEdibleMassG: null,
              saleMeasure: { dimension: "volume", quantity: "750", unit: "ml" },
            },
          }),
        ],
      }),
    );
    expect(unconfirmed.items[0]).toMatchObject({
      selected: null,
      state: "package_unconfirmed",
      uncertainties: ["shopping_package_unconfirmed"],
    });
  });

  it.each([
    [
      "precio desconocido",
      catalogItem({ basePriceEur: null, normalizedPrice: null }),
      "price_unavailable",
      "shopping_price_unavailable",
    ],
    [
      "paquete desconocido",
      catalogItem({ package: null, normalizedPrice: null }),
      "package_unconfirmed",
      "shopping_package_unconfirmed",
    ],
  ])(
    "mantiene %s como pendiente y nunca lo convierte en cero",
    async (_, item, state, code) => {
      const snapshot = await resolveShopping(input({ catalogItems: [item] }));
      expect(snapshot.items[0]).toMatchObject({
        selected: null,
        state,
        uncertainties: [code],
      });
      expect(snapshot.totals).toEqual({
        coverage: { resolvedItems: 0, totalItems: 1 },
        kind: "partial",
        partialSubtotalEur: "0",
        resolvedItems: 0,
        unresolvedItems: 1,
      });
      expect(snapshot.totals).not.toHaveProperty("estimatedTotalEur");
    },
  );

  it("produce no_confirmed_product sin matching activo compatible", async () => {
    const snapshot = await resolveShopping(input({ catalogItems: [] }));
    expect(snapshot.items[0]).toMatchObject({
      selected: null,
      state: "no_confirmed_product",
      uncertainties: ["shopping_sku_missing"],
    });
  });

  it("nunca selecciona review, excluded ni insufficient", async () => {
    const catalogItems = (["review", "excluded", "insufficient"] as const).map(
      (matchState, index) =>
        catalogItem({
          externalSku: `sku-${matchState}`,
          matchState,
          sku: 30 + index,
        }),
    );
    const snapshot = await resolveShopping(input({ catalogItems }));
    expect(snapshot.items[0]?.state).toBe("no_confirmed_product");
  });

  it("aplica coste, remanente, precio comparable e identidad como desempates", async () => {
    const cheaper = catalogItem({
      basePriceEur: "3",
      externalSku: "sku-cheaper",
      normalizedPrice: "6",
      sku: 31,
    });
    expect(
      (
        await resolveShopping(
          input({ catalogItems: [catalogItem({ sku: 32 }), cheaper] }),
        )
      ).items[0]?.selected?.projection.externalSku,
    ).toBe("sku-cheaper");

    const lessRemainder = catalogItem({ externalSku: "sku-less-remainder", sku: 33 });
    const moreRemainder = catalogItem({
      externalSku: "sku-more-remainder",
      normalizedPrice: "5.416666",
      package: massPackage("600"),
      sku: 34,
    });
    expect(
      (await resolveShopping(input({ catalogItems: [moreRemainder, lessRemainder] })))
        .items[0]?.selected?.projection.externalSku,
    ).toBe("sku-less-remainder");

    const lowerComparablePrice = catalogItem({
      basePriceEur: "5",
      externalSku: "sku-low-normalized",
      normalizedPrice: "5",
      package: {
        equivalenceEvidenceRef: "Densidad confirmada A",
        equivalentEdibleMassG: "1000",
        saleMeasure: { dimension: "volume", quantity: "1000", unit: "ml" },
      },
      sku: 35,
    });
    const higherComparablePrice = catalogItem({
      basePriceEur: "5",
      externalSku: "sku-high-normalized",
      normalizedPrice: "6.25",
      package: {
        equivalenceEvidenceRef: "Densidad confirmada B",
        equivalentEdibleMassG: "1000",
        saleMeasure: { dimension: "volume", quantity: "800", unit: "ml" },
      },
      sku: 36,
    });
    expect(
      (
        await resolveShopping(
          input({ catalogItems: [higherComparablePrice, lowerComparablePrice] }),
        )
      ).items[0]?.selected?.projection.externalSku,
    ).toBe("sku-low-normalized");

    const identityA = catalogItem({ externalSku: "sku-a", sku: 37 });
    const identityZ = catalogItem({ externalSku: "sku-z", sku: 38 });
    expect(
      (await resolveShopping(input({ catalogItems: [identityZ, identityA] }))).items[0]
        ?.selected?.projection.externalSku,
    ).toBe("sku-a");
  });

  it("omite el precio normalizado cuando las dimensiones no son comparables", async () => {
    const mass = catalogItem({
      basePriceEur: "5",
      externalSku: "sku-a-mass",
      normalizedPrice: "10",
      package: massPackage("1000"),
      sku: 40,
    });
    const volume = catalogItem({
      basePriceEur: "5",
      externalSku: "sku-z-volume",
      normalizedPrice: "1",
      package: {
        equivalenceEvidenceRef: "Equivalencia confirmada",
        equivalentEdibleMassG: "1000",
        saleMeasure: { dimension: "volume", quantity: "1000", unit: "ml" },
      },
      sku: 41,
    });
    const snapshot = await resolveShopping(input({ catalogItems: [volume, mass] }));
    expect(snapshot.items[0]?.selected?.projection.externalSku).toBe("sku-a-mass");
  });

  it("ordena alternativas normalizadas comparables antes de las incomparables", async () => {
    const selected = catalogItem({
      basePriceEur: "2",
      externalSku: "selected",
      normalizedPrice: "4",
      sku: 44,
    });
    const massA = catalogItem({
      basePriceEur: "5",
      externalSku: "z-mass",
      normalizedPrice: "5",
      package: massPackage("1000"),
      sku: 45,
    });
    const massB = catalogItem({
      basePriceEur: "5",
      externalSku: "y-mass",
      normalizedPrice: "6",
      package: massPackage("1000"),
      sku: 46,
    });
    const volume = catalogItem({
      basePriceEur: "5",
      externalSku: "a-volume",
      normalizedPrice: "1",
      package: {
        equivalenceEvidenceRef: "Equivalencia confirmada",
        equivalentEdibleMassG: "1000",
        saleMeasure: { dimension: "volume", quantity: "1000", unit: "ml" },
      },
      sku: 47,
    });
    const withoutNormalized = catalogItem({
      basePriceEur: "5",
      externalSku: "b-without-normalized",
      normalizedPrice: null,
      package: massPackage("1000"),
      sku: 48,
    });

    const snapshot = await resolveShopping(
      input({ catalogItems: [volume, massB, withoutNormalized, selected, massA] }),
    );
    expect(
      snapshot.items[0]?.alternatives.map((alternative) =>
        alternative.state === "resolved"
          ? alternative.selection.projection.externalSku
          : alternative.projection.externalSku,
      ),
    ).toEqual(["z-mass", "y-mass", "a-volume", "b-without-normalized"]);
  });

  it("desempata SKU pendientes equivalentes mediante skuId", async () => {
    const higher = catalogItem({
      externalSku: "same-external-sku",
      normalizedPrice: null,
      package: null,
      sku: 71,
    });
    const lower = catalogItem({
      externalSku: "same-external-sku",
      normalizedPrice: null,
      package: null,
      sku: 70,
    });
    const snapshot = await resolveShopping(input({ catalogItems: [higher, lower] }));
    expect(
      snapshot.items[0]?.alternatives.map((alternative) =>
        alternative.state === "resolved"
          ? alternative.selection.projection.skuId
          : alternative.projection.skuId,
      ),
    ).toEqual([uuid(70), uuid(71)]);
  });

  it("mantiene una selección manual válida aunque sea más cara", async () => {
    const cheap = catalogItem({
      basePriceEur: "2",
      externalSku: "sku-cheap",
      normalizedPrice: "4",
      sku: 42,
    });
    const manual = catalogItem({
      basePriceEur: "4",
      externalSku: "sku-manual",
      normalizedPrice: "8",
      sku: 43,
    });
    const snapshot = await resolveShopping(
      input({ catalogItems: [cheap, manual], manualSkuId: manual.projection.skuId }),
    );
    expect(snapshot.items[0]?.selected).toMatchObject({
      packageCount: "2",
      totalCostEur: "8",
    });
    expect(snapshot.items[0]?.selected?.projection.externalSku).toBe("sku-manual");
  });

  it("deja pendiente una selección manual obsoleta sin sustituirla", async () => {
    const snapshot = await resolveShopping(input({ manualSkuId: uuid(99) }));
    expect(snapshot.items[0]).toMatchObject({
      selected: null,
      state: "no_confirmed_product",
      uncertainties: ["shopping_manual_selection_stale"],
    });
  });

  it("mantiene exactitud con cantidades decimales grandes", async () => {
    const snapshot = await resolveShopping(
      input({
        amountG: "999999999999999999.9",
        catalogItems: [
          catalogItem({
            basePriceEur: "0.01",
            normalizedPrice: "0.02",
            package: massPackage("500"),
          }),
        ],
      }),
    );
    expect(snapshot.items[0]?.selected).toMatchObject({
      estimatedRemainderG: "0.1",
      packageCount: "2000000000000000",
      totalCostEur: "20000000000000",
    });
  });
});
