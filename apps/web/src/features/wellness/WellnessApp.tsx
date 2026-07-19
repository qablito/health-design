import { useEffect, useRef, useState } from "react";

import type {
  ActionLevel,
  ClinicalCoverage,
  HydrationPlanContract,
  LabSummary,
  PlanMutationAck,
  SleepPlanContract,
  SupplementExperimentalOption,
  SupplementRecommendation,
  SupplementsPlanContract,
} from "@health-design/contracts";

import { accessClient, type ProfileAccessSummary } from "../access/access-client";
import {
  nutritionPlanClient,
  NutritionPlanApiError,
} from "../nutrition/nutrition-client";
import { questionnaireClient } from "../questionnaire/questionnaire-client";
import {
  clinicalFindingLabel,
  readWellnessModules,
  supplementDisplayName,
  wellnessUncertaintyLabel,
  type WellnessModules,
} from "./wellness-view";

import "../access/access.css";
import "./wellness.css";

const anchorLabels: Readonly<Record<string, string>> = {
  after_training: "Después de entrenar",
  afternoon: "Por la tarde",
  before_training: "Antes de entrenar",
  evening: "Por la noche",
  midday: "A mediodía",
  morning: "Por la mañana",
  wake_up: "Al despertar",
  with_meals: "Con las comidas",
};

const strategyLabels: Readonly<
  Record<SleepPlanContract["strategies"][number], string>
> = {
  clinical_context_review: "Mantener la rutina subordinada al contexto clínico.",
  maintain_current_window: "Mantener la oportunidad de sueño actual.",
  protect_sleep_opportunity: "Proteger una oportunidad de sueño más amplia.",
  record_schedule: "Registrar hora de acostarse y de levantarse si resulta útil.",
  review_long_duration_context:
    "Revisar el contexto de una duración larga sin considerarla patológica por sí sola.",
  review_routine_and_environment: "Revisar rutina y entorno de descanso.",
  stabilize_wake_time: "Buscar una hora de levantarse más estable.",
  target_window_7_9h: "Usar 7–9 horas como ventana orientativa para adultos.",
  trend_manual_estimates_only:
    "Tratar las fases registradas como estimaciones manuales, no como mediciones diagnósticas.",
};

const qualityLabels: Readonly<
  Record<NonNullable<SleepPlanContract["quality"]>, string>
> = {
  fair: "Aceptable",
  good: "Buena",
  poor: "Mala",
  very_good: "Muy buena",
  very_poor: "Muy mala",
};

const regularityLabels: Readonly<
  Record<NonNullable<SleepPlanContract["regularity"]>, string>
> = {
  regular: "Regular",
  somewhat_variable: "Algo variable",
  very_variable: "Muy variable",
};

const evidenceLabels: Readonly<Record<SupplementRecommendation["evidence"], string>> = {
  high: "Alta",
  insufficient: "Insuficiente",
  limited: "Limitada",
  moderate: "Moderada",
};

const confidenceLabels: Readonly<
  Record<SupplementRecommendation["confidence"], string>
> = {
  high: "Alta",
  low: "Baja",
  medium: "Media",
};

const actionLabels: Readonly<Record<SupplementRecommendation["action"], string>> = {
  information_only: "Solo información",
  review_later: "Revisión posterior",
  review_required: "Revisión necesaria antes de probar",
  trial_candidate: "Candidata para una prueba controlada",
};

const clinicalActionLabels: Readonly<Record<ActionLevel, string>> = {
  adjustment: "Ajuste contextual",
  immediate_conservative: "Enfoque conservador inmediato",
  information: "Información",
  priority_review: "Revisión prioritaria",
};

const coverageLabels: Readonly<Record<ClinicalCoverage, string>> = {
  modeled: "Modelada",
  partial: "Parcial",
  unmodeled: "No modelada",
};

const actionOrder: readonly ActionLevel[] = [
  "information",
  "adjustment",
  "priority_review",
  "immediate_conservative",
];

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function planStorageKey(profileId: string): string {
  return `health-design:wellness-plan:${profileId}`;
}

function storedPlanId(profileId: string): string | undefined {
  const planId = sessionStorage.getItem(planStorageKey(profileId)) ?? undefined;
  return planId && UUID_PATTERN.test(planId) ? planId : undefined;
}

function rememberPlan(profileId: string, planId: string): void {
  sessionStorage.setItem(planStorageKey(profileId), planId);
}

function errorMessage(error: unknown): string {
  if (error instanceof NutritionPlanApiError) {
    if (error.code === "DRAFT_NOT_SUBMITTED") {
      return "Confirma primero el cuestionario de este perfil.";
    }
    if (error.code === "VERSION_CONFLICT") {
      return "El perfil cambió en otro dispositivo. Recarga antes de repetir la operación.";
    }
  }
  return "No se ha podido generar el plan. No se ha activado ningún cambio.";
}

function stateLabel(status: "valid" | "provisional" | "not_requested") {
  if (status === "valid") return "Completo";
  if (status === "provisional") return "Provisional";
  return "No solicitado";
}

function ModuleState({
  status,
  uncertaintyCount,
}: {
  status: "valid" | "provisional" | "not_requested";
  uncertaintyCount: number;
}) {
  return (
    <div className={`wellness-state ${status}`}>
      <strong>{stateLabel(status)}</strong>
      {uncertaintyCount > 0 ? (
        <span>{uncertaintyCount} datos o restricciones pendientes de revisión</span>
      ) : null}
    </div>
  );
}

function uncertaintyLabel(value: unknown): string {
  if (typeof value === "string") return wellnessUncertaintyLabel(value);
  if (value && typeof value === "object" && "code" in value) {
    const code = (value as { code?: unknown }).code;
    if (typeof code === "string") return wellnessUncertaintyLabel(code);
  }
  return wellnessUncertaintyLabel("");
}

function strictestAction(
  fallback: ActionLevel | undefined,
  findings: WellnessModules["safetyFindings"],
): ActionLevel | undefined {
  return findings.reduce<ActionLevel | undefined>((current, finding) => {
    if (!current) return finding.actionLevel;
    return actionOrder.indexOf(finding.actionLevel) > actionOrder.indexOf(current)
      ? finding.actionLevel
      : current;
  }, fallback);
}

function ClinicalReview({
  actionLevel,
  clinicalCoverage,
  findingCodes,
  findings,
  uncertainties,
}: {
  actionLevel: ActionLevel | undefined;
  clinicalCoverage: ClinicalCoverage | undefined;
  findingCodes: string[];
  findings: WellnessModules["safetyFindings"];
  uncertainties: unknown[];
}) {
  const messages = [
    ...uncertainties.map(uncertaintyLabel),
    ...findingCodes.map(clinicalFindingLabel),
    ...findings.map(({ code }) => clinicalFindingLabel(code)),
  ].filter((item, index, values) => values.indexOf(item) === index);
  const effectiveAction = strictestAction(actionLevel, findings);
  if (!effectiveAction && !clinicalCoverage && messages.length === 0) return null;
  return (
    <aside className="clinical-review" aria-label="Revisión e incertidumbres">
      <div>
        {clinicalCoverage ? (
          <span>
            Cobertura clínica <strong>{coverageLabels[clinicalCoverage]}</strong>
          </span>
        ) : null}
        {effectiveAction ? (
          <span>
            Nivel de acción <strong>{clinicalActionLabels[effectiveAction]}</strong>
          </span>
        ) : null}
      </div>
      {messages.length > 0 ? (
        <ul>
          {messages.map((message) => (
            <li key={message}>{message}</li>
          ))}
        </ul>
      ) : (
        <p>Sin incertidumbres clínicas identificadas para este módulo.</p>
      )}
    </aside>
  );
}

function effectiveStatus(
  payloadStatus: "valid" | "provisional" | "not_requested",
  moduleStatus: WellnessModules["moduleStatuses"]["hydration"],
) {
  return moduleStatus === "provisional" ? "provisional" : payloadStatus;
}

function ModuleUnavailable({
  invalid = false,
  title,
}: {
  invalid?: boolean;
  title: string;
}) {
  return (
    <section className="wellness-module quiet" aria-label={title}>
      <div className="wellness-section-heading">
        <div>
          <span>{invalid ? "RESULTADO DESCARTADO" : "NO INCLUIDO"}</span>
          <h2>{title}</h2>
        </div>
        <p>
          {invalid
            ? "El resultado no cumple el contrato y no se muestra como un plan."
            : "Este módulo no forma parte del último contexto confirmado."}
        </p>
      </div>
    </section>
  );
}

function HydrationSection({
  findings,
  moduleStatus,
  moduleUncertainties,
  plan,
}: {
  findings: WellnessModules["safetyFindings"];
  moduleStatus: WellnessModules["moduleStatuses"]["hydration"];
  moduleUncertainties: unknown[];
  plan: HydrationPlanContract;
}) {
  if (plan.status === "not_requested") {
    return <ModuleUnavailable title="Hidratación" />;
  }
  const status = effectiveStatus(plan.status, moduleStatus);
  const uncertainties = [...plan.uncertainties, ...moduleUncertainties];
  const reviewCount = new Set([
    ...uncertainties.map(uncertaintyLabel),
    ...plan.safetyFindings.map(clinicalFindingLabel),
    ...findings.map(({ code }) => clinicalFindingLabel(code)),
  ]).size;
  return (
    <section className="wellness-module" aria-labelledby="hydration-title">
      <div className="wellness-section-heading">
        <div>
          <span>HIDRATACIÓN</span>
          <h2 id="hydration-title">Agua total y bebidas</h2>
        </div>
        <ModuleState status={status} uncertaintyCount={reviewCount} />
      </div>

      <ClinicalReview
        actionLevel={plan.strictestActionLevel}
        clinicalCoverage={plan.clinicalCoverage}
        findingCodes={plan.safetyFindings}
        findings={findings}
        uncertainties={uncertainties}
      />

      <div className="wellness-metrics" aria-label="Referencias de hidratación">
        <article>
          <span>Agua total de referencia</span>
          <strong>{plan.totalReferenceMl.center} ml</strong>
          <small>
            Banda {plan.totalReferenceMl.minimum}–{plan.totalReferenceMl.maximum} ml
          </small>
        </article>
        <article>
          <span>Bebidas propuestas</span>
          {plan.beverageBandMl ? (
            <>
              <strong>{plan.beverageBandMl.center} ml</strong>
              <small>
                Banda {plan.beverageBandMl.minimum}–{plan.beverageBandMl.maximum} ml
              </small>
            </>
          ) : (
            <>
              <strong>Sin cifra operativa</strong>
              <small>La restricción o el contexto pendiente prevalecen.</small>
            </>
          )}
        </article>
        <article>
          <span>Agua habitual registrada</span>
          <strong>
            {plan.habitualWaterMl === null
              ? "No indicada"
              : `${plan.habitualWaterMl} ml`}
          </strong>
          <small>Dato aportado por el usuario</small>
        </article>
        <article>
          <span>Estimación desde alimentos</span>
          <strong>{Math.round(plan.foodWaterEstimate.center * 100)} %</strong>
          <small>
            Rango interno {Math.round(plan.foodWaterEstimate.minimum * 100)}–
            {Math.round(plan.foodWaterEstimate.maximum * 100)} %
          </small>
        </article>
      </div>

      <div className="wellness-split">
        <article className="wellness-panel">
          <h3>Anclajes flexibles</h3>
          <ul className="anchor-list">
            {plan.anchors.map((anchor) => (
              <li key={anchor}>{anchorLabels[anchor] ?? "Momento seleccionado"}</li>
            ))}
          </ul>
          <p>
            Recordatorios:{" "}
            <strong>{plan.reminders ? "activados" : "desactivados"}</strong>. Los
            anclajes funcionan sin notificaciones del sistema operativo.
          </p>
        </article>
        <article className="wellness-panel">
          <h3>Bebidas y electrolitos</h3>
          <p>
            {plan.proposedBeverages.length > 0
              ? `Propuesta: ${plan.proposedBeverages.join(", ")}.`
              : "No hay una propuesta operativa de bebidas mientras falte contexto."}
          </p>
          <p>
            Café, té y leche pueden contar dentro de las bebidas registradas; el alcohol
            queda fuera de la propuesta.
          </p>
          <p>
            Electrolitos:{" "}
            {plan.electrolyteStrategy === "contextual_review"
              ? "revisión contextual por calor, sudor alto o sesión prolongada."
              : "no indicados en el contexto actual."}
          </p>
        </article>
      </div>
    </section>
  );
}

function SleepSection({
  findings,
  moduleStatus,
  moduleUncertainties,
  plan,
}: {
  findings: WellnessModules["safetyFindings"];
  moduleStatus: WellnessModules["moduleStatuses"]["sleep"];
  moduleUncertainties: unknown[];
  plan: SleepPlanContract;
}) {
  if (plan.status === "not_requested") return <ModuleUnavailable title="Sueño" />;
  const status = effectiveStatus(plan.status, moduleStatus);
  const uncertainties = [
    ...plan.uncertainties,
    ...moduleUncertainties,
    ...(plan.confidenceFactors.includes("clinical_context_partial")
      ? ["CLINICAL_CONTEXT_PARTIAL"]
      : []),
  ];
  const reviewCount = new Set([
    ...uncertainties.map(uncertaintyLabel),
    ...findings.map(({ code }) => clinicalFindingLabel(code)),
  ]).size;
  const phaseItems = plan.phases
    ? ([
        ["REM", plan.phases.remMinutes],
        ["Profundo", plan.phases.deepMinutes],
        ["Ligero", plan.phases.lightMinutes],
      ] as const)
    : [];
  return (
    <section className="wellness-module" aria-labelledby="sleep-title">
      <div className="wellness-section-heading">
        <div>
          <span>SUEÑO Y DESCANSO</span>
          <h2 id="sleep-title">Ventana y regularidad</h2>
        </div>
        <ModuleState status={status} uncertaintyCount={reviewCount} />
      </div>

      <ClinicalReview
        actionLevel={undefined}
        clinicalCoverage={undefined}
        findingCodes={[]}
        findings={findings}
        uncertainties={uncertainties}
      />

      <div className="wellness-metrics" aria-label="Resumen de sueño">
        <article>
          <span>Ventana orientativa</span>
          <strong>
            {plan.targetWindowHours.min}–{plan.targetWindowHours.max} h
          </strong>
          <small>Referencia para adultos, no diagnóstico</small>
        </article>
        <article>
          <span>Promedio observado</span>
          <strong>
            {plan.observedHours === null ? "No indicado" : `${plan.observedHours} h`}
          </strong>
          <small>
            {plan.durationBand === "above_window"
              ? "Por encima de la ventana; no se considera patológico por sí solo"
              : plan.durationBand === "below_window"
                ? "Por debajo de la ventana orientativa"
                : plan.durationBand === "within_window"
                  ? "Dentro de la ventana orientativa"
                  : "Pendiente de registro"}
          </small>
        </article>
        <article>
          <span>Calidad</span>
          <strong>{plan.quality ? qualityLabels[plan.quality] : "No indicada"}</strong>
          <small>Percepción manual</small>
        </article>
        <article>
          <span>Regularidad</span>
          <strong>
            {plan.regularity ? regularityLabels[plan.regularity] : "No indicada"}
          </strong>
          <small>
            Confianza {confidenceLabels[plan.confidence].toLocaleLowerCase("es-ES")}
          </small>
        </article>
      </div>

      <div className="wellness-split">
        <article className="wellness-panel">
          <h3>Horario y fases</h3>
          <p>
            Horario: {plan.schedule.bedTime ?? "sin hora"} –{" "}
            {plan.schedule.wakeTime ?? "sin hora"}.
          </p>
          {phaseItems.length > 0 ? (
            <dl className="phase-list">
              {phaseItems.map(([name, minutes]) => (
                <div key={name}>
                  <dt>{name}</dt>
                  <dd>{minutes === null ? "Sin dato" : `${minutes} min`}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <p>Fases no registradas.</p>
          )}
          <small>
            Las fases son estimaciones manuales. V1 no sincroniza dispositivos ni las
            interpreta como diagnóstico.
          </small>
        </article>
        <article className="wellness-panel">
          <h3>Estrategias del contexto actual</h3>
          <ul>
            {plan.strategies.map((strategy) => (
              <li key={strategy}>{strategyLabels[strategy]}</li>
            ))}
          </ul>
        </article>
      </div>
    </section>
  );
}

function SupplementFicha({
  item,
}: {
  item: SupplementRecommendation | SupplementExperimentalOption;
}) {
  return (
    <article className="supplement-card">
      <header>
        <div>
          <span>
            {item.tier === "deficiency"
              ? "CARENCIA"
              : item.tier === "experimental"
                ? "EXPERIMENTAL"
                : "CONTEXTUAL"}
          </span>
          <h3>{supplementDisplayName(item.id)}</h3>
        </div>
        <strong>{actionLabels[item.action]}</strong>
      </header>
      <p>{item.purpose}</p>
      <dl className="supplement-ficha">
        <div>
          <dt>Beneficio esperado</dt>
          <dd>{item.expectedBenefit}</dd>
        </div>
        <div>
          <dt>Evidencia / confianza</dt>
          <dd>
            {evidenceLabels[item.evidence]} / {confidenceLabels[item.confidence]}
          </dd>
        </div>
        <div>
          <dt>Forma</dt>
          <dd>{item.form}</dd>
        </div>
        <div>
          <dt>Referencia de dosis</dt>
          <dd>{item.doseReference ?? "No definida automáticamente"}</dd>
        </div>
        <div>
          <dt>Duración</dt>
          <dd>{item.duration ?? "No definida automáticamente"}</dd>
        </div>
        <div>
          <dt>Métrica</dt>
          <dd>{item.metric}</dd>
        </div>
        <div>
          <dt>Condición de salida</dt>
          <dd>{item.stopCondition}</dd>
        </div>
      </dl>
      <div className="supplement-cautions">
        <div>
          <h4>Riesgos</h4>
          <ListOrNone items={item.risks} />
        </div>
        <div>
          <h4>Interacciones</h4>
          <ListOrNone items={item.interactions} />
        </div>
        <div>
          <h4>Contraindicaciones</h4>
          <ListOrNone items={item.contraindications} />
        </div>
      </div>
      <small>Base interna: {item.evidenceRefs.length} referencias revisadas.</small>
    </article>
  );
}

function ListOrNone({ items }: { items: string[] }) {
  return items.length > 0 ? (
    <ul>
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  ) : (
    <p>No identificadas en esta regla.</p>
  );
}

function LabRow({ lab }: { lab: LabSummary }) {
  if (lab.status === "recognized") {
    const analyteLabels = {
      b12: "Vitamina B12",
      creatinine: "Creatinina",
      egfr: "Filtrado glomerular estimado",
      folate: "Folato",
      magnesium: "Magnesio",
    } as const;
    const interpretation = {
      above_range: "Por encima del rango aportado",
      below_range: "Por debajo del rango aportado",
      within_range: "Dentro del rango aportado",
    } as const;
    return (
      <li>
        <strong>{analyteLabels[lab.analyte]}</strong>
        <span>
          {lab.value} {lab.unit}
        </span>
        <small>
          {interpretation[lab.interpretation]} · rango {lab.referenceRange.minimum}–
          {lab.referenceRange.maximum} {lab.referenceRange.unit}
        </small>
      </li>
    );
  }
  return (
    <li>
      <strong>Analítica sin interpretar</strong>
      <span>
        {lab.status === "incomplete"
          ? "Faltan datos actuales"
          : "Entrada no reconocida"}
      </span>
      <small>No se utiliza para calcular una recomendación.</small>
    </li>
  );
}

function SupplementsSection({
  findings,
  moduleStatus,
  moduleUncertainties,
  plan,
}: {
  findings: WellnessModules["safetyFindings"];
  moduleStatus: WellnessModules["moduleStatuses"]["supplements"];
  moduleUncertainties: unknown[];
  plan: SupplementsPlanContract;
}) {
  if (plan.status === "not_requested") {
    return <ModuleUnavailable title="Suplementación" />;
  }
  const status =
    moduleStatus === "provisional" || plan.status === "provisional"
      ? "provisional"
      : "valid";
  const uncertainties = [...plan.uncertainties, ...moduleUncertainties];
  const reviewCount = new Set([
    ...uncertainties.map(uncertaintyLabel),
    ...findings.map(({ code }) => clinicalFindingLabel(code)),
  ]).size;
  return (
    <section className="wellness-module" aria-labelledby="supplements-title">
      <div className="wellness-section-heading">
        <div>
          <span>SUPLEMENTACIÓN</span>
          <h2 id="supplements-title">Opciones basadas en el contexto</h2>
        </div>
        <ModuleState status={status} uncertaintyCount={reviewCount} />
      </div>
      <ClinicalReview
        actionLevel={plan.strictestActionLevel}
        clinicalCoverage={plan.clinicalCoverage}
        findingCodes={[]}
        findings={findings}
        uncertainties={uncertainties}
      />
      <p className="module-intro">
        Primero alimentos. Como máximo una opción nueva puede quedar como candidata a
        prueba; no se muestran marcas ni se modifica medicación.
      </p>

      <section aria-labelledby="recommended-title">
        <div className="subsection-heading">
          <h3 id="recommended-title">Recomendaciones y revisiones</h3>
          <span>{plan.recommendations.length}</span>
        </div>
        {plan.recommendations.length > 0 ? (
          <div className="supplement-list">
            {plan.recommendations.map((item) => (
              <SupplementFicha item={item} key={item.id} />
            ))}
          </div>
        ) : (
          <p className="quiet-line">
            No se ha identificado una recomendación en el contexto actual.
          </p>
        )}
      </section>

      <details className="experimental-section">
        <summary>
          <span>Opciones experimentales</span>
          <strong>{plan.experimentalOptions.length}</strong>
        </summary>
        <p>
          Evidencia limitada, confianza baja y riesgos visibles antes de considerar
          cualquier prueba.
        </p>
        <div className="supplement-list">
          {plan.experimentalOptions.map((item) => (
            <SupplementFicha item={item} key={item.id} />
          ))}
        </div>
      </details>

      <div className="wellness-split supplement-context">
        <article className="wellness-panel">
          <h3>Contexto actual protegido</h3>
          <p>
            {plan.currentSupplements.length} suplementos declarados; los nombres no se
            muestran en esta vista.
          </p>
          {plan.currentSupplements.length > 0 ? (
            <ul>
              {plan.currentSupplements.map((item, index) => (
                <li key={`${item.classification}:${index}`}>
                  {item.classification === "known_context"
                    ? "Contexto reconocido"
                    : "Contexto sin categorizar"}
                </li>
              ))}
            </ul>
          ) : null}
        </article>
        <article className="wellness-panel">
          <h3>Analítica actual</h3>
          {plan.labSummary.length > 0 ? (
            <ul className="lab-list">
              {plan.labSummary.map((lab, index) => (
                <LabRow key={index} lab={lab} />
              ))}
            </ul>
          ) : (
            <p>Sin valores actuales aportados.</p>
          )}
          <small>
            Solo se usa el valor actual aportado; no se realizan predicciones.
          </small>
        </article>
      </div>

      <section className="not-recommended" aria-labelledby="not-recommended-title">
        <h3 id="not-recommended-title">No recomendado</h3>
        <ul>
          {plan.notRecommended.map((item) => (
            <li key={item.id}>
              <strong>{supplementDisplayName(item.id)}</strong>
              <span>{item.reason}</span>
            </li>
          ))}
        </ul>
      </section>
    </section>
  );
}

export function WellnessApp() {
  const [ack, setAck] = useState<PlanMutationAck>();
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string>();
  const [modules, setModules] = useState<WellnessModules>();
  const [profiles, setProfiles] = useState<ProfileAccessSummary[]>([]);
  const [profileId, setProfileId] = useState<string>();
  const [restoreStatus, setRestoreStatus] = useState<
    "blocked" | "can_generate" | "loaded" | "loading"
  >("loading");
  const resultHeading = useRef<HTMLHeadingElement>(null);

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
    setModules(undefined);
    setError(undefined);
    if (!profileId) {
      setRestoreStatus("loading");
      return;
    }
    const planId = storedPlanId(profileId);
    if (!planId) {
      setRestoreStatus("can_generate");
      return;
    }
    let current = true;
    setRestoreStatus("loading");
    nutritionPlanClient
      .listVersions(planId)
      .then(async (history) => {
        if (history.profileId !== profileId) throw new Error("plan_profile_mismatch");
        const version =
          history.versions.find(({ status }) => status === "draft") ??
          history.versions.find(({ id }) => id === history.activeVersionId);
        if (!version) throw new Error("plan_version_missing");
        const detail = await nutritionPlanClient.getVersion(planId, version.id);
        if (!current) return;
        setAck({
          activatedAt: version.activatedAt,
          activeVersionId: history.activeVersionId,
          aggregateVersion: history.aggregateVersion,
          archivedAt: version.archivedAt,
          completeness: version.completeness,
          contextSnapshotId: version.contextSnapshotId,
          createdAt: version.createdAt,
          ordinal: version.ordinal,
          planId,
          planVersionId: version.id,
          status: version.status,
          validationStatus: version.validationStatus,
        });
        setModules(readWellnessModules(detail));
        setRestoreStatus("loaded");
      })
      .catch((loadError: unknown) => {
        if (!current) return;
        if (
          loadError instanceof NutritionPlanApiError &&
          loadError.code === "NOT_FOUND"
        ) {
          sessionStorage.removeItem(planStorageKey(profileId));
          setRestoreStatus("can_generate");
          return;
        }
        setError(errorMessage(loadError));
        setRestoreStatus("blocked");
      });
    return () => {
      current = false;
    };
  }, [profileId]);

  useEffect(() => {
    if (modules) resultHeading.current?.focus();
  }, [modules]);

  async function generate() {
    if (!profileId) return;
    setBusy(true);
    setError(undefined);
    try {
      const draft = await questionnaireClient.getDraft(profileId);
      if (!draft || draft.status !== "submitted") {
        setError("Confirma primero el cuestionario de este perfil.");
        return;
      }
      const context = await nutritionPlanClient.createContext(profileId, draft.version);
      const mutation = await nutritionPlanClient.generate(profileId, context.id);
      rememberPlan(profileId, mutation.planId);
      const detail = await nutritionPlanClient.getVersion(
        mutation.planId,
        mutation.planVersionId,
      );
      setAck(mutation);
      setModules(readWellnessModules(detail));
      setRestoreStatus("loaded");
    } catch (generationError) {
      setError(errorMessage(generationError));
    } finally {
      setBusy(false);
    }
  }

  async function activate() {
    if (
      !ack ||
      !modules ||
      ack.validationStatus !== "valid" ||
      modules.validationBlocked ||
      modules.invalidModules.length > 0
    ) {
      return;
    }
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
      setError(errorMessage(activationError));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="wellness-shell">
      <header className="wellness-header">
        <div>
          <p className="eyebrow">HEALTH DESIGN · BIENESTAR T12</p>
          <h1>Hidratación, sueño y suplementos</h1>
          <p className="lede">
            Resultados contextualizados, incertidumbre visible y activación siempre
            manual.
          </p>
        </div>
        <div className="wellness-profile">
          <label htmlFor="wellness-profile">Perfil</label>
          <select
            disabled={busy || restoreStatus === "loading"}
            id="wellness-profile"
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
          <a className="text-button" href="/training">
            Ver movimiento
          </a>
        </div>
      </header>

      {error ? (
        <div className="message error-message wellness-message" role="alert">
          {error}
        </div>
      ) : null}
      {busy && profiles.length === 0 ? <p role="status">Cargando perfiles…</p> : null}
      {profiles.length > 0 && restoreStatus === "loading" ? (
        <p role="status">Consultando el plan existente…</p>
      ) : null}
      {!profiles.length && !busy ? (
        <section className="wellness-empty">
          <h2>Necesitas un perfil vinculado</h2>
          <a className="primary-button inline-link" href="/">
            Gestionar acceso
          </a>
        </section>
      ) : null}
      {profiles.length > 0 && !modules && restoreStatus === "can_generate" ? (
        <section className="wellness-empty">
          <span>ÚLTIMO CUESTIONARIO CONFIRMADO</span>
          <h2>Prepara tus módulos de bienestar</h2>
          <p>
            Solo aparecerán los módulos seleccionados. Si falta un dato crítico, verás
            un plan provisional en vez de una cifra inventada.
          </p>
          <button
            className="primary-button"
            disabled={busy}
            onClick={() => void generate()}
            type="button"
          >
            {busy ? "Generando…" : "Generar bienestar"}
          </button>
        </section>
      ) : null}
      {profiles.length > 0 && !modules && restoreStatus === "blocked" ? (
        <section className="wellness-empty">
          <h2>No se ha podido consultar el plan existente</h2>
          <p>
            Recarga para recuperar la versión ya creada. No se ofrece una nueva
            generación mientras su estado sea incierto.
          </p>
        </section>
      ) : null}

      {ack && modules ? (
        <>
          <section className="wellness-toolbar" aria-labelledby="wellness-result-title">
            <div>
              <span>
                {ack.completeness === "complete" ? "PLAN COMPLETO" : "PLAN PROVISIONAL"}
              </span>
              <h2 id="wellness-result-title" ref={resultHeading} tabIndex={-1}>
                {ack.status === "active"
                  ? `Versión ${ack.ordinal} activa`
                  : `Versión ${ack.ordinal} lista para revisar`}
              </h2>
            </div>
            <button
              className="primary-button"
              disabled={
                busy ||
                ack.status === "active" ||
                ack.validationStatus !== "valid" ||
                modules.validationBlocked ||
                modules.invalidModules.length > 0
              }
              onClick={() => void activate()}
              type="button"
            >
              {ack.status === "active" ? "Plan activo" : "Activar plan"}
            </button>
          </section>
          {modules.validationBlocked || modules.invalidModules.length > 0 ? (
            <div className="message error-message" role="alert">
              El resultado no supera la validación y no se muestra ni puede activarse.
              Vuelve a generarlo.
            </div>
          ) : null}
          {modules.hydration ? (
            <HydrationSection
              findings={modules.safetyFindings.filter(
                ({ module }) => module === "hydration",
              )}
              moduleStatus={modules.moduleStatuses.hydration}
              moduleUncertainties={modules.moduleUncertainties.hydration}
              plan={modules.hydration}
            />
          ) : (
            <ModuleUnavailable
              invalid={modules.invalidModules.includes("hydration")}
              title="Hidratación"
            />
          )}
          {modules.sleep ? (
            <SleepSection
              findings={modules.safetyFindings.filter(
                ({ module }) => module === "sleep",
              )}
              moduleStatus={modules.moduleStatuses.sleep}
              moduleUncertainties={modules.moduleUncertainties.sleep}
              plan={modules.sleep}
            />
          ) : (
            <ModuleUnavailable
              invalid={modules.invalidModules.includes("sleep")}
              title="Sueño"
            />
          )}
          {modules.supplements ? (
            <SupplementsSection
              findings={modules.safetyFindings.filter(
                ({ module }) => module === "supplements",
              )}
              moduleStatus={modules.moduleStatuses.supplements}
              moduleUncertainties={modules.moduleUncertainties.supplements}
              plan={modules.supplements}
            />
          ) : (
            <ModuleUnavailable
              invalid={modules.invalidModules.includes("supplements")}
              title="Suplementación"
            />
          )}
        </>
      ) : null}
    </main>
  );
}
