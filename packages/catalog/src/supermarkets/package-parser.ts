import type { ConfirmedPackage } from "@health-design/contracts";
import {
  compareDecimals,
  divideDecimals,
  multiplyDecimals,
  normalizeDecimal,
} from "@health-design/engine";

export type PackageReviewReason =
  "ambiguous" | "invalid_content" | "promotion" | "range" | "variable_weight";

export type ParsedSupermarketPackage = Readonly<{
  package: ConfirmedPackage | null;
  reasons: readonly PackageReviewReason[];
  status: "confirmed" | "review";
}>;

const canonicalPositiveDecimal = /^(?:[1-9]\d*)(?:\.\d*[1-9])?$/;

function sourceDecimal(value: string): string {
  const candidate = value.trim().replace(",", ".");
  if (!/^\d+(?:\.\d+)?$/.test(candidate)) throw new Error("invalid_package_content");
  const normalized = normalizeDecimal(candidate);
  if (compareDecimals(normalized, "0") <= 0) {
    throw new Error("invalid_package_content");
  }
  return normalized;
}

function measure(
  quantity: string,
  sourceUnit: string,
): ConfirmedPackage["saleMeasure"] {
  const normalizedUnit = sourceUnit.toLocaleLowerCase("es").replaceAll(".", "");
  if (normalizedUnit === "kg") {
    return {
      dimension: "mass",
      quantity: multiplyDecimals(quantity, "1000"),
      unit: "g",
    };
  }
  if (normalizedUnit === "g") {
    return { dimension: "mass", quantity, unit: "g" };
  }
  if (normalizedUnit === "l") {
    return {
      dimension: "volume",
      quantity: multiplyDecimals(quantity, "1000"),
      unit: "ml",
    };
  }
  if (normalizedUnit === "ml") {
    return { dimension: "volume", quantity, unit: "ml" };
  }
  return { dimension: "count", quantity, unit: "unit" };
}

function confirmedPackage(
  saleMeasure: ConfirmedPackage["saleMeasure"],
): ParsedSupermarketPackage {
  return {
    package: {
      equivalenceEvidenceRef: null,
      equivalentEdibleMassG: null,
      saleMeasure,
    },
    reasons: [],
    status: "confirmed",
  };
}

function review(reason: PackageReviewReason): ParsedSupermarketPackage {
  return { package: null, reasons: [reason], status: "review" };
}

export function parseSupermarketPackage(value: string): ParsedSupermarketPackage {
  const text = value.normalize("NFC").trim();
  const lowered = text.toLocaleLowerCase("es");
  if (/peso\s+variable|peso\s+aproximado|seg[uú]n\s+peso/.test(lowered)) {
    return review("variable_weight");
  }
  if (/\d\s*[-–]\s*\d/.test(lowered)) return review("range");
  if (/promoci[oó]n|oferta|\b2\s*[x×]\s*1\b|\b3\s*[x×]\s*2\b/.test(lowered)) {
    return review("promotion");
  }

  const unitPattern = "(kg|g|ml|l|unidades?|unidad|uds?|ud)";
  const multipack = lowered.match(
    new RegExp(
      `(?:^|\\s)(\\d+(?:[.,]\\d+)?)\\s*[x×]\\s*(\\d+(?:[.,]\\d+)?)\\s*${unitPattern}\\b`,
    ),
  );
  if (multipack) {
    try {
      const countText = multipack[1];
      const quantityText = multipack[2];
      const unit = multipack[3];
      if (countText === undefined || quantityText === undefined || unit === undefined) {
        return review("invalid_content");
      }
      const count = sourceDecimal(countText);
      const quantity = sourceDecimal(quantityText);
      return confirmedPackage(measure(multiplyDecimals(count, quantity), unit));
    } catch {
      return review("invalid_content");
    }
  }

  const single = lowered.match(
    new RegExp(`(?:^|\\s)(\\d+(?:[.,]\\d+)?)\\s*${unitPattern}\\b`),
  );
  if (!single) return review("ambiguous");
  try {
    const quantity = single[1];
    const unit = single[2];
    if (quantity === undefined || unit === undefined) return review("invalid_content");
    return confirmedPackage(measure(sourceDecimal(quantity), unit));
  } catch {
    return review("invalid_content");
  }
}

export function normalizePackagePrice(
  basePriceEur: string,
  package_: ConfirmedPackage,
):
  | Readonly<{ dimension: "mass"; unit: "EUR/kg"; value: string }>
  | Readonly<{ dimension: "volume"; unit: "EUR/L"; value: string }>
  | Readonly<{ dimension: "count"; unit: "EUR/unit"; value: string }> {
  if (!canonicalPositiveDecimal.test(basePriceEur))
    throw new Error("invalid_base_price");
  const price = normalizeDecimal(basePriceEur);
  if (compareDecimals(price, "0") <= 0) throw new Error("invalid_base_price");
  const { dimension, quantity } = package_.saleMeasure;
  const value = divideDecimals(
    dimension === "count" ? price : multiplyDecimals(price, "1000"),
    quantity,
    12,
  );
  if (dimension === "mass") return { dimension, unit: "EUR/kg", value };
  if (dimension === "volume") return { dimension, unit: "EUR/L", value };
  return { dimension, unit: "EUR/unit", value };
}

export function packageSupportsShoppingGrams(package_: ConfirmedPackage): boolean {
  return (
    package_.saleMeasure.dimension === "mass" || package_.equivalentEdibleMassG !== null
  );
}

export function confirmEquivalentEdibleMass(
  package_: ConfirmedPackage,
  equivalentEdibleMassG: string,
  evidence: string,
): ConfirmedPackage {
  if (package_.saleMeasure.dimension === "mass") {
    throw new Error("mass_package_equivalence_not_required");
  }
  if (
    !canonicalPositiveDecimal.test(equivalentEdibleMassG) ||
    compareDecimals(equivalentEdibleMassG, "0") <= 0
  ) {
    throw new Error("invalid_equivalent_edible_mass");
  }
  const equivalenceEvidenceRef = evidence.normalize("NFC").trim();
  if (equivalenceEvidenceRef.length === 0 || equivalenceEvidenceRef.length > 240) {
    throw new Error("invalid_equivalence_evidence");
  }
  return {
    ...package_,
    equivalenceEvidenceRef,
    equivalentEdibleMassG: normalizeDecimal(equivalentEdibleMassG),
  };
}
