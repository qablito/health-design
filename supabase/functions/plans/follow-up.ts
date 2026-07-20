import {
  LabHistorySchema,
  QuestionnaireAnswersSchema,
  type FollowUpValues,
  type LabHistory,
  type LabObservation,
  type LabObservationInput,
} from "@health-design/contracts";
import {
  analyzeLabHistory,
  labFreshness,
  normalizeLabUnit,
} from "@health-design/engine";

type QuestionnaireAnswers = ReturnType<typeof QuestionnaireAnswersSchema.parse>;

const SLEEP_QUALITY = ["very_poor", "poor", "fair", "good", "very_good"] as const;

function normalizedText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

export function labObservationConfidence(
  observation: LabObservationInput,
): "high" | "medium" | "low" | "unknown" {
  if (
    !normalizeLabUnit(observation.unit) ||
    observation.measurement.kind === "unknown"
  ) {
    return "unknown";
  }
  if (observation.source === "self_reported") return "low";
  return observation.source === "laboratory" && observation.measurement.kind === "exact"
    ? "high"
    : "medium";
}

export function enrichLabObservations(
  observations: readonly LabObservationInput[],
): Array<LabObservationInput & { confidence: "high" | "medium" | "low" | "unknown" }> {
  return observations.map((observation) => ({
    ...observation,
    confidence: labObservationConfidence(observation),
  }));
}

export function applyFollowUpToAnswers(
  base: QuestionnaireAnswers,
  values: FollowUpValues,
): QuestionnaireAnswers {
  const next: QuestionnaireAnswers = { ...base };
  if (values.nutrition?.foodAnxiety !== undefined) {
    next.nutritionFoodAnxiety =
      values.nutrition.foodAnxiety === "none" ? "no" : values.nutrition.foodAnxiety;
  }
  if (values.hydration?.averageMl !== undefined) {
    next.habitualWaterMl = values.hydration.averageMl;
  }
  if (values.sleep?.averageHours !== undefined) {
    next.sleepHours = values.sleep.averageHours;
  }
  if (values.sleep?.quality !== undefined) {
    next.sleepQuality = SLEEP_QUALITY[values.sleep.quality - 1];
  }
  if (values.sleep?.regularity !== undefined) {
    next.sleepRegularity = values.sleep.regularity;
  }
  if (values.sleep?.deepMinutes !== undefined) {
    next.sleepDeepMinutes = values.sleep.deepMinutes;
  }
  if (values.sleep?.lightMinutes !== undefined) {
    next.sleepLightMinutes = values.sleep.lightMinutes;
  }
  if (values.sleep?.remMinutes !== undefined) {
    next.sleepRemMinutes = values.sleep.remMinutes;
  }
  if (
    values.sleep?.deepMinutes !== undefined ||
    values.sleep?.lightMinutes !== undefined ||
    values.sleep?.remMinutes !== undefined
  ) {
    next.sleepTracking = true;
  }
  return QuestionnaireAnswersSchema.parse(next);
}

function labDate(observation: LabObservation): string {
  if (observation.measurement.kind === "exact") return observation.measurement.date;
  if (observation.measurement.kind === "range") {
    return `${observation.measurement.from}/${observation.measurement.to}`;
  }
  return "fecha desconocida";
}

function labReferenceRange(observation: LabObservation): string | undefined {
  const range = observation.referenceRange;
  if (!range?.minimum || !range.maximum) return undefined;
  return `${range.minimum}-${range.maximum} ${range.unit ?? observation.unit ?? ""}`.trim();
}

export function applyLabsToAnswers(
  base: QuestionnaireAnswers,
  observations: readonly LabObservation[],
): QuestionnaireAnswers {
  const complete = observations.filter(
    (observation) =>
      observation.unit !== undefined && normalizeLabUnit(observation.unit) !== null,
  );
  if (complete.length === 0) return QuestionnaireAnswersSchema.parse(base);
  const merged = new Map(
    (base.labValues ?? []).map((entry) => [normalizedText(entry.name), entry]),
  );
  for (const observation of complete) {
    merged.set(normalizedText(observation.name), {
      dateApproximate: labDate(observation),
      name: observation.name,
      ...(labReferenceRange(observation) === undefined
        ? {}
        : { referenceRange: labReferenceRange(observation) }),
      source: observation.source,
      unit: observation.unit!,
      value: observation.value,
    });
  }
  return QuestionnaireAnswersSchema.parse({
    ...base,
    hasLabValues: true,
    labValues: [...merged.values()].slice(-50),
  });
}

function contextTags(
  answers: QuestionnaireAnswers,
  observations: readonly LabObservation[],
): string[] {
  const supplementNames = (answers.currentSupplements ?? [])
    .map(({ name }) => normalizedText(name))
    .join(" ");
  const tags = new Set<string>();
  if (/\b(b12|cobalamina|vitamina b12)\b/.test(supplementNames)) {
    tags.add(
      answers.pregnancyLactation === "pregnant"
        ? "pregnancy_b12_replacement"
        : "b12_replacement",
    );
  }
  if (/\b(magnesio|magnesium)\b/.test(supplementNames)) {
    tags.add("magnesium_replacement");
  }

  const renalContext = (answers.conditions ?? []).some(({ name }) =>
    /\b(renal|rinon|rinones|erc|ckd)\b/.test(normalizedText(name)),
  );
  if (renalContext) {
    const latestEgfr = [...observations]
      .filter(
        ({ analyte, unit }) =>
          analyte === "egfr" && normalizeLabUnit(unit) === "mL/min/1.73m²",
      )
      .sort((left, right) =>
        (left.measuredTo ?? left.createdAt).localeCompare(
          right.measuredTo ?? right.createdAt,
        ),
      )
      .at(-1);
    const value = latestEgfr ? Number(latestEgfr.value) : null;
    if (value !== null && Number.isFinite(value)) {
      tags.add(
        value >= 60
          ? "renal_g1_g2"
          : value >= 30
            ? "renal_g3"
            : value >= 15
              ? "renal_g4"
              : "renal_g5",
      );
    }
  }
  return [...tags];
}

function groupKey(observation: LabObservation): string {
  return observation.analyte === "other"
    ? `other:${normalizedText(observation.name)}`
    : observation.analyte;
}

export function buildLabHistory(
  input: Readonly<{
    answers: QuestionnaireAnswers;
    now: string;
    observations: readonly LabObservation[];
    profileId: string;
  }>,
): LabHistory {
  const groups = new Map<string, LabObservation[]>();
  for (const observation of input.observations) {
    const key = groupKey(observation);
    groups.set(key, [...(groups.get(key) ?? []), observation]);
  }
  const tags = contextTags(input.answers, input.observations);
  const items = [...groups.values()].map((observations) => {
    const ordered = [...observations].sort((left, right) =>
      (left.measuredTo ?? left.createdAt).localeCompare(
        right.measuredTo ?? right.createdAt,
      ),
    );
    const latest = ordered.at(-1)!;
    const analysis = analyzeLabHistory(
      ordered.map((observation) => ({
        analyte: observation.analyte,
        measuredAt: observation.measuredTo,
        recordedAt: observation.createdAt,
        ...(observation.referenceRange === undefined
          ? {}
          : {
              referenceRange: {
                ...(observation.referenceRange.maximum === undefined
                  ? {}
                  : { maximum: observation.referenceRange.maximum }),
                ...(observation.referenceRange.minimum === undefined
                  ? {}
                  : { minimum: observation.referenceRange.minimum }),
                ...(observation.referenceRange.unit === undefined
                  ? {}
                  : { unit: observation.referenceRange.unit }),
              },
            }),
        ...(observation.unit === undefined ? {} : { unit: observation.unit }),
        value: observation.value,
      })),
    );
    return {
      analyte: analysis.analyte,
      freshness: labFreshness({
        analyte: latest.analyte,
        contextTags: tags,
        measuredAt: latest.measuredTo,
        now: input.now,
      }),
      interpretation: analysis.interpretation,
      latestObservationId: latest.id,
      latestValue: analysis.latestValue,
      name: latest.name,
      trend: analysis.trend,
      unit: analysis.unit,
    };
  });
  return LabHistorySchema.parse({
    items: items.sort((left, right) => left.name.localeCompare(right.name, "es")),
    observations: input.observations,
    profileId: input.profileId,
  });
}
