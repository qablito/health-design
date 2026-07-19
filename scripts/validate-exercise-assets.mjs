import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve, sep } from "node:path";
import { parseArgs } from "node:util";

import { EXERCISE_CATALOG } from "../packages/domain/src/exercises/index.ts";
import { EXERCISE_PUBLICATION_LEDGER } from "../packages/domain/src/exercises/publication-ledger.ts";

const { values } = parseArgs({
  options: {
    json: { type: "boolean", default: false },
    root: { type: "string", default: "apps/web/public" },
  },
});

const publicRoot = resolve(values.root);
const errors = [];
const published = EXERCISE_CATALOG.filter(
  (exercise) => exercise.publication.status === "published",
);
const reviewIds = new Set();
const ledgerByExerciseId = new Map();

for (const entry of EXERCISE_PUBLICATION_LEDGER) {
  if (ledgerByExerciseId.has(entry.exerciseId)) {
    errors.push({
      code: "publication_ledger_duplicate",
      detail: "El registro independiente contiene un ejercicio duplicado.",
      exerciseId: entry.exerciseId,
      path: "packages/domain/src/exercises/publication-ledger.ts",
    });
  }
  ledgerByExerciseId.set(entry.exerciseId, entry);
}

function report(exercise, code, detail, path = exercise.visual.src) {
  errors.push({ code, detail, exerciseId: exercise.id, path });
}

for (const exercise of published) {
  const { publication, visual } = exercise;
  const ledgerEntry = ledgerByExerciseId.get(exercise.id);

  if (
    !ledgerEntry ||
    JSON.stringify(ledgerEntry.publication) !== JSON.stringify(publication)
  ) {
    report(
      exercise,
      "publication_ledger_mismatch",
      "El activo no coincide con una aprobación explícita del registro independiente.",
      "packages/domain/src/exercises/publication-ledger.ts",
    );
  }

  if (
    publication.licenseStatus !== "approved" ||
    !publication.license.trim() ||
    !publication.provenance.trim()
  ) {
    report(
      exercise,
      "publication_metadata_invalid",
      "Falta licencia o procedencia aprobada.",
    );
  }
  if (
    publication.anatomicalReview !== "approved" ||
    !/^[a-z0-9]+(?:-[a-z0-9]+){2,}$/.test(publication.reviewer) ||
    publication.reviewer === "revision-manual-t11" ||
    publication.reviewId !== `t11-anatomy-${exercise.id}-20260719` ||
    publication.reviewScope.trim().length < 40 ||
    !/^\d{4}-\d{2}-\d{2}$/.test(publication.reviewedAt)
  ) {
    report(
      exercise,
      "anatomical_review_missing",
      "Falta una revisión anatómica manual fechada.",
    );
  }
  if (reviewIds.has(publication.reviewId)) {
    report(
      exercise,
      "anatomical_review_duplicate",
      "Cada activo debe conservar un identificador de revisión propio.",
    );
  }
  reviewIds.add(publication.reviewId);
  if (
    visual.kind !== "sequential_static" ||
    !visual.alt.trim() ||
    !visual.src.startsWith("/assets/exercises/") ||
    !visual.src.endsWith(".svg")
  ) {
    report(
      exercise,
      "visual_metadata_invalid",
      "La ilustración debe ser SVG secuencial y tener texto alternativo.",
    );
    continue;
  }

  const file = resolve(publicRoot, visual.src.slice(1));
  if (!file.startsWith(`${publicRoot}${sep}`)) {
    report(
      exercise,
      "path_outside_public_root",
      "La ruta sale del directorio público.",
      file,
    );
    continue;
  }

  let svg;
  try {
    svg = readFileSync(file, "utf8");
  } catch {
    report(exercise, "asset_missing", "No existe el SVG publicado.", file);
    continue;
  }

  const assetSha256 = createHash("sha256").update(svg).digest("hex");
  if (!ledgerEntry || assetSha256 !== ledgerEntry.assetSha256) {
    report(
      exercise,
      "asset_digest_mismatch",
      "El contenido del SVG no coincide con el activo que recibió la revisión registrada.",
      file,
    );
  }

  if (!/<svg\b[\s\S]*<\/svg>\s*$/i.test(svg)) {
    report(
      exercise,
      "svg_invalid",
      "El archivo no contiene un documento SVG completo.",
      file,
    );
  }
  if (!/<title(?:\s[^>]*)?>\s*[^<]+\s*<\/title>/i.test(svg)) {
    report(exercise, "title_missing", "El SVG no contiene un título accesible.", file);
  }
  if (!/<desc(?:\s[^>]*)?>\s*[^<]+\s*<\/desc>/i.test(svg)) {
    report(
      exercise,
      "description_missing",
      "El SVG no contiene una descripción accesible.",
      file,
    );
  }

  const steps = new Set(
    [...svg.matchAll(/\bdata-step\s*=\s*(["'])([^"']+)\1/gi)].map((match) => match[2]),
  );
  if (steps.size < 2 || steps.size > 3) {
    report(
      exercise,
      "sequence_invalid",
      "La ilustración debe mostrar dos o tres pasos identificados.",
      file,
    );
  }
  if (/<script\b|\son[a-z]+\s*=|javascript\s*:/i.test(svg)) {
    report(
      exercise,
      "script_forbidden",
      "Los SVG publicados no pueden ejecutar código.",
      file,
    );
  }
  if (
    /(?:href|xlink:href)\s*=\s*["']\s*(?:https?:|\/\/)/i.test(svg) ||
    /url\(\s*["']?\s*(?:https?:|\/\/)/i.test(svg)
  ) {
    report(
      exercise,
      "external_reference_forbidden",
      "Los SVG publicados no pueden cargar recursos externos.",
      file,
    );
  }
}

for (const exerciseId of ledgerByExerciseId.keys()) {
  if (!EXERCISE_CATALOG.some((exercise) => exercise.id === exerciseId)) {
    errors.push({
      code: "publication_ledger_orphan",
      detail: "El registro independiente referencia un ejercicio inexistente.",
      exerciseId,
      path: "packages/domain/src/exercises/publication-ledger.ts",
    });
  }
}

const output = {
  checked: published.length,
  errors,
  status: errors.length === 0 ? "pass" : "fail",
};

if (values.json) {
  process.stdout.write(`${JSON.stringify(output)}\n`);
} else if (errors.length === 0) {
  process.stdout.write(
    `PASS: ${published.length} ilustraciones de ejercicios validadas.\n`,
  );
} else {
  process.stderr.write(
    `${errors.map((error) => `${error.exerciseId}: ${error.code} — ${error.detail}`).join("\n")}\n`,
  );
}

process.exitCode = errors.length === 0 ? 0 : 1;
