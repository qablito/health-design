import type {
  EffectiveNutritionFood,
  FoodFunction,
  NutritionDay,
  NutritionMeal,
  NutritionMealAnchor,
  NutritionTargets,
  NutritionTotals,
  NutritionWeek,
  PlannedFood,
  PlannedFoodAlternative,
  QuestionnaireAnswers,
} from "@health-design/domain";

import {
  absoluteDecimal,
  addDecimals,
  compareDecimals,
  divideDecimals,
  multiplyDecimals,
  roundDecimal,
  subtractDecimals,
  sumDecimals,
} from "../../decimal.ts";

const PAL_BANDS = {
  high: { center: "1.9", maximum: "2.05", minimum: "1.75" },
  light: { center: "1.55", maximum: "1.65", minimum: "1.45" },
  moderate: { center: "1.7", maximum: "1.8", minimum: "1.6" },
  sedentary: { center: "1.4", maximum: "1.45", minimum: "1.35" },
  very_high: { center: "2.1", maximum: "2.2", minimum: "2" },
} as const;

const GOAL_BANDS = {
  fat_loss: { center: "0.85", maximum: "0.9", minimum: "0.8" },
  maintenance: { center: "1", maximum: "1.05", minimum: "0.95" },
  muscle_gain: { center: "1.05", maximum: "1.1", minimum: "1.025" },
  recomposition: { center: "0.975", maximum: "1", minimum: "0.95" },
} as const;

const TOTAL_KEYS = [
  "energyKcal",
  "proteinG",
  "carbohydratesG",
  "fatG",
  "fiberG",
] as const satisfies readonly (keyof NutritionTotals)[];

function rounded(value: string, scale = 3): string {
  return roundDecimal(value, scale, "half_away_from_zero");
}

function maximum(left: string, right: string): string {
  return compareDecimals(left, right) >= 0 ? left : right;
}

function minimum(left: string, right: string): string {
  return compareDecimals(left, right) <= 0 ? left : right;
}

function withinInclusive(value: string, minimumValue: string, maximumValue: string) {
  return (
    compareDecimals(value, minimumValue) >= 0 &&
    compareDecimals(value, maximumValue) <= 0
  );
}

function midpoint(minimumValue: string, maximumValue: string): string {
  return divideDecimals(addDecimals(minimumValue, maximumValue), "2", 6);
}

function mifflin(
  weightKg: string,
  heightCm: string,
  age: string,
  constant: "5" | "-161",
): string {
  return addDecimals(
    subtractDecimals(
      addDecimals(multiplyDecimals(weightKg, "10"), multiplyDecimals(heightCm, "6.25")),
      multiplyDecimals(age, "5"),
    ),
    constant,
  );
}

function clinicalBoundary(answers: QuestionnaireAnswers): boolean {
  const pregnancy = answers.pregnancyLactation;
  return (
    answers.hasConditions === true ||
    answers.hasMedications === true ||
    (pregnancy !== undefined &&
      pregnancy !== "none" &&
      pregnancy !== "not_applicable") ||
    answers.menopauseStage === "peri" ||
    answers.menopauseStage === "post"
  );
}

function aggressiveTarget(answers: QuestionnaireAnswers): boolean {
  if (
    answers.primaryObjective !== "body_composition_lose_fat" ||
    answers.targetWeightKg === undefined ||
    answers.weightKg === undefined ||
    answers.heightCm === undefined
  ) {
    return false;
  }
  const target = String(answers.targetWeightKg);
  const weight = String(answers.weightKg);
  const heightMetres = divideDecimals(String(answers.heightCm), "100", 6);
  const bmi = divideDecimals(target, multiplyDecimals(heightMetres, heightMetres), 6);
  return (
    compareDecimals(target, multiplyDecimals(weight, "0.8")) < 0 ||
    compareDecimals(bmi, "18.5") < 0
  );
}

function requestedGoal(
  answers: QuestionnaireAnswers,
): "fat_loss" | "maintenance" | "muscle_gain" | "recomposition" {
  switch (answers.primaryObjective) {
    case "body_composition_lose_fat":
      return "fat_loss";
    case "body_composition_gain_muscle":
      return "muscle_gain";
    case "body_composition_recomposition":
      return "recomposition";
    default:
      return "maintenance";
  }
}

function proteinBand(answers: QuestionnaireAnswers): {
  center: string;
  maximum: string;
  minimum: string;
} {
  if (clinicalBoundary(answers)) {
    return { center: "0.915", maximum: "1", minimum: "0.83" };
  }
  if (
    [
      "body_composition_lose_fat",
      "body_composition_gain_muscle",
      "body_composition_recomposition",
      "performance_strength",
      "performance_hypertrophy",
    ].includes(answers.primaryObjective ?? "")
  ) {
    return { center: "1.5", maximum: "1.6", minimum: "1.4" };
  }
  if (answers.trainingMode === "generated" || answers.trainingMode === "own") {
    return { center: "1.4", maximum: "1.6", minimum: "1.2" };
  }
  if (answers.activityLevel === "sedentary") {
    return { center: "0.915", maximum: "1", minimum: "0.83" };
  }
  return { center: "1.1", maximum: "1.2", minimum: "1" };
}

export function calculateNutritionTargets(
  answers: QuestionnaireAnswers,
): NutritionTargets {
  if (
    answers.age === undefined ||
    answers.heightCm === undefined ||
    answers.weightKg === undefined ||
    answers.activityLevel === undefined
  ) {
    throw new Error("nutrition_context_incomplete");
  }

  const uncertainties: Array<{ code: string; messageKey: string }> = [];
  const weight = String(answers.weightKg);
  let restingMinimum: string;
  let restingMaximum: string;
  let restingCenter: string;
  let restingSource: "indirect_calorimetry" | "mifflin_st_jeor";

  if (
    answers.hasIndirectCalorimetry === true &&
    answers.indirectCalorimetryRmrKcal !== undefined
  ) {
    restingMinimum = String(answers.indirectCalorimetryRmrKcal);
    restingMaximum = restingMinimum;
    restingCenter = restingMinimum;
    restingSource = "indirect_calorimetry";
  } else {
    const female = mifflin(
      weight,
      String(answers.heightCm),
      String(answers.age),
      "-161",
    );
    const male = mifflin(weight, String(answers.heightCm), String(answers.age), "5");
    restingSource = "mifflin_st_jeor";
    if (answers.physiologicalSex === "female") {
      restingMinimum = female;
      restingMaximum = female;
      restingCenter = female;
    } else if (answers.physiologicalSex === "male") {
      restingMinimum = male;
      restingMaximum = male;
      restingCenter = male;
    } else {
      restingMinimum = female;
      restingMaximum = male;
      restingCenter = midpoint(female, male);
      uncertainties.push({
        code: "PHYSIOLOGICAL_SEX_CONSTANT_UNAVAILABLE",
        messageKey: "nutrition.uncertainty.physiological_sex_constant",
      });
    }
  }

  const pal = PAL_BANDS[answers.activityLevel];
  const conservative = clinicalBoundary(answers) || aggressiveTarget(answers);
  if (clinicalBoundary(answers)) {
    uncertainties.push({
      code: "CLINICAL_RULES_PENDING_T12",
      messageKey: "nutrition.uncertainty.clinical_rules_pending",
    });
  }
  if (aggressiveTarget(answers)) {
    uncertainties.push({
      code: "AGGRESSIVE_TARGET_REQUIRES_REVIEW",
      messageKey: "nutrition.uncertainty.aggressive_target",
    });
  }
  if (
    answers.nutritionMealAnchors !== undefined &&
    answers.nutritionMealAnchors.length !== answers.mealsPerDay
  ) {
    uncertainties.push({
      code: "MEAL_ANCHORS_DEFAULTED",
      messageKey: "nutrition.uncertainty.meal_anchors_defaulted",
    });
  }
  const goal = conservative ? "maintenance" : requestedGoal(answers);
  const goalBand = GOAL_BANDS[goal];
  const expenditureMinimum = multiplyDecimals(restingMinimum, pal.minimum);
  const expenditureMaximum = multiplyDecimals(restingMaximum, pal.maximum);
  const expenditureCenter = multiplyDecimals(restingCenter, pal.center);
  const energyMinimum = rounded(multiplyDecimals(expenditureMinimum, goalBand.minimum));
  const energyMaximum = rounded(multiplyDecimals(expenditureMaximum, goalBand.maximum));
  const energyCenter = rounded(multiplyDecimals(expenditureCenter, goalBand.center));
  const protein = proteinBand(answers);
  const proteinMinimum = rounded(multiplyDecimals(weight, protein.minimum));
  const proteinMaximum = rounded(multiplyDecimals(weight, protein.maximum));
  const proteinCenter = rounded(multiplyDecimals(weight, protein.center));
  const fat = divideDecimals(multiplyDecimals(energyCenter, "0.3"), "9", 6);
  const proteinEnergy = multiplyDecimals(proteinCenter, "4");
  const fatEnergy = multiplyDecimals(fat, "9");
  const residualEnergy = maximum(
    "0",
    subtractDecimals(subtractDecimals(energyCenter, proteinEnergy), fatEnergy),
  );
  const carbohydrates = divideDecimals(residualEnergy, "4", 6);
  const calculatedFiber = divideDecimals(
    multiplyDecimals(energyCenter, "14"),
    "1000",
    6,
  );
  const fiber = rounded(maximum("25", calculatedFiber));

  return {
    completeness: uncertainties.length === 0 ? "complete" : "provisional",
    energy: {
      centerKcal: energyCenter,
      goalApplied: conservative ? "maintenance_conservative" : goal,
      maximumKcal: energyMaximum,
      minimumKcal: energyMinimum,
      restingCenterKcal: rounded(restingCenter),
      restingMaximumKcal: rounded(restingMaximum),
      restingMinimumKcal: rounded(restingMinimum),
      restingSource,
    },
    fiber: { minimumG: "25", targetG: fiber },
    macros: {
      carbohydratesG: rounded(carbohydrates),
      energyKcal: energyCenter,
      fatG: rounded(fat),
      fatPercent: "30",
      fiberG: fiber,
      proteinG: proteinCenter,
    },
    protein: {
      centerG: proteinCenter,
      centerGPerKg: protein.center,
      maximumG: proteinMaximum,
      maximumGPerKg: protein.maximum,
      minimumG: proteinMinimum,
      minimumGPerKg: protein.minimum,
    },
    uncertainties,
  };
}

function emptyTotals(): NutritionTotals {
  return {
    carbohydratesG: "0",
    energyKcal: "0",
    fatG: "0",
    fiberG: "0",
    proteinG: "0",
  };
}

function addTotals(values: readonly NutritionTotals[]): NutritionTotals {
  return Object.fromEntries(
    TOTAL_KEYS.map((key) => [
      key,
      rounded(sumDecimals(values.map((value) => value[key]))),
    ]),
  ) as unknown as NutritionTotals;
}

function totalsForAmount(
  food: EffectiveNutritionFood,
  amountG: string,
): NutritionTotals {
  return Object.fromEntries(
    TOTAL_KEYS.map((key) => [
      key,
      rounded(divideDecimals(multiplyDecimals(food.nutrients[key], amountG), "100", 6)),
    ]),
  ) as unknown as NutritionTotals;
}

function clinicalNutrientsForAmount(
  food: EffectiveNutritionFood,
  amountG: string,
): EffectiveNutritionFood["clinicalNutrients"] {
  return Object.fromEntries(
    Object.entries(food.clinicalNutrients)
      .sort(([left], [right]) => lexicalCompare(left, right))
      .map(([key, nutrient]) => [
        key,
        {
          unit: nutrient.unit,
          value: rounded(
            divideDecimals(multiplyDecimals(nutrient.value, amountG), "100", 6),
            3,
          ),
        },
      ]),
  );
}

function normalized(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function lexicalCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

type Matrix3 = readonly [
  readonly [string, string, string],
  readonly [string, string, string],
  readonly [string, string, string],
];

function determinant3(matrix: Matrix3): string {
  const [[a, b, c], [d, e, f], [g, h, i]] = matrix;
  return addDecimals(
    subtractDecimals(
      multiplyDecimals(
        a,
        subtractDecimals(multiplyDecimals(e, i), multiplyDecimals(f, h)),
      ),
      multiplyDecimals(
        b,
        subtractDecimals(multiplyDecimals(d, i), multiplyDecimals(f, g)),
      ),
    ),
    multiplyDecimals(
      c,
      subtractDecimals(multiplyDecimals(d, h), multiplyDecimals(e, g)),
    ),
  );
}

const ALLERGEN_ALIASES: Readonly<Record<string, string>> = {
  almendra: "tree_nuts",
  almendras: "tree_nuts",
  gluten: "gluten",
  lacteos: "milk",
  leche: "milk",
  nueces: "tree_nuts",
  "frutos secos": "tree_nuts",
  soja: "soy",
  soy: "soy",
};

function declaredTokens(entries: readonly { name: string }[] | undefined): Set<string> {
  return new Set(
    (entries ?? []).flatMap(({ name }) => {
      const token = normalized(name);
      return [token, ALLERGEN_ALIASES[token]].filter(
        (value): value is string => value !== undefined,
      );
    }),
  );
}

function foodTextTokens(food: EffectiveNutritionFood): Set<string> {
  return new Set([food.name, ...food.aliases].map(normalized));
}

function foodMatchesTokens(food: EffectiveNutritionFood, tokens: Set<string>): boolean {
  const metadata = [
    ...food.allergens,
    ...food.crossContactAllergens,
    ...food.intoleranceTags,
  ].map(normalized);
  if (metadata.some((value) => tokens.has(value))) return true;
  for (const name of foodTextTokens(food)) {
    for (const token of tokens) {
      if (name.includes(token) || token.includes(name)) return true;
    }
  }
  return false;
}

function parseToleratedAmount(value: string | undefined): string | null {
  if (!value) return null;
  const match = /\d+(?:[.,]\d+)?/.exec(value);
  return match?.[0] ? match[0].replace(",", ".") : null;
}

function toleratedCap(
  food: EffectiveNutritionFood,
  answers: QuestionnaireAnswers,
): string | null {
  let cap: string | null = null;
  for (const entry of answers.nutritionIntolerances ?? []) {
    const tokens = declaredTokens([entry]);
    if (!foodMatchesTokens(food, tokens)) continue;
    const candidate = parseToleratedAmount(entry.toleratedAmount);
    if (candidate !== null) cap = cap === null ? candidate : minimum(cap, candidate);
  }
  return cap;
}

function eligibleFoods(
  answers: QuestionnaireAnswers,
  catalog: readonly EffectiveNutritionFood[],
): EffectiveNutritionFood[] {
  const pattern = answers.dietaryPattern ?? "omnivore";
  const allergies = declaredTokens(answers.nutritionAllergies);
  const excluded = new Set((answers.excludedFoods ?? []).map(normalized));
  const intolerances = answers.nutritionIntolerances ?? [];

  return catalog.filter((food) => {
    if (!food.dietaryPatterns.includes(pattern)) return false;
    if (answers.proteinPreference === "food_only" && food.isProteinPowder) {
      return false;
    }
    if (foodMatchesTokens(food, allergies)) return false;
    if (
      [food.name, ...food.aliases].map(normalized).some((name) => excluded.has(name))
    ) {
      return false;
    }
    for (const intolerance of intolerances) {
      if (!foodMatchesTokens(food, declaredTokens([intolerance]))) continue;
      if (intolerance.severity === "severe") return false;
      if (
        intolerance.severity === "moderate" &&
        parseToleratedAmount(intolerance.toleratedAmount) === null
      ) {
        return false;
      }
    }
    return TOTAL_KEYS.every((key) => compareDecimals(food.nutrients[key], "0") >= 0);
  });
}

function preferredRank(
  food: EffectiveNutritionFood,
  answers: QuestionnaireAnswers,
): number {
  const preferences = new Set((answers.preferredFoods ?? []).map(normalized));
  return [food.name, ...food.aliases]
    .map(normalized)
    .some((name) => preferences.has(name))
    ? 0
    : 1;
}

function functionPool(
  function_: FoodFunction,
  foods: readonly EffectiveNutritionFood[],
  answers: QuestionnaireAnswers,
  primary: boolean,
): EffectiveNutritionFood[] {
  const matching = foods.filter(({ functions }) => functions.includes(function_));
  const withAlternatives = matching.filter(
    (food) =>
      matching.filter(
        (candidate) =>
          candidate.canonicalFoodKey !== food.canonicalFoodKey &&
          candidate.foodState === food.foodState,
      ).length >= 2,
  );
  return withAlternatives
    .filter(
      (food) =>
        !primary ||
        ((answers.proteinPreference === "usual_powder" || !food.isProteinPowder) &&
          (function_ !== "fat" ||
            (compareDecimals(food.nutrients.proteinG, "1") <= 0 &&
              compareDecimals(food.nutrients.carbohydratesG, "1") <= 0))),
    )
    .sort(
      (left, right) =>
        preferredRank(left, answers) - preferredRank(right, answers) ||
        lexicalCompare(left.canonicalFoodKey, right.canonicalFoodKey),
    );
}

function candidateOrder(
  pool: readonly EffectiveNutritionFood[],
  seed: number,
  mode: "balanced" | "simple",
): EffectiveNutritionFood[] {
  const available = mode === "simple" ? pool.slice(0, 2) : [...pool];
  if (available.length === 0) throw new Error("CATALOG_COVERAGE_INSUFFICIENT");
  const offset = seed % available.length;
  return [...available.slice(offset), ...available.slice(0, offset)];
}

function nutrientForFunction(function_: FoodFunction): keyof NutritionTotals {
  switch (function_) {
    case "protein":
    case "dairy_equivalent":
      return "proteinG";
    case "carbohydrate_base":
      return "carbohydratesG";
    case "fat":
      return "fatG";
    case "fruit_vegetable":
      return "fiberG";
    default:
      return "energyKcal";
  }
}

function amountForNutrient(
  food: EffectiveNutritionFood,
  nutrient: keyof NutritionTotals,
  target: string,
): string {
  const density = food.nutrients[nutrient];
  const usableNutrient = compareDecimals(density, "0") > 0 ? nutrient : "energyKcal";
  const usableTarget =
    usableNutrient === nutrient ? target : maximum("1", multiplyDecimals(target, "4"));
  return rounded(
    divideDecimals(
      multiplyDecimals(usableTarget, "100"),
      food.nutrients[usableNutrient],
      6,
    ),
    2,
  );
}

function cappedAmount(
  food: EffectiveNutritionFood,
  amount: string,
  answers: QuestionnaireAnswers,
): string {
  const cap = toleratedCap(food, answers);
  return cap === null ? amount : minimum(amount, cap);
}

function amountRespectsTolerance(
  food: EffectiveNutritionFood,
  amount: string,
  answers: QuestionnaireAnswers,
): boolean {
  const cap = toleratedCap(food, answers);
  return cap === null || compareDecimals(amount, cap) <= 0;
}

function solvedMealAmounts(
  protein: EffectiveNutritionFood,
  carbohydrate: EffectiveNutritionFood,
  fat: EffectiveNutritionFood,
  residual: Readonly<{ carbohydratesG: string; fatG: string; proteinG: string }>,
): Readonly<{ carbohydrateG: string; fatG: string; proteinG: string }> | null {
  const matrix: Matrix3 = [
    [
      protein.nutrients.proteinG,
      carbohydrate.nutrients.proteinG,
      fat.nutrients.proteinG,
    ],
    [
      protein.nutrients.carbohydratesG,
      carbohydrate.nutrients.carbohydratesG,
      fat.nutrients.carbohydratesG,
    ],
    [protein.nutrients.fatG, carbohydrate.nutrients.fatG, fat.nutrients.fatG],
  ];
  const determinant = determinant3(matrix);
  if (compareDecimals(determinant, "0") === 0) return null;
  const target = [residual.proteinG, residual.carbohydratesG, residual.fatG] as const;
  const determinants = [
    determinant3([
      [target[0], matrix[0][1], matrix[0][2]],
      [target[1], matrix[1][1], matrix[1][2]],
      [target[2], matrix[2][1], matrix[2][2]],
    ]),
    determinant3([
      [matrix[0][0], target[0], matrix[0][2]],
      [matrix[1][0], target[1], matrix[1][2]],
      [matrix[2][0], target[2], matrix[2][2]],
    ]),
    determinant3([
      [matrix[0][0], matrix[0][1], target[0]],
      [matrix[1][0], matrix[1][1], target[1]],
      [matrix[2][0], matrix[2][1], target[2]],
    ]),
  ] as const;
  const amounts = determinants.map((value) =>
    rounded(multiplyDecimals(divideDecimals(value, determinant, 12), "100"), 2),
  );
  if (amounts.some((amount) => compareDecimals(amount, "0") <= 0)) return null;
  return {
    carbohydrateG: amounts[1]!,
    fatG: amounts[2]!,
    proteinG: amounts[0]!,
  };
}

function alternative(
  food: EffectiveNutritionFood,
  function_: FoodFunction,
  amountG: string,
): PlannedFoodAlternative {
  return {
    amountG,
    canonicalFoodKey: food.canonicalFoodKey,
    clinicalNutrients: clinicalNutrientsForAmount(food, amountG),
    foodState: food.foodState,
    function: function_,
    name: food.name,
    nutrients: totalsForAmount(food, amountG),
    revisionId: food.revisionId,
    source: {
      manifestId: food.manifestId,
      sourceKey: food.sourceKey,
      sourceVersion: food.sourceVersion,
    },
  };
}

function plannedFood(
  food: EffectiveNutritionFood,
  function_: FoodFunction,
  amountG: string,
): PlannedFood {
  const primary = alternative(food, function_, amountG);
  return { ...primary, substitutes: [] };
}

function plannedSubstitute(
  candidate: EffectiveNutritionFood,
  function_: FoodFunction,
  target: string,
  answers: QuestionnaireAnswers,
): PlannedFoodAlternative | null {
  const targetNutrient = nutrientForFunction(function_);
  const amount = amountForNutrient(candidate, targetNutrient, target);
  if (!amountRespectsTolerance(candidate, amount, answers)) return null;
  return alternative(candidate, function_, amount);
}

function defaultAnchors(meals: number): readonly NutritionMealAnchor[] {
  const anchors: Record<number, readonly NutritionMealAnchor[]> = {
    2: ["midday", "evening"],
    3: ["wake_up", "midday", "evening"],
    4: ["wake_up", "midday", "afternoon", "evening"],
    5: ["wake_up", "mid_morning", "midday", "afternoon", "evening"],
    6: ["wake_up", "mid_morning", "midday", "afternoon", "evening", "pre_sleep"],
  };
  return anchors[meals]!;
}

function resolvedAnchors(answers: QuestionnaireAnswers, meals: number) {
  const supplied = answers.nutritionMealAnchors ?? [];
  return supplied.length === meals ? supplied : defaultAnchors(meals);
}

function aggregateMeal(meal: NutritionMeal): NutritionMeal {
  return { ...meal, totals: addTotals(meal.foods.map(({ nutrients }) => nutrients)) };
}

function aggregateDay(day: NutritionDay): NutritionDay {
  const meals = day.meals.map(aggregateMeal);
  return { ...day, meals, totals: addTotals(meals.map(({ totals }) => totals)) };
}

function shoppingList(days: readonly NutritionDay[]) {
  const items = new Map<string, { amountG: string; name: string }>();
  for (const food of days.flatMap(({ meals }) => meals.flatMap(({ foods }) => foods))) {
    const current = items.get(food.canonicalFoodKey);
    items.set(food.canonicalFoodKey, {
      amountG: addDecimals(current?.amountG ?? "0", food.amountG),
      name: food.name,
    });
  }
  return [...items.entries()]
    .map(([canonicalFoodKey, value]) => ({ canonicalFoodKey, ...value }))
    .sort((left, right) =>
      lexicalCompare(left.canonicalFoodKey, right.canonicalFoodKey),
    );
}

function nutritionValidation(
  plan: Omit<NutritionWeek, "validation">,
): NutritionWeek["validation"] {
  const errors: string[] = [];
  const fatMinimum = divideDecimals(
    multiplyDecimals(plan.targets.energy.minimumKcal, "0.3"),
    "9",
    6,
  );
  const fatMaximum = divideDecimals(
    multiplyDecimals(plan.targets.energy.maximumKcal, "0.3"),
    "9",
    6,
  );
  const carbohydrateMinimum = maximum(
    "0",
    divideDecimals(
      subtractDecimals(
        subtractDecimals(
          plan.targets.energy.minimumKcal,
          multiplyDecimals(plan.targets.protein.maximumG, "4"),
        ),
        multiplyDecimals(fatMaximum, "9"),
      ),
      "4",
      6,
    ),
  );
  const carbohydrateMaximum = maximum(
    "0",
    divideDecimals(
      subtractDecimals(
        subtractDecimals(
          plan.targets.energy.maximumKcal,
          multiplyDecimals(plan.targets.protein.minimumG, "4"),
        ),
        multiplyDecimals(fatMinimum, "9"),
      ),
      "4",
      6,
    ),
  );
  for (const day of plan.days) {
    const prefix = `NUTRITION_DAY_${day.day}`;
    if (
      !withinInclusive(
        day.totals.energyKcal,
        plan.targets.energy.minimumKcal,
        plan.targets.energy.maximumKcal,
      )
    ) {
      errors.push(`${prefix}_ENERGY_OUTSIDE_BAND`);
    }
    if (
      !withinInclusive(
        day.totals.proteinG,
        plan.targets.protein.minimumG,
        plan.targets.protein.maximumG,
      )
    ) {
      errors.push(`${prefix}_PROTEIN_OUTSIDE_BAND`);
    }
    if (!withinInclusive(day.totals.fatG, fatMinimum, fatMaximum)) {
      errors.push(`${prefix}_FAT_OUTSIDE_BAND`);
    }
    if (
      !withinInclusive(
        day.totals.carbohydratesG,
        carbohydrateMinimum,
        carbohydrateMaximum,
      )
    ) {
      errors.push(`${prefix}_CARBOHYDRATES_OUTSIDE_BAND`);
    }
    if (compareDecimals(day.totals.fiberG, plan.targets.fiber.minimumG) < 0) {
      errors.push(`${prefix}_FIBER_BELOW_MINIMUM`);
    }
  }
  return {
    errors,
    status: errors.length === 0 ? "valid" : "invalid",
    warnings:
      plan.targets.completeness === "provisional"
        ? ["NUTRITION_TARGETS_PROVISIONAL"]
        : [],
  };
}

function aggregateWeek(plan: NutritionWeek): NutritionWeek {
  const days = plan.days.map(aggregateDay);
  const aggregated = {
    ...plan,
    days,
    shoppingList: shoppingList(days),
    weekTotals: addTotals(days.map(({ totals }) => totals)),
  };
  return { ...aggregated, validation: nutritionValidation(aggregated) };
}

function replacePlannedFood(
  plan: NutritionWeek,
  selection: Readonly<{ dayIndex: number; foodIndex: number; mealIndex: number }>,
  replacement: PlannedFood,
): NutritionWeek {
  const days = plan.days.map((day, dayIndex) =>
    dayIndex !== selection.dayIndex
      ? day
      : {
          ...day,
          meals: day.meals.map((meal, mealIndex) =>
            mealIndex !== selection.mealIndex
              ? meal
              : {
                  ...meal,
                  foods: meal.foods.map((food, foodIndex) =>
                    foodIndex === selection.foodIndex ? replacement : food,
                  ),
                },
          ),
        },
  );
  return aggregateWeek({ ...plan, days });
}

function assignValidatedSubstitutes(
  plan: NutritionWeek,
  answers: QuestionnaireAnswers,
  eligible: readonly EffectiveNutritionFood[],
): NutritionWeek {
  const foodByKey = new Map(eligible.map((food) => [food.canonicalFoodKey, food]));
  const days = plan.days.map((day, dayIndex) => ({
    ...day,
    meals: day.meals.map((meal, mealIndex) => ({
      ...meal,
      foods: meal.foods.map((food, foodIndex) => {
        const source = foodByKey.get(food.canonicalFoodKey);
        if (!source) throw new Error("CATALOG_COVERAGE_INSUFFICIENT");
        const targetNutrient = nutrientForFunction(food.function);
        const candidates = functionPool(food.function, eligible, answers, false).filter(
          (candidate) =>
            candidate.canonicalFoodKey !== food.canonicalFoodKey &&
            candidate.foodState === food.foodState,
        );
        const substitutes: PlannedFoodAlternative[] = [];
        for (const candidate of candidates) {
          const substitute = plannedSubstitute(
            candidate,
            food.function,
            food.nutrients[targetNutrient],
            answers,
          );
          if (!substitute) continue;
          const tentative = replacePlannedFood(
            plan,
            { dayIndex, foodIndex, mealIndex },
            { ...substitute, substitutes: [] },
          );
          if (tentative.validation.status !== "valid") continue;
          substitutes.push(substitute);
          if (substitutes.length === 2) break;
        }
        if (substitutes.length !== 2) {
          throw new Error("CATALOG_COVERAGE_INSUFFICIENT");
        }
        return { ...food, substitutes };
      }),
    })),
  }));
  return aggregateWeek({ ...plan, days });
}

function plannedFunctionsAreMeaningful(foods: readonly PlannedFood[]): boolean {
  for (const function_ of ["protein", "carbohydrate_base", "fat"] as const) {
    const nutrient = nutrientForFunction(function_);
    const primary = foods.find((food) => food.function === function_);
    if (!primary) return false;
    if (
      foods.some(
        (food) =>
          food !== primary &&
          compareDecimals(food.nutrients[nutrient], primary.nutrients[nutrient]) > 0,
      )
    ) {
      return false;
    }
  }
  return true;
}

export function generateNutritionWeek(input: {
  answers: QuestionnaireAnswers;
  catalog: readonly EffectiveNutritionFood[];
}): NutritionWeek {
  const meals = input.answers.mealsPerDay;
  if (meals === undefined || meals < 2 || meals > 6) {
    throw new Error("nutrition_meals_out_of_range");
  }
  if (!input.answers.nutritionMode || !input.answers.dietaryPattern) {
    throw new Error("nutrition_context_incomplete");
  }
  const targets = calculateNutritionTargets(input.answers);
  const eligible = eligibleFoods(input.answers, input.catalog);
  const functions = [
    "protein",
    "carbohydrate_base",
    "fruit_vegetable",
    "fat",
  ] as const satisfies readonly FoodFunction[];
  const alternativePools = Object.fromEntries(
    functions.map((function_) => [
      function_,
      functionPool(function_, eligible, input.answers, false),
    ]),
  ) as Record<(typeof functions)[number], EffectiveNutritionFood[]>;
  const primaryPools = Object.fromEntries(
    functions.map((function_) => [
      function_,
      functionPool(function_, eligible, input.answers, true),
    ]),
  ) as Record<(typeof functions)[number], EffectiveNutritionFood[]>;
  if (
    functions.some(
      (function_) =>
        primaryPools[function_].length === 0 || alternativePools[function_].length < 3,
    )
  ) {
    throw new Error("CATALOG_COVERAGE_INSUFFICIENT");
  }

  const anchors = resolvedAnchors(input.answers, meals);
  const proteinPerMeal = divideDecimals(targets.protein.centerG, String(meals), 6);
  const carbohydratesPerMeal = divideDecimals(
    targets.macros.carbohydratesG,
    String(meals),
    6,
  );
  const fatPerMeal = divideDecimals(targets.macros.fatG, String(meals), 6);
  const fiberPerMeal = divideDecimals(targets.fiber.targetG, String(meals), 6);
  const energyMinimumPerMeal = divideDecimals(
    targets.energy.minimumKcal,
    String(meals),
    6,
  );
  const energyMaximumPerMeal = divideDecimals(
    targets.energy.maximumKcal,
    String(meals),
    6,
  );
  const days = Array.from({ length: 7 }, (_, dayIndex): NutritionDay => {
    const dayMeals = Array.from({ length: meals }, (_, mealIndex): NutritionMeal => {
      const seed = dayIndex * meals + mealIndex;
      const proteinCandidates = candidateOrder(
        primaryPools.protein,
        seed,
        input.answers.nutritionMode!,
      );
      const carbohydrateCandidates = candidateOrder(
        primaryPools.carbohydrate_base,
        seed + 2,
        input.answers.nutritionMode!,
      );
      const produceCandidates = candidateOrder(
        primaryPools.fruit_vegetable,
        seed + 1,
        input.answers.nutritionMode!,
      );
      const fatCandidates = candidateOrder(
        primaryPools.fat,
        seed + 3,
        input.answers.nutritionMode!,
      );
      const validCandidates: Array<{
        fiberDistance: string;
        foods: PlannedFood[];
        order: number;
      }> = [];
      let candidateOrdinal = 0;
      for (const produce of produceCandidates) {
        const produceAmount = cappedAmount(produce, "150", input.answers);
        const produceTotals = totalsForAmount(produce, produceAmount);
        const residual = {
          carbohydratesG: subtractDecimals(
            carbohydratesPerMeal,
            produceTotals.carbohydratesG,
          ),
          fatG: subtractDecimals(fatPerMeal, produceTotals.fatG),
          proteinG: subtractDecimals(proteinPerMeal, produceTotals.proteinG),
        };
        if (Object.values(residual).some((value) => compareDecimals(value, "0") <= 0)) {
          continue;
        }
        for (const protein of proteinCandidates) {
          for (const carbohydrate of carbohydrateCandidates) {
            for (const fat of fatCandidates) {
              const amounts = solvedMealAmounts(protein, carbohydrate, fat, residual);
              if (
                amounts === null ||
                !amountRespectsTolerance(protein, amounts.proteinG, input.answers) ||
                !amountRespectsTolerance(
                  carbohydrate,
                  amounts.carbohydrateG,
                  input.answers,
                ) ||
                !amountRespectsTolerance(fat, amounts.fatG, input.answers)
              ) {
                continue;
              }
              const candidateFoods = [
                plannedFood(protein, "protein", amounts.proteinG),
                plannedFood(carbohydrate, "carbohydrate_base", amounts.carbohydrateG),
                plannedFood(produce, "fruit_vegetable", produceAmount),
                plannedFood(fat, "fat", amounts.fatG),
              ];
              const candidateTotals = addTotals(
                candidateFoods.map(({ nutrients }) => nutrients),
              );
              if (
                !plannedFunctionsAreMeaningful(candidateFoods) ||
                !withinInclusive(
                  candidateTotals.energyKcal,
                  energyMinimumPerMeal,
                  energyMaximumPerMeal,
                )
              ) {
                continue;
              }
              const fiberDistance = absoluteDecimal(
                subtractDecimals(candidateTotals.fiberG, fiberPerMeal),
              );
              validCandidates.push({
                fiberDistance,
                foods: candidateFoods,
                order: candidateOrdinal++,
              });
            }
          }
        }
      }
      validCandidates.sort(
        (left, right) =>
          compareDecimals(left.fiberDistance, right.fiberDistance) ||
          left.order - right.order,
      );
      const rotationWindow = Math.min(
        validCandidates.length,
        Math.max(...functions.map((function_) => primaryPools[function_].length)),
      );
      const selectedIndex =
        input.answers.nutritionMode === "balanced" && rotationWindow > 0
          ? seed % rotationWindow
          : 0;
      const foods = validCandidates[selectedIndex]?.foods;
      if (!foods) throw new Error("CATALOG_COVERAGE_INSUFFICIENT");
      return {
        anchor: anchors[mealIndex]!,
        flexibleWindowMinutes:
          input.answers.nutritionFoodAnxiety === "frequent"
            ? 60
            : input.answers.dailySchedule === "shift_work"
              ? 180
              : input.answers.dailySchedule === "variable"
                ? 120
                : 90,
        foods,
        index: mealIndex + 1,
        totals: addTotals(foods.map(({ nutrients }) => nutrients)),
      };
    });
    return {
      day: (dayIndex + 1) as NutritionDay["day"],
      meals: dayMeals,
      totals: addTotals(dayMeals.map(({ totals }) => totals)),
    };
  });
  const strategies =
    input.answers.nutritionFoodAnxiety === "frequent" ||
    input.answers.nutritionFoodAnxiety === "sometimes"
      ? [
          "regular_meal_anchors",
          "protein_fiber_pairing",
          "planned_satiating_alternatives",
        ]
      : [];
  const base: NutritionWeek = {
    catalogManifestIds: [
      ...new Set(eligible.map(({ manifestId }) => manifestId)),
    ].sort(),
    days,
    dietaryPattern: input.answers.dietaryPattern,
    mode: input.answers.nutritionMode,
    shoppingList: [],
    strategies,
    targets,
    validation: { errors: [], status: "valid", warnings: [] },
    weekTotals: emptyTotals(),
  };
  const aggregated = aggregateWeek(base);
  if (aggregated.validation.status !== "valid") {
    throw new Error("NUTRITION_PLAN_OUTSIDE_BANDS");
  }
  return assignValidatedSubstitutes(aggregated, input.answers, eligible);
}

function withoutSubstitutes(food: PlannedFood): PlannedFoodAlternative {
  const { substitutes, ...alternative_ } = food;
  if (substitutes.length !== 2) throw new Error("invalid_nutrition_substitutes");
  return alternative_;
}

export function applyNutritionSubstitution(
  plan: NutritionWeek,
  selection: Readonly<{
    dayIndex: number;
    foodIndex: number;
    mealIndex: number;
    substituteIndex: number;
  }>,
): NutritionWeek {
  const selectedDay = plan.days[selection.dayIndex];
  const selectedMeal = selectedDay?.meals[selection.mealIndex];
  const selectedFood = selectedMeal?.foods[selection.foodIndex];
  const replacement = selectedFood?.substitutes[selection.substituteIndex];
  if (!selectedDay || !selectedMeal || !selectedFood || !replacement) {
    throw new Error("invalid_nutrition_substitution");
  }
  const promoted: PlannedFood = {
    ...replacement,
    substitutes: [
      withoutSubstitutes(selectedFood),
      ...selectedFood.substitutes.filter(
        ({ canonicalFoodKey }) => canonicalFoodKey !== replacement.canonicalFoodKey,
      ),
    ].slice(0, 2),
  };
  return replacePlannedFood(plan, selection, promoted);
}
