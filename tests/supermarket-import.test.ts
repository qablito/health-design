import { describe, expect, it } from "vitest";

import {
  normalizeSupermarketCatalog,
  neutralizeSpreadsheetCell,
} from "@health-design/catalog/supermarkets";
import { supermarketCatalogFixture } from "@health-design/test-fixtures/shopping-catalogs";

describe("normalización pura de catálogos T17", () => {
  it("conserva el origen y sanitiza únicamente la proyección pública", async () => {
    const result = await normalizeSupermarketCatalog({
      chain: "mercadona",
      market: "ES",
      records: supermarketCatalogFixture,
    });

    expect(result.rejected).toEqual([]);
    expect(result.records).toHaveLength(2);
    const first = result.records[0];
    if (first === undefined) throw new Error("fixture_record_missing");
    expect(first.projection.name).toBe("Pechuga de pollo");
    expect(first.projection.categoryPath).toEqual(["Carne", "Pollo"]);
    expect(first.source.sourceFields.nombre).toBe("  Pechuga   de pollo  ");
    expect(first.projection.usability).toBe("calculable");
    expect(first.projection.normalizedPrice?.value).toBe("6.5");
  });

  it("mantiene un producto sin precio visible pero fuera del cálculo", async () => {
    const result = await normalizeSupermarketCatalog({
      chain: "mercadona",
      market: "ES",
      records: supermarketCatalogFixture,
    });
    const withoutPrice = result.records[1];
    if (withoutPrice === undefined) throw new Error("fixture_record_missing");

    expect(withoutPrice.projection.basePriceEur).toBeNull();
    expect(withoutPrice.projection.usability).toBe("visible");
    expect(withoutPrice.projection.exclusionReasons).toContain("base_price_missing");
    expect(withoutPrice.projection.normalizedPrice).toBeNull();
  });

  it("rechaza precio negativo, otra moneda y contenido cero", async () => {
    const base = supermarketCatalogFixture[0];
    const result = await normalizeSupermarketCatalog({
      chain: "mercadona",
      market: "ES",
      records: [
        { ...base, basePrice: "-1", externalSku: "negative", sourceRecordIndex: 1 },
        { ...base, currency: "USD", externalSku: "currency", sourceRecordIndex: 2 },
        {
          ...base,
          externalSku: "zero-content",
          formatText: "0 g",
          sourceRecordIndex: 3,
        },
      ],
    });

    expect(result.records).toEqual([]);
    expect(result.rejected.map(({ reason }) => reason)).toEqual([
      "invalid_base_price",
      "invalid_currency",
      "invalid_package_content",
    ]);
  });

  it("produce el mismo hash para dos importaciones equivalentes", async () => {
    const first = await normalizeSupermarketCatalog({
      chain: "mercadona",
      market: "ES",
      records: supermarketCatalogFixture,
    });
    const second = await normalizeSupermarketCatalog({
      chain: "mercadona",
      market: "ES",
      records: [...supermarketCatalogFixture],
    });

    expect(first.normalizedSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(second.normalizedSha256).toBe(first.normalizedSha256);
  });

  it.each(["=SUM(A1:A2)", "+1", "-1", "@cmd", " texto"])(
    "neutraliza celdas de hoja de cálculo: %s",
    (value) => {
      const neutralized = neutralizeSpreadsheetCell(value);
      if (/^[=+\-@]/.test(value)) expect(neutralized).toBe(`'${value}`);
      else expect(neutralized).toBe(value);
    },
  );
});
