import type {
  DietaryPattern,
  EffectiveNutritionFood,
  FoodFunction,
} from "@health-design/domain";

export type GeneratorNutritionSourceKey =
  "bedca_public" | "ciqual_2025" | "fineli" | "usda_sr_legacy";

export type GeneratorFoodMetadata = Readonly<{
  aliases: readonly string[];
  allergens: readonly string[];
  canonicalFoodKey: string;
  category: string;
  crossContactAllergens: readonly string[];
  dietaryPatterns: readonly DietaryPattern[];
  ediblePart: string;
  foodState: EffectiveNutritionFood["foodState"];
  functions: readonly FoodFunction[];
  intoleranceTags: readonly string[];
  isProteinPowder: boolean;
  name: string;
  sourceCode: string;
  sourceKey: GeneratorNutritionSourceKey;
  sourceVersion: string;
}>;

type FoodInput = Omit<
  GeneratorFoodMetadata,
  | "aliases"
  | "allergens"
  | "canonicalFoodKey"
  | "crossContactAllergens"
  | "intoleranceTags"
  | "isProteinPowder"
  | "sourceCode"
  | "sourceKey"
  | "sourceVersion"
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
  >;

const everyPattern = ["omnivore", "pescetarian", "vegetarian", "vegan"] as const;
const animalOnly = ["omnivore"] as const;
const fishPatterns = ["omnivore", "pescetarian"] as const;
const lactoOvoPatterns = ["omnivore", "pescetarian", "vegetarian"] as const;

const sourceFood = (
  sourceKey: GeneratorNutritionSourceKey,
  sourceVersion: string,
  code: string,
  input: FoodInput,
): GeneratorFoodMetadata => ({
  aliases: [],
  allergens: [],
  canonicalFoodKey: `food:${
    sourceKey === "ciqual_2025"
      ? "ciqual"
      : sourceKey === "bedca_public"
        ? "bedca"
        : sourceKey === "usda_sr_legacy"
          ? "usda-sr"
          : "fineli"
  }-${code}`,
  crossContactAllergens: [],
  intoleranceTags: [],
  isProteinPowder: false,
  sourceCode: code,
  sourceKey,
  sourceVersion,
  ...input,
});

const ciqual = (code: string, input: FoodInput) =>
  sourceFood("ciqual_2025", "2025", code, input);
const fineli = (code: string, input: FoodInput) =>
  sourceFood("fineli", "20.0", code, input);
const usdaSr = (code: string, input: FoodInput) =>
  sourceFood("usda_sr_legacy", "2018-04", code, input);
const bedca = (code: string, input: FoodInput) =>
  sourceFood("bedca_public", "public-database", code, input);

const plant = (
  name: string,
  category: string,
  ediblePart: string,
  foodState: EffectiveNutritionFood["foodState"],
  functions: readonly FoodFunction[],
  options: Partial<FoodInput> = {},
): FoodInput => ({
  category,
  dietaryPatterns: everyPattern,
  ediblePart,
  foodState,
  functions,
  name,
  ...options,
});

const animal = (
  name: string,
  category: string,
  ediblePart: string,
  foodState: EffectiveNutritionFood["foodState"],
  options: Partial<FoodInput> = {},
): FoodInput => ({
  category,
  dietaryPatterns: animalOnly,
  ediblePart,
  foodState,
  functions: ["protein"],
  name,
  ...options,
});

const fish = (
  name: string,
  ediblePart: string,
  foodState: EffectiveNutritionFood["foodState"],
  options: Partial<FoodInput> = {},
): FoodInput => ({
  allergens: ["fish"],
  category: "fish",
  dietaryPatterns: fishPatterns,
  ediblePart,
  foodState,
  functions: ["protein"],
  name,
  ...options,
});

const dairy = (
  name: string,
  ediblePart: string,
  options: Partial<FoodInput> = {},
): FoodInput => ({
  allergens: ["milk"],
  category: "dairy",
  dietaryPatterns: lactoOvoPatterns,
  ediblePart,
  foodState: "unspecified",
  functions: ["protein"],
  intoleranceTags: ["lactose"],
  name,
  ...options,
});

export const CIQUAL_2025_GENERATOR_CORE = [
  ciqual("36017", animal("Pechuga de pollo cruda", "meat", "meat_without_skin", "raw")),
  ciqual(
    "36019",
    animal("Contramuslo de pollo sin piel crudo", "meat", "meat_without_skin", "raw"),
  ),
  ciqual("36304", animal("Pechuga de pavo cruda", "meat", "meat", "raw")),
  ciqual("6106", animal("Ternera magra cruda", "meat", "lean_meat", "raw")),
  ciqual("28204", animal("Lomo de cerdo crudo", "meat", "meat", "raw")),
  ciqual("34001", animal("Conejo crudo", "meat", "meat", "raw")),
  ciqual(
    "22000",
    animal("Huevo de gallina", "eggs", "without_shell", "raw", {
      allergens: ["egg"],
      dietaryPatterns: lactoOvoPatterns,
    }),
  ),
  ciqual("26044", fish("Merluza cruda", "flesh", "raw")),
  ciqual("26161", fish("Salmón crudo", "flesh", "raw")),
  ciqual("26039", fish("Atún al natural escurrido", "drained_product", "cooked")),
  ciqual(
    "10021",
    animal("Gamba pelada cruda", "seafood", "peeled_flesh", "raw", {
      allergens: ["crustaceans"],
      dietaryPatterns: fishPatterns,
    }),
  ),
  ciqual(
    "10001",
    animal("Calamar crudo", "seafood", "flesh", "raw", {
      allergens: ["molluscs"],
      dietaryPatterns: fishPatterns,
    }),
  ),
  ciqual(
    "25598",
    plant(
      "Seitán natural",
      "plant_protein",
      "whole_edible_product",
      "unspecified",
      ["protein"],
      {
        allergens: ["gluten"],
        intoleranceTags: ["gluten"],
      },
    ),
  ),
  ciqual(
    "20034",
    plant("Cebolla", "vegetables", "without_skin", "raw", ["fruit_vegetable"]),
  ),
  ciqual(
    "20020",
    plant("Calabacín", "vegetables", "flesh_and_skin", "raw", ["fruit_vegetable"]),
  ),
  ciqual(
    "20053",
    plant("Berenjena", "vegetables", "whole_edible_product", "raw", [
      "fruit_vegetable",
    ]),
  ),
  ciqual(
    "20057",
    plant("Brócoli", "vegetables", "whole_edible_product", "raw", ["fruit_vegetable"]),
  ),
  ciqual(
    "20016",
    plant("Coliflor", "vegetables", "whole_edible_product", "raw", ["fruit_vegetable"]),
  ),
  ciqual(
    "20059",
    plant("Espinaca", "vegetables", "whole_edible_product", "raw", ["fruit_vegetable"]),
  ),
  ciqual(
    "20171",
    plant("Lechuga romana", "vegetables", "whole_edible_product", "raw", [
      "fruit_vegetable",
    ]),
  ),
  ciqual(
    "20019",
    plant("Pepino", "vegetables", "flesh_and_skin", "raw", ["fruit_vegetable"]),
  ),
  ciqual(
    "20061",
    plant("Judía verde", "vegetables", "whole_edible_product", "raw", [
      "fruit_vegetable",
    ]),
  ),
  ciqual(
    "13039",
    plant("Manzana", "fruit", "flesh_and_skin", "raw", ["fruit_vegetable"]),
  ),
  ciqual("13037", plant("Pera", "fruit", "flesh_and_skin", "raw", ["fruit_vegetable"])),
  ciqual(
    "13021",
    plant("Kiwi", "fruit", "flesh_without_skin", "raw", ["fruit_vegetable"]),
  ),
  ciqual(
    "9100",
    plant("Arroz blanco seco", "cereals", "dry_product", "raw", ["carbohydrate_base"]),
  ),
  ciqual(
    "9810",
    plant("Pasta seca", "cereals", "dry_product", "raw", ["carbohydrate_base"], {
      allergens: ["gluten"],
      intoleranceTags: ["gluten"],
    }),
  ),
  ciqual(
    "7110",
    plant(
      "Pan integral",
      "cereals",
      "whole_edible_product",
      "unspecified",
      ["carbohydrate_base"],
      {
        allergens: ["gluten"],
        intoleranceTags: ["gluten"],
      },
    ),
  ),
  ciqual(
    "9310",
    plant("Avena", "cereals", "dry_product", "raw", ["carbohydrate_base"], {
      crossContactAllergens: ["gluten"],
      intoleranceTags: ["gluten"],
    }),
  ),
  ciqual(
    "9681",
    plant("Cuscús seco", "cereals", "dry_product", "raw", ["carbohydrate_base"], {
      allergens: ["gluten"],
      intoleranceTags: ["gluten"],
    }),
  ),
  ciqual(
    "9340",
    plant("Quinoa seca", "cereals", "dry_product", "raw", ["carbohydrate_base"]),
  ),
  ciqual(
    "4008",
    plant("Patata", "tubers", "without_skin", "raw", ["carbohydrate_base"]),
  ),
  ciqual(
    "4101",
    plant("Boniato", "tubers", "whole_edible_product", "raw", ["carbohydrate_base"]),
  ),
  ciqual(
    "20359",
    plant("Lenteja seca", "legumes", "dry_seed", "raw", [
      "carbohydrate_base",
      "protein",
    ]),
  ),
  ciqual(
    "20516",
    plant("Garbanzo seco", "legumes", "dry_seed", "raw", [
      "carbohydrate_base",
      "protein",
    ]),
  ),
  ciqual(
    "20525",
    plant("Alubia seca", "legumes", "dry_seed", "raw", [
      "carbohydrate_base",
      "protein",
    ]),
  ),
  ciqual(
    "20072",
    plant("Guisante", "legumes", "whole_edible_product", "raw", [
      "carbohydrate_base",
      "protein",
    ]),
  ),
  ciqual("19033", dairy("Leche semidesnatada", "whole_edible_product")),
  ciqual("19646", dairy("Queso fresco batido natural", "whole_edible_product")),
  ciqual(
    "15000",
    plant("Almendra natural", "nuts", "whole_edible_product", "unspecified", ["fat"], {
      allergens: ["tree_nuts"],
    }),
  ),
  ciqual(
    "15005",
    plant("Nuez natural", "nuts", "kernel", "unspecified", ["fat"], {
      allergens: ["tree_nuts"],
    }),
  ),
  ciqual("15047", plant("Chía", "seeds", "dry_seed", "unspecified", ["fat"])),
  ciqual("15034", plant("Lino molido", "seeds", "ground_seed", "unspecified", ["fat"])),
  ciqual("26034", fish("Sardina en conserva escurrida", "drained_product", "cooked")),
  ciqual(
    "26123",
    fish("Caballa en conserva al natural escurrida", "drained_product", "cooked"),
  ),
  ciqual(
    "10013",
    animal("Mejillón cocido sin salsa", "seafood", "whole_edible_product", "cooked", {
      allergens: ["molluscs"],
      dietaryPatterns: fishPatterns,
    }),
  ),
  ciqual("26080", fish("Dorada cruda", "flesh", "raw")),
  ciqual("21505", animal("Cordero magro crudo", "meat", "lean_meat", "raw")),
  ciqual(
    "20917",
    plant(
      "Tempeh natural",
      "plant_protein",
      "whole_edible_product",
      "unspecified",
      ["protein"],
      { allergens: ["soy"] },
    ),
  ),
  ciqual(
    "20139",
    plant("Calabaza", "vegetables", "whole_edible_product", "raw", ["fruit_vegetable"]),
  ),
  ciqual(
    "20067",
    plant("Alcachofa al natural escurrida", "vegetables", "drained_product", "cooked", [
      "fruit_vegetable",
    ]),
  ),
  ciqual(
    "20279",
    plant("Espárrago verde", "vegetables", "whole_edible_product", "raw", [
      "fruit_vegetable",
    ]),
  ),
  ciqual(
    "20056",
    plant("Champiñón", "vegetables", "whole_edible_product", "raw", [
      "fruit_vegetable",
    ]),
  ),
  ciqual(
    "20039",
    plant("Puerro", "vegetables", "whole_edible_product", "raw", ["fruit_vegetable"]),
  ),
  ciqual(
    "13043",
    plant("Melocotón", "fruit", "flesh_and_skin_without_stone", "raw", [
      "fruit_vegetable",
    ]),
  ),
  ciqual(
    "13028",
    plant("Arándano", "fruit", "whole_edible_product", "raw", ["fruit_vegetable"]),
  ),
  ciqual(
    "13395",
    plant("Uva", "fruit", "whole_edible_product", "raw", ["fruit_vegetable"]),
  ),
  ciqual(
    "9380",
    plant("Trigo sarraceno seco", "cereals", "dry_product", "raw", [
      "carbohydrate_base",
    ]),
  ),
  ciqual(
    "20066",
    plant("Maíz dulce cocido escurrido", "cereals", "drained_product", "cooked", [
      "carbohydrate_base",
    ]),
  ),
  ciqual("19865", dairy("Kéfir natural", "whole_edible_product")),

  // Núcleo anterior conservado; T17-P0 no los añade ni los retira.
  ciqual(
    "20535",
    plant("Lentejas rojas secas", "legumes", "dry_seed", "raw", ["protein"]),
  ),
  ciqual(
    "9102",
    plant("Arroz integral", "cereals", "dry_product", "raw", ["carbohydrate_base"]),
  ),
  ciqual(
    "9108",
    plant("Arroz salvaje", "cereals", "dry_product", "raw", ["carbohydrate_base"]),
  ),
  ciqual(
    "9119",
    plant("Arroz basmati o thai", "cereals", "dry_product", "raw", [
      "carbohydrate_base",
    ]),
  ),
  ciqual(
    "17130",
    plant("Aceite de colza", "fats", "whole_edible_product", "unspecified", ["fat"]),
  ),
  ciqual(
    "17100",
    plant("Aceite de aguacate", "fats", "whole_edible_product", "unspecified", ["fat"]),
  ),
  ciqual(
    "17350",
    plant("Aceite de semillas de uva", "fats", "whole_edible_product", "unspecified", [
      "fat",
    ]),
  ),
  ciqual(
    "20280",
    plant("Romanesco", "vegetables", "whole_edible_product", "raw", [
      "fruit_vegetable",
    ]),
  ),
  ciqual(
    "17270",
    plant(
      "Aceite de oliva virgen extra",
      "fats",
      "whole_edible_product",
      "unspecified",
      ["fat"],
    ),
  ),
] as const satisfies readonly GeneratorFoodMetadata[];

export const FINELI_20_GENERATOR_CORE = [
  fineli("804", fish("Bacalao crudo", "flesh", "raw")),
  fineli(
    "33499",
    plant("Soja texturizada seca", "plant_protein", "dry_product", "raw", ["protein"], {
      allergens: ["soy"],
    }),
  ),
  fineli(
    "352",
    plant("Tomate", "vegetables", "whole_edible_product", "raw", ["fruit_vegetable"]),
  ),
  fineli(
    "386",
    plant("Pimiento rojo", "vegetables", "whole_edible_product", "raw", [
      "fruit_vegetable",
    ]),
  ),
  fineli(
    "300",
    plant("Zanahoria", "vegetables", "without_skin", "raw", ["fruit_vegetable"]),
  ),
  fineli(
    "11049",
    plant("Plátano", "fruit", "flesh_without_skin", "raw", ["fruit_vegetable"]),
  ),
  fineli(
    "11045",
    plant("Naranja", "fruit", "flesh_without_skin", "raw", ["fruit_vegetable"]),
  ),
  fineli(
    "11046",
    plant("Mandarina", "fruit", "flesh_without_skin", "raw", ["fruit_vegetable"]),
  ),
  fineli(
    "447",
    plant("Fresa", "fruit", "whole_edible_product", "raw", ["fruit_vegetable"]),
  ),
  fineli(
    "477",
    plant("Melón", "fruit", "flesh_without_skin_and_seeds", "raw", ["fruit_vegetable"]),
  ),
  fineli("11736", dairy("Yogur natural sin azúcar", "whole_edible_product")),
  fineli(
    "11057",
    plant("Aguacate", "fruit", "flesh_without_skin_and_stone", "raw", ["fat"]),
  ),
  fineli(
    "34361",
    plant("Mango", "fruit", "flesh_without_skin_and_stone", "raw", ["fruit_vegetable"]),
  ),
  fineli(
    "11056",
    plant("Piña", "fruit", "flesh_without_skin", "raw", ["fruit_vegetable"]),
  ),
  fineli(
    "30208",
    plant(
      "Bebida de avena sin azúcar enriquecida en calcio",
      "plant_drink",
      "whole_edible_product",
      "unspecified",
      ["carbohydrate_base"],
      {
        allergens: ["gluten"],
        intoleranceTags: ["gluten"],
      },
    ),
  ),
] as const satisfies readonly GeneratorFoodMetadata[];

export const USDA_SR_LEGACY_GENERATOR_CORE = [
  usdaSr(
    "172475",
    plant(
      "Tofu firme natural",
      "plant_protein",
      "whole_edible_product",
      "raw",
      ["protein"],
      {
        allergens: ["soy"],
      },
    ),
  ),
  usdaSr(
    "175215",
    plant(
      "Bebida de soja sin azúcar enriquecida en calcio",
      "plant_drink",
      "whole_edible_product",
      "unspecified",
      ["protein"],
      {
        allergens: ["soy"],
      },
    ),
  ),
] as const satisfies readonly GeneratorFoodMetadata[];

export const BEDCA_PUBLIC_GENERATOR_CORE = [
  bedca(
    "2507",
    dairy("Queso fresco de Burgos", "whole_edible_product", {
      foodState: "unspecified",
    }),
  ),
  bedca(
    "2515",
    dairy("Queso semicurado de vaca", "whole_edible_product", {
      foodState: "unspecified",
      functions: ["protein", "fat"],
    }),
  ),
] as const satisfies readonly GeneratorFoodMetadata[];

export const GENERATOR_FOOD_CORE = [
  ...CIQUAL_2025_GENERATOR_CORE,
  ...FINELI_20_GENERATOR_CORE,
  ...USDA_SR_LEGACY_GENERATOR_CORE,
  ...BEDCA_PUBLIC_GENERATOR_CORE,
] as const satisfies readonly GeneratorFoodMetadata[];

export const GENERATOR_METADATA_BY_FOOD_KEY = new Map(
  GENERATOR_FOOD_CORE.map((entry) => [entry.canonicalFoodKey, entry]),
);
