import * as XLSX from "xlsx";
import { describe, expect, it } from "vitest";

import { EXPORT_RENDERER_VERSION } from "@health-design/contracts";
import { createExportModel } from "@health-design/export/model";
import { renderXlsx } from "@health-design/export/xlsx";
import type { ExportModel } from "@health-design/export/model";
import {
  commercialProductName,
  commercialProductPrivateSentinels,
  exportNutrition,
  exportModels,
  exportShoppingSnapshots,
} from "@health-design/test-fixtures/exports";

function workbook(model: ExportModel) {
  const bytes = renderXlsx(model);
  return {
    bytes,
    workbook: XLSX.read(bytes, { type: "array" }),
  };
}

function shoppingModel(
  response: (typeof exportShoppingSnapshots)[keyof typeof exportShoppingSnapshots],
) {
  return createExportModel({
    config: {
      choices: [],
      detail: "compact",
      format: "xlsx",
      includeShopping: true,
      includeWeeklyPreparation: false,
      presentation: "ingredients",
      range: { kind: "week" },
      schemaVersion: 1,
      shoppingSnapshotId: response.snapshot.id,
    },
    nutrition: exportNutrition,
    planOutputHash: "ab".repeat(32),
    planVersionId: response.snapshot.planVersionId,
    rendererVersion: EXPORT_RENDERER_VERSION,
    shoppingSnapshot: response.snapshot,
  });
}

describe("renderizador XLSX privado", () => {
  it("crea hojas obligatorias y solo añade las secciones elegidas", () => {
    const compact = workbook(exportModels.compact);
    const complete = workbook(exportModels.complete);

    expect(compact.workbook.SheetNames).toEqual(["Plan", "Metadatos"]);
    expect(complete.workbook.SheetNames).toEqual([
      "Plan",
      "Metadatos",
      "Compra",
      "Preparación",
    ]);
    expect(compact.bytes.byteLength).toBeLessThan(25 * 1024 * 1024);
    expect(complete.bytes.byteLength).toBeLessThan(25 * 1024 * 1024);
  });

  it("conserva unidades y totales sin IDs ni hashes tras la lectura", () => {
    const { workbook: result } = workbook(exportModels.complete);
    const metadata = XLSX.utils.sheet_to_json<Record<string, string>>(
      result.Sheets.Metadatos!,
    );
    const plan = XLSX.utils.sheet_to_json<Record<string, string>>(result.Sheets.Plan!);

    expect(metadata).not.toContainEqual({
      Campo: "Versión del plan",
      Valor: exportModels.complete.planVersionId,
    });
    expect(JSON.stringify(metadata)).not.toContain(
      exportModels.complete.planOutputHash,
    );
    expect(metadata).toContainEqual({
      Campo: "Energía total",
      Valor: `${exportModels.complete.totals.energyKcal} kcal`,
    });
    expect(plan[0]?.Cantidad).toMatch(/ g$/);
  });

  it("conserva la proyección congelada y distingue subtotal de total", () => {
    const complete = workbook(shoppingModel(exportShoppingSnapshots.complete));
    const partial = workbook(shoppingModel(exportShoppingSnapshots.partial));
    const completeRows = XLSX.utils.sheet_to_json<Record<string, string>>(
      complete.workbook.Sheets.Compra!,
    );
    const partialRows = XLSX.utils.sheet_to_json<Record<string, string>>(
      partial.workbook.Sheets.Compra!,
    );

    expect(completeRows[0]).toMatchObject({
      Alimento: "Pollo",
      Cadena: "Mercadona",
      "Coste orientativo": "6.5 EUR",
      Envases: "2",
      Estado: "Producto confirmado",
      "Formato/envase": "500 g",
      Producto: "Pechuga",
    });
    expect(partialRows.map(({ Alimento }) => Alimento)).toEqual(["Pollo", "'=ARROZ()"]);
    expect(partialRows.at(-1)).toMatchObject({
      Cadena: "",
      Estado: "Precio no disponible",
    });
    expect(
      XLSX.utils.sheet_to_json<Record<string, string>>(
        partial.workbook.Sheets.Metadatos!,
      ),
    ).toContainEqual({
      Campo: "Subtotal de productos confirmados",
      Valor: "6.5 EUR",
    });
  });

  it("neutraliza fórmulas en nombres de compra y filtra identificadores", () => {
    const { workbook: result } = workbook(
      shoppingModel(exportShoppingSnapshots.partial),
    );
    const serialized = JSON.stringify(result);
    const formulaCell = result.Sheets.Compra?.A3 as XLSX.CellObject | undefined;

    expect(formulaCell?.t).toBe("s");
    expect(formulaCell?.v).toBe("'=ARROZ()");
    for (const sentinel of [
      exportShoppingSnapshots.partial.snapshot.id,
      exportShoppingSnapshots.partial.snapshot.inputDigest,
      "08412345678901",
      "8412345678901",
      "private-sku-17e",
    ]) {
      expect(serialized).not.toContain(sentinel);
    }
  });

  it("neutraliza fórmulas y caracteres de control como texto", () => {
    const dangerous = ["=SUM(A1:A2)", "+1", "-1", "@cmd", "\tcmd", "\rcmd"];
    const model = {
      ...exportModels.compact,
      rows: exportModels.compact.rows.slice(0, dangerous.length).map((row, index) => ({
        ...row,
        name: dangerous[index]!,
      })),
    } satisfies ExportModel;
    const { workbook: result } = workbook(model);
    const rows = XLSX.utils.sheet_to_json<Record<string, string>>(result.Sheets.Plan!);

    expect(rows.map(({ Alimento }) => Alimento)).toEqual(
      dangerous.map((value) => `'${value}`),
    );
    for (let row = 2; row <= dangerous.length + 1; row += 1) {
      const cell = result.Sheets.Plan?.[`F${row}`] as XLSX.CellObject | undefined;
      expect(cell?.t).toBe("s");
    }
  });

  it("muestra el producto sin exportar GTIN ni procedencia privada", () => {
    const { workbook: result } = workbook(exportModels.commercialProduct);
    const rows = XLSX.utils.sheet_to_json<Record<string, string>>(result.Sheets.Plan!);
    const serialized = JSON.stringify(result);

    expect(rows.some(({ Alimento }) => Alimento === commercialProductName)).toBe(true);
    for (const sentinel of commercialProductPrivateSentinels) {
      expect(serialized).not.toContain(sentinel);
    }
  });
});
