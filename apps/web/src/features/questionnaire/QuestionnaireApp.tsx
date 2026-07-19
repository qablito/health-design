import { useEffect, useMemo, useRef, useState } from "react";

import {
  QUESTIONNAIRE_PUBLIC_SCHEMA_V2,
  QuestionnaireAnswersSchema,
  QuestionnairePublicSchemaResponseSchema,
  type QuestionnaireDraftAck,
} from "@health-design/contracts";
import {
  evaluateQuestionnaire,
  getQuestionnaireProgress,
  getVisibleBlockIds,
  getVisibleQuestionIds,
  type QuestionnaireAnswers,
  type QuestionnaireBlockId,
} from "@health-design/domain";

import { accessClient, type ProfileAccessSummary } from "../access/access-client";
import { QuestionnaireField, type QuestionnaireQuestion } from "./QuestionnaireField";
import { QuestionnaireApiError, questionnaireClient } from "./questionnaire-client";

import "../access/access.css";
import "./questionnaire.css";

type PublicSchema = Awaited<ReturnType<typeof questionnaireClient.getSchema>>;

const blockTitles = Object.fromEntries(
  QUESTIONNAIRE_PUBLIC_SCHEMA_V2.blocks.map(({ id, title }) => [id, title]),
) as Record<QuestionnaireBlockId, string>;

function friendlyError(error: unknown): string {
  if (error instanceof QuestionnaireApiError) {
    if (error.code === "VERSION_CONFLICT") {
      return "El borrador cambió en otro dispositivo. Recarga antes de continuar.";
    }
    if (error.code === "QUESTIONNAIRE_INCOMPLETE") {
      return "Falta seleccionar al menos un módulo y un objetivo principal.";
    }
  }
  return "No se ha podido guardar por un problema de conexión. El cambio sigue en esta pantalla para que puedas reintentarlo.";
}

function hasValue(value: unknown): boolean {
  return (
    value !== undefined &&
    value !== null &&
    value !== "" &&
    (!Array.isArray(value) || value.length > 0)
  );
}

function isUnknownArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

function displayValue(value: unknown, question: QuestionnaireQuestion): string {
  if (!hasValue(value)) return "Ausente";
  if (typeof value === "boolean") return value ? "Sí" : "No";
  if (isUnknownArray(value)) {
    return value
      .map((item) => {
        if (typeof item === "string") return item;
        if (typeof item === "number" || typeof item === "boolean") {
          return String(item);
        }
        if (
          typeof item === "object" &&
          item !== null &&
          "name" in item &&
          typeof item.name === "string"
        ) {
          return item.name;
        }
        return "Dato estructurado";
      })
      .join(", ");
  }
  const option = question.options?.find(
    ({ value: candidate }) => candidate === String(value),
  );
  return option?.label ?? String(value);
}

export function QuestionnaireApp() {
  const [answers, setAnswers] = useState<QuestionnaireAnswers>({ country: "ES" });
  const [busy, setBusy] = useState(true);
  const [completeness, setCompleteness] = useState<"complete" | "provisional">(
    "provisional",
  );
  const [confirmedBlockIds, setConfirmedBlockIds] = useState<QuestionnaireBlockId[]>(
    [],
  );
  const [currentBlockId, setCurrentBlockId] = useState<QuestionnaireBlockId>("core");
  const [error, setError] = useState<string>();
  const [profiles, setProfiles] = useState<ProfileAccessSummary[]>([]);
  const [profileId, setProfileId] = useState<string>();
  const [savedAt, setSavedAt] = useState<string>();
  const [schema, setSchema] = useState<PublicSchema>(() =>
    QuestionnairePublicSchemaResponseSchema.parse(QUESTIONNAIRE_PUBLIC_SCHEMA_V2),
  );
  const [status, setStatus] = useState<"editing" | "submitted">("editing");
  const [uncertainties, setUncertainties] = useState<
    QuestionnaireDraftAck["uncertainties"]
  >([]);
  const [version, setVersion] = useState(0);
  const pendingKey = useRef<string | undefined>(undefined);
  const persistedAnswers = useRef<QuestionnaireAnswers>({ country: "ES" });

  useEffect(() => {
    let active = true;
    Promise.allSettled([accessClient.listProfiles(), questionnaireClient.getSchema()])
      .then(([profilesResult, schemaResult]) => {
        if (!active) return;
        if (profilesResult.status === "rejected") throw profilesResult.reason;
        const nextProfiles = profilesResult.value;
        setProfiles(nextProfiles);
        if (schemaResult.status === "fulfilled") {
          setSchema(schemaResult.value);
        } else {
          setError(
            "No se ha podido actualizar la definición del cuestionario. Puedes continuar con la versión V2 incluida en la aplicación.",
          );
        }
        setProfileId((current) => current ?? nextProfiles[0]?.profileId);
        if (!nextProfiles.length) setBusy(false);
      })
      .catch((loadError) => {
        if (!active) return;
        setError(friendlyError(loadError));
        setBusy(false);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!profileId) return;
    let active = true;
    pendingKey.current = undefined;
    persistedAnswers.current = { country: "ES" };
    setAnswers({ country: "ES" });
    setConfirmedBlockIds([]);
    setCurrentBlockId("core");
    setVersion(0);
    setBusy(true);
    setError(undefined);
    questionnaireClient
      .getDraft(profileId)
      .then((draft) => {
        if (!active) return;
        if (draft) {
          persistedAnswers.current = draft.answers;
          setAnswers(draft.answers);
          setCompleteness(draft.completeness);
          setConfirmedBlockIds(draft.confirmedBlockIds);
          setCurrentBlockId(draft.currentBlockId);
          setSavedAt(draft.updatedAt);
          setStatus(draft.status);
          setUncertainties(draft.uncertainties);
          setVersion(draft.version);
        } else {
          persistedAnswers.current = { country: "ES" };
          setAnswers({ country: "ES" });
          setCompleteness("provisional");
          setConfirmedBlockIds([]);
          setCurrentBlockId("core");
          setSavedAt(undefined);
          setStatus("editing");
          setUncertainties([]);
          setVersion(0);
        }
      })
      .catch((loadError) => setError(friendlyError(loadError)))
      .finally(() => active && setBusy(false));
    return () => {
      active = false;
    };
  }, [profileId]);

  const visibleBlockIds = useMemo(() => getVisibleBlockIds(answers), [answers]);
  const visibleQuestionIds = useMemo(
    () => new Set(getVisibleQuestionIds(answers).map(String)),
    [answers],
  );
  const questions = useMemo(
    () =>
      schema.questions.filter(
        (question) =>
          question.blockId === currentBlockId && visibleQuestionIds.has(question.id),
      ) as QuestionnaireQuestion[],
    [currentBlockId, schema.questions, visibleQuestionIds],
  );
  const currentIndex = Math.max(0, visibleBlockIds.indexOf(currentBlockId));
  const progress = getQuestionnaireProgress(visibleBlockIds, confirmedBlockIds);
  const evaluation = evaluateQuestionnaire(answers);

  function updateAnswer(id: string, value: unknown) {
    pendingKey.current = undefined;
    setAnswers((current) => {
      const next = { ...current } as Record<string, unknown>;
      if (value === undefined) delete next[id];
      else next[id] = value;
      return next;
    });
    setStatus("editing");
    setError(undefined);
  }

  function applyAck(ack: QuestionnaireDraftAck) {
    setCompleteness(ack.completeness);
    setConfirmedBlockIds(ack.confirmedBlockIds);
    setCurrentBlockId(ack.currentBlockId);
    setSavedAt(ack.updatedAt);
    setStatus(ack.status);
    setUncertainties(ack.uncertainties);
    setVersion(ack.version);
  }

  async function saveAndContinue() {
    if (!profileId) return;
    setBusy(true);
    setError(undefined);
    const nextBlockId =
      visibleBlockIds[Math.min(currentIndex + 1, visibleBlockIds.length - 1)] ??
      "summary";
    const nextConfirmed = Array.from(new Set([...confirmedBlockIds, currentBlockId]));
    const idempotencyKey = pendingKey.current ?? crypto.randomUUID();
    pendingKey.current = idempotencyKey;
    try {
      const nextAnswers = {
        ...persistedAnswers.current,
      } as Record<string, unknown>;
      for (const question of schema.questions.filter(
        ({ blockId }) => blockId === currentBlockId,
      )) {
        const value = answers[question.id as keyof QuestionnaireAnswers];
        if (visibleQuestionIds.has(question.id) && value !== undefined) {
          nextAnswers[question.id] = value;
        } else {
          delete nextAnswers[question.id];
        }
      }
      const parsedAnswers = QuestionnaireAnswersSchema.parse(nextAnswers);
      const ack = await questionnaireClient.saveDraft(
        profileId,
        {
          answers: parsedAnswers,
          confirmedBlockIds: nextConfirmed,
          currentBlockId: nextBlockId,
          expectedVersion: version,
          schemaVersion: 2,
        },
        { idempotencyKey },
      );
      pendingKey.current = undefined;
      persistedAnswers.current = parsedAnswers;
      setAnswers(parsedAnswers);
      applyAck(ack);
      window.scrollTo({ behavior: "smooth", top: 0 });
    } catch (saveError) {
      setError(friendlyError(saveError));
    } finally {
      setBusy(false);
    }
  }

  async function submit() {
    if (!profileId) return;
    if (evaluation.hardErrors.length) {
      setError("Falta seleccionar al menos un módulo y un objetivo principal.");
      return;
    }
    setBusy(true);
    const idempotencyKey = pendingKey.current ?? crypto.randomUUID();
    pendingKey.current = idempotencyKey;
    try {
      const ack = await questionnaireClient.submitDraft(
        profileId,
        { expectedVersion: version, schemaVersion: 2 },
        { idempotencyKey },
      );
      pendingKey.current = undefined;
      applyAck(ack);
    } catch (submitError) {
      setError(friendlyError(submitError));
    } finally {
      setBusy(false);
    }
  }

  if (busy && !profileId) {
    return (
      <main className="questionnaire-shell">
        <p role="status">Cargando cuestionario…</p>
      </main>
    );
  }
  if (!profiles.length) {
    return (
      <main className="questionnaire-shell">
        <h1>Necesitas un perfil vinculado</h1>
        <p>Vuelve al acceso privado para crear o vincular un perfil.</p>
        {error ? (
          <div className="message error-message" role="alert">
            {error}
          </div>
        ) : null}
        <a className="primary-button inline-link" href="/">
          Volver al acceso
        </a>
      </main>
    );
  }

  return (
    <main className="questionnaire-shell">
      <header className="questionnaire-header">
        <div>
          <p className="eyebrow">HEALTH DESIGN · CONTEXTO V2</p>
          <h1>Tu contexto, paso a paso</h1>
          <p className="lede">
            Una sección cada vez. Solo preguntamos lo que puede cambiar tu plan.
          </p>
        </div>
        <div className="profile-switcher">
          <label htmlFor="questionnaire-profile">Perfil</label>
          <select
            disabled={busy}
            id="questionnaire-profile"
            onChange={(event) => setProfileId(event.target.value)}
            value={profileId}
          >
            {profiles.map((profile) => (
              <option key={profile.profileId} value={profile.profileId}>
                {profile.alias}
              </option>
            ))}
          </select>
          <a className="text-button" href="/">
            Gestionar acceso
          </a>
        </div>
      </header>

      <section className="progress-panel" aria-label="Progreso del cuestionario">
        <div>
          <strong>
            {progress.completed} de {progress.total} secciones confirmadas
          </strong>
          <span>≈ {progress.estimatedMinutesRemaining} min restantes</span>
        </div>
        <progress max={progress.total} value={progress.completed}>
          {progress.completed}/{progress.total}
        </progress>
        <small>
          {savedAt
            ? `Guardado ${new Date(savedAt).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })}`
            : "Todavía sin guardar"}
        </small>
      </section>

      {error ? (
        <div className="message error-message" role="alert">
          {error}
        </div>
      ) : null}
      {status === "submitted" ? (
        <div className="message success-message" role="status">
          Contexto confirmado como{" "}
          {completeness === "complete" ? "completo" : "provisional"}. La generación del
          plan ya puede generarse desde alimentación.
          <a className="text-button" href="/nutrition">
            Abrir alimentación
          </a>
        </div>
      ) : null}

      <section className="questionnaire-card" aria-labelledby="block-title">
        <div className="block-heading">
          <p className="step-count">
            SECCIÓN {currentIndex + 1} / {visibleBlockIds.length}
          </p>
          <h2 id="block-title">{blockTitles[currentBlockId]}</h2>
        </div>

        {currentBlockId === "summary" ? (
          <Summary
            answers={answers}
            evaluation={evaluation}
            onEdit={setCurrentBlockId}
            questions={schema.questions as QuestionnaireQuestion[]}
            visibleBlockIds={visibleBlockIds}
          />
        ) : (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void saveAndContinue();
            }}
          >
            <fieldset className="questionnaire-fields" disabled={busy}>
              <div className="question-grid">
                {questions.map((question) => (
                  <QuestionnaireField
                    key={`${profileId}:${question.id}`}
                    onChange={(value) => updateAnswer(question.id, value)}
                    question={question}
                    value={answers[question.id as keyof QuestionnaireAnswers]}
                  />
                ))}
              </div>
            </fieldset>
            <div className="wizard-actions">
              <button
                className="secondary-button"
                disabled={currentIndex === 0 || busy}
                onClick={() =>
                  setCurrentBlockId(visibleBlockIds[currentIndex - 1] ?? "core")
                }
                type="button"
              >
                Anterior
              </button>
              <button className="primary-button" disabled={busy} type="submit">
                {busy ? "Guardando…" : "Continuar"}
              </button>
            </div>
          </form>
        )}

        {currentBlockId === "summary" ? (
          <div className="wizard-actions">
            <button
              className="secondary-button"
              disabled={busy}
              onClick={() =>
                setCurrentBlockId(visibleBlockIds[currentIndex - 1] ?? "labs")
              }
              type="button"
            >
              Anterior
            </button>
            <button
              className="primary-button"
              disabled={busy || status === "submitted"}
              onClick={() => void submit()}
              type="button"
            >
              {busy ? "Confirmando…" : "Confirmar contexto"}
            </button>
          </div>
        ) : null}
      </section>

      {uncertainties.length && currentBlockId !== "summary" ? (
        <p className="uncertainty-note">
          El borrador actual contiene {uncertainties.length} incertidumbres. Podrás
          revisarlas en el resumen.
        </p>
      ) : null}
    </main>
  );
}

function Summary({
  answers,
  evaluation,
  onEdit,
  questions,
  visibleBlockIds,
}: {
  answers: QuestionnaireAnswers;
  evaluation: ReturnType<typeof evaluateQuestionnaire>;
  onEdit: (blockId: QuestionnaireBlockId) => void;
  questions: QuestionnaireQuestion[];
  visibleBlockIds: QuestionnaireBlockId[];
}) {
  const visibleQuestions = new Set(getVisibleQuestionIds(answers).map(String));
  return (
    <div className="summary-stack">
      <div className={`summary-status ${evaluation.completeness}`}>
        <strong>
          {evaluation.completeness === "complete"
            ? "Contexto completo"
            : "Contexto provisional"}
        </strong>
        <span>
          {evaluation.uncertainties.length
            ? `${evaluation.uncertainties.length} respuestas críticas ausentes; el plan podrá continuar con cautela.`
            : "No faltan respuestas críticas para los módulos elegidos."}
        </span>
      </div>
      {evaluation.hardErrors.length ? (
        <div className="message error-message">
          Selecciona al menos un módulo y un objetivo principal antes de confirmar.
        </div>
      ) : null}
      {visibleBlockIds
        .filter((blockId) => blockId !== "summary")
        .map((blockId) => {
          const blockQuestions = questions.filter(
            (question) =>
              question.blockId === blockId && visibleQuestions.has(question.id),
          );
          if (!blockQuestions.length) return null;
          return (
            <section className="summary-block" key={blockId}>
              <header>
                <h3>{blockTitles[blockId]}</h3>
                <button
                  aria-label={`Editar ${blockTitles[blockId]}`}
                  className="text-button"
                  onClick={() => onEdit(blockId)}
                  type="button"
                >
                  Editar
                </button>
              </header>
              <dl>
                {blockQuestions.map((question) => {
                  const value = answers[question.id as keyof QuestionnaireAnswers];
                  return (
                    <div key={question.id}>
                      <dt>{question.label}</dt>
                      <dd className={hasValue(value) ? "known" : "missing"}>
                        <span>{hasValue(value) ? "Conocido" : "Ausente"}</span>
                        {displayValue(value, question)}
                      </dd>
                    </div>
                  );
                })}
              </dl>
            </section>
          );
        })}
    </div>
  );
}
