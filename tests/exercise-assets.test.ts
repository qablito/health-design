import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { EXERCISE_CATALOG, EXERCISE_PUBLICATION_LEDGER } from "@health-design/domain";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const validatorPath = join(repositoryRoot, "scripts/validate-exercise-assets.mjs");
const publicRoot = join(repositoryRoot, "apps/web/public");
const temporaryRoots: string[] = [];

function runValidator(root = publicRoot) {
  return spawnSync(process.execPath, [validatorPath, "--json", "--root", root], {
    cwd: repositoryRoot,
    encoding: "utf8",
  });
}

afterEach(() => {
  temporaryRoots
    .splice(0)
    .forEach((root) => rmSync(root, { force: true, recursive: true }));
});

describe("validador de ilustraciones de ejercicios", () => {
  it("publica una ilustración secuencial accesible y revisada para cada ejercicio", () => {
    const result = runValidator();

    expect(result.status, result.stderr || result.stdout).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      checked: 20,
      errors: [],
      status: "pass",
    });
  });

  it("mantiene una revisión visual técnica identificable para cada activo", () => {
    const reviews = EXERCISE_CATALOG.map(({ id, publication }) => ({
      exerciseId: id,
      ...publication,
    }));

    expect(new Set(reviews.map(({ reviewId }) => reviewId)).size).toBe(
      EXERCISE_CATALOG.length,
    );
    expect(
      reviews.every(
        ({ exerciseId, reviewId, reviewScope, reviewer }) =>
          reviewId === `t11-anatomy-${exerciseId}-20260719` &&
          reviewer === "codex-t11-visual-audit" &&
          reviewScope.includes("postura") &&
          reviewScope.includes("apoyos"),
      ),
    ).toBe(true);
    expect(EXERCISE_PUBLICATION_LEDGER.map(({ exerciseId }) => exerciseId)).toEqual(
      EXERCISE_CATALOG.map(({ id }) => id),
    );
  });

  it("rechaza scripts y enlaces externos aunque el SVG siga siendo legible", () => {
    const root = mkdtempSync(join(tmpdir(), "health-design-exercises-"));
    temporaryRoots.push(root);
    cpSync(publicRoot, root, { recursive: true });

    const file = join(root, "assets/exercises/march-in-place.svg");
    const svg = readFileSync(file, "utf8").replace(
      "</svg>",
      '<script>alert(1)</script><a href="https://example.test">externo</a></svg>',
    );
    writeFileSync(file, svg);

    const result = runValidator(root);

    expect(result.status).toBe(1);
    expect(result.stdout).toContain('"code":"script_forbidden"');
    expect(result.stdout).toContain('"code":"external_reference_forbidden"');
    expect(result.stdout).toContain('"code":"asset_digest_mismatch"');
    expect(result.stdout).toContain('"status":"fail"');
  });
});
