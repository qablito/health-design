import type { ShoppingPurchaseForm, MatchState } from "@health-design/contracts";

export type MatchFoodState = "cooked" | "raw" | "unspecified";

export type SupermarketMatchTarget = Readonly<{
  canonicalFoodKey: string;
  categoryTerms: readonly string[];
  ediblePart: string;
  foodState: MatchFoodState;
  name: string;
  purchaseForm: ShoppingPurchaseForm;
}>;

export type SupermarketMatchCandidateInput = Readonly<{
  allergenData: "known" | "unknown";
  categoryPath: readonly string[];
  crossContactData: "known" | "unknown";
  excludedTerms: readonly string[];
  externalSku: string;
  foodState: MatchFoodState;
  formatText: string | null;
  gtinConsistency: "consistent" | "conflict" | "not_available";
  ingredients: readonly string[];
  name: string;
  purchaseForm: ShoppingPurchaseForm;
  targets: readonly SupermarketMatchTarget[];
}>;

export type SupermarketMatchCandidate = Readonly<{
  canonicalFoodKey: string;
  criteria: readonly string[];
  ediblePart: string;
  matchState: MatchState;
  reason:
    | "allergen_data_unknown"
    | "cross_contact_unknown"
    | "excluded_term"
    | "food_state_mismatch"
    | "gtin_match_conflict"
    | "identity_match"
    | "purchase_form_mismatch"
    | "weak_identity_evidence";
}>;

const NAME_STOP_WORDS = new Set([
  "al",
  "cocida",
  "cocido",
  "cruda",
  "crudo",
  "de",
  "del",
  "en",
  "la",
  "natural",
  "sin",
]);

function tokens(value: string): Set<string> {
  return new Set(
    value
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "")
      .toLocaleLowerCase("es")
      .match(/[a-z0-9]+/g) ?? [],
  );
}

function includesAll(source: Set<string>, expected: readonly string[]): boolean {
  return expected.length > 0 && expected.every((word) => source.has(word));
}

function significantNameTokens(value: string): string[] {
  return [...tokens(value)].filter((word) => !NAME_STOP_WORDS.has(word));
}

function hasExcludedTerm(
  source: Set<string>,
  excludedTerms: readonly string[],
): boolean {
  return excludedTerms.some((term) => includesAll(source, [...tokens(term)]));
}

const MATCH_STATE_ORDER: Readonly<Record<MatchState, number>> = {
  exact: 0,
  allowed: 1,
  review: 2,
  excluded: 3,
  insufficient: 4,
};

export function generateSupermarketMatchCandidates(
  input: SupermarketMatchCandidateInput,
): SupermarketMatchCandidate[] {
  const nameTokens = tokens(input.name);
  const categoryTokens = tokens(input.categoryPath.join(" "));
  const ingredientTokens = tokens(input.ingredients.join(" "));
  const allSourceTokens = tokens(
    [
      input.name,
      ...input.categoryPath,
      input.formatText ?? "",
      ...input.ingredients,
    ].join(" "),
  );

  return input.targets
    .flatMap((target): SupermarketMatchCandidate[] => {
      const targetNameTokens = significantNameTokens(target.name);
      const targetCategoryTokens = target.categoryTerms.flatMap((term) => [
        ...tokens(term),
      ]);
      const nameMatch = includesAll(nameTokens, targetNameTokens);
      const categoryMatch = includesAll(categoryTokens, targetCategoryTokens);
      const ingredientMatch = includesAll(ingredientTokens, targetNameTokens);
      const hasIdentityEvidence = nameMatch || categoryMatch || ingredientMatch;
      if (!hasIdentityEvidence) return [];

      const criteria = [
        ...(nameMatch ? ["name_words"] : []),
        ...(categoryMatch ? ["category"] : []),
        ...(ingredientMatch ? ["ingredients"] : []),
        ...(input.formatText ? ["format"] : []),
      ];
      const candidate = (
        matchState: MatchState,
        reason: SupermarketMatchCandidate["reason"],
      ): SupermarketMatchCandidate => ({
        canonicalFoodKey: target.canonicalFoodKey,
        criteria,
        ediblePart: target.ediblePart,
        matchState,
        reason,
      });

      if (hasExcludedTerm(allSourceTokens, input.excludedTerms)) {
        return [candidate("excluded", "excluded_term")];
      }
      if (input.foodState !== target.foodState) {
        return [candidate("excluded", "food_state_mismatch")];
      }
      if (input.purchaseForm !== target.purchaseForm) {
        return [candidate("excluded", "purchase_form_mismatch")];
      }
      if (input.allergenData === "unknown") {
        return [candidate("review", "allergen_data_unknown")];
      }
      if (input.crossContactData === "unknown") {
        return [candidate("review", "cross_contact_unknown")];
      }
      if (input.gtinConsistency === "conflict") {
        return [candidate("review", "gtin_match_conflict")];
      }
      if (nameMatch && (categoryMatch || ingredientMatch)) {
        return [candidate("exact", "identity_match")];
      }
      return [candidate("review", "weak_identity_evidence")];
    })
    .sort(
      (left, right) =>
        MATCH_STATE_ORDER[left.matchState] - MATCH_STATE_ORDER[right.matchState] ||
        left.canonicalFoodKey.localeCompare(right.canonicalFoodKey, "es"),
    );
}
