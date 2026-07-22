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

  it("normaliza plural y descriptores de estado sin relajar la identidad", () => {
    expect(
      generateSupermarketMatchCandidates({
        ...base,
        name: "Filetes de pechugas de pollo",
      })[0],
    ).toMatchObject({ canonicalFoodKey: "food:ciqual-36017" });
  });

  it("normaliza plurales españoles terminados en -ones", () => {
    expect(
      generateSupermarketMatchCandidates({
        ...base,
        categoryPath: ["Fruta y verdura", "Verdura"],
        ingredients: [],
        name: "Champiñones blancos",
        targets: [
          {
            canonicalFoodKey: "food:ciqual-30000",
            categoryTerms: [],
            ediblePart: "whole_edible_product",
            foodState: "raw",
            name: "Champiñón",
            purchaseForm: "fresh",
          },
        ],
      })[0],
    ).toMatchObject({ canonicalFoodKey: "food:ciqual-30000" });
  });

  it.each([
    ["food:ciqual-9100", "Arroz blanco seco", "Arroz redondo Hacendado"],
    ["food:ciqual-9681", "Cuscús seco", "Cous cous mediano Hacendado"],
    ["food:ciqual-4101", "Boniato", "Batata"],
    ["food:ciqual-15034", "Lino molido", "Semillas de lino dorado"],
  ])("crea revisión por alias curado para %s", (canonicalFoodKey, name, skuName) => {
    const [candidate] = generateSupermarketMatchCandidates({
      ...base,
      categoryPath: [],
      foodState: canonicalFoodKey === "food:ciqual-15034" ? "unspecified" : "raw",
      gtinConsistency: "not_available",
      ingredients: [],
      name: skuName,
      purchaseForm: canonicalFoodKey === "food:ciqual-4101" ? "fresh" : "dry",
      targets: [
        {
          canonicalFoodKey,
          categoryTerms: [],
          ediblePart: "whole_edible_product",
          foodState: canonicalFoodKey === "food:ciqual-15034" ? "unspecified" : "raw",
          name,
          purchaseForm: canonicalFoodKey === "food:ciqual-4101" ? "fresh" : "dry",
        },
      ],
    });

    expect(candidate).toMatchObject({
      canonicalFoodKey,
      matchState: "review",
      reason: "weak_identity_evidence",
    });
    expect(candidate?.criteria).toContain("curated_alias");
  });

  it.each([
    ["food:ciqual-15000", "Almendras con piel", "Almendra natural", "natural"],
    ["food:ciqual-13039", "Manzana con piel", "Manzana golden", "fresh"],
    ["food:ciqual-26161", "Salmón salvaje", "Salmón en porciones", "fresh"],
    ["food:ciqual-4008", "Patata sin piel", "Patata para cocer", "fresh"],
  ])(
    "reconcilia el nombre canónico remoto de %s sin aprobarlo automáticamente",
    (canonicalFoodKey, name, skuName, purchaseForm) => {
      const [candidate] = generateSupermarketMatchCandidates({
        ...base,
        categoryPath: [],
        foodState: canonicalFoodKey === "food:ciqual-15000" ? "unspecified" : "raw",
        gtinConsistency: "not_available",
        ingredients: [],
        name: skuName,
        purchaseForm: purchaseForm as "fresh" | "natural",
        targets: [
          {
            canonicalFoodKey,
            categoryTerms: [],
            ediblePart: "whole_edible_product",
            foodState: canonicalFoodKey === "food:ciqual-15000" ? "unspecified" : "raw",
            name,
            purchaseForm: purchaseForm as "fresh" | "natural",
          },
        ],
      });

      expect(candidate).toMatchObject({
        canonicalFoodKey,
        matchState: "review",
        reason: "weak_identity_evidence",
      });
      expect(candidate?.criteria).toContain("curated_alias");
    },
  );

  it("rechaza alimentos preparados que contienen el nombre de una fruta", () => {
    expect(
      generateSupermarketMatchCandidates({
        ...base,
        categoryPath: [],
        foodState: "cooked",
        gtinConsistency: "not_available",
        ingredients: [],
        name: "Papilla de pera y manzana",
        purchaseForm: "prepared",
        targets: [
          {
            canonicalFoodKey: "food:ciqual-13039",
            categoryTerms: [],
            ediblePart: "whole_edible_product",
            foodState: "raw",
            name: "Manzana con piel",
            purchaseForm: "fresh",
          },
        ],
      }),
    ).toEqual([]);
  });

  it("no usa un alias curado cuando aparece un descriptor incompatible", () => {
    const target = {
      canonicalFoodKey: "food:ciqual-9100",
      categoryTerms: [],
      ediblePart: "dry_product",
      foodState: "raw" as const,
      name: "Arroz blanco seco",
      purchaseForm: "dry" as const,
    };

    expect(
      generateSupermarketMatchCandidates({
        ...base,
        categoryPath: [],
        ingredients: [],
        name: "Arroz integral largo",
        purchaseForm: "dry",
        targets: [target],
      }),
    ).toEqual([]);
  });

  it("mantiene el queso semicurado como revisión explícita, no como equivalencia silenciosa", () => {
    const [candidate] = generateSupermarketMatchCandidates({
      ...base,
      categoryPath: ["Quesos"],
      foodState: "unspecified",
      gtinConsistency: "not_available",
      ingredients: [],
      name: "Queso emmental de vaca Hacendado",
      purchaseForm: "prepared",
      targets: [
        {
          canonicalFoodKey: "food:bedca-2515",
          categoryTerms: [],
          ediblePart: "whole_edible_product",
          foodState: "unspecified",
          name: "Queso semicurado de vaca",
          purchaseForm: "prepared",
        },
      ],
    });

    expect(candidate).toMatchObject({
      canonicalFoodKey: "food:bedca-2515",
      matchState: "review",
      reason: "weak_identity_evidence",
    });
    expect(candidate?.criteria).toContain("curated_alias");
  });

  it("acepta como revisión cortes magros explícitos de vacuno para ternera magra", () => {
    const [candidate] = generateSupermarketMatchCandidates({
      ...base,
      categoryPath: ["Carne", "Vacuno"],
      ingredients: [],
      name: "Solomillo de vacuno",
      targets: [
        {
          canonicalFoodKey: "food:ciqual-6106",
          categoryTerms: [],
          ediblePart: "lean_meat",
          foodState: "raw",
          name: "Ternera magra cruda",
          purchaseForm: "fresh",
        },
      ],
    });

    expect(candidate).toMatchObject({
      canonicalFoodKey: "food:ciqual-6106",
      matchState: "review",
      reason: "weak_identity_evidence",
    });
    expect(candidate?.criteria).toContain("curated_alias");
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
