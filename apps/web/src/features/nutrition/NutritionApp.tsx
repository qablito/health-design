import { useEffect, useMemo, useRef, useState } from "react";

import {
  NutritionWeekSchema,
  NutritionWeekV2Schema,
  normalizeNutritionWeek,
  type ExportChoice,
  type NutritionWeekV2Contract,
  type PlanMutationAck,
  type PlanVersionDetail,
} from "@health-design/contracts";
import { applyNutritionSubstitution } from "@health-design/engine";

import { accessClient, type ProfileAccessSummary } from "../access/access-client";
import { AIExplanation } from "../ai-explanation/AIExplanation";
import {
  ProductScanner,
  type ProductCandidatePreview,
} from "../barcode/ProductScanner";
import { ExportPanel } from "../exports/ExportPanel";
import { questionnaireClient } from "../questionnaire/questionnaire-client";
import { clinicalFindingLabel } from "../wellness/wellness-view";
import {
  isPlanNotFound,
  mutationAckFromHistory,
  NutritionPlanApiError,
  nutritionPlanClient,
  selectCurrentVersion,
} from "./nutrition-client";

import "../access/access.css";
import "./nutrition.css";

function message(error: unknown): string {
  if (error instanceof NutritionPlanApiError) {
    if (error.code === "DRAFT_NOT_SUBMITTED") {
      return "Confirma primero el cuestionario de este perfil.";
    }
    if (error.code === "VERSION_CONFLICT") {
      return "Este perfil ya tiene un plan o cambió en otro dispositivo. Recarga antes de repetir la operación.";
    }
  }
  return "No se ha podido generar el plan. No se ha activado ningún cambio.";
}

function totalsLabel(totals: NutritionWeekV2Contract["weekTotals"]): string {
  return `${totals.energyKcal} kcal · P ${totals.proteinG} g · C ${totals.carbohydratesG} g · G ${totals.fatG} g · Fibra ${totals.fiberG} g`;
}

const uncertaintyLabels: Readonly<Record<string, string>> = {
  AGGRESSIVE_TARGET_REQUIRES_REVIEW:
    "El objetivo solicitado necesita una etapa intermedia conservadora antes de ajustar la energía.",
  MEAL_ANCHORS_DEFAULTED:
    "Los horarios aportados no cubren todas las comidas; se mantienen anclajes flexibles provisionales.",
  NUTRITION_CLINICAL_CONTEXT_REVIEW:
    "El contexto clínico declarado mantiene la alimentación en revisión conservadora.",
  NUTRITION_GLP1_TOLERANCE_REVIEW:
    "La tolerancia digestiva declarada necesita seguimiento antes de ajustar la pauta.",
  NUTRITION_SODIUM_NOT_VERIFIED:
    "El objetivo de sodio aún no está verificado para el contexto declarado.",
  PHYSIOLOGICAL_SEX_CONSTANT_UNAVAILABLE:
    "La referencia fisiológica disponible no permite usar una única constante; se conserva una banda provisional.",
};

const strategyLabels: Readonly<Record<string, string>> = {
  clinical_context_only: "Mantener la pauta subordinada al contexto clínico declarado.",
  glp1_tolerance_review:
    "Revisar tolerancia, saciedad y capacidad de completar las comidas.",
  planned_satiating_alternatives:
    "Dejar preparadas alternativas saciantes con la misma función nutricional.",
  protein_fiber_pairing:
    "Combinar proteína y fibra para favorecer saciedad y regularidad.",
  regular_meal_anchors: "Usar anclajes regulares de comida con franjas flexibles.",
  sodium_target_not_verified:
    "Mantener el sodio en revisión hasta contar con contexto suficiente.",
};

const actionLabels = {
  adjustment: "Ajuste contextual",
  immediate_conservative: "Enfoque conservador inmediato",
  information: "Información",
  priority_review: "Revisión prioritaria",
} as const;

type NutritionReview = Readonly<{
  completeness: "complete" | "provisional";
  moduleStatus: "invalid" | "not_requested" | "provisional" | "valid";
  safetyFindings: PlanVersionDetail["safetyFindings"];
  strategies: string[];
  uncertainties: unknown[];
  validationStatus: "invalid" | "valid";
}>;

type NutritionDetailState = Readonly<{
  ack: PlanMutationAck;
  original?: NutritionWeekV2Contract;
  plan?: NutritionWeekV2Contract;
  planOutputHash?: string;
  provisionalReason?: string;
  review?: NutritionReview;
}>;

type ProductSelection = Readonly<{
  dayIndex: number;
  expectedCanonicalFoodKey: string;
  foodIndex: number;
  foodName: string;
  mealIndex: number;
}>;

function readNutritionDetail(
  detail: PlanVersionDetail,
  ack: PlanMutationAck,
): NutritionDetailState {
  const nutrition = detail.moduleResults.find(({ module }) => module === "nutrition");
  const parsed = NutritionWeekSchema.safeParse(nutrition?.payload);
  if (!parsed.success) {
    const uncertainty = nutrition?.uncertainties[0] as { code?: string } | undefined;
    return {
      ack,
      provisionalReason: uncertainty?.code ?? "NUTRITION_PLAN_PROVISIONAL_WITHOUT_WEEK",
    };
  }
  const plan = normalizeNutritionWeek(parsed.data);
  const uncertainties = [
    ...(nutrition?.uncertainties ?? []),
    ...plan.targets.uncertainties,
  ];
  const review: NutritionReview = {
    completeness:
      ack.completeness === "provisional" ||
      nutrition?.status === "provisional" ||
      plan.targets.completeness === "provisional"
        ? "provisional"
        : "complete",
    moduleStatus: nutrition?.status ?? "invalid",
    safetyFindings: detail.safetyFindings.filter(
      ({ module }) => module === "nutrition",
    ),
    strategies: plan.strategies,
    uncertainties,
    validationStatus: detail.validationStatus,
  };
  return {
    ack,
    original: plan,
    plan,
    planOutputHash: detail.outputHash,
    review,
  };
}

function codeFrom(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "code" in value) {
    const code = (value as { code?: unknown }).code;
    return typeof code === "string" ? code : undefined;
  }
  return undefined;
}

function uncertaintyLabel(value: unknown): string {
  const code = codeFrom(value);
  return code && uncertaintyLabels[code]
    ? uncertaintyLabels[code]
    : "Falta contexto para confirmar una parte de la pauta; se mantiene una alternativa conservadora.";
}

function safetyLabel(code: string): string {
  if (code === "HYPERTENSION_CONTEXT_PARTIAL") {
    return "La presión arterial declarada exige revisar el objetivo de sodio antes de darlo por confirmado.";
  }
  return clinicalFindingLabel(code);
}

const clinicalNutrientLabels: Readonly<Record<string, string>> = {
  calcium: "Calcio",
  folate: "Folato",
  iron: "Hierro",
  iodine: "Yodo",
  magnesium: "Magnesio",
  potassium: "Potasio",
  salt: "Sal",
  saturated_fat: "Grasa saturada",
  selenium: "Selenio",
  sodium: "Sodio",
  sugars: "Azúcares",
  vitamin_b12: "Vitamina B12",
  vitamin_c: "Vitamina C",
  zinc: "Zinc",
};

function ClinicalNutrients({
  values,
}: {
  values: NutritionWeekV2Contract["days"][number]["meals"][number]["foods"][number]["clinicalNutrients"];
}) {
  const entries = Object.entries(values);
  if (entries.length === 0) return null;
  return (
    <details className="clinical-nutrients">
      <summary>Otros nutrientes ({entries.length})</summary>
      <dl>
        {entries.map(([key, nutrient]) => (
          <div key={key}>
            <dt>{clinicalNutrientLabels[key] ?? key.replaceAll("_", " ")}</dt>
            <dd>
              {nutrient.value} {nutrient.unit}
            </dd>
          </div>
        ))}
      </dl>
    </details>
  );
}

export function NutritionApp() {
  const [ack, setAck] = useState<PlanMutationAck>();
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string>();
  const [localPreview, setLocalPreview] = useState(false);
  const [choices, setChoices] = useState<Record<string, 0 | 1 | 2>>({});
  const [mealView, setMealView] = useState<"ingredients" | "preparation">(
    "ingredients",
  );
  const [original, setOriginal] = useState<NutritionWeekV2Contract>();
  const [plan, setPlan] = useState<NutritionWeekV2Contract>();
  const [planOutputHash, setPlanOutputHash] = useState<string>();
  const [profiles, setProfiles] = useState<ProfileAccessSummary[]>([]);
  const [profileId, setProfileId] = useState<string>();
  const [productSelection, setProductSelection] = useState<ProductSelection>();
  const [provisionalReason, setProvisionalReason] = useState<string>();
  const [review, setReview] = useState<NutritionReview>();
  const [restoreStatus, setRestoreStatus] = useState<
    "blocked" | "can_generate" | "loaded" | "loading"
  >("loading");
  const activationFocusRef = useRef<HTMLButtonElement>(null);
  const productReturnFocusRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let active = true;
    accessClient
      .listProfiles()
      .then((items) => {
        if (!active) return;
        setProfiles(items);
        setProfileId(items[0]?.profileId);
      })
      .catch((loadError) => active && setError(message(loadError)))
      .finally(() => active && setBusy(false));
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    setAck(undefined);
    setOriginal(undefined);
    setPlan(undefined);
    setLocalPreview(false);
    setChoices({});
    setPlanOutputHash(undefined);
    setProvisionalReason(undefined);
    setProductSelection(undefined);
    setReview(undefined);
    setError(undefined);
    if (!profileId) {
      setRestoreStatus("loading");
      return;
    }
    let current = true;
    setRestoreStatus("loading");
    setBusy(true);
    nutritionPlanClient
      .getCurrent(profileId)
      .then(async (history) => {
        if (history.profileId !== profileId) throw new Error("plan_profile_mismatch");
        const version = selectCurrentVersion(history);
        if (!version) throw new Error("plan_version_missing");
        const detail = await nutritionPlanClient.getVersion(version.planId, version.id);
        if (!current) return;
        const state = readNutritionDetail(
          detail,
          mutationAckFromHistory(history, version),
        );
        setAck(state.ack);
        setOriginal(state.original);
        setPlan(state.plan);
        setPlanOutputHash(state.planOutputHash);
        setProvisionalReason(state.provisionalReason);
        setReview(state.review);
        setRestoreStatus("loaded");
      })
      .catch((loadError: unknown) => {
        if (!current) return;
        if (isPlanNotFound(loadError, `/v1/profiles/${profileId}/plans/current`)) {
          setRestoreStatus("can_generate");
          return;
        }
        setError(message(loadError));
        setRestoreStatus("blocked");
      })
      .finally(() => current && setBusy(false));
    return () => {
      current = false;
    };
  }, [profileId]);

  const dailyAverage = useMemo(() => {
    if (!plan) return undefined;
    return Object.fromEntries(
      Object.entries(plan.weekTotals).map(([key, value]) => [
        key,
        (Number(value) / 7).toFixed(1),
      ]),
    ) as NutritionWeekV2Contract["weekTotals"];
  }, [plan]);

  async function generate() {
    if (!profileId) return;
    setBusy(true);
    setError(undefined);
    setProvisionalReason(undefined);
    try {
      const draft = await questionnaireClient.getDraft(profileId);
      if (!draft || draft.status !== "submitted") {
        setError("Confirma primero el cuestionario de este perfil.");
        return;
      }
      const context = await nutritionPlanClient.createContext(profileId, draft.version);
      const mutation = await nutritionPlanClient.generate(profileId, context.id);
      const detail = await nutritionPlanClient.getVersion(
        mutation.planId,
        mutation.planVersionId,
      );
      const state = readNutritionDetail(detail, mutation);
      setAck(state.ack);
      setProvisionalReason(state.provisionalReason);
      setReview(state.review);
      setOriginal(state.original);
      setPlan(state.plan);
      setPlanOutputHash(state.planOutputHash);
      setChoices({});
      setRestoreStatus("loaded");
    } catch (generationError) {
      setError(message(generationError));
    } finally {
      setBusy(false);
    }
  }

  async function activate() {
    if (!ack || localPreview) return;
    setBusy(true);
    setError(undefined);
    try {
      setAck(
        await nutritionPlanClient.activateVersion(
          ack.planId,
          ack.planVersionId,
          ack.aggregateVersion,
        ),
      );
    } catch (activationError) {
      setError(message(activationError));
    } finally {
      setBusy(false);
    }
  }

  async function loadProductCandidate(
    candidateAck: PlanMutationAck,
    selection: ProductSelection,
  ): Promise<ProductCandidatePreview> {
    const detail = await nutritionPlanClient.getVersion(
      candidateAck.planId,
      candidateAck.planVersionId,
    );
    const state = readNutritionDetail(detail, candidateAck);
    const appliedFood =
      state.plan?.days[selection.dayIndex]?.meals[selection.mealIndex]?.foods[
        selection.foodIndex
      ];
    if (!appliedFood?.commercialProduct) {
      throw new Error("commercial_product_candidate_missing");
    }
    setAck(state.ack);
    setOriginal(state.original);
    setPlan(state.plan);
    setPlanOutputHash(state.planOutputHash);
    setProvisionalReason(state.provisionalReason);
    setReview(state.review);
    setChoices({});
    setLocalPreview(false);
    setRestoreStatus("loaded");
    const uncertaintyCodes =
      state.review?.uncertainties
        .map(codeFrom)
        .filter((value): value is string => value !== undefined) ?? [];
    return {
      amountG: appliedFood.amountG,
      completeness: state.review?.completeness ?? candidateAck.completeness,
      name: appliedFood.name,
      substitutes: appliedFood.substitutes.map(({ name }) => name),
      totalsLabel: totalsLabel(appliedFood.nutrients),
      uncertainties: [...new Set(uncertaintyCodes)],
    };
  }

  function substitute(
    dayIndex: number,
    mealIndex: number,
    foodIndex: number,
    choice: 0 | 1 | 2,
  ) {
    if (!original) return;
    const key = `${dayIndex}:${mealIndex}:${foodIndex}`;
    const nextChoices = { ...choices };
    if (choice === 0) delete nextChoices[key];
    else nextChoices[key] = choice;
    let next = NutritionWeekV2Schema.parse(original);
    for (const [position, selected] of Object.entries(nextChoices).sort()) {
      const [selectedDay, selectedMeal, selectedFood] = position.split(":").map(Number);
      if (
        selectedDay === undefined ||
        selectedMeal === undefined ||
        selectedFood === undefined
      ) {
        continue;
      }
      next = NutritionWeekV2Schema.parse(
        applyNutritionSubstitution(next, {
          dayIndex: selectedDay,
          foodIndex: selectedFood,
          mealIndex: selectedMeal,
          substituteIndex: selected - 1,
        }),
      );
    }
    const parsed = NutritionWeekV2Schema.parse(next);
    setChoices(nextChoices);
    setPlan(parsed);
    setLocalPreview(Object.keys(nextChoices).length > 0);
  }

  const exportChoices = useMemo(
    () =>
      Object.entries(choices)
        .map(([position, choice]) => {
          const [dayIndex, mealIndex, foodIndex] = position.split(":").map(Number);
          return [dayIndex, mealIndex, foodIndex, choice] as ExportChoice;
        })
        .sort(
          (left, right) =>
            left[0] - right[0] || left[1] - right[1] || left[2] - right[2],
        ),
    [choices],
  );

  return (
    <main className="nutrition-shell">
      <header className="nutrition-header">
        <div>
          <p className="eyebrow">HEALTH DESIGN · ALIMENTACIÓN T10</p>
          <h1>Tu semana de alimentación</h1>
          <p className="lede">
            Cantidades en crudo, objetivos recalculables y dos alternativas por
            alimento.
          </p>
        </div>
        <div className="profile-switcher">
          <label htmlFor="nutrition-profile">Perfil</label>
          <select
            disabled={busy}
            id="nutrition-profile"
            onChange={(event) => setProfileId(event.target.value)}
            value={profileId}
          >
            {profiles.map((profile) => (
              <option key={profile.profileId} value={profile.profileId}>
                {profile.alias}
              </option>
            ))}
          </select>
          <a className="text-button" href="/questionnaire">
            Revisar cuestionario
          </a>
          <a className="text-button" href="/training">
            Ver movimiento
          </a>
          <a className="text-button" href="/wellness">
            Ver bienestar
          </a>
          {ack?.status === "active" && profileId ? (
            <a
              className="text-button"
              href={`/shopping?version=${ack.planVersionId}&profile=${profileId}`}
            >
              Preparar compra
            </a>
          ) : null}
        </div>
      </header>

      {error ? (
        <div className="message error-message" role="alert">
          {error}
        </div>
      ) : null}

      {!profiles.length && !busy ? (
        <section className="nutrition-empty">
          <h2>Necesitas un perfil vinculado</h2>
          <a className="primary-button inline-link" href="/">
            Gestionar acceso
          </a>
        </section>
      ) : null}

      {profiles.length > 0 && restoreStatus === "loading" ? (
        <p role="status">Consultando el plan existente…</p>
      ) : null}
      {profiles.length > 0 &&
      !plan &&
      !provisionalReason &&
      restoreStatus === "can_generate" ? (
        <section className="nutrition-empty">
          <p>El plan se crea desde el último cuestionario confirmado.</p>
          <button
            className="primary-button"
            disabled={busy}
            onClick={() => void generate()}
          >
            {busy ? "Generando…" : "Generar semana estable"}
          </button>
        </section>
      ) : null}

      {profiles.length > 0 && restoreStatus === "blocked" ? (
        <section className="nutrition-empty">
          <h2>No se ha podido consultar el plan existente</h2>
          <p>
            Recarga para recuperar la versión ya creada. No se ofrece una nueva
            generación mientras su estado sea incierto.
          </p>
        </section>
      ) : null}

      {provisionalReason ? (
        <section className="nutrition-empty" role="status">
          <h2>Plan provisional sin menú activable</h2>
          <p>
            El resto del plan puede continuar, pero alimentación necesita más contexto o
            cobertura oficial.
          </p>
          <p>
            El menú no supera el contrato de presentación y no puede activarse en esta
            versión.
          </p>
        </section>
      ) : null}

      {plan && original && dailyAverage ? (
        <>
          {review ? (
            <section
              aria-label="Estado y revisión del plan nutricional"
              className={`nutrition-review ${review.completeness}`}
            >
              <header>
                <div>
                  <span>
                    {review.completeness === "complete"
                      ? "PLAN COMPLETO"
                      : "PLAN PROVISIONAL"}
                  </span>
                  <h2>
                    {ack?.status === "active"
                      ? "Versión activa"
                      : review.validationStatus === "valid"
                        ? "Borrador validado"
                        : "Borrador no activable"}
                  </h2>
                </div>
                <strong>
                  {review.moduleStatus === "provisional"
                    ? "Alimentación provisional"
                    : "Alimentación validada"}
                </strong>
              </header>
              {review.completeness === "provisional" &&
              review.validationStatus === "valid" ? (
                <p className="provisional-guidance" role="status">
                  Este borrador conserva incertidumbres visibles y puede activarse
                  manualmente si prefieres seguir esta alternativa conservadora.
                </p>
              ) : null}
              {review.uncertainties.length > 0 ? (
                <div>
                  <h3>Datos pendientes de revisión</h3>
                  <ul>
                    {[...new Set(review.uncertainties.map(uncertaintyLabel))].map(
                      (item) => (
                        <li key={item}>{item}</li>
                      ),
                    )}
                  </ul>
                </div>
              ) : null}
              {review.safetyFindings.length > 0 ? (
                <div>
                  <h3>Revisión de seguridad</h3>
                  <ul>
                    {review.safetyFindings.map((finding) => (
                      <li key={finding.id}>
                        <strong>{actionLabels[finding.actionLevel]}:</strong>{" "}
                        {safetyLabel(finding.code)}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {review.strategies.length > 0 ? (
                <div>
                  <h3>Estrategias del contexto actual</h3>
                  <ul>
                    {[
                      ...new Set(
                        review.strategies.map(
                          (strategy) =>
                            strategyLabels[strategy] ??
                            "Se aplica una estrategia contextual conservadora.",
                        ),
                      ),
                    ].map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </section>
          ) : null}
          {ack?.validationStatus === "valid" ? (
            <AIExplanation planVersionId={ack.planVersionId} />
          ) : null}
          <section className="nutrition-targets" aria-label="Objetivos nutricionales">
            <article>
              <span>Energía diaria</span>
              <strong>{plan.targets.energy.centerKcal} kcal</strong>
              <small>
                Banda {plan.targets.energy.minimumKcal}–
                {plan.targets.energy.maximumKcal}
              </small>
            </article>
            <article>
              <span>Proteína</span>
              <strong>{plan.targets.protein.centerG} g</strong>
              <small>
                {plan.targets.protein.minimumGPerKg}–
                {plan.targets.protein.maximumGPerKg} g/kg
              </small>
            </article>
            <article>
              <span>Grasa</span>
              <strong>{plan.targets.macros.fatG} g</strong>
              <small>30 % de la energía central</small>
            </article>
            <article>
              <span>Fibra</span>
              <strong>{plan.targets.fiber.targetG} g</strong>
              <small>Mínimo 25 g, subordinado a tolerancia</small>
            </article>
          </section>

          <fieldset className="meal-view-selector">
            <legend>Vista de las comidas</legend>
            <label>
              <input
                checked={mealView === "ingredients"}
                name="meal-view"
                onChange={() => setMealView("ingredients")}
                type="radio"
              />
              <span>Ingredientes y cantidades</span>
            </label>
            <label>
              <input
                checked={mealView === "preparation"}
                name="meal-view"
                onChange={() => setMealView("preparation")}
                type="radio"
              />
              <span>Preparación breve</span>
            </label>
          </fieldset>

          <div className="nutrition-toolbar">
            <div>
              <strong>
                {plan.mode === "simple" ? "Modo simple" : "Modo equilibrado"}
              </strong>
              <span>{totalsLabel(dailyAverage)}</span>
            </div>
            <div>
              {localPreview ? (
                <button
                  className="secondary-button"
                  onClick={() => {
                    setPlan(original);
                    setChoices({});
                    setLocalPreview(false);
                  }}
                  type="button"
                >
                  Restablecer elecciones
                </button>
              ) : null}
              <button
                className="primary-button"
                disabled={
                  busy ||
                  localPreview ||
                  ack?.status === "active" ||
                  review?.validationStatus !== "valid"
                }
                onClick={() => void activate()}
                ref={activationFocusRef}
                type="button"
              >
                {ack?.status === "active" ? "Plan activo" : "Activar plan"}
              </button>
            </div>
          </div>
          {localPreview ? (
            <p className="preview-note" role="status">
              Vista previa recalculada. Restablece las elecciones antes de activar este
              borrador.
            </p>
          ) : null}

          {ack?.validationStatus === "valid" && original && planOutputHash ? (
            <ExportPanel
              choices={exportChoices}
              nutrition={original}
              planOutputHash={planOutputHash}
              planVersionId={ack.planVersionId}
            />
          ) : null}

          <section className="nutrition-days" aria-label="Semana nutricional">
            {plan.days.map((day, dayIndex) => (
              <article className="nutrition-day" key={day.day}>
                <header>
                  <div>
                    <span>DÍA {day.day}</span>
                    <h2>Día {day.day}</h2>
                  </div>
                  <small>{totalsLabel(day.totals)}</small>
                </header>
                <div className="meal-stack">
                  {day.meals.map((meal, mealIndex) => (
                    <section className="nutrition-meal" key={meal.index}>
                      <div className="meal-heading">
                        <h3>Comida {meal.index}</h3>
                        <span>
                          {meal.anchor.replaceAll("_", " ")} · ±
                          {meal.flexibleWindowMinutes} min
                        </span>
                      </div>
                      <div
                        className="food-table"
                        role="table"
                        aria-label={`Día ${day.day}, comida ${meal.index}`}
                      >
                        {meal.foods.map((food, foodIndex) => (
                          <div
                            className="food-row"
                            key={`${food.function}:${food.canonicalFoodKey}`}
                            role="row"
                          >
                            <div role="cell">
                              <strong>{food.name}</strong>
                              <span>
                                {food.amountG} g ·{" "}
                                {food.foodState === "raw" ? "en crudo" : food.foodState}
                              </span>
                              {mealView === "preparation" ? (
                                <p className="food-preparation">
                                  {food.preparation.instruction}
                                </p>
                              ) : null}
                              <ClinicalNutrients values={food.clinicalNutrients} />
                              <button
                                className="product-inline-button"
                                disabled={
                                  busy || localPreview || ack?.status !== "active"
                                }
                                onClick={(event) => {
                                  productReturnFocusRef.current = event.currentTarget;
                                  setProductSelection({
                                    dayIndex,
                                    expectedCanonicalFoodKey: food.canonicalFoodKey,
                                    foodIndex,
                                    foodName: food.name,
                                    mealIndex,
                                  });
                                }}
                                type="button"
                              >
                                Usar producto comercial
                              </button>
                            </div>
                            <small role="cell">{totalsLabel(food.nutrients)}</small>
                            <label role="cell">
                              <span className="sr-only">Sustituir {food.name}</span>
                              <select
                                aria-label={`Sustituir ${food.name}`}
                                onChange={(event) => {
                                  const choice = Number(event.target.value);
                                  if (choice === 0 || choice === 1 || choice === 2) {
                                    substitute(dayIndex, mealIndex, foodIndex, choice);
                                  }
                                }}
                                value={
                                  choices[`${dayIndex}:${mealIndex}:${foodIndex}`] ?? 0
                                }
                              >
                                {[
                                  original.days[dayIndex]!.meals[mealIndex]!.foods[
                                    foodIndex
                                  ]!,
                                  ...original.days[dayIndex]!.meals[mealIndex]!.foods[
                                    foodIndex
                                  ]!.substitutes,
                                ].map((alternative, index) => (
                                  <option
                                    key={`${index}:${alternative.canonicalFoodKey}`}
                                    value={index}
                                  >
                                    {alternative.name} · {alternative.amountG} g
                                  </option>
                                ))}
                              </select>
                            </label>
                          </div>
                        ))}
                      </div>
                    </section>
                  ))}
                </div>
              </article>
            ))}
          </section>

          {productSelection && ack && profileId ? (
            <ProductScanner
              baseVersionId={ack.planVersionId}
              expectedVersion={ack.aggregateVersion}
              fallbackFocusRef={activationFocusRef}
              foodName={productSelection.foodName}
              onCandidate={(candidateAck) =>
                loadProductCandidate(candidateAck, productSelection)
              }
              onClose={() => setProductSelection(undefined)}
              planId={ack.planId}
              profileId={profileId}
              returnFocusRef={productReturnFocusRef}
              selection={productSelection}
            />
          ) : null}

          <section className="shopping-summary">
            <h2>Lista canónica de la semana</h2>
            <ul>
              {plan.shoppingList.map((item) => (
                <li key={item.canonicalFoodKey}>
                  <span>{item.name}</span>
                  <strong>{item.amountG} g</strong>
                </li>
              ))}
            </ul>
          </section>
        </>
      ) : null}
    </main>
  );
}
