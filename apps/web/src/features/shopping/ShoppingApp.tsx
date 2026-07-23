import { useEffect, useLayoutEffect, useRef, useState } from "react";

import {
  type ShoppingPreferenceRevision,
  type ShoppingSnapshotResponse,
  type ShoppingSort,
  type SupermarketChain,
} from "@health-design/contracts";

import { accessClient, type ProfileAccessSummary } from "../access/access-client";
import {
  nutritionPlanClient,
  selectCurrentVersion,
} from "../nutrition/nutrition-client";
import { ShoppingApiError, shoppingClient } from "./shopping-client";

import "../access/access.css";
import "./shopping.css";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const chainLabels: Readonly<Record<SupermarketChain, string>> = {
  aldi: "ALDI",
  dia: "DIA",
  mercadona: "Mercadona",
};
const sortLabels: Readonly<Record<ShoppingSort, string>> = {
  name_asc: "Nombre de A a Z",
  name_desc: "Nombre de Z a A",
  normalized_price_asc: "Precio normalizado, menor primero",
  price_asc: "Desembolso, menor primero",
  price_desc: "Desembolso, mayor primero",
};

type PreferenceForm = Readonly<{
  comparedChains: SupermarketChain[];
  mode: "multistore" | "single";
  preferredChain: SupermarketChain | "";
  sorting: ShoppingSort;
}>;
type Context = Readonly<{ planVersionId: string; profileId: string }>;
type PendingResolution = Readonly<{
  idempotencyKey: string;
  preferenceRevisionId: string;
}>;

const emptyPreference: PreferenceForm = {
  comparedChains: [],
  mode: "single",
  preferredChain: "",
  sorting: "normalized_price_asc",
};

function preferenceForm(revision: ShoppingPreferenceRevision | null): PreferenceForm {
  return revision === null
    ? emptyPreference
    : {
        comparedChains: [...revision.comparedChains],
        mode: revision.mode,
        preferredChain: revision.preferredChain,
        sorting: revision.sorting,
      };
}

function money(value: string): string {
  return new Intl.NumberFormat("es-ES", {
    currency: "EUR",
    minimumFractionDigits: 2,
    style: "currency",
  }).format(Number(value));
}

function measure(
  value: Readonly<{ dimension: string; quantity: string; unit: string }>,
): string {
  return `${value.quantity} ${value.unit === "unit" ? "ud." : value.unit}`;
}

function errorMessage(error: unknown): string {
  if (error instanceof ShoppingApiError) {
    if (error.code === "CATALOG_NOT_PUBLISHED") {
      return "La cadena elegida no puede calcularse ahora.";
    }
    if (error.code === "RATE_LIMITED") {
      return "Se han realizado demasiadas consultas. Espera antes de reintentar.";
    }
    if (error.code === "STALE_PLAN_VERSION") {
      return "El plan consultado ya no es la versión activa.";
    }
  }
  return "No se ha podido actualizar la compra. La cesta anterior sigue visible.";
}

function stateLabel(
  item: ShoppingSnapshotResponse["snapshot"]["items"][number],
): string {
  if (
    item.selectionOrigin === "manual" &&
    item.uncertainties.includes("shopping_manual_selection_stale")
  ) {
    return "Selección manual pendiente";
  }
  if (item.state === "price_unavailable") return "Precio no disponible";
  if (item.state === "package_unconfirmed") {
    return "Envase pendiente de confirmar";
  }
  if (item.state === "no_confirmed_product") return "Sin producto confirmado";
  return "Producto confirmado";
}

async function resolveContext(
  profiles: readonly ProfileAccessSummary[],
): Promise<Context> {
  const query = new URLSearchParams(window.location.search);
  const requestedProfile = query.get("profile");
  const requestedVersion = query.get("version");
  const profile =
    profiles.find(({ profileId }) => profileId === requestedProfile) ?? profiles[0];
  if (!profile) throw new Error("shopping_profile_required");
  if (requestedVersion && UUID_PATTERN.test(requestedVersion)) {
    return { planVersionId: requestedVersion, profileId: profile.profileId };
  }
  const history = await nutritionPlanClient.getCurrent(profile.profileId);
  const version = selectCurrentVersion(history);
  if (!version || version.status !== "active") {
    throw new Error("shopping_active_plan_required");
  }
  return { planVersionId: version.id, profileId: profile.profileId };
}

export function ShoppingApp() {
  const [availableChains, setAvailableChains] = useState<SupermarketChain[]>([]);
  const [busy, setBusy] = useState(true);
  const [context, setContext] = useState<Context>();
  const [editingProduct, setEditingProduct] = useState<string>();
  const [editingLeftover, setEditingLeftover] = useState<string>();
  const [error, setError] = useState<string>();
  const [form, setForm] = useState<PreferenceForm>(emptyPreference);
  const [legacyHint, setLegacyHint] = useState<{
    compatible: boolean;
    value: string;
  } | null>(null);
  const [pendingResolution, setPendingResolution] = useState<PendingResolution>();
  const [preference, setPreference] = useState<ShoppingPreferenceRevision | null>(null);
  const [profiles, setProfiles] = useState<ProfileAccessSummary[]>([]);
  const [snapshot, setSnapshot] = useState<ShoppingSnapshotResponse>();
  const [status, setStatus] = useState("Preparando tu compra…");
  const basketHeading = useRef<HTMLHeadingElement>(null);

  async function loadSnapshot(snapshotId: string): Promise<void> {
    const next = await shoppingClient.getSnapshot(snapshotId);
    setSnapshot(next);
  }

  async function resolveFromPreference(
    currentContext: Context,
    preferenceRevisionId: string,
    idempotencyKey: string,
  ): Promise<void> {
    const ack = await shoppingClient.createSnapshot(
      currentContext.planVersionId,
      { preferenceRevisionId, schemaVersion: 1 },
      { idempotencyKey },
    );
    await loadSnapshot(ack.snapshotId);
    setPendingResolution(undefined);
  }

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const nextProfiles = await accessClient.listProfiles();
        if (!active) return;
        setProfiles(nextProfiles);
        const nextContext = await resolveContext(nextProfiles);
        const [chains, preferenceResponse] = await Promise.all([
          shoppingClient.discoverAvailableChains(),
          shoppingClient.getPreference(nextContext.profileId),
        ]);
        if (!active) return;
        setAvailableChains(chains);
        setContext(nextContext);
        setLegacyHint(preferenceResponse.legacyHint);
        setPreference(preferenceResponse.preference);
        setForm(preferenceForm(preferenceResponse.preference));
        if (
          preferenceResponse.preference !== null &&
          chains.includes(preferenceResponse.preference.preferredChain)
        ) {
          setStatus("Calculando desde la preferencia guardada…");
          await resolveFromPreference(
            nextContext,
            preferenceResponse.preference.id,
            `shopping-open:${nextContext.planVersionId}:${preferenceResponse.preference.id}`,
          );
        }
        if (!active) return;
        setStatus("");
      } catch (loadError) {
        if (active) setError(errorMessage(loadError));
      } finally {
        if (active) setBusy(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  useLayoutEffect(() => {
    if (snapshot) basketHeading.current?.focus();
  }, [snapshot]);

  function updateMode(mode: "multistore" | "single"): void {
    setForm((current) => ({
      ...current,
      comparedChains: mode === "multistore" ? [...availableChains] : [],
      mode,
    }));
  }

  async function savePreference(): Promise<void> {
    if (!context || !form.preferredChain) return;
    const preferredChain = form.preferredChain;
    setBusy(true);
    setError(undefined);
    setStatus("Guardando preferencia…");
    try {
      const ack = await shoppingClient.putPreference(
        context.profileId,
        {
          comparedChains: form.mode === "single" ? [] : form.comparedChains,
          expectedVersion: preference?.version ?? null,
          mode: form.mode,
          preferredChain,
          schemaVersion: 1,
          sorting: form.sorting,
        },
        { idempotencyKey: crypto.randomUUID() },
      );
      const retry = {
        idempotencyKey: crypto.randomUUID(),
        preferenceRevisionId: ack.preferenceRevisionId,
      };
      setPendingResolution(retry);
      const saved = await shoppingClient.getPreference(context.profileId);
      if (saved.preference?.id !== ack.preferenceRevisionId) {
        throw new Error("shopping_preference_ack_mismatch");
      }
      setPreference(saved.preference);
      setStatus("Preferencia guardada. Recalculando…");
      try {
        await resolveFromPreference(
          context,
          retry.preferenceRevisionId,
          retry.idempotencyKey,
        );
        setStatus("");
      } catch (resolutionError) {
        setError(
          `La preferencia se ha guardado, pero no se ha podido recalcular. ${errorMessage(resolutionError)}`,
        );
      }
    } catch (preferenceError) {
      setError(errorMessage(preferenceError));
    } finally {
      setBusy(false);
    }
  }

  async function retryResolution(): Promise<void> {
    if (!context || !pendingResolution) return;
    setBusy(true);
    setError(undefined);
    setStatus("Reintentando el cálculo…");
    try {
      await resolveFromPreference(
        context,
        pendingResolution.preferenceRevisionId,
        pendingResolution.idempotencyKey,
      );
      setStatus("");
    } catch (retryError) {
      setError(errorMessage(retryError));
    } finally {
      setBusy(false);
    }
  }

  async function mutate(
    operation: () => Promise<{ snapshotId: string }>,
  ): Promise<void> {
    setBusy(true);
    setError(undefined);
    setStatus("Actualizando la cesta…");
    try {
      const ack = await operation();
      await loadSnapshot(ack.snapshotId);
      setEditingLeftover(undefined);
      setEditingProduct(undefined);
      setStatus("");
    } catch (mutationError) {
      setError(errorMessage(mutationError));
    } finally {
      setBusy(false);
    }
  }

  const savedUnavailable =
    preference !== null && !availableChains.includes(preference.preferredChain);
  const multistoreUnavailable = availableChains.length < 2;

  return (
    <main className="shopping-shell">
      <header className="shopping-header">
        <div>
          <p className="eyebrow">HEALTH DESIGN · COMPRA T17</p>
          <h1>Compra semanal</h1>
          <p className="lede">
            Productos y precios orientativos para ejecutar tu lista nutricional.
          </p>
        </div>
        <div className="shopping-nav">
          {profiles.length > 1 ? (
            <label>
              Perfil
              <select
                disabled={busy}
                onChange={(event) => {
                  window.location.href = `/shopping?profile=${event.target.value}`;
                }}
                value={context?.profileId ?? ""}
              >
                {profiles.map((profile) => (
                  <option key={profile.profileId} value={profile.profileId}>
                    {profile.alias}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <a className="text-button" href="/nutrition">
            Volver a alimentación
          </a>
        </div>
      </header>

      <p aria-live="polite" className="shopping-live" role="status">
        {busy ? status : ""}
      </p>
      {error ? (
        <div className="message error-message" role="alert">
          <p>{error}</p>
          {pendingResolution ? (
            <button
              className="secondary-button"
              disabled={busy}
              onClick={() => void retryResolution()}
              type="button"
            >
              Reintentar cálculo
            </button>
          ) : null}
        </div>
      ) : null}

      <section
        aria-labelledby="shopping-preference-title"
        className="shopping-preference"
      >
        <div>
          <p className="eyebrow">CONFIGURACIÓN</p>
          <h2 id="shopping-preference-title">Cómo quieres comprar</h2>
          <p>Tu tienda habitual siempre prevalece salvo que actives multitienda.</p>
        </div>

        {legacyHint ? (
          <p className="shopping-note">
            Tu respuesta anterior fue {legacyHint.value}.{" "}
            {legacyHint.compatible
              ? "Confírmala para usarla en compra."
              : `${legacyHint.value} no es compatible con las cadenas de esta versión.`}
          </p>
        ) : null}
        {savedUnavailable ? (
          <p className="shopping-note" role="status">
            Tu habitual guardada, {chainLabels[preference.preferredChain]}, no puede
            calcularse ahora. Elige otra cadena para crear una revisión nueva.
          </p>
        ) : null}

        <fieldset disabled={busy}>
          <legend>Tienda habitual</legend>
          <div className="shopping-choice-row">
            {availableChains.map((chain) => (
              <label key={chain}>
                <input
                  checked={form.preferredChain === chain}
                  name="preferred-chain"
                  onChange={() =>
                    setForm((current) => ({
                      ...current,
                      comparedChains:
                        current.mode === "multistore"
                          ? [...new Set([...current.comparedChains, chain])]
                          : [],
                      preferredChain: chain,
                    }))
                  }
                  type="radio"
                />
                {chainLabels[chain]}
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset disabled={busy}>
          <legend>Modo de compra</legend>
          <div className="shopping-choice-row">
            <label>
              <input
                checked={form.mode === "single"}
                name="shopping-mode"
                onChange={() => updateMode("single")}
                type="radio"
              />
              Una tienda
            </label>
            <label>
              <input
                checked={form.mode === "multistore"}
                disabled={multistoreUnavailable}
                name="shopping-mode"
                onChange={() => updateMode("multistore")}
                type="radio"
              />
              Varios supermercados
            </label>
          </div>
          {multistoreUnavailable ? (
            <small>Se necesitan al menos dos cadenas publicadas para comparar.</small>
          ) : null}
        </fieldset>

        {form.mode === "multistore" ? (
          <fieldset disabled={busy}>
            <legend>Cadenas que quieres comparar</legend>
            <div className="shopping-choice-row">
              {availableChains.map((chain) => (
                <label key={chain}>
                  <input
                    checked={form.comparedChains.includes(chain)}
                    disabled={form.preferredChain === chain}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        comparedChains: event.target.checked
                          ? [...new Set([...current.comparedChains, chain])]
                          : current.comparedChains.filter((value) => value !== chain),
                      }))
                    }
                    type="checkbox"
                  />
                  {chainLabels[chain]}
                </label>
              ))}
            </div>
          </fieldset>
        ) : null}

        <label className="field shopping-sort">
          Orden de la cesta
          <select
            disabled={busy}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                sorting: event.target.value as ShoppingSort,
              }))
            }
            value={form.sorting}
          >
            {Object.entries(sortLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <button
          className="primary-button"
          disabled={
            busy ||
            !form.preferredChain ||
            (form.mode === "multistore" && form.comparedChains.length < 2)
          }
          onClick={() => void savePreference()}
          type="button"
        >
          {preference ? "Guardar y recalcular" : "Guardar y calcular"}
        </button>
      </section>

      {snapshot ? (
        <section aria-labelledby="shopping-basket-title" className="shopping-basket">
          <header>
            <div>
              <p className="eyebrow">CESTA ACTUAL</p>
              <h2 id="shopping-basket-title" ref={basketHeading} tabIndex={-1}>
                Tu cesta orientativa
              </h2>
            </div>
            <div className="shopping-total">
              <span>
                {snapshot.snapshot.totals.kind === "complete"
                  ? "Total orientativo"
                  : "Subtotal de productos confirmados"}
              </span>
              <strong>
                {money(
                  snapshot.snapshot.totals.kind === "complete"
                    ? snapshot.snapshot.totals.estimatedTotalEur
                    : snapshot.snapshot.totals.partialSubtotalEur,
                )}
              </strong>
              <small>
                {snapshot.snapshot.totals.resolvedItems} de{" "}
                {snapshot.snapshot.totals.coverage.totalItems} productos resueltos
              </small>
            </div>
          </header>

          {snapshot.snapshot.comparison ? (
            <aside className="shopping-comparison">
              <strong>
                Comparación{" "}
                {snapshot.snapshot.comparison.scope === "complete"
                  ? "completa"
                  : "parcial"}
              </strong>
              <p>
                {snapshot.snapshot.comparison.scope === "complete"
                  ? `Ahorro orientativo: ${money(snapshot.snapshot.comparison.savingsEur!)}`
                  : `${snapshot.snapshot.comparison.comparableItems} líneas comparables; no se declara un ahorro global.`}
              </p>
              <p>
                Tu tienda habitual sigue siendo{" "}
                {chainLabels[snapshot.snapshot.preference.preferredChain]}.
              </p>
              {snapshot.snapshot.items.some(
                ({ selectionOrigin }) => selectionOrigin === "manual",
              ) ? (
                <p>
                  Comparación orientativa entre opciones automáticas equivalentes. Tu
                  producto elegido se mantiene.
                </p>
              ) : null}
            </aside>
          ) : null}

          <div className="shopping-items">
            {snapshot.snapshot.items.map((item) => (
              <article
                className={`shopping-item ${item.state}`}
                key={item.shoppingItemId}
              >
                <header>
                  <div>
                    <h3 data-shopping-item-name>{item.name}</h3>
                    <p>{item.amountG} g para la semana</p>
                  </div>
                  <span className="shopping-state">{stateLabel(item)}</span>
                </header>

                {item.selected ? (
                  <dl className="shopping-product-data">
                    <div>
                      <dt>Cadena</dt>
                      <dd>{chainLabels[item.selected.projection.chain]}</dd>
                    </div>
                    <div>
                      <dt>Producto</dt>
                      <dd>{item.selected.projection.name}</dd>
                    </div>
                    <div>
                      <dt>Envase</dt>
                      <dd>
                        {item.selected.projection.formatText ??
                          measure(item.selected.projection.package!.saleMeasure)}
                      </dd>
                    </div>
                    <div>
                      <dt>Precio base orientativo</dt>
                      <dd>{money(item.selected.projection.basePriceEur!)}</dd>
                    </div>
                    <div>
                      <dt>Envases</dt>
                      <dd>{item.selected.packageCount}</dd>
                    </div>
                    <div>
                      <dt>Coste orientativo</dt>
                      <dd>{money(item.selected.totalCostEur)}</dd>
                    </div>
                    <div>
                      <dt>Remanente estimado</dt>
                      <dd>{item.selected.estimatedRemainderG} g</dd>
                    </div>
                    {item.selected.projection.normalizedPrice ? (
                      <div>
                        <dt>Precio normalizado orientativo</dt>
                        <dd>
                          {money(item.selected.projection.normalizedPrice.value)} /{" "}
                          {item.selected.projection.normalizedPrice.unit.split("/")[1]}
                        </dd>
                      </div>
                    ) : null}
                  </dl>
                ) : null}

                <div className="shopping-item-actions">
                  {item.alternatives.some(({ state }) => state === "resolved") ? (
                    <button
                      className="secondary-button"
                      disabled={busy}
                      onClick={() => setEditingProduct(item.canonicalFoodKey)}
                      type="button"
                    >
                      Cambiar producto de {item.name}
                    </button>
                  ) : null}
                  <button
                    className="secondary-button"
                    disabled={busy}
                    onClick={() => setEditingLeftover(item.canonicalFoodKey)}
                    type="button"
                  >
                    Declarar sobrante de {item.name}
                  </button>
                  <button
                    className="text-button"
                    disabled={busy}
                    onClick={() =>
                      void mutate(() =>
                        shoppingClient.clearLeftover(
                          snapshot.snapshot.id,
                          {
                            action: "clear",
                            canonicalFoodKey: item.canonicalFoodKey,
                            expectedVersion: snapshot.snapshot.revision,
                            schemaVersion: 1,
                          },
                          { idempotencyKey: crypto.randomUUID() },
                        ),
                      )
                    }
                    type="button"
                  >
                    Eliminar sobrante de {item.name}
                  </button>
                  <a
                    className="text-button"
                    href={`/nutrition?version=${snapshot.snapshot.planVersionId}&profile=${snapshot.snapshot.profileId}`}
                  >
                    Sustituir alimento
                  </a>
                </div>

                {editingProduct === item.canonicalFoodKey ? (
                  <ProductChoice
                    busy={busy}
                    item={item}
                    onConfirm={(skuId) =>
                      mutate(() =>
                        shoppingClient.selectProduct(
                          snapshot.snapshot.id,
                          {
                            canonicalFoodKey: item.canonicalFoodKey,
                            expectedVersion: snapshot.snapshot.revision,
                            schemaVersion: 1,
                            skuId,
                          },
                          { idempotencyKey: crypto.randomUUID() },
                        ),
                      )
                    }
                  />
                ) : null}
                {editingLeftover === item.canonicalFoodKey ? (
                  <LeftoverForm
                    busy={busy}
                    item={item}
                    onConfirm={(quantity, unit) =>
                      mutate(() =>
                        shoppingClient.setLeftover(
                          snapshot.snapshot.id,
                          {
                            action: "set",
                            canonicalFoodKey: item.canonicalFoodKey,
                            declaredMeasure:
                              unit === "g"
                                ? { dimension: "mass", quantity, unit }
                                : unit === "ml"
                                  ? { dimension: "volume", quantity, unit }
                                  : { dimension: "count", quantity, unit },
                            expectedVersion: snapshot.snapshot.revision,
                            schemaVersion: 1,
                            ...(unit === "g"
                              ? {}
                              : { skuId: item.selected!.projection.skuId }),
                          },
                          { idempotencyKey: crypto.randomUUID() },
                        ),
                      )
                    }
                  />
                ) : null}
              </article>
            ))}
          </div>
        </section>
      ) : null}
    </main>
  );
}

function ProductChoice({
  busy,
  item,
  onConfirm,
}: Readonly<{
  busy: boolean;
  item: ShoppingSnapshotResponse["snapshot"]["items"][number];
  onConfirm(skuId: string): Promise<void>;
}>) {
  const choices = item.alternatives.flatMap((alternative) =>
    alternative.state === "resolved" ? [alternative.selection] : [],
  );
  const [skuId, setSkuId] = useState(choices[0]?.projection.skuId ?? "");
  return (
    <div className="shopping-inline-form">
      <label className="field">
        Producto alternativo para {item.name}
        <select
          disabled={busy}
          onChange={(event) => setSkuId(event.target.value)}
          value={skuId}
        >
          {choices.map((choice) => (
            <option key={choice.projection.skuId} value={choice.projection.skuId}>
              {choice.projection.name} · {money(choice.totalCostEur)} orientativo
            </option>
          ))}
        </select>
      </label>
      <button
        className="primary-button"
        disabled={busy || !skuId}
        onClick={() => void onConfirm(skuId)}
        type="button"
      >
        Confirmar producto
      </button>
    </div>
  );
}

function LeftoverForm({
  busy,
  item,
  onConfirm,
}: Readonly<{
  busy: boolean;
  item: ShoppingSnapshotResponse["snapshot"]["items"][number];
  onConfirm(quantity: string, unit: "g" | "ml" | "unit"): Promise<void>;
}>) {
  const [quantity, setQuantity] = useState("");
  const [unit, setUnit] = useState<"g" | "ml" | "unit">("g");
  const conversionUnavailable = unit !== "g" && item.selected === null;
  return (
    <div className="shopping-inline-form">
      <label className="field">
        Cantidad sobrante de {item.name}
        <input
          disabled={busy}
          inputMode="decimal"
          min="0.01"
          onChange={(event) => setQuantity(event.target.value)}
          step="any"
          type="number"
          value={quantity}
        />
      </label>
      <label className="field">
        Unidad
        <select
          disabled={busy}
          onChange={(event) => setUnit(event.target.value as "g" | "ml" | "unit")}
          value={unit}
        >
          <option value="g">g</option>
          <option value="ml">ml</option>
          <option value="unit">unidades</option>
        </select>
      </label>
      {conversionUnavailable ? (
        <p role="alert">Esta unidad necesita un producto confirmado.</p>
      ) : null}
      <button
        className="primary-button"
        disabled={
          busy ||
          !/^(?:0|[1-9]\d*)(?:\.\d*[1-9])?$/.test(quantity) ||
          conversionUnavailable
        }
        onClick={() => void onConfirm(quantity, unit)}
        type="button"
      >
        Confirmar sobrante
      </button>
    </div>
  );
}
