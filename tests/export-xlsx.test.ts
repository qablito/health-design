import * as XLSX from "xlsx";
import { describe, expect, it } from "vitest";

import { renderXlsx } from "@health-design/export/xlsx";
import type { ExportModel } from "@health-design/export/model";
import {
  commercialProductName,
  commercialProductPrivateSentinels,
  exportModels,
} from "@health-design/test-fixtures/exports";

function workbook(model: ExportModel) {
  const bytes = renderXlsx(model);
  return {
    bytes,
    workbook: XLSX.read(bytes, { type: "array" }),
  };
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

  it("conserva versión, unidades y totales tras la lectura", () => {
    const { workbook: result } = workbook(exportModels.complete);
    const metadata = XLSX.utils.sheet_to_json<Record<string, string>>(
      result.Sheets.Metadatos!,
    );
    const plan = XLSX.utils.sheet_to_json<Record<string, string>>(result.Sheets.Plan!);

    expect(metadata).toContainEqual({
      Campo: "Versión del plan",
      Valor: exportModels.complete.planVersionId,
    });
    expect(metadata).toContainEqual({
      Campo: "Energía total",
      Valor: `${exportModels.complete.totals.energyKcal} kcal`,
    });
    expect(plan[0]?.Cantidad).toMatch(/ g$/);
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
