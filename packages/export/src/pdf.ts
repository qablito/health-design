import { PageSizes, PDFDocument, StandardFonts, rgb, type PDFFont } from "pdf-lib";

import type { ExportModel } from "./model.ts";

const MARGIN = 34;
const BODY_SIZE = 9;
const LINE_HEIGHT = 12;

function lines(text: string, font: PDFFont, size: number, width: number): string[] {
  const result: string[] = [];
  let current = "";
  for (const word of text.replace(/[\t\r\n]+/g, " ").split(/\s+/)) {
    const candidate = current ? `${current} ${word}` : word;
    if (!current || font.widthOfTextAtSize(candidate, size) <= width) {
      current = candidate;
    } else {
      result.push(current);
      current = word;
    }
  }
  if (current) result.push(current);
  return result;
}

export async function renderPdf(model: ExportModel): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  const regular = await document.embedFont(StandardFonts.Helvetica);
  const bold = await document.embedFont(StandardFonts.HelveticaBold);
  document.setTitle("Plan nutricional");
  document.setAuthor("Health Design");
  document.setSubject(
    `Versión del plan ${model.planVersionId}; renderizador ${model.rendererVersion}`,
  );
  document.setKeywords([model.detail, model.presentation, model.format]);

  let page = document.addPage(PageSizes.A4);
  let y = page.getHeight() - MARGIN;
  const width = page.getWidth() - MARGIN * 2;
  const write = (
    text: string,
    options: { font?: PDFFont; gap?: number; size?: number } = {},
  ) => {
    const font = options.font ?? regular;
    const size = options.size ?? BODY_SIZE;
    for (const line of lines(text, font, size, width)) {
      if (y < MARGIN + LINE_HEIGHT) {
        page = document.addPage(PageSizes.A4);
        y = page.getHeight() - MARGIN;
      }
      page.drawText(line, { color: rgb(0.12, 0.2, 0.15), font, size, x: MARGIN, y });
      y -= LINE_HEIGHT;
    }
    y -= options.gap ?? 0;
  };

  write("Plan nutricional", { font: bold, gap: 4, size: 18 });
  write(`Versión ${model.planVersionId} · ${model.rendererVersion}`, { gap: 3 });
  write(
    `Total: ${model.totals.energyKcal} kcal · P ${model.totals.proteinG} g · C ${model.totals.carbohydratesG} g · G ${model.totals.fatG} g · Fibra ${model.totals.fiberG} g`,
    { gap: 8 },
  );

  let heading = "";
  for (const row of model.rows) {
    const nextHeading = `Día ${row.day} · Comida ${row.mealIndex + 1}`;
    if (heading !== nextHeading) {
      heading = nextHeading;
      write(heading, { font: bold, gap: 2, size: 12 });
    }
    write(
      `${row.rowKind === "alternative" ? "Alternativa" : "Elegido"}: ${row.name} · ${row.amountG} g · ${row.nutrients.energyKcal} kcal · P ${row.nutrients.proteinG} g · C ${row.nutrients.carbohydratesG} g · G ${row.nutrients.fatG} g · Fibra ${row.nutrients.fiberG} g`,
    );
    if (model.presentation === "preparation") {
      write(`Preparación: ${row.preparation.instruction}`, { gap: 2 });
    }
  }

  if (model.shoppingList) {
    write("Lista de la compra", { font: bold, gap: 2, size: 12 });
    for (const item of model.shoppingList) write(`${item.name}: ${item.amountG} g`);
  }
  if (model.weeklyPreparation) {
    write("Preparación semanal", { font: bold, gap: 2, size: 12 });
    for (const item of model.weeklyPreparation) {
      write(`${item.name}: ${item.instruction}`);
    }
  }

  return document.save({ addDefaultPage: false, useObjectStreams: false });
}
