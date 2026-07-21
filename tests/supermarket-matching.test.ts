import { describe, expect, it } from "vitest";

import {
  generateSupermarketMatchCandidates,
  type SupermarketMatchCandidateInput,
} from "@health-design/catalog/supermarkets";

const base: SupermarketMatchCandidateInput = {
  allergenData: "known",
  categoryPath: ["Carne", "Pollo"],
  crossContactData: "known",
  excludedTerms: [],
  externalSku: "sku-pollo-1",
  foodState: "raw",
  formatText: "Bandeja 500 g",
  gtinConsistency: "consistent",
  ingredients: ["pechuga de pollo"],
  name: "Pechuga de pollo fileteada",
  purchaseForm: "fresh",
  targets: [
    {
      canonicalFoodKey: "food:ciqual-36017",
      categoryTerms: ["carne", "pollo"],
      ediblePart: "meat_without_skin",
      foodState: "raw",
      name: "Pechuga de pollo cruda",
      purchaseForm: "fresh",
    },
  ],
};

describe("matching determinista de SKU T17", () => {
  it("usa palabras completas, categoría, formato e ingredientes", () => {
    const [candidate] = generateSupermarketMatchCandidates(base);

    expect(candidate).toMatchObject({
      canonicalFoodKey: "food:ciqual-36017",
      matchState: "exact",
    });
    expect(candidate?.criteria).toEqual(
      expect.arrayContaining(["category", "ingredients", "name_words"]),
    );

    expect(
      generateSupermarketMatchCandidates({
        ...base,
        categoryPath: ["Hogar"],
        ingredients: [],
        name: "Sartén con acabado apollonado",
      }),
    ).toEqual([]);
  });

  it("aplica exclusiones antes de inclusiones", () => {
    expect(
      generateSupermarketMatchCandidates({
        ...base,
        excludedTerms: ["marinada"],
        name: "Pechuga de pollo marinada",
      })[0],
    ).toMatchObject({ matchState: "excluded", reason: "excluded_term" });
  });

  it("no mezcla estado alimentario ni forma de compra", () => {
    expect(
      generateSupermarketMatchCandidates({ ...base, foodState: "cooked" })[0],
    ).toMatchObject({ matchState: "excluded", reason: "food_state_mismatch" });
    expect(
      generateSupermarketMatchCandidates({ ...base, purchaseForm: "marinated" })[0],
    ).toMatchObject({ matchState: "excluded", reason: "purchase_form_mismatch" });
  });

  it("mantiene review si alérgeno, contacto cruzado o GTIN no son seguros", () => {
    expect(
      generateSupermarketMatchCandidates({ ...base, allergenData: "unknown" })[0],
    ).toMatchObject({ matchState: "review", reason: "allergen_data_unknown" });
    expect(
      generateSupermarketMatchCandidates({ ...base, crossContactData: "unknown" })[0],
    ).toMatchObject({ matchState: "review", reason: "cross_contact_unknown" });
    expect(
      generateSupermarketMatchCandidates({ ...base, gtinConsistency: "conflict" })[0],
    ).toMatchObject({ matchState: "review", reason: "gtin_match_conflict" });
  });

  it("produce candidatos, pero nunca reglas activas", () => {
    expect(generateSupermarketMatchCandidates(base)[0]).not.toHaveProperty("status");
  });
});
