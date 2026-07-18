import { describe, expect, it } from "vitest";

import {
  addDecimals,
  canonicalJson,
  compareDecimals,
  multiplyDecimals,
  normalizeDecimal,
  sha256CanonicalJson,
} from "../packages/engine/src/index";

describe("primitivas decimales del motor", () => {
  it("normaliza y opera sin introducir coma flotante binaria", () => {
    expect(normalizeDecimal("001.2300")).toBe("1.23");
    expect(normalizeDecimal("-0.000")).toBe("0");
    expect(addDecimals("0.1", "0.2")).toBe("0.3");
    expect(addDecimals("-1.25", "0.25")).toBe("-1");
    expect(multiplyDecimals("12.5", "0.08")).toBe("1");
    expect(compareDecimals("1.000", "1")).toBe(0);
    expect(compareDecimals("-2", "-1.999")).toBe(-1);
  });

  it("rechaza representaciones ambiguas en vez de rellenarlas o reinterpretarlas", () => {
    for (const value of ["", "1e3", "+1", ".5", "1.", "NaN", "Infinity"]) {
      expect(() => normalizeDecimal(value)).toThrow("invalid_decimal");
    }
  });
});

describe("serialización canónica del motor", () => {
  it("ordena claves, normaliza Unicode NFC y serializa números de frontera como decimales", () => {
    expect(canonicalJson({ b: 0.1, a: "Jose\u0301" })).toBe('{"a":"José","b":"0.1"}');
  });

  it("rechaza claves que colisionan después de normalizar Unicode", () => {
    expect(() => canonicalJson({ "Jose\u0301": 1, José: 2 })).toThrow(
      "canonical_key_collision",
    );
  });

  it("ordena por unidades Unicode sin depender del locale del runtime", () => {
    expect(canonicalJson({ á: "accent", z: "last" })).toBe('{"z":"last","á":"accent"}');
  });

  it("produce el SHA-256 conocido y no depende del orden de inserción", async () => {
    const decomposed = { b: 0.1, a: "Jose\u0301" };
    const composed = { a: "José", b: 0.1 };

    await expect(sha256CanonicalJson(decomposed)).resolves.toBe(
      "a44f7dce72420883053ef7a3b2f2a15bdd22153f94ce87943f3918bcc1909d14",
    );
    await expect(sha256CanonicalJson(composed)).resolves.toBe(
      "a44f7dce72420883053ef7a3b2f2a15bdd22153f94ce87943f3918bcc1909d14",
    );
  });
});
