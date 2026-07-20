import { useEffect, useState } from "react";
import type { AIExplanationResponse } from "@health-design/contracts";

import {
  NutritionPlanApiError,
  nutritionPlanClient,
} from "../nutrition/nutrition-client";

import "./ai-explanation.css";

function errorMessage(error: unknown): string {
  if (error instanceof NutritionPlanApiError && error.status === 401) {
    return "La sesión ha caducado. Vuelve a entrar antes de solicitar la explicación.";
  }
  return "No se ha podido preparar la explicación. El plan permanece sin cambios.";
}

export function AIExplanation({ planVersionId }: { planVersionId: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [result, setResult] = useState<AIExplanationResponse>();

  useEffect(() => {
    setBusy(false);
    setError(undefined);
    setResult(undefined);
  }, [planVersionId]);

  async function explain() {
    setBusy(true);
    setError(undefined);
    try {
      setResult(await nutritionPlanClient.explainVersion(planVersionId));
    } catch (requestError) {
      setError(errorMessage(requestError));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="ai-explanation" aria-labelledby="ai-explanation-title">
      <div className="ai-explanation-intro">
        <div>
          <span>EXPLICACIÓN OPCIONAL</span>
          <h2 id="ai-explanation-title">Una lectura sencilla de esta versión</h2>
        </div>
        <p>
          Resume el estado del plan con lenguaje claro. La explicación nunca cambia
          alimentos, cantidades, ejercicios ni decisiones de seguridad.
        </p>
      </div>
      {!result ? (
        <button
          className="secondary-button ai-explanation-action"
          disabled={busy}
          onClick={() => void explain()}
          type="button"
        >
          {busy ? "Preparando explicación…" : "Explicar mi plan"}
        </button>
      ) : (
        <div className="ai-explanation-result" aria-live="polite">
          <div className={`ai-source ${result.source}`}>
            <span aria-hidden="true" />
            {result.source === "luna"
              ? "Explicación seleccionada por Luna"
              : "Explicación segura de respaldo"}
          </div>
          <ul>
            {result.segments.map((segment) => (
              <li key={`${segment.slot}-${segment.messageKey}`}>{segment.text}</li>
            ))}
          </ul>
          <button
            className="text-button"
            disabled={busy}
            onClick={() => void explain()}
            type="button"
          >
            Volver a explicar
          </button>
        </div>
      )}
      {error ? (
        <p className="ai-explanation-error" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
