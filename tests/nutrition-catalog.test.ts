import { describe, expect, it } from "vitest";

import {
  IMPORT_LIMITS,
  SOURCE_PRIORITY,
  buildNutritionQuarantineBatch,
  resolveNutritionCandidate,
  validateNutritionImportEnvelope,
} from "@health-design/catalog/nutrition";
import {
  blsOatsArtifact,
  ciqualOatsArtifact,
  commercialLabelArtifact,
  conflictingUsdaOatsArtifact,
  cookedOatsArtifact,
  fineliOatsArtifact,
  withRawSuffix,
  withTransformations,
} from "@health-design/test-fixtures/nutrition";

describe("catálogo nutricional federado", () => {
  it("aplica la precedencia canónica y cubre lagunas sin promediar", async () => {
    expect(SOURCE_PRIORITY).toEqual([
      "ciqual_2025",
      "bls_4_0",
      "fineli",
      "livsmedelsverket",
      "usda_foundation",
      "usda_sr_legacy",
      "bedca_public",
    ]);

    const batches = await Promise.all(
      [ciqualOatsArtifact, blsOatsArtifact, fineliOatsArtifact].map(
        buildNutritionQuarantineBatch,
      ),
    );
    const candidate = resolveNutritionCandidate({
      canonicalFoodKey: "food:oat-flakes",
      existingEffectiveRevisionId: null,
      resolutionContext: {
        basis: "per_100_g",
        ediblePart: "whole_edible_product",
        foodState: "raw",
        method: "source_declared",
      },
      revisions: batches.flatMap(({ revisions }) => revisions),
    });

    expect(candidate.nutrients.protein).toMatchObject({
      sourceKey: "ciqual_2025",
      value: "13",
    });
    expect(candidate.nutrients.fiber).toMatchObject({
      sourceKey: "bls_4_0",
      value: "10",
    });
    expect(candidate.nutrients.fiber?.sourceKey).not.toBe("fineli");
    expect(candidate.averaged).toBe(false);
  });

  it("conserva un valor desconocido como desconocido y nunca como cero", async () => {
    const batch = await buildNutritionQuarantineBatch(ciqualOatsArtifact);
    expect(batch.revisions[0]?.nutrients.fiber).toMatchObject({
      normalizedValue: null,
      originalValue: null,
      state: "missing",
    });
  });

  it("no mezcla estados ni partes comestibles incompatibles", async () => {
    const [raw, cooked] = await Promise.all([
      buildNutritionQuarantineBatch(ciqualOatsArtifact),
      buildNutritionQuarantineBatch(cookedOatsArtifact),
    ]);
    const candidate = resolveNutritionCandidate({
      canonicalFoodKey: "food:oat-flakes",
      existingEffectiveRevisionId: null,
      resolutionContext: {
        basis: "per_100_g",
        ediblePart: "whole_edible_product",
        foodState: "raw",
        method: "source_declared",
      },
      revisions: [...raw.revisions, ...cooked.revisions],
    });

    expect(candidate.nutrients.protein?.value).toBe("13");
    expect(candidate.excludedRevisionIds).toEqual([cooked.revisions[0]?.id]);
  });

  it("abre revisión ante una discrepancia material y nunca publica automáticamente", async () => {
    const [anchor, conflict] = await Promise.all([
      buildNutritionQuarantineBatch(ciqualOatsArtifact),
      buildNutritionQuarantineBatch(conflictingUsdaOatsArtifact),
    ]);
    const candidate = resolveNutritionCandidate({
      canonicalFoodKey: "food:oat-flakes",
      existingEffectiveRevisionId: "effective-previous",
      resolutionContext: {
        basis: "per_100_g",
        ediblePart: "whole_edible_product",
        foodState: "raw",
        method: "source_declared",
      },
      revisions: [...anchor.revisions, ...conflict.revisions],
    });

    expect(candidate.status).toBe("review_required");
    expect(candidate.reviews).toEqual([
      expect.objectContaining({
        candidateSourceKey: "usda_foundation",
        nutrientKey: "protein",
        status: "manual_review",
      }),
    ]);
    expect(candidate.effectiveRevisionId).toBe("effective-previous");
    expect(candidate.publishAutomatically).toBe(false);
  });

  it("rechaza una etiqueta GTIN antes de que pueda alterar un alimento genérico", async () => {
    const batch = await buildNutritionQuarantineBatch(commercialLabelArtifact);
    expect(batch.status).toBe("rejected");
    expect(batch.revisions).toEqual([]);
    expect(batch.violations).toContainEqual(
      expect.objectContaining({ code: "commercial_product_not_allowed" }),
    );
  });

  it("conserva hashes bruto y normalizado y versiona cualquier cambio material", async () => {
    const base = await buildNutritionQuarantineBatch(ciqualOatsArtifact);
    const byteChanged = await buildNutritionQuarantineBatch(
      withRawSuffix(ciqualOatsArtifact, " "),
    );
    const transformChanged = await buildNutritionQuarantineBatch(
      withTransformations(ciqualOatsArtifact, ["fixture:ciqual_2025:v2"]),
    );

    expect(base.manifest.rawContentHash).not.toBe(base.manifest.normalizedContentHash);
    expect(base.manifest.hashAlgorithm).toBe("sha256");
    expect(base.manifest.canonicalizationVersion).toBe("canonical-json-v1");
    expect(byteChanged.manifest.rawContentHash).not.toBe(base.manifest.rawContentHash);
    expect(byteChanged.manifest.normalizedContentHash).toBe(
      base.manifest.normalizedContentHash,
    );
    expect(byteChanged.manifest.id).not.toBe(base.manifest.id);
    expect(transformChanged.manifest.normalizedContentHash).not.toBe(
      base.manifest.normalizedContentHash,
    );
    expect(transformChanged.manifest.id).not.toBe(base.manifest.id);
  });

  it.each([
    ["archivo", { fileBytes: IMPORT_LIMITS.fileBytes + 1 }],
    ["filas", { rowCount: IMPORT_LIMITS.rowCount + 1 }],
    ["columnas", { columnCount: IMPORT_LIMITS.columnCount + 1 }],
    ["celda", { maximumCellBytes: IMPORT_LIMITS.cellBytes + 1 }],
    ["descomprimido", { uncompressedBytes: IMPORT_LIMITS.uncompressedBytes + 1 }],
    ["archivo anidado", { archiveDepth: 1 }],
  ])("rechaza %s justo fuera del límite sin publicación parcial", (_label, change) => {
    const result = validateNutritionImportEnvelope({
      archiveDepth: 0,
      columnCount: 10,
      fileBytes: 1_024,
      maximumCellBytes: 128,
      rowCount: 10,
      uncompressedBytes: 2_048,
      ...change,
    });

    expect(result.accepted).toBe(false);
    expect(result.publicationCount).toBe(0);
    expect(result.quarantined).toBe(true);
  });
});
