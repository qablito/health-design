import {
  CatalogCoverageSchema,
  type CatalogCoverage,
  type MatchState,
  type ShoppingPurchaseForm,
} from "@health-design/contracts";

import type { MatchFoodState } from "./matching.ts";

export type BasketSeedCoverageItem = Readonly<{
  canonicalFoodKey: string;
  ediblePart: string;
  foodState: MatchFoodState;
  group: string;
  kind: "dynamic" | "fixed";
  purchaseForm: ShoppingPurchaseForm;
  usageWindow?: Readonly<{ from: string; to: string }>;
}>;

export type CoveredSupermarketMatch = Readonly<{
  canonicalFoodKey: string;
  criticalIssueOpen: boolean;
  foodState: MatchFoodState;
  matchState: MatchState;
  packageConfirmed: boolean;
  priceAvailable: boolean;
  purchaseForm: ShoppingPurchaseForm;
  ruleActive: boolean;
  skuId: string;
}>;

export type DynamicBasketCandidate = Readonly<{
  canonicalFoodKey: string;
  observedAt: string;
  profileDeletedAt: string | null;
  profileId: string;
}>;

function validWindow(window: BasketSeedCoverageItem["usageWindow"]): boolean {
  if (!window) return false;
  const from = Date.parse(window.from);
  const to = Date.parse(window.to);
  return Number.isFinite(from) && Number.isFinite(to) && from <= to;
}

function validateSeed(seed: readonly BasketSeedCoverageItem[]): void {
  const fixed = seed.filter(({ kind }) => kind === "fixed");
  const dynamic = seed.filter(({ kind }) => kind === "dynamic");
  const keys = seed.map(({ canonicalFoodKey }) => canonicalFoodKey);
  if (
    seed.length !== 80 ||
    fixed.length !== 60 ||
    dynamic.length !== 20 ||
    new Set(keys).size !== 80
  ) {
    throw new Error("invalid_basket_seed");
  }
  if (dynamic.some(({ usageWindow }) => !validWindow(usageWindow))) {
    throw new Error("invalid_dynamic_usage_window");
  }
}

function matchCovers(
  seedItem: BasketSeedCoverageItem,
  match: CoveredSupermarketMatch,
): boolean {
  return (
    match.canonicalFoodKey === seedItem.canonicalFoodKey &&
    match.ruleActive &&
    (match.matchState === "exact" || match.matchState === "allowed") &&
    match.foodState === seedItem.foodState &&
    match.purchaseForm === seedItem.purchaseForm &&
    match.packageConfirmed &&
    match.priceAvailable &&
    !match.criticalIssueOpen
  );
}

export function evaluateSupermarketCoverage(
  input: Readonly<{
    matches: readonly CoveredSupermarketMatch[];
    seed: readonly BasketSeedCoverageItem[];
  }>,
): CatalogCoverage {
  validateSeed(input.seed);
  const coveredKeys = new Set(
    input.seed
      .filter((seedItem) => input.matches.some((match) => matchCovers(seedItem, match)))
      .map(({ canonicalFoodKey }) => canonicalFoodKey),
  );
  const fixedUsable = input.seed.filter(
    ({ canonicalFoodKey, kind }) =>
      kind === "fixed" && coveredKeys.has(canonicalFoodKey),
  ).length;
  const dynamicUsable = input.seed.filter(
    ({ canonicalFoodKey, kind }) =>
      kind === "dynamic" && coveredKeys.has(canonicalFoodKey),
  ).length;
  const groupKeys = [...new Set(input.seed.map(({ group }) => group))].sort(
    (left, right) => left.localeCompare(right, "es"),
  );
  const groups = groupKeys.map((groupKey) => {
    const items = input.seed.filter(({ group }) => group === groupKey);
    return {
      groupKey,
      required: items.length,
      usable: items.filter(({ canonicalFoodKey }) => coveredKeys.has(canonicalFoodKey))
        .length,
    };
  });
  const totalUsable = fixedUsable + dynamicUsable;
  return CatalogCoverageSchema.parse({
    dynamicRequired: 20,
    dynamicUsable,
    fixedRequired: 60,
    fixedUsable,
    groups,
    publishable:
      totalUsable >= 72 &&
      groups.every(({ required, usable }) => usable * 4 >= required * 3),
    totalRequired: 80,
    totalUsable,
  });
}

export function selectDynamicBasketItems(
  input: Readonly<{
    candidates: readonly DynamicBasketCandidate[];
    from: string;
    reserve: readonly string[];
    to: string;
  }>,
): string[] {
  const from = Date.parse(input.from);
  const to = Date.parse(input.to);
  if (!Number.isFinite(from) || !Number.isFinite(to) || from > to) {
    throw new Error("invalid_dynamic_usage_window");
  }

  const profilesByFood = new Map<string, Set<string>>();
  for (const candidate of input.candidates) {
    const observedAt = Date.parse(candidate.observedAt);
    if (
      !Number.isFinite(observedAt) ||
      observedAt < from ||
      observedAt > to ||
      candidate.profileDeletedAt !== null
    ) {
      continue;
    }
    const profiles =
      profilesByFood.get(candidate.canonicalFoodKey) ?? new Set<string>();
    profiles.add(candidate.profileId);
    profilesByFood.set(candidate.canonicalFoodKey, profiles);
  }

  const selected = [...profilesByFood]
    .sort(
      ([leftKey, leftProfiles], [rightKey, rightProfiles]) =>
        rightProfiles.size - leftProfiles.size || leftKey.localeCompare(rightKey, "es"),
    )
    .map(([canonicalFoodKey]) => canonicalFoodKey)
    .slice(0, 20);
  for (const canonicalFoodKey of input.reserve) {
    if (selected.length === 20) break;
    if (!selected.includes(canonicalFoodKey)) selected.push(canonicalFoodKey);
  }
  if (selected.length !== 20) throw new Error("dynamic_reserve_insufficient");
  return selected;
}
