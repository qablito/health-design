import { describe, expect, it } from "vitest";

import type { QuestionnaireAnswers } from "@health-design/domain";
import {
  generateHydrationPlan,
  generateSleepPlan,
  generateSupplementsPlan,
} from "@health-design/engine";

import {
  clinicalFindingLabel,
  readWellnessModules,
  supplementDisplayName,
  wellnessUncertaintyLabel,
} from "../apps/web/src/features/wellness/wellness-view";

const answers = {
  activeModules: ["hydration", "sleep", "supplements"],
  activityLevel: "moderate",
  age: 35,
  country: "ES",
  dailySchedule: "regular",
  dietaryPattern: "vegan",
  hasConditions: false,
  hasCurrentSupplements: true,
  currentSupplements: [{ name: "Marca personal secreta" }],
  hasMedications: false,
  habitualBeverages: ["agua", "café", "vino"],
  habitualWaterMl: 1_800,
  heightCm: 175,
  hydrationAnchors: ["wake_up", "midday"],
  hydrationClimate: "temperate",
  hydrationFluidRestriction: false,
  hydrationReminders: false,
  hydrationSweat: "medium",
  physiologicalSex: "male",
  primaryObjective: "wellbeing_energy",
  sleepHours: 7.5,
  sleepQuality: "good",
  sleepRegularity: "regular",
  sleepTracking: true,
  sleepRemMinutes: 95,
  sleepDeepMinutes: 80,
  sleepLightMinutes: 275,
  supplementRecommendationPreference: "contextual",
  trainingMode: "none",
  weightKg: 80,
} satisfies QuestionnaireAnswers;

function moduleResult(module: "hydration" | "sleep" | "supplements", payload: object) {
  return {
    confidence: "high" as const,
    createdAt: "2026-07-19T10:00:00.000Z",
    id: `56000000-0000-4000-8000-00000000120${module === "hydration" ? 1 : module === "sleep" ? 2 : 3}`,
    module,
    payload: payload as Record<string, unknown>,
    status: "valid" as const,
    uncertainties: [],
  };
}

describe("wellness view", () => {
  it("lee solo los tres contratos reales sin exponer nombres del contexto actual", () => {
    const result = readWellnessModules({
      moduleResults: [
        moduleResult("hydration", generateHydrationPlan(answers)),
        moduleResult("sleep", generateSleepPlan(answers)),
        moduleResult("supplements", generateSupplementsPlan(answers)),
      ],
      safetyFindings: [],
      validationStatus: "valid",
    });

    expect(result.hydration?.totalReferenceMl.center).toBe(2_500);
    expect(result.sleep?.targetWindowHours).toEqual({ min: 7, max: 9 });
    expect(result.supplements?.currentSupplements).toEqual([
      { classification: "opaque_context", status: "recorded_context" },
    ]);
    expect(JSON.stringify(result)).not.toContain("Marca personal secreta");
    expect(result.invalidModules).toEqual([]);
  });

  it("rechaza un payload inválido sin convertirlo en contenido visible", () => {
    const result = readWellnessModules({
      moduleResults: [moduleResult("sleep", { observedHours: 7 })],
      safetyFindings: [],
      validationStatus: "valid",
    });

    expect(result.sleep).toBeUndefined();
    expect(result.invalidModules).toEqual(["sleep"]);
  });

  it("descarta payloads marcados como inválidos aunque su contrato parsea", () => {
    const hydration = moduleResult("hydration", generateHydrationPlan(answers));
    const result = readWellnessModules({
      moduleResults: [{ ...hydration, status: "invalid" }],
      safetyFindings: [],
      validationStatus: "valid",
    });

    expect(result.hydration).toBeUndefined();
    expect(result.invalidModules).toEqual(["hydration"]);
  });

  it("descarta los módulos de bienestar si la versión completa es inválida", () => {
    const result = readWellnessModules({
      moduleResults: [
        moduleResult("hydration", generateHydrationPlan(answers)),
        moduleResult("sleep", generateSleepPlan(answers)),
      ],
      safetyFindings: [],
      validationStatus: "invalid",
    });

    expect(result.validationBlocked).toBe(true);
    expect(result.hydration).toBeUndefined();
    expect(result.sleep).toBeUndefined();
    expect(result.invalidModules).toEqual(["hydration", "sleep"]);
  });

  it("usa nombres permitidos y neutros para las fichas", () => {
    expect(supplementDisplayName("vitamin_b12")).toBe("Vitamina B12");
    expect(supplementDisplayName("unknown_product")).toBe("Opción no identificada");
    expect(wellnessUncertaintyLabel("FLUID_RESTRICTION_STATUS_UNKNOWN")).toMatch(
      /restricción de líquidos/i,
    );
    expect(clinicalFindingLabel("ANABOLIC_CONTEXT_PARTIAL")).toMatch(/cantidad fija/i);
    expect(wellnessUncertaintyLabel("RAW_PRIVATE_VALUE")).not.toContain(
      "RAW_PRIVATE_VALUE",
    );
  });
});
