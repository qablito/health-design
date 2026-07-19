import { describe, expect, it } from "vitest";
import {
  PlanEngineResultSchema,
  SleepPlanSchema,
  type ContextSnapshotInternal,
} from "@health-design/contracts";

import {
  CORE_RULE_REVISIONS,
  CORE_RULE_SET_REVISION,
  CORE_SOURCE_MANIFEST,
  CORE_SOURCE_REVISIONS,
  createClinicalCatalogDescriptor,
  ENGINE_VERSION,
  HISTORICAL_ENGINE_SNAPSHOT,
  HISTORICAL_CLINICAL_RULE_REVISION,
  T12_INITIAL_ENGINE_SNAPSHOT,
  resolveChoice,
  runDeterministicEngine,
} from "../packages/engine/src/index";

const hash = (pair: string) => pair.repeat(32);
const context: ContextSnapshotInternal = {
  answers: {
    activeModules: ["nutrition", "hydration"],
    activityLevel: "moderate",
    age: 35,
    country: "ES",
    hasConditions: false,
    hasMedications: false,
    heightCm: 178,
    mealsPerDay: 4,
    nutritionAllergiesStatus: "none",
    nutritionFoodAnxiety: "no",
    nutritionIntolerancesStatus: "none",
    physiologicalSex: "male",
    preferredFoods: ["Jose\u0301"],
    primaryObjective: "body_composition_maintain",
    proteinPreference: "food_only",
    trainingMode: "none",
    weightKg: 80,
  },
  canonicalizationVersion: "canonical-json-v1",
  completeness: "complete",
  createdAt: "2026-07-18T12:00:00.000Z",
  effectiveAt: "2026-07-18T12:00:00.000Z",
  id: "50000000-0000-4000-8000-000000000101",
  inputHash: hash("11"),
  normalizationVersion: "normalization-v1",
  profileId: "10000000-0000-4000-8000-000000000101",
  schemaVersion: 1,
  sourceDraftId: "40000000-0000-4000-8000-000000000101",
  sourceDraftVersion: 2,
};

describe("reconciliación de reglas", () => {
  it("versiona las fuentes científicas T11 y solo referencia revisiones registradas", () => {
    const expectedSourceIds = [
      "source:who-physical-activity-guidelines-2020@1.0.0",
      "source:acsm-resistance-training-position-2026@1.0.0",
      "source:ingram-static-stretching-meta-analysis-2025@1.0.0",
      "source:efsa-dietary-reference-values-water-2010@1.0.0",
      "source:aasm-srs-adult-sleep-duration-consensus-2015@1.0.0",
      "source:nih-ods-vitamin-b12-fact-sheet@1.0.0",
      "source:who-cdc-folic-acid-preconception@1.0.0",
      "source:nih-ods-exercise-creatine-issn-position@1.0.0",
      "source:nih-ods-omega-3-fact-sheet@1.0.0",
      "source:efsa-caffeine-scientific-opinion@1.0.0",
      "source:acsm-hydration-exercise-position@1.0.0",
      "source:aemps-ema-nccih-melatonin-safety@1.0.0",
      "source:nih-ods-magnesium-fact-sheet@1.0.0",
      "source:pubmed-beta-alanine-review@1.0.0",
      "source:pubmed-glycine-sleep-review@1.0.0",
      "source:pubmed-theanine-sleep-review@1.0.0",
      "source:pubmed-ashwagandha-review@1.0.0",
      "source:who-sodium-intake-guideline-2012@1.0.0",
      "source:glp1-nutrition-joint-advisory-2025@1.0.0",
      "source:ema-ozempic-product-information@1.0.0",
      "source:ema-mounjaro-product-information@1.0.0",
      "source:aemps-cima-medicines-catalog@1.0.0",
    ];

    expect(CORE_SOURCE_REVISIONS.map(({ id }) => id)).toEqual(expectedSourceIds);
    expect(CORE_SOURCE_MANIFEST).toMatchObject({
      id: "d46591cd-ae2a-4330-a037-c39436cae923",
      version: "core-with-contextual-wellness-v1",
    });
    expect(CORE_SOURCE_MANIFEST.sourceRevisionIds).toEqual(expectedSourceIds);

    const sleepSource = CORE_SOURCE_REVISIONS.find(
      ({ id }) => id === "source:aasm-srs-adult-sleep-duration-consensus-2015@1.0.0",
    );
    expect(sleepSource).toMatchObject({
      population:
        "Personas adultas: AASM/SRS cubre 18–60 años y National Sleep Foundation diferencia 18–64 y 65 o más.",
      url: "https://www.sleephealthjournal.org/article/S2352-7218(15)00160-6/fulltext",
    });
    expect(sleepSource?.applicability).toEqual([
      "AASM/SRS: al menos 7 horas con regularidad para personas adultas de 18 a 60 años.",
      "National Sleep Foundation: 7–9 horas entre 18 y 64 años, 7–8 desde 65 y 9 horas todavía apropiadas en ciertos contextos.",
    ]);
    expect(sleepSource?.citation).toContain("National Sleep Foundation");

    expect(
      CORE_SOURCE_REVISIONS.every(
        ({
          applicability,
          citation,
          exclusions,
          evidenceType,
          hierarchy,
          population,
          reviewedAt,
          status,
          url,
        }) =>
          applicability.length > 0 &&
          citation.length > 0 &&
          exclusions.length > 0 &&
          evidenceType.length > 0 &&
          hierarchy.length > 0 &&
          population.length > 0 &&
          reviewedAt === "2026-07-19" &&
          status === "active" &&
          URL.canParse(url),
      ),
    ).toBe(true);

    const registeredSourceIds = new Set(expectedSourceIds);
    expect(
      CORE_RULE_REVISIONS.flatMap(({ evidenceRefs }) => evidenceRefs)
        .filter((reference) => reference.startsWith("source:"))
        .every((reference) => registeredSourceIds.has(reference)),
    ).toBe(true);
    const t11Rules = CORE_RULE_REVISIONS.filter(({ ruleId }) =>
      [
        "rule.training-generated-block",
        "rule.training-declared-limitations",
        "rule.mobility-modular-duration",
      ].includes(ruleId),
    );
    expect(
      t11Rules
        .flatMap(({ evidenceRefs }) => evidenceRefs)
        .filter((reference) => reference.startsWith("source:"))
        .every((reference) => registeredSourceIds.has(reference)),
    ).toBe(true);

    expect(
      t11Rules.find(({ ruleId }) => ruleId === "rule.training-generated-block")
        ?.evidenceRefs,
    ).toEqual(
      expect.arrayContaining([
        "contract:t11-generated-four-week-block-v1",
        expectedSourceIds[0],
        expectedSourceIds[1],
      ]),
    );
    expect(
      t11Rules.find(({ ruleId }) => ruleId === "rule.training-declared-limitations")
        ?.evidenceRefs,
    ).toEqual(["contract:t11-declared-limitations-v1"]);
    expect(
      t11Rules.find(({ ruleId }) => ruleId === "rule.mobility-modular-duration")
        ?.evidenceRefs,
    ).toEqual(
      expect.arrayContaining([
        "contract:t11-mobility-modular-duration-v1",
        expectedSourceIds[2],
      ]),
    );
  });

  it("versiona el conjunto activo y exige evidencia trazable por revisión", () => {
    expect(ENGINE_VERSION).toBe("engine-v4");
    expect(CORE_RULE_SET_REVISION).toMatchObject({
      id: "9cf98aae-0f9f-452f-9577-72283eeff4d5",
      status: "active",
      version: "4.3.0",
    });
    expect(CORE_RULE_SET_REVISION.ruleRevisionIds).toEqual(
      CORE_RULE_REVISIONS.map(({ id }) => id),
    );
    expect(
      CORE_RULE_REVISIONS.every(
        ({ evidenceRefs, reviewedAt, status, version }) =>
          evidenceRefs.length > 0 &&
          ["2026-07-18", "2026-07-19"].includes(reviewedAt) &&
          status === "active" &&
          (version === "1.0.0" || version === "2.0.0"),
      ),
    ).toBe(true);
    expect(CORE_RULE_SET_REVISION.ruleRevisionIds).toEqual(
      expect.arrayContaining([
        "rule.training-generated-block@1.0.0",
        "rule.training-declared-limitations@1.0.0",
        "rule.mobility-modular-duration@1.0.0",
        "rule.sleep-window@1.0.0",
        "rule.clinical-selective@2.0.0",
        "rule.clinical-hypertension-context@1.0.0",
        "rule.clinical-glp1-context@1.0.0",
        "rule.clinical-physiological-context@1.0.0",
      ]),
    );
    expect(
      CORE_RULE_REVISIONS.find(({ ruleId }) => ruleId === "rule.sleep-window")
        ?.evidenceRefs,
    ).toEqual(
      expect.arrayContaining([
        "contract:t12-sleep-window-v1",
        "source:aasm-srs-adult-sleep-duration-consensus-2015@1.0.0",
      ]),
    );
    expect(
      CORE_RULE_REVISIONS.find(({ ruleId }) => ruleId === "rule.clinical-selective")
        ?.evidenceRefs,
    ).toEqual([
      "contract:t12-clinical-selective-v2",
      "source:aemps-cima-medicines-catalog@1.0.0",
    ]);
    expect(HISTORICAL_CLINICAL_RULE_REVISION).toEqual({
      evidenceRefs: ["contract:t12-clinical-selective-v1"],
      id: "rule.clinical-selective@1.0.0",
      kind: "conditional",
      reviewedAt: "2026-07-19",
      ruleId: "rule.clinical-selective",
      scope: ["hydration", "nutrition", "training", "mobility", "supplements"],
      status: "active",
      version: "1.0.0",
    });
    expect(
      CORE_SOURCE_REVISIONS.filter(({ evidenceType }) =>
        ["joint_advisory", "regulatory_product_information"].includes(evidenceType),
      ).map(({ hierarchy }) => hierarchy),
    ).toEqual(["advisory", "regulatory", "regulatory", "regulatory"]);
  });

  it("valida el descriptor clínico compilado y lo incorpora al hash y validación", async () => {
    const descriptor = createClinicalCatalogDescriptor();
    const result = await runDeterministicEngine({
      baseContext: null,
      baseModuleResults: null,
      change: null,
      clinicalCatalogDescriptor: descriptor,
      context,
    });

    expect(result.validation).toMatchObject({ clinicalCatalogDescriptor: descriptor });
    expect(result.validation.checks).toContain(
      "clinical_catalog_descriptor_exact_match",
    );
    await expect(
      runDeterministicEngine({
        baseContext: null,
        baseModuleResults: null,
        change: null,
        clinicalCatalogDescriptor: {
          ...descriptor,
          descriptorHash: "0".repeat(64),
        },
        context,
      }),
    ).rejects.toThrow("clinical_catalog_descriptor_mismatch");
  });

  it("usa AEMPS/CIMA como autoridad y no el nombre libre cuando existe aempsId", async () => {
    const clinicalContext = {
      ...context,
      answers: {
        ...context.answers,
        activeModules: ["hydration" as const],
        hasConditions: false,
        hasMedications: true,
        habitualWaterMl: 2_000,
        hydrationFluidRestriction: "none" as const,
        hydrationSweat: "low" as const,
        medications: [{ aempsId: "117251002", name: "Nombre manipulado" }],
      },
    };
    const canonicalIdentity = {
      activeIngredients: ["semaglutida"],
      administrationRoutes: ["VÍA SUBCUTÁNEA"],
      aempsId: "117251002",
      canonicalName: "OZEMPIC 0,25 MG SOLUCION INYECTABLE",
      commercialized: true,
      prescriptionRequired: true,
      retrievedAt: "2026-07-19T18:00:00.000Z",
      sourceHash: "ab".repeat(32),
      sourceVersion: "CIMA_REST_API_1_23" as const,
    };
    const resolved = await runDeterministicEngine({
      baseContext: null,
      baseModuleResults: null,
      canonicalMedicationIdentities: [canonicalIdentity],
      change: null,
      context: clinicalContext,
    });
    expect(resolved.safetyFindings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "GLP1_CONTEXT_PARTIAL" }),
      ]),
    );
    expect(resolved.validation).toMatchObject({
      medicationIdentityResolution: {
        declaredCount: 1,
        resolvedCount: 1,
        unresolvedCount: 0,
      },
    });
    expect(JSON.stringify(resolved)).not.toContain("Nombre manipulado");
    const refreshed = await runDeterministicEngine({
      baseContext: null,
      baseModuleResults: null,
      canonicalMedicationIdentities: [
        { ...canonicalIdentity, retrievedAt: "2026-07-20T18:00:00.000Z" },
      ],
      change: null,
      context: clinicalContext,
    });
    expect(refreshed.inputHash).toBe(resolved.inputHash);
    expect(refreshed.outputHash).toBe(resolved.outputHash);

    const unresolved = await runDeterministicEngine({
      baseContext: null,
      baseModuleResults: null,
      canonicalMedicationIdentities: [],
      change: null,
      context: {
        ...clinicalContext,
        answers: {
          ...clinicalContext.answers,
          medications: [{ aempsId: "117251002", name: "Semaglutida" }],
        },
      },
    });
    expect(unresolved.safetyFindings.map(({ code }) => code)).not.toContain(
      "GLP1_CONTEXT_PARTIAL",
    );
    expect(unresolved.safetyFindings.map(({ code }) => code)).toContain(
      "CLINICAL_CONTEXT_UNMODELED",
    );
    expect(unresolved.completeness).toBe("provisional");
  });

  it("conserva un snapshot histórico literal para replay de engine-v3", () => {
    expect(HISTORICAL_ENGINE_SNAPSHOT).toEqual({
      engineVersion: "engine-v3",
      ruleSetRevision: {
        id: "04edd58c-5fff-4f6b-85ad-472ec538885c",
        ruleRevisionIds: [
          "rule.module-selection@1.0.0",
          "rule.training-none@1.0.0",
          "rule.nutrition-targets@1.0.0",
          "rule.nutrition-substitutions@1.0.0",
          "rule.training-generated-block@1.0.0",
          "rule.training-declared-limitations@1.0.0",
          "rule.mobility-modular-duration@1.0.0",
        ],
        status: "active",
        version: "3.0.0",
      },
      sourceManifest: {
        id: "cb644399-1275-47de-86b6-195711946f66",
        sourceRevisionIds: [
          "source:who-physical-activity-guidelines-2020@1.0.0",
          "source:acsm-resistance-training-position-2026@1.0.0",
          "source:ingram-static-stretching-meta-analysis-2025@1.0.0",
        ],
        version: "core-with-training-mobility-v1",
      },
    });
  });

  it("conserva el snapshot T12 inicial sin mutar su revisión clínica 1.0.0", () => {
    expect(T12_INITIAL_ENGINE_SNAPSHOT).toMatchObject({
      engineVersion: "engine-v4",
      ruleSetRevision: {
        id: "a4b0f4bd-2bb9-4b79-98c3-22ad65b07f27",
        version: "4.2.0",
      },
      sourceManifest: {
        id: "c7aa1da4-2fa1-4e7b-86b4-5e03f44e7f4c",
        version: "core-with-training-mobility-hydration-sleep-supplements-v1",
      },
    });
    expect(T12_INITIAL_ENGINE_SNAPSHOT.ruleSetRevision.ruleRevisionIds).toContain(
      "rule.clinical-selective@1.0.0",
    );
    expect(T12_INITIAL_ENGINE_SNAPSHOT.ruleSetRevision.ruleRevisionIds).not.toContain(
      "rule.clinical-selective@2.0.0",
    );
  });

  it("una preferencia no puede reabrir una opción excluida por una obligatoria", () => {
    expect(
      resolveChoice({
        options: ["requested", "not_requested"],
        rules: [
          {
            actionLevel: "adjustment",
            allowed: ["not_requested"],
            id: "training.none",
            kind: "mandatory",
          },
          {
            actionLevel: "information",
            id: "training.selected",
            kind: "preferential",
            order: ["requested", "not_requested"],
          },
        ],
      }),
    ).toEqual({
      appliedRuleIds: ["training.none", "training.selected"],
      choice: "not_requested",
      options: ["not_requested"],
      strictestActionLevel: "adjustment",
      unresolvedRuleIds: [],
    });
  });

  it("conserva la condicional sin datos como incertidumbre y gana la acción estricta", () => {
    expect(
      resolveChoice({
        options: ["low", "high"],
        rules: [
          {
            actionLevel: "priority_review",
            active: null,
            allowed: ["low"],
            id: "conditional.missing",
            kind: "conditional",
          },
          {
            actionLevel: "immediate_conservative",
            allowed: ["low", "high"],
            id: "mandatory.safe",
            kind: "mandatory",
          },
        ],
      }),
    ).toMatchObject({
      choice: "low",
      strictestActionLevel: "immediate_conservative",
      unresolvedRuleIds: ["conditional.missing"],
    });
  });
});

describe("pipeline determinista T8", () => {
  it("devuelve los seis módulos y marca como provisionales solo los solicitados", async () => {
    const result = await runDeterministicEngine({
      baseContext: null,
      baseModuleResults: null,
      change: null,
      context,
    });

    expect(result.engineVersion).toBe(ENGINE_VERSION);
    expect(result.completeness).toBe("provisional");
    expect(result.validationStatus).toBe("valid");
    expect(result.validation).toMatchObject({ errors: [], warnings: [] });
    expect(result.safetyFindings).toEqual([]);
    expect(result.moduleResults.map(({ module }) => module)).toEqual([
      "nutrition",
      "training",
      "hydration",
      "sleep",
      "mobility",
      "supplements",
    ]);
    expect(
      result.moduleResults.find(({ module }) => module === "nutrition"),
    ).toMatchObject({ confidence: "unknown", status: "provisional" });
    expect(
      result.moduleResults.find(({ module }) => module === "hydration"),
    ).toMatchObject({ confidence: "medium", status: "provisional" });
    expect(
      result.moduleResults.find(({ module }) => module === "training"),
    ).toMatchObject({
      confidence: "high",
      payload: { reason: "training_disabled_by_user" },
      status: "not_requested",
    });
    expect(
      result.moduleResults.filter(({ status }) => status === "not_requested"),
    ).toHaveLength(4);
  });

  it("propaga un contexto provisional sin convertir módulos no solicitados", async () => {
    const result = await runDeterministicEngine({
      baseContext: null,
      baseModuleResults: null,
      change: null,
      context: { ...context, completeness: "provisional" },
    });

    expect(result.completeness).toBe("provisional");
    expect(result.validation.provisionalReasons).toContain(
      "context_snapshot_provisional",
    );
    expect(
      result.moduleResults.find(({ module }) => module === "training"),
    ).toMatchObject({ status: "not_requested" });
  });

  it("integra sueño seleccionado como contrato válido sin MODULE_PENDING", async () => {
    const result = await runDeterministicEngine({
      baseContext: null,
      baseModuleResults: null,
      change: null,
      context: {
        ...context,
        answers: {
          ...context.answers,
          activeModules: ["sleep"],
          sleepHours: 8,
          sleepQuality: "good",
          sleepRegularity: "regular",
        },
      },
    });

    const sleep = result.moduleResults.find(({ module }) => module === "sleep");
    expect(sleep).toMatchObject({ confidence: "high", status: "valid" });
    expect(SleepPlanSchema.parse(sleep?.payload)).toMatchObject({ status: "valid" });
    expect(
      result.moduleResults.flatMap(({ uncertainties }) => uncertainties),
    ).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "MODULE_IMPLEMENTATION_PENDING" }),
      ]),
    );
  });

  it("reconcilia hallazgos clínicos por cada módulo solicitado sin filtrar nombres", async () => {
    const result = await runDeterministicEngine({
      baseContext: null,
      baseModuleResults: null,
      change: null,
      context: {
        ...context,
        answers: {
          ...context.answers,
          activeModules: ["hydration", "sleep", "mobility"],
          conditions: [{ name: "Hipertensión" }],
          hasConditions: true,
          hasMedications: true,
          hydrationFluidRestriction: "none",
          hydrationSweat: "low",
          habitualWaterMl: 2_000,
          medications: [{ name: "Semaglutida" }],
          mobilityAreas: ["shoulders"],
          mobilityDiscomfortStatus: "none",
          mobilityMinutes: 5,
          pregnancyLactation: "pregnant",
          sleepHours: 8,
          sleepQuality: "good",
          sleepRegularity: "regular",
        },
      },
    });

    expect(result.safetyFindings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "HYPERTENSION_CONTEXT_PARTIAL",
          module: "sleep",
        }),
        expect.objectContaining({
          code: "GLP1_CONTEXT_PARTIAL",
          module: "hydration",
        }),
        expect.objectContaining({
          code: "PREGNANCY_CONTEXT_PARTIAL",
          module: "mobility",
        }),
      ]),
    );
    expect(JSON.stringify(result)).not.toContain("Semaglutida");
    expect(JSON.stringify(result)).not.toContain("Hipertensión");
    expect(PlanEngineResultSchema.parse(result)).toEqual(result);
    expect(result.completeness).toBe("provisional");
    expect(result.validation).toMatchObject({ completeness: "provisional" });
    expect(result.validation.provisionalReasons).toContain("clinical_context_partial");
  });

  it.each([
    ["sleep", { sleepHours: 8, sleepQuality: "good", sleepRegularity: "regular" }],
    [
      "hydration",
      {
        habitualWaterMl: 2_000,
        hydrationFluidRestriction: "none",
        hydrationSweat: "low",
      },
    ],
  ] as const)(
    "mantiene provisional un plan %s aislado ante embarazo parcial",
    async (module, moduleAnswers) => {
      const result = await runDeterministicEngine({
        baseContext: null,
        baseModuleResults: null,
        change: null,
        context: {
          ...context,
          answers: {
            ...context.answers,
            ...moduleAnswers,
            activeModules: [module],
            hasConditions: false,
            hasMedications: false,
            pregnancyLactation: "pregnant",
          },
        },
      });

      expect(result.completeness).toBe("provisional");
      expect(result.safetyFindings).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: "PREGNANCY_CONTEXT_PARTIAL", module }),
        ]),
      );
    },
  );

  it("produce hashes idénticos para Unicode equivalente y excluye timestamps volátiles", async () => {
    const first = await runDeterministicEngine({
      baseContext: null,
      baseModuleResults: null,
      change: null,
      context,
    });
    const second = await runDeterministicEngine({
      baseContext: null,
      baseModuleResults: null,
      change: null,
      context: {
        ...context,
        answers: {
          ...context.answers,
          preferredFoods: ["José"],
        },
        createdAt: "2028-01-01T00:00:00.000Z",
        effectiveAt: "2028-01-02T00:00:00.000Z",
      },
    });

    expect(second.inputHash).toBe(first.inputHash);
    expect(second.outputHash).toBe(first.outputHash);
  });

  it("rechaza como inválido un contexto sin módulos en vez de persistir un plan vacío", async () => {
    const result = await runDeterministicEngine({
      baseContext: null,
      baseModuleResults: null,
      change: null,
      context: { ...context, answers: { ...context.answers, activeModules: [] } },
    });

    expect(result.validationStatus).toBe("invalid");
    expect(result.validation).toMatchObject({ errors: ["modules_required"] });
    expect(result.moduleResults).toHaveLength(6);
  });

  it("recalcula solo módulos afectados y conserva literalmente los demás", async () => {
    const baseModuleResults = [
      {
        confidence: "high" as const,
        module: "nutrition" as const,
        payload: { marker: "base-nutrition" },
        status: "valid" as const,
        uncertainties: [],
      },
      {
        confidence: "high" as const,
        module: "training" as const,
        payload: { marker: "base-training" },
        status: "not_requested" as const,
        uncertainties: [],
      },
      {
        confidence: "high" as const,
        module: "hydration" as const,
        payload: { marker: "base-hydration" },
        status: "valid" as const,
        uncertainties: [],
      },
      {
        confidence: "high" as const,
        module: "sleep" as const,
        payload: { marker: "base-sleep" },
        status: "not_requested" as const,
        uncertainties: [],
      },
      {
        confidence: "high" as const,
        module: "mobility" as const,
        payload: { marker: "base-mobility" },
        status: "not_requested" as const,
        uncertainties: [],
      },
      {
        confidence: "high" as const,
        module: "supplements" as const,
        payload: { marker: "base-supplements" },
        status: "not_requested" as const,
        uncertainties: [],
      },
    ];
    const result = await runDeterministicEngine({
      baseContext: { ...context, inputHash: hash("12") },
      baseModuleResults,
      change: {
        affectedModules: ["nutrition"],
        changedFields: ["mealsPerDay"],
        impact: "module_only",
      },
      context: { ...context, answers: { ...context.answers, mealsPerDay: 5 } },
    });

    expect(
      result.moduleResults.find(({ module }) => module === "nutrition"),
    ).not.toEqual(baseModuleResults[0]);
    expect(result.moduleResults.find(({ module }) => module === "hydration")).toEqual(
      baseModuleResults[2],
    );
    expect(result.moduleResults.slice(1)).toEqual(baseModuleResults.slice(1));
    expect(result.validation).toMatchObject({
      preservedModules: ["training", "hydration", "sleep", "mobility", "supplements"],
      recalculatedModules: ["nutrition"],
    });
  });

  it("preserva sueño literalmente cuando cambia solo nutrición", async () => {
    const sleepBase = {
      confidence: "high" as const,
      module: "sleep" as const,
      payload: { marker: "base-sleep" },
      status: "valid" as const,
      uncertainties: [],
    };
    const result = await runDeterministicEngine({
      baseContext: {
        ...context,
        answers: {
          ...context.answers,
          activeModules: ["nutrition", "sleep"],
          sleepHours: 8,
          sleepQuality: "good",
          sleepRegularity: "regular",
        },
      },
      baseModuleResults: [sleepBase],
      change: {
        affectedModules: ["nutrition"],
        changedFields: ["mealsPerDay"],
        impact: "module_only",
      },
      context: {
        ...context,
        answers: {
          ...context.answers,
          activeModules: ["nutrition", "sleep"],
          mealsPerDay: 5,
          sleepHours: 7,
          sleepQuality: "poor",
          sleepRegularity: "very_variable",
        },
      },
    });

    expect(result.moduleResults.find(({ module }) => module === "sleep")).toBe(
      sleepBase,
    );
    expect(result.validation.preservedModules).toContain("sleep");
  });
});
