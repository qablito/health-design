import {
  ExportCreateRequestSchema,
  normalizeNutritionWeek,
  type ExportChoice,
  type ExportCreateRequestContract,
  type ExportRendererVersion,
  type ShoppingSnapshot,
  type SupermarketChain,
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

const COMMERCIAL_GTIN_TOKEN_PATTERN = /(?<!\d)(?:\d{8}|\d{12,14})(?!\d)/g;
const PRIVATE_HASH_TOKEN_PATTERN = /\b[0-9a-f]{64}\b/gi;
const PRIVATE_LOCATION_TOKEN_PATTERN = /\bSevilla\b/gi;
const PRIVATE_STORAGE_TOKEN_PATTERN =
  /\b(?:https?|r2):\/\/[^\s]+|health-design-catalog-source-dev/gi;
const PRIVATE_UUID_TOKEN_PATTERN =
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi;

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

type ExportShoppingSelection = Readonly<{
  basePriceEur: string;
  chain: SupermarketChain;
  estimatedRemainderG: string;
  formatText: string;
  normalizedPrice: Readonly<{
    unit: "EUR/kg" | "EUR/L" | "EUR/unit";
    value: string;
  }> | null;
  packageCount: string;
  productName: string;
  totalCostEur: string;
}>;

export type ExportShoppingItem = Readonly<{
  amountG: string;
  canonicalFoodKey: string;
  name: string;
  selected: ExportShoppingSelection | null;
  selectionOrigin: "automatic" | "manual";
  state:
    "resolved" | "price_unavailable" | "package_unconfirmed" | "no_confirmed_product";
}>;

export type ExportShopping =
  | Readonly<{
      items: readonly Readonly<{
        amountG: string;
        canonicalFoodKey: string;
        name: string;
      }>[];
      kind: "canonical";
    }>
  | Readonly<{
      comparison: ShoppingSnapshot["comparison"];
      completeness: ShoppingSnapshot["completeness"];
      items: readonly ExportShoppingItem[];
      kind: "snapshot";
      preference: ShoppingSnapshot["preference"];
      totals: ShoppingSnapshot["totals"];
    }>;

export type ExportModel = Readonly<{
  detail: ExportCreateRequestContract["detail"];
  format: ExportCreateRequestContract["format"];
  planOutputHash: string;
  planVersionId: string;
  presentation: ExportCreateRequestContract["presentation"];
  range: ExportCreateRequestContract["range"];
  rendererVersion: ExportRendererVersion;
  rows: readonly ExportFoodRow[];
  schemaVersion: 1;
  shopping?: ExportShopping;
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
  rendererVersion: ExportRendererVersion;
  shoppingSnapshot?: ShoppingSnapshot;
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

export function sanitizeExternalText(
  value: string,
  fallback = "Producto comercial",
): string {
  const sanitized = value
    .replace(PRIVATE_UUID_TOKEN_PATTERN, "")
    .replace(COMMERCIAL_GTIN_TOKEN_PATTERN, "")
    .replace(PRIVATE_HASH_TOKEN_PATTERN, "")
    .replace(PRIVATE_STORAGE_TOKEN_PATTERN, "")
    .replace(PRIVATE_LOCATION_TOKEN_PATTERN, "")
    .replace(/\p{Cc}/gu, " ")
    .replace(/\s{2,}/g, " ")
    .replace(/^[\s,;:|/\\-]+|[\s,;:|/\\-]+$/g, "")
    .trim();
  return sanitized || fallback;
}

function publicFoodName(food: NutritionAlternative): string {
  return food.commercialProduct ? sanitizeExternalText(food.name) : food.name;
}

function packageText(
  selection: NonNullable<ShoppingSnapshot["items"][number]["selected"]>,
): string {
  const projection = selection.projection;
  if (projection.formatText) {
    return sanitizeExternalText(projection.formatText, "Formato no indicado");
  }
  const measure = projection.package?.saleMeasure;
  if (!measure) return "Formato no indicado";
  return `${measure.quantity} ${measure.unit === "unit" ? "ud." : measure.unit}`;
}

function snapshotShopping(snapshot: ShoppingSnapshot): ExportShopping {
  return {
    comparison:
      snapshot.comparison === null ? null : structuredClone(snapshot.comparison),
    completeness: snapshot.completeness,
    items: snapshot.items.map((item) => ({
      amountG: item.amountG,
      canonicalFoodKey: item.canonicalFoodKey,
      name: sanitizeExternalText(item.name, "Alimento"),
      selected:
        item.selected === null
          ? null
          : {
              basePriceEur: item.selected.projection.basePriceEur!,
              chain: item.selected.projection.chain,
              estimatedRemainderG: item.selected.estimatedRemainderG,
              formatText: packageText(item.selected),
              normalizedPrice:
                item.selected.projection.normalizedPrice === null
                  ? null
                  : {
                      unit: item.selected.projection.normalizedPrice.unit,
                      value: item.selected.projection.normalizedPrice.value,
                    },
              packageCount: item.selected.packageCount,
              productName: sanitizeExternalText(
                item.selected.projection.name,
                "Producto comercial",
              ),
              totalCostEur: item.selected.totalCostEur,
            },
      selectionOrigin: item.selectionOrigin,
      state: item.state,
    })),
    kind: "snapshot",
    preference: structuredClone(snapshot.preference),
    totals: structuredClone(snapshot.totals),
  };
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
    name: publicFoodName(food),
    nutrients: food.nutrients,
    preparation: food.preparation,
    rowKind: position.rowKind,
  };
}

export function createExportModel(input: ExportModelInput): ExportModel {
  const config = ExportCreateRequestSchema.parse(input.config);
  if (config.shoppingSnapshotId !== undefined) {
    if (
      input.shoppingSnapshot?.id !== config.shoppingSnapshotId ||
      input.shoppingSnapshot.planVersionId !== input.planVersionId
    ) {
      throw new Error("shopping_snapshot_mismatch");
    }
  } else if (input.shoppingSnapshot !== undefined) {
    throw new Error("shopping_snapshot_unexpected");
  }
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
    if (input.shoppingSnapshot) {
      Object.assign(model, { shopping: snapshotShopping(input.shoppingSnapshot) });
    } else {
      const items = new Map<string, { amountG: string; name: string }>();
      for (const food of rows.filter(({ rowKind }) => rowKind === "selected")) {
        const current = items.get(food.canonicalFoodKey);
        items.set(food.canonicalFoodKey, {
          amountG: addDecimals(current?.amountG ?? "0", food.amountG),
          name: food.name,
        });
      }
      Object.assign(model, {
        shopping: {
          items: [...items.entries()]
            .map(([canonicalFoodKey, value]) => ({ canonicalFoodKey, ...value }))
            .sort((left, right) =>
              left.canonicalFoodKey.localeCompare(right.canonicalFoodKey),
            ),
          kind: "canonical",
        },
      });
    }
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
