import {
  HydrationPlanSchema,
  SleepPlanSchema,
  SupplementsPlanSchema,
  type HydrationPlanContract,
  type PlanVersionDetail,
  type SleepPlanContract,
  type SupplementsPlanContract,
} from "@health-design/contracts";

type WellnessModule = "hydration" | "sleep" | "supplements";
type WellnessModuleStatus = PlanVersionDetail["moduleResults"][number]["status"];

export type WellnessModules = Readonly<{
  hydration: HydrationPlanContract | undefined;
  invalidModules: WellnessModule[];
  moduleStatuses: Record<WellnessModule, WellnessModuleStatus | undefined>;
  moduleUncertainties: Record<WellnessModule, unknown[]>;
  safetyFindings: PlanVersionDetail["safetyFindings"];
  sleep: SleepPlanContract | undefined;
  supplements: SupplementsPlanContract | undefined;
  validationBlocked: boolean;
}>;

const uncertaintyLabels: Readonly<Record<string, string>> = {
  ANABOLIC_CONTEXT_PARTIAL:
    "El contexto hormonal declarado necesita una revisión conservadora.",
  CAFFEINE_SLEEP_REDUCTION_STRATEGY:
    "La cafeína no se plantea mientras pueda empeorar el descanso.",
  CLINICAL_CONTEXT_UNMODELED:
    "Parte del contexto clínico todavía no está modelada con confianza suficiente.",
  CLINICAL_CONTEXT_PARTIAL:
    "El contexto clínico reduce la confianza y requiere una revisión conservadora.",
  CLINICAL_COVERAGE_PARTIAL_OR_UNMODELED:
    "La cobertura clínica es parcial y requiere revisar la propuesta.",
  CLINICAL_FLUID_LIMIT_MISSING:
    "Falta un límite individual de líquidos para formular una banda operativa.",
  CONDITIONS_CONFIRMATION_MISSING:
    "Falta confirmar si existen condiciones clínicas relevantes.",
  CONDITIONS_DETAILS_MISSING:
    "Faltan detalles de una condición declarada que puede cambiar el plan.",
  CREATINE_BLOCKED_BY_CLINICAL_OR_RENAL_UNCERTAINTY:
    "La creatina no queda como candidata mientras exista incertidumbre clínica o renal.",
  CURRENT_SUPPLEMENTS_CONFIRMATION_CONFLICT:
    "La confirmación y el listado de suplementos actuales no coinciden.",
  CURRENT_SUPPLEMENTS_DETAILS_MISSING:
    "Falta detallar el contexto de suplementos actuales.",
  ELECTROLYTES_CLINICAL_OVERRIDE:
    "La revisión clínica prevalece sobre una propuesta genérica de electrolitos.",
  FLUID_LIMIT_NOT_PROVIDED:
    "Falta un límite individual de líquidos para formular una banda operativa.",
  FLUID_RESTRICTION_STATUS_UNKNOWN:
    "Falta confirmar si existe una restricción de líquidos.",
  GLP1_CONTEXT_PARTIAL:
    "El tratamiento declarado modifica el contexto, pero no se ajusta desde esta herramienta.",
  HABITUAL_WATER_MISSING: "Falta indicar la cantidad habitual de agua.",
  HYDRATION_SWEAT_MISSING: "Falta indicar el nivel habitual de sudoración.",
  MEDICATIONS_CONFIRMATION_MISSING: "Falta confirmar si existe medicación relevante.",
  MEDICATIONS_DETAILS_MISSING:
    "Faltan detalles de una medicación declarada que puede cambiar el plan.",
  PREGNANCY_LACTATION_STATUS_UNKNOWN:
    "Falta confirmar el contexto de embarazo o lactancia cuando corresponde.",
  PREGNANCY_OR_LACTATION_CONTEXT_REQUIRES_REVIEW:
    "El contexto de embarazo o lactancia requiere revisión antes de probar suplementos.",
  RELEVANT_LAB_INCOMPLETE:
    "Una analítica relevante está incompleta y no se usa para recomendar.",
  RENAL_LAB_CONTEXT_REQUIRES_REVIEW:
    "Un valor renal aportado requiere revisión antes de probar suplementos.",
  RETATRUTIDE_CONTEXT_UNMODELED:
    "El tratamiento declarado aún no tiene una regla suficientemente modelada.",
  SEX_REFERENCE_UNAVAILABLE:
    "Falta una referencia fisiológica necesaria para estimar el agua total.",
  SLEEP_HOURS_MISSING: "Falta el promedio habitual de horas de sueño.",
  SLEEP_QUALITY_MISSING: "Falta indicar la calidad percibida del sueño.",
  SLEEP_REGULARITY_MISSING: "Falta indicar la regularidad del horario de sueño.",
  SUPPLEMENT_CONTEXT_MISSING:
    "Falta contexto suficiente para formular recomendaciones de suplementación.",
};

const findingLabels: Readonly<Record<string, string>> = {
  ANABOLIC_CONTEXT_PARTIAL:
    "El contexto hormonal solo puede desplazar una banda ya segura; nunca suma una cantidad fija.",
  ANTICOAGULANT_CONTEXT_PARTIAL:
    "La medicación declarada exige revisar interacciones antes de probar suplementos.",
  CARDIAC_CONTEXT_PARTIAL:
    "El contexto clínico requiere un límite individual antes de formular una banda de bebidas.",
  CLINICAL_CONTEXT_UNMODELED:
    "Una parte del contexto clínico no está modelada y se mantiene conservadora.",
  DIURETIC_CONTEXT_PARTIAL:
    "La medicación declarada impide aplicar una regla genérica de hidratación.",
  FLUID_RESTRICTION_ACTIVE:
    "La restricción de líquidos prevalece sobre cualquier referencia general.",
  GLP1_CONTEXT_PARTIAL:
    "El tratamiento declarado se usa como contexto; esta herramienta no lo modifica.",
  HYPERTENSION_CONTEXT_PARTIAL:
    "El objetivo de sodio necesita revisión contextual y no se da por verificado.",
  HYPONATREMIA_CONTEXT_PARTIAL:
    "El contexto clínico impide proponer más agua o electrolitos de forma genérica.",
  LACTATION_CONTEXT_PARTIAL:
    "La lactancia requiere una revisión específica antes de probar suplementos.",
  MAGNESIUM_INTERACTION_PARTIAL:
    "Existe una posible interacción que requiere revisar el magnesio antes de probarlo.",
  MENOPAUSE_CONTEXT_PARTIAL:
    "El contexto menopáusico se considera sin convertirlo en una recomendación automática.",
  PREGNANCY_CONTEXT_PARTIAL:
    "El embarazo requiere una revisión específica antes de probar suplementos.",
  PRECONCEPTION_CONTEXT_PARTIAL:
    "El contexto preconcepcional se revisa con reglas específicas y conservadoras.",
  RENAL_CONTEXT_PARTIAL:
    "El contexto renal requiere un límite individual antes de formular una banda o suplemento.",
  RETATRUTIDE_CONTEXT_UNMODELED:
    "El tratamiento declarado aún no tiene cobertura suficiente para una adaptación específica.",
};

export function wellnessUncertaintyLabel(code: string): string {
  return (
    uncertaintyLabels[code.toLocaleUpperCase("es-ES")] ??
    "Existe una incertidumbre no categorizada que requiere revisión."
  );
}

export function clinicalFindingLabel(code: string): string {
  return (
    findingLabels[code] ??
    "Existe una restricción clínica no categorizada que requiere revisión."
  );
}

const supplementNames: Readonly<Record<string, string>> = {
  ashwagandha: "Ashwagandha",
  beta_alanine: "Beta-alanina",
  caffeine_performance: "Cafeína",
  creatine_monohydrate: "Creatina monohidrato",
  electrolytes_contextual: "Electrolitos",
  fat_burners: "Quemagrasas",
  folic_acid_preconception: "Ácido fólico preconcepcional",
  glycine: "Glicina",
  l_theanine: "L-teanina",
  magnesium_context: "Magnesio",
  melatonin_sleep_context: "Melatonina",
  omega_3_epa_dha: "Omega-3 (EPA/DHA)",
  opaque_blends: "Mezclas de composición opaca",
  peptides: "Péptidos",
  sarms: "SARMs",
  testosterone_boosters: "Potenciadores de testosterona",
  vitamin_b12: "Vitamina B12",
};

export function supplementDisplayName(id: string): string {
  return supplementNames[id] ?? "Opción no identificada";
}

export function readWellnessModules(
  detail: Pick<
    PlanVersionDetail,
    "moduleResults" | "safetyFindings" | "validationStatus"
  >,
): WellnessModules {
  const invalidModules: WellnessModule[] = [];
  const moduleStatuses: Record<WellnessModule, WellnessModuleStatus | undefined> = {
    hydration: undefined,
    sleep: undefined,
    supplements: undefined,
  };
  const moduleUncertainties: Record<WellnessModule, unknown[]> = {
    hydration: [],
    sleep: [],
    supplements: [],
  };
  const wellnessResults = detail.moduleResults.filter(
    (item): item is typeof item & { module: WellnessModule } =>
      item.module === "hydration" ||
      item.module === "sleep" ||
      item.module === "supplements",
  );
  for (const result of wellnessResults) {
    moduleStatuses[result.module] = result.status;
    moduleUncertainties[result.module] = result.uncertainties;
  }
  if (detail.validationStatus === "invalid") {
    invalidModules.push(...wellnessResults.map(({ module }) => module));
    return {
      hydration: undefined,
      invalidModules,
      moduleStatuses,
      moduleUncertainties,
      safetyFindings: [],
      sleep: undefined,
      supplements: undefined,
      validationBlocked: true,
    };
  }
  const read = <T>(
    module: WellnessModule,
    parse: { safeParse(value: unknown): { success: boolean; data?: T } },
  ): T | undefined => {
    const result = detail.moduleResults.find((item) => item.module === module);
    if (!result) return undefined;
    if (result.status === "invalid") {
      invalidModules.push(module);
      return undefined;
    }
    const parsed = parse.safeParse(result.payload);
    if (!parsed.success || parsed.data === undefined) {
      invalidModules.push(module);
      return undefined;
    }
    return parsed.data;
  };

  return {
    hydration: read("hydration", HydrationPlanSchema),
    invalidModules,
    moduleStatuses,
    moduleUncertainties,
    safetyFindings: detail.safetyFindings,
    sleep: read("sleep", SleepPlanSchema),
    supplements: read("supplements", SupplementsPlanSchema),
    validationBlocked: false,
  };
}
