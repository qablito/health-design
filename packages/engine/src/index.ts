import type {
  ContextSnapshotInternal,
  PlanContextChange,
  PlanEngineResult,
  PlanModuleResultInput,
} from "@health-design/contracts";
import {
  CONTEXT_CANONICALIZATION_VERSION,
  QUESTIONNAIRE_MODULES,
  type QuestionnaireModule,
} from "@health-design/domain";

type Decimal = Readonly<{ coefficient: bigint; scale: number }>;

const DECIMAL_PATTERN = /^-?\d+(?:\.\d+)?$/;

function powerOfTen(exponent: number): bigint {
  return 10n ** BigInt(exponent);
}

function parseDecimal(value: string): Decimal {
  if (!DECIMAL_PATTERN.test(value)) throw new Error("invalid_decimal");

  const negative = value.startsWith("-");
  const unsigned = negative ? value.slice(1) : value;
  const [integer, fraction = ""] = unsigned.split(".");
  let coefficient = BigInt(`${negative ? "-" : ""}${integer}${fraction}`);
  let scale = fraction.length;

  while (scale > 0 && coefficient % 10n === 0n) {
    coefficient /= 10n;
    scale -= 1;
  }

  return { coefficient, scale };
}

function formatDecimal(decimal: Decimal): string {
  let { coefficient, scale } = decimal;
  while (scale > 0 && coefficient % 10n === 0n) {
    coefficient /= 10n;
    scale -= 1;
  }
  if (coefficient === 0n) return "0";

  const negative = coefficient < 0n;
  const digits = (negative ? -coefficient : coefficient).toString();
  if (scale === 0) return `${negative ? "-" : ""}${digits}`;

  const padded = digits.padStart(scale + 1, "0");
  const split = padded.length - scale;
  return `${negative ? "-" : ""}${padded.slice(0, split)}.${padded.slice(split)}`;
}

function alignDecimals(left: Decimal, right: Decimal): readonly [bigint, bigint] {
  const scale = Math.max(left.scale, right.scale);
  return [
    left.coefficient * powerOfTen(scale - left.scale),
    right.coefficient * powerOfTen(scale - right.scale),
  ];
}

export function normalizeDecimal(value: string): string {
  return formatDecimal(parseDecimal(value));
}

export function addDecimals(left: string, right: string): string {
  const parsedLeft = parseDecimal(left);
  const parsedRight = parseDecimal(right);
  const scale = Math.max(parsedLeft.scale, parsedRight.scale);
  const [leftCoefficient, rightCoefficient] = alignDecimals(parsedLeft, parsedRight);
  return formatDecimal({ coefficient: leftCoefficient + rightCoefficient, scale });
}

export function multiplyDecimals(left: string, right: string): string {
  const parsedLeft = parseDecimal(left);
  const parsedRight = parseDecimal(right);
  return formatDecimal({
    coefficient: parsedLeft.coefficient * parsedRight.coefficient,
    scale: parsedLeft.scale + parsedRight.scale,
  });
}

export function compareDecimals(left: string, right: string): -1 | 0 | 1 {
  const [leftCoefficient, rightCoefficient] = alignDecimals(
    parseDecimal(left),
    parseDecimal(right),
  );
  return leftCoefficient < rightCoefficient
    ? -1
    : leftCoefficient > rightCoefficient
      ? 1
      : 0;
}

function subtractDecimals(left: string, right: string): string {
  const parsedRight = parseDecimal(right);
  return addDecimals(
    left,
    formatDecimal({
      coefficient: -parsedRight.coefficient,
      scale: parsedRight.scale,
    }),
  );
}

function absoluteDecimal(value: string): string {
  const parsed = parseDecimal(value);
  return formatDecimal({
    coefficient: parsed.coefficient < 0n ? -parsed.coefficient : parsed.coefficient,
    scale: parsed.scale,
  });
}

export function sumDecimals(values: readonly string[]): string {
  return values.reduce(addDecimals, "0");
}

export function checkDecimalClosure(values: readonly string[], total: string): boolean {
  return compareDecimals(sumDecimals(values), total) === 0;
}

export function roundDecimal(
  value: string,
  scale: number,
  mode: "half_away_from_zero" | "toward_zero",
): string {
  if (!Number.isInteger(scale) || scale < 0 || scale > 18) {
    throw new Error("invalid_rounding_scale");
  }
  const parsed = parseDecimal(value);
  if (parsed.scale <= scale) return formatDecimal(parsed);

  const divisor = powerOfTen(parsed.scale - scale);
  let quotient = parsed.coefficient / divisor;
  const remainder = parsed.coefficient % divisor;
  if (
    mode === "half_away_from_zero" &&
    (remainder < 0n ? -remainder : remainder) * 2n >= divisor
  ) {
    quotient += parsed.coefficient < 0n ? -1n : 1n;
  }
  return formatDecimal({ coefficient: quotient, scale });
}

export const UNIT_CONVERSION_VERSION = "unit-conversion-v1" as const;

export type QuantityUnit =
  "EUR" | "cent" | "g" | "kJ" | "kcal" | "kg" | "l" | "mg" | "ml" | "ug";
export type QuantityState = "conflicting" | "estimated" | "known" | "missing" | "stale";
export type QuantityBasis =
  "absolute" | "per_100_g" | "per_100_ml" | "per_kg" | "per_l" | "per_serving";
export type FoodState = "cooked" | "raw" | "unspecified";
export type Quantity = Readonly<{
  basis: QuantityBasis;
  foodState: FoodState;
  method?: string;
  state: QuantityState;
  unit: QuantityUnit;
  value: string | null;
}>;

const CONVERSION_FACTORS: Readonly<Record<string, string>> = {
  "EUR:cent": "100",
  "cent:EUR": "0.01",
  "g:kg": "0.001",
  "g:mg": "1000",
  "g:ug": "1000000",
  "kJ:kcal": "0.2390057361",
  "kcal:kJ": "4.184",
  "kg:g": "1000",
  "l:ml": "1000",
  "mg:g": "0.001",
  "mg:ug": "1000",
  "ml:l": "0.001",
  "ug:g": "0.000001",
  "ug:mg": "0.001",
};

const BASIS_FACTORS: Readonly<Record<string, string>> = {
  "per_100_g:per_kg": "10",
  "per_100_ml:per_l": "10",
  "per_kg:per_100_g": "0.1",
  "per_l:per_100_ml": "0.1",
};

function conversionFactor(from: QuantityUnit, to: QuantityUnit): string | null {
  if (from === to) return "1";
  return CONVERSION_FACTORS[`${from}:${to}`] ?? null;
}

function basisFactor(from: QuantityBasis, to: QuantityBasis): string | null {
  if (from === to) return "1";
  return BASIS_FACTORS[`${from}:${to}`] ?? null;
}

export function normalizeQuantity(
  quantity: Quantity,
  targetUnit: QuantityUnit,
  targetBasis: QuantityBasis = quantity.basis,
): Quantity & {
  conversionVersion: typeof UNIT_CONVERSION_VERSION;
  original: Pick<Quantity, "basis" | "unit" | "value">;
} {
  const unitFactor = conversionFactor(quantity.unit, targetUnit);
  const denominatorFactor = basisFactor(quantity.basis, targetBasis);
  if (unitFactor === null) throw new Error("incompatible_units");
  if (denominatorFactor === null) throw new Error("incompatible_basis");
  const original = {
    basis: quantity.basis,
    unit: quantity.unit,
    value: quantity.value,
  };
  if (quantity.state === "missing") {
    if (quantity.value !== null) throw new Error("invalid_quantity_state");
    return {
      ...quantity,
      basis: targetBasis,
      conversionVersion: UNIT_CONVERSION_VERSION,
      original,
      unit: targetUnit,
    };
  }
  if (quantity.value === null) throw new Error("invalid_quantity_state");
  return {
    ...quantity,
    basis: targetBasis,
    conversionVersion: UNIT_CONVERSION_VERSION,
    original,
    unit: targetUnit,
    value: multiplyDecimals(
      multiplyDecimals(quantity.value, unitFactor),
      denominatorFactor,
    ),
  };
}

export function quantitiesAreCompatible(left: Quantity, right: Quantity): boolean {
  return (
    left.basis === right.basis &&
    left.foodState === right.foodState &&
    conversionFactor(left.unit, right.unit) !== null
  );
}

export type NutrientClass =
  | "carbohydrates"
  | "fiber"
  | "mineral"
  | "monounsaturated_fat"
  | "polyunsaturated_fat"
  | "protein"
  | "salt"
  | "saturated_fat"
  | "sodium"
  | "sugars"
  | "total_fat"
  | "vitamin";
export type DiscrepancyStatus =
  "informative_discrepancy" | "manual_review" | "no_conflict" | "priority_review";

function exceedsAbsolute(difference: string, threshold: string): boolean {
  return compareDecimals(difference, threshold) > 0;
}

function exceedsRelative(
  difference: string,
  anchor: string,
  percentage: string,
): boolean {
  return (
    compareDecimals(
      multiplyDecimals(difference, "100"),
      multiplyDecimals(absoluteDecimal(anchor), percentage),
    ) > 0
  );
}

function macronutrientThreshold(
  anchor: string,
  difference: string,
  lowThreshold: string,
): boolean {
  if (compareDecimals(anchor, "10") < 0) {
    return exceedsAbsolute(difference, lowThreshold);
  }
  if (compareDecimals(anchor, "40") <= 0) {
    return exceedsRelative(difference, anchor, "20");
  }
  return exceedsAbsolute(difference, "8");
}

export function classifyNutrientDiscrepancy(
  nutrient: NutrientClass,
  anchor: string,
  candidate: string,
): DiscrepancyStatus {
  if (compareDecimals(anchor, "0") < 0 || compareDecimals(candidate, "0") < 0) {
    return "priority_review";
  }
  const difference = absoluteDecimal(subtractDecimals(candidate, anchor));
  if (compareDecimals(difference, "0") === 0) return "no_conflict";

  let exceeds: boolean;
  if (["protein", "carbohydrates", "sugars", "fiber"].includes(nutrient)) {
    exceeds = macronutrientThreshold(anchor, difference, "2");
  } else if (nutrient === "total_fat") {
    exceeds = macronutrientThreshold(anchor, difference, "1.5");
  } else if (
    ["saturated_fat", "monounsaturated_fat", "polyunsaturated_fat"].includes(nutrient)
  ) {
    exceeds =
      compareDecimals(anchor, "4") < 0
        ? exceedsAbsolute(difference, "0.8")
        : exceedsRelative(difference, anchor, "20");
  } else if (nutrient === "sodium") {
    exceeds =
      compareDecimals(anchor, "0.5") < 0
        ? exceedsAbsolute(difference, "0.15")
        : exceedsRelative(difference, anchor, "20");
  } else if (nutrient === "salt") {
    exceeds =
      compareDecimals(anchor, "1.25") < 0
        ? exceedsAbsolute(difference, "0.375")
        : exceedsRelative(difference, anchor, "20");
  } else {
    const upper = nutrient === "vitamin" ? "1.5" : "1.45";
    exceeds =
      compareDecimals(candidate, multiplyDecimals(anchor, upper)) > 0 ||
      compareDecimals(candidate, multiplyDecimals(anchor, "0.65")) < 0;
  }
  return exceeds ? "manual_review" : "informative_discrepancy";
}

export function intervalsOverlap(
  left: Readonly<{ maximum: string; minimum: string }>,
  right: Readonly<{ maximum: string; minimum: string }>,
): boolean {
  if (
    compareDecimals(left.minimum, left.maximum) > 0 ||
    compareDecimals(right.minimum, right.maximum) > 0
  ) {
    throw new Error("invalid_interval");
  }
  return (
    compareDecimals(left.minimum, right.maximum) <= 0 &&
    compareDecimals(right.minimum, left.maximum) <= 0
  );
}

type MassBalanceComponents = Readonly<{
  alcohol: string | null;
  ash: string | null;
  carbohydrates: string | null;
  fat: string | null;
  fiber: string | null;
  protein: string | null;
  water: string | null;
}>;

export function checkMassBalance(components: MassBalanceComponents): {
  status: "acceptable" | "not_evaluable" | "preferred" | "priority_review";
  total: string | null;
} {
  const values = Object.values(components);
  if (values.some((value) => value === null)) {
    return { status: "not_evaluable", total: null };
  }
  const knownValues = values as string[];
  const total = sumDecimals(knownValues);
  if (knownValues.some((value) => compareDecimals(value, "0") < 0)) {
    return { status: "priority_review", total };
  }
  if (compareDecimals(total, "97") >= 0 && compareDecimals(total, "103") <= 0) {
    return { status: "preferred", total };
  }
  if (compareDecimals(total, "95") >= 0 && compareDecimals(total, "105") <= 0) {
    return { status: "acceptable", total };
  }
  return { status: "priority_review", total };
}

function canonicalValue(value: unknown): unknown {
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "string") return value.normalize("NFC");
  if (typeof value === "number" && Number.isFinite(value)) {
    return normalizeDecimal(String(value));
  }
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (typeof value !== "object") throw new Error("invalid_canonical_value");

  const prototype = Reflect.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new Error("invalid_canonical_value");
  }

  const entries = Object.entries(value as Record<string, unknown>).map(
    ([key, entryValue]) => [key.normalize("NFC"), canonicalValue(entryValue)] as const,
  );
  const keys = entries.map(([key]) => key);
  if (new Set(keys).size !== keys.length) throw new Error("canonical_key_collision");

  return Object.fromEntries(
    entries.sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0)),
  );
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalValue(value));
}

export async function sha256CanonicalJson(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalJson(value));
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export const ENGINE_VERSION = "engine-v1" as const;
export const SOURCE_MANIFEST_ID = "50ee50a1-f142-4d59-a957-b7a32538a937" as const;

export type RuleRevision = Readonly<{
  evidenceRefs: readonly string[];
  id: string;
  kind: "conditional" | "mandatory" | "preferential";
  reviewedAt: string;
  ruleId: string;
  scope: readonly QuestionnaireModule[];
  status: "active" | "inactive";
  version: string;
}>;

export const CORE_RULE_REVISIONS = [
  {
    evidenceRefs: ["contract:questionnaire-module-selection-v1"],
    id: "rule.module-selection@1.0.0",
    kind: "preferential",
    reviewedAt: "2026-07-18",
    ruleId: "rule.module-selection",
    scope: QUESTIONNAIRE_MODULES,
    status: "active",
    version: "1.0.0",
  },
  {
    evidenceRefs: ["contract:training-optional-v1"],
    id: "rule.training-none@1.0.0",
    kind: "mandatory",
    reviewedAt: "2026-07-18",
    ruleId: "rule.training-none",
    scope: ["training"],
    status: "active",
    version: "1.0.0",
  },
] as const satisfies readonly RuleRevision[];

export const CORE_RULE_SET_REVISION = {
  id: "8f1d57b0-0dc2-4cd2-aef9-2dc0b31bc921",
  ruleRevisionIds: CORE_RULE_REVISIONS.map(({ id }) => id),
  status: "active",
  version: "1.0.0",
} as const;
export const RULE_SET_REVISION_ID = CORE_RULE_SET_REVISION.id;

export const CORE_SOURCE_MANIFEST = {
  id: SOURCE_MANIFEST_ID,
  sourceRevisionIds: [],
  version: "core-empty-v1",
} as const;

const ACTION_LEVELS = [
  "information",
  "adjustment",
  "priority_review",
  "immediate_conservative",
] as const;
type ActionLevel = (typeof ACTION_LEVELS)[number];

type ConstraintRule<Choice extends string> = Readonly<{
  actionLevel: ActionLevel;
  active?: boolean | null;
  allowed: readonly Choice[];
  id: string;
  kind: "conditional" | "mandatory";
}>;

type PreferentialRule<Choice extends string> = Readonly<{
  actionLevel: ActionLevel;
  id: string;
  kind: "preferential";
  order: readonly Choice[];
}>;

export type ChoiceRule<Choice extends string> =
  ConstraintRule<Choice> | PreferentialRule<Choice>;

export function resolveChoice<Choice extends string>(input: {
  options: readonly Choice[];
  rules: readonly ChoiceRule<Choice>[];
}): {
  appliedRuleIds: string[];
  choice: Choice | null;
  options: Choice[];
  strictestActionLevel: ActionLevel;
  unresolvedRuleIds: string[];
} {
  let options = [...input.options];
  const appliedRuleIds: string[] = [];
  const unresolvedRuleIds: string[] = [];
  let strictestActionLevel: ActionLevel = "information";

  const applyLevel = (level: ActionLevel) => {
    if (ACTION_LEVELS.indexOf(level) > ACTION_LEVELS.indexOf(strictestActionLevel)) {
      strictestActionLevel = level;
    }
  };

  for (const rule of input.rules) {
    if (rule.kind === "conditional" && rule.active === null) {
      unresolvedRuleIds.push(rule.id);
      continue;
    }
    if (rule.kind === "conditional" && rule.active === false) continue;

    appliedRuleIds.push(rule.id);
    applyLevel(rule.actionLevel);
    if (rule.kind === "preferential") {
      const rank = new Map(rule.order.map((choice, index) => [choice, index]));
      options = options
        .map((choice, index) => ({ choice, index }))
        .sort(
          (left, right) =>
            (rank.get(left.choice) ?? Number.MAX_SAFE_INTEGER) -
              (rank.get(right.choice) ?? Number.MAX_SAFE_INTEGER) ||
            left.index - right.index,
        )
        .map(({ choice }) => choice);
      continue;
    }
    const allowed = new Set(rule.allowed);
    options = options.filter((choice) => allowed.has(choice));
  }

  return {
    appliedRuleIds,
    choice: options[0] ?? null,
    options,
    strictestActionLevel,
    unresolvedRuleIds,
  };
}

export type DeterministicEngineInput = Readonly<{
  baseContext: ContextSnapshotInternal | null;
  baseModuleResults: readonly PlanModuleResultInput[] | null;
  change: PlanContextChange | null;
  context: ContextSnapshotInternal;
}>;

function moduleChoice(
  module: QuestionnaireModule,
  context: ContextSnapshotInternal,
): "not_requested" | "requested" {
  const selected = context.answers.activeModules?.includes(module) ?? false;
  const rules: ChoiceRule<"not_requested" | "requested">[] = [];
  if (module === "training" && context.answers.trainingMode === "none") {
    rules.push({
      actionLevel: "adjustment",
      allowed: ["not_requested"],
      id: "rule.training-none@1.0.0",
      kind: "mandatory",
    });
  }
  rules.push({
    actionLevel: "information",
    id: "rule.module-selection@1.0.0",
    kind: "preferential",
    order: selected ? ["requested", "not_requested"] : ["not_requested", "requested"],
  });
  return resolveChoice({
    options: ["requested", "not_requested"],
    rules,
  }).choice!;
}

function provisionalModuleResult(
  module: QuestionnaireModule,
  context: ContextSnapshotInternal,
): PlanModuleResultInput {
  if (moduleChoice(module, context) === "requested") {
    return {
      confidence: "unknown",
      module,
      payload: { requested: true, stage: "deterministic_core" },
      status: "provisional",
      uncertainties: [
        {
          code: "MODULE_IMPLEMENTATION_PENDING",
          messageKey: "plan.module.implementation_pending",
          module,
        },
      ],
    };
  }
  return {
    confidence: "high",
    module,
    payload: {
      reason:
        module === "training" && context.answers.trainingMode === "none"
          ? "training_disabled_by_user"
          : "module_not_selected",
    },
    status: "not_requested",
    uncertainties: [],
  };
}

function normativeContext(context: ContextSnapshotInternal) {
  return {
    answers: context.answers,
    canonicalizationVersion: context.canonicalizationVersion,
    completeness: context.completeness,
    inputHash: context.inputHash,
    normalizationVersion: context.normalizationVersion,
    schemaVersion: context.schemaVersion,
  };
}

export async function runDeterministicEngine(
  input: DeterministicEngineInput,
): Promise<PlanEngineResult> {
  const affectedModules = new Set(
    input.change?.affectedModules ?? QUESTIONNAIRE_MODULES,
  );
  const baseResults = new Map(
    (input.baseModuleResults ?? []).map((result) => [result.module, result]),
  );
  const preservedModules: QuestionnaireModule[] = [];
  const recalculatedModules: QuestionnaireModule[] = [];
  const moduleResults = QUESTIONNAIRE_MODULES.map((module) => {
    const baseResult = baseResults.get(module);
    if (
      input.baseContext &&
      input.change &&
      !affectedModules.has(module) &&
      baseResult
    ) {
      preservedModules.push(module);
      return baseResult;
    }
    recalculatedModules.push(module);
    return provisionalModuleResult(module, input.context);
  });
  const errors = input.context.answers.activeModules?.length
    ? []
    : ["modules_required"];
  const validationStatus: "invalid" | "valid" =
    errors.length === 0 ? "valid" : "invalid";
  const validation = {
    checks: ["canonical_input", "module_coverage", "training_optional"],
    completeness: "provisional" as const,
    errors,
    preservedModules,
    provisionalReasons: ["module_implementation_pending"],
    recalculatedModules,
    warnings: [],
  };
  const inputHash = await sha256CanonicalJson({
    base:
      input.baseContext === null
        ? null
        : {
            context: normativeContext(input.baseContext),
            moduleResults: input.baseModuleResults ?? [],
          },
    change: input.change,
    configuration: {
      canonicalizationVersion: CONTEXT_CANONICALIZATION_VERSION,
      engineVersion: ENGINE_VERSION,
      ruleSetRevision: CORE_RULE_SET_REVISION,
      sourceManifest: CORE_SOURCE_MANIFEST,
    },
    context: normativeContext(input.context),
  });
  const normativeOutput = {
    canonicalizationVersion: CONTEXT_CANONICALIZATION_VERSION,
    completeness: "provisional" as const,
    engineVersion: ENGINE_VERSION,
    inputHash,
    moduleResults,
    ruleSetRevisionId: RULE_SET_REVISION_ID,
    safetyFindings: [],
    sourceManifestId: SOURCE_MANIFEST_ID,
    validation,
    validationStatus,
  };

  return {
    ...normativeOutput,
    outputHash: await sha256CanonicalJson(normativeOutput),
  };
}
