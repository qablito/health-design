import { describe, expect, it } from "vitest";

import {
  CatalogCoverageSchema,
  CatalogSkuProjectionSchema,
  ConfirmedPackageSchema,
  SHOPPING_HTTP_BODY_BYTES,
  ShoppingLeftoverRequestSchema,
  ShoppingCatalogPageSchema,
  ShoppingLegacyPreferenceHintSchema,
  ShoppingMutationAckSchema,
  ShoppingPreferenceAckSchema,
  ShoppingPreferencePutSchema,
  ShoppingPreferenceReadResponseSchema,
  ShoppingPreferenceRevisionSchema,
  ShoppingProductSelectionRequestSchema,
  ShoppingResolutionInputSchema,
  ShoppingSnapshotSchema,
  ShoppingSnapshotResponseSchema,
  SupermarketSourceManifestSchema,
  SupermarketSourceRecordSchema,
} from "@health-design/contracts";

const uuid = (value: number) =>
  `${String(value).padStart(8, "0")}-0000-4000-8000-000000000001`;

const coverage = {
  dynamicRequired: 20,
  dynamicUsable: 18,
  fixedRequired: 60,
  fixedUsable: 54,
  groups: [
    { groupKey: "proteins", required: 10, usable: 8 },
    { groupKey: "vegetables", required: 10, usable: 8 },
  ],
  publishable: true,
  totalRequired: 80,
  totalUsable: 72,
} as const;

const confirmedPackage = {
  equivalenceEvidenceRef: null,
  equivalentEdibleMassG: null,
  saleMeasure: { dimension: "mass", quantity: "500", unit: "g" },
} as const;

const projection = {
  basePriceEur: "3.25",
  categoryPath: ["Carne", "Pollo"],
  chain: "mercadona",
  exclusionReasons: [],
  externalSku: "sku-123",
  formatText: "Bandeja 500 g",
  gtin14: "08412345678905",
  market: "ES",
  name: "Pechuga de pollo",
  normalizedPrice: { dimension: "mass", unit: "EUR/kg", value: "6.5" },
  package: confirmedPackage,
  purchaseForm: "fresh",
  schemaVersion: 1,
  skuId: uuid(1),
  usability: "calculable",
} as const;

const preference = {
  comparedChains: ["mercadona", "dia"],
  createdAt: "2026-07-21T10:00:00.000Z",
  createdBy: uuid(2),
  id: uuid(3),
  mode: "multistore",
  preferredChain: "mercadona",
  profileId: uuid(4),
  schemaVersion: 1,
  sorting: "normalized_price_asc",
  supersedesId: null,
  version: 1,
} as const;

describe("contratos T17 de catálogo de supermercado", () => {
  it("fija cadenas, mercado, hashes y evidencia interna en el manifest", () => {
    const manifest = {
      canonicalizationVersion: "supermarket-canonical-v1",
      captureEvidenceRef: "r2://opaque/capture",
      chain: "mercadona",
      collectedAt: "2026-07-16T12:00:00.000Z",
      coverage,
      createdAt: "2026-07-21T10:00:00.000Z",
      errorCount: 0,
      errorEvidenceRef: null,
      id: uuid(5),
      importerVersion: "supermarket-import-v1",
      licenseStatus: "restricted",
      market: "ES",
      normalizedObjectRef: "r2://opaque/normalized",
      normalizedSha256: "ab".repeat(32),
      priceCount: 4313,
      rawObjectRef: "r2://opaque/raw",
      rawSha256: "cd".repeat(32),
      recordCount: 4314,
      schemaVersion: 1,
      sourceKind: "csv_capture",
      sourceLocationInternal: "41006",
      sourceTermsStatus: "restricted",
    } as const;

    expect(SupermarketSourceManifestSchema.parse(manifest)).toEqual(manifest);
    expect(
      SupermarketSourceManifestSchema.safeParse({ ...manifest, market: "US" }).success,
    ).toBe(false);
    expect(
      SupermarketSourceManifestSchema.safeParse({ ...manifest, chain: "lidl" }).success,
    ).toBe(false);
  });

  it("mantiene la fila fuente en cuarentena y rechaza campos imprevistos", () => {
    const record = {
      basePriceEur: "3.25",
      captureErrorCode: null,
      captureStatus: "accepted",
      categoryPath: ["Carne", "Pollo"],
      chain: "mercadona",
      currency: "EUR",
      externalSku: "sku-123",
      formatText: "Bandeja 500 g",
      gtin14: "08412345678905",
      market: "ES",
      name: "Pechuga de pollo",
      package: confirmedPackage,
      purchaseForm: "fresh",
      schemaVersion: 1,
      sourceFields: { nombre: "Pechuga de pollo", precio: "3,25" },
      sourceRecordIndex: 42,
    } as const;

    expect(SupermarketSourceRecordSchema.parse(record)).toEqual(record);
    expect(
      SupermarketSourceRecordSchema.safeParse({ ...record, stock: true }).success,
    ).toBe(false);
    expect(
      SupermarketSourceRecordSchema.safeParse({ ...record, currency: "USD" }).success,
    ).toBe(false);
  });

  it("solo permite calcular volumen o unidades con equivalencia comestible evidenciada", () => {
    expect(ConfirmedPackageSchema.safeParse(confirmedPackage).success).toBe(true);
    expect(
      ConfirmedPackageSchema.safeParse({
        equivalenceEvidenceRef: null,
        equivalentEdibleMassG: null,
        saleMeasure: { dimension: "volume", quantity: "750", unit: "ml" },
      }).success,
    ).toBe(true);
    expect(
      ConfirmedPackageSchema.safeParse({
        equivalenceEvidenceRef: "Etiqueta confirmada",
        equivalentEdibleMassG: "720",
        saleMeasure: { dimension: "volume", quantity: "750", unit: "ml" },
      }).success,
    ).toBe(true);
    expect(
      ConfirmedPackageSchema.safeParse({
        equivalenceEvidenceRef: null,
        equivalentEdibleMassG: "720",
        saleMeasure: { dimension: "volume", quantity: "750", unit: "ml" },
      }).success,
    ).toBe(false);
    expect(
      ConfirmedPackageSchema.safeParse({
        ...confirmedPackage,
        saleMeasure: { dimension: "mass", quantity: "0", unit: "g" },
      }).success,
    ).toBe(false);
  });

  it("expone SKU sin nutrición, stock, ubicación interna ni R2", () => {
    expect(CatalogSkuProjectionSchema.parse(projection)).toEqual(projection);
    for (const forbidden of [
      { stock: true },
      { available: true },
      { nutrition: {} },
      { kcal: "100" },
      { macros: {} },
      { sourceLocationInternal: "41006" },
      { rawObjectRef: "r2://opaque/raw" },
    ]) {
      expect(
        CatalogSkuProjectionSchema.safeParse({ ...projection, ...forbidden }).success,
      ).toBe(false);
    }
  });

  it("fija cobertura exacta 60 + 20 y coherencia del total", () => {
    expect(CatalogCoverageSchema.parse(coverage)).toEqual(coverage);
    expect(
      CatalogCoverageSchema.safeParse({ ...coverage, totalRequired: 81 }).success,
    ).toBe(false);
    expect(
      CatalogCoverageSchema.safeParse({ ...coverage, totalUsable: 71 }).success,
    ).toBe(false);
    expect(
      CatalogCoverageSchema.safeParse({
        ...coverage,
        groups: [{ groupKey: "proteins", required: 10, usable: 7 }],
      }).success,
    ).toBe(false);
  });
});

describe("contratos T17 de preferencias y resolución", () => {
  it("hace explícita la comparación multi y mantiene cadenas únicas", () => {
    expect(ShoppingPreferenceRevisionSchema.parse(preference)).toEqual(preference);
    expect(
      ShoppingPreferencePutSchema.safeParse({
        comparedChains: [],
        expectedVersion: null,
        mode: "single",
        preferredChain: "dia",
        schemaVersion: 1,
        sorting: "price_asc",
      }).success,
    ).toBe(true);
    expect(
      ShoppingPreferencePutSchema.safeParse({
        comparedChains: ["dia", "dia"],
        expectedVersion: 1,
        mode: "multistore",
        preferredChain: "dia",
        schemaVersion: 1,
        sorting: "price_asc",
      }).success,
    ).toBe(false);
    expect(
      ShoppingPreferencePutSchema.safeParse({
        comparedChains: ["mercadona"],
        expectedVersion: 1,
        mode: "single",
        preferredChain: "mercadona",
        schemaVersion: 1,
        sorting: "price_asc",
      }).success,
    ).toBe(false);
  });

  it("consume cantidades positivas de la lista nutricional y limita 80 líneas", () => {
    const input = {
      basketSeedRevisionId: uuid(6),
      catalogItems: [
        {
          canonicalFoodKey: "food:chicken-breast-raw",
          matchState: "exact",
          matchedEdiblePart: "meat_without_skin",
          matchedFoodState: "raw",
          matchedPurchaseForm: "fresh",
          projection,
        },
      ],
      catalogPublicationIds: [uuid(7)],
      leftovers: [],
      manualSelections: [],
      planVersionId: uuid(8),
      preferenceRevision: preference,
      profileId: uuid(4),
      resolutionMetadata: {
        createdAt: "2026-07-21T10:00:00.000Z",
        createdBy: uuid(2),
        id: uuid(9),
        itemIds: [
          {
            canonicalFoodKey: "food:chicken-breast-raw",
            shoppingItemId: uuid(10),
          },
        ],
        resolverVersion: "shopping-resolver-v2",
        revision: 1,
        supersedesId: null,
      },
      schemaVersion: 1,
      shoppingList: [
        {
          amountG: "1000",
          canonicalFoodKey: "food:chicken-breast-raw",
          name: "Pechuga de pollo",
          purchaseContext: {
            ediblePart: "meat_without_skin",
            foodState: "raw",
            purchaseForm: "fresh",
          },
        },
      ],
    } as const;

    expect(ShoppingResolutionInputSchema.parse(input)).toEqual(input);
    expect(
      ShoppingResolutionInputSchema.safeParse({
        ...input,
        shoppingList: Array.from({ length: 81 }, (_, index) => ({
          ...input.shoppingList[0],
          canonicalFoodKey: `food:test-${index}`,
        })),
      }).success,
    ).toBe(false);
    expect(
      ShoppingResolutionInputSchema.safeParse({
        ...input,
        shoppingList: [{ ...input.shoppingList[0], amountG: "0" }],
      }).success,
    ).toBe(false);
  });

  it("valida un snapshot parcial inmutable con máximo cuatro alternativas", () => {
    const selected = {
      estimatedRemainderG: "0",
      packageCount: "2",
      projection,
      requiredAfterLeftoverG: "1000",
      totalCostEur: "6.5",
    } as const;
    const snapshot = {
      basketSeedRevisionId: uuid(6),
      catalogPublicationIds: [uuid(7)],
      completeness: "partial",
      createdAt: "2026-07-21T10:00:00.000Z",
      createdBy: uuid(2),
      id: uuid(9),
      inputDigest: "ef".repeat(32),
      items: [
        {
          alternatives: [
            {
              selection: selected,
              state: "resolved",
              uncertainties: [],
            },
          ],
          amountG: "1000",
          canonicalFoodKey: "food:chicken-breast-raw",
          name: "Pechuga de pollo",
          selected,
          selectionOrigin: "automatic",
          shoppingItemId: uuid(10),
          state: "resolved",
          uncertainties: [],
        },
        {
          alternatives: [],
          amountG: "500",
          canonicalFoodKey: "food:tomato-raw",
          name: "Tomate",
          selected: null,
          selectionOrigin: "automatic",
          shoppingItemId: uuid(11),
          state: "no_confirmed_product",
          uncertainties: ["shopping_sku_missing"],
        },
      ],
      planVersionId: uuid(8),
      preferenceRevisionId: preference.id,
      preference: {
        comparedChains: ["dia", "mercadona"],
        mode: "multistore",
        preferredChain: "mercadona",
        sorting: "normalized_price_asc",
      },
      profileId: uuid(4),
      resolverVersion: "shopping-resolver-v2",
      revision: 1,
      schemaVersion: 1,
      supersedesId: null,
      totals: {
        coverage: { resolvedItems: 1, totalItems: 2 },
        kind: "partial",
        partialSubtotalEur: "6.5",
        resolvedItems: 1,
        unresolvedItems: 1,
      },
      comparison: {
        basis: "automatic_equivalent",
        baselineChains: ["mercadona"],
        baselineSubtotalEur: "6.5",
        candidateChains: ["dia", "mercadona"],
        candidateKind: "multistore",
        candidateSubtotalEur: "6.49",
        comparableItems: 1,
        savingsEur: null,
        scope: "partial",
        totalItems: 2,
      },
    } as const;

    expect(ShoppingSnapshotSchema.parse(snapshot)).toEqual(snapshot);
    expect(
      ShoppingSnapshotSchema.safeParse({
        ...snapshot,
        completeness: "complete",
      }).success,
    ).toBe(false);
    expect(
      ShoppingSnapshotSchema.safeParse({
        ...snapshot,
        items: [
          {
            ...snapshot.items[0],
            selected: {
              ...selected,
              projection: { ...projection, usability: "visible" },
            },
          },
        ],
        totals: {
          coverage: { resolvedItems: 1, totalItems: 2 },
          kind: "partial",
          partialSubtotalEur: "6.5",
          resolvedItems: 1,
          unresolvedItems: 0,
        },
      }).success,
    ).toBe(false);
    expect(
      ShoppingSnapshotSchema.safeParse({
        ...snapshot,
        items: [
          {
            ...snapshot.items[0],
            alternatives: Array.from({ length: 5 }, () => ({
              selection: selected,
              state: "resolved" as const,
              uncertainties: [],
            })),
          },
        ],
      }).success,
    ).toBe(false);
  });

  it("admite cero envases y separa total completo de subtotal parcial", () => {
    const zeroSelection = {
      estimatedRemainderG: "0",
      packageCount: "0",
      projection,
      requiredAfterLeftoverG: "0",
      totalCostEur: "0",
    } as const;
    expect(
      ShoppingSnapshotSchema.safeParse({
        basketSeedRevisionId: uuid(6),
        catalogPublicationIds: [uuid(7)],
        comparison: null,
        completeness: "complete",
        createdAt: "2026-07-21T10:00:00.000Z",
        createdBy: uuid(2),
        id: uuid(9),
        inputDigest: "ef".repeat(32),
        items: [
          {
            alternatives: [],
            amountG: "1000",
            canonicalFoodKey: "food:chicken-breast-raw",
            name: "Pechuga de pollo",
            selected: zeroSelection,
            selectionOrigin: "automatic",
            shoppingItemId: uuid(10),
            state: "resolved",
            uncertainties: [],
          },
        ],
        planVersionId: uuid(8),
        preference: {
          comparedChains: [],
          mode: "single",
          preferredChain: "mercadona",
          sorting: "price_asc",
        },
        preferenceRevisionId: preference.id,
        profileId: uuid(4),
        resolverVersion: "shopping-resolver-v2",
        revision: 1,
        schemaVersion: 1,
        supersedesId: null,
        totals: {
          coverage: { resolvedItems: 1, totalItems: 1 },
          estimatedTotalEur: "0",
          kind: "complete",
          resolvedItems: 1,
          unresolvedItems: 0,
        },
      }).success,
    ).toBe(true);
  });

  it("separa la clave de línea, el SKU y la clave canónica en mutaciones", () => {
    expect(
      ShoppingLeftoverRequestSchema.safeParse({
        action: "set",
        canonicalFoodKey: "food:chicken-breast-raw",
        declaredMeasure: { dimension: "mass", quantity: "250", unit: "g" },
        expectedVersion: 1,
        schemaVersion: 1,
      }).success,
    ).toBe(true);
    expect(
      ShoppingLeftoverRequestSchema.safeParse({
        action: "set",
        canonicalFoodKey: "food:olive-oil",
        declaredMeasure: { dimension: "volume", quantity: "250", unit: "ml" },
        expectedVersion: 1,
        schemaVersion: 1,
      }).success,
    ).toBe(false);
    expect(
      ShoppingLeftoverRequestSchema.safeParse({
        action: "set",
        canonicalFoodKey: "food:olive-oil",
        declaredMeasure: { dimension: "volume", quantity: "250", unit: "ml" },
        expectedVersion: 1,
        schemaVersion: 1,
        skuId: uuid(12),
      }).success,
    ).toBe(true);
    expect(
      ShoppingProductSelectionRequestSchema.safeParse({
        canonicalFoodKey: "food:chicken-breast-raw",
        expectedVersion: 1,
        schemaVersion: 1,
        skuId: projection.skuId,
      }).success,
    ).toBe(true);
    expect(
      ShoppingProductSelectionRequestSchema.safeParse({
        expectedVersion: 1,
        productId: projection.skuId,
        schemaVersion: 1,
      }).success,
    ).toBe(false);
  });

  it("mantiene el cuerpo público común en 16 KiB", () => {
    expect(SHOPPING_HTTP_BODY_BYTES).toBe(16 * 1024);
  });

  it("devuelve ACK públicos mínimos sin manifest, hashes ni referencias R2", () => {
    const preferenceAck = {
      preferenceRevisionId: preference.id,
      schemaVersion: 1,
      version: 1,
    } as const;
    const mutationAck = {
      schemaVersion: 1,
      snapshotId: uuid(9),
      status: "active",
      version: 1,
    } as const;

    expect(ShoppingPreferenceAckSchema.parse(preferenceAck)).toEqual(preferenceAck);
    expect(ShoppingMutationAckSchema.parse(mutationAck)).toEqual(mutationAck);
    for (const forbidden of [
      { manifestId: uuid(5) },
      { normalizedSha256: "ab".repeat(32) },
      { rawObjectRef: "r2://opaque/raw" },
      { sourceLocationInternal: "41006" },
    ]) {
      expect(
        ShoppingMutationAckSchema.safeParse({ ...mutationAck, ...forbidden }).success,
      ).toBe(false);
    }
  });
});

describe("reconciliación contractual T17D.0", () => {
  const resolutionInput = {
    basketSeedRevisionId: uuid(6),
    catalogItems: [],
    catalogPublicationIds: [uuid(7)],
    leftovers: [],
    manualSelections: [],
    planVersionId: uuid(8),
    preferenceRevision: preference,
    profileId: uuid(4),
    resolutionMetadata: {
      createdAt: "2026-07-21T10:00:00.000Z",
      createdBy: uuid(2),
      id: uuid(9),
      itemIds: [
        {
          canonicalFoodKey: "food:chicken-breast-raw",
          shoppingItemId: uuid(10),
        },
      ],
      resolverVersion: "shopping-resolver-v2",
      revision: 1,
      supersedesId: null,
    },
    schemaVersion: 1,
    shoppingList: [
      {
        amountG: "1000",
        canonicalFoodKey: "food:chicken-breast-raw",
        name: "Pechuga de pollo",
        purchaseContext: null,
      },
    ],
  } as const;

  it("separa el ciclo de vida del input y admite contexto de compra ausente", () => {
    expect(ShoppingResolutionInputSchema.parse(resolutionInput)).toEqual(
      resolutionInput,
    );
    expect(
      ShoppingResolutionInputSchema.safeParse({
        ...resolutionInput,
        resolutionMetadata: {
          ...resolutionInput.resolutionMetadata,
          status: "active",
        },
      }).success,
    ).toBe(false);
  });

  it("permite establecer y borrar sobrantes sin aceptar equivalencias del cliente", () => {
    expect(
      ShoppingLeftoverRequestSchema.safeParse({
        action: "set",
        canonicalFoodKey: "food:chicken-breast-raw",
        declaredMeasure: { dimension: "mass", quantity: "250", unit: "g" },
        expectedVersion: 1,
        schemaVersion: 1,
      }).success,
    ).toBe(true);
    expect(
      ShoppingLeftoverRequestSchema.safeParse({
        action: "set",
        canonicalFoodKey: "food:olive-oil",
        declaredMeasure: { dimension: "volume", quantity: "250", unit: "ml" },
        expectedVersion: 1,
        schemaVersion: 1,
        skuId: uuid(12),
      }).success,
    ).toBe(true);
    expect(
      ShoppingLeftoverRequestSchema.safeParse({
        action: "clear",
        canonicalFoodKey: "food:olive-oil",
        expectedVersion: 1,
        schemaVersion: 1,
      }).success,
    ).toBe(true);
    expect(
      ShoppingLeftoverRequestSchema.safeParse({
        action: "set",
        canonicalFoodKey: "food:olive-oil",
        confirmedEquivalentG: "225",
        declaredMeasure: { dimension: "volume", quantity: "250", unit: "ml" },
        expectedVersion: 1,
        schemaVersion: 1,
        skuId: uuid(12),
      }).success,
    ).toBe(false);
  });

  it("define lecturas estrictas sin crear una preferencia predeterminada", () => {
    const legacyHint = {
      compatible: false,
      value: "lidl",
    } as const;
    expect(ShoppingLegacyPreferenceHintSchema.parse(legacyHint)).toEqual(legacyHint);
    expect(
      ShoppingPreferenceReadResponseSchema.parse({
        legacyHint,
        preference: null,
        schemaVersion: 1,
      }),
    ).toEqual({ legacyHint, preference: null, schemaVersion: 1 });
    expect(
      ShoppingCatalogPageSchema.safeParse({
        chain: "mercadona",
        items: [projection],
        nextCursor: "cursor-opaco",
        publicationId: uuid(7),
        schemaVersion: 1,
      }).success,
    ).toBe(true);
  });

  it("valida un envelope de lifecycle sin reescribir el snapshot", () => {
    expect(
      ShoppingSnapshotResponseSchema.safeParse({
        lifecycle: { archivedAt: null, status: "active" },
        schemaVersion: 1,
        snapshot: {},
      }).success,
    ).toBe(false);
    expect(
      ShoppingSnapshotResponseSchema.safeParse({
        lifecycle: {
          archivedAt: "2026-07-22T10:00:00.000Z",
          status: "active",
        },
        schemaVersion: 1,
        snapshot: {},
      }).success,
    ).toBe(false);
  });
});
