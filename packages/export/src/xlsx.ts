import * as XLSX from "xlsx";

import type { ExportModel } from "./model.ts";

const chainLabels = { aldi: "ALDI", dia: "DIA", mercadona: "Mercadona" } as const;
const stateLabels = {
  no_confirmed_product: "Sin producto confirmado",
  package_unconfirmed: "Envase pendiente de confirmar",
  price_unavailable: "Precio no disponible",
  resolved: "Producto confirmado",
} as const;

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

  const metadata: (string | number)[][] = [
    ["Campo", "Valor"],
    ["Renderizador", model.rendererVersion],
    ["Detalle", model.detail],
    ["Presentación", model.presentation],
    ["Energía total", `${model.totals.energyKcal} kcal`],
    ["Proteína total", `${model.totals.proteinG} g`],
    ["Carbohidratos totales", `${model.totals.carbohydratesG} g`],
    ["Grasa total", `${model.totals.fatG} g`],
    ["Fibra total", `${model.totals.fiberG} g`],
  ];
  if (model.shopping?.kind === "snapshot") {
    const totals = model.shopping.totals;
    metadata.push(
      [
        totals.kind === "complete"
          ? "Total orientativo"
          : "Subtotal de productos confirmados",
        `${totals.kind === "complete" ? totals.estimatedTotalEur : totals.partialSubtotalEur} EUR`,
      ],
      [
        "Cobertura de compra",
        `${totals.coverage.resolvedItems}/${totals.coverage.totalItems}`,
      ],
    );
    if (model.shopping.comparison?.scope === "complete") {
      metadata.push([
        "Ahorro orientativo",
        `${model.shopping.comparison.savingsEur} EUR`,
      ]);
    } else if (model.shopping.comparison?.scope === "partial") {
      metadata.push([
        "Comparación parcial",
        `${model.shopping.comparison.comparableItems}/${model.shopping.comparison.totalItems} líneas comparables`,
      ]);
    }
  }

  XLSX.utils.book_append_sheet(workbook, sheet(metadata, [36, 72]), "Metadatos");

  if (model.shopping?.kind === "canonical") {
    XLSX.utils.book_append_sheet(
      workbook,
      sheet(
        [
          ["Alimento", "Cantidad"],
          ...model.shopping.items.map((item) => [item.name, `${item.amountG} g`]),
        ],
        [32, 16],
      ),
      "Compra",
    );
  }
  if (model.shopping?.kind === "snapshot") {
    XLSX.utils.book_append_sheet(
      workbook,
      sheet(
        [
          [
            "Alimento",
            "Cantidad semanal",
            "Estado",
            "Cadena",
            "Producto",
            "Formato/envase",
            "Precio base orientativo",
            "Envases",
            "Coste orientativo",
            "Remanente estimado",
            "Precio normalizado",
          ],
          ...model.shopping.items.map((item) => [
            item.name,
            `${item.amountG} g`,
            stateLabels[item.state],
            item.selected ? chainLabels[item.selected.chain] : "",
            item.selected?.productName ?? "",
            item.selected?.formatText ?? "",
            item.selected ? `${item.selected.basePriceEur} EUR` : "",
            item.selected?.packageCount ?? "",
            item.selected ? `${item.selected.totalCostEur} EUR` : "",
            item.selected ? `${item.selected.estimatedRemainderG} g` : "",
            item.selected?.normalizedPrice
              ? `${item.selected.normalizedPrice.value} ${item.selected.normalizedPrice.unit}`
              : "",
          ]),
        ],
        [30, 18, 28, 14, 36, 20, 24, 12, 20, 22, 22],
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
