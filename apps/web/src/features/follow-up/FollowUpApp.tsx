import { useEffect, useMemo, useState, type FormEvent } from "react";

import type {
  FollowUpCreateRequest,
  FollowUpEntry,
  FollowUpValues,
  LabHistory,
  LabObservationInput,
  PlanCandidateAck,
} from "@health-design/contracts";

import { accessClient, type ProfileAccessSummary } from "../access/access-client";
import {
  NutritionPlanApiError,
  nutritionPlanClient,
} from "../nutrition/nutrition-client";
import { FollowUpApiError, followUpClient } from "./follow-up-client";

import "../access/access.css";
import "./follow-up.css";

const modules = [
  "nutrition",
  "training",
  "hydration",
  "sleep",
  "mobility",
  "supplements",
] as const;
type FollowUpModule = (typeof modules)[number];
type Scope = FollowUpCreateRequest["scope"];
type LabRow = Readonly<{
  analyte: LabObservationInput["analyte"];
  id: number;
  measurementKind: LabObservationInput["measurement"]["kind"];
}>;

const moduleLabels: Readonly<Record<FollowUpModule, string>> = {
  hydration: "Hidratación",
  mobility: "Movilidad",
  nutrition: "Alimentación",
  sleep: "Sueño y descanso",
  supplements: "Suplementación",
  training: "Entrenamiento",
};

const analyteDefaults: Readonly<
  Record<LabObservationInput["analyte"], { name: string; units: readonly string[] }>
> = {
  b12: { name: "Vitamina B12", units: ["pg/mL", "pmol/L"] },
  creatinine: { name: "Creatinina", units: ["mg/dL", "µmol/L"] },
  egfr: { name: "Filtrado glomerular estimado", units: ["mL/min/1.73m²"] },
  folate: { name: "Folato", units: ["ng/mL", "nmol/L"] },
  magnesium: { name: "Magnesio", units: ["mg/dL", "mmol/L"] },
  other: { name: "", units: [] },
};

const scopeLabels: Readonly<Record<Scope, string>> = {
  daily: "Registro diario opcional",
  four_week: "Revisión de cuatro semanas",
  weekly: "Revisión semanal",
};

const materialChangeOptions = [
  ["clinical", "Salud o condición clínica"],
  ["medication", "Medicación o uso farmacológico"],
  ["objective", "Objetivo principal"],
  ["pregnancy_lactation", "Embarazo o lactancia"],
  ["training_structure", "Estructura del entrenamiento"],
] as const;

function errorMessage(error: unknown): string {
  if (error instanceof FollowUpApiError) {
    if (error.code === "VERSION_CONFLICT") {
      return "El plan cambió en otro dispositivo. Los datos no se han sobrescrito; recarga y vuelve a intentarlo.";
    }
    if (error.code === "VALIDATION_ERROR") {
      return "Revisa los campos marcados. Falta un dato o existe una combinación incompatible.";
    }
    if (error.code === "NOT_FOUND") {
      return "Este perfil todavía no tiene un plan activo que pueda seguirse.";
    }
  }
  if (error instanceof NutritionPlanApiError && error.code === "NOT_FOUND") {
    return "Este perfil todavía no tiene un plan activo que pueda seguirse.";
  }
  return "No se ha podido completar la operación. El plan activo no se ha modificado.";
}

function value(form: FormData, name: string): string {
  const candidate = form.get(name);
  return typeof candidate === "string" ? candidate.trim() : "";
}

function numberValue(form: FormData, name: string): number | undefined {
  const candidate = value(form, name);
  if (candidate === "") return undefined;
  const parsed = Number(candidate);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function scoreSelect(name: string, label: string, optional = true) {
  return (
    <label className="follow-field">
      <span>{label}</span>
      <select defaultValue="" name={name} required={!optional}>
        <option disabled={!optional} value="">
          {optional ? "Sin registrar" : "Selecciona una opción"}
        </option>
        <option value="1">1 · Muy bajo</option>
        <option value="2">2 · Bajo</option>
        <option value="3">3 · Intermedio</option>
        <option value="4">4 · Alto</option>
        <option value="5">5 · Muy alto</option>
      </select>
    </label>
  );
}

function moduleValues(form: FormData, activeModules: readonly FollowUpModule[]) {
  const result: FollowUpValues = {};
  const active = new Set(activeModules);
  const nutrition = {
    adherence: numberValue(form, "nutrition-adherence"),
    foodAnxiety: value(form, "nutrition-food-anxiety") || undefined,
    hunger: numberValue(form, "nutrition-hunger"),
    satiety: numberValue(form, "nutrition-satiety"),
  } as NonNullable<FollowUpValues["nutrition"]>;
  const training = {
    completedSessions: numberValue(form, "training-completed"),
    fatigue: numberValue(form, "training-fatigue"),
    pain: value(form, "training-pain") || undefined,
    perceivedEffort: numberValue(form, "training-effort"),
    plannedSessions: numberValue(form, "training-planned"),
    volumeChangePercent: numberValue(form, "training-volume-change"),
  } as NonNullable<FollowUpValues["training"]>;
  const hydration = {
    averageMl: numberValue(form, "hydration-average"),
    issues: value(form, "hydration-issues") || undefined,
  } as NonNullable<FollowUpValues["hydration"]>;
  const sleep = {
    averageHours: numberValue(form, "sleep-hours"),
    deepMinutes: numberValue(form, "sleep-deep"),
    lightMinutes: numberValue(form, "sleep-light"),
    quality: numberValue(form, "sleep-quality"),
    regularity: value(form, "sleep-regularity") || undefined,
    remMinutes: numberValue(form, "sleep-rem"),
  } as NonNullable<FollowUpValues["sleep"]>;
  const mobility = {
    discomfort: value(form, "mobility-discomfort") || undefined,
    sessionsCompleted: numberValue(form, "mobility-sessions"),
  } as NonNullable<FollowUpValues["mobility"]>;
  const supplements = {
    adverseEffects: value(form, "supplements-adverse") || undefined,
    benefit: value(form, "supplements-benefit") || undefined,
    change: value(form, "supplements-change") || undefined,
  } as NonNullable<FollowUpValues["supplements"]>;

  const candidates = { hydration, mobility, nutrition, sleep, supplements, training };
  for (const module of modules) {
    if (!active.has(module)) continue;
    const supplied = Object.fromEntries(
      Object.entries(candidates[module]).filter(([, item]) => item !== undefined),
    );
    if (Object.keys(supplied).length > 0) {
      Object.assign(result, { [module]: supplied });
    }
  }
  return result;
}

function FollowUpFields({
  activeModules,
  scope,
}: {
  activeModules: readonly FollowUpModule[];
  scope: Scope;
}) {
  const active = new Set(activeModules);
  return (
    <>
      {scope !== "daily" ? (
        <fieldset className="follow-group">
          <legend>Resumen común</legend>
          <div className="follow-grid three">
            {scoreSelect("common-adherence", "Adherencia general", false)}
          </div>
          <div className="follow-choice-block">
            <strong>¿Ha cambiado algo relevante?</strong>
            <span>
              Márcalo para actualizar primero el cuestionario, sin adivinar datos.
            </span>
            <div className="follow-check-grid">
              {materialChangeOptions.map(([key, label]) => (
                <label className="follow-check" key={key}>
                  <input name={`material-${key}`} type="checkbox" />
                  <span>{label}</span>
                </label>
              ))}
            </div>
          </div>
          <div className="follow-choice-block">
            <strong>¿Hay algún síntoma importante?</strong>
            <span>Solo se muestran los módulos que forman parte del plan activo.</span>
            <div className="follow-check-grid">
              {activeModules.map((module) => (
                <label className="follow-check" key={module}>
                  <input name={`symptom-${module}`} type="checkbox" />
                  <span>{moduleLabels[module]}</span>
                </label>
              ))}
            </div>
          </div>
        </fieldset>
      ) : (
        <p className="follow-inline-note">
          El diario es opcional: registra únicamente lo que quieras conservar hoy.
        </p>
      )}

      {active.has("nutrition") ? (
        <fieldset className="follow-group" data-module="nutrition">
          <legend>Alimentación</legend>
          <div className="follow-grid">
            {scoreSelect("nutrition-adherence", "Adherencia")}
            {scoreSelect("nutrition-hunger", "Hambre")}
            {scoreSelect("nutrition-satiety", "Saciedad")}
            <label className="follow-field">
              <span>Ansiedad alimentaria</span>
              <select defaultValue="" name="nutrition-food-anxiety">
                <option value="">Sin registrar</option>
                <option value="none">No</option>
                <option value="sometimes">A veces</option>
                <option value="frequent">Frecuente</option>
                <option value="prefer_not_to_say">Prefiero no indicarlo</option>
              </select>
            </label>
          </div>
        </fieldset>
      ) : null}

      {active.has("training") ? (
        <fieldset className="follow-group" data-module="training">
          <legend>Entrenamiento</legend>
          <div className="follow-grid three">
            <label className="follow-field">
              <span>Sesiones previstas</span>
              <input max="14" min="0" name="training-planned" type="number" />
            </label>
            <label className="follow-field">
              <span>Sesiones completadas</span>
              <input max="14" min="0" name="training-completed" type="number" />
            </label>
            <label className="follow-field">
              <span>Esfuerzo percibido · 1–10</span>
              <input max="10" min="1" name="training-effort" type="number" />
            </label>
            {scoreSelect("training-fatigue", "Fatiga")}
            <label className="follow-field">
              <span>Dolor</span>
              <select defaultValue="" name="training-pain">
                <option value="">Sin registrar</option>
                <option value="none">Ninguno</option>
                <option value="mild">Leve</option>
                <option value="important">Importante</option>
              </select>
            </label>
            <label className="follow-field">
              <span>Cambio de volumen · %</span>
              <input
                aria-describedby="volume-help"
                max="100"
                min="-100"
                name="training-volume-change"
                type="number"
              />
              <small id="volume-help">
                Hasta ±10 % genera solo una recomendación; nunca cambia el plan activo.
              </small>
            </label>
          </div>
        </fieldset>
      ) : null}

      {active.has("hydration") ? (
        <fieldset className="follow-group" data-module="hydration">
          <legend>Hidratación</legend>
          <div className="follow-grid">
            <label className="follow-field">
              <span>Media diaria · ml</span>
              <input max="10000" min="0" name="hydration-average" type="number" />
            </label>
            <label className="follow-field">
              <span>Problemas percibidos</span>
              <select defaultValue="" name="hydration-issues">
                <option value="">Sin registrar</option>
                <option value="none">Ninguno</option>
                <option value="mild">Leves</option>
                <option value="important">Importantes</option>
              </select>
            </label>
          </div>
        </fieldset>
      ) : null}

      {active.has("sleep") ? (
        <fieldset className="follow-group" data-module="sleep">
          <legend>Sueño y descanso</legend>
          <div className="follow-grid three">
            <label className="follow-field">
              <span>Horas de sueño</span>
              <input max="24" min="0" name="sleep-hours" step="0.1" type="number" />
            </label>
            {scoreSelect("sleep-quality", "Calidad")}
            <label className="follow-field">
              <span>Regularidad</span>
              <select defaultValue="" name="sleep-regularity">
                <option value="">Sin registrar</option>
                <option value="regular">Regular</option>
                <option value="somewhat_variable">Algo variable</option>
                <option value="very_variable">Muy variable</option>
              </select>
            </label>
          </div>
          <details className="follow-details">
            <summary>Añadir fases de sueño medidas</summary>
            <p>Son estimaciones manuales y no se interpretan como diagnóstico.</p>
            <div className="follow-grid three">
              <label className="follow-field">
                <span>REM · minutos</span>
                <input max="1440" min="0" name="sleep-rem" type="number" />
              </label>
              <label className="follow-field">
                <span>Profundo · minutos</span>
                <input max="1440" min="0" name="sleep-deep" type="number" />
              </label>
              <label className="follow-field">
                <span>Ligero · minutos</span>
                <input max="1440" min="0" name="sleep-light" type="number" />
              </label>
            </div>
          </details>
        </fieldset>
      ) : null}

      {active.has("mobility") ? (
        <fieldset className="follow-group" data-module="mobility">
          <legend>Movilidad</legend>
          <div className="follow-grid">
            <label className="follow-field">
              <span>Sesiones completadas</span>
              <input max="14" min="0" name="mobility-sessions" type="number" />
            </label>
            <label className="follow-field">
              <span>Molestias</span>
              <select defaultValue="" name="mobility-discomfort">
                <option value="">Sin registrar</option>
                <option value="none">Ninguna</option>
                <option value="mild">Leves</option>
                <option value="important">Importantes</option>
              </select>
            </label>
          </div>
        </fieldset>
      ) : null}

      {active.has("supplements") ? (
        <fieldset className="follow-group" data-module="supplements">
          <legend>Suplementación</legend>
          <div className="follow-grid three">
            <label className="follow-field">
              <span>Cambio desde la última revisión</span>
              <select defaultValue="" name="supplements-change">
                <option value="">Sin registrar</option>
                <option value="none">Sin cambios</option>
                <option value="started">He comenzado uno</option>
                <option value="stopped">He suspendido uno</option>
              </select>
            </label>
            <label className="follow-field">
              <span>Beneficio percibido</span>
              <select defaultValue="" name="supplements-benefit">
                <option value="">Sin registrar</option>
                <option value="none">Ninguno</option>
                <option value="unclear">No está claro</option>
                <option value="positive">Positivo</option>
              </select>
            </label>
            <label className="follow-field">
              <span>Efectos adversos</span>
              <select defaultValue="" name="supplements-adverse">
                <option value="">Sin registrar</option>
                <option value="none">Ninguno</option>
                <option value="mild">Leves</option>
                <option value="important">Importantes</option>
              </select>
            </label>
          </div>
        </fieldset>
      ) : null}
    </>
  );
}

function labObservation(form: FormData, row: LabRow): LabObservationInput {
  const prefix = `lab-${row.id}`;
  const defaults = analyteDefaults[row.analyte];
  const unit = value(form, `${prefix}-unit`);
  const minimum = value(form, `${prefix}-minimum`);
  const maximum = value(form, `${prefix}-maximum`);
  const measurement =
    row.measurementKind === "exact"
      ? ({ date: value(form, `${prefix}-date`), kind: "exact" } as const)
      : row.measurementKind === "range"
        ? ({
            from: value(form, `${prefix}-from`),
            kind: "range",
            to: value(form, `${prefix}-to`),
          } as const)
        : ({ kind: "unknown" } as const);
  return {
    analyte: row.analyte,
    measurement,
    name: row.analyte === "other" ? value(form, `${prefix}-name`) : defaults.name,
    ...(minimum || maximum
      ? {
          referenceRange: {
            ...(maximum ? { maximum } : {}),
            ...(minimum ? { minimum } : {}),
            ...(unit ? { unit } : {}),
          },
        }
      : {}),
    source: value(form, `${prefix}-source`) as LabObservationInput["source"],
    ...(unit ? { unit } : {}),
    value: value(form, `${prefix}-value`),
  };
}

function LabRowFields({
  onChange,
  onRemove,
  row,
}: {
  onChange: (row: LabRow) => void;
  onRemove?: () => void;
  row: LabRow;
}) {
  const prefix = `lab-${row.id}`;
  const defaults = analyteDefaults[row.analyte];
  const today = new Date().toISOString().slice(0, 10);
  return (
    <fieldset className="lab-row">
      <legend>Valor {row.id + 1}</legend>
      {onRemove ? (
        <button className="text-button lab-remove" onClick={onRemove} type="button">
          Quitar
        </button>
      ) : null}
      <div className="follow-grid three">
        <label className="follow-field">
          <span>Analito</span>
          <select
            name={`${prefix}-analyte`}
            onChange={(event) =>
              onChange({
                ...row,
                analyte: event.target.value as LabObservationInput["analyte"],
              })
            }
            value={row.analyte}
          >
            <option value="b12">Vitamina B12</option>
            <option value="folate">Folato</option>
            <option value="magnesium">Magnesio</option>
            <option value="creatinine">Creatinina</option>
            <option value="egfr">Filtrado glomerular estimado</option>
            <option value="other">Otro valor</option>
          </select>
        </label>
        {row.analyte === "other" ? (
          <label className="follow-field">
            <span>Nombre del valor</span>
            <input maxLength={80} name={`${prefix}-name`} required />
          </label>
        ) : (
          <div className="follow-readonly">
            <span>Nombre</span>
            <strong>{defaults.name}</strong>
          </div>
        )}
        <label className="follow-field">
          <span>Resultado</span>
          <input name={`${prefix}-value`} required step="any" type="number" />
        </label>
        <label className="follow-field">
          <span>Unidad</span>
          {defaults.units.length > 0 ? (
            <select defaultValue={defaults.units[0]} name={`${prefix}-unit`}>
              {defaults.units.map((unit) => (
                <option key={unit} value={unit}>
                  {unit}
                </option>
              ))}
            </select>
          ) : (
            <input maxLength={32} name={`${prefix}-unit`} />
          )}
        </label>
        <label className="follow-field">
          <span>Origen</span>
          <select defaultValue="laboratory" name={`${prefix}-source`}>
            <option value="laboratory">Laboratorio</option>
            <option value="device">Dispositivo</option>
            <option value="self_reported">Introducido manualmente</option>
          </select>
        </label>
        <label className="follow-field">
          <span>Precisión de la fecha</span>
          <select
            name={`${prefix}-date-kind`}
            onChange={(event) =>
              onChange({
                ...row,
                measurementKind: event.target.value as LabRow["measurementKind"],
              })
            }
            value={row.measurementKind}
          >
            <option value="exact">Fecha exacta</option>
            <option value="range">Rango aproximado</option>
            <option value="unknown">No la conozco</option>
          </select>
        </label>
        {row.measurementKind === "exact" ? (
          <label className="follow-field">
            <span>Fecha</span>
            <input defaultValue={today} name={`${prefix}-date`} required type="date" />
          </label>
        ) : null}
        {row.measurementKind === "range" ? (
          <>
            <label className="follow-field">
              <span>Desde</span>
              <input name={`${prefix}-from`} required type="date" />
            </label>
            <label className="follow-field">
              <span>Hasta</span>
              <input name={`${prefix}-to`} required type="date" />
            </label>
          </>
        ) : null}
      </div>
      <details className="follow-details compact">
        <summary>Añadir rango de referencia del informe</summary>
        <div className="follow-grid">
          <label className="follow-field">
            <span>Mínimo</span>
            <input name={`${prefix}-minimum`} step="any" type="number" />
          </label>
          <label className="follow-field">
            <span>Máximo</span>
            <input name={`${prefix}-maximum`} step="any" type="number" />
          </label>
        </div>
      </details>
    </fieldset>
  );
}

function CandidateCard({
  busy,
  candidate,
  onResolve,
}: {
  busy: boolean;
  candidate: PlanCandidateAck;
  onResolve: (candidate: PlanCandidateAck, action: "activate" | "discard") => void;
}) {
  return (
    <article className="candidate-card">
      <div>
        <span>CAMBIO PREPARADO · ACTIVACIÓN MANUAL</span>
        <h3>Hay una versión candidata para revisar</h3>
        <p>
          El plan que utilizas sigue activo. Esta propuesta solo afecta a{" "}
          <strong>
            {candidate.diff.affectedModules
              .map((module) => moduleLabels[module])
              .join(", ")}
          </strong>
          .
        </p>
        <dl className="candidate-diff">
          <div>
            <dt>Impacto</dt>
            <dd>
              {candidate.impact === "structural"
                ? "Estructural"
                : candidate.impact === "dependent_modules"
                  ? "Varios módulos relacionados"
                  : "Un módulo"}
            </dd>
          </div>
          <div>
            <dt>Datos considerados</dt>
            <dd>
              {candidate.diff.changedFields
                .map((field) => (field === "labValues" ? "Analíticas" : "Seguimiento"))
                .filter((field, index, list) => list.indexOf(field) === index)
                .join(", ")}
            </dd>
          </div>
          <div>
            <dt>Validación</dt>
            <dd>{candidate.validationStatus === "valid" ? "Válida" : "Provisional"}</dd>
          </div>
        </dl>
      </div>
      <div className="candidate-actions">
        <button
          className="primary-button"
          disabled={busy}
          onClick={() => onResolve(candidate, "activate")}
          type="button"
        >
          Activar esta versión
        </button>
        <button
          className="secondary-button"
          disabled={busy}
          onClick={() => onResolve(candidate, "discard")}
          type="button"
        >
          Descartar propuesta
        </button>
      </div>
    </article>
  );
}

function History({
  entries,
  labs,
}: {
  entries: readonly FollowUpEntry[];
  labs?: LabHistory;
}) {
  const trendLabels = {
    down: "Baja respecto al valor anterior",
    insufficient: "Aún no hay dos valores comparables",
    stable: "Se mantiene estable",
    up: "Sube respecto al valor anterior",
  } as const;
  const interpretationLabels = {
    above_range: "Por encima del rango aportado",
    below_range: "Por debajo del rango aportado",
    unknown: "Sin interpretación disponible",
    within_range: "Dentro del rango aportado",
  } as const;
  const confidenceLabels = {
    high: "Alta",
    low: "Baja",
    medium: "Media",
    unknown: "Desconocida",
  } as const;
  return (
    <section className="follow-section" id="history" aria-labelledby="history-title">
      <div className="follow-section-heading">
        <div>
          <span>PASO 3 · HISTORIAL</span>
          <h2 id="history-title">Evolución registrada</h2>
        </div>
        <p>
          Se conserva todo el historial, usando el valor más reciente y una tendencia
          básica.
        </p>
      </div>

      <div className="history-split">
        <div>
          <h3>Revisiones</h3>
          {entries.length === 0 ? (
            <p className="empty-copy">Todavía no hay revisiones guardadas.</p>
          ) : (
            <ol className="history-list">
              {entries.map((entry) => (
                <li key={entry.id}>
                  <strong>{scopeLabels[entry.scope]}</strong>
                  <span>{new Date(entry.observedAt).toLocaleDateString("es-ES")}</span>
                  <small>
                    {entry.values.common?.adherence
                      ? `Adherencia ${entry.values.common.adherence}/5`
                      : "Registro parcial"}
                    {entry.completeness === "provisional" ? " · Provisional" : ""}
                  </small>
                </li>
              ))}
            </ol>
          )}
        </div>
        <div>
          <h3>Analíticas</h3>
          {!labs || labs.items.length === 0 ? (
            <p className="empty-copy">Todavía no hay valores analíticos guardados.</p>
          ) : (
            <div className="lab-history-list">
              {labs.items.map((item) => (
                <article key={`${item.analyte}-${item.name}`}>
                  <header>
                    <strong>{item.name}</strong>
                    <span>
                      {item.latestValue} {item.unit ?? "unidad no comparable"}
                    </span>
                  </header>
                  <p>{trendLabels[item.trend]}</p>
                  <small>{interpretationLabels[item.interpretation]}</small>
                  <small>
                    Confianza{" "}
                    {confidenceLabels[item.freshness.confidence].toLowerCase()}
                    {item.freshness.ageDays === null
                      ? " · antigüedad desconocida"
                      : ` · ${item.freshness.ageDays} días`}
                  </small>
                </article>
              ))}
            </div>
          )}
        </div>
      </div>
      <p className="follow-disclaimer">
        Las tendencias describen valores introducidos. No predicen resultados ni
        sustituyen una interpretación diagnóstica.
      </p>
    </section>
  );
}

export function FollowUpApp() {
  const [activeModules, setActiveModules] = useState<FollowUpModule[]>([]);
  const [activeVersionId, setActiveVersionId] = useState<string>();
  const [announcement, setAnnouncement] = useState("");
  const [busy, setBusy] = useState(true);
  const [candidates, setCandidates] = useState<PlanCandidateAck[]>([]);
  const [entries, setEntries] = useState<FollowUpEntry[]>([]);
  const [error, setError] = useState<string>();
  const [labs, setLabs] = useState<LabHistory>();
  const [labRows, setLabRows] = useState<LabRow[]>([
    { analyte: "b12", id: 0, measurementKind: "exact" },
  ]);
  const [profiles, setProfiles] = useState<ProfileAccessSummary[]>([]);
  const [profileId, setProfileId] = useState<string>();
  const [scope, setScope] = useState<Scope>("weekly");

  useEffect(() => {
    const previousTitle = document.title;
    document.title = "Seguimiento · Health Design";
    return () => {
      document.title = previousTitle;
    };
  }, []);

  useEffect(() => {
    let active = true;
    accessClient
      .listProfiles()
      .then((items) => {
        if (!active) return;
        setProfiles(items);
        setProfileId(items[0]?.profileId);
      })
      .catch((loadError) => active && setError(errorMessage(loadError)))
      .finally(() => active && setBusy(false));
    return () => {
      active = false;
    };
  }, []);

  async function loadProfile(selectedProfileId: string) {
    setBusy(true);
    setError(undefined);
    setAnnouncement("");
    try {
      const current = await nutritionPlanClient.getCurrent(selectedProfileId);
      const versionId = current.activeVersionId;
      if (!versionId) throw new FollowUpApiError(404, { error: { code: "NOT_FOUND" } });
      const [detail, followUpHistory, labHistory] = await Promise.all([
        nutritionPlanClient.getVersion(current.planId, versionId),
        followUpClient.getFollowUps(selectedProfileId),
        followUpClient.getLabs(selectedProfileId),
      ]);
      const selectedModules = detail.moduleResults
        .filter(
          ({ module, status }) =>
            modules.includes(module) &&
            (status === "valid" || status === "provisional"),
        )
        .map(({ module }) => module);
      setActiveModules(selectedModules);
      setActiveVersionId(versionId);
      setEntries(followUpHistory.entries);
      setLabs(labHistory);
      setCandidates(
        [...followUpHistory.pendingCandidates, ...labHistory.pendingCandidates].filter(
          (candidate, index, list) =>
            list.findIndex(
              ({ candidateId }) => candidateId === candidate.candidateId,
            ) === index,
        ),
      );
    } catch (loadError) {
      setActiveModules([]);
      setActiveVersionId(undefined);
      setEntries([]);
      setLabs(undefined);
      setCandidates([]);
      setError(errorMessage(loadError));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (!profileId) return;
    void loadProfile(profileId);
  }, [profileId]);

  const activeModuleSummary = useMemo(
    () => activeModules.map((module) => moduleLabels[module]).join(" · "),
    [activeModules],
  );

  async function submitFollowUp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!profileId || !activeVersionId) return;
    const formElement = event.currentTarget;
    setBusy(true);
    setError(undefined);
    setAnnouncement("");
    try {
      const form = new FormData(formElement);
      const values = moduleValues(form, activeModules);
      if (scope !== "daily") {
        const symptomModules = activeModules.filter(
          (module) => form.get(`symptom-${module}`) === "on",
        );
        values.common = {
          adherence: Number(value(form, "common-adherence")),
          importantSymptoms:
            symptomModules.length > 0
              ? [{ modules: symptomModules, severity: "important" }]
              : [],
          materialChanges: materialChangeOptions
            .filter(([key]) => form.get(`material-${key}`) === "on")
            .map(([key]) => key),
        };
      }
      const response = await followUpClient.createFollowUp(profileId, {
        basePlanVersionId: activeVersionId,
        observedAt: new Date().toISOString(),
        requestRecalculation: form.get("request-recalculation") === "on",
        schemaVersion: 1,
        scope,
        values,
      });
      let successMessage: string;
      if (response.contextUpdateRequired) {
        successMessage =
          "Revisión guardada como provisional. Completa el cuestionario para concretar el cambio relevante.";
      } else if (response.impact.minorTrainingAdjustmentPercent !== null) {
        const percent = response.impact.minorTrainingAdjustmentPercent;
        successMessage = `Revisión guardada. Recomendación para la siguiente sesión: ${percent > 0 ? "+" : ""}${percent} % de volumen. El plan activo no ha cambiado.`;
      } else if (response.candidate) {
        successMessage =
          "Revisión guardada y propuesta preparada. Debes activarla manualmente si quieres aplicarla.";
      } else {
        successMessage =
          "Revisión guardada. No ha sido necesario cambiar el plan activo.";
      }
      formElement.reset();
      await loadProfile(profileId);
      setAnnouncement(successMessage);
    } catch (submitError) {
      setError(errorMessage(submitError));
      setBusy(false);
    }
  }

  async function submitLabs(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!profileId || !activeVersionId) return;
    const formElement = event.currentTarget;
    setBusy(true);
    setError(undefined);
    setAnnouncement("");
    try {
      const form = new FormData(formElement);
      const response = await followUpClient.createLabs(
        profileId,
        activeVersionId,
        labRows.map((row) => labObservation(form, row)),
        form.get("lab-request-recalculation") === "on",
      );
      const successMessage = response.candidate
        ? "Analíticas guardadas y propuesta preparada. El plan activo sigue sin cambios hasta que la revises."
        : "Analíticas guardadas. No se ha creado una propuesta de cambio.";
      formElement.reset();
      setLabRows([{ analyte: "b12", id: 0, measurementKind: "exact" }]);
      await loadProfile(profileId);
      setAnnouncement(successMessage);
    } catch (submitError) {
      setError(errorMessage(submitError));
      setBusy(false);
    }
  }

  async function resolveCandidate(
    candidate: PlanCandidateAck,
    action: "activate" | "discard",
  ) {
    if (!profileId) return;
    setBusy(true);
    setError(undefined);
    try {
      let successMessage: string;
      if (action === "activate") {
        await followUpClient.activateCandidate(
          candidate.candidateId,
          candidate.aggregateVersion,
        );
        successMessage =
          "La propuesta se ha activado y la versión anterior queda archivada.";
      } else {
        await followUpClient.discardCandidate(
          candidate.candidateId,
          candidate.aggregateVersion,
        );
        successMessage = "La propuesta se ha descartado. Tu plan activo sigue igual.";
      }
      await loadProfile(profileId);
      setAnnouncement(successMessage);
    } catch (candidateError) {
      setError(errorMessage(candidateError));
      setBusy(false);
    }
  }

  return (
    <main className="follow-shell">
      <header className="follow-header">
        <div>
          <p className="eyebrow">HEALTH DESIGN · SEGUIMIENTO ADAPTATIVO</p>
          <h1>Registra lo importante. Cambia solo lo necesario.</h1>
          <p className="lede">
            Una revisión semanal breve, un diario opcional y analíticas manuales. Nada
            modifica tu plan sin que lo confirmes.
          </p>
        </div>
        <div className="follow-profile">
          <label htmlFor="follow-profile">Perfil</label>
          <select
            disabled={busy}
            id="follow-profile"
            onChange={(event) => setProfileId(event.target.value)}
            value={profileId}
          >
            {profiles.map((profile) => (
              <option key={profile.profileId} value={profile.profileId}>
                {profile.alias}
              </option>
            ))}
          </select>
          <a className="text-button" href="/nutrition">
            Ver plan activo
          </a>
          <a className="text-button" href="/questionnaire">
            Revisar contexto
          </a>
        </div>
      </header>

      <nav aria-label="Pasos del seguimiento" className="follow-steps">
        <a href="#review">
          <span>01</span> Revisión
        </a>
        <a href="#labs">
          <span>02</span> Analíticas
        </a>
        <a href="#history">
          <span>03</span> Historial
        </a>
      </nav>

      {error ? (
        <div className="follow-message error-message" role="alert">
          {error}
        </div>
      ) : null}
      <p aria-live="polite" className="follow-announcement" role="status">
        {announcement}
      </p>

      {busy && profiles.length === 0 ? <p role="status">Cargando perfiles…</p> : null}
      {!profiles.length && !busy ? (
        <section className="follow-empty">
          <h2>Necesitas un perfil vinculado</h2>
          <a className="primary-button inline-link" href="/">
            Gestionar acceso
          </a>
        </section>
      ) : null}
      {profiles.length > 0 && !activeVersionId && !busy ? (
        <section className="follow-empty">
          <span>SIN PLAN ACTIVO</span>
          <h2>Activa primero una versión del plan</h2>
          <p>
            El seguimiento siempre se vincula a una versión concreta para conservar su
            trazabilidad.
          </p>
          <a className="primary-button inline-link" href="/nutrition">
            Preparar el plan
          </a>
        </section>
      ) : null}

      {activeVersionId ? (
        <>
          <aside className="follow-active-context">
            <span>PLAN ACTIVO</span>
            <strong>{activeModuleSummary || "Sin módulos de seguimiento"}</strong>
            <small>
              Solo se preguntan los módulos que forman parte de esta versión.
            </small>
          </aside>

          {candidates.map((candidate) => (
            <CandidateCard
              busy={busy}
              candidate={candidate}
              key={candidate.candidateId}
              onResolve={(item, action) => void resolveCandidate(item, action)}
            />
          ))}

          <section
            className="follow-section"
            id="review"
            aria-labelledby="review-title"
          >
            <div className="follow-section-heading">
              <div>
                <span>PASO 1 · 2–3 MINUTOS</span>
                <h2 id="review-title">Revisión del plan</h2>
              </div>
              <p>
                La revisión semanal es el mínimo recomendado. El diario sigue siendo
                completamente opcional.
              </p>
            </div>
            <div
              className="scope-selector"
              role="group"
              aria-label="Frecuencia del registro"
            >
              {(["weekly", "daily", "four_week"] as const).map((item) => (
                <button
                  aria-pressed={scope === item}
                  className={scope === item ? "selected" : ""}
                  key={item}
                  onClick={() => setScope(item)}
                  type="button"
                >
                  {scopeLabels[item]}
                </button>
              ))}
            </div>
            <form onSubmit={(event) => void submitFollowUp(event)}>
              <FollowUpFields activeModules={activeModules} scope={scope} />
              <label className="follow-check request-check">
                <input name="request-recalculation" type="checkbox" />
                <span>
                  Solicitar que se revise si estos datos justifican una propuesta nueva
                </span>
              </label>
              <div className="follow-submit-row">
                <p>
                  Guardar no activa cambios. Si existe impacto material, verás una
                  propuesta separada.
                </p>
                <button className="primary-button" disabled={busy} type="submit">
                  {busy ? "Guardando…" : `Guardar ${scopeLabels[scope].toLowerCase()}`}
                </button>
              </div>
            </form>
          </section>

          <section className="follow-section" id="labs" aria-labelledby="labs-title">
            <div className="follow-section-heading">
              <div>
                <span>PASO 2 · OPCIONAL</span>
                <h2 id="labs-title">Valores analíticos</h2>
              </div>
              <p>
                Introduce entre uno y cuatro valores. Se conserva la fecha aproximada y
                la confianza baja si faltan datos.
              </p>
            </div>
            <form onSubmit={(event) => void submitLabs(event)}>
              <div className="lab-rows">
                {labRows.map((row, index) => (
                  <LabRowFields
                    key={row.id}
                    onChange={(next) =>
                      setLabRows((current) =>
                        current.map((item) => (item.id === next.id ? next : item)),
                      )
                    }
                    {...(index === 0
                      ? {}
                      : {
                          onRemove: () =>
                            setLabRows((current) =>
                              current.filter((item) => item.id !== row.id),
                            ),
                        })}
                    row={row}
                  />
                ))}
              </div>
              {labRows.length < 4 ? (
                <button
                  className="secondary-button add-lab"
                  onClick={() =>
                    setLabRows((current) => [
                      ...current,
                      {
                        analyte: "b12",
                        id: Math.max(...current.map(({ id }) => id)) + 1,
                        measurementKind: "exact",
                      },
                    ])
                  }
                  type="button"
                >
                  Añadir otro valor
                </button>
              ) : null}
              <label className="follow-check request-check">
                <input name="lab-request-recalculation" type="checkbox" />
                <span>
                  Solicitar una revisión del módulo afectado aunque el rango no indique
                  una desviación
                </span>
              </label>
              <div className="follow-submit-row">
                <p>
                  Un valor incompleto se guarda con confianza desconocida; nunca bloquea
                  el resto del plan.
                </p>
                <button className="primary-button" disabled={busy} type="submit">
                  {busy ? "Guardando…" : "Guardar analíticas"}
                </button>
              </div>
            </form>
          </section>

          <History entries={entries} {...(labs ? { labs } : {})} />
        </>
      ) : null}
    </main>
  );
}
