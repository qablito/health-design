import { LEGACY_FOOD_PREPARATION } from "@health-design/contracts";
import type { EffectiveNutritionFood, FoodPreparation } from "@health-design/domain";

export const PREPARATION_RULE_SET_VERSION = "meal-preparation-v1";
export const LEGACY_PREPARATION_RULE_SET_VERSION = "legacy-fallback-v1";

type PreparationInput = Pick<
  EffectiveNutritionFood,
  "canonicalFoodKey" | "category" | "foodState"
>;

function completePreparation(ruleId: string, instruction: string): FoodPreparation {
  return {
    instruction,
    ruleId,
    ruleSetVersion: PREPARATION_RULE_SET_VERSION,
    status: "complete",
  };
}

const CATEGORY_RULES: Readonly<Record<string, FoodPreparation>> = {
  "carbohydrate_base:raw": completePreparation(
    "category.carbohydrate-base.raw",
    "Cuece en agua o cocina con el método habitual hasta que quede tierno.",
  ),
  "cereal_products:unspecified": completePreparation(
    "category.cereal-products.unspecified",
    "Corta o porciona y calienta o cocina según el formato del alimento.",
  ),
  "cereals:raw": completePreparation(
    "category.cereals.raw",
    "Cocina siguiendo la preparación habitual del alimento y sirve la cantidad indicada.",
  ),
  "fats:unspecified": completePreparation(
    "category.fats.unspecified",
    "Añade directamente a la comida o consume por separado según el alimento.",
  ),
  "legumes:raw": completePreparation(
    "category.legumes.raw",
    "Cuece hasta que estén tiernas y completamente cocinadas; remoja antes cuando corresponda.",
  ),
  "legumes:unspecified": completePreparation(
    "category.legumes.unspecified",
    "Corta o porciona y cocina a la plancha, al horno o salteado.",
  ),
  "meat:raw": completePreparation(
    "category.meat.raw",
    "Cocina completamente antes de consumir y sirve con el resto de la comida.",
  ),
  "produce:raw": completePreparation(
    "category.produce.raw",
    "Lava y prepara al gusto; consume en crudo o cocina cuando corresponda.",
  ),
  "supplement:unspecified": completePreparation(
    "category.powder.unspecified",
    "Mezcla con el líquido previsto en la comida hasta integrar por completo.",
  ),
};

const CANONICAL_RULES: Readonly<Record<string, FoodPreparation>> = {
  "food:oat-flakes": completePreparation(
    "food.oat-flakes",
    "Mezcla con agua o leche y cocina hasta obtener la textura deseada; también puede dejarse en remojo.",
  ),
  "food:pasta": completePreparation(
    "food.pasta",
    "Cuece en agua hasta el punto deseado, escurre y sirve la cantidad indicada.",
  ),
  "food:potato": completePreparation(
    "food.potato",
    "Lava, pela si lo deseas y cuece, hornea o cocina al vapor hasta que quede tierna.",
  ),
  "food:protein-powder": completePreparation(
    "food.protein-powder",
    "Mezcla con agua o leche hasta que no queden grumos y consume dentro de la comida prevista.",
  ),
};

export function resolveFoodPreparation(food: PreparationInput): FoodPreparation {
  return (
    CANONICAL_RULES[food.canonicalFoodKey] ??
    CATEGORY_RULES[`${food.category}:${food.foodState}`] ??
    LEGACY_FOOD_PREPARATION
  );
}
