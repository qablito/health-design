import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import {
  NUTRITION_SOURCES,
  buildNutritionQuarantineBatch,
  resolveNutritionCandidate,
  type NutritionImportArtifact,
  type NutritionImportEnvelope,
  type NutritionImportRecord,
  type NutritionSourceKey,
} from "@health-design/catalog/nutrition";
import {
  blsOatsArtifact,
  ciqualOatsArtifact,
  commercialLabelArtifact,
  conflictingUsdaOatsArtifact,
  cookedOatsArtifact,
  fineliOatsArtifact,
} from "@health-design/test-fixtures/nutrition";

import { buildCiqual2025GeneratorArtifact, downloadCiqual2025 } from "./ciqual-2025.ts";

type Descriptor = Readonly<{
  envelope: NutritionImportEnvelope;
  licenseStatus: NutritionImportArtifact["licenseStatus"];
  rawArtifactPath: string;
  records: readonly NutritionImportRecord[];
  retrievedAt: string;
  sourceKey: NutritionSourceKey;
  sourceVersion: string;
  transformations: readonly string[];
}>;

function descriptorPath(arguments_: readonly string[]): string | null {
  const index = arguments_.indexOf("--descriptor");
  return index >= 0 ? (arguments_[index + 1] ?? null) : null;
}

function argumentValue(arguments_: readonly string[], name: string): string | null {
  const index = arguments_.indexOf(name);
  return index >= 0 ? (arguments_[index + 1] ?? null) : null;
}

function isDescriptor(value: unknown): value is Descriptor {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.rawArtifactPath === "string" &&
    typeof candidate.sourceKey === "string" &&
    candidate.sourceKey in NUTRITION_SOURCES &&
    typeof candidate.sourceVersion === "string" &&
    typeof candidate.retrievedAt === "string" &&
    typeof candidate.envelope === "object" &&
    Array.isArray(candidate.records) &&
    Array.isArray(candidate.transformations)
  );
}

async function importDescriptor(path: string): Promise<void> {
  const absolutePath = resolve(path);
  const parsed = JSON.parse(await readFile(absolutePath, "utf8")) as unknown;
  if (!isDescriptor(parsed)) throw new Error("invalid_nutrition_descriptor");
  const rawBytes = new Uint8Array(
    await readFile(resolve(dirname(absolutePath), parsed.rawArtifactPath)),
  );
  const batch = await buildNutritionQuarantineBatch({ ...parsed, rawBytes });
  process.stdout.write(`${JSON.stringify(batch, null, 2)}\n`);
  if (batch.status !== "quarantined") process.exitCode = 2;
}

async function importFixture(): Promise<void> {
  const accepted = await Promise.all(
    [
      ciqualOatsArtifact,
      blsOatsArtifact,
      fineliOatsArtifact,
      cookedOatsArtifact,
      conflictingUsdaOatsArtifact,
    ].map(buildNutritionQuarantineBatch),
  );
  const rejected = await buildNutritionQuarantineBatch(commercialLabelArtifact);
  const resolution = resolveNutritionCandidate({
    canonicalFoodKey: "food:oat-flakes",
    existingEffectiveRevisionId: "effective-fixture-previous",
    resolutionContext: {
      basis: "per_100_g",
      ediblePart: "whole_edible_product",
      foodState: "raw",
      method: "source_declared",
    },
    revisions: accepted.flatMap(({ revisions }) => revisions),
  });
  const summary = {
    automaticPublications: accepted.reduce(
      (total, batch) => total + batch.publicationCount,
      0,
    ),
    excludedIncompatibleRevisions: resolution.excludedRevisionIds.length,
    manifests: accepted.length,
    mode: "fixture",
    openReviews: resolution.reviews.length,
    rejectedBatches: rejected.status === "rejected" ? 1 : 0,
    resolutionStatus: resolution.status,
    selectedSources: Object.fromEntries(
      Object.entries(resolution.nutrients).map(([key, value]) => [
        key,
        value.sourceKey,
      ]),
    ),
  };
  if (
    summary.automaticPublications !== 0 ||
    summary.openReviews !== 1 ||
    summary.rejectedBatches !== 1 ||
    summary.selectedSources.protein !== "ciqual_2025" ||
    summary.selectedSources.fiber !== "bls_4_0"
  ) {
    throw new Error("nutrition_fixture_invariant_failed");
  }
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

async function importCiqual2025(arguments_: readonly string[]): Promise<void> {
  const workbookArgument = argumentValue(arguments_, "--workbook");
  const downloadArgument = argumentValue(arguments_, "--download");
  const output = argumentValue(arguments_, "--output");
  if (
    output === null ||
    (workbookArgument === null && downloadArgument === null) ||
    (workbookArgument !== null && downloadArgument !== null)
  ) {
    throw new Error("ciqual_2025_arguments_invalid");
  }
  const workbook = resolve(workbookArgument ?? downloadArgument!);
  if (downloadArgument !== null) await downloadCiqual2025(workbook);
  const retrievedAt =
    argumentValue(arguments_, "--retrieved-at") ?? new Date().toISOString();
  const artifact = await buildCiqual2025GeneratorArtifact(workbook, retrievedAt);
  const batch = await buildNutritionQuarantineBatch(artifact);
  if (batch.status !== "quarantined") {
    throw new Error(
      `ciqual_2025_quarantine_failed:${JSON.stringify(batch.violations)}`,
    );
  }
  const serialized = `${JSON.stringify(batch, null, 2)}\n`;
  if (new TextEncoder().encode(serialized).byteLength > 512 * 1_024) {
    throw new Error("ciqual_2025_edge_batch_limit_exceeded");
  }
  await writeFile(resolve(output), serialized, { encoding: "utf8", flag: "w" });
  process.stdout.write(
    `${JSON.stringify(
      {
        manifest: batch.manifest.id,
        output: resolve(output),
        records: batch.revisions.length,
        source: batch.manifest.sourceKey,
        sourceVersion: batch.manifest.sourceVersion,
        status: batch.status,
      },
      null,
      2,
    )}\n`,
  );
}

const arguments_ = process.argv.slice(2);
const path = descriptorPath(arguments_);
if (arguments_.includes("--ciqual-2025")) {
  await importCiqual2025(arguments_);
} else if (arguments_.includes("--fixture") && path === null) {
  await importFixture();
} else if (path !== null && !arguments_.includes("--fixture")) {
  await importDescriptor(path);
} else {
  process.stderr.write(
    "Uso: pnpm run import:nutrition -- --fixture | --descriptor <ruta.json> | " +
      "--ciqual-2025 (--workbook <ciqual.xlsx> | --download <ciqual.xlsx>) " +
      "--output <lote.json> [--retrieved-at <ISO>]\n",
  );
  process.exitCode = 1;
}
