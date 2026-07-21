import type {
  CommercialProductCompleteness,
  CommercialProductSnapshot,
  CommercialProductSource,
  ProductGtin,
  ProductSymbology,
} from "@health-design/contracts";
import { CommercialProductSnapshotSchema } from "@health-design/contracts";
import {
  canonicalJson,
  compareDecimals,
  sha256CanonicalJson,
  sumDecimals,
} from "@health-design/engine";

const GTIN_LENGTHS = {
  ean_8: 8,
  ean_13: 13,
  itf_14: 14,
  upc_a: 12,
  upc_e: 8,
} as const satisfies Record<ProductSymbology, number>;

const SOURCE_PRECEDENCE = {
  confirmed_label: 2,
  global: 1,
  manual_blank: 4,
  open_food_facts: 3,
  profile: 0,
} as const satisfies Record<CommercialProductSource, number>;

const LABEL_FIELDS = [
  "energyKcal",
  "fatG",
  "carbohydratesG",
  "proteinG",
  "saltG",
  "saturatedFatG",
  "sugarsG",
] as const;

const CORE_FIELDS = ["energyKcal", "fatG", "carbohydratesG", "proteinG"] as const;

const UNCERTAINTY_FIELD_ORDER = [
  "energyKcal",
  "fatG",
  "carbohydratesG",
  "fiberG",
  "proteinG",
  "saltG",
  "saturatedFatG",
  "sugarsG",
] as const;

type GtinInput = Readonly<{ code: string; symbology: ProductSymbology }>;

function calculateCheckDigit(payload: string): string {
  let sum = 0;
  for (let index = payload.length - 1, position = 0; index >= 0; index--, position++) {
    sum += Number(payload[index]) * (position % 2 === 0 ? 3 : 1);
  }
  return String((10 - (sum % 10)) % 10);
}

function hasValidCheckDigit(code: string): boolean {
  return calculateCheckDigit(code.slice(0, -1)) === code.at(-1);
}

function expandUpcE(code: string): string {
  const numberSystem = code[0];
  const [d1, d2, d3, d4, d5, d6] = code.slice(1, 7);
  const checkDigit = code[7];
  if (numberSystem !== "0" && numberSystem !== "1") throw new Error("invalid_gtin");

  let manufacturer: string;
  let product: string;
  if (d6 === "0" || d6 === "1" || d6 === "2") {
    manufacturer = `${d1}${d2}${d6}00`;
    product = `00${d3}${d4}${d5}`;
  } else if (d6 === "3") {
    manufacturer = `${d1}${d2}${d3}00`;
    product = `000${d4}${d5}`;
  } else if (d6 === "4") {
    manufacturer = `${d1}${d2}${d3}${d4}0`;
    product = `0000${d5}`;
  } else {
    manufacturer = `${d1}${d2}${d3}${d4}${d5}`;
    product = `0000${d6}`;
  }
  return `${numberSystem}${manufacturer}${product}${checkDigit}`;
}

export function normalizeProductGtin(input: GtinInput): ProductGtin {
  const displayGtin = input.code.trim();
  if (
    displayGtin.length !== GTIN_LENGTHS[input.symbology] ||
    !/^\d+$/.test(displayGtin)
  ) {
    throw new Error("invalid_gtin");
  }

  const expanded = input.symbology === "upc_e" ? expandUpcE(displayGtin) : displayGtin;
  if (!hasValidCheckDigit(expanded)) throw new Error("invalid_gtin");

  return {
    displayGtin,
    gtin14: expanded.padStart(14, "0"),
    symbology: input.symbology,
  };
}

type SnapshotLimitViolation =
  | "snapshot_schema_invalid"
  | "snapshot_bytes_limit"
  | "snapshot_fields_limit"
  | "snapshot_depth_limit"
  | "snapshot_list_limit"
  | "name_graphemes_limit";

function countFields(value: unknown): number {
  if (Array.isArray(value)) {
    const entries: unknown[] = value;
    return entries.reduce<number>((total, entry) => total + countFields(entry), 0);
  }
  if (value === null || typeof value !== "object") return 0;
  return Object.entries(value).reduce(
    (total, [, entry]) => total + 1 + countFields(entry),
    0,
  );
}

function maximumDepth(value: unknown, current = 1): number {
  if (value === null || typeof value !== "object") return current;
  const children = Array.isArray(value) ? value : Object.values(value);
  return children.length === 0
    ? current
    : Math.max(...children.map((entry) => maximumDepth(entry, current + 1)));
}

function maximumListLength(value: unknown): number {
  if (Array.isArray(value)) {
    return Math.max(value.length, ...value.map(maximumListLength));
  }
  if (value === null || typeof value !== "object") return 0;
  return Math.max(0, ...Object.values(value).map(maximumListLength));
}

export function validateCommercialProductSnapshotLimits(snapshot: unknown): Readonly<{
  valid: boolean;
  violations: readonly SnapshotLimitViolation[];
}> {
  const violations: SnapshotLimitViolation[] = [];
  if (!CommercialProductSnapshotSchema.safeParse(snapshot).success) {
    violations.push("snapshot_schema_invalid");
  }

  try {
    if (new TextEncoder().encode(canonicalJson(snapshot)).byteLength > 65_536) {
      violations.push("snapshot_bytes_limit");
    }
  } catch {
    if (!violations.includes("snapshot_schema_invalid")) {
      violations.push("snapshot_schema_invalid");
    }
  }
  if (countFields(snapshot) > 100) violations.push("snapshot_fields_limit");
  if (maximumDepth(snapshot) > 12) violations.push("snapshot_depth_limit");
  if (maximumListLength(snapshot) > 100) violations.push("snapshot_list_limit");

  if (
    typeof snapshot === "object" &&
    snapshot !== null &&
    "name" in snapshot &&
    typeof snapshot.name === "string" &&
    [...new Intl.Segmenter("es", { granularity: "grapheme" }).segment(snapshot.name)]
      .length > 200
  ) {
    violations.push("name_graphemes_limit");
  }

  return { valid: violations.length === 0, violations };
}

export async function commercialProductSnapshotContentHash(
  snapshot: CommercialProductSnapshot,
): Promise<string> {
  return sha256CanonicalJson(CommercialProductSnapshotSchema.parse(snapshot));
}

type ProductCoherenceFinding =
  | "mass_balance_exceeds_105"
  | "saturated_fat_exceeds_total_fat"
  | "sugars_exceed_carbohydrates"
  | "zero_energy_with_energy_bearing_nutrients";

function availableNutrientValue(
  nutrient: CommercialProductSnapshot["nutrients"][keyof Omit<
    CommercialProductSnapshot["nutrients"],
    "clinical"
  >],
): string | null {
  return nutrient.state === "unknown" ? null : nutrient.value;
}

export function evaluateCommercialProductSnapshotCoherence(
  snapshot: CommercialProductSnapshot,
): Readonly<{
  findings: readonly ProductCoherenceFinding[];
  status: "priority_review" | "valid";
}> {
  const parsed = CommercialProductSnapshotSchema.parse(snapshot);
  const findings: ProductCoherenceFinding[] = [];
  const nutrients = parsed.nutrients;
  const fat = availableNutrientValue(nutrients.fatG);
  const saturatedFat = availableNutrientValue(nutrients.saturatedFatG);
  const carbohydrates = availableNutrientValue(nutrients.carbohydratesG);
  const sugars = availableNutrientValue(nutrients.sugarsG);
  const protein = availableNutrientValue(nutrients.proteinG);
  const fiber = availableNutrientValue(nutrients.fiberG);
  const energy = availableNutrientValue(nutrients.energyKcal);

  if (
    parsed.basis === "per_100_g" &&
    fat !== null &&
    carbohydrates !== null &&
    protein !== null &&
    fiber !== null &&
    compareDecimals(sumDecimals([fat, carbohydrates, protein, fiber]), "105") > 0
  ) {
    findings.push("mass_balance_exceeds_105");
  }
  if (fat !== null && saturatedFat !== null && compareDecimals(saturatedFat, fat) > 0) {
    findings.push("saturated_fat_exceeds_total_fat");
  }
  if (
    carbohydrates !== null &&
    sugars !== null &&
    compareDecimals(sugars, carbohydrates) > 0
  ) {
    findings.push("sugars_exceed_carbohydrates");
  }
  if (
    energy !== null &&
    compareDecimals(energy, "0") === 0 &&
    [fat, carbohydrates, protein, fiber].some(
      (value) => value !== null && compareDecimals(value, "0") > 0,
    )
  ) {
    findings.push("zero_energy_with_energy_bearing_nutrients");
  }

  return {
    findings,
    status: findings.length > 0 ? "priority_review" : "valid",
  };
}

type CompletenessRequirements = Readonly<{
  requiredClinicalNutrients?: readonly string[];
  requiredSafetyFields?: readonly (keyof CommercialProductSnapshot["safety"])[];
}>;

export function classifyCommercialProductCompleteness(
  snapshot: CommercialProductSnapshot,
  requirements: CompletenessRequirements = {},
): Readonly<{
  completeness: CommercialProductCompleteness;
  uncertainties: readonly string[];
}> {
  const parsed = CommercialProductSnapshotSchema.parse(snapshot);
  const uncertainties: string[] = [];
  for (const field of UNCERTAINTY_FIELD_ORDER) {
    const state = parsed.nutrients[field].state;
    if (state !== "known") uncertainties.push(`${field}_${state}`);
  }
  for (const field of requirements.requiredSafetyFields ?? []) {
    if (parsed.safety[field].state === "unknown") {
      uncertainties.push(`${field}_unknown`);
    }
  }
  for (const nutrient of requirements.requiredClinicalNutrients ?? []) {
    const state = parsed.nutrients.clinical[nutrient]?.state ?? "unknown";
    if (state !== "known") uncertainties.push(`clinical_${nutrient}_${state}`);
  }

  const requiredSafetyUnknown = (requirements.requiredSafetyFields ?? []).some(
    (field) => parsed.safety[field].state === "unknown",
  );
  const requiredClinicalUnavailable = (
    requirements.requiredClinicalNutrients ?? []
  ).some((nutrient) => parsed.nutrients.clinical[nutrient]?.state !== "known");
  const coreUnavailable = CORE_FIELDS.some(
    (field) => parsed.nutrients[field].state === "unknown",
  );

  let completeness: CommercialProductCompleteness;
  if (coreUnavailable || requiredSafetyUnknown || requiredClinicalUnavailable) {
    completeness = "insufficient";
  } else if (LABEL_FIELDS.some((field) => parsed.nutrients[field].state !== "known")) {
    completeness = "provisional";
  } else {
    completeness = "complete";
  }
  return { completeness, uncertainties };
}

export type CommercialProductCandidate = Readonly<{
  id: string;
  snapshot: CommercialProductSnapshot;
  source: CommercialProductSource;
}>;

export function resolveCommercialProductCandidate(
  candidates: readonly CommercialProductCandidate[],
): CommercialProductCandidate | null {
  return (
    [...candidates].sort(
      (left, right) => SOURCE_PRECEDENCE[left.source] - SOURCE_PRECEDENCE[right.source],
    )[0] ?? null
  );
}
