import { describe, expect, it } from "vitest";

import {
  SupplementsPlanSchema,
  type ContextSnapshotInternal,
} from "@health-design/contracts";
import {
  CORE_SOURCE_REVISIONS,
  generateSupplementsPlan,
  normalizeLabs,
  runDeterministicEngine,
} from "@health-design/engine";

const hash = (pair: string) => pair.repeat(32);

const context = (
  answers: ContextSnapshotInternal["answers"],
): ContextSnapshotInternal => ({
  answers,
  canonicalizationVersion: "canonical-json-v1",
  completeness: "complete",
  createdAt: "2026-07-19T12:00:00.000Z",
  effectiveAt: "2026-07-19T12:00:00.000Z",
  id: "50000000-0000-4000-8000-000000000112",
  inputHash: hash("11"),
  normalizationVersion: "normalization-v1",
  profileId: "10000000-0000-4000-8000-000000000112",
  schemaVersion: 1,
  sourceDraftId: "40000000-0000-4000-8000-000000000112",
  sourceDraftVersion: 1,
});

describe("núcleo determinista de suplementos T12", () => {
  it("devuelve neutral cuando suplementación no está seleccionada", () => {
    const result = generateSupplementsPlan({ activeModules: [] });
    expect(SupplementsPlanSchema.parse(result)).toMatchObject({
      status: "not_requested",
      recommendations: [],
      experimentalOptions: [],
      notRecommended: [],
    });
  });

  it("no permite marcar complete con incertidumbres ni provisional sin ellas", () => {
    const complete = generateSupplementsPlan({
      activeModules: ["supplements"],
      dietaryPattern: "vegan",
      hasConditions: false,
      hasMedications: false,
      supplementRecommendationPreference: "only_deficiencies",
    });
    expect(complete).toMatchObject({
      completeness: "complete",
      status: "complete",
      uncertainties: [],
    });
    expect(() =>
      SupplementsPlanSchema.parse({
        ...complete,
        uncertainties: ["missing_context"],
      }),
    ).toThrow("supplements_complete_requires_no_uncertainties");
    expect(() =>
      SupplementsPlanSchema.parse({
        ...complete,
        completeness: "provisional",
        status: "provisional",
        uncertainties: [],
      }),
    ).toThrow("supplements_provisional_requires_uncertainties");
  });

  it("clasifica como revisión sistemática y alinea los reviews de sueño", () => {
    const sourceFor = (pmid: string) =>
      CORE_SOURCE_REVISIONS.find(({ url }) =>
        url.endsWith(`/pubmed.ncbi.nlm.nih.gov/${pmid}/`),
      );
    const beta = sourceFor("40995761");
    const glycine = sourceFor("37851316");
    expect(beta).toMatchObject({
      evidenceType: "systematic_review",
      hierarchy: "systematic_review",
    });
    expect(glycine).toMatchObject({
      evidenceType: "systematic_review",
      hierarchy: "systematic_review",
    });
    for (const pmid of ["40056718", "34559859"]) {
      const source = sourceFor(pmid);
      expect(source).toMatchObject({
        evidenceType: "systematic_review_meta_analysis",
        hierarchy: "systematic_review_meta_analysis",
      });
      expect(
        `${source?.applicability.join(" ")} ${source?.citation} ${source?.population}`,
      ).toMatch(/sueño|sleep/i);
      expect(source?.citation).toMatch(/meta-analysis/i);
    }
  });

  it("integra suplementación en el pipeline sin mutar módulos no afectados", async () => {
    const result = await runDeterministicEngine({
      baseContext: null,
      baseModuleResults: null,
      change: null,
      context: context({
        activeModules: ["supplements"],
        hasConditions: false,
        hasMedications: false,
      }),
    });
    const supplements = result.moduleResults.find(
      ({ module }) => module === "supplements",
    );
    expect(supplements).toMatchObject({ module: "supplements", status: "provisional" });
    expect(() => SupplementsPlanSchema.parse(supplements?.payload)).not.toThrow();
  });

  it("prioriza alimentos fortificados para B12 en veganismo y no automatiza dosis", () => {
    const result = generateSupplementsPlan({
      activeModules: ["supplements"],
      dietaryPattern: "vegan",
      hasConditions: false,
      hasMedications: false,
      supplementRecommendationPreference: "only_deficiencies",
    });
    expect(result.status).toBe("complete");
    expect(result.recommendations).toHaveLength(1);
    expect(result.recommendations[0]).toMatchObject({
      id: "vitamin_b12",
      doseReference: null,
      tier: "deficiency",
    });
    expect(result.recommendations[0]?.form).toContain("fortificados");
    expect(JSON.stringify(result)).not.toMatch(/profesional/i);
  });

  it("incluye ácido fólico periconcepcional con 400 µg y nunca 5 mg", () => {
    const result = generateSupplementsPlan({
      activeModules: ["supplements"],
      hasConditions: false,
      hasMedications: false,
      pregnancyLactation: "trying_to_conceive",
      primaryObjective: "wellbeing_healthy_habits",
      supplementRecommendationPreference: "only_deficiencies",
    });
    const folate = result.recommendations.find(
      ({ id }) => id === "folic_acid_preconception",
    );
    expect(folate?.action).toBe("trial_candidate");
    expect(folate?.doseReference).toContain("400 µg");
    expect(JSON.stringify(folate)).not.toContain("5 mg");
  });

  it("respeta none, limita only_deficiencies y separa experimentales", () => {
    const none = generateSupplementsPlan({
      activeModules: ["supplements"],
      dietaryPattern: "vegan",
      hasConditions: false,
      hasMedications: false,
      supplementRecommendationPreference: "none",
    });
    expect(none.recommendations).toEqual([]);
    const contextual = generateSupplementsPlan({
      activeModules: ["supplements"],
      hasConditions: false,
      hasMedications: false,
      primaryObjective: "performance_strength",
      supplementGoals: ["estrés"],
      supplementRecommendationPreference: "contextual",
      trainingMode: "own",
    });
    expect(
      contextual.experimentalOptions.every(
        ({ tier, confidence }) => tier === "experimental" && confidence === "low",
      ),
    ).toBe(true);
    expect(
      contextual.recommendations.every(({ tier }) => tier !== "experimental"),
    ).toBe(true);
  });

  it("activa las opciones experimentales de L-teanina y ashwagandha solo en sueño pobre", () => {
    const sleep = generateSupplementsPlan({
      activeModules: ["supplements"],
      hasConditions: false,
      hasMedications: false,
      sleepQuality: "poor",
      supplementRecommendationPreference: "contextual",
    });
    expect(sleep.experimentalOptions.map(({ id }) => id)).toEqual(
      expect.arrayContaining(["glycine", "l_theanine", "ashwagandha"]),
    );
    const stressOnly = generateSupplementsPlan({
      activeModules: ["supplements"],
      hasConditions: false,
      hasMedications: false,
      sleepQuality: "good",
      supplementGoals: ["estrés"],
      supplementRecommendationPreference: "contextual",
    });
    expect(stressOnly.experimentalOptions.map(({ id }) => id)).not.toEqual(
      expect.arrayContaining(["l_theanine", "ashwagandha"]),
    );
  });

  it("impide dos trial_candidate y registra suplementos actuales sin recomendarlos", () => {
    const result = generateSupplementsPlan({
      activeModules: ["supplements"],
      currentSupplements: [{ name: "Creatina" }],
      dietaryPattern: "vegan",
      hasConditions: false,
      hasMedications: false,
      primaryObjective: "performance_strength",
      supplementRecommendationPreference: "contextual",
      trainingMode: "own",
    });
    expect(result.currentSupplements).toEqual([
      expect.objectContaining({
        classification: "known_context",
        status: "recorded_context",
      }),
    ]);
    expect(
      result.recommendations.filter(({ action }) => action === "trial_candidate"),
    ).toHaveLength(1);
    expect(() =>
      SupplementsPlanSchema.parse({
        ...result,
        recommendations: result.recommendations.map((item) => ({
          ...item,
          action: "trial_candidate" as const,
        })),
      }),
    ).toThrow("supplements_only_one_trial_candidate");
  });

  it("degrada toda propuesta nueva cuando un suplemento actual tiene composición opaca", () => {
    const result = generateSupplementsPlan({
      activeModules: ["supplements"],
      currentSupplements: [{ name: "Mezcla propietaria nocturna" }],
      dietaryPattern: "vegan",
      hasConditions: false,
      hasCurrentSupplements: true,
      hasMedications: false,
      sleepQuality: "poor",
      supplementRecommendationPreference: "contextual",
    });

    expect(result.currentSupplements).toEqual([
      { classification: "opaque_context", status: "recorded_context" },
    ]);
    expect(result.uncertainties).toContain("opaque_current_supplement_requires_review");
    expect([...result.recommendations, ...result.experimentalOptions]).not.toHaveLength(
      0,
    );
    expect(
      [...result.recommendations, ...result.experimentalOptions].every(
        ({ action }) => action === "review_required",
      ),
    ).toBe(true);
    expect(result.status).toBe("provisional");
  });

  it("no recomienda anabolizantes/SARMs y conserva revisión de interacción farmacológica", () => {
    const result = generateSupplementsPlan({
      activeModules: ["supplements"],
      hasConditions: false,
      hasMedications: true,
      medications: [
        { name: "Ozempic" },
        { name: "Warfarina" },
        { name: "Omeprazol" },
        { name: "SARMiento" },
      ],
      primaryObjective: "performance_strength",
      trainingMode: "own",
      supplementGoals: ["bajo magnesio"],
      supplementRecommendationPreference: "contextual",
    });
    expect(JSON.stringify(result.recommendations)).not.toMatch(
      /sarm|testosterona|ozempic|warfarina/i,
    );
    expect(
      result.recommendations.find(({ id }) => id === "magnesium_context"),
    ).toMatchObject({ id: "magnesium_context" });
    expect(result.uncertainties).toEqual(
      expect.arrayContaining(["clinical_coverage_partial_or_unmodeled"]),
    );
  });

  it("mantiene provisional un plan con alias farmacológico conocido y parte desconocida", () => {
    const result = generateSupplementsPlan({
      activeModules: ["supplements"],
      dietaryPattern: "vegan",
      hasConditions: false,
      hasMedications: true,
      medications: [{ name: "Semaglutida + fármaco no identificado" }],
      supplementRecommendationPreference: "only_deficiencies",
    });

    expect(result.clinicalCoverage).toBe("unmodeled");
    expect(result.status).toBe("provisional");
    expect(result.recommendations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "vitamin_b12", action: "review_required" }),
      ]),
    );
  });

  it("normaliza laboratorios actuales solo con valor, unidad y rango aportados", () => {
    const recognized = generateSupplementsPlan({
      activeModules: ["supplements"],
      dietaryPattern: "vegan",
      hasConditions: false,
      hasMedications: false,
      labValues: [
        {
          dateApproximate: "hoy",
          name: "Vitamina B12",
          referenceRange: "200-900 pg/mL",
          unit: "pg/mL",
          value: "150",
        },
      ],
      supplementRecommendationPreference: "only_deficiencies",
    });
    expect(recognized.labSummary).toEqual([
      expect.objectContaining({
        analyte: "b12",
        interpretation: "below_range",
        status: "recognized",
      }),
    ]);
    const malformed = generateSupplementsPlan({
      activeModules: ["supplements"],
      hasConditions: false,
      hasMedications: false,
      labValues: [
        { dateApproximate: "hoy", name: "Magnesio", unit: "mg/dL", value: "0.5" },
      ],
      supplementRecommendationPreference: "only_deficiencies",
    });
    expect(malformed.labSummary).toEqual([
      { name: "Magnesio", reason: "missing_reference_range", status: "incomplete" },
    ]);
    expect(malformed.recommendations).toEqual([]);
    expect(malformed.status).toBe("provisional");
  });

  it("bloquea creatina ante contexto renal, reduce cafeína con mal sueño y aplica override clínico a electrolitos", () => {
    const blocked = generateSupplementsPlan({
      activeModules: ["supplements"],
      conditions: [{ name: "Enfermedad renal" }],
      hasConditions: true,
      hasMedications: false,
      primaryObjective: "performance_strength",
      trainingMode: "own",
      ownTrainingSessionMinutes: 90,
      hydrationClimate: "hot",
      hydrationSweat: "high",
      sleepHours: 6,
      sleepQuality: "poor",
      supplementRecommendationPreference: "contextual",
    });
    expect(
      blocked.recommendations.some(({ id }) => id === "creatine_monohydrate"),
    ).toBe(false);
    expect(
      blocked.recommendations.some(({ id }) => id === "caffeine_performance"),
    ).toBe(false);
    expect(
      blocked.recommendations.some(({ id }) => id === "electrolytes_contextual"),
    ).toBe(false);
    expect(blocked.uncertainties).toEqual(
      expect.arrayContaining([
        "creatine_blocked_by_clinical_or_renal_uncertainty",
        "caffeine_sleep_reduction_strategy",
        "electrolytes_clinical_override",
      ]),
    );
  });

  it("no interpreta valores negativos ni unidades cruzadas y no activa Mg solo por quelación", () => {
    const result = generateSupplementsPlan({
      activeModules: ["supplements"],
      hasConditions: false,
      hasMedications: true,
      medications: [{ name: "Doxiciclina" }],
      labValues: [
        {
          dateApproximate: "hoy",
          name: "Vitamina B12",
          referenceRange: "200-900 pg/mL",
          unit: "mg/dL",
          value: "-1",
        },
        {
          dateApproximate: "hoy",
          name: "Magnesio",
          referenceRange: "0.7-1.0 mmol/L",
          unit: "mmol/L",
          value: "0.8",
        },
      ],
      supplementRecommendationPreference: "contextual",
    });
    expect(result.labSummary).toEqual(
      expect.arrayContaining([
        { name: "Vitamina B12", reason: "value", status: "unrecognized" },
        expect.objectContaining({ analyte: "magnesium", status: "recognized" }),
      ]),
    );
    expect(result.recommendations.some(({ id }) => id === "magnesium_context")).toBe(
      false,
    );
  });

  it("requiere revisión de omega-3 y melatonina con anticoagulantes", () => {
    const result = generateSupplementsPlan({
      activeModules: ["supplements"],
      dietaryPattern: "vegan",
      dailySchedule: "shift_work",
      hasConditions: false,
      hasMedications: true,
      medications: [{ name: "Apixabán" }],
      sleepQuality: "poor",
      supplementRecommendationPreference: "contextual",
    });
    expect(
      result.recommendations
        .filter(({ id }) => ["omega_3_epa_dha", "melatonin_sleep_context"].includes(id))
        .every(({ action }) => action === "review_required"),
    ).toBe(true);
  });

  it.each(["pregnant", "lactating"] as const)(
    "bloquea trials contextuales y experimentales durante %s, pero conserva B12 food-first",
    (pregnancyLactation) => {
      const result = generateSupplementsPlan({
        activeModules: ["supplements"],
        dietaryPattern: "vegan",
        hasConditions: false,
        hasMedications: false,
        hydrationClimate: "hot",
        hydrationSweat: "high",
        ownTrainingSessionMinutes: 90,
        pregnancyLactation,
        primaryObjective: "performance_strength",
        sleepQuality: "poor",
        supplementRecommendationPreference: "contextual",
        trainingMode: "own",
      });

      expect(result.status).toBe("provisional");
      expect(result.uncertainties).toContain(
        "pregnancy_or_lactation_context_requires_review",
      );
      expect(result.recommendations.map(({ id }) => id)).not.toEqual(
        expect.arrayContaining([
          "creatine_monohydrate",
          "caffeine_performance",
          "electrolytes_contextual",
        ]),
      );
      expect(result.experimentalOptions).toEqual([]);
      const b12 = result.recommendations.find(({ id }) => id === "vitamin_b12");
      expect(b12).toMatchObject({ id: "vitamin_b12", doseReference: null });
      expect(b12?.form).toContain("Alimentos fortificados primero");
      expect(
        result.recommendations
          .filter(({ tier }) => tier === "contextual")
          .every(
            ({ action, doseReference }) =>
              action === "review_required" && doseReference === null,
          ),
      ).toBe(true);
    },
  );

  it("distingue campos de laboratorio ausentes de valores o unidades inválidos", () => {
    const summary = normalizeLabs({
      labValues: [
        {
          dateApproximate: "hoy",
          name: "Creatinina",
          referenceRange: "0.6-1.2 mg/dL",
          unit: "mg/dL",
          value: undefined,
        },
        {
          dateApproximate: "hoy",
          name: "Creatinina",
          referenceRange: "0.6-1.2 mg/dL",
          unit: undefined,
          value: "1",
        },
        {
          dateApproximate: "hoy",
          name: "Creatinina",
          referenceRange: "0.6-1.2 mg/dL",
          unit: "mg/dL",
          value: "n/a",
        },
        {
          dateApproximate: "hoy",
          name: "Creatinina",
          referenceRange: "0.6-1.2 mg/dL",
          unit: "desconocida",
          value: "1",
        },
      ] as never,
    });

    expect(summary).toEqual([
      { name: "Creatinina", reason: "missing_value", status: "incomplete" },
      { name: "Creatinina", reason: "missing_unit", status: "incomplete" },
      { name: "Creatinina", reason: "value", status: "unrecognized" },
      { name: "Creatinina", reason: "unit", status: "unrecognized" },
    ]);
  });

  it("convierte creatinina en ambos sentidos con 88.4 sin aplicar el factor de magnesio", () => {
    const summary = normalizeLabs({
      labValues: [
        {
          dateApproximate: "hoy",
          name: "Creatinina",
          referenceRange: "0.6-1.2 mg/dL",
          unit: "umol/L",
          value: "88.4",
        },
        {
          dateApproximate: "hoy",
          name: "Creatinina",
          referenceRange: "53-106 umol/L",
          unit: "mg/dL",
          value: "1",
        },
        {
          dateApproximate: "hoy",
          name: "Magnesio",
          referenceRange: "0.7-1.0 mmol/L",
          unit: "mg/dL",
          value: "1",
        },
      ],
    });

    expect(summary).toHaveLength(3);
    expect(summary[0]).toMatchObject({
      analyte: "creatinine",
      interpretation: "within_range",
      unit: "mg/dL",
      value: 1,
      status: "recognized",
    });
    expect(summary[1]).toMatchObject({
      analyte: "creatinine",
      interpretation: "within_range",
      unit: "umol/L",
      value: 88.4,
      status: "recognized",
    });
    expect(summary[2]).toMatchObject({
      analyte: "magnesium",
      interpretation: "below_range",
      unit: "mmol/L",
      status: "recognized",
    });
    expect(summary[2]?.status === "recognized" ? summary[2].value : null).toBeCloseTo(
      0.4114,
      6,
    );
  });

  it("bloquea creatina, magnesio y electrolitos ante señal renal de laboratorio", () => {
    const result = generateSupplementsPlan({
      activeModules: ["supplements"],
      hasConditions: false,
      hasMedications: false,
      labValues: [
        {
          dateApproximate: "hoy",
          name: "Creatinina",
          referenceRange: "53-106 umol/L",
          unit: "mg/dL",
          value: "2",
        },
      ],
      ownTrainingSessionMinutes: 90,
      primaryObjective: "performance_strength",
      supplementGoals: ["bajo magnesio"],
      supplementRecommendationPreference: "contextual",
      trainingMode: "own",
    });

    expect(result.labSummary).toEqual([
      expect.objectContaining({
        analyte: "creatinine",
        interpretation: "above_range",
        status: "recognized",
      }),
    ]);
    expect(result.recommendations.some(({ id }) => id === "creatine_monohydrate")).toBe(
      false,
    );
    expect(result.recommendations.map(({ id }) => id)).not.toEqual(
      expect.arrayContaining(["magnesium_context", "electrolytes_contextual"]),
    );
    expect(result.uncertainties).toEqual(
      expect.arrayContaining([
        "renal_lab_context_requires_review",
        "creatine_blocked_by_clinical_or_renal_uncertainty",
      ]),
    );
  });

  it("mapea findings a ambos módulos solo cuando ambos están seleccionados", async () => {
    const result = await runDeterministicEngine({
      baseContext: null,
      baseModuleResults: null,
      change: null,
      context: context({
        activeModules: ["hydration", "supplements"],
        conditions: [{ name: "Enfermedad renal" }],
        hasConditions: true,
        hasMedications: false,
      }),
    });
    expect(result.safetyFindings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "RENAL_CONTEXT_PARTIAL", module: "hydration" }),
        expect.objectContaining({
          code: "RENAL_CONTEXT_PARTIAL",
          module: "supplements",
        }),
      ]),
    );
  });
});
