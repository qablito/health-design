import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { SupermarketChain } from "@health-design/contracts";

export const SUPERMARKET_R2_DEVELOPMENT_BUCKET =
  "health-design-catalog-source-dev" as const;

export type SupermarketR2Descriptor = Readonly<{
  chain: SupermarketChain;
  collectedAt: string;
  normalizedSha256: string;
  rawSha256: string;
  schemaVersion: 1;
}>;

export function supermarketR2ObjectKeys(descriptor: SupermarketR2Descriptor): Readonly<{
  errors: string;
  manifest: string;
  normalized: string;
  raw: string;
}> {
  const capture = descriptor.collectedAt.replace(/[^0-9A-Za-z._-]/g, "-");
  const prefix = `supermarkets/ES/${descriptor.chain}/${capture}`;
  return {
    errors: `${prefix}/errors.json`,
    manifest: `${prefix}/manifest.json`,
    normalized: `${prefix}/normalized.json`,
    raw: `${prefix}/raw.csv`,
  };
}

export function resolveR2ManifestCollision(
  existing: SupermarketR2Descriptor | null,
  candidate: SupermarketR2Descriptor,
): "create" | "reuse" {
  if (existing === null) return "create";
  if (
    existing.chain === candidate.chain &&
    existing.collectedAt === candidate.collectedAt &&
    existing.rawSha256 === candidate.rawSha256 &&
    existing.normalizedSha256 === candidate.normalizedSha256
  ) {
    return "reuse";
  }
  throw new Error("supermarket_r2_key_conflict");
}

type WranglerResult = Readonly<{ code: number; stderr: string; stdout: string }>;

async function wrangler(arguments_: readonly string[]): Promise<WranglerResult> {
  return new Promise((resolve, reject) => {
    const child = spawn("pnpm", ["exec", "wrangler", ...arguments_], {
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.once("error", reject);
    child.once("close", (code) => resolve({ code: code ?? 1, stderr, stdout }));
  });
}

function objectPath(key: string): string {
  return `${SUPERMARKET_R2_DEVELOPMENT_BUCKET}/${key}`;
}

async function existingDescriptor(
  key: string,
  destination: string,
): Promise<SupermarketR2Descriptor | null> {
  const result = await wrangler([
    "r2",
    "object",
    "get",
    objectPath(key),
    "--file",
    destination,
    "--remote",
    "--jurisdiction",
    "eu",
  ]);
  if (result.code === 0) {
    const parsed = JSON.parse(await readFile(destination, "utf8")) as {
      descriptor?: SupermarketR2Descriptor;
    };
    if (parsed.descriptor === undefined) {
      throw new Error("supermarket_r2_manifest_invalid");
    }
    return parsed.descriptor;
  }
  if (
    /not found|does not exist|NoSuchKey|10007/i.test(
      `${result.stdout}\n${result.stderr}`,
    )
  ) {
    return null;
  }
  throw new Error("supermarket_r2_manifest_lookup_failed");
}

async function putObject(
  key: string,
  file: string,
  contentType: string,
): Promise<void> {
  const result = await wrangler([
    "r2",
    "object",
    "put",
    objectPath(key),
    "--file",
    file,
    "--content-type",
    contentType,
    "--remote",
    "--jurisdiction",
    "eu",
    "--force",
  ]);
  if (result.code !== 0) throw new Error("supermarket_r2_upload_failed");
}

export async function uploadSupermarketQuarantine(
  input: Readonly<{
    artifact: unknown;
    descriptor: SupermarketR2Descriptor;
    errors: unknown;
    manifest: unknown;
    rawInputPath: string;
  }>,
): Promise<
  Readonly<{ keys: ReturnType<typeof supermarketR2ObjectKeys>; reused: boolean }>
> {
  const keys = supermarketR2ObjectKeys(input.descriptor);
  const directory = await mkdtemp(join(tmpdir(), "health-design-t17-r2-"));
  try {
    const existingPath = join(directory, "existing-manifest.json");
    const existing = await existingDescriptor(keys.manifest, existingPath);
    if (resolveR2ManifestCollision(existing, input.descriptor) === "reuse") {
      return { keys, reused: true };
    }

    const normalizedPath = join(directory, "normalized.json");
    const errorsPath = join(directory, "errors.json");
    const manifestPath = join(directory, "manifest.json");
    await Promise.all([
      writeFile(normalizedPath, `${JSON.stringify(input.artifact)}\n`, "utf8"),
      writeFile(errorsPath, `${JSON.stringify(input.errors)}\n`, "utf8"),
      writeFile(
        manifestPath,
        `${JSON.stringify({ descriptor: input.descriptor, manifest: input.manifest })}\n`,
        "utf8",
      ),
    ]);
    await putObject(keys.raw, input.rawInputPath, "text/csv; charset=utf-8");
    await putObject(keys.normalized, normalizedPath, "application/json");
    await putObject(keys.errors, errorsPath, "application/json");
    await putObject(keys.manifest, manifestPath, "application/json");
    return { keys, reused: false };
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
}
