import {
  type ChangeEvent,
  type FormEvent,
  type RefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  CommercialProductSnapshotSchema,
  type CommercialProductSnapshot,
  type PlanCandidateAck,
  type ProductConfirmationAck,
  type ProductGtin,
  type ProductNutrientValue,
  type ProductResolutionResponse,
  type ProductSymbology,
} from "@health-design/contracts";
import { normalizeDecimal } from "@health-design/engine";
import {
  classifyCommercialProductCompleteness,
  normalizeProductGtin,
} from "@health-design/catalog/products";

import { ProductApiError, productClient } from "./product-client";

import "./barcode.css";

const SYMBOLOGIES = ["ean_8", "ean_13", "upc_a", "upc_e", "itf_14"] as const;
const DETECTOR_FORMATS = ["ean_8", "ean_13", "upc_a", "upc_e", "itf_14"];
const NUTRIENT_FIELDS = [
  ["energyKcal", "Energía", "kcal"],
  ["fatG", "Grasa", "g"],
  ["saturatedFatG", "Grasa saturada", "g"],
  ["carbohydratesG", "Carbohidratos", "g"],
  ["sugarsG", "Azúcares", "g"],
  ["proteinG", "Proteína", "g"],
  ["saltG", "Sal", "g"],
  ["fiberG", "Fibra", "g"],
] as const;

type NutrientKey = (typeof NUTRIENT_FIELDS)[number][0];
type ScannerStep = "apply" | "code" | "confirm" | "review";
type DetectedBarcode = Readonly<{ format?: string; rawValue?: string }>;
type Detector = Readonly<{
  detect(source: ImageBitmapSource): Promise<DetectedBarcode[]>;
}>;
interface DetectorConstructor {
  getSupportedFormats?: () => Promise<readonly string[]>;
  new (options: { formats: string[] }): Detector;
}

export type ProductCandidatePreview = Readonly<{
  amountG: string;
  completeness: "complete" | "provisional";
  name: string;
  substitutes: readonly string[];
  totalsLabel: string;
  uncertainties: readonly string[];
}>;

type ProductScannerProps = Readonly<{
  baseVersionId: string;
  expectedVersion: number;
  fallbackFocusRef: RefObject<HTMLButtonElement | null>;
  foodName: string;
  onCandidate: (
    ack: PlanCandidateAck,
    previousFoodName: string,
  ) => Promise<ProductCandidatePreview>;
  onClose: () => void;
  planId: string;
  profileId: string;
  returnFocusRef: RefObject<HTMLButtonElement | null>;
  selection: Readonly<{
    dayIndex: number;
    expectedCanonicalFoodKey: string;
    foodIndex: number;
    mealIndex: number;
  }>;
}>;

function defaultSnapshot(gtin: ProductGtin): CommercialProductSnapshot {
  const unknown = { state: "unknown" } as const;
  return {
    basis: "per_100_g",
    density: unknown,
    gtin,
    name: "",
    nutrients: {
      carbohydratesG: unknown,
      clinical: {},
      energyKcal: unknown,
      fatG: unknown,
      fiberG: unknown,
      proteinG: unknown,
      saltG: unknown,
      saturatedFatG: unknown,
      sugarsG: unknown,
    },
    safety: {
      allergens: unknown,
      crossContactAllergens: unknown,
      ingredients: unknown,
    },
    schemaVersion: 1,
  };
}

function inferSymbology(code: string): ProductSymbology {
  if (code.length === 12) return "upc_a";
  if (code.length === 13) return "ean_13";
  if (code.length === 14) return "itf_14";
  return "ean_8";
}

function detectedSymbology(format: string | undefined, code: string) {
  return SYMBOLOGIES.find((candidate) => candidate === format) ?? inferSymbology(code);
}

function productMessage(error: unknown): string {
  if (error instanceof ProductApiError) {
    if (error.code === "RATE_LIMITED") {
      return "Se ha alcanzado el límite temporal de consultas. Inténtalo más tarde.";
    }
    if (error.code === "STALE_PRODUCT_REVISION") {
      return "La ficha cambió en otro dispositivo. Vuelve a consultar el código.";
    }
    if (error.code === "STALE_PLAN_VERSION") {
      return "La línea del plan ya cambió. Cierra este panel y recarga la versión.";
    }
    if (error.code === "PRODUCT_DATA_INSUFFICIENT") {
      return "Faltan datos necesarios para aplicar este producto al plan.";
    }
    if (error.code === "PRODUCT_MATCH_EXCLUDED") {
      return "Este producto no es compatible con el contexto declarado.";
    }
    if (error.code === "PRODUCT_MATCH_REVIEW_REQUIRED") {
      return "La relación con este alimento necesita revisión antes de aplicarse.";
    }
  }
  return "No se ha podido completar la operación. El plan sigue sin cambios.";
}

function sourceLabel(source: ProductResolutionResponse["source"]): string {
  const labels = {
    confirmed_label: "Etiqueta confirmada",
    global: "Ficha compartida revisada",
    manual_blank: "Ficha manual vacía",
    open_food_facts: "Open Food Facts",
    profile: "Corrección de este perfil",
  } as const;
  return labels[source];
}

function completenessLabel(
  completeness: ProductResolutionResponse["completeness"],
): string {
  if (completeness === "complete") return "Completa";
  if (completeness === "provisional") return "Provisional";
  return "Insuficiente";
}

async function detectorConstructor(): Promise<DetectorConstructor> {
  const native = (
    globalThis as typeof globalThis & { BarcodeDetector?: DetectorConstructor }
  ).BarcodeDetector;
  if (native) {
    const supported = native.getSupportedFormats
      ? await native.getSupportedFormats().catch(() => [])
      : DETECTOR_FORMATS;
    if (DETECTOR_FORMATS.some((format) => supported.includes(format))) return native;
  }
  const fallback = await import("barcode-detector/ponyfill");
  return fallback.BarcodeDetector as unknown as DetectorConstructor;
}

function splitLines(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeDecimalInput(value: string): string {
  try {
    return normalizeDecimal(value.trim());
  } catch {
    return value.trim();
  }
}

function normalizeSnapshot(snapshot: CommercialProductSnapshot) {
  const normalizeNutrient = (value: ProductNutrientValue): ProductNutrientValue =>
    value.state === "unknown"
      ? value
      : { ...value, value: normalizeDecimalInput(value.value) };
  const clinical = Object.fromEntries(
    Object.entries(snapshot.nutrients.clinical).map(([key, value]) => [
      key,
      normalizeNutrient(value),
    ]),
  );
  return {
    ...snapshot,
    ...(snapshot.package?.amount
      ? {
          package: {
            ...snapshot.package,
            amount: normalizeDecimalInput(snapshot.package.amount),
          },
        }
      : {}),
    density:
      snapshot.density.state === "known"
        ? {
            ...snapshot.density,
            gramsPerMl: normalizeDecimalInput(snapshot.density.gramsPerMl),
          }
        : snapshot.density,
    nutrients: {
      ...snapshot.nutrients,
      carbohydratesG: normalizeNutrient(snapshot.nutrients.carbohydratesG),
      clinical,
      energyKcal: normalizeNutrient(snapshot.nutrients.energyKcal),
      fatG: normalizeNutrient(snapshot.nutrients.fatG),
      fiberG: normalizeNutrient(snapshot.nutrients.fiberG),
      proteinG: normalizeNutrient(snapshot.nutrients.proteinG),
      saltG: normalizeNutrient(snapshot.nutrients.saltG),
      saturatedFatG: normalizeNutrient(snapshot.nutrients.saturatedFatG),
      sugarsG: normalizeNutrient(snapshot.nutrients.sugarsG),
    },
  };
}

function StructuredListField({
  label,
  onChange,
  value,
}: Readonly<{
  label: string;
  onChange: (value: CommercialProductSnapshot["safety"]["allergens"]) => void;
  value: CommercialProductSnapshot["safety"]["allergens"];
}>) {
  return (
    <label className="product-list-field">
      <span>{label}</span>
      <select
        aria-label={`Estado de ${label}`}
        onChange={(event) =>
          onChange(
            event.target.value === "known"
              ? { state: "known", values: [] }
              : { state: "unknown" },
          )
        }
        value={value.state}
      >
        <option value="unknown">No consta</option>
        <option value="known">Consta en la etiqueta</option>
      </select>
      {value.state === "known" ? (
        <textarea
          aria-label={`${label}, un elemento por línea`}
          onChange={(event) =>
            onChange({ state: "known", values: splitLines(event.target.value) })
          }
          rows={3}
          value={value.values.join("\n")}
        />
      ) : null}
    </label>
  );
}

function ProductCamera({
  busy,
  onDetected,
  onStatus,
}: Readonly<{
  busy: boolean;
  onDetected: (code: string, symbology: ProductSymbology) => void;
  onStatus: (message: string) => void;
}>) {
  const [active, setActive] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (!active) return;
    const video = videoRef.current;
    if (!video || !navigator.mediaDevices?.getUserMedia) {
      onStatus("Este navegador no permite abrir la cámara. Usa la entrada manual.");
      setActive(false);
      return;
    }
    let frame = 0;
    let stopped = false;
    let stream: MediaStream | undefined;
    let lastDetection = 0;
    const stop = () => {
      stopped = true;
      cancelAnimationFrame(frame);
      stream?.getTracks().forEach((track) => track.stop());
      if (video.srcObject) video.srcObject = null;
    };
    const start = async () => {
      try {
        const Detector = await detectorConstructor();
        if (stopped) return;
        const detector = new Detector({ formats: [...DETECTOR_FORMATS] });
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" } },
        });
        if (stopped) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        video.srcObject = stream;
        await video.play();
        const scan = async (timestamp: number) => {
          if (stopped) return;
          if (
            timestamp - lastDetection >= 180 &&
            video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA
          ) {
            lastDetection = timestamp;
            try {
              const result = (await detector.detect(video)).find(({ rawValue }) =>
                rawValue?.trim(),
              );
              if (result?.rawValue) {
                const code = result.rawValue.trim();
                onDetected(code, detectedSymbology(result.format, code));
                onStatus("Código leído. Revisa la ficha antes de confirmarla.");
                setActive(false);
                stop();
                return;
              }
            } catch {
              onStatus("No se ha podido leer este fotograma. La cámara sigue activa.");
            }
          }
          frame = requestAnimationFrame((next) => void scan(next));
        };
        frame = requestAnimationFrame((timestamp) => void scan(timestamp));
      } catch {
        onStatus(
          "No se ha podido abrir o preparar la cámara. Puedes introducir el código manualmente.",
        );
        setActive(false);
      }
    };
    void start();
    return stop;
  }, [active, onDetected, onStatus]);

  return (
    <div className="product-camera">
      <button
        className="secondary-button"
        disabled={busy}
        onClick={() => {
          onStatus("");
          setActive((current) => !current);
        }}
        type="button"
      >
        {active ? "Detener cámara" : "Escanear con la cámara"}
      </button>
      {active ? (
        <video
          aria-label="Vista de la cámara para leer el código de barras"
          muted
          playsInline
          ref={videoRef}
        />
      ) : null}
    </div>
  );
}

export function ProductScanner({
  baseVersionId,
  expectedVersion,
  fallbackFocusRef,
  foodName,
  onCandidate,
  onClose,
  planId,
  profileId,
  returnFocusRef,
  selection,
}: ProductScannerProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState("");
  const [confirmation, setConfirmation] = useState<ProductConfirmationAck>();
  const [draft, setDraft] = useState<CommercialProductSnapshot>();
  const [error, setError] = useState<string>();
  const [preview, setPreview] = useState<ProductCandidatePreview>();
  const [resolution, setResolution] = useState<ProductResolutionResponse>();
  const [status, setStatus] = useState(
    "Introduce o escanea el código. Nada se confirmará automáticamente.",
  );
  const [step, setStep] = useState<ScannerStep>("code");
  const [symbology, setSymbology] = useState<ProductSymbology>("ean_13");

  useEffect(() => {
    const previous = returnFocusRef.current;
    panelRef.current?.focus();
    return () => {
      if (previous && !previous.disabled) previous.focus();
      else fallbackFocusRef.current?.focus();
    };
  }, [fallbackFocusRef, returnFocusRef]);

  useEffect(() => {
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", close);
    return () => document.removeEventListener("keydown", close);
  }, [onClose]);

  const classification = useMemo(
    () => (draft ? classifyCommercialProductCompleteness(draft) : undefined),
    [draft],
  );

  async function resolveProduct(nextCode = code, nextSymbology = symbology) {
    setBusy(true);
    setError(undefined);
    try {
      const gtin = normalizeProductGtin({ code: nextCode, symbology: nextSymbology });
      const next = await productClient.resolve(
        profileId,
        gtin,
        selection.expectedCanonicalFoodKey,
      );
      setCode(gtin.displayGtin);
      setSymbology(gtin.symbology);
      setResolution(next);
      setDraft(next.snapshot ?? defaultSnapshot(gtin));
      setConfirmation(undefined);
      setPreview(undefined);
      setStep("review");
      setStatus(
        next.snapshot
          ? "Ficha encontrada. Revisa todos los datos antes de confirmarla."
          : "No existe una ficha válida. Completa los datos manualmente.",
      );
    } catch (resolveError) {
      setError(
        resolveError instanceof Error && resolveError.message === "invalid_gtin"
          ? "El código no tiene la longitud o el dígito de control correctos."
          : productMessage(resolveError),
      );
    } finally {
      setBusy(false);
    }
  }

  function updateNutrient(key: NutrientKey, value: ProductNutrientValue) {
    setDraft((current) =>
      current
        ? {
            ...current,
            nutrients: { ...current.nutrients, [key]: value },
          }
        : current,
    );
  }

  function updateSnapshot(event: ChangeEvent<HTMLInputElement | HTMLSelectElement>) {
    const { name, value } = event.target;
    setDraft((current) => {
      if (!current) return current;
      if (name === "basis" && (value === "per_100_g" || value === "per_100_ml")) {
        return { ...current, basis: value };
      }
      if (name === "name") return { ...current, name: value };
      if (name === "brand") {
        const next = { ...current };
        if (value.trim()) next.brand = value;
        else delete next.brand;
        return next;
      }
      return current;
    });
  }

  async function confirm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft || !resolution) return;
    const parsed = CommercialProductSnapshotSchema.safeParse(normalizeSnapshot(draft));
    if (!parsed.success) {
      setError("Revisa los campos marcados. La ficha todavía no es válida.");
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      const ack = await productClient.confirm(profileId, draft.gtin, {
        ...(resolution.revisionId ? { baseRevisionId: resolution.revisionId } : {}),
        ...(resolution.contentHash
          ? { expectedContentHash: resolution.contentHash }
          : {}),
        schemaVersion: 1,
        snapshot: parsed.data,
      });
      setDraft(parsed.data);
      setConfirmation(ack);
      setStep("confirm");
      setStatus(
        "Ficha confirmada. El plan sigue intacto hasta que crees y actives un candidato.",
      );
    } catch (confirmError) {
      setError(productMessage(confirmError));
    } finally {
      setBusy(false);
    }
  }

  const handleDetected = useCallback(
    (detectedCode: string, detectedFormat: ProductSymbology) => {
      setCode(detectedCode);
      setSymbology(detectedFormat);
      void resolveProduct(detectedCode, detectedFormat);
    },
    [profileId, selection.expectedCanonicalFoodKey],
  );

  async function apply() {
    if (!confirmation) return;
    setBusy(true);
    setError(undefined);
    try {
      const ack = await productClient.apply(planId, {
        baseVersionId,
        confirmationId: confirmation.confirmationId,
        expectedVersion,
        schemaVersion: 1,
        selection: {
          dayIndex: selection.dayIndex,
          expectedCanonicalFoodKey: selection.expectedCanonicalFoodKey,
          foodIndex: selection.foodIndex,
          mealIndex: selection.mealIndex,
        },
      });
      setPreview(await onCandidate(ack, foodName));
      setStep("apply");
      setStatus(
        "Candidato creado. La versión activa no ha cambiado; revísalo antes de activarlo.",
      );
    } catch (applyError) {
      setError(productMessage(applyError));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="product-overlay">
      <div
        aria-labelledby="product-scanner-title"
        aria-modal="true"
        className="product-panel"
        ref={panelRef}
        role="dialog"
        tabIndex={-1}
      >
        <header>
          <div>
            <p className="product-kicker">PRODUCTO COMERCIAL · {foodName}</p>
            <h2 id="product-scanner-title">Código, revisión y aplicación</h2>
          </div>
          <button
            aria-label="Cerrar producto comercial"
            className="product-close"
            disabled={busy}
            onClick={onClose}
            type="button"
          >
            Cerrar
          </button>
        </header>

        <ol aria-label="Progreso" className="product-progress">
          {[
            ["code", "1. Código"],
            ["review", "2. Revisar"],
            ["confirm", "3. Confirmar"],
            ["apply", "4. Aplicar"],
          ].map(([value, label]) => (
            <li aria-current={step === value ? "step" : undefined} key={value}>
              {label}
            </li>
          ))}
        </ol>

        <p aria-live="polite" className="product-status" role="status">
          {status}
        </p>
        {error ? (
          <p className="product-error" role="alert">
            {error}
          </p>
        ) : null}

        {step === "code" ? (
          <section aria-labelledby="product-code-title" className="product-step">
            <h3 id="product-code-title">Introduce el código</h3>
            <ProductCamera
              busy={busy}
              onDetected={handleDetected}
              onStatus={setStatus}
            />
            <div className="product-code-fields">
              <label>
                Tipo de código
                <select
                  disabled={busy}
                  onChange={(event) =>
                    setSymbology(event.target.value as ProductSymbology)
                  }
                  value={symbology}
                >
                  <option value="ean_8">EAN-8</option>
                  <option value="ean_13">EAN-13</option>
                  <option value="upc_a">UPC-A</option>
                  <option value="upc_e">UPC-E</option>
                  <option value="itf_14">ITF-14</option>
                </select>
              </label>
              <label>
                Código numérico
                <input
                  autoComplete="off"
                  disabled={busy}
                  inputMode="numeric"
                  onChange={(event) => {
                    const next = event.target.value.replace(/\D/g, "").slice(0, 14);
                    setCode(next);
                    if (next.length !== 8) setSymbology(inferSymbology(next));
                  }}
                  pattern="[0-9]{8}|[0-9]{12,14}"
                  required
                  value={code}
                />
              </label>
            </div>
            <button
              className="primary-button"
              disabled={busy || code.length < 8}
              onClick={() => void resolveProduct()}
              type="button"
            >
              {busy ? "Consultando…" : "Consultar ficha"}
            </button>
          </section>
        ) : null}

        {step === "review" && draft && resolution ? (
          <form className="product-form" onSubmit={(event) => void confirm(event)}>
            <section className="product-resolution-summary">
              <div>
                <span>Fuente</span>
                <strong>{sourceLabel(resolution.source)}</strong>
              </div>
              <div>
                <span>Estado actual</span>
                <strong>
                  {completenessLabel(classification?.completeness ?? "insufficient")}
                </strong>
              </div>
              <div>
                <span>Relación con {foodName}</span>
                <strong>{resolution.matching?.state ?? "Sin regla global"}</strong>
              </div>
            </section>

            <fieldset>
              <legend>Identidad y base nutricional</legend>
              <div className="product-form-grid">
                <label>
                  Nombre
                  <input
                    maxLength={200}
                    name="name"
                    onChange={updateSnapshot}
                    required
                    value={draft.name}
                  />
                </label>
                <label>
                  Marca, si consta
                  <input
                    maxLength={200}
                    name="brand"
                    onChange={updateSnapshot}
                    value={draft.brand ?? ""}
                  />
                </label>
                <label>
                  Valores declarados por
                  <select name="basis" onChange={updateSnapshot} value={draft.basis}>
                    <option value="per_100_g">100 g</option>
                    <option value="per_100_ml">100 ml</option>
                  </select>
                </label>
                {draft.basis === "per_100_ml" ? (
                  <label>
                    Densidad
                    <select
                      onChange={(event) =>
                        setDraft((current) =>
                          current
                            ? {
                                ...current,
                                density:
                                  event.target.value === "known"
                                    ? {
                                        gramsPerMl: "",
                                        sourceRef: "",
                                        state: "known",
                                      }
                                    : { state: "unknown" },
                              }
                            : current,
                        )
                      }
                      value={draft.density.state}
                    >
                      <option value="unknown">No consta</option>
                      <option value="known">Confirmada</option>
                    </select>
                  </label>
                ) : null}
                {draft.basis === "per_100_ml" && draft.density.state === "known" ? (
                  <>
                    <label>
                      Gramos por ml
                      <input
                        inputMode="decimal"
                        min="0.001"
                        onChange={(event) =>
                          setDraft((current) =>
                            current && current.density.state === "known"
                              ? {
                                  ...current,
                                  density: {
                                    ...current.density,
                                    gramsPerMl: event.target.value,
                                  },
                                }
                              : current,
                          )
                        }
                        required
                        step="any"
                        type="number"
                        value={draft.density.gramsPerMl}
                      />
                    </label>
                    <label>
                      Procedencia de la densidad
                      <input
                        maxLength={160}
                        onChange={(event) =>
                          setDraft((current) =>
                            current && current.density.state === "known"
                              ? {
                                  ...current,
                                  density: {
                                    ...current.density,
                                    sourceRef: event.target.value,
                                  },
                                }
                              : current,
                          )
                        }
                        required
                        value={draft.density.sourceRef}
                      />
                    </label>
                  </>
                ) : null}
              </div>
            </fieldset>

            <fieldset>
              <legend>Nutrientes declarados</legend>
              <p className="field-help">
                Valores según la base elegida; desconocido nunca equivale a cero.
              </p>
              <div className="product-nutrients-grid">
                {NUTRIENT_FIELDS.map(([key, label, unit]) => {
                  const nutrient = draft.nutrients[key];
                  return (
                    <div className="product-nutrient" key={key}>
                      <label>
                        {label}
                        <select
                          aria-label={`Estado de ${label}`}
                          onChange={(event) =>
                            updateNutrient(
                              key,
                              event.target.value === "known"
                                ? { state: "known", unit, value: "0" }
                                : { state: "unknown" },
                            )
                          }
                          value={nutrient.state === "unknown" ? "unknown" : "known"}
                        >
                          <option value="unknown">Desconocido</option>
                          <option value="known">Conocido</option>
                        </select>
                      </label>
                      {nutrient.state !== "unknown" ? (
                        <label>
                          <span className="sr-only">Valor de {label}</span>
                          <input
                            aria-label={`Valor de ${label}`}
                            inputMode="decimal"
                            min="0"
                            onChange={(event) =>
                              updateNutrient(key, {
                                state: "known",
                                unit,
                                value: event.target.value,
                              })
                            }
                            required
                            step="any"
                            type="number"
                            value={nutrient.value}
                          />
                          <span>{unit}</span>
                        </label>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </fieldset>

            <fieldset>
              <legend>Ingredientes y seguridad</legend>
              <p className="field-help">
                Escribe un elemento por línea cuando conste en la etiqueta.
              </p>
              <div className="product-form-grid">
                <StructuredListField
                  label="Ingredientes"
                  onChange={(value) =>
                    setDraft((current) =>
                      current
                        ? {
                            ...current,
                            safety: { ...current.safety, ingredients: value },
                          }
                        : current,
                    )
                  }
                  value={draft.safety.ingredients}
                />
                <StructuredListField
                  label="Alérgenos"
                  onChange={(value) =>
                    setDraft((current) =>
                      current
                        ? {
                            ...current,
                            safety: { ...current.safety, allergens: value },
                          }
                        : current,
                    )
                  }
                  value={draft.safety.allergens}
                />
                <StructuredListField
                  label="Trazas o contaminación cruzada"
                  onChange={(value) =>
                    setDraft((current) =>
                      current
                        ? {
                            ...current,
                            safety: { ...current.safety, crossContactAllergens: value },
                          }
                        : current,
                    )
                  }
                  value={draft.safety.crossContactAllergens}
                />
              </div>
            </fieldset>

            {classification && classification.uncertainties.length > 0 ? (
              <div className="product-uncertainties" role="status">
                <strong>Datos todavía inciertos</strong>
                <ul>
                  {classification.uncertainties.map((item) => (
                    <li key={item}>{item.replaceAll("_", " ")}</li>
                  ))}
                </ul>
              </div>
            ) : null}

            <div className="product-actions">
              <button
                className="secondary-button"
                disabled={busy}
                onClick={() => setStep("code")}
                type="button"
              >
                Cambiar código
              </button>
              <button className="primary-button" disabled={busy} type="submit">
                {busy ? "Confirmando…" : "Confirmar estos datos"}
              </button>
            </div>
          </form>
        ) : null}

        {step === "confirm" && confirmation && draft ? (
          <section className="product-step product-confirmed">
            <h3>Ficha confirmada</h3>
            <dl>
              <div>
                <dt>Producto</dt>
                <dd>{draft.name}</dd>
              </div>
              <div>
                <dt>Estado</dt>
                <dd>{completenessLabel(confirmation.completeness)}</dd>
              </div>
              <div>
                <dt>Plan activo</dt>
                <dd>Sin cambios</dd>
              </div>
            </dl>
            <p>
              El siguiente botón solo crea una propuesta recalculada. Después podrás
              revisarla y activarla manualmente.
            </p>
            <div className="product-actions">
              <button
                className="secondary-button"
                disabled={busy}
                onClick={() => setStep("review")}
                type="button"
              >
                Volver a revisar
              </button>
              <button
                className="primary-button"
                disabled={busy || confirmation.completeness === "insufficient"}
                onClick={() => void apply()}
                type="button"
              >
                {busy ? "Calculando…" : "Crear candidato"}
              </button>
            </div>
            {confirmation.completeness === "insufficient" ? (
              <p className="product-warning" role="status">
                Esta ficha puede conservarse, pero no aplicarse hasta completar los
                datos críticos.
              </p>
            ) : null}
          </section>
        ) : null}

        {step === "apply" && preview ? (
          <section className="product-step product-candidate">
            <h3>Candidato listo para revisar</h3>
            <dl>
              <div>
                <dt>Producto</dt>
                <dd>{preview.name}</dd>
              </div>
              <div>
                <dt>Cantidad recalculada</dt>
                <dd>{preview.amountG} g</dd>
              </div>
              <div>
                <dt>Kcal, macros y fibra</dt>
                <dd>{preview.totalsLabel}</dd>
              </div>
              <div>
                <dt>Sustituciones</dt>
                <dd>{preview.substitutes.join(" · ")}</dd>
              </div>
              <div>
                <dt>Estado</dt>
                <dd>
                  {preview.completeness === "complete" ? "Completo" : "Provisional"}
                </dd>
              </div>
            </dl>
            {preview.uncertainties.length > 0 ? (
              <div className="product-uncertainties">
                <strong>Incertidumbres visibles</strong>
                <ul>
                  {preview.uncertainties.map((item) => (
                    <li key={item}>{item.replaceAll("_", " ")}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            <p>La versión anterior sigue activa hasta que pulses «Activar plan».</p>
            <button className="primary-button" onClick={onClose} type="button">
              Cerrar y revisar candidato
            </button>
          </section>
        ) : null}
      </div>
    </div>
  );
}
