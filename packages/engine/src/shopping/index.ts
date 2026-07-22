import {
  SHOPPING_MAX_ALTERNATIVES,
  ShoppingResolutionInputSchema,
  ShoppingSnapshotSchema,
  type ShoppingResolutionInput,
  type ShoppingSnapshot,
} from "@health-design/contracts";

import {
  addDecimals,
  compareDecimals,
  divideDecimals,
  multiplyDecimals,
  subtractDecimals,
  sumDecimals,
} from "../decimal.ts";
import { sha256CanonicalJson } from "../index.ts";

export const SHOPPING_RESOLVER_VERSION = "shopping-resolver-v1" as const;

type CatalogItem = ShoppingResolutionInput["catalogItems"][number];
type ShoppingLine = ShoppingResolutionInput["shoppingList"][number];
type SnapshotItem = ShoppingSnapshot["items"][number];
type Selection = NonNullable<SnapshotItem["selected"]>;
type Alternative = SnapshotItem["alternatives"][number];

type CalculatedOption = Readonly<{
  catalogItem: CatalogItem;
  selection: Selection;
}>;

const activeMatch = new Set(["exact", "allowed"]);

function compareText(left: string, right: string): -1 | 0 | 1 {
  const normalizedLeft = left.normalize("NFC").toLowerCase();
  const normalizedRight = right.normalize("NFC").toLowerCase();
  return normalizedLeft < normalizedRight
    ? -1
    : normalizedLeft > normalizedRight
      ? 1
      : 0;
}

function optionIdentity(item: CatalogItem): string {
  const { chain, externalSku, market, skuId } = item.projection;
  return `${market}\u0000${chain}\u0000${externalSku.normalize("NFC")}\u0000${skuId}`;
}

function capacityG(item: CatalogItem): string | null {
  const confirmedPackage = item.projection.package;
  if (confirmedPackage === null) return null;
  if (confirmedPackage.saleMeasure.dimension === "mass") {
    return confirmedPackage.saleMeasure.quantity;
  }
  return confirmedPackage.equivalentEdibleMassG !== null &&
    confirmedPackage.equivalenceEvidenceRef !== null
    ? confirmedPackage.equivalentEdibleMassG
    : null;
}

function ceilPositiveDecimal(dividend: string, divisor: string): string {
  if (compareDecimals(dividend, "0") === 0) return "0";
  const floor = divideDecimals(dividend, divisor, 0, "toward_zero");
  return compareDecimals(multiplyDecimals(floor, divisor), dividend) >= 0
    ? floor
    : addDecimals(floor, "1");
}

function calculateSelection(
  item: CatalogItem,
  requiredAfterLeftoverG: string,
): Selection | null {
  const compatibleCapacityG = capacityG(item);
  const { basePriceEur, exclusionReasons, usability } = item.projection;
  if (
    compatibleCapacityG === null ||
    basePriceEur === null ||
    usability !== "calculable" ||
    exclusionReasons.length > 0
  ) {
    return null;
  }
  const packageCount = ceilPositiveDecimal(requiredAfterLeftoverG, compatibleCapacityG);
  const purchasedG = multiplyDecimals(packageCount, compatibleCapacityG);
  return {
    estimatedRemainderG: subtractDecimals(purchasedG, requiredAfterLeftoverG),
    packageCount,
    projection: item.projection,
    requiredAfterLeftoverG,
    totalCostEur: multiplyDecimals(packageCount, basePriceEur),
  };
}

function identityMatches(line: ShoppingLine, item: CatalogItem): boolean {
  return (
    item.canonicalFoodKey === line.canonicalFoodKey &&
    activeMatch.has(item.matchState) &&
    item.matchedEdiblePart === line.ediblePart &&
    item.matchedFoodState === line.foodState &&
    item.matchedPurchaseForm === line.purchaseForm &&
    item.projection.purchaseForm === line.purchaseForm
  );
}

function normalizedPriceComparison(
  left: CalculatedOption,
  right: CalculatedOption,
): -1 | 0 | 1 | null {
  const leftPrice = left.selection.projection.normalizedPrice;
  const rightPrice = right.selection.projection.normalizedPrice;
  return leftPrice !== null &&
    rightPrice !== null &&
    leftPrice.dimension === rightPrice.dimension
    ? compareDecimals(leftPrice.value, rightPrice.value)
    : null;
}

function chooseBest(options: readonly CalculatedOption[]): CalculatedOption {
  let candidates = [...options];
  const minimumCost = candidates.reduce(
    (minimum, option) =>
      compareDecimals(option.selection.totalCostEur, minimum) < 0
        ? option.selection.totalCostEur
        : minimum,
    candidates[0]!.selection.totalCostEur,
  );
  candidates = candidates.filter(
    ({ selection }) => compareDecimals(selection.totalCostEur, minimumCost) === 0,
  );
  const minimumRemainder = candidates.reduce(
    (minimum, option) =>
      compareDecimals(option.selection.estimatedRemainderG, minimum) < 0
        ? option.selection.estimatedRemainderG
        : minimum,
    candidates[0]!.selection.estimatedRemainderG,
  );
  candidates = candidates.filter(
    ({ selection }) =>
      compareDecimals(selection.estimatedRemainderG, minimumRemainder) === 0,
  );
  const dimensions = new Set(
    candidates.map(({ selection }) => selection.projection.normalizedPrice?.dimension),
  );
  if (dimensions.size === 1 && !dimensions.has(undefined)) {
    const minimumNormalized = candidates.reduce((minimum, option) => {
      const comparison = normalizedPriceComparison(option, minimum);
      return comparison !== null && comparison < 0 ? option : minimum;
    }, candidates[0]!);
    candidates = candidates.filter(
      (option) => normalizedPriceComparison(option, minimumNormalized) === 0,
    );
  }
  return candidates.sort((left, right) =>
    compareText(optionIdentity(left.catalogItem), optionIdentity(right.catalogItem)),
  )[0]!;
}

function rankCalculated(options: readonly CalculatedOption[]): CalculatedOption[] {
  const remaining = [...options];
  const ranked: CalculatedOption[] = [];
  while (remaining.length > 0) {
    const best = chooseBest(remaining);
    ranked.push(best);
    remaining.splice(remaining.indexOf(best), 1);
  }
  return ranked;
}

function pendingAlternative(item: CatalogItem): Alternative | null {
  if (capacityG(item) === null) {
    return {
      projection: item.projection,
      state: "package_unconfirmed",
      uncertainties: ["shopping_package_unconfirmed"],
    };
  }
  if (item.projection.basePriceEur === null) {
    return {
      projection: item.projection,
      state: "price_unavailable",
      uncertainties: ["shopping_price_unavailable"],
    };
  }
  return null;
}

function alternativesFor(
  calculated: readonly CalculatedOption[],
  candidates: readonly CatalogItem[],
  selectedSkuId: string | null,
): Alternative[] {
  const resolved = rankCalculated(
    calculated.filter(({ selection }) => selection.projection.skuId !== selectedSkuId),
  ).map<Alternative>(({ selection }) => ({
    selection,
    state: "resolved",
    uncertainties: [],
  }));
  const pending = candidates
    .filter(({ projection }) => projection.skuId !== selectedSkuId)
    .map(pendingAlternative)
    .filter((option): option is Alternative => option !== null)
    .sort((left, right) => {
      const leftProjection =
        left.state === "resolved" ? left.selection.projection : left.projection;
      const rightProjection =
        right.state === "resolved" ? right.selection.projection : right.projection;
      return compareText(
        `${leftProjection.market}\u0000${leftProjection.chain}\u0000${leftProjection.externalSku}`,
        `${rightProjection.market}\u0000${rightProjection.chain}\u0000${rightProjection.externalSku}`,
      );
    });
  return [...resolved, ...pending].slice(0, SHOPPING_MAX_ALTERNATIVES);
}

function resolveLine(
  line: ShoppingLine,
  input: ShoppingResolutionInput,
  allowedChains: ReadonlySet<string>,
): SnapshotItem {
  const leftover = input.leftovers.find(
    ({ canonicalFoodKey }) => canonicalFoodKey === line.canonicalFoodKey,
  );
  const requiredAfterLeftoverG =
    leftover === undefined ||
    compareDecimals(line.amountG, leftover.confirmedEquivalentG) > 0
      ? subtractDecimals(line.amountG, leftover?.confirmedEquivalentG ?? "0")
      : "0";
  const candidates = input.catalogItems
    .filter(
      (item) => identityMatches(line, item) && allowedChains.has(item.projection.chain),
    )
    .sort((left, right) => compareText(optionIdentity(left), optionIdentity(right)));
  const calculated = candidates.flatMap((catalogItem) => {
    const selection = calculateSelection(catalogItem, requiredAfterLeftoverG);
    return selection === null ? [] : [{ catalogItem, selection }];
  });
  const manualSelection = input.manualSelections.find(
    ({ canonicalFoodKey }) => canonicalFoodKey === line.canonicalFoodKey,
  );
  const itemId = input.resolutionMetadata.itemIds.find(
    ({ canonicalFoodKey }) => canonicalFoodKey === line.canonicalFoodKey,
  )!.shoppingItemId;
  const base = {
    amountG: line.amountG,
    canonicalFoodKey: line.canonicalFoodKey,
    name: line.name.normalize("NFC"),
    shoppingItemId: itemId,
  };

  if (manualSelection !== undefined) {
    const manual = calculated.find(
      ({ selection }) => selection.projection.skuId === manualSelection.skuId,
    );
    if (manual === undefined) {
      return {
        ...base,
        alternatives: alternativesFor(calculated, candidates, null),
        selected: null,
        state: "no_confirmed_product",
        uncertainties: ["shopping_manual_selection_stale"],
      };
    }
    return {
      ...base,
      alternatives: alternativesFor(
        calculated,
        candidates,
        manual.selection.projection.skuId,
      ),
      selected: manual.selection,
      state: "resolved",
      uncertainties: [],
    };
  }

  if (calculated.length > 0) {
    const selected = chooseBest(calculated).selection;
    return {
      ...base,
      alternatives: alternativesFor(calculated, candidates, selected.projection.skuId),
      selected,
      state: "resolved",
      uncertainties: [],
    };
  }

  const pending = candidates.map(pendingAlternative).filter((value) => value !== null);
  const priceUnavailable = pending.some(({ state }) => state === "price_unavailable");
  const state = priceUnavailable
    ? "price_unavailable"
    : pending.length > 0
      ? "package_unconfirmed"
      : "no_confirmed_product";
  return {
    ...base,
    alternatives: alternativesFor([], candidates, null),
    selected: null,
    state,
    uncertainties: [
      state === "price_unavailable"
        ? "shopping_price_unavailable"
        : state === "package_unconfirmed"
          ? "shopping_package_unconfirmed"
          : "shopping_sku_missing",
    ],
  };
}

function stableItemIdentity(item: SnapshotItem): string {
  return `${item.canonicalFoodKey}\u0000${
    item.selected?.projection.skuId ?? item.shoppingItemId
  }`;
}

function comparePresentation(
  left: SnapshotItem,
  right: SnapshotItem,
  sorting: ShoppingResolutionInput["preferenceRevision"]["sorting"],
): number {
  const leftResolved = left.selected !== null;
  const rightResolved = right.selected !== null;
  if (leftResolved !== rightResolved) return leftResolved ? -1 : 1;
  if (left.selected !== null && right.selected !== null) {
    if (sorting === "price_asc" || sorting === "price_desc") {
      const comparison = compareDecimals(
        left.selected.totalCostEur,
        right.selected.totalCostEur,
      );
      if (comparison !== 0) return sorting === "price_asc" ? comparison : -comparison;
    }
    if (sorting === "normalized_price_asc") {
      const leftPrice = left.selected.projection.normalizedPrice;
      const rightPrice = right.selected.projection.normalizedPrice;
      if ((leftPrice === null) !== (rightPrice === null))
        return leftPrice === null ? 1 : -1;
      if (leftPrice !== null && rightPrice !== null) {
        const dimension = compareText(leftPrice.dimension, rightPrice.dimension);
        if (dimension !== 0) return dimension;
        const comparison = compareDecimals(leftPrice.value, rightPrice.value);
        if (comparison !== 0) return comparison;
      }
    }
  }
  if (sorting === "name_asc" || sorting === "name_desc") {
    const comparison = compareText(left.name, right.name);
    if (comparison !== 0) return sorting === "name_asc" ? comparison : -comparison;
  }
  return compareText(stableItemIdentity(left), stableItemIdentity(right));
}

function canonicalDigestInput(input: ShoppingResolutionInput) {
  const byFoodKey = <T extends { canonicalFoodKey: string }>(left: T, right: T) =>
    compareText(left.canonicalFoodKey, right.canonicalFoodKey);
  return {
    basketSeedRevisionId: input.basketSeedRevisionId,
    catalogItems: [...input.catalogItems].sort((left, right) => {
      const food = byFoodKey(left, right);
      return food === 0
        ? compareText(optionIdentity(left), optionIdentity(right))
        : food;
    }),
    catalogPublicationIds: [...input.catalogPublicationIds].sort(compareText),
    leftovers: [...input.leftovers].sort(byFoodKey),
    manualSelections: [...input.manualSelections].sort(byFoodKey),
    planVersionId: input.planVersionId,
    preferenceRevision: {
      comparedChains: [...input.preferenceRevision.comparedChains].sort(compareText),
      id: input.preferenceRevision.id,
      mode: input.preferenceRevision.mode,
      preferredChain: input.preferenceRevision.preferredChain,
      sorting: input.preferenceRevision.sorting,
      version: input.preferenceRevision.version,
    },
    profileId: input.profileId,
    resolverVersion: input.resolutionMetadata.resolverVersion,
    schemaVersion: input.schemaVersion,
    shoppingList: [...input.shoppingList].sort(byFoodKey),
  };
}

export async function resolveShopping(
  candidate: ShoppingResolutionInput,
): Promise<ShoppingSnapshot> {
  const input = ShoppingResolutionInputSchema.parse(candidate);
  if (input.resolutionMetadata.resolverVersion !== SHOPPING_RESOLVER_VERSION) {
    throw new Error("shopping_resolver_version_mismatch");
  }
  const allowedChains = new Set(
    input.preferenceRevision.mode === "single"
      ? [input.preferenceRevision.preferredChain]
      : input.preferenceRevision.comparedChains,
  );
  const items = input.shoppingList
    .map((line) => resolveLine(line, input, allowedChains))
    .sort((left, right) =>
      comparePresentation(left, right, input.preferenceRevision.sorting),
    );
  const resolvedItems = items.filter(({ selected }) => selected !== null).length;
  const unresolvedItems = items.length - resolvedItems;
  const subtotalEur = sumDecimals(
    items.flatMap(({ selected }) => (selected === null ? [] : [selected.totalCostEur])),
  );
  const metadata = input.resolutionMetadata;
  const completeness = unresolvedItems === 0 ? "complete" : "partial";
  return ShoppingSnapshotSchema.parse({
    basketSeedRevisionId: input.basketSeedRevisionId,
    catalogPublicationIds: [...input.catalogPublicationIds].sort(compareText),
    comparison: null,
    completeness,
    createdAt: metadata.createdAt,
    createdBy: metadata.createdBy,
    id: metadata.id,
    inputDigest: await sha256CanonicalJson(canonicalDigestInput(input)),
    items,
    planVersionId: input.planVersionId,
    preference: {
      comparedChains: [...input.preferenceRevision.comparedChains].sort(compareText),
      mode: input.preferenceRevision.mode,
      preferredChain: input.preferenceRevision.preferredChain,
      sorting: input.preferenceRevision.sorting,
    },
    preferenceRevisionId: input.preferenceRevision.id,
    profileId: input.profileId,
    resolverVersion: metadata.resolverVersion,
    revision: metadata.revision,
    schemaVersion: 1,
    status: metadata.status,
    supersedesId: metadata.supersedesId,
    totals:
      completeness === "complete"
        ? {
            coverage: { resolvedItems, totalItems: items.length },
            estimatedTotalEur: subtotalEur,
            kind: "complete",
            resolvedItems,
            unresolvedItems: 0,
          }
        : {
            coverage: { resolvedItems, totalItems: items.length },
            kind: "partial",
            partialSubtotalEur: subtotalEur,
            resolvedItems,
            unresolvedItems,
          },
  });
}
