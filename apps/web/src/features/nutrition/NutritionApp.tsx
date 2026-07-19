import { useEffect, useMemo, useState } from "react";

import {
  NutritionWeekSchema,
  type NutritionWeekContract,
  type PlanMutationAck,
} from "@health-design/contracts";
import { applyNutritionSubstitution } from "@health-design/engine";

import { accessClient, type ProfileAccessSummary } from "../access/access-client";
import { questionnaireClient } from "../questionnaire/questionnaire-client";
import { NutritionPlanApiError, nutritionPlanClient } from "./nutrition-client";

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

function totalsLabel(totals: NutritionWeekContract["weekTotals"]): string {
  return `${totals.energyKcal} kcal · P ${totals.proteinG} g · C ${totals.carbohydratesG} g · G ${totals.fatG} g · Fibra ${totals.fiberG} g`;
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
  values: NutritionWeekContract["days"][number]["meals"][number]["foods"][number]["clinicalNutrients"];
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
  const [original, setOriginal] = useState<NutritionWeekContract>();
  const [plan, setPlan] = useState<NutritionWeekContract>();
  const [profiles, setProfiles] = useState<ProfileAccessSummary[]>([]);
  const [profileId, setProfileId] = useState<string>();
  const [provisionalReason, setProvisionalReason] = useState<string>();

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
    setProvisionalReason(undefined);
    setError(undefined);
  }, [profileId]);

  const dailyAverage = useMemo(() => {
    if (!plan) return undefined;
    return Object.fromEntries(
      Object.entries(plan.weekTotals).map(([key, value]) => [
        key,
        (Number(value) / 7).toFixed(1),
      ]),
    ) as NutritionWeekContract["weekTotals"];
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
      const nutrition = detail.moduleResults.find(
        ({ module }) => module === "nutrition",
      );
      const parsed = NutritionWeekSchema.safeParse(nutrition?.payload);
      setAck(mutation);
      if (!parsed.success) {
        const uncertainty = nutrition?.uncertainties[0] as
          { code?: string } | undefined;
        setProvisionalReason(
          uncertainty?.code ?? "NUTRITION_PLAN_PROVISIONAL_WITHOUT_WEEK",
        );
        return;
      }
      setOriginal(parsed.data);
      setPlan(parsed.data);
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

  function substitute(
    dayIndex: number,
    mealIndex: number,
    foodIndex: number,
    substituteIndex: number,
  ) {
    if (!plan) return;
    const next = applyNutritionSubstitution(plan, {
      dayIndex,
      foodIndex,
      mealIndex,
      substituteIndex,
    });
    const parsed = NutritionWeekSchema.parse(next);
    setPlan(parsed);
    setLocalPreview(true);
  }

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

      {profiles.length && !plan && !provisionalReason ? (
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

      {provisionalReason ? (
        <section className="nutrition-empty" role="status">
          <h2>Plan provisional sin menú activable</h2>
          <p>
            El resto del plan puede continuar, pero alimentación necesita más contexto o
            cobertura oficial.
          </p>
          <code>{provisionalReason}</code>
        </section>
      ) : null}

      {plan && dailyAverage ? (
        <>
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
                    setLocalPreview(false);
                  }}
                  type="button"
                >
                  Restablecer elecciones
                </button>
              ) : null}
              <button
                className="primary-button"
                disabled={busy || localPreview || ack?.status === "active"}
                onClick={() => void activate()}
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
                              <ClinicalNutrients values={food.clinicalNutrients} />
                            </div>
                            <small role="cell">{totalsLabel(food.nutrients)}</small>
                            <label role="cell">
                              <span className="sr-only">Sustituir {food.name}</span>
                              <select
                                aria-label={`Sustituir ${food.name}`}
                                onChange={(event) => {
                                  const index = Number(event.target.value);
                                  if (Number.isInteger(index) && index >= 0) {
                                    substitute(dayIndex, mealIndex, foodIndex, index);
                                  }
                                }}
                                value=""
                              >
                                <option value="">Elegir sustituto</option>
                                {food.substitutes.map((alternative, index) => (
                                  <option
                                    key={alternative.canonicalFoodKey}
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
