import { useEffect, useMemo, useRef, useState } from "react";

import {
  MobilityPlanSchema,
  TrainingPlanSchema,
  type ExercisePrescriptionContract,
  type MobilityPlanContract,
  type PlanMutationAck,
  type TrainingPlanContract,
} from "@health-design/contracts";

import { accessClient, type ProfileAccessSummary } from "../access/access-client";
import {
  NutritionPlanApiError,
  nutritionPlanClient,
} from "../nutrition/nutrition-client";
import { questionnaireClient } from "../questionnaire/questionnaire-client";

import "../access/access.css";
import "./training.css";

type TrainingView =
  | { kind: "plan"; plan: TrainingPlanContract }
  | { kind: "unavailable"; reason: string }
  | {
      kind: "not_requested";
      reason: "module_not_selected" | "training_disabled_by_user";
    };

const uncertaintyMessages: Readonly<Record<string, string>> = {
  CLINICAL_CONTEXT_MISSING:
    "Falta confirmar el contexto clínico básico. El módulo se mantiene provisional.",
  CLINICAL_RULES_PENDING_T12:
    "Existe contexto clínico o farmacológico aún no modelado en este módulo. La propuesta no se presenta como definitiva.",
  MOBILITY_DISCOMFORT_MISSING: "Falta confirmar si algún movimiento causa molestias.",
  MOBILITY_DISCOMFORT_DETAILS_MISSING:
    "Has indicado molestias, pero falta describirlas. No se genera movilidad hasta identificar la zona afectada.",
  MOBILITY_DISCOMFORT_REVIEW_REQUIRED:
    "Hay molestias declaradas. La propuesta es conservadora y debe revisarse con tu evolución.",
  MOBILITY_CATALOG_COVERAGE_INSUFFICIENT:
    "Las molestias indicadas agotan el catálogo compatible con las zonas declaradas. No se ha añadido una rutina estándar.",
  MOBILITY_DISCOMFORT_UNKNOWN: "Falta confirmar si algún movimiento causa molestias.",
  MOBILITY_DISCOMFORT_UNMAPPED:
    "La molestia descrita no se puede relacionar con seguridad con el catálogo actual. No se propone una rutina genérica.",
  MOBILITY_ANCHORS_MISSING:
    "Falta elegir cuándo encajar la movilidad; se muestran anclajes conservadores que puedes revisar.",
  MOBILITY_ALTERNATIVE_COVERAGE_PARTIAL:
    "Algún movimiento no tiene una alternativa funcional confirmada en el catálogo actual. La rutina sigue visible, pero se mantiene provisional.",
  MOBILITY_AREAS_MISSING:
    "Falta elegir las zonas prioritarias; se muestra un núcleo global provisional.",
  MOBILITY_AREAS_UNMODELED:
    "Alguna zona indicada no pertenece al catálogo actual; se conserva una selección provisional con las zonas reconocidas.",
  MOBILITY_DURATION_MISSING:
    "Falta elegir la duración de movilidad; se muestra un núcleo breve provisional.",
  MOBILITY_SELECTED_AREAS_PARTIAL:
    "La duración y el catálogo compatibles no permiten cubrir todas las zonas elegidas. Se muestran las zonas cubiertas y el módulo sigue provisional.",
  MOBILITY_TRAINING_LIMITATION_REVIEW_REQUIRED:
    "Hay limitaciones de entrenamiento declaradas. La movilidad evita sus zonas relacionadas y se mantiene provisional.",
  MOBILITY_TRAINING_LIMITATIONS_UNKNOWN:
    "Falta confirmar si las limitaciones de entrenamiento también afectan a la movilidad.",
  MOBILITY_TRAINING_LIMITATIONS_MISSING:
    "Falta indicar las limitaciones de entrenamiento necesarias para coordinar la movilidad.",
  MOBILITY_ENGINE_UNAVAILABLE:
    "Las restricciones actuales no dejan una rutina de movilidad validada. Se conserva el módulo como provisional.",
  OWN_TRAINING_CONTEXT_INCOMPLETE:
    "Faltan datos de tu entrenamiento habitual para ajustar el resto del plan con precisión.",
  OWN_TRAINING_ANCHORS_MISSING:
    "Falta indicar cuándo entrenas habitualmente; el resto de módulos conserva esta incertidumbre.",
  TRAINING_DAYS_MISSING:
    "Falta confirmar cuántos días puedes entrenar; se usa una frecuencia conservadora.",
  TRAINING_ALTERNATIVE_COVERAGE_PARTIAL:
    "Algún ejercicio no tiene una alternativa funcional confirmada para esta fase y contexto. El bloque sigue visible, pero se mantiene provisional.",
  TRAINING_CATALOG_COVERAGE_INSUFFICIENT:
    "Las limitaciones indicadas agotan el catálogo compatible con las zonas declaradas. No se ha prescrito una rutina estándar.",
  TRAINING_DURATION_MISSING:
    "Falta confirmar la duración disponible; se usa una sesión breve provisional.",
  TRAINING_DURATION_CATALOG_LIMITED:
    "La disponibilidad supera el bloque validado de esta versión; la sesión se limita a 60 minutos y queda provisional.",
  TRAINING_EQUIPMENT_MISSING:
    "Falta confirmar el material disponible; se priorizan ejercicios sin equipamiento.",
  TRAINING_LEVEL_MISSING:
    "Falta confirmar tu experiencia; el bloque comienza con una progresión conservadora.",
  TRAINING_LIMITATIONS_MISSING:
    "Falta confirmar si tienes alguna limitación para entrenar.",
  TRAINING_LIMITATION_DETAILS_MISSING:
    "Has indicado que existe una limitación, pero falta describirla. No se genera una rutina hasta poder identificar la zona afectada.",
  TRAINING_LIMITATION_REVIEW_REQUIRED:
    "Hay limitaciones declaradas. Se han filtrado los movimientos relacionados con las zonas identificadas, pero el bloque sigue provisional y no acredita seguridad clínica.",
  TRAINING_LIMITATIONS_UNKNOWN: "Falta confirmar si tienes limitaciones para entrenar.",
  TRAINING_LIMITATION_UNMAPPED:
    "La limitación descrita no se puede relacionar con seguridad con el catálogo actual. No se genera una rutina estándar ni se afirma que el patrón esté evitado.",
  TRAINING_STYLE_MISSING:
    "Falta confirmar el estilo preferido; se usa una base general con peso corporal.",
  TRAINING_STYLE_OTHER_UNMODELED:
    "La modalidad descrita todavía no tiene reglas propias; se ofrece una base conservadora de peso corporal para revisión.",
  TRAINING_ENGINE_UNAVAILABLE:
    "Las restricciones actuales no dejan una rutina compatible con los datos declarados. No se ha prescrito una rutina estándar.",
};

const levelLabels: Readonly<Record<string, string>> = {
  advanced: "Avanzado",
  beginner: "Principiante",
  intermediate: "Intermedio",
  unknown: "Sin confirmar",
};

const intensityLabels: Readonly<Record<string, string>> = {
  high: "Alta",
  low: "Baja",
  moderate: "Moderada",
  variable: "Variable",
};

const trainingTypeLabels: Readonly<Record<string, string>> = {
  bodyweight: "Calistenia / peso corporal",
  endurance: "Resistencia",
  functional_hiit: "Funcional / HIIT",
  hypertrophy: "Hipertrofia",
  no_preference: "Sin preferencia",
  other: "Otra modalidad",
  pilates: "Pilates",
  sport_preparation: "Preparación para deporte",
  strength: "Fuerza",
  strength_hypertrophy: "Fuerza e hipertrofia",
  yoga: "Yoga",
};

const anchorLabels: Readonly<Record<string, string>> = {
  after_training: "al terminar de entrenar",
  before_training: "antes de entrenar",
  daily_break: "en una pausa del día",
  evening: "por la noche",
  morning: "por la mañana",
};

const equipmentLabels: Readonly<Record<string, string>> = {
  full_gym: "Gimnasio completo",
  home_basic: "Bandas o mancuernas",
  none: "Sin material",
};

const ownAnchorLabels: Readonly<Record<string, string>> = {
  afternoon: "Tarde",
  early_morning: "Primera hora",
  evening: "Noche",
  midday: "Mediodía",
  morning: "Mañana",
  variable: "Horario variable",
};

const objectiveLabels: Readonly<Record<string, string>> = {
  body_composition_gain_muscle: "Aumentar masa muscular",
  body_composition_lose_fat: "Perder grasa",
  body_composition_maintain: "Mantener composición",
  body_composition_recomposition: "Recomposición corporal",
  performance_endurance: "Mejorar resistencia",
  performance_general_fitness: "Mejorar condición general",
  performance_hypertrophy: "Mejorar hipertrofia",
  performance_strength: "Mejorar fuerza",
  wellbeing_energy: "Mejorar energía",
  wellbeing_healthy_habits: "Consolidar hábitos",
  wellbeing_sleep: "Mejorar descanso",
  wellbeing_stress: "Gestionar estrés",
};

function errorMessage(error: unknown): string {
  if (error instanceof NutritionPlanApiError) {
    if (error.code === "DRAFT_NOT_SUBMITTED") {
      return "Confirma primero el cuestionario de este perfil.";
    }
    if (error.code === "VERSION_CONFLICT") {
      return "Este perfil cambió en otro dispositivo. Recarga antes de repetir la operación.";
    }
  }
  return "No se ha podido generar el plan de movimiento. No se ha activado ningún cambio.";
}

function codeFrom(value: unknown): string | undefined {
  if (value === null || typeof value !== "object" || !("code" in value)) {
    return undefined;
  }
  return typeof value.code === "string" ? value.code : undefined;
}

function readableUncertainty(code: string): string {
  return (
    uncertaintyMessages[code] ??
    "Hay información pendiente. La propuesta se mantiene provisional hasta revisarla."
  );
}

function trainingTypes(values: readonly string[]): string {
  return values.map((value) => trainingTypeLabels[value] ?? value).join(", ");
}

function notRequestedReason(
  payload: Record<string, unknown>,
): "module_not_selected" | "training_disabled_by_user" {
  return payload["reason"] === "training_disabled_by_user"
    ? "training_disabled_by_user"
    : "module_not_selected";
}

function Uncertainties({ codes, label }: { codes: readonly string[]; label: string }) {
  const uniqueCodes = [...new Set(codes)];
  if (uniqueCodes.length === 0) return null;
  return (
    <section className="movement-uncertainties" aria-label={label} role="status">
      <div>
        <span>PLAN PROVISIONAL</span>
        <h3>Información pendiente</h3>
      </div>
      <ul>
        {uniqueCodes.map((code) => (
          <li key={code}>{readableUncertainty(code)}</li>
        ))}
      </ul>
    </section>
  );
}

function ExerciseVisual({ alt, src }: { alt: string; src: string }) {
  const [failed, setFailed] = useState(false);

  useEffect(() => setFailed(false), [src]);

  if (failed) {
    return (
      <div className="exercise-visual-fallback" aria-label={alt} role="img">
        <strong>Guía visual no disponible</strong>
        <span>Sigue los pasos escritos junto al ejercicio.</span>
      </div>
    );
  }
  return (
    <img
      alt={alt}
      className="exercise-visual"
      decoding="async"
      loading="lazy"
      onError={() => setFailed(true)}
      src={src}
    />
  );
}

function ExerciseCard({
  exercise,
  phase,
}: {
  exercise: ExercisePrescriptionContract;
  phase: "Activación" | "Bloque principal" | "Vuelta a la calma";
}) {
  return (
    <article className="exercise-card">
      <ExerciseVisual alt={exercise.visual.alt} src={exercise.visual.src} />
      <div className="exercise-copy">
        <header>
          <span>{phase}</span>
          <h5>{exercise.name}</h5>
        </header>
        <dl className="exercise-dose">
          <div>
            <dt>Series</dt>
            <dd>{exercise.sets}</dd>
          </div>
          <div>
            <dt>Cantidad</dt>
            <dd>
              {exercise.repetitions ?? `${exercise.durationSeconds ?? 0} segundos`}
            </dd>
          </div>
          <div>
            <dt>Descanso</dt>
            <dd>{exercise.restSeconds} s</dd>
          </div>
          {exercise.rpe !== undefined ? (
            <div>
              <dt>Esfuerzo</dt>
              <dd>
                RPE {exercise.rpe} · RIR {exercise.rir}
              </dd>
            </div>
          ) : null}
        </dl>
        <ol className="exercise-steps">
          {exercise.steps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
        <p className="technique-cue">{exercise.technique}</p>
        <p className="exercise-alternatives">
          {exercise.alternatives.length ? (
            <>
              <strong>Alternativas funcionales:</strong>{" "}
              {exercise.alternatives.map(({ name }) => name).join(" o ")}. Mantén las
              mismas series, cantidad, descanso y esfuerzo de esta tarjeta.
            </>
          ) : (
            "Sin alternativa funcional confirmada para esta fase y contexto."
          )}
        </p>
        <details className="exercise-details">
          <summary>Ritmo, progresión y términos</summary>
          <p>
            <strong>Ritmo:</strong> {exercise.tempo}
          </p>
          <p>
            <strong>Cómo progresar:</strong> {exercise.progression}
          </p>
          <dl>
            {exercise.technicalTerms.map(({ explanation, term }) => (
              <div key={term}>
                <dt>{term}</dt>
                <dd>{explanation}</dd>
              </div>
            ))}
          </dl>
        </details>
      </div>
    </article>
  );
}

function GeneratedTraining({
  plan,
}: {
  plan: Extract<TrainingPlanContract, { mode: "generated" }>;
}) {
  return (
    <section className="generated-training" aria-labelledby="training-block-title">
      <header className="section-heading">
        <div>
          <span>ENTRENAMIENTO GENERADO</span>
          <h2 id="training-block-title">Bloque de 4 semanas</h2>
        </div>
        <p>
          La cuarta semana reduce el volumen para consolidar lo aprendido antes de
          generar un bloque nuevo.
        </p>
      </header>

      <section className="movement-metrics" aria-label="Resumen del entrenamiento">
        <article>
          <span>Días por semana</span>
          <strong>{plan.availability.daysPerWeek}</strong>
        </article>
        <article>
          <span>Duración máxima estimada</span>
          <strong>
            ≈ {plan.availability.sessionMinutes} min
            {plan.availability.requestedSessionMinutes !==
            plan.availability.sessionMinutes
              ? ` de ${plan.availability.requestedSessionMinutes} disponibles`
              : ""}
          </strong>
        </article>
        <article>
          <span>Experiencia</span>
          <strong>{levelLabels[plan.availability.level]}</strong>
        </article>
        <article>
          <span>Estilo base</span>
          <strong>
            {trainingTypes(plan.availability.styles)}
            {plan.availability.otherStyle ? ` · ${plan.availability.otherStyle}` : ""}
          </strong>
        </article>
        <article>
          <span>Material aplicado</span>
          <strong>
            {plan.availability.equipment
              .map((item) => equipmentLabels[item] ?? item)
              .join(", ")}
          </strong>
        </article>
        <article>
          <span>Objetivo registrado</span>
          <strong>
            {plan.availability.primaryObjective
              ? (objectiveLabels[plan.availability.primaryObjective] ??
                plan.availability.primaryObjective)
              : "Sin confirmar"}
          </strong>
        </article>
      </section>

      <Uncertainties
        codes={plan.uncertainties.map(({ code }) => code)}
        label="Incertidumbres del entrenamiento"
      />

      <div className="week-list">
        {plan.weeks.map((week) => (
          <details className="training-week" key={week.week} open={week.week === 1}>
            <summary>
              <span>0{week.week}</span>
              <h3>Semana {week.week}</h3>
              <small>{week.sessions.length} sesiones</small>
            </summary>
            <div className="session-listing">
              {week.sessions.map((session, sessionIndex) => (
                <details
                  className="training-session"
                  key={session.id}
                  open={week.week === 1 && sessionIndex === 0}
                >
                  <summary>
                    <span>
                      Sesión {sessionIndex + 1} · Día {session.day}
                    </span>
                    <h4>{session.focus}</h4>
                    <small>≈ {session.durationMinutes} minutos</small>
                  </summary>
                  <div className="session-body">
                    {session.recoveryRole === "reduced_load" ? (
                      <p className="session-recovery">
                        Día de carga reducida para limitar la repetición acumulada.
                      </p>
                    ) : null}
                    <p className="session-progression">{session.progression}</p>
                    {session.warmup.map((exercise) => (
                      <ExerciseCard
                        exercise={exercise}
                        key={`warmup-${exercise.exerciseId}`}
                        phase="Activación"
                      />
                    ))}
                    {session.main.map((exercise, exerciseIndex) => (
                      <ExerciseCard
                        exercise={exercise}
                        key={`main-${exercise.exerciseId}-${exerciseIndex}`}
                        phase="Bloque principal"
                      />
                    ))}
                    {session.cooldown.map((exercise) => (
                      <ExerciseCard
                        exercise={exercise}
                        key={`cooldown-${exercise.exerciseId}`}
                        phase="Vuelta a la calma"
                      />
                    ))}
                  </div>
                </details>
              ))}
            </div>
          </details>
        ))}
      </div>
    </section>
  );
}

function OwnTraining({
  plan,
}: {
  plan: Extract<TrainingPlanContract, { mode: "own" }>;
}) {
  const context = plan.weeklyContext;
  return (
    <section className="movement-state" aria-labelledby="own-training-title">
      <span>ENTRENAMIENTO PROPIO</span>
      <h2 id="own-training-title">Tu entrenamiento se mantiene</h2>
      <p>
        No generamos sesiones nuevas. La carga ajusta de forma acotada el centro
        nutricional y el resto queda registrado como contexto para sus módulos.
      </p>
      <dl className="own-context">
        <div>
          <dt>Frecuencia</dt>
          <dd>
            {context.daysPerWeek ? `${context.daysPerWeek} días/semana` : "Pendiente"}
          </dd>
        </div>
        <div>
          <dt>Duración</dt>
          <dd>
            {context.sessionMinutes ? `${context.sessionMinutes} min` : "Pendiente"}
          </dd>
        </div>
        <div>
          <dt>Intensidad</dt>
          <dd>
            {context.intensity ? intensityLabels[context.intensity] : "Pendiente"}
          </dd>
        </div>
        <div>
          <dt>Tipos</dt>
          <dd>{context.types.length ? trainingTypes(context.types) : "Pendiente"}</dd>
        </div>
        <div>
          <dt>Horario</dt>
          <dd>
            {context.anchors.length
              ? context.anchors
                  .map((anchor) => ownAnchorLabels[anchor] ?? anchor)
                  .join(", ")
              : "Pendiente"}
          </dd>
        </div>
      </dl>
      <ul className="adaptation-list">
        <li>
          <strong>Ajuste nutricional aplicado</strong>
          <span>{plan.adaptations.nutrition}</span>
        </li>
        <li>
          <strong>Contexto para hidratación · T12</strong>
          <span>{plan.adaptations.hydration}</span>
        </li>
        <li>
          <strong>Contexto para descanso · T12</strong>
          <span>{plan.adaptations.sleep}</span>
        </li>
        <li>
          <strong>Contexto para movilidad</strong>
          <span>{plan.adaptations.mobility}</span>
        </li>
      </ul>
      <Uncertainties
        codes={plan.uncertainties.map(({ code }) => code)}
        label="Incertidumbres del entrenamiento propio"
      />
    </section>
  );
}

function NoTraining({
  reason,
}: {
  reason: "module_not_selected" | "training_disabled_by_user";
}) {
  return (
    <section className="movement-state quiet" aria-labelledby="no-training-title">
      <span>ENTRENAMIENTO OPCIONAL</span>
      <h2 id="no-training-title">
        {reason === "training_disabled_by_user"
          ? "Sin rutina de entrenamiento"
          : "Entrenamiento no seleccionado"}
      </h2>
      <p>
        No se han creado sesiones ni métricas de rendimiento. Los demás módulos
        conservan esta elección como contexto; T12 completará hidratación, sueño y
        reglas clínicas.
      </p>
    </section>
  );
}

function MobilityItem({ item }: { item: MobilityPlanContract["core"][number] }) {
  return (
    <article className="mobility-item">
      <ExerciseVisual alt={item.visual.alt} src={item.visual.src} />
      <div>
        <span>{item.durationSeconds} segundos</span>
        <h4>{item.name}</h4>
        <ol>
          {item.steps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
        <p>{item.technique}</p>
        <small>
          {item.alternatives.length
            ? `Alternativas funcionales: ${item.alternatives
                .map(({ name }) => name)
                .join(" o ")}.`
            : "Sin alternativa funcional confirmada en el catálogo actual."}
        </small>
      </div>
    </article>
  );
}

function MobilityRoutine({ plan }: { plan: MobilityPlanContract }) {
  const [minutes, setMinutes] = useState(plan.totalMinutes);
  const availableMinutes = useMemo(
    () => [5, ...plan.extensions.map((_, index) => (index + 2) * 5)],
    [plan.extensions],
  );
  const visibleExtensions = Math.max(0, (minutes - 5) / 5);

  useEffect(() => setMinutes(plan.totalMinutes), [plan]);

  return (
    <section className="mobility-routine" aria-labelledby="mobility-title">
      <header className="section-heading">
        <div>
          <span>MOVILIDAD MODULAR</span>
          <h2 id="mobility-title">Movilidad diaria</h2>
        </div>
        <p>
          Haz siempre el núcleo de cinco minutos. Amplíalo solo cuando tengas tiempo y
          te resulte cómodo.
        </p>
      </header>

      <fieldset className="mobility-duration">
        <legend>Elige cuánto hacer hoy</legend>
        <div>
          {availableMinutes.map((option) => (
            <button
              aria-pressed={minutes === option}
              key={option}
              onClick={() => setMinutes(option as 5 | 10 | 15)}
              type="button"
            >
              {option} min
            </button>
          ))}
        </div>
      </fieldset>

      <Uncertainties
        codes={plan.uncertainties.map(({ code }) => code)}
        label="Incertidumbres de movilidad"
      />

      <section className="mobility-block" aria-labelledby="mobility-core-title">
        <header>
          <span>NÚCLEO · 5 MIN</span>
          <h3 id="mobility-core-title">La parte que siempre se mantiene</h3>
        </header>
        <div className="mobility-grid">
          {plan.core.map((item) => (
            <MobilityItem item={item} key={item.exerciseId} />
          ))}
        </div>
      </section>

      {plan.extensions.slice(0, visibleExtensions).map((extension, index) => (
        <section
          className="mobility-block extension"
          key={`${extension.label}-${index}`}
        >
          <header>
            <span>EXTENSIÓN · +5 MIN</span>
            <h3>{extension.label}</h3>
          </header>
          <div className="mobility-grid">
            {extension.exercises.map((item) => (
              <MobilityItem item={item} key={`${index}-${item.exerciseId}`} />
            ))}
          </div>
        </section>
      ))}

      <p className="mobility-anchors">
        <strong>
          {plan.anchorSource === "selected"
            ? "Anclajes seleccionados:"
            : "Anclajes sugeridos:"}
        </strong>{" "}
        {plan.suggestedAnchors.map((anchor) => anchorLabels[anchor]).join(" o ")}.
      </p>
    </section>
  );
}

export function TrainingApp() {
  const [ack, setAck] = useState<PlanMutationAck>();
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string>();
  const [mobility, setMobility] = useState<MobilityPlanContract>();
  const [mobilityIssue, setMobilityIssue] = useState<string>();
  const [profiles, setProfiles] = useState<ProfileAccessSummary[]>([]);
  const [profileId, setProfileId] = useState<string>();
  const [training, setTraining] = useState<TrainingView>();
  const [announcement, setAnnouncement] = useState("");
  const resultHeadingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    const previousTitle = document.title;
    document.title = "Entrenamiento y movilidad · Health Design";
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

  useEffect(() => {
    setAck(undefined);
    setError(undefined);
    setMobility(undefined);
    setMobilityIssue(undefined);
    setTraining(undefined);
    setAnnouncement("");
  }, [profileId]);

  async function generate() {
    if (!profileId) return;
    setBusy(true);
    setError(undefined);
    setMobility(undefined);
    setMobilityIssue(undefined);
    setTraining(undefined);
    setAnnouncement("");
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
      const trainingResult = detail.moduleResults.find(
        ({ module }) => module === "training",
      );
      const mobilityResult = detail.moduleResults.find(
        ({ module }) => module === "mobility",
      );

      setAck(mutation);
      if (!trainingResult || trainingResult.status === "not_requested") {
        setTraining({
          kind: "not_requested",
          reason: notRequestedReason(trainingResult?.payload ?? {}),
        });
      } else {
        const parsed = TrainingPlanSchema.safeParse(trainingResult.payload);
        setTraining(
          parsed.success
            ? { kind: "plan", plan: parsed.data }
            : {
                kind: "unavailable",
                reason:
                  trainingResult.uncertainties.map(codeFrom).find(Boolean) ??
                  "TRAINING_ENGINE_UNAVAILABLE",
              },
        );
      }

      if (mobilityResult && mobilityResult.status !== "not_requested") {
        const parsed = MobilityPlanSchema.safeParse(mobilityResult.payload);
        if (parsed.success) setMobility(parsed.data);
        else {
          setMobilityIssue(
            mobilityResult.uncertainties.map(codeFrom).find(Boolean) ??
              "MOBILITY_ENGINE_UNAVAILABLE",
          );
        }
      }
      setAnnouncement("Plan de movimiento generado y listo para revisar.");
    } catch (generationError) {
      setError(errorMessage(generationError));
    } finally {
      setBusy(false);
    }
  }

  async function activate() {
    if (!ack) return;
    setBusy(true);
    setError(undefined);
    try {
      const activated = await nutritionPlanClient.activateVersion(
        ack.planId,
        ack.planVersionId,
        ack.aggregateVersion,
      );
      setAck(activated);
      setAnnouncement("Plan activo. Esta versión ya es la seleccionada.");
    } catch (activationError) {
      setError(errorMessage(activationError));
    } finally {
      setBusy(false);
    }
  }

  const hasResult = Boolean(training || mobility || mobilityIssue);

  useEffect(() => {
    if (hasResult && ack?.status === "draft") {
      resultHeadingRef.current?.focus();
    }
  }, [ack?.status, hasResult]);

  return (
    <main className="training-shell">
      <header className="training-header">
        <div>
          <p className="eyebrow">HEALTH DESIGN · MOVIMIENTO T11</p>
          <h1>Entrenamiento y movilidad</h1>
          <p className="lede">
            Una guía ejecutable, progresiva y explicada sin dar por supuesto que conoces
            los tecnicismos.
          </p>
        </div>
        <div className="training-profile">
          <label htmlFor="training-profile">Perfil</label>
          <select
            disabled={busy}
            id="training-profile"
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
          <a className="text-button" href="/nutrition">
            Ver alimentación
          </a>
          <a className="text-button" href="/wellness">
            Ver bienestar
          </a>
        </div>
      </header>

      {error ? (
        <div className="message error-message movement-message" role="alert">
          {error}
        </div>
      ) : null}

      {busy && profiles.length === 0 ? <p role="status">Cargando perfiles…</p> : null}

      {!profiles.length && !busy ? (
        <section className="movement-empty">
          <h2>Necesitas un perfil vinculado</h2>
          <a className="primary-button inline-link" href="/">
            Gestionar acceso
          </a>
        </section>
      ) : null}

      {profiles.length > 0 && !hasResult ? (
        <section className="movement-empty">
          <span>ÚLTIMO CUESTIONARIO CONFIRMADO</span>
          <h2>Prepara tu plan de movimiento</h2>
          <p>
            Si elegiste entrenamiento propio o ninguno, esa decisión se respetará sin
            generar sesiones nuevas.
          </p>
          <button
            className="primary-button"
            disabled={busy}
            onClick={() => void generate()}
            type="button"
          >
            {busy ? "Generando…" : "Generar plan de movimiento"}
          </button>
        </section>
      ) : null}

      {ack && hasResult ? (
        <section aria-labelledby="movement-result-title" className="movement-toolbar">
          <div>
            <span>
              {ack.completeness === "complete" ? "PLAN COMPLETO" : "PLAN PROVISIONAL"}
            </span>
            <h2 id="movement-result-title" ref={resultHeadingRef} tabIndex={-1}>
              {ack.status === "active"
                ? `Versión ${ack.ordinal} activa`
                : `Versión ${ack.ordinal} lista para revisar`}
            </h2>
          </div>
          <button
            className="primary-button"
            disabled={busy || ack.status === "active"}
            onClick={() => void activate()}
            type="button"
          >
            {ack.status === "active" ? "Plan activo" : "Activar plan"}
          </button>
          <p
            aria-atomic="true"
            aria-live="polite"
            className="movement-announcement"
            role="status"
          >
            {announcement}
          </p>
        </section>
      ) : null}

      {training?.kind === "plan" && training.plan.mode === "generated" ? (
        <GeneratedTraining plan={training.plan} />
      ) : null}
      {training?.kind === "plan" && training.plan.mode === "own" ? (
        <OwnTraining plan={training.plan} />
      ) : null}
      {training?.kind === "plan" && training.plan.mode === "none" ? (
        <NoTraining reason="training_disabled_by_user" />
      ) : null}
      {training?.kind === "not_requested" ? (
        <NoTraining reason={training.reason} />
      ) : null}
      {training?.kind === "unavailable" ? (
        <section className="movement-state" role="status">
          <span>ENTRENAMIENTO PROVISIONAL</span>
          <h2>El entrenamiento necesita revisión</h2>
          <p>{readableUncertainty(training.reason)}</p>
        </section>
      ) : null}

      {mobility ? <MobilityRoutine plan={mobility} /> : null}
      {mobilityIssue ? (
        <section className="movement-state" role="status">
          <span>MOVILIDAD PROVISIONAL</span>
          <h2>La movilidad necesita revisión</h2>
          <p>{readableUncertainty(mobilityIssue)}</p>
        </section>
      ) : null}
    </main>
  );
}
