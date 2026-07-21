import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import type { SupermarketChain } from "@health-design/contracts";

import { uploadSupermarketQuarantine } from "./r2-manifest.ts";
import { importSupermarketCatalogFile } from "./sources.ts";

type Arguments = Readonly<{
  chain: SupermarketChain;
  confirmUpload: string | null;
  dryRun: boolean;
  input: string;
  licenseStatus: "approved" | "restricted" | "unknown";
  sourceTermsStatus: "approved" | "restricted" | "unknown";
  upload: boolean;
}>;

function value(arguments_: readonly string[], name: string): string | null {
  const index = arguments_.indexOf(name);
  return index < 0 ? null : (arguments_[index + 1] ?? null);
}

function status(candidate: string | null): "approved" | "restricted" | "unknown" {
  if (candidate === null) return "unknown";
  if (
    candidate === "approved" ||
    candidate === "restricted" ||
    candidate === "unknown"
  ) {
    return candidate;
  }
  throw new Error("supermarket_source_status_invalid");
}

function parseArguments(arguments_: readonly string[]): Arguments {
  const chain = value(arguments_, "--chain");
  const input = value(arguments_, "--input");
  const dryRun = arguments_.includes("--dry-run");
  const upload = arguments_.includes("--upload");
  if (
    (chain !== "mercadona" && chain !== "dia" && chain !== "aldi") ||
    input === null ||
    dryRun === upload
  ) {
    throw new Error("supermarket_import_arguments_invalid");
  }
  return {
    chain,
    confirmUpload: value(arguments_, "--confirm-upload"),
    dryRun,
    input,
    licenseStatus: status(value(arguments_, "--license-status")),
    sourceTermsStatus: status(value(arguments_, "--source-terms-status")),
    upload,
  };
}

export async function runSupermarketImport(
  arguments_: readonly string[],
): Promise<void> {
  const options = parseArguments(arguments_);
  const batch = await importSupermarketCatalogFile(options);
  if (options.dryRun) {
    process.stdout.write(
      `${JSON.stringify(
        {
          ...batch.summary,
          licenseStatus: batch.manifest.licenseStatus,
          manifestId: batch.manifest.id,
          mode: "dry-run",
          normalizedSha256: batch.manifest.normalizedSha256,
          rawSha256: batch.manifest.rawSha256,
          sourceTermsStatus: batch.manifest.sourceTermsStatus,
        },
        null,
        2,
      )}\n`,
    );
    return;
  }
  if (options.confirmUpload !== "health-design-catalog-source-dev") {
    throw new Error("supermarket_upload_confirmation_required");
  }
  const upload = await uploadSupermarketQuarantine({
    artifact: batch.artifact,
    descriptor: batch.descriptor,
    errors: batch.artifact.captureErrors,
    manifest: batch.manifest,
    rawInputPath: resolve(options.input),
  });
  process.stdout.write(
    `${JSON.stringify({ ...batch.summary, mode: "upload", ...upload }, null, 2)}\n`,
  );
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (import.meta.url === invokedPath) {
  runSupermarketImport(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
