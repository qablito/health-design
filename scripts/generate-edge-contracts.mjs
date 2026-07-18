import { readFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { build } from "esbuild";
import ts from "typescript";

const root = resolve(import.meta.dirname, "..");
const entryPoint = resolve(root, "packages/contracts/src/index.ts");
const outputPath = resolve(root, "supabase/functions/_shared/generated/contracts.js");
const declarationPath = resolve(
  root,
  "supabase/functions/_shared/generated/contracts.d.ts",
);
const accessDeclarationPath = resolve(
  root,
  "supabase/functions/_shared/generated/access.d.ts",
);
const adminDeclarationPath = resolve(
  root,
  "supabase/functions/_shared/generated/admin.d.ts",
);
const questionnaireDeclarationPath = resolve(
  root,
  "supabase/functions/_shared/generated/questionnaire.d.ts",
);
const banner =
  "// Generated from packages/contracts/src/index.ts. Do not edit manually.";

export async function generateEdgeContracts({ check = false } = {}) {
  const result = await build({
    banner: { js: banner },
    bundle: true,
    entryPoints: [entryPoint],
    format: "esm",
    legalComments: "none",
    minify: true,
    platform: "neutral",
    target: "es2023",
    treeShaking: true,
    write: false,
  });
  const output = result.outputFiles?.[0]?.text;
  if (!output) throw new Error("esbuild no produjo el contrato Edge");

  let declaration = "";
  let accessDeclaration = "";
  let adminDeclaration = "";
  let questionnaireDeclaration = "";
  const program = ts.createProgram({
    options: {
      declaration: true,
      emitDeclarationOnly: true,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      noEmitOnError: true,
      skipLibCheck: true,
      strict: true,
      target: ts.ScriptTarget.ES2023,
    },
    rootNames: [entryPoint],
  });
  const emit = program.emit(undefined, (fileName, content) => {
    if (fileName.endsWith("index.d.ts")) declaration = content;
    if (fileName.endsWith("access.d.ts")) accessDeclaration = content;
    if (fileName.endsWith("admin.d.ts")) adminDeclaration = content;
    if (fileName.endsWith("questionnaire.d.ts")) questionnaireDeclaration = content;
  });
  const diagnostics = ts
    .getPreEmitDiagnostics(program)
    .concat(emit.diagnostics)
    .filter(({ category }) => category === ts.DiagnosticCategory.Error);
  if (
    diagnostics.length > 0 ||
    !declaration ||
    !accessDeclaration ||
    !adminDeclaration ||
    !questionnaireDeclaration
  ) {
    const detail = ts.formatDiagnosticsWithColorAndContext(diagnostics, {
      getCanonicalFileName: (fileName) => fileName,
      getCurrentDirectory: () => root,
      getNewLine: () => "\n",
    });
    throw new Error(`No se pudo generar la declaración Edge.\n${detail}`);
  }
  declaration = declaration.replace(
    'import { z } from "zod";',
    'import type { z } from "zod";',
  );
  accessDeclaration = accessDeclaration.replace(
    'import { z } from "zod";',
    'import type { z } from "zod";',
  );
  adminDeclaration = adminDeclaration.replace(
    'import { z } from "zod";',
    'import type { z } from "zod";',
  );
  questionnaireDeclaration = questionnaireDeclaration.replace(
    'import { z } from "zod";',
    'import type { z } from "zod";',
  );

  if (check) {
    let current;
    let currentDeclaration;
    let currentAccessDeclaration;
    let currentAdminDeclaration;
    let currentQuestionnaireDeclaration;
    try {
      [
        current,
        currentDeclaration,
        currentAccessDeclaration,
        currentAdminDeclaration,
        currentQuestionnaireDeclaration,
      ] = await Promise.all([
        readFile(outputPath, "utf8"),
        readFile(declarationPath, "utf8"),
        readFile(accessDeclarationPath, "utf8"),
        readFile(adminDeclarationPath, "utf8"),
        readFile(questionnaireDeclarationPath, "utf8"),
      ]);
    } catch {
      throw new Error("Falta el contrato Edge generado. Ejecuta pnpm edge:generate.");
    }
    if (
      current !== output ||
      currentDeclaration !== declaration ||
      currentAccessDeclaration !== accessDeclaration ||
      currentAdminDeclaration !== adminDeclaration ||
      currentQuestionnaireDeclaration !== questionnaireDeclaration
    ) {
      throw new Error(
        "El contrato Edge generado está desactualizado. Ejecuta pnpm edge:generate.",
      );
    }
    return { changed: false, outputPath };
  }

  await mkdir(dirname(outputPath), { recursive: true });
  await Promise.all([
    writeFile(outputPath, output),
    writeFile(declarationPath, declaration),
    writeFile(accessDeclarationPath, accessDeclaration),
    writeFile(adminDeclarationPath, adminDeclaration),
    writeFile(questionnaireDeclarationPath, questionnaireDeclaration),
  ]);
  return { changed: true, outputPath };
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (import.meta.url === invokedPath) {
  generateEdgeContracts({ check: process.argv.includes("--check") })
    .then(({ outputPath: generatedPath }) => {
      console.log(`Contrato Edge verificado: ${generatedPath}`);
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
}
