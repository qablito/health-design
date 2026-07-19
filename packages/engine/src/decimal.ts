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

export function subtractDecimals(left: string, right: string): string {
  const parsedRight = parseDecimal(right);
  return addDecimals(
    left,
    formatDecimal({
      coefficient: -parsedRight.coefficient,
      scale: parsedRight.scale,
    }),
  );
}

export function multiplyDecimals(left: string, right: string): string {
  const parsedLeft = parseDecimal(left);
  const parsedRight = parseDecimal(right);
  return formatDecimal({
    coefficient: parsedLeft.coefficient * parsedRight.coefficient,
    scale: parsedLeft.scale + parsedRight.scale,
  });
}

export function divideDecimals(
  left: string,
  right: string,
  scale = 6,
  mode: "half_away_from_zero" | "toward_zero" = "half_away_from_zero",
): string {
  if (!Number.isInteger(scale) || scale < 0 || scale > 18) {
    throw new Error("invalid_rounding_scale");
  }
  const parsedLeft = parseDecimal(left);
  const parsedRight = parseDecimal(right);
  if (parsedRight.coefficient === 0n) throw new Error("division_by_zero");
  const numerator = parsedLeft.coefficient * powerOfTen(parsedRight.scale + scale);
  const denominator = parsedRight.coefficient * powerOfTen(parsedLeft.scale);
  let quotient = numerator / denominator;
  const remainder = numerator % denominator;
  const absoluteRemainder = remainder < 0n ? -remainder : remainder;
  const absoluteDenominator = denominator < 0n ? -denominator : denominator;
  if (mode === "half_away_from_zero" && absoluteRemainder * 2n >= absoluteDenominator) {
    quotient += numerator < 0n !== denominator < 0n ? -1n : 1n;
  }
  return formatDecimal({ coefficient: quotient, scale });
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

export function absoluteDecimal(value: string): string {
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
