import type {
  DietaryPattern,
  EffectiveNutritionFood,
  FoodFunction,
} from "@health-design/domain";

export type GeneratorFoodMetadata = Readonly<{
  aliases: readonly string[];
  allergens: readonly string[];
  canonicalFoodKey: string;
  category: string;
  ciqualCode: string;
  crossContactAllergens: readonly string[];
  dietaryPatterns: readonly DietaryPattern[];
  ediblePart: string;
  foodState: EffectiveNutritionFood["foodState"];
  functions: readonly FoodFunction[];
  intoleranceTags: readonly string[];
  isProteinPowder: boolean;
  name: string;
}>;

const everyPattern = ["omnivore", "pescetarian", "vegetarian", "vegan"] as const;
const animalOnly = ["omnivore"] as const;
const fishPatterns = ["omnivore", "pescetarian"] as const;

const metadata = (
  input: Omit<
    GeneratorFoodMetadata,
    | "aliases"
    | "allergens"
    | "crossContactAllergens"
    | "intoleranceTags"
    | "isProteinPowder"
  > &
    Partial<
      Pick<
        GeneratorFoodMetadata,
        | "aliases"
        | "allergens"
        | "crossContactAllergens"
        | "intoleranceTags"
        | "isProteinPowder"
      >
    >,
): GeneratorFoodMetadata => ({
  aliases: [],
  allergens: [],
  crossContactAllergens: [],
  intoleranceTags: [],
  isProteinPowder: false,
  ...input,
});

export const CIQUAL_2025_GENERATOR_CORE = [
  metadata({
    canonicalFoodKey: "food:ciqual-36017",
    category: "meat",
    ciqualCode: "36017",
    dietaryPatterns: animalOnly,
    ediblePart: "meat_without_skin",
    foodState: "raw",
    functions: ["protein"],
    name: "Pechuga de pollo",
  }),
  metadata({
    canonicalFoodKey: "food:ciqual-36304",
    category: "meat",
    ciqualCode: "36304",
    dietaryPatterns: animalOnly,
    ediblePart: "meat",
    foodState: "raw",
    functions: ["protein"],
    name: "Pechuga de pavo",
  }),
  metadata({
    canonicalFoodKey: "food:ciqual-26161",
    category: "fish",
    ciqualCode: "26161",
    dietaryPatterns: fishPatterns,
    ediblePart: "meat",
    foodState: "raw",
    functions: ["protein"],
    name: "Salmón salvaje",
  }),
  metadata({
    canonicalFoodKey: "food:ciqual-20535",
    category: "legumes",
    ciqualCode: "20535",
    dietaryPatterns: everyPattern,
    ediblePart: "dry_seed",
    foodState: "raw",
    functions: ["protein"],
    name: "Lentejas rojas secas",
  }),
  metadata({
    canonicalFoodKey: "food:ciqual-20516",
    category: "legumes",
    ciqualCode: "20516",
    dietaryPatterns: everyPattern,
    ediblePart: "dry_seed",
    foodState: "raw",
    functions: ["protein"],
    name: "Garbanzos secos",
  }),
  metadata({
    canonicalFoodKey: "food:ciqual-20525",
    category: "legumes",
    ciqualCode: "20525",
    dietaryPatterns: everyPattern,
    ediblePart: "dry_seed",
    foodState: "raw",
    functions: ["protein"],
    name: "Alubias rojas secas",
  }),
  metadata({
    canonicalFoodKey: "food:ciqual-9100",
    category: "cereals",
    ciqualCode: "9100",
    dietaryPatterns: everyPattern,
    ediblePart: "dry_product",
    foodState: "raw",
    functions: ["carbohydrate_base"],
    name: "Arroz blanco",
  }),
  metadata({
    canonicalFoodKey: "food:ciqual-9102",
    category: "cereals",
    ciqualCode: "9102",
    dietaryPatterns: everyPattern,
    ediblePart: "dry_product",
    foodState: "raw",
    functions: ["carbohydrate_base"],
    name: "Arroz integral",
  }),
  metadata({
    canonicalFoodKey: "food:ciqual-9108",
    category: "cereals",
    ciqualCode: "9108",
    dietaryPatterns: everyPattern,
    ediblePart: "dry_product",
    foodState: "raw",
    functions: ["carbohydrate_base"],
    name: "Arroz salvaje",
  }),
  metadata({
    canonicalFoodKey: "food:ciqual-9119",
    category: "cereals",
    ciqualCode: "9119",
    dietaryPatterns: everyPattern,
    ediblePart: "dry_product",
    foodState: "raw",
    functions: ["carbohydrate_base"],
    name: "Arroz basmati o thai",
  }),
  metadata({
    canonicalFoodKey: "food:ciqual-9310",
    category: "cereals",
    ciqualCode: "9310",
    crossContactAllergens: ["gluten"],
    dietaryPatterns: everyPattern,
    ediblePart: "dry_product",
    foodState: "raw",
    functions: ["carbohydrate_base"],
    intoleranceTags: ["gluten"],
    name: "Avena",
  }),
  metadata({
    canonicalFoodKey: "food:ciqual-9340",
    category: "cereals",
    ciqualCode: "9340",
    dietaryPatterns: everyPattern,
    ediblePart: "dry_product",
    foodState: "raw",
    functions: ["carbohydrate_base"],
    name: "Quinoa",
  }),
  metadata({
    canonicalFoodKey: "food:ciqual-9810",
    category: "cereals",
    ciqualCode: "9810",
    allergens: ["gluten"],
    dietaryPatterns: everyPattern,
    ediblePart: "dry_product",
    foodState: "raw",
    functions: ["carbohydrate_base"],
    intoleranceTags: ["gluten"],
    name: "Pasta seca",
  }),
  metadata({
    canonicalFoodKey: "food:ciqual-4008",
    category: "tubers",
    ciqualCode: "4008",
    dietaryPatterns: everyPattern,
    ediblePart: "without_skin",
    foodState: "raw",
    functions: ["carbohydrate_base"],
    name: "Patata sin piel",
  }),
  metadata({
    canonicalFoodKey: "food:ciqual-17130",
    category: "fats",
    ciqualCode: "17130",
    dietaryPatterns: everyPattern,
    ediblePart: "whole_edible_product",
    foodState: "unspecified",
    functions: ["fat"],
    name: "Aceite de colza",
  }),
  metadata({
    canonicalFoodKey: "food:ciqual-17100",
    category: "fats",
    ciqualCode: "17100",
    dietaryPatterns: everyPattern,
    ediblePart: "whole_edible_product",
    foodState: "unspecified",
    functions: ["fat"],
    name: "Aceite de aguacate",
  }),
  metadata({
    canonicalFoodKey: "food:ciqual-17350",
    category: "fats",
    ciqualCode: "17350",
    dietaryPatterns: everyPattern,
    ediblePart: "whole_edible_product",
    foodState: "unspecified",
    functions: ["fat"],
    name: "Aceite de semillas de uva",
  }),
  metadata({
    canonicalFoodKey: "food:ciqual-15000",
    category: "nuts",
    ciqualCode: "15000",
    allergens: ["tree_nuts"],
    dietaryPatterns: everyPattern,
    ediblePart: "whole_edible_product",
    foodState: "unspecified",
    functions: ["fat"],
    name: "Almendras con piel",
  }),
  metadata({
    canonicalFoodKey: "food:ciqual-15005",
    category: "nuts",
    ciqualCode: "15005",
    allergens: ["tree_nuts"],
    dietaryPatterns: everyPattern,
    ediblePart: "kernel",
    foodState: "unspecified",
    functions: ["fat"],
    name: "Nueces",
  }),
  metadata({
    canonicalFoodKey: "food:ciqual-13039",
    category: "fruit",
    ciqualCode: "13039",
    dietaryPatterns: everyPattern,
    ediblePart: "flesh_and_skin",
    foodState: "raw",
    functions: ["fruit_vegetable"],
    name: "Manzana con piel",
  }),
  metadata({
    canonicalFoodKey: "food:ciqual-20057",
    category: "vegetables",
    ciqualCode: "20057",
    dietaryPatterns: everyPattern,
    ediblePart: "whole_edible_product",
    foodState: "raw",
    functions: ["fruit_vegetable"],
    name: "Brócoli",
  }),
  metadata({
    canonicalFoodKey: "food:ciqual-20280",
    category: "vegetables",
    ciqualCode: "20280",
    dietaryPatterns: everyPattern,
    ediblePart: "whole_edible_product",
    foodState: "raw",
    functions: ["fruit_vegetable"],
    name: "Romanesco",
  }),
  metadata({
    canonicalFoodKey: "food:ciqual-20020",
    category: "vegetables",
    ciqualCode: "20020",
    dietaryPatterns: everyPattern,
    ediblePart: "flesh_and_skin",
    foodState: "raw",
    functions: ["fruit_vegetable"],
    name: "Calabacín",
  }),
  metadata({
    canonicalFoodKey: "food:ciqual-20059",
    category: "vegetables",
    ciqualCode: "20059",
    dietaryPatterns: everyPattern,
    ediblePart: "whole_edible_product",
    foodState: "raw",
    functions: ["fruit_vegetable"],
    name: "Espinacas",
  }),
] as const satisfies readonly GeneratorFoodMetadata[];

export const GENERATOR_METADATA_BY_FOOD_KEY = new Map(
  CIQUAL_2025_GENERATOR_CORE.map((entry) => [entry.canonicalFoodKey, entry]),
);
