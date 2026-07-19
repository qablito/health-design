import { describe, expect, it } from "vitest";

import {
  HydrationPlanSchema,
  type ContextSnapshotInternal,
} from "@health-design/contracts";
import { generateHydrationPlan } from "../packages/engine/src/modules/hydration/index";
import { runDeterministicEngine } from "../packages/engine/src/index";

const base = {
  activeModules: ["hydration" as const],
  hydrationClimate: "temperate" as const,
  hydrationSweat: "low" as const,
};

describe("motor de hidratación", () => {
  it.each([
    ["female", 2000],
    ["male", 2500],
  ] as const)("usa la referencia EFSA para %s", (physiologicalSex, center) => {
    const plan = generateHydrationPlan({
      answers: { ...base, physiologicalSex },
    });
    expect(plan.totalReferenceMl.center).toBe(center);
  });

  it.each([
    ["pregnant", 2300],
    ["lactating", 2700],
  ] as const)("prioriza %s", (pregnancyLactation, center) => {
    const plan = generateHydrationPlan({
      answers: { ...base, physiologicalSex: "female", pregnancyLactation },
    });
    expect(plan.totalReferenceMl.center).toBe(center);
  });

  it("usa rango provisional sin atribuir sexo", () => {
    const plan = generateHydrationPlan({ answers: base });
    expect(plan.totalReferenceMl).toEqual({
      center: 2250,
      maximum: 2500,
      minimum: 2000,
    });
    expect(plan.completeness).toBe("provisional");
  });

  it("estima bebidas al 70–80 %, centro 75 %, redondeadas a 50 ml", () => {
    const plan = generateHydrationPlan({
      answers: { ...base, physiologicalSex: "female" },
    });
    expect(plan.beverageBandMl).toEqual({ center: 1500, maximum: 1600, minimum: 1400 });
    expect(plan.foodWaterEstimate).toEqual({
      center: 0.25,
      maximum: 0.3,
      minimum: 0.2,
    });
  });

  it("desplaza el centro al extremo alto sin sumar volumen", () => {
    const plan = generateHydrationPlan({
      answers: {
        ...base,
        physiologicalSex: "female",
        hydrationClimate: "hot",
        hydrationSweat: "high",
        medications: [{ name: "Testosterona" }],
      },
    });
    expect(plan.beverageBandMl?.center).toBe(plan.beverageBandMl?.maximum);
    expect(plan.strategies).toContain("high_side_only");
  });

  it("mantiene el extremo alto exacto también con referencia provisional", () => {
    const plan = generateHydrationPlan({
      answers: { ...base, hydrationSweat: "high" },
    });
    expect(plan.beverageBandMl?.center).toBe(plan.beverageBandMl?.maximum);
  });

  it("anula la banda ante restricción o contexto renal sin límite", () => {
    const restricted = generateHydrationPlan({
      answers: { ...base, physiologicalSex: "female", hydrationFluidRestriction: true },
    });
    const renal = generateHydrationPlan({
      answers: {
        ...base,
        physiologicalSex: "female",
        conditions: [{ name: "Enfermedad renal" }],
      },
    });
    expect(restricted.beverageBandMl).toBeNull();
    expect(renal.beverageBandMl).toBeNull();
    expect(restricted.completeness).toBe("provisional");
    expect(renal.completeness).toBe("provisional");
  });

  it("cuenta bebidas declaradas, registra alcohol y nunca lo propone", () => {
    const plan = generateHydrationPlan({
      answers: {
        ...base,
        physiologicalSex: "male",
        habitualBeverages: ["café", "leche", "cerveza"],
      },
    });
    expect(plan.countedBeverages).toEqual(["café", "leche"]);
    expect(plan.alcoholRecorded).toBe(true);
    expect(plan.proposedBeverages).not.toContain("cerveza");
  });

  it("mantiene recordatorios apagados y anclajes flexibles", () => {
    const plan = generateHydrationPlan({ answers: base });
    expect(plan.reminders).toBe(false);
    expect(plan.anchorSource).toBe("default");
    expect(plan.anchors.length).toBeGreaterThan(0);
  });

  it("devuelve not_requested cuando hidratación no está seleccionada", () => {
    const plan = generateHydrationPlan({ answers: { activeModules: ["nutrition"] } });
    expect(plan.status).toBe("not_requested");
  });

  it("cumple el contrato Zod", () => {
    expect(
      HydrationPlanSchema.parse(generateHydrationPlan({ answers: base })),
    ).toBeTruthy();
  });

  it("integra hallazgos clínicos en el resultado sin duplicarlos", async () => {
    const context = {
      answers: {
        activeModules: ["hydration"],
        conditions: [{ name: "Enfermedad renal" }],
        hydrationFluidRestriction: false,
        physiologicalSex: "female",
      },
      canonicalizationVersion: "canonical-json-v1",
      completeness: "complete",
      createdAt: "2026-07-19T12:00:00.000Z",
      effectiveAt: "2026-07-19T12:00:00.000Z",
      id: "50000000-0000-4000-8000-000000000201",
      inputHash: "11".repeat(32),
      normalizationVersion: "normalization-v1",
      profileId: "10000000-0000-4000-8000-000000000201",
      schemaVersion: 1,
      sourceDraftId: "40000000-0000-4000-8000-000000000201",
      sourceDraftVersion: 1,
    } satisfies ContextSnapshotInternal;
    const result = await runDeterministicEngine({
      baseContext: null,
      baseModuleResults: null,
      change: null,
      context,
    });
    expect(result.safetyFindings.map(({ code }) => code)).toEqual([
      "RENAL_CONTEXT_PARTIAL",
    ]);
    expect(
      result.moduleResults.find(({ module }) => module === "hydration"),
    ).toMatchObject({
      payload: { beverageBandMl: null },
      status: "provisional",
    });
  });
});
