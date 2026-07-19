import type { EffectiveNutritionFood } from "@health-design/domain";

type FoodInput = Omit<
  EffectiveNutritionFood,
  | "allergens"
  | "clinicalNutrients"
  | "crossContactAllergens"
  | "intoleranceTags"
  | "manifestId"
  | "revisionId"
  | "sourceKey"
  | "sourceVersion"
> & {
  allergens?: readonly string[];
  clinicalNutrients?: EffectiveNutritionFood["clinicalNutrients"];
  crossContactAllergens?: readonly string[];
  intoleranceTags?: readonly string[];
};

let ordinal = 1;
const food = (input: FoodInput): EffectiveNutritionFood => {
  const suffix = String(ordinal++).padStart(12, "0");
  return {
    allergens: [],
    clinicalNutrients: {},
    crossContactAllergens: [],
    intoleranceTags: [],
    manifestId: "90000000-0000-4000-8000-000000000001",
    revisionId: `91000000-0000-4000-8000-${suffix}`,
    sourceKey: "ciqual_2025",
    sourceVersion: "2025",
    ...input,
  };
};

const allPatterns = ["omnivore", "pescetarian", "vegetarian", "vegan"] as const;
const animalPatterns = ["omnivore"] as const;

export const effectiveNutritionFoods = [
  food({
    aliases: ["pechuga de pollo"],
    canonicalFoodKey: "food:chicken-breast",
    category: "meat",
    clinicalNutrients: {
      iron: { unit: "mg", value: "0.33" },
      vitamin_b12: { unit: "ug", value: "0.17" },
    },
    dietaryPatterns: animalPatterns,
    ediblePart: "meat_without_skin",
    foodState: "raw",
    functions: ["protein"],
    isProteinPowder: false,
    name: "Pechuga de pollo",
    nutrients: {
      carbohydratesG: "0",
      energyKcal: "110",
      fatG: "1.5",
      fiberG: "0",
      proteinG: "23.4",
    },
  }),
  food({
    aliases: ["pechuga de pavo"],
    canonicalFoodKey: "food:turkey-breast",
    category: "meat",
    dietaryPatterns: animalPatterns,
    ediblePart: "meat",
    foodState: "raw",
    functions: ["protein"],
    isProteinPowder: false,
    name: "Pechuga de pavo",
    nutrients: {
      carbohydratesG: "0",
      energyKcal: "108",
      fatG: "1.48",
      fiberG: "0",
      proteinG: "23.7",
    },
  }),
  food({
    aliases: ["tempe"],
    allergens: ["soy"],
    canonicalFoodKey: "food:tempeh",
    category: "legumes",
    dietaryPatterns: allPatterns,
    ediblePart: "whole_edible_product",
    foodState: "unspecified",
    functions: ["protein"],
    isProteinPowder: false,
    name: "Tempeh",
    nutrients: {
      carbohydratesG: "7.89",
      energyKcal: "157",
      fatG: "4.7",
      fiberG: "6.2",
      proteinG: "16.1",
    },
  }),
  food({
    aliases: [],
    allergens: ["gluten"],
    canonicalFoodKey: "food:seitan",
    category: "cereal_products",
    dietaryPatterns: allPatterns,
    ediblePart: "whole_edible_product",
    foodState: "unspecified",
    functions: ["protein"],
    intoleranceTags: ["gluten"],
    isProteinPowder: false,
    name: "Seitán",
    nutrients: {
      carbohydratesG: "6.74",
      energyKcal: "134",
      fatG: "2.5",
      fiberG: "0.9",
      proteinG: "20.6",
    },
  }),
  food({
    aliases: ["lenteja roja"],
    canonicalFoodKey: "food:red-lentils",
    category: "legumes",
    dietaryPatterns: allPatterns,
    ediblePart: "dry_seed",
    foodState: "raw",
    functions: ["protein"],
    isProteinPowder: false,
    name: "Lentejas rojas secas",
    nutrients: {
      carbohydratesG: "44.9",
      energyKcal: "328",
      fatG: "0.8",
      fiberG: "15.4",
      proteinG: "27.7",
    },
  }),
  food({
    aliases: ["garbanzo"],
    canonicalFoodKey: "food:chickpeas",
    category: "legumes",
    dietaryPatterns: allPatterns,
    ediblePart: "dry_seed",
    foodState: "raw",
    functions: ["protein"],
    isProteinPowder: false,
    name: "Garbanzos secos",
    nutrients: {
      carbohydratesG: "47.5",
      energyKcal: "350",
      fatG: "6.04",
      fiberG: "12.2",
      proteinG: "20.5",
    },
  }),
  food({
    aliases: ["alubia roja"],
    canonicalFoodKey: "food:red-beans",
    category: "legumes",
    dietaryPatterns: allPatterns,
    ediblePart: "dry_seed",
    foodState: "raw",
    functions: ["protein"],
    isProteinPowder: false,
    name: "Alubias rojas secas",
    nutrients: {
      carbohydratesG: "46.1",
      energyKcal: "314",
      fatG: "1.06",
      fiberG: "15.2",
      proteinG: "22.5",
    },
  }),
  food({
    aliases: ["proteina en polvo"],
    allergens: ["milk"],
    canonicalFoodKey: "food:protein-powder",
    category: "supplement",
    dietaryPatterns: ["omnivore", "pescetarian", "vegetarian"],
    ediblePart: "powder",
    foodState: "unspecified",
    functions: ["protein"],
    isProteinPowder: true,
    name: "Proteína en polvo",
    nutrients: {
      carbohydratesG: "7",
      energyKcal: "390",
      fatG: "6",
      fiberG: "0",
      proteinG: "75",
    },
  }),
  ...[
    ["white-rice", "Arroz blanco", "77.5", "350", "0.79", "1.53", "7.02"],
    ["brown-rice", "Arroz integral", "71.4", "350", "2.8", "5", "7.02"],
    ["quinoa", "Quinoa", "58.1", "358", "6.07", "7", "13.2"],
    ["potato", "Patata", "16.2", "80", "0.09", "2.2", "2.02"],
  ].map(([key, name, carbohydratesG, energyKcal, fatG, fiberG, proteinG]) =>
    food({
      aliases: [],
      canonicalFoodKey: `food:${key}`,
      category: "carbohydrate_base",
      dietaryPatterns: allPatterns,
      ediblePart: "whole_edible_product",
      foodState: "raw",
      functions: ["carbohydrate_base"],
      isProteinPowder: false,
      name: name!,
      nutrients: {
        carbohydratesG: carbohydratesG!,
        energyKcal: energyKcal!,
        fatG: fatG!,
        fiberG: fiberG!,
        proteinG: proteinG!,
      },
    }),
  ),
  food({
    aliases: ["copos de avena"],
    canonicalFoodKey: "food:oat-flakes",
    category: "cereals",
    crossContactAllergens: ["gluten"],
    dietaryPatterns: allPatterns,
    ediblePart: "whole_edible_product",
    foodState: "raw",
    functions: ["carbohydrate_base"],
    intoleranceTags: ["gluten"],
    isProteinPowder: false,
    name: "Copos de avena",
    nutrients: {
      carbohydratesG: "55.7",
      energyKcal: "378",
      fatG: "6.9",
      fiberG: "10.6",
      proteinG: "16.9",
    },
  }),
  food({
    aliases: [],
    allergens: ["gluten"],
    canonicalFoodKey: "food:pasta",
    category: "cereals",
    dietaryPatterns: allPatterns,
    ediblePart: "dry_product",
    foodState: "raw",
    functions: ["carbohydrate_base"],
    intoleranceTags: ["gluten"],
    isProteinPowder: false,
    name: "Pasta seca",
    nutrients: {
      carbohydratesG: "72.7",
      energyKcal: "364",
      fatG: "1.6",
      fiberG: "2.91",
      proteinG: "12",
    },
  }),
  ...[
    ["rapeseed-oil", "Aceite de colza", "0", "900", "100", "0", "0"],
    ["olive-oil", "Aceite de oliva", "0", "900", "100", "0", "0"],
    ["sunflower-oil", "Aceite de girasol", "0", "900", "100", "0", "0"],
    ["almonds", "Almendras", "9.51", "615", "51.3", "12.5", "18.8"],
    ["walnuts", "Nueces", "6.88", "709", "67.3", "6.7", "13.3"],
  ].map(([key, name, carbohydratesG, energyKcal, fatG, fiberG, proteinG]) =>
    food({
      aliases: [],
      allergens: key?.endsWith("-oil") ? [] : ["tree_nuts"],
      canonicalFoodKey: `food:${key}`,
      category: "fats",
      dietaryPatterns: allPatterns,
      ediblePart: "whole_edible_product",
      foodState: "unspecified",
      functions: ["fat"],
      isProteinPowder: false,
      name: name!,
      nutrients: {
        carbohydratesG: carbohydratesG!,
        energyKcal: energyKcal!,
        fatG: fatG!,
        fiberG: fiberG!,
        proteinG: proteinG!,
      },
    }),
  ),
  ...[
    ["apple", "Manzana", "11.6", "54", "0.25", "1.4", "0.25"],
    ["broccoli", "Brócoli", "2.15", "31.9", "0.36", "2.6", "2.9"],
    ["carrot", "Zanahoria", "5.16", "30.2", "0.5", "2.9", "0.78"],
    ["zucchini", "Calabacín", "1.75", "16.7", "0.32", "1", "1.21"],
    ["spinach", "Espinacas", "3.06", "33.3", "0.39", "2.6", "2.68"],
  ].map(([key, name, carbohydratesG, energyKcal, fatG, fiberG, proteinG]) =>
    food({
      aliases: [],
      canonicalFoodKey: `food:${key}`,
      category: "produce",
      dietaryPatterns: allPatterns,
      ediblePart: "whole_edible_product",
      foodState: "raw",
      functions: ["fruit_vegetable"],
      isProteinPowder: false,
      name: name!,
      nutrients: {
        carbohydratesG: carbohydratesG!,
        energyKcal: energyKcal!,
        fatG: fatG!,
        fiberG: fiberG!,
        proteinG: proteinG!,
      },
    }),
  ),
] as const satisfies readonly EffectiveNutritionFood[];
