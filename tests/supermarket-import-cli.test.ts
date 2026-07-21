import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

import {
  SUPERMARKET_IMPORT_LIMITS,
  assertLocalSupermarketInput,
  canPublishSupermarketSource,
  importSupermarketCatalogFile,
  validateSupermarketImportEnvelope,
} from "../scripts/import-supermarket-catalog/sources.ts";
import {
  resolveR2ManifestCollision,
  supermarketR2ObjectKeys,
} from "../scripts/import-supermarket-catalog/r2-manifest.ts";

const execFileAsync = promisify(execFile);
const root = resolve(import.meta.dirname, "..");

const header = [
  "retailer",
  "sku",
  "source_url",
  "slug",
  "source_category",
  "image_url",
  "gtin",
  "name",
  "brand",
  "package_text",
  "price_eur",
  "observed_at",
  "postal_code",
  "location_mode",
  "data_status",
  "last_error",
].join(",");

const accepted = [
  "mercadona",
  "123",
  "https://tienda.mercadona.es/product/123/test",
  "test",
  "Carne > Pollo",
  "",
  "8412345678905",
  '"Pechuga, de pollo"',
  "",
  "500 g",
  "3.25",
  "2026-07-16T12:00:00.000Z",
  "41006",
  "postal_code",
  "hydrated",
  "",
].join(",");

const captureError = [
  "mercadona",
  "404",
  "https://tienda.mercadona.es/product/404/error",
  "error",
  "Carne",
  "",
  "",
  "",
  "",
  "",
  "",
  "2026-07-16T12:00:01.000Z",
  "41006",
  "postal_code",
  "error",
  '"HTTP 404, sin ficha"',
].join(",");

async function fixtureCsv(directory: string): Promise<string> {
  const path = join(directory, "catalog.csv");
  await writeFile(path, `${header}\n${accepted}\n${captureError}\n`, "utf8");
  return path;
}

describe("CLI local de cuarentena T17", () => {
  it("procesa CSV entrecomillado en streaming y genera hashes independientes", async () => {
    const directory = await mkdtemp(join(tmpdir(), "health-design-t17a-"));
    const input = await fixtureCsv(directory);
    const batch = await importSupermarketCatalogFile({
      chain: "mercadona",
      input,
      licenseStatus: "restricted",
      sourceTermsStatus: "restricted",
    });

    expect(batch.summary).toMatchObject({
      captureErrorCount: 1,
      chain: "mercadona",
      market: "ES",
      priceCount: 1,
      recordCount: 2,
      usableRecordCount: 1,
    });
    expect(batch.manifest.rawSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(batch.manifest.normalizedSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(batch.manifest.rawSha256).not.toBe(batch.manifest.normalizedSha256);
    expect(batch.manifest.sourceLocationInternal).toBe("postal_code:41006");
    expect(batch.artifact.records[0]?.source.sourceFields.name).toBe(
      "Pechuga, de pollo",
    );
  });

  it("--dry-run no crea artefactos ni llama a R2", async () => {
    const directory = await mkdtemp(join(tmpdir(), "health-design-t17a-cli-"));
    const input = await fixtureCsv(directory);
    const { stdout } = await execFileAsync(
      process.execPath,
      [
        "scripts/import-supermarket-catalog/index.ts",
        "--chain",
        "mercadona",
        "--input",
        input,
        "--dry-run",
      ],
      { cwd: root },
    );

    expect(JSON.parse(stdout)).toMatchObject({
      captureErrorCount: 1,
      chain: "mercadona",
      mode: "dry-run",
      recordCount: 2,
    });
    expect(await readdir(directory)).toEqual(["catalog.csv"]);
  });

  it("aplica todos los límites sin aceptar URL, redirecciones ni archivos anidados", () => {
    expect(SUPERMARKET_IMPORT_LIMITS).toEqual({
      cellBytes: 2 * 1024,
      columnCount: 200,
      fileBytes: 25 * 1024 * 1024,
      rowCount: 100_000,
      uncompressedBytes: 100 * 1024 * 1024,
    });
    for (const [field, value, error] of [
      ["fileBytes", 25 * 1024 * 1024 + 1, "supermarket_file_limit_exceeded"],
      ["rowCount", 100_001, "supermarket_row_limit_exceeded"],
      ["columnCount", 201, "supermarket_column_limit_exceeded"],
      ["maximumCellBytes", 2 * 1024 + 1, "supermarket_cell_limit_exceeded"],
      [
        "uncompressedBytes",
        100 * 1024 * 1024 + 1,
        "supermarket_uncompressed_limit_exceeded",
      ],
    ] as const) {
      expect(() =>
        validateSupermarketImportEnvelope({
          columnCount: 1,
          fileBytes: 1,
          maximumCellBytes: 1,
          rowCount: 1,
          uncompressedBytes: 1,
          [field]: value,
        }),
      ).toThrow(error);
    }
    expect(() =>
      assertLocalSupermarketInput("https://example.test/catalog.csv"),
    ).toThrow("supermarket_input_must_be_local");
    expect(() => assertLocalSupermarketInput("catalog.zip")).toThrow(
      "supermarket_input_must_be_csv",
    );
  });

  it("un CSV fatal no deja una revisión parcial", async () => {
    const directory = await mkdtemp(join(tmpdir(), "health-design-t17a-fatal-"));
    const input = join(directory, "broken.csv");
    await writeFile(input, `${header}\n"fila sin cierre`, "utf8");

    await expect(
      importSupermarketCatalogFile({
        chain: "mercadona",
        input,
        licenseStatus: "unknown",
        sourceTermsStatus: "unknown",
      }),
    ).rejects.toThrow("supermarket_csv_unclosed_quote");
    expect(await readdir(directory)).toEqual(["broken.csv"]);
  });

  it("rechaza un archivo comprimido aunque se renombre como CSV", async () => {
    const directory = await mkdtemp(join(tmpdir(), "health-design-t17a-archive-"));
    const input = join(directory, "renamed.csv");
    await writeFile(input, Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00]));

    await expect(
      importSupermarketCatalogFile({
        chain: "mercadona",
        input,
        licenseStatus: "unknown",
        sourceTermsStatus: "unknown",
      }),
    ).rejects.toThrow("supermarket_archive_not_supported");
  });

  it("reutiliza misma clave+hash y rechaza una colisión distinta", () => {
    const descriptor = {
      chain: "dia",
      collectedAt: "2026-07-16T12:00:00.000Z",
      normalizedSha256: "ab".repeat(32),
      rawSha256: "cd".repeat(32),
      schemaVersion: 1,
    } as const;
    const keys = supermarketR2ObjectKeys(descriptor);

    expect(resolveR2ManifestCollision(descriptor, descriptor)).toBe("reuse");
    expect(keys.manifest).toContain("dia");
    expect(() =>
      resolveR2ManifestCollision(descriptor, {
        ...descriptor,
        rawSha256: "ef".repeat(32),
      }),
    ).toThrow("supermarket_r2_key_conflict");
  });

  it("bloquea publicación cuando licencia o términos siguen unknown", () => {
    expect(
      canPublishSupermarketSource({
        environment: "development",
        licenseStatus: "unknown",
        sourceTermsStatus: "restricted",
        useDecision: "approved_for_development",
      }),
    ).toBe(false);
    expect(
      canPublishSupermarketSource({
        environment: "development",
        licenseStatus: "restricted",
        sourceTermsStatus: "restricted",
        useDecision: "approved_for_development",
      }),
    ).toBe(true);
  });
});

const externalDataRoot = existsSync(resolve(root, "datos"))
  ? root
  : resolve(root, "../..");
const realInputs = {
  aldi: resolve(externalDataRoot, "datos/catalogo_aldi.csv"),
  dia: resolve(externalDataRoot, "datos/catalogo_dia.csv"),
  mercadona: resolve(externalDataRoot, "datos/catalogo_mercadona.csv"),
} as const;
const hasRealInputs = Object.values(realInputs).every(existsSync);

it.runIf(hasRealInputs)(
  "reproduce 13.671 filas y separa los 41 errores de captura locales",
  async () => {
    const batches = await Promise.all(
      Object.entries(realInputs).map(([chain, input]) =>
        importSupermarketCatalogFile({
          chain: chain as keyof typeof realInputs,
          input,
          licenseStatus: "unknown",
          sourceTermsStatus: "unknown",
        }),
      ),
    );

    expect(
      Object.fromEntries(
        batches.map(({ summary }) => [summary.chain, summary.recordCount]),
      ),
    ).toEqual({ aldi: 1696, dia: 7661, mercadona: 4314 });
    expect(batches.reduce((sum, batch) => sum + batch.summary.recordCount, 0)).toBe(
      13_671,
    );
    expect(
      Object.fromEntries(
        batches.map(({ summary }) => [summary.chain, summary.captureErrorCount]),
      ),
    ).toEqual({ aldi: 39, dia: 2, mercadona: 0 });
    expect(
      Object.fromEntries(
        batches.map(({ summary }) => [
          summary.chain,
          summary.normalizationRejectionCount,
        ]),
      ),
    ).toEqual({ aldi: 0, dia: 0, mercadona: 0 });
    expect(
      Object.fromEntries(
        batches.map(({ summary }) => [summary.chain, summary.priceCount]),
      ),
    ).toEqual({ aldi: 1525, dia: 5848, mercadona: 4313 });
    expect(
      batches.reduce((sum, batch) => sum + batch.summary.captureErrorCount, 0),
    ).toBe(41);
  },
  60_000,
);
