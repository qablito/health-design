import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, test } from "vitest";

import {
  auditRepository,
  createReleaseArtifacts,
  inspectSupplyChainWorkflow,
  verifyReleaseArtifacts,
} from "../scripts/verify-supply-chain.mjs";

const temporaryDirectories = [];
const execFileAsync = promisify(execFile);

async function createFixture() {
  const root = await mkdtemp(join(tmpdir(), "health-design-supply-chain-"));
  temporaryDirectories.push(root);
  await writeFile(
    join(root, "pnpm-lock.yaml"),
    "lockfileVersion: '9.0'\n\npackages:\n\n  zod@4.4.3:\n    resolution: {integrity: sha512-test}\n",
  );
  return root;
}

async function initializeUnbornRepository(root) {
  await execFileAsync("git", ["init", "--quiet", root]);
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

describe("supply-chain guard", () => {
  test("rechaza secretos y artefactos privados sin aceptar falsos positivos permitidos", async () => {
    const root = await createFixture();
    await writeFile(join(root, ".env.example"), "PUBLIC_VALUE=example\n");
    await writeFile(join(root, ".env.production"), "TOKEN=real-secret-value\n");
    await mkdir(join(root, "backups"));
    await writeFile(join(root, "backups", "snapshot.dump"), "private\n");
    const privateKeyFixture = [
      ["-----BEGIN", " PRIVATE KEY-----"].join(""),
      "not-a-real-key",
      ["-----END", " PRIVATE KEY-----"].join(""),
      "",
    ].join("\n");
    await writeFile(join(root, "leaked.txt"), privateKeyFixture);
    await symlink(".env.example", join(root, ".env.link"));
    await mkdir(join(root, "apps", "web", "dist"), { recursive: true });
    await writeFile(
      join(root, "apps", "web", "dist", "leaked-source-map.js"),
      `${"x".repeat(1_100_000)}\n${privateKeyFixture}`,
    );

    const report = await auditRepository(root, { inspectHistory: false });

    expect(report.findings.map(({ path }) => path)).toEqual(
      expect.arrayContaining([
        ".env.production",
        ".env.link",
        "apps/web/dist/leaked-source-map.js",
        "backups",
        "backups/snapshot.dump",
        "leaked.txt",
      ]),
    );
    expect(report.findings.map(({ path }) => path)).not.toContain(".env.example");
  });

  test("genera un SBOM CycloneDX y verifica hashes ligados al lockfile", async () => {
    const root = await createFixture();
    await initializeUnbornRepository(root);
    await mkdir(join(root, "apps", "web", "dist"), { recursive: true });
    await writeFile(
      join(root, "apps", "web", "dist", "index.html"),
      "<main>ok</main>\n",
    );

    const generated = await createReleaseArtifacts(root);
    const verified = await verifyReleaseArtifacts(root);

    expect(generated.componentCount).toBeGreaterThan(0);
    expect(verified.valid).toBe(true);
    expect(verified.artifactCount).toBe(1);

    await writeFile(join(root, "apps", "web", "dist", "index.html"), "tampered\n");
    await expect(verifyReleaseArtifacts(root)).rejects.toThrow(/hash/i);
  });

  test("falla cerrado al generar un release fuera de un repositorio Git", async () => {
    const root = await createFixture();
    await mkdir(join(root, "apps", "web", "dist"), { recursive: true });
    await writeFile(join(root, "apps", "web", "dist", "index.html"), "ok\n");

    await expect(createReleaseArtifacts(root)).rejects.toThrow(/Git/i);
  });

  test.each([
    ["ausente", null],
    ["malformado", "packages:\n"],
  ])("bloquea un lockfile %s", async (_caseName, lockfile) => {
    const root = await mkdtemp(join(tmpdir(), "health-design-lockfile-"));
    temporaryDirectories.push(root);
    if (lockfile !== null) {
      await writeFile(join(root, "pnpm-lock.yaml"), lockfile);
    }

    const report = await auditRepository(root, { inspectHistory: false });

    expect(report.valid).toBe(false);
    expect(report.findings.some(({ source }) => source === "lockfile")).toBe(true);
  });

  test("bloquea lockfiles duplicados de otros gestores", async () => {
    const root = await createFixture();
    await writeFile(join(root, "package-lock.json"), "{}\n");

    const report = await auditRepository(root, { inspectHistory: false });

    expect(report.valid).toBe(false);
    expect(report.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "package-lock.json", source: "worktree" }),
      ]),
    );
  });

  test("falla cerrado cuando el historial Git no puede inspeccionarse", async () => {
    const root = await createFixture();

    const report = await auditRepository(root, { inspectHistory: true });

    expect(report.valid).toBe(false);
    expect(report.historyStatus).toBe("error:not-a-git-worktree");
    expect(report.findings.some(({ source }) => source === "history")).toBe(true);
  });

  test("la política real exige calidad, escaneo posterior al build y procedencia verificada", async () => {
    const findings = await inspectSupplyChainWorkflow(process.cwd());

    expect(findings).toEqual([]);
  });

  test("rechaza una política CI sin SHA, checkout endurecido ni verificación de firma", async () => {
    const root = await createFixture();
    const workflows = join(root, ".github", "workflows");
    await mkdir(workflows, { recursive: true });
    await writeFile(
      join(workflows, "supply-chain.yml"),
      "steps:\n  - uses: actions/checkout@v6\n  - uses: actions/attest@v4\n",
    );
    await writeFile(
      join(workflows, "verify.yml"),
      "steps:\n  - uses: actions/checkout@v6\n",
    );
    await writeFile(join(workflows, "legacy.yml"), "steps: []\n");

    const findings = await inspectSupplyChainWorkflow(root);

    expect(findings.map(({ reason }) => reason)).toEqual(
      expect.arrayContaining([
        expect.stringContaining("SHA inmutable"),
        expect.stringContaining("checkout conserva credenciales"),
        expect.stringContaining("verificación criptográfica"),
        expect.stringContaining("fuera del conjunto canónico"),
      ]),
    );
  });
});
