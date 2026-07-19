import { describe, expect, it } from "vitest";

import { SleepPlanSchema } from "@health-design/contracts";
import { generateSleepPlan } from "@health-design/engine";

const selected = {
  activeModules: ["sleep" as const],
  sleepQuality: "good" as const,
  sleepRegularity: "regular" as const,
  sleepHours: 8,
};

describe("motor de sueño T12", () => {
  it.each([
    [7, "within_window", "maintain_current_window"],
    [9, "within_window", "maintain_current_window"],
    [9.1, "above_window", "review_long_duration_context"],
  ] as const)(
    "clasifica la ventana %i h sin derivar duración",
    (sleepHours, durationBand, strategy) => {
      const plan = SleepPlanSchema.parse(
        generateSleepPlan({ ...selected, sleepHours }),
      );

      expect(plan.targetWindowHours).toEqual({ min: 7, max: 9 });
      expect(plan.observedHours).toBe(sleepHours);
      expect(plan.durationBand).toBe(durationBand);
      expect(plan.strategies).toContain(strategy);
      expect(plan.schedule).toEqual({ bedTime: null, wakeTime: null });
    },
  );

  it("protege una oportunidad inferior a siete horas", () => {
    const plan = generateSleepPlan({ ...selected, sleepHours: 6.9 });

    expect(plan.durationBand).toBe("below_window");
    expect(plan.strategies).toContain("protect_sleep_opportunity");
    expect(plan.confidence).toBe("high");
  });

  it("mantiene >9 contextual sin lenguaje patológico ni findings", () => {
    const plan = generateSleepPlan({ ...selected, sleepHours: 10 });
    const serialized = JSON.stringify(plan).toLowerCase();

    expect(plan.strategies).toContain("review_long_duration_context");
    expect(serialized).not.toMatch(/patholog|diagnos|finding|risk|warning/);
    expect(plan).not.toHaveProperty("safetyFindings");
  });

  it("marca solo las tres ausencias críticas como provisional", () => {
    const plan = SleepPlanSchema.parse({
      ...generateSleepPlan({ activeModules: ["sleep"] }),
    });

    expect(plan.status).toBe("provisional");
    expect(plan.completeness).toBe("provisional");
    expect(plan.confidence).toBe("low");
    expect(plan.uncertainties.map(({ code }) => code)).toEqual([
      "SLEEP_HOURS_MISSING",
      "SLEEP_QUALITY_MISSING",
      "SLEEP_REGULARITY_MISSING",
    ]);
  });

  it("aplica estrategias y confidence conservadores para calidad y regularidad", () => {
    const plan = generateSleepPlan({
      ...selected,
      sleepQuality: "very_poor",
      sleepRegularity: "very_variable",
    });

    expect(plan.confidence).toBe("medium");
    expect(plan.confidenceFactors).toEqual(
      expect.arrayContaining(["quality_low", "regularity_variable"]),
    );
    expect(plan.strategies).toEqual(
      expect.arrayContaining(["review_routine_and_environment", "stabilize_wake_time"]),
    );
  });

  it("conserva fases parciales como estimación manual solo con tracking activo", () => {
    const tracked = generateSleepPlan({
      ...selected,
      sleepTracking: true,
      sleepRemMinutes: 90,
      sleepDeepMinutes: undefined,
      sleepLightMinutes: 300,
    });
    const untracked = generateSleepPlan({
      ...selected,
      sleepTracking: false,
      sleepRemMinutes: 90,
      sleepDeepMinutes: 40,
    });

    expect(tracked.phases).toEqual({
      source: "manual_estimate",
      remMinutes: 90,
      deepMinutes: null,
      lightMinutes: 300,
    });
    expect(tracked.strategies).toContain("trend_manual_estimates_only");
    expect(tracked.confidence).toBe("medium");
    expect(untracked.phases).toBeNull();
    expect(untracked.strategies).not.toContain("trend_manual_estimates_only");
  });

  it("preserva horarios sin calcular duración ni cruces de medianoche", () => {
    const plan = generateSleepPlan({
      ...selected,
      sleepBedTime: "23:50",
      sleepWakeTime: "06:20",
    });

    expect(plan.schedule).toEqual({ bedTime: "23:50", wakeTime: "06:20" });
    expect(plan.observedHours).toBe(8);
  });

  it("rechaza horarios que no sean HH:mm", () => {
    expect(() =>
      SleepPlanSchema.parse(generateSleepPlan({ ...selected, sleepBedTime: "25:00" })),
    ).toThrow();
  });

  it("marca horario incompleto como estrategia, no como incertidumbre crítica", () => {
    const plan = generateSleepPlan({ ...selected, sleepBedTime: "23:00" });

    expect(plan.strategies).toContain("record_schedule");
    expect(plan.confidenceFactors).toContain("schedule_missing");
    expect(plan.uncertainties).toEqual([]);
  });

  it("no incluye diario, importación ni notificaciones en el contrato", () => {
    const plan = generateSleepPlan({
      ...selected,
      sleepTracking: true,
      sleepRemMinutes: 90,
    });
    const keys = Object.keys(plan);

    expect(keys).not.toEqual(
      expect.arrayContaining(["diary", "import", "sync", "notifications"]),
    );
  });

  it("devuelve un estado neutro al no seleccionar sueño", () => {
    const plan = SleepPlanSchema.parse(generateSleepPlan({ activeModules: [] }));

    expect(plan).toEqual({
      status: "not_requested",
      completeness: "complete",
      targetWindowHours: { min: 7, max: 9 },
      observedHours: null,
      durationBand: "missing",
      schedule: { bedTime: null, wakeTime: null },
      regularity: null,
      quality: null,
      phases: null,
      confidence: "high",
      confidenceFactors: [],
      strategies: [],
      uncertainties: [],
    });
  });
});
