import { z } from "zod";

import {
  evaluateQuestionnaire as evaluateDomainQuestionnaire,
  OBJECTIVE_IDS,
  QUESTIONNAIRE_BLOCK_IDS,
  QUESTIONNAIRE_MODULES,
  QUESTIONNAIRE_SCHEMA_VERSION,
} from "@health-design/domain";

const segmenter = new Intl.Segmenter("es", { granularity: "grapheme" });
const graphemeLength = (value: string) => [...segmenter.segment(value)].length;
const limitedText = (maximum: number) =>
  z
    .string()
    .trim()
    .min(1)
    .refine((value) => graphemeLength(value) <= maximum, "too_many_graphemes");

const SearchTextSchema = limitedText(120);
const BriefTextSchema = limitedText(500);
const ClockTimeSchema = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);
const StringListSchema = z.array(SearchTextSchema).max(50);

const NamedEntrySchema = z
  .object({
    name: SearchTextSchema,
    note: BriefTextSchema.optional(),
  })
  .strict();

const MedicationEntrySchema = NamedEntrySchema.extend({
  dose: SearchTextSchema.optional(),
  frequency: SearchTextSchema.optional(),
  route: SearchTextSchema.optional(),
  schedule: SearchTextSchema.optional(),
}).strict();

const IntoleranceEntrySchema = NamedEntrySchema.extend({
  severity: z.enum(["mild", "moderate", "severe"]),
  toleratedAmount: SearchTextSchema.optional(),
}).strict();

const LabValueEntrySchema = z
  .object({
    dateApproximate: SearchTextSchema,
    name: SearchTextSchema,
    referenceRange: SearchTextSchema.optional(),
    source: z.enum(["laboratory", "device", "self_reported"]).optional(),
    unit: SearchTextSchema,
    value: SearchTextSchema,
  })
  .strict();

export const QuestionnaireModuleSchema = z.enum(QUESTIONNAIRE_MODULES);
export const QuestionnaireBlockIdSchema = z.enum(QUESTIONNAIRE_BLOCK_IDS);
export const ObjectiveIdSchema = z.enum(OBJECTIVE_IDS);
type QuestionnaireBlockId = z.infer<typeof QuestionnaireBlockIdSchema>;

const QuestionnaireAnswersObjectSchema = z
  .object({
    activeModules: z
      .array(QuestionnaireModuleSchema)
      .max(QUESTIONNAIRE_MODULES.length)
      .optional(),
    activityLevel: z
      .enum(["sedentary", "light", "moderate", "high", "very_high"])
      .optional(),
    age: z.number().int().min(18).max(120).optional(),
    conditions: z.array(NamedEntrySchema).max(50).optional(),
    compareSupermarkets: z.boolean().optional(),
    country: z.literal("ES").optional(),
    currentSupplements: z.array(MedicationEntrySchema).max(50).optional(),
    dailySchedule: z.enum(["regular", "variable", "shift_work"]).optional(),
    excludedFoods: StringListSchema.optional(),
    generatedTrainingDaysPerWeek: z.number().int().min(1).max(7).optional(),
    generatedTrainingEquipment: StringListSchema.optional(),
    generatedTrainingSessionMinutes: z.number().int().min(10).max(240).optional(),
    generatedTrainingStyles: StringListSchema.optional(),
    hasConditions: z.boolean().optional(),
    hasCurrentSupplements: z.boolean().optional(),
    hasLabValues: z.boolean().optional(),
    hasMedications: z.boolean().optional(),
    habitualBeverages: StringListSchema.optional(),
    habitualWaterMl: z.number().int().min(0).max(10_000).optional(),
    heightCm: z.number().min(100).max(250).optional(),
    hydrationAnchors: StringListSchema.optional(),
    hydrationClimate: z.enum(["temperate", "hot", "cold", "variable"]).optional(),
    hydrationReminders: z.boolean().optional(),
    hydrationSweat: z.enum(["low", "medium", "high", "unknown"]).optional(),
    labValues: z.array(LabValueEntrySchema).max(50).optional(),
    mealsPerDay: z.number().int().min(2).max(6).optional(),
    medications: z.array(MedicationEntrySchema).max(50).optional(),
    menopauseStage: z
      .enum(["not_applicable", "pre", "peri", "post", "unknown"])
      .optional(),
    mobilityAreas: StringListSchema.optional(),
    mobilityDiscomfortDetails: StringListSchema.optional(),
    mobilityDiscomfortStatus: z.enum(["none", "declared", "unknown"]).optional(),
    mobilityMinutes: z.union([z.literal(5), z.literal(10), z.literal(15)]).optional(),
    nutritionAllergies: z.array(NamedEntrySchema).max(50).optional(),
    nutritionAllergiesStatus: z.enum(["none", "declared", "unknown"]).optional(),
    nutritionFoodAnxiety: z
      .enum(["no", "sometimes", "frequent", "prefer_not_to_say"])
      .optional(),
    nutritionIntolerances: z.array(IntoleranceEntrySchema).max(50).optional(),
    nutritionIntolerancesStatus: z.enum(["none", "declared", "unknown"]).optional(),
    ownTrainingDaysPerWeek: z.number().int().min(1).max(7).optional(),
    ownTrainingIntensity: z.enum(["low", "moderate", "high", "variable"]).optional(),
    ownTrainingSessionMinutes: z.number().int().min(5).max(480).optional(),
    ownTrainingTypes: StringListSchema.optional(),
    physiologicalSex: z
      .enum(["female", "male", "intersex", "prefer_not_to_say"])
      .optional(),
    pregnancyLactation: z
      .enum([
        "not_applicable",
        "none",
        "pregnant",
        "lactating",
        "trying_to_conceive",
        "unknown",
      ])
      .optional(),
    preferredFoods: StringListSchema.optional(),
    preferredSupermarket: SearchTextSchema.optional(),
    primaryObjective: ObjectiveIdSchema.optional(),
    proteinPreference: z
      .enum(["food_only", "usual_powder", "optional_substitution"])
      .optional(),
    secondaryObjectives: z.array(ObjectiveIdSchema).max(2).optional(),
    sleepBedTime: ClockTimeSchema.optional(),
    sleepDeepMinutes: z.number().int().min(0).max(1_440).optional(),
    sleepHours: z.number().min(0).max(24).optional(),
    sleepLightMinutes: z.number().int().min(0).max(1_440).optional(),
    sleepQuality: z.enum(["very_poor", "poor", "fair", "good", "very_good"]).optional(),
    sleepRegularity: z
      .enum(["regular", "somewhat_variable", "very_variable"])
      .optional(),
    sleepRemMinutes: z.number().int().min(0).max(1_440).optional(),
    sleepTracking: z.boolean().optional(),
    sleepWakeTime: ClockTimeSchema.optional(),
    supplementGoals: StringListSchema.optional(),
    supplementRecommendationPreference: z
      .enum(["only_deficiencies", "contextual", "none"])
      .optional(),
    targetWeightKg: z.number().min(30).max(400).optional(),
    trainingLimitations: StringListSchema.optional(),
    trainingLimitationsStatus: z.enum(["none", "declared", "unknown"]).optional(),
    trainingMode: z.enum(["generated", "own", "none"]).optional(),
    weightKg: z.number().min(30).max(400).optional(),
  })
  .strict();

export const QuestionnaireAnswersSchema = QuestionnaireAnswersObjectSchema;
type QuestionnaireAnswers = z.infer<typeof QuestionnaireAnswersSchema>;

const QuestionnaireUncertaintySchema = z
  .object({
    affectedModules: z.array(QuestionnaireModuleSchema).min(1),
    answerId: z.string().min(1).max(80),
    blockId: QuestionnaireBlockIdSchema,
    reason: z.string().min(1).max(120),
  })
  .strict();

const QuestionnaireHardErrorSchema = z
  .object({
    answerId: z.enum(["activeModules", "primaryObjective", "secondaryObjectives"]),
    code: z.enum([
      "modules_required",
      "primary_objective_required",
      "secondary_objectives_limit",
    ]),
  })
  .strict();

export type QuestionnaireEvaluation = {
  completeness: "complete" | "provisional";
  hardErrors: Array<z.infer<typeof QuestionnaireHardErrorSchema>>;
  uncertainties: Array<z.infer<typeof QuestionnaireUncertaintySchema>>;
};

export function evaluateQuestionnaire(
  answers: QuestionnaireAnswers,
): QuestionnaireEvaluation {
  return evaluateDomainQuestionnaire(answers);
}

const UniqueConfirmedBlocksSchema = z
  .array(QuestionnaireBlockIdSchema)
  .max(QUESTIONNAIRE_BLOCK_IDS.length)
  .refine((ids) => new Set(ids).size === ids.length, "duplicate_block");

export const QuestionnaireDraftSaveRequestSchema = z
  .object({
    answers: QuestionnaireAnswersSchema,
    confirmedBlockIds: UniqueConfirmedBlocksSchema,
    currentBlockId: QuestionnaireBlockIdSchema,
    expectedVersion: z.number().int().min(0),
    schemaVersion: z.literal(QUESTIONNAIRE_SCHEMA_VERSION),
  })
  .strict();

export const QuestionnaireDraftSubmitRequestSchema = z
  .object({
    expectedVersion: z.number().int().min(1),
    schemaVersion: z.literal(QUESTIONNAIRE_SCHEMA_VERSION),
  })
  .strict();

export const QuestionnaireDraftAckSchema = z
  .object({
    completeness: z.enum(["complete", "provisional"]),
    confirmedBlockIds: UniqueConfirmedBlocksSchema,
    currentBlockId: QuestionnaireBlockIdSchema,
    hardErrors: z.array(QuestionnaireHardErrorSchema),
    profileId: z.uuid(),
    schemaVersion: z.literal(QUESTIONNAIRE_SCHEMA_VERSION),
    status: z.enum(["editing", "submitted"]),
    uncertainties: z.array(QuestionnaireUncertaintySchema).max(100),
    updatedAt: z.iso.datetime({ offset: true }),
    version: z.number().int().min(1),
  })
  .strict();

export const QuestionnaireDraftSchema = QuestionnaireDraftAckSchema.extend({
  answers: QuestionnaireAnswersSchema,
  id: z.uuid(),
}).strict();

export type QuestionnaireDraftSaveRequest = z.infer<
  typeof QuestionnaireDraftSaveRequestSchema
>;
export type QuestionnaireDraftSubmitRequest = z.infer<
  typeof QuestionnaireDraftSubmitRequestSchema
>;
export type QuestionnaireDraftAck = z.infer<typeof QuestionnaireDraftAckSchema>;
export type QuestionnaireDraft = z.infer<typeof QuestionnaireDraftSchema>;

type Option = { label: string; value: string };
type PublicQuestion = {
  blockId: QuestionnaireBlockId;
  id: keyof QuestionnaireAnswers;
  kind: "boolean" | "entities" | "multi" | "number" | "single" | "text" | "time";
  label: string;
  options?: Option[];
  visibleWhen?: {
    answerId: keyof QuestionnaireAnswers;
    includes: boolean | string | string[];
  };
};

type PublicBlock = {
  estimatedMinutes: number;
  id: QuestionnaireBlockId;
  title: string;
};

const options = (entries: ReadonlyArray<readonly [string, string]>): Option[] =>
  entries.map(([value, label]) => ({ label, value }));

const moduleOptions = options([
  ["nutrition", "Alimentación"],
  ["training", "Entrenamiento"],
  ["hydration", "Hidratación"],
  ["sleep", "Sueño y descanso"],
  ["mobility", "Movilidad y estiramiento"],
  ["supplements", "Suplementación"],
]);

const objectiveOptions = options([
  ["body_composition_lose_fat", "Perder grasa"],
  ["body_composition_gain_muscle", "Aumentar masa muscular"],
  ["body_composition_recomposition", "Recomposición corporal"],
  ["body_composition_maintain", "Mantener composición"],
  ["performance_strength", "Mejorar fuerza"],
  ["performance_hypertrophy", "Mejorar hipertrofia"],
  ["performance_endurance", "Mejorar resistencia"],
  ["performance_general_fitness", "Mejorar condición general"],
  ["wellbeing_sleep", "Mejorar descanso"],
  ["wellbeing_energy", "Mejorar energía"],
  ["wellbeing_stress", "Gestionar estrés"],
  ["wellbeing_healthy_habits", "Consolidar hábitos saludables"],
]);

const foodSuggestions = options([
  ["Arroz", "Arroz"],
  ["Avena", "Avena"],
  ["Pan integral", "Pan integral"],
  ["Patata", "Patata"],
  ["Pasta", "Pasta"],
  ["Pollo", "Pollo"],
  ["Pavo", "Pavo"],
  ["Huevos", "Huevos"],
  ["Salmón", "Salmón"],
  ["Atún", "Atún"],
  ["Tofu", "Tofu"],
  ["Lentejas", "Lentejas"],
  ["Garbanzos", "Garbanzos"],
  ["Leche", "Leche"],
  ["Yogur", "Yogur"],
  ["Manzana", "Manzana"],
  ["Plátano", "Plátano"],
  ["Frutos secos", "Frutos secos"],
  ["Verduras", "Verduras"],
]);

const conditionSuggestions = options([
  ["Hipertensión", "Hipertensión"],
  ["Diabetes tipo 2", "Diabetes tipo 2"],
  ["Hipotiroidismo", "Hipotiroidismo"],
  ["Dislipidemia", "Dislipidemia"],
  ["Celiaquía", "Celiaquía"],
  ["Enfermedad renal", "Enfermedad renal"],
  ["Hígado graso", "Hígado graso"],
  ["Síndrome de ovario poliquístico", "Síndrome de ovario poliquístico"],
  ["Osteoporosis", "Osteoporosis"],
]);

const medicationSuggestions = options([
  ["Metformina", "Metformina"],
  ["Levotiroxina", "Levotiroxina"],
  ["Losartán", "Losartán"],
  ["Atorvastatina", "Atorvastatina"],
  ["Sertralina", "Sertralina"],
  ["Semaglutida", "Semaglutida"],
  ["Tirzepatida", "Tirzepatida"],
  ["Testosterona", "Testosterona"],
]);

const supplementSuggestions = options([
  ["Creatina monohidrato", "Creatina monohidrato"],
  ["Omega-3", "Omega-3"],
  ["Vitamina D", "Vitamina D"],
  ["Vitamina B12", "Vitamina B12"],
  ["Magnesio", "Magnesio"],
  ["Melatonina", "Melatonina"],
  ["Zinc", "Zinc"],
  ["Proteína en polvo", "Proteína en polvo"],
]);

const labSuggestions = options([
  ["Hemoglobina", "Hemoglobina"],
  ["Hematocrito", "Hematocrito"],
  ["Glucosa", "Glucosa"],
  ["HbA1c", "HbA1c"],
  ["Colesterol LDL", "Colesterol LDL"],
  ["Colesterol HDL", "Colesterol HDL"],
  ["Triglicéridos", "Triglicéridos"],
  ["Creatinina", "Creatinina"],
  ["Ferritina", "Ferritina"],
  ["Vitamina D", "Vitamina D"],
  ["TSH", "TSH"],
]);

const supermarketSuggestions = options([
  ["Mercadona", "Mercadona"],
  ["Lidl", "Lidl"],
  ["DIA", "DIA"],
  ["Carrefour", "Carrefour"],
  ["Alcampo", "Alcampo"],
]);

const questions: PublicQuestion[] = [
  { blockId: "core", id: "age", kind: "number", label: "Edad" },
  {
    blockId: "core",
    id: "physiologicalSex",
    kind: "single",
    label: "Sexo fisiológico",
    options: options([
      ["female", "Femenino"],
      ["male", "Masculino"],
      ["intersex", "Intersexual"],
      ["prefer_not_to_say", "Prefiero no indicarlo"],
    ]),
  },
  { blockId: "core", id: "heightCm", kind: "number", label: "Altura (cm)" },
  { blockId: "core", id: "weightKg", kind: "number", label: "Peso (kg)" },
  {
    blockId: "core",
    id: "activityLevel",
    kind: "single",
    label: "Actividad cotidiana",
    options: options([
      ["sedentary", "Sedentaria"],
      ["light", "Ligera"],
      ["moderate", "Moderada"],
      ["high", "Alta"],
      ["very_high", "Muy alta"],
    ]),
  },
  {
    blockId: "core",
    id: "dailySchedule",
    kind: "single",
    label: "Horario habitual",
    options: options([
      ["regular", "Regular"],
      ["variable", "Variable"],
      ["shift_work", "Trabajo a turnos"],
    ]),
  },
  {
    blockId: "goals",
    id: "primaryObjective",
    kind: "single",
    label: "Objetivo principal",
    options: objectiveOptions,
  },
  {
    blockId: "goals",
    id: "secondaryObjectives",
    kind: "multi",
    label: "Objetivos secundarios",
    options: objectiveOptions,
  },
  {
    blockId: "goals",
    id: "targetWeightKg",
    kind: "number",
    label: "Peso objetivo (kg)",
    visibleWhen: {
      answerId: "primaryObjective",
      includes: ["body_composition_lose_fat", "body_composition_gain_muscle"],
    },
  },
  {
    blockId: "modules",
    id: "activeModules",
    kind: "multi",
    label: "Módulos del plan",
    options: moduleOptions,
  },
  {
    blockId: "training",
    id: "trainingMode",
    kind: "single",
    label: "Relación actual con el entrenamiento",
    options: options([
      ["generated", "Quiero una rutina generada"],
      ["own", "Ya sigo un entrenamiento propio"],
      ["none", "No realizo entrenamiento"],
    ]),
  },
  { blockId: "nutrition", id: "mealsPerDay", kind: "number", label: "Comidas al día" },
  {
    blockId: "nutrition",
    id: "nutritionAllergiesStatus",
    kind: "single",
    label: "Alergias y contaminación cruzada",
  },
  {
    blockId: "nutrition",
    id: "nutritionAllergies",
    kind: "entities",
    label: "Alergias declaradas",
    options: foodSuggestions,
    visibleWhen: { answerId: "nutritionAllergiesStatus", includes: "declared" },
  },
  {
    blockId: "nutrition",
    id: "nutritionIntolerancesStatus",
    kind: "single",
    label: "Intolerancias",
  },
  {
    blockId: "nutrition",
    id: "nutritionIntolerances",
    kind: "entities",
    label: "Intolerancias declaradas",
    options: foodSuggestions,
    visibleWhen: { answerId: "nutritionIntolerancesStatus", includes: "declared" },
  },
  {
    blockId: "nutrition",
    id: "preferredFoods",
    kind: "entities",
    label: "Alimentos preferidos",
    options: foodSuggestions,
  },
  {
    blockId: "nutrition",
    id: "excludedFoods",
    kind: "entities",
    label: "Alimentos que no quieres",
    options: foodSuggestions,
  },
  {
    blockId: "nutrition",
    id: "nutritionFoodAnxiety",
    kind: "single",
    label: "Ansiedad alimentaria",
  },
  {
    blockId: "nutrition",
    id: "proteinPreference",
    kind: "single",
    label: "Preferencia de proteína",
  },
  {
    blockId: "nutrition",
    id: "preferredSupermarket",
    kind: "text",
    label: "Supermercado habitual (opcional)",
    options: supermarketSuggestions,
  },
  {
    blockId: "nutrition",
    id: "compareSupermarkets",
    kind: "boolean",
    label: "Comparar precios con otros supermercados",
  },
  {
    blockId: "training",
    id: "generatedTrainingStyles",
    kind: "multi",
    label: "Estilos preferidos",
    visibleWhen: { answerId: "trainingMode", includes: "generated" },
  },
  {
    blockId: "training",
    id: "generatedTrainingDaysPerWeek",
    kind: "number",
    label: "Días disponibles",
    visibleWhen: { answerId: "trainingMode", includes: "generated" },
  },
  {
    blockId: "training",
    id: "generatedTrainingSessionMinutes",
    kind: "number",
    label: "Minutos por sesión",
    visibleWhen: { answerId: "trainingMode", includes: "generated" },
  },
  {
    blockId: "training",
    id: "generatedTrainingEquipment",
    kind: "multi",
    label: "Equipamiento disponible",
    visibleWhen: { answerId: "trainingMode", includes: "generated" },
  },
  {
    blockId: "training",
    id: "ownTrainingTypes",
    kind: "multi",
    label: "Tipo de entrenamiento propio",
    visibleWhen: { answerId: "trainingMode", includes: "own" },
  },
  {
    blockId: "training",
    id: "ownTrainingDaysPerWeek",
    kind: "number",
    label: "Días de entrenamiento propio",
    visibleWhen: { answerId: "trainingMode", includes: "own" },
  },
  {
    blockId: "training",
    id: "ownTrainingSessionMinutes",
    kind: "number",
    label: "Duración del entrenamiento propio",
    visibleWhen: { answerId: "trainingMode", includes: "own" },
  },
  {
    blockId: "training",
    id: "ownTrainingIntensity",
    kind: "single",
    label: "Intensidad del entrenamiento propio",
    visibleWhen: { answerId: "trainingMode", includes: "own" },
  },
  {
    blockId: "training",
    id: "trainingLimitationsStatus",
    kind: "single",
    label: "Limitaciones para entrenar",
  },
  {
    blockId: "training",
    id: "trainingLimitations",
    kind: "entities",
    label: "Limitaciones declaradas",
    visibleWhen: { answerId: "trainingLimitationsStatus", includes: "declared" },
  },
  {
    blockId: "hydration",
    id: "habitualWaterMl",
    kind: "number",
    label: "Agua habitual al día (ml)",
  },
  {
    blockId: "hydration",
    id: "habitualBeverages",
    kind: "multi",
    label: "Bebidas habituales",
  },
  {
    blockId: "hydration",
    id: "hydrationClimate",
    kind: "single",
    label: "Clima habitual",
  },
  {
    blockId: "hydration",
    id: "hydrationSweat",
    kind: "single",
    label: "Sudoración percibida",
  },
  {
    blockId: "hydration",
    id: "hydrationAnchors",
    kind: "multi",
    label: "Anclajes diarios",
  },
  {
    blockId: "hydration",
    id: "hydrationReminders",
    kind: "boolean",
    label: "Activar recordatorios",
  },
  { blockId: "sleep", id: "sleepHours", kind: "number", label: "Horas de sueño" },
  {
    blockId: "sleep",
    id: "sleepBedTime",
    kind: "time",
    label: "Hora habitual de acostarte",
  },
  {
    blockId: "sleep",
    id: "sleepWakeTime",
    kind: "time",
    label: "Hora habitual de levantarte",
  },
  {
    blockId: "sleep",
    id: "sleepRegularity",
    kind: "single",
    label: "Regularidad del sueño",
  },
  { blockId: "sleep", id: "sleepQuality", kind: "single", label: "Calidad percibida" },
  {
    blockId: "sleep",
    id: "sleepTracking",
    kind: "boolean",
    label: "Tengo mediciones de fases",
  },
  {
    blockId: "sleep",
    id: "sleepRemMinutes",
    kind: "number",
    label: "Sueño REM estimado (min)",
    visibleWhen: { answerId: "sleepTracking", includes: true },
  },
  {
    blockId: "sleep",
    id: "sleepDeepMinutes",
    kind: "number",
    label: "Sueño profundo estimado (min)",
    visibleWhen: { answerId: "sleepTracking", includes: true },
  },
  {
    blockId: "sleep",
    id: "sleepLightMinutes",
    kind: "number",
    label: "Sueño ligero estimado (min)",
    visibleWhen: { answerId: "sleepTracking", includes: true },
  },
  {
    blockId: "mobility",
    id: "mobilityAreas",
    kind: "multi",
    label: "Zonas de movilidad",
  },
  {
    blockId: "mobility",
    id: "mobilityDiscomfortStatus",
    kind: "single",
    label: "Molestias declaradas",
  },
  {
    blockId: "mobility",
    id: "mobilityDiscomfortDetails",
    kind: "entities",
    label: "Detalle de molestias",
    visibleWhen: { answerId: "mobilityDiscomfortStatus", includes: "declared" },
  },
  {
    blockId: "mobility",
    id: "mobilityMinutes",
    kind: "single",
    label: "Duración preferida",
  },
  {
    blockId: "supplements",
    id: "hasCurrentSupplements",
    kind: "boolean",
    label: "Tomas suplementos actualmente",
  },
  {
    blockId: "supplements",
    id: "currentSupplements",
    kind: "entities",
    label: "Suplementos actuales",
    options: supplementSuggestions,
    visibleWhen: { answerId: "hasCurrentSupplements", includes: true },
  },
  {
    blockId: "supplements",
    id: "supplementRecommendationPreference",
    kind: "single",
    label: "Tipo de recomendaciones",
  },
  {
    blockId: "supplements",
    id: "supplementGoals",
    kind: "multi",
    label: "Objetivos de suplementación",
  },
  {
    blockId: "clinical",
    id: "hasConditions",
    kind: "boolean",
    label: "Tienes condiciones o enfermedades declaradas",
  },
  {
    blockId: "clinical",
    id: "conditions",
    kind: "entities",
    label: "Condiciones declaradas",
    options: conditionSuggestions,
    visibleWhen: { answerId: "hasConditions", includes: true },
  },
  {
    blockId: "clinical",
    id: "hasMedications",
    kind: "boolean",
    label: "Tomas medicación o tratamientos hormonales",
  },
  {
    blockId: "clinical",
    id: "medications",
    kind: "entities",
    label: "Medicación y tratamientos declarados",
    options: medicationSuggestions,
    visibleWhen: { answerId: "hasMedications", includes: true },
  },
  {
    blockId: "clinical",
    id: "pregnancyLactation",
    kind: "single",
    label: "Embarazo, lactancia o búsqueda de embarazo",
  },
  {
    blockId: "clinical",
    id: "menopauseStage",
    kind: "single",
    label: "Contexto menopáusico",
  },
  {
    blockId: "labs",
    id: "hasLabValues",
    kind: "boolean",
    label: "Quieres añadir analíticas manuales",
  },
  {
    blockId: "labs",
    id: "labValues",
    kind: "entities",
    label: "Valores analíticos",
    options: labSuggestions,
    visibleWhen: { answerId: "hasLabValues", includes: true },
  },
];

export const QUESTIONNAIRE_PUBLIC_SCHEMA_V1 = {
  blocks: [
    { estimatedMinutes: 2, id: "core", title: "Contexto básico" },
    { estimatedMinutes: 1, id: "goals", title: "Objetivos" },
    { estimatedMinutes: 1, id: "modules", title: "Módulos" },
    { estimatedMinutes: 3, id: "nutrition", title: "Alimentación" },
    { estimatedMinutes: 3, id: "training", title: "Entrenamiento" },
    { estimatedMinutes: 2, id: "hydration", title: "Hidratación" },
    { estimatedMinutes: 2, id: "sleep", title: "Sueño y descanso" },
    { estimatedMinutes: 1, id: "mobility", title: "Movilidad" },
    { estimatedMinutes: 2, id: "supplements", title: "Suplementación" },
    { estimatedMinutes: 2, id: "clinical", title: "Contexto clínico" },
    { estimatedMinutes: 1, id: "labs", title: "Analíticas opcionales" },
    { estimatedMinutes: 1, id: "summary", title: "Resumen" },
  ] satisfies PublicBlock[],
  questions,
  schemaVersion: QUESTIONNAIRE_SCHEMA_VERSION,
} as const;

const PublicOptionSchema = z.object({ label: z.string(), value: z.string() }).strict();
const PublicQuestionSchema = z
  .object({
    blockId: QuestionnaireBlockIdSchema,
    id: z.string().min(1),
    kind: z.enum(["boolean", "entities", "multi", "number", "single", "text", "time"]),
    label: z.string().min(1),
    options: z.array(PublicOptionSchema).optional(),
    visibleWhen: z
      .object({
        answerId: z.string().min(1),
        includes: z.union([z.boolean(), z.string(), z.array(z.string()).min(1)]),
      })
      .strict()
      .optional(),
  })
  .strict();

export const QuestionnairePublicSchemaResponseSchema = z
  .object({
    blocks: z.array(
      z
        .object({
          estimatedMinutes: z.number().int().positive(),
          id: QuestionnaireBlockIdSchema,
          title: z.string().min(1),
        })
        .strict(),
    ),
    questions: z.array(PublicQuestionSchema),
    schemaVersion: z.literal(QUESTIONNAIRE_SCHEMA_VERSION),
  })
  .strict();

QuestionnairePublicSchemaResponseSchema.parse(QUESTIONNAIRE_PUBLIC_SCHEMA_V1);
