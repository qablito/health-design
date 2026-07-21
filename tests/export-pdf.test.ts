import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";

import { renderPdf } from "@health-design/export/pdf";
import {
  commercialProductPrivateSentinels,
  exportModels,
} from "@health-design/test-fixtures/exports";

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

    expect(compact.getSubject()).toContain(exportModels.compact.planVersionId);
    expect(complete.getSubject()).toContain(exportModels.complete.planVersionId);
    expect(exportModels.complete.rows.length).toBe(
      exportModels.compact.rows.length * 3,
    );
    expect(completeBytes.byteLength).toBeGreaterThan(compactBytes.byteLength);
    expect(
      `${compact.getTitle()} ${compact.getAuthor()} ${compact.getSubject()}`,
    ).not.toMatch(/alias|medicaci[oó]n|condici[oó]n|suplement/i);
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
