import { describe, expect, it } from "vitest";

import {
  EXPORT_RENDERER_VERSION,
  type ExportCreateRequestContract,
} from "@health-design/contracts";
import { createExportModel } from "@health-design/export/model";
import {
  exportNutrition,
  exportShoppingSnapshots,
} from "@health-design/test-fixtures/exports";

const config = {
  choices: [],
  detail: "compact",
  format: "pdf",
  includeShopping: true,
  includeWeeklyPreparation: false,
  presentation: "ingredients",
  range: { kind: "week" },
  schemaVersion: 1,
  shoppingSnapshotId: exportShoppingSnapshots.complete.snapshot.id,
} as const satisfies ExportCreateRequestContract;

describe("equivalencia pública del snapshot de compra", () => {
  it("conserva orden, matemáticas y nutrición sin mutar la entrada", () => {
    const response = structuredClone(exportShoppingSnapshots.complete);
    Object.freeze(response.snapshot.items);
    Object.freeze(response.snapshot);
    const model = createExportModel({
      config,
      nutrition: exportNutrition,
      planOutputHash: "ab".repeat(32),
      planVersionId: response.snapshot.planVersionId,
      rendererVersion: EXPORT_RENDERER_VERSION,
      shoppingSnapshot: response.snapshot,
    });

    expect(model.shopping).toMatchObject({
      completeness: "complete",
      items: [
        {
          amountG: "1000",
          selected: {
            basePriceEur: "3.25",
            estimatedRemainderG: "0",
            packageCount: "2",
            totalCostEur: "6.5",
          },
          state: "resolved",
        },
      ],
      kind: "snapshot",
      totals: { estimatedTotalEur: "6.5", kind: "complete" },
    });
    expect(model.totals).toEqual(exportNutrition.weekTotals);
    expect(model.planOutputHash).toBe("ab".repeat(32));
    expect(response).toEqual(exportShoppingSnapshots.complete);
  });

  it("rechaza un snapshot distinto del ID y versión solicitados", () => {
    expect(() =>
      createExportModel({
        config: {
          ...config,
          shoppingSnapshotId: "91000000-0000-4000-8000-000000015099",
        },
        nutrition: exportNutrition,
        planOutputHash: "ab".repeat(32),
        planVersionId: exportShoppingSnapshots.complete.snapshot.planVersionId,
        rendererVersion: EXPORT_RENDERER_VERSION,
        shoppingSnapshot: exportShoppingSnapshots.complete.snapshot,
      }),
    ).toThrow("shopping_snapshot_mismatch");
  });
});
