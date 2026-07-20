import * as XLSX from "xlsx";

import type { ExportModel } from "./model.ts";

function text(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

function sheet(rows: (string | number)[][], widths: number[]): XLSX.WorkSheet {
  const safeRows = rows.map((row) =>
    row.map((value) => (typeof value === "string" ? text(value) : value)),
  );
  const result = XLSX.utils.aoa_to_sheet(safeRows);
  result["!cols"] = widths.map((wch) => ({ wch }));
  return result;
}

export function renderXlsx(model: ExportModel): Uint8Array {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    workbook,
    sheet(
      [
        [
          "Día",
          "Comida",
          "Tipo",
          "Elección",
          "Función",
          "Alimento",
          "Cantidad",
          "Estado",
          "Energía",
          "Proteína",
          "Carbohidratos",
          "Grasa",
          "Fibra",
          "Preparación",
        ],
        ...model.rows.map((row) => [
          row.day,
          row.mealIndex + 1,
          row.rowKind === "selected" ? "Elegido" : "Alternativa",
          row.choice,
          row.function,
          row.name,
          `${row.amountG} g`,
          row.foodState,
          `${row.nutrients.energyKcal} kcal`,
          `${row.nutrients.proteinG} g`,
          `${row.nutrients.carbohydratesG} g`,
          `${row.nutrients.fatG} g`,
          `${row.nutrients.fiberG} g`,
          model.presentation === "preparation" ? row.preparation.instruction : "",
        ]),
      ],
      [6, 8, 12, 9, 20, 28, 14, 12, 14, 14, 18, 14, 14, 60],
    ),
    "Plan",
  );

  XLSX.utils.book_append_sheet(
    workbook,
    sheet(
      [
        ["Campo", "Valor"],
        ["Versión del plan", model.planVersionId],
        ["Hash del plan", model.planOutputHash],
        ["Renderizador", model.rendererVersion],
        ["Detalle", model.detail],
        ["Presentación", model.presentation],
        ["Energía total", `${model.totals.energyKcal} kcal`],
        ["Proteína total", `${model.totals.proteinG} g`],
        ["Carbohidratos totales", `${model.totals.carbohydratesG} g`],
        ["Grasa total", `${model.totals.fatG} g`],
        ["Fibra total", `${model.totals.fiberG} g`],
      ],
      [24, 72],
    ),
    "Metadatos",
  );

  if (model.shoppingList) {
    XLSX.utils.book_append_sheet(
      workbook,
      sheet(
        [
          ["Alimento", "Cantidad"],
          ...model.shoppingList.map((item) => [item.name, `${item.amountG} g`]),
        ],
        [32, 16],
      ),
      "Compra",
    );
  }
  if (model.weeklyPreparation) {
    XLSX.utils.book_append_sheet(
      workbook,
      sheet(
        [
          ["Alimento", "Preparación"],
          ...model.weeklyPreparation.map((item) => [item.name, item.instruction]),
        ],
        [32, 72],
      ),
      "Preparación",
    );
  }

  const output = XLSX.write(workbook, {
    bookType: "xlsx",
    compression: true,
    type: "array",
  }) as ArrayBuffer;
  return new Uint8Array(output);
}
