import { useMemo, useState } from "react";

import {
  EXPORT_RENDERER_VERSION,
  type ExportChoice,
  type ExportCreateRequestContract,
  type NutritionWeekV2Contract,
  type ShoppingSnapshotResponse,
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
  shoppingSnapshot?: ShoppingSnapshotResponse;
}>;

const chainLabels = { aldi: "ALDI", dia: "DIA", mercadona: "Mercadona" } as const;
const stateLabels = {
  no_confirmed_product: "Sin producto confirmado",
  package_unconfirmed: "Envase pendiente de confirmar",
  price_unavailable: "Precio no disponible",
  resolved: "Producto confirmado",
} as const;

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
  shoppingSnapshot,
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
  const [shoppingSource, setShoppingSource] = useState<"canonical" | "snapshot">(
    shoppingSnapshot ? "snapshot" : "canonical",
  );

  function config(format: ExportFormat): ExportCreateRequestContract {
    const useSnapshot = shoppingSource === "snapshot" && shoppingSnapshot;
    return {
      choices: useSnapshot ? [] : [...choices],
      detail,
      format,
      includeShopping: useSnapshot ? true : includeShopping,
      includeWeeklyPreparation:
        (useSnapshot || rangeKind === "week") && includeWeeklyPreparation,
      presentation,
      range:
        useSnapshot || rangeKind === "week" ? { kind: "week" } : { day, kind: "day" },
      schemaVersion: 1,
      ...(useSnapshot ? { shoppingSnapshotId: useSnapshot.snapshot.id } : {}),
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
        ...(shoppingSource === "snapshot" && shoppingSnapshot
          ? { shoppingSnapshot: shoppingSnapshot.snapshot }
          : {}),
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
      shoppingSnapshot,
      shoppingSource,
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
          <p className="export-kicker">
            SALIDA PRIVADA · {shoppingSnapshot ? "T17" : "T15"}
          </p>
          <h2 id="export-panel-title">Exportar el plan</h2>
        </div>
        <p>Imprime al momento o crea un archivo privado con las elecciones que ves.</p>
      </header>

      <div className="export-grid">
        {shoppingSnapshot ? (
          <fieldset>
            <legend>Fuente de compra</legend>
            <label>
              <input
                checked={shoppingSource === "snapshot"}
                name="export-shopping-source"
                onChange={() => {
                  setShoppingSource("snapshot");
                  setRangeKind("week");
                  setIncludeShopping(true);
                }}
                type="radio"
              />
              <span>
                <strong>Cesta orientativa actual</strong>
                Conserva productos, envases, precios y orden
              </span>
            </label>
            <label>
              <input
                checked={shoppingSource === "canonical"}
                name="export-shopping-source"
                onChange={() => setShoppingSource("canonical")}
                type="radio"
              />
              <span>
                <strong>Lista canónica de ingredientes</strong>
                Mantiene las cantidades nutricionales
              </span>
            </label>
          </fieldset>
        ) : null}

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
              disabled={shoppingSource === "snapshot"}
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
              disabled={rangeKind !== "day" || shoppingSource === "snapshot"}
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
              disabled={shoppingSource === "snapshot"}
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
        {printModel.shopping?.kind === "canonical" ? (
          <section>
            <h2>Lista de la compra</h2>
            <ul>
              {printModel.shopping.items.map((item) => (
                <li key={item.canonicalFoodKey}>
                  {item.name}: {item.amountG} g
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        {printModel.shopping?.kind === "snapshot" ? (
          <section className="export-print-shopping">
            <h2>Compra semanal</h2>
            <table>
              <thead>
                <tr>
                  <th>Alimento</th>
                  <th>Estado</th>
                  <th>Producto</th>
                  <th>Precio base</th>
                  <th>Envases</th>
                  <th>Coste</th>
                  <th>Remanente</th>
                  <th>Precio normalizado</th>
                </tr>
              </thead>
              <tbody>
                {printModel.shopping.items.map((item) => (
                  <tr key={item.canonicalFoodKey}>
                    <td>
                      {item.name} · {item.amountG} g
                    </td>
                    <td>{stateLabels[item.state]}</td>
                    <td>
                      {item.selected
                        ? `${chainLabels[item.selected.chain]} · ${item.selected.productName} · ${item.selected.formatText}${item.selectionOrigin === "manual" ? " · Elección manual" : ""}`
                        : "Pendiente"}
                    </td>
                    <td>{item.selected ? `${item.selected.basePriceEur} EUR` : "—"}</td>
                    <td>{item.selected?.packageCount ?? "—"}</td>
                    <td>{item.selected ? `${item.selected.totalCostEur} EUR` : "—"}</td>
                    <td>
                      {item.selected ? `${item.selected.estimatedRemainderG} g` : "—"}
                    </td>
                    <td>
                      {item.selected?.normalizedPrice
                        ? `${item.selected.normalizedPrice.value} ${item.selected.normalizedPrice.unit}`
                        : "No comparable"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p>
              <strong>
                {printModel.shopping.totals.kind === "complete"
                  ? `Total orientativo: ${printModel.shopping.totals.estimatedTotalEur} EUR`
                  : `Subtotal de productos confirmados: ${printModel.shopping.totals.partialSubtotalEur} EUR`}
              </strong>
              {" · "}
              {printModel.shopping.totals.coverage.resolvedItems}/
              {printModel.shopping.totals.coverage.totalItems} productos
            </p>
            {printModel.shopping.comparison?.scope === "complete" ? (
              <p>
                Ahorro orientativo: {printModel.shopping.comparison.savingsEur} EUR. La
                tienda habitual sigue siendo{" "}
                {chainLabels[printModel.shopping.preference.preferredChain]}.
              </p>
            ) : printModel.shopping.comparison?.scope === "partial" ? (
              <p>
                Comparación parcial: {printModel.shopping.comparison.comparableItems}/
                {printModel.shopping.comparison.totalItems} líneas comparables. No se
                declara un ahorro global.
              </p>
            ) : null}
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
