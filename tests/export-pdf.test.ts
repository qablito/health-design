import { decodePDFRawStream, PDFArray, PDFDocument, PDFRawStream } from "pdf-lib";
import { describe, expect, it } from "vitest";

import { EXPORT_RENDERER_VERSION } from "@health-design/contracts";
import { createExportModel } from "@health-design/export/model";
import { renderPdf } from "@health-design/export/pdf";
import {
  commercialProductPrivateSentinels,
  exportNutrition,
  exportModels,
  exportShoppingSnapshots,
} from "@health-design/test-fixtures/exports";

function shoppingModel() {
  const snapshot = exportShoppingSnapshots.partial.snapshot;
  return createExportModel({
    config: {
      choices: [],
      detail: "compact",
      format: "pdf",
      includeShopping: true,
      includeWeeklyPreparation: false,
      presentation: "ingredients",
      range: { kind: "week" },
      schemaVersion: 1,
      shoppingSnapshotId: snapshot.id,
    },
    nutrition: exportNutrition,
    planOutputHash: "ab".repeat(32),
    planVersionId: snapshot.planVersionId,
    rendererVersion: EXPORT_RENDERER_VERSION,
    shoppingSnapshot: snapshot,
  });
}

function renderedText(document: PDFDocument): string {
  const chunks: string[] = [];
  for (const page of document.getPages()) {
    const contents = page.node.Contents();
    const entries = contents instanceof PDFArray ? contents.asArray() : [contents];
    for (const entry of entries) {
      if (!entry) continue;
      const stream = document.context.lookup(entry);
      if (!(stream instanceof PDFRawStream)) continue;
      const decoded = new TextDecoder().decode(decodePDFRawStream(stream).decode());
      for (const match of decoded.matchAll(/<([0-9A-F]+)> Tj/g)) {
        chunks.push(Buffer.from(match[1]!, "hex").toString("latin1"));
      }
    }
  }
  return chunks.join("\n");
}

describe("renderizador PDF privado", () => {
  it("genera páginas A4 válidas, no vacías y bajo el límite", async () => {
    const bytes = await renderPdf(exportModels.compact);
    const document = await PDFDocument.load(bytes);

    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
    expect(document.getPageCount()).toBeGreaterThan(0);
    for (const page of document.getPages()) {
      expect(page.getWidth()).toBeCloseTo(595.28, 1);
      expect(page.getHeight()).toBeCloseTo(841.89, 1);
    }
    expect(bytes.byteLength).toBeGreaterThan(1_000);
    expect(bytes.byteLength).toBeLessThan(25 * 1024 * 1024);
  });

  it("conserva metadatos neutros y hace mayor la salida completa", async () => {
    const compactBytes = await renderPdf(exportModels.compact);
    const completeBytes = await renderPdf(exportModels.complete);
    const compact = await PDFDocument.load(compactBytes);
    const complete = await PDFDocument.load(completeBytes);

    expect(compact.getSubject()).not.toContain(exportModels.compact.planVersionId);
    expect(complete.getSubject()).not.toContain(exportModels.complete.planVersionId);
    expect(compact.getSubject()).not.toContain(exportModels.compact.planOutputHash);
    expect(exportModels.complete.rows.length).toBe(
      exportModels.compact.rows.length * 3,
    );
    expect(completeBytes.byteLength).toBeGreaterThan(compactBytes.byteLength);
    expect(
      `${compact.getTitle()} ${compact.getAuthor()} ${compact.getSubject()}`,
    ).not.toMatch(/alias|medicaci[oó]n|condici[oó]n|suplement/i);
  });

  it("renderiza la compra parcial sin sentinels privados", async () => {
    const model = shoppingModel();
    const bytes = await renderPdf(model);
    const document = await PDFDocument.load(bytes);
    const serialized = new TextDecoder("latin1").decode(bytes);
    const metadata = `${document.getTitle()} ${document.getAuthor()} ${document.getSubject()}`;
    const text = renderedText(document);

    expect(document.getPageCount()).toBeGreaterThan(0);
    expect(text).toContain("Precio base 3.25 EUR");
    expect(text).toContain("2 envases");
    expect(text).toContain("Coste 6.5 EUR");
    expect(text).toContain("Remanente 0 g");
    expect(text).toContain("Precio normalizado 6.5 EUR/kg");
    expect(text).toContain("Subtotal de productos confirmados: 6.5 EUR");
    expect(text).toContain("Comparaci");
    expect(text).toContain("no se declara un ahorro global");
    for (const sentinel of [
      exportShoppingSnapshots.partial.snapshot.id,
      exportShoppingSnapshots.partial.snapshot.inputDigest,
      "08412345678901",
      "8412345678901",
      "private-sku-17e",
    ]) {
      expect(serialized).not.toContain(sentinel);
      expect(metadata).not.toContain(sentinel);
    }
  });

  it("renderiza puntuación española sin caracteres de sustitución", async () => {
    const bytes = await renderPdf(exportModels.preparation);
    const binary = new TextDecoder("latin1").decode(bytes);

    expect(binary).not.toContain("�");
    expect(bytes.byteLength).toBeLessThan(25 * 1024 * 1024);
  });

  it("no incorpora identificadores privados del producto comercial", async () => {
    const bytes = await renderPdf(exportModels.commercialProduct);
    const document = await PDFDocument.load(bytes);
    const serialized = new TextDecoder("latin1").decode(bytes);
    const metadata = `${document.getTitle()} ${document.getAuthor()} ${document.getSubject()}`;

    for (const sentinel of commercialProductPrivateSentinels) {
      expect(serialized).not.toContain(sentinel);
      expect(metadata).not.toContain(sentinel);
    }
  });
});
