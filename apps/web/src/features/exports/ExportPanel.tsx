import { useMemo, useState } from "react";

import {
  EXPORT_RENDERER_VERSION,
  type ExportChoice,
  type ExportCreateRequestContract,
  type NutritionWeekV2Contract,
} from "@health-design/contracts";
import { createExportModel } from "@health-design/export/model";

import { exportClient } from "./export-client";

import "./exports.css";

type ExportFormat = ExportCreateRequestContract["format"];

type Props = Readonly<{
  choices: readonly ExportChoice[];
  nutrition: NutritionWeekV2Contract;
  planOutputHash: string;
  planVersionId: string;
}>;

function statusMessage(error: unknown): string {
  if (error instanceof Error && error.message === "export_redirect_rejected") {
    return "La descarga no ha superado la validación privada.";
  }
  return "No se ha podido preparar el archivo. El plan no ha cambiado.";
}

export function ExportPanel({
  choices,
  nutrition,
  planOutputHash,
  planVersionId,
}: Props) {
  const [busy, setBusy] = useState<ExportFormat>();
  const [day, setDay] = useState(1);
  const [detail, setDetail] = useState<"compact" | "complete">("compact");
  const [includeShopping, setIncludeShopping] = useState(true);
  const [includeWeeklyPreparation, setIncludeWeeklyPreparation] = useState(false);
  const [message, setMessage] = useState<string>();
  const [presentation, setPresentation] = useState<"ingredients" | "preparation">(
    "ingredients",
  );
  const [rangeKind, setRangeKind] = useState<"day" | "week">("week");

  function config(format: ExportFormat): ExportCreateRequestContract {
    return {
      choices: [...choices],
      detail,
      format,
      includeShopping,
      includeWeeklyPreparation: rangeKind === "week" && includeWeeklyPreparation,
      presentation,
      range: rangeKind === "week" ? { kind: "week" } : { day, kind: "day" },
      schemaVersion: 1,
    };
  }

  const printModel = useMemo(
    () =>
      createExportModel({
        config: config("pdf"),
        nutrition,
        planOutputHash,
        planVersionId,
        rendererVersion: EXPORT_RENDERER_VERSION,
      }),
    [
      choices,
      day,
      detail,
      includeShopping,
      includeWeeklyPreparation,
      nutrition,
      planOutputHash,
      planVersionId,
      presentation,
      rangeKind,
    ],
  );

  async function download(format: ExportFormat) {
    setBusy(format);
    setMessage(undefined);
    try {
      const artifact = await exportClient.create(planVersionId, config(format));
      await exportClient.download(artifact.artifactId, artifact.format);
      setMessage(`${format.toUpperCase()} preparado y descargado.`);
    } catch (error) {
      setMessage(statusMessage(error));
    } finally {
      setBusy(undefined);
    }
  }

  return (
    <section aria-labelledby="export-panel-title" className="export-panel">
      <header>
        <div>
          <p className="export-kicker">SALIDA PRIVADA · T15</p>
          <h2 id="export-panel-title">Exportar el plan</h2>
        </div>
        <p>Imprime al momento o crea un archivo privado con las elecciones que ves.</p>
      </header>

      <div className="export-grid">
        <fieldset>
          <legend>Detalle</legend>
          <label>
            <input
              checked={detail === "compact"}
              name="export-detail"
              onChange={() => setDetail("compact")}
              type="radio"
            />
            <span>
              <strong>Compacto</strong>
              Solo las elecciones actuales
            </span>
          </label>
          <label>
            <input
              checked={detail === "complete"}
              name="export-detail"
              onChange={() => setDetail("complete")}
              type="radio"
            />
            <span>
              <strong>Completo</strong>
              Incluye las dos alternativas
            </span>
          </label>
        </fieldset>

        <fieldset>
          <legend>Contenido</legend>
          <label>
            <input
              checked={presentation === "ingredients"}
              name="export-presentation"
              onChange={() => setPresentation("ingredients")}
              type="radio"
            />
            <span>
              <strong>Ingredientes</strong>
              Cantidades y nutrientes
            </span>
          </label>
          <label>
            <input
              checked={presentation === "preparation"}
              name="export-presentation"
              onChange={() => setPresentation("preparation")}
              type="radio"
            />
            <span>
              <strong>Preparación breve en archivo</strong>
              Añade instrucciones sencillas
            </span>
          </label>
        </fieldset>

        <fieldset>
          <legend>Periodo</legend>
          <label>
            <input
              checked={rangeKind === "week"}
              name="export-range"
              onChange={() => setRangeKind("week")}
              type="radio"
            />
            <span>
              <strong>Semana completa</strong>
              Los siete días
            </span>
          </label>
          <label>
            <input
              checked={rangeKind === "day"}
              name="export-range"
              onChange={() => {
                setRangeKind("day");
                setIncludeWeeklyPreparation(false);
              }}
              type="radio"
            />
            <span>
              <strong>Un día</strong>
              Elige una jornada
            </span>
          </label>
          <label className="export-day-select">
            <span>Día que quieres exportar</span>
            <select
              disabled={rangeKind !== "day"}
              onChange={(event) => setDay(Number(event.target.value))}
              value={day}
            >
              {nutrition.days.map(({ day: value }) => (
                <option key={value} value={value}>
                  Día {value}
                </option>
              ))}
            </select>
          </label>
        </fieldset>

        <fieldset>
          <legend>Organización</legend>
          <label className="export-check">
            <input
              checked={includeShopping}
              onChange={(event) => setIncludeShopping(event.target.checked)}
              type="checkbox"
            />
            <span>
              <strong>Añadir lista de la compra</strong>
              Reagrupada con las elecciones actuales
            </span>
          </label>
          <label className="export-check">
            <input
              checked={includeWeeklyPreparation}
              disabled={rangeKind !== "week"}
              onChange={(event) => setIncludeWeeklyPreparation(event.target.checked)}
              type="checkbox"
            />
            <span>
              <strong>Añadir preparación semanal</strong>
              Disponible para la semana completa
            </span>
          </label>
        </fieldset>
      </div>

      <footer>
        <p aria-live="polite" role="status">
          {message ?? "Los archivos se entregan mediante descarga autenticada."}
        </p>
        <div>
          <button
            className="secondary-button"
            disabled={busy !== undefined}
            onClick={() => window.print()}
            type="button"
          >
            Imprimir
          </button>
          <button
            className="secondary-button"
            disabled={busy !== undefined}
            onClick={() => void download("xlsx")}
            type="button"
          >
            {busy === "xlsx" ? "Preparando XLSX…" : "Descargar XLSX"}
          </button>
          <button
            className="primary-button"
            disabled={busy !== undefined}
            onClick={() => void download("pdf")}
            type="button"
          >
            {busy === "pdf" ? "Preparando PDF…" : "Descargar PDF"}
          </button>
        </div>
      </footer>

      <article aria-hidden="true" className="export-print-sheet">
        <header>
          <p>HEALTH DESIGN · PLAN NUTRICIONAL</p>
          <h1>
            {printModel.range.kind === "week"
              ? "Semana de alimentación"
              : `Alimentación · día ${printModel.range.day}`}
          </h1>
          <span>
            {printModel.detail === "compact" ? "Compacto" : "Completo"} ·{" "}
            {printModel.presentation === "ingredients"
              ? "Ingredientes"
              : "Preparación breve"}
          </span>
        </header>
        <table>
          <thead>
            <tr>
              <th>Día / comida</th>
              <th>Alimento</th>
              <th>Cantidad</th>
              <th>Nutrientes</th>
              {printModel.presentation === "preparation" ? <th>Preparación</th> : null}
            </tr>
          </thead>
          <tbody>
            {printModel.rows.map((row) => (
              <tr
                className={row.rowKind === "alternative" ? "alternative" : ""}
                key={`${row.dayIndex}:${row.mealIndex}:${row.foodIndex}:${row.choice}`}
              >
                <td>
                  Día {row.day} · comida {row.mealIndex + 1}
                </td>
                <td>
                  {row.rowKind === "alternative" ? "Alternativa · " : ""}
                  {row.name}
                </td>
                <td>{row.amountG} g</td>
                <td>
                  {row.nutrients.energyKcal} kcal · P {row.nutrients.proteinG} g · C{" "}
                  {row.nutrients.carbohydratesG} g · G {row.nutrients.fatG} g · F{" "}
                  {row.nutrients.fiberG} g
                </td>
                {printModel.presentation === "preparation" ? (
                  <td>{row.preparation.instruction}</td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
        {printModel.shoppingList ? (
          <section>
            <h2>Lista de la compra</h2>
            <ul>
              {printModel.shoppingList.map((item) => (
                <li key={item.canonicalFoodKey}>
                  {item.name}: {item.amountG} g
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        {printModel.weeklyPreparation ? (
          <section>
            <h2>Preparación semanal</h2>
            <ul>
              {printModel.weeklyPreparation.map((item) => (
                <li key={item.canonicalFoodKey}>
                  <strong>{item.name}:</strong> {item.instruction}
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </article>
    </section>
  );
}
