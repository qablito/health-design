export type MovementLimitationArea =
  "ankles" | "back" | "hips" | "knees" | "neck" | "shoulders" | "wrists";

export type MovementLimitationsAnalysis = Readonly<{
  areas: ReadonlySet<MovementLimitationArea>;
  detailsMissing: boolean;
  unmapped: readonly string[];
}>;

type ExerciseMovementProfile = Readonly<{
  areas: readonly string[];
  limitationAreas: readonly string[];
}>;

const TERM_AREAS: ReadonlyArray<
  readonly [readonly string[], readonly MovementLimitationArea[]]
> = [
  [["ankle", "tobillo"], ["ankles"]],
  [["back", "espalda", "lumbar", "columna"], ["back"]],
  [["cadera", "hip"], ["hips"]],
  [["acl", "knee", "lca", "ligamento cruzado", "rodilla"], ["knees"]],
  [["cuello", "neck", "cervical"], ["neck"]],
  [["hombro", "shoulder"], ["shoulders"]],
  [["muneca", "wrist"], ["wrists"]],
  // El catálogo no etiqueta el codo directamente. Excluir apoyos de hombro y
  // muñeca evita prescribir carga del miembro superior con falsa precisión.
  [
    ["codo", "elbow"],
    ["shoulders", "wrists"],
  ],
  // Ante equilibrio alterado, el subconjunto conservador evita patrones de pie
  // que dependen de tobillo, rodilla o cadera.
  [
    ["balance", "equilibrio", "inestabilidad"],
    ["ankles", "hips", "knees"],
  ],
];

function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replaceAll(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, " ")
    .trim();
}

function containsTerm(text: string, term: string): boolean {
  return ` ${text} `.includes(` ${term} `);
}

export function analyzeMovementLimitations(
  details: readonly string[] | undefined,
): MovementLimitationsAnalysis {
  const normalizedDetails = (details ?? [])
    .map((original) => ({ normalized: normalize(original), original }))
    .filter(({ normalized }) => normalized.length > 0);
  const areas = new Set<MovementLimitationArea>();
  const unmapped: string[] = [];

  for (const { normalized, original } of normalizedDetails) {
    let mapped = false;
    for (const [terms, mappedAreas] of TERM_AREAS) {
      if (!terms.some((term) => containsTerm(normalized, term))) continue;
      mapped = true;
      for (const area of mappedAreas) areas.add(area);
    }
    if (!mapped) unmapped.push(original);
  }

  return {
    areas,
    detailsMissing: normalizedDetails.length === 0,
    unmapped,
  };
}

export function conflictsWithMovementLimitations(
  exercise: ExerciseMovementProfile,
  excludedAreas: ReadonlySet<string>,
): boolean {
  return [...exercise.areas, ...exercise.limitationAreas].some((area) =>
    excludedAreas.has(area),
  );
}
