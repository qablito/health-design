import type {
  FollowUpImpact,
  FollowUpValues,
  LabAnalyte,
} from "@health-design/contracts";
import { QUESTIONNAIRE_MODULES, type QuestionnaireModule } from "@health-design/domain";

import { normalizeDecimal } from "../decimal.ts";
import {
  convertLabValue,
  LAB_ANALYTE_UNITS,
  normalizeLabUnit,
  type LabAnalyteKey,
} from "../modules/supplements/index.ts";

const MODULE_DEPENDENCIES: Readonly<
  Record<QuestionnaireModule, readonly QuestionnaireModule[]>
> = {
  hydration: ["hydration", "supplements"],
  mobility: ["training", "mobility"],
  nutrition: ["nutrition", "supplements"],
  sleep: ["sleep", "supplements"],
  supplements: ["supplements"],
  training: ["nutrition", "training", "hydration", "mobility", "supplements"],
};

const FOLLOW_UP_MODULES = [
  "nutrition",
  "training",
  "hydration",
  "sleep",
  "mobility",
  "supplements",
] as const satisfies readonly QuestionnaireModule[];

type FollowUpImpactInput = Readonly<{
  activeModules: readonly QuestionnaireModule[];
  requestRecalculation: boolean;
  scope: "daily" | "weekly" | "four_week";
  values: FollowUpValues;
}>;

function orderedModules(
  values: Iterable<QuestionnaireModule>,
  activeModules: readonly QuestionnaireModule[],
): QuestionnaireModule[] {
  const selected = new Set(values);
  const active = new Set(activeModules);
  return QUESTIONNAIRE_MODULES.filter(
    (module) => selected.has(module) && active.has(module),
  );
}

function addDependencies(
  target: Set<QuestionnaireModule>,
  module: QuestionnaireModule,
): void {
  for (const dependency of MODULE_DEPENDENCIES[module]) target.add(dependency);
}

export function analyzeFollowUpImpact(input: FollowUpImpactInput): FollowUpImpact {
  const active = new Set(input.activeModules);
  for (const module of FOLLOW_UP_MODULES) {
    if (input.values[module] !== undefined && !active.has(module)) {
      throw new Error("inactive_follow_up_module");
    }
  }
  for (const symptom of input.values.common?.importantSymptoms ?? []) {
    if (symptom.modules.some((module) => !active.has(module))) {
      throw new Error("inactive_follow_up_module");
    }
  }

  const affected = new Set<QuestionnaireModule>();
  const conservative = new Set<QuestionnaireModule>();
  const reasons = new Set<string>();
  const materialChanges = input.values.common?.materialChanges ?? [];
  const structural = materialChanges.length > 0;

  if (structural) {
    for (const module of input.activeModules) affected.add(module);
    for (const change of materialChanges) reasons.add(`material_${change}`);
  }

  for (const symptom of input.values.common?.importantSymptoms ?? []) {
    for (const module of symptom.modules) {
      affected.add(module);
      conservative.add(module);
    }
    reasons.add("important_symptom");
  }

  const importantModuleSignals: Array<
    readonly [QuestionnaireModule, boolean | undefined]
  > = [
    ["training", input.values.training?.pain === "important"],
    ["hydration", input.values.hydration?.issues === "important"],
    ["mobility", input.values.mobility?.discomfort === "important"],
    ["supplements", input.values.supplements?.adverseEffects === "important"],
  ];
  for (const [module, important] of importantModuleSignals) {
    if (!important) continue;
    affected.add(module);
    conservative.add(module);
    reasons.add(`${module}_important_signal`);
  }

  const volumeChange = input.values.training?.volumeChangePercent;
  const excessiveVolumeChange =
    volumeChange !== undefined && Math.abs(volumeChange) > 10;
  if (excessiveVolumeChange) {
    addDependencies(affected, "training");
    reasons.add("training_volume_change_material");
  }

  if (input.requestRecalculation) {
    const providedModules = FOLLOW_UP_MODULES.filter(
      (module) => input.values[module] !== undefined,
    );
    for (const module of providedModules.length > 0
      ? providedModules
      : input.activeModules) {
      addDependencies(affected, module);
    }
    reasons.add("recalculation_requested");
  }

  const candidateRequired =
    structural ||
    affected.size > 0 ||
    excessiveVolumeChange ||
    input.requestRecalculation;
  const minorTrainingAdjustmentPercent =
    !candidateRequired &&
    volumeChange !== undefined &&
    volumeChange !== 0 &&
    Math.abs(volumeChange) <= 10 &&
    input.values.training?.pain !== "important"
      ? volumeChange
      : null;
  if (minorTrainingAdjustmentPercent !== null) {
    reasons.add("training_volume_change_bounded");
  }

  const affectedModules = orderedModules(affected, input.activeModules);
  const impact = structural
    ? "structural"
    : affectedModules.length === 0
      ? "unaffected"
      : affectedModules.length === 1
        ? "module_only"
        : "dependent_modules";
  return {
    affectedModules,
    candidateRequired,
    conservativeModules: orderedModules(conservative, input.activeModules),
    impact,
    minorTrainingAdjustmentPercent,
    reasons: [...reasons].sort(),
  };
}

type LabHistoryValue = Readonly<{
  analyte: LabAnalyte;
  measuredAt: string | null;
  referenceRange?: Readonly<{
    maximum?: string;
    minimum?: string;
    unit?: string;
  }>;
  unit?: string;
  value: string;
}>;

export type LabHistoryAnalysis = Readonly<{
  analyte: LabAnalyte;
  interpretation: "above_range" | "below_range" | "within_range" | "unknown";
  latestValue: string;
  trend: "up" | "down" | "stable" | "insufficient";
  unit: string | null;
}>;

function chronological(values: readonly LabHistoryValue[]): LabHistoryValue[] {
  return [...values].sort((left, right) =>
    (left.measuredAt ?? "").localeCompare(right.measuredAt ?? ""),
  );
}

function comparableValue(
  observation: LabHistoryValue,
  targetUnit: string,
): number | null {
  if (observation.analyte === "other") return null;
  const unit = normalizeLabUnit(observation.unit);
  if (!unit) return null;
  return convertLabValue(
    Number(observation.value),
    observation.analyte,
    unit,
    targetUnit,
  );
}

export function analyzeLabHistory(
  values: readonly LabHistoryValue[],
): LabHistoryAnalysis {
  if (values.length === 0) throw new Error("lab_history_required");
  const ordered = chronological(values);
  const latest = ordered.at(-1)!;
  const targetUnit =
    latest.analyte === "other"
      ? normalizeLabUnit(latest.unit)
      : (LAB_ANALYTE_UNITS[latest.analyte][0] ?? null);
  const latestNumber = targetUnit ? comparableValue(latest, targetUnit) : null;
  const previous = ordered.length > 1 ? ordered.at(-2)! : null;
  const previousNumber =
    previous && targetUnit ? comparableValue(previous, targetUnit) : null;
  const trend =
    latestNumber === null || previousNumber === null
      ? "insufficient"
      : latestNumber === previousNumber
        ? "stable"
        : latestNumber > previousNumber
          ? "up"
          : "down";

  let interpretation: LabHistoryAnalysis["interpretation"] = "unknown";
  const rangeUnit = normalizeLabUnit(latest.referenceRange?.unit ?? latest.unit);
  const valueForRange =
    rangeUnit && latestNumber !== null && targetUnit
      ? convertLabValue(
          latestNumber,
          latest.analyte as LabAnalyteKey,
          targetUnit,
          rangeUnit,
        )
      : null;
  if (valueForRange !== null) {
    const minimum = latest.referenceRange?.minimum;
    const maximum = latest.referenceRange?.maximum;
    interpretation =
      minimum !== undefined && valueForRange < Number(minimum)
        ? "below_range"
        : maximum !== undefined && valueForRange > Number(maximum)
          ? "above_range"
          : minimum !== undefined || maximum !== undefined
            ? "within_range"
            : "unknown";
  }

  return {
    analyte: latest.analyte,
    interpretation,
    latestValue:
      latestNumber === null
        ? normalizeDecimal(latest.value)
        : normalizeDecimal(String(latestNumber)),
    trend,
    unit: targetUnit,
  };
}

type FreshnessContextTag =
  | "b12_replacement"
  | "magnesium_replacement"
  | "pregnancy_b12_replacement"
  | "renal_g1_g2"
  | "renal_g3"
  | "renal_g4"
  | "renal_g5";

type FreshnessRule = Readonly<{
  analytes: readonly LabAnalyte[];
  contextTag: FreshnessContextTag;
  evidenceRef: string;
  reviewAfterDays: number;
  ruleId: string;
}>;

export const LAB_FRESHNESS_RULES = [
  {
    analytes: ["b12"],
    contextTag: "pregnancy_b12_replacement",
    evidenceRef:
      "https://www.nice.org.uk/guidance/ng239/chapter/recommendations#ongoing-care-and-follow-up",
    reviewAfterDays: 30,
    ruleId: "b12-pregnancy-replacement-nice-ng239",
  },
  {
    analytes: ["b12"],
    contextTag: "b12_replacement",
    evidenceRef:
      "https://www.nice.org.uk/guidance/ng239/chapter/recommendations#ongoing-care-and-follow-up",
    reviewAfterDays: 90,
    ruleId: "b12-replacement-nice-ng239",
  },
  {
    analytes: ["magnesium"],
    contextTag: "magnesium_replacement",
    evidenceRef:
      "https://www.sps.nhs.uk/articles/treating-acute-hypomagnesaemia-in-adults/",
    reviewAfterDays: 90,
    ruleId: "magnesium-replacement-nhs-sps",
  },
  {
    analytes: ["creatinine", "egfr"],
    contextTag: "renal_g1_g2",
    evidenceRef:
      "https://kdigo.org/wp-content/uploads/2024/03/KDIGO-2024-CKD-Guideline.pdf",
    reviewAfterDays: 365,
    ruleId: "renal-g1-g2-kdigo-2024",
  },
  {
    analytes: ["creatinine", "egfr"],
    contextTag: "renal_g3",
    evidenceRef:
      "https://kdigo.org/wp-content/uploads/2024/03/KDIGO-2024-CKD-Guideline.pdf",
    reviewAfterDays: 183,
    ruleId: "renal-g3-kdigo-2024",
  },
  {
    analytes: ["creatinine", "egfr"],
    contextTag: "renal_g4",
    evidenceRef:
      "https://kdigo.org/wp-content/uploads/2024/03/KDIGO-2024-CKD-Guideline.pdf",
    reviewAfterDays: 91,
    ruleId: "renal-g4-kdigo-2024",
  },
  {
    analytes: ["creatinine", "egfr"],
    contextTag: "renal_g5",
    evidenceRef:
      "https://kdigo.org/wp-content/uploads/2024/03/KDIGO-2024-CKD-Guideline.pdf",
    reviewAfterDays: 42,
    ruleId: "renal-g5-kdigo-2024",
  },
] as const satisfies readonly FreshnessRule[];

export function labFreshness(
  input: Readonly<{
    analyte: LabAnalyte;
    contextTags: readonly string[];
    measuredAt: string | null;
    now: string;
  }>,
) {
  const rule = LAB_FRESHNESS_RULES.find(
    (candidate) =>
      (candidate.analytes as readonly LabAnalyte[]).includes(input.analyte) &&
      input.contextTags.includes(candidate.contextTag),
  );
  if (!rule || !input.measuredAt) {
    return {
      ageDays: null,
      confidence: "unknown" as const,
      evidenceRef: null,
      reviewAfterDays: null,
      ruleId: null,
    };
  }
  const ageDays = Math.floor(
    (new Date(input.now).getTime() -
      new Date(`${input.measuredAt}T00:00:00Z`).getTime()) /
      86_400_000,
  );
  if (!Number.isFinite(ageDays) || ageDays < 0) throw new Error("invalid_lab_age");
  return {
    ageDays,
    confidence:
      ageDays <= Math.floor(rule.reviewAfterDays / 2)
        ? ("high" as const)
        : ageDays <= rule.reviewAfterDays
          ? ("medium" as const)
          : ("low" as const),
    evidenceRef: rule.evidenceRef,
    reviewAfterDays: rule.reviewAfterDays,
    ruleId: rule.ruleId,
  };
}
