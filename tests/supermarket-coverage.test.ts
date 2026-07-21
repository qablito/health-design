import { describe, expect, it } from "vitest";

import {
  evaluateSupermarketCoverage,
  selectDynamicBasketItems,
  type BasketSeedCoverageItem,
  type CoveredSupermarketMatch,
} from "@health-design/catalog/supermarkets";
import {
  T17_FIXED_BASKET,
  T17_RESERVE_BASKET,
} from "@health-design/test-fixtures/shopping";

const seed: BasketSeedCoverageItem[] = [
  ...T17_FIXED_BASKET.map((item) => ({ ...item, kind: "fixed" as const })),
  ...T17_RESERVE_BASKET.map((item) => ({
    ...item,
    kind: "dynamic" as const,
    usageWindow: { from: "2026-06-01", to: "2026-06-30" },
  })),
];

function covered(items: readonly BasketSeedCoverageItem[]): CoveredSupermarketMatch[] {
  return items.map((item, index) => ({
    canonicalFoodKey: item.canonicalFoodKey,
    criticalIssueOpen: false,
    foodState: item.foodState,
    matchState: index % 2 === 0 ? "exact" : "allowed",
    packageConfirmed: true,
    priceAvailable: true,
    purchaseForm: item.purchaseForm,
    ruleActive: true,
    skuId: `sku-${index}`,
  }));
}

describe("cobertura y puerta de publicación T17", () => {
  it("falla con 71/80 y permite 72/80 cuando todos los grupos superan 75 %", () => {
    const all = covered(seed);
    const removedFor72 = new Set(
      [
        ...seed.filter(({ group }) => group === "protein").slice(0, 5),
        seed.find(({ group }) => group === "vegetable"),
        seed.find(({ group }) => group === "fruit"),
        seed.find(({ group }) => group === "carbohydrate"),
      ].flatMap((item) => (item ? [item.canonicalFoodKey] : [])),
    );
    const matches72 = all.filter((match) => !removedFor72.has(match.canonicalFoodKey));

    expect(
      evaluateSupermarketCoverage({ matches: matches72.slice(0, 71), seed }),
    ).toMatchObject({
      publishable: false,
      totalUsable: 71,
    });
    expect(evaluateSupermarketCoverage({ matches: matches72, seed })).toMatchObject({
      publishable: true,
      totalUsable: 72,
    });
  });

  it("rechaza 72/80 si un grupo queda en 74 % o menos", () => {
    const fatKeys = seed
      .filter(({ group }) => group === "fat")
      .slice(0, 2)
      .map(({ canonicalFoodKey }) => canonicalFoodKey);
    const proteinKeys = seed
      .filter(({ group }) => group === "protein")
      .slice(0, 5)
      .map(({ canonicalFoodKey }) => canonicalFoodKey);
    const vegetableKey = seed.find(
      ({ group }) => group === "vegetable",
    )?.canonicalFoodKey;
    const removed = new Set([
      ...fatKeys,
      ...proteinKeys,
      ...(vegetableKey ? [vegetableKey] : []),
    ]);
    const result = evaluateSupermarketCoverage({
      matches: covered(seed).filter((match) => !removed.has(match.canonicalFoodKey)),
      seed,
    });

    expect(result.totalUsable).toBe(72);
    expect(result.groups.find(({ groupKey }) => groupKey === "fat")).toMatchObject({
      required: 6,
      usable: 4,
    });
    expect(result.publishable).toBe(false);
  });

  it("cuenta cada alimento una vez y excluye datos no calculables", () => {
    const matches = covered(seed);
    matches.push({ ...matches[0]!, skuId: "sku-duplicate" });
    matches[1] = { ...matches[1]!, packageConfirmed: false };
    matches[2] = { ...matches[2]!, priceAvailable: false };
    matches[3] = { ...matches[3]!, matchState: "review" };
    matches[4] = { ...matches[4]!, criticalIssueOpen: true };

    expect(evaluateSupermarketCoverage({ matches, seed }).totalUsable).toBe(76);
  });

  it("exige exactamente 60 fijos, 20 dinámicos y ventana en cada dinámico", () => {
    expect(() =>
      evaluateSupermarketCoverage({ matches: [], seed: seed.slice(0, 79) }),
    ).toThrow("invalid_basket_seed");
    expect(() =>
      evaluateSupermarketCoverage({
        matches: [],
        seed: seed.map((item) => {
          if (item.kind !== "dynamic") return item;
          return {
            canonicalFoodKey: item.canonicalFoodKey,
            ediblePart: item.ediblePart,
            foodState: item.foodState,
            group: item.group,
            kind: item.kind,
            purchaseForm: item.purchaseForm,
          };
        }),
      }),
    ).toThrow("invalid_dynamic_usage_window");
  });

  it("selecciona una aparición por alimento, respeta el rango y completa desde reserva", () => {
    const selected = selectDynamicBasketItems({
      candidates: [
        {
          canonicalFoodKey: T17_RESERVE_BASKET[1].canonicalFoodKey,
          observedAt: "2026-06-04T10:00:00Z",
          profileDeletedAt: null,
          profileId: "profile-a",
        },
        {
          canonicalFoodKey: T17_RESERVE_BASKET[1].canonicalFoodKey,
          observedAt: "2026-06-05T10:00:00Z",
          profileDeletedAt: null,
          profileId: "profile-b",
        },
        {
          canonicalFoodKey: T17_RESERVE_BASKET[0].canonicalFoodKey,
          observedAt: "2026-05-01T10:00:00Z",
          profileDeletedAt: null,
          profileId: "profile-c",
        },
        {
          canonicalFoodKey: "food:deleted-only",
          observedAt: "2026-06-06T10:00:00Z",
          profileDeletedAt: "2026-06-01T00:00:00Z",
          profileId: "profile-deleted",
        },
      ],
      from: "2026-06-01T00:00:00Z",
      reserve: T17_RESERVE_BASKET.map(({ canonicalFoodKey }) => canonicalFoodKey),
      to: "2026-06-30T23:59:59Z",
    });

    expect(selected).toHaveLength(20);
    expect(selected[0]).toBe(T17_RESERVE_BASKET[1].canonicalFoodKey);
    expect(new Set(selected).size).toBe(20);
    expect(selected).not.toContain("food:deleted-only");
  });
});
