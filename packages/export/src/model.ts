import {
  ExportCreateRequestSchema,
  normalizeNutritionWeek,
  type ExportChoice,
  type ExportCreateRequestContract,
} from "@health-design/contracts";
import {
  addDecimals,
  applyNutritionSubstitution,
} from "@health-design/engine/nutrition";

type PreparedNutrition = ReturnType<typeof applyNutritionSubstitution>;
type NutritionFood =
  PreparedNutrition["days"][number]["meals"][number]["foods"][number];
type NutritionAlternative = NutritionFood["substitutes"][number];
type NutritionTotals = PreparedNutrition["weekTotals"];

export type ExportFoodRow = Readonly<{
  amountG: string;
  anchor: string;
  canonicalFoodKey: string;
  choice: 0 | 1 | 2;
  clinicalNutrients: NutritionAlternative["clinicalNutrients"];
  day: number;
  dayIndex: number;
  foodIndex: number;
  foodState: NutritionAlternative["foodState"];
  function: NutritionAlternative["function"];
  mealIndex: number;
  name: string;
  nutrients: NutritionTotals;
  preparation: NutritionAlternative["preparation"];
  rowKind: "alternative" | "selected";
}>;

export type ExportModel = Readonly<{
  detail: ExportCreateRequestContract["detail"];
  format: ExportCreateRequestContract["format"];
  planOutputHash: string;
  planVersionId: string;
  presentation: ExportCreateRequestContract["presentation"];
  range: ExportCreateRequestContract["range"];
  rendererVersion: "export-v1";
  rows: readonly ExportFoodRow[];
  schemaVersion: 1;
  shoppingList?: readonly Readonly<{
    amountG: string;
    canonicalFoodKey: string;
    name: string;
  }>[];
  totals: NutritionTotals;
  weeklyPreparation?: readonly Readonly<{
    canonicalFoodKey: string;
    instruction: string;
    name: string;
  }>[];
}>;

type ExportModelInput = Readonly<{
  config: ExportCreateRequestContract;
  nutrition: unknown;
  planOutputHash: string;
  planVersionId: string;
  rendererVersion: "export-v1";
}>;

function positionKey([day, meal, food]: ExportChoice): string {
  return `${day}:${meal}:${food}`;
}

function optionAt(food: NutritionFood, choice: 0 | 1 | 2): NutritionAlternative {
  if (choice === 0) return food;
  const option = food.substitutes[choice - 1];
  if (!option) throw new Error("invalid_export_choice");
  return option;
}

function row(
  food: NutritionAlternative,
  position: Readonly<{
    anchor: string;
    choice: 0 | 1 | 2;
    day: number;
    dayIndex: number;
    foodIndex: number;
    mealIndex: number;
    rowKind: ExportFoodRow["rowKind"];
  }>,
): ExportFoodRow {
  return {
    amountG: food.amountG,
    anchor: position.anchor,
    canonicalFoodKey: food.canonicalFoodKey,
    choice: position.choice,
    clinicalNutrients: food.clinicalNutrients,
    day: position.day,
    dayIndex: position.dayIndex,
    foodIndex: position.foodIndex,
    foodState: food.foodState,
    function: food.function,
    mealIndex: position.mealIndex,
    name: food.name,
    nutrients: food.nutrients,
    preparation: food.preparation,
    rowKind: position.rowKind,
  };
}

export function createExportModel(input: ExportModelInput): ExportModel {
  const config = ExportCreateRequestSchema.parse(input.config);
  const original = normalizeNutritionWeek(input.nutrition);
  const choices = new Map(
    config.choices.map((choice) => [positionKey(choice), choice[3]]),
  );
  let selected: PreparedNutrition = original;

  for (const choice of config.choices) {
    const [dayIndex, mealIndex, foodIndex, selectedChoice] = choice;
    const food = original.days[dayIndex]?.meals[mealIndex]?.foods[foodIndex];
    if (!food) throw new Error("invalid_export_choice");
    optionAt(food, selectedChoice);
    if (selectedChoice > 0) {
      selected = applyNutritionSubstitution(selected, {
        dayIndex,
        foodIndex,
        mealIndex,
        substituteIndex: selectedChoice - 1,
      });
    }
  }

  const selectedDays = selected.days.filter(
    ({ day }) => config.range.kind === "week" || day === config.range.day,
  );
  const rows: ExportFoodRow[] = [];
  for (const selectedDay of selectedDays) {
    const dayIndex = selectedDay.day - 1;
    const originalDay = original.days[dayIndex]!;
    for (const [mealIndex, selectedMeal] of selectedDay.meals.entries()) {
      const originalMeal = originalDay.meals[mealIndex]!;
      for (const [foodIndex, selectedFood] of selectedMeal.foods.entries()) {
        const originalFood = originalMeal.foods[foodIndex]!;
        const selectedChoice =
          choices.get(`${dayIndex}:${mealIndex}:${foodIndex}`) ?? 0;
        rows.push(
          row(selectedFood, {
            anchor: selectedMeal.anchor,
            choice: selectedChoice,
            day: selectedDay.day,
            dayIndex,
            foodIndex,
            mealIndex,
            rowKind: "selected",
          }),
        );
        if (config.detail === "complete") {
          for (const choice of [0, 1, 2] as const) {
            if (choice === selectedChoice) continue;
            rows.push(
              row(optionAt(originalFood, choice), {
                anchor: selectedMeal.anchor,
                choice,
                day: selectedDay.day,
                dayIndex,
                foodIndex,
                mealIndex,
                rowKind: "alternative",
              }),
            );
          }
        }
      }
    }
  }

  const model: ExportModel = {
    detail: config.detail,
    format: config.format,
    planOutputHash: input.planOutputHash,
    planVersionId: input.planVersionId,
    presentation: config.presentation,
    range: config.range,
    rendererVersion: input.rendererVersion,
    rows,
    schemaVersion: 1,
    totals:
      config.range.kind === "week"
        ? selected.weekTotals
        : selected.days[config.range.day - 1]!.totals,
  };

  if (config.includeShopping) {
    const items = new Map<string, { amountG: string; name: string }>();
    for (const food of rows.filter(({ rowKind }) => rowKind === "selected")) {
      const current = items.get(food.canonicalFoodKey);
      items.set(food.canonicalFoodKey, {
        amountG: addDecimals(current?.amountG ?? "0", food.amountG),
        name: food.name,
      });
    }
    Object.assign(model, {
      shoppingList: [...items.entries()]
        .map(([canonicalFoodKey, value]) => ({ canonicalFoodKey, ...value }))
        .sort((left, right) =>
          left.canonicalFoodKey.localeCompare(right.canonicalFoodKey),
        ),
    });
  }

  if (config.includeWeeklyPreparation) {
    const preparations = new Map<string, { instruction: string; name: string }>();
    for (const food of rows.filter(({ rowKind }) => rowKind === "selected")) {
      preparations.set(food.canonicalFoodKey, {
        instruction: food.preparation.instruction,
        name: food.name,
      });
    }
    Object.assign(model, {
      weeklyPreparation: [...preparations.entries()]
        .map(([canonicalFoodKey, value]) => ({ canonicalFoodKey, ...value }))
        .sort((left, right) =>
          left.canonicalFoodKey.localeCompare(right.canonicalFoodKey),
        ),
    });
  }

  return model;
}
