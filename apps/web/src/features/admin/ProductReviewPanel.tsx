import { type FormEvent, useCallback, useEffect, useMemo, useState } from "react";

import {
  CommercialProductSnapshotSchema,
  type AdminBarcodeCorrectionDetail,
  type AdminBarcodeCorrectionList,
  type CommercialProductSnapshot,
} from "@health-design/contracts";

import { adminClient } from "./admin-client";

type CorrectionStatus = "approved" | "pending" | "rejected" | "superseded";

type ProductReviewPanelProps = Readonly<{
  execute: <T>(operation: () => Promise<T>) => Promise<T | undefined>;
}>;

const REJECTION_LABELS = {
  duplicate: "Duplicado",
  insufficient_evidence: "Evidencia insuficiente",
  invalid_data: "Datos no válidos",
  safety_risk: "Riesgo de seguridad",
} as const;

const COMPARISON_FIELDS = [
  ["name", "Nombre"],
  ["brand", "Marca"],
  ["basis", "Base nutricional"],
  ["energyKcal", "Energía"],
  ["proteinG", "Proteína"],
  ["carbohydratesG", "Carbohidratos"],
  ["fatG", "Grasa"],
  ["fiberG", "Fibra"],
  ["ingredients", "Ingredientes"],
  ["allergens", "Alérgenos"],
  ["crossContactAllergens", "Contaminación cruzada"],
] as const;

function valueAt(snapshot: CommercialProductSnapshot | null, key: string): unknown {
  if (!snapshot) return null;
  if (key === "name" || key === "brand" || key === "basis") return snapshot[key];
  if (key in snapshot.nutrients) {
    return snapshot.nutrients[key as keyof typeof snapshot.nutrients];
  }
  return snapshot.safety[key as keyof typeof snapshot.safety];
}

function readable(value: unknown): string {
  if (value === null || value === undefined) return "Sin ficha";
  if (typeof value === "string") return value;
  if (
    typeof value === "boolean" ||
    typeof value === "bigint" ||
    typeof value === "number"
  ) {
    return String(value);
  }
  if (typeof value !== "object" || Array.isArray(value)) return "No representable";
  const row = value as Record<string, unknown>;
  if (row.state === "unknown") return "Desconocido";
  if (typeof row.value === "string") {
    return `${row.value} ${typeof row.unit === "string" ? row.unit : ""}`;
  }
  if (Array.isArray(row.values)) {
    return row.values.length > 0 ? row.values.join(", ") : "Declarado: ninguno";
  }
  return JSON.stringify(value);
}

function formText(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === "string" ? value : "";
}

export function ProductReviewPanel({ execute }: ProductReviewPanelProps) {
  const [busy, setBusy] = useState(false);
  const [detail, setDetail] = useState<AdminBarcodeCorrectionDetail>();
  const [draftJson, setDraftJson] = useState("");
  const [list, setList] = useState<AdminBarcodeCorrectionList>();
  const [status, setStatus] = useState<CorrectionStatus>("pending");
  const [feedback, setFeedback] = useState<string>();
  const [matchingRule, setMatchingRule] = useState<{
    id: string;
    version: number;
  }>();

  const run = useCallback(
    async <T,>(operation: () => Promise<T>): Promise<T | undefined> => {
      setBusy(true);
      try {
        return await execute(operation);
      } finally {
        setBusy(false);
      }
    },
    [execute],
  );

  const loadList = useCallback(
    async (nextStatus = status, cursor?: string) => {
      const next = await run(() =>
        adminClient.listBarcodeCorrections(nextStatus, cursor),
      );
      if (next) setList(next);
    },
    [run, status],
  );

  const loadDetail = useCallback(
    async (correctionId: string) => {
      const next = await run(() => adminClient.barcodeCorrection(correctionId));
      if (!next) return;
      setDetail(next);
      setDraftJson(JSON.stringify(next.proposedSnapshot, null, 2));
    },
    [run],
  );

  useEffect(() => {
    void loadList(status);
  }, [loadList, status]);

  const differences = useMemo(
    () =>
      detail
        ? COMPARISON_FIELDS.map(([key, label]) => ({
            base: readable(valueAt(detail.baseSnapshot, key)),
            global: readable(valueAt(detail.globalSnapshot, key)),
            key,
            label,
            proposed: readable(valueAt(detail.proposedSnapshot, key)),
          }))
        : [],
    [detail],
  );

  async function refresh(correctionId: string) {
    await Promise.all([loadList(status), loadDetail(correctionId)]);
  }

  async function correct(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!detail) return;
    let candidate: unknown;
    try {
      candidate = JSON.parse(draftJson) as unknown;
    } catch {
      setFeedback("El JSON de la ficha no es válido.");
      return;
    }
    const parsed = CommercialProductSnapshotSchema.safeParse(candidate);
    if (!parsed.success) {
      setFeedback("La ficha completa no supera el contrato estructurado.");
      return;
    }
    const ack = await run(() =>
      adminClient.correctBarcodeCorrection(
        detail.correctionId,
        detail.version,
        parsed.data,
      ),
    );
    if (!ack) return;
    setFeedback(
      ack.auditClosure === "pending"
        ? "Revisión corregida. El cierre técnico de auditoría está pendiente."
        : "Revisión corregida y auditada.",
    );
    await refresh(detail.correctionId);
  }

  async function approve(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!detail) return;
    const form = new FormData(event.currentTarget);
    const canonicalFoodKey = formText(form, "canonicalFoodKey").trim();
    const evidence = formText(form, "evidence")
      .split(/\r?\n/)
      .map((item) => item.trim())
      .filter(Boolean);
    const matchState = (formText(form, "matchState") || "review") as
      "allowed" | "exact" | "excluded" | "insufficient" | "review";
    const ack = await run(() =>
      adminClient.approveBarcodeCorrection(detail.correctionId, {
        canonicalFoodKey,
        evidence,
        expectedVersion: detail.version,
        matchState,
      }),
    );
    if (!ack) return;
    if (ack.matchingRuleId) setMatchingRule({ id: ack.matchingRuleId, version: 1 });
    setFeedback(
      ack.auditClosure === "pending"
        ? "Ficha aprobada. El matching sigue en borrador y el cierre de auditoría está pendiente."
        : "Ficha aprobada. El matching sigue en borrador hasta su activación manual.",
    );
    await refresh(detail.correctionId);
  }

  async function reject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!detail) return;
    const reason = new FormData(event.currentTarget).get("reason") as
      keyof typeof REJECTION_LABELS | null;
    if (!reason || !(reason in REJECTION_LABELS)) return;
    const ack = await run(() =>
      adminClient.rejectBarcodeCorrection(detail.correctionId, detail.version, reason),
    );
    if (!ack) return;
    setFeedback(
      ack.auditClosure === "pending"
        ? "Propuesta rechazada. El cierre técnico de auditoría está pendiente."
        : "Propuesta rechazada y auditada.",
    );
    await refresh(detail.correctionId);
  }

  async function activateMatching() {
    if (!matchingRule) return;
    const ack = await run(() =>
      adminClient.activateMatchingRule(matchingRule.id, matchingRule.version),
    );
    if (!ack) return;
    setMatchingRule({ id: ack.matchingRuleId, version: ack.version });
    setFeedback(
      ack.auditClosure === "pending"
        ? "Matching activo. El cierre técnico de auditoría está pendiente."
        : "Matching global activado manualmente.",
    );
  }

  return (
    <section
      aria-labelledby="product-review-title"
      className="admin-card product-review"
    >
      <header className="product-review-header">
        <div>
          <p className="admin-eyebrow">CATÁLOGO COMERCIAL</p>
          <h2 id="product-review-title">Correcciones de códigos de barras</h2>
        </div>
        <label>
          Estado
          <select
            disabled={busy}
            onChange={(event) => {
              setDetail(undefined);
              setStatus(event.target.value as CorrectionStatus);
            }}
            value={status}
          >
            <option value="pending">Pendientes</option>
            <option value="approved">Aprobadas</option>
            <option value="rejected">Rechazadas</option>
            <option value="superseded">Agrupadas o superadas</option>
          </select>
        </label>
      </header>

      {feedback ? (
        <p aria-live="polite" className="admin-audit-pending" role="status">
          {feedback}
        </p>
      ) : null}

      {!list?.items.length ? <p>No hay correcciones en este estado.</p> : null}
      <ul className="product-review-list">
        {list?.items.map((item) => (
          <li key={item.correctionId}>
            <div>
              <strong>{item.name}</strong>
              <span>
                {item.gtin14} · {item.completeness} · {item.duplicateCount} propuesta(s)
              </span>
            </div>
            <button
              disabled={busy}
              onClick={() => {
                setMatchingRule(undefined);
                void loadDetail(item.correctionId);
              }}
              type="button"
            >
              Revisar
            </button>
          </li>
        ))}
      </ul>
      {list?.nextCursor ? (
        <button
          className="admin-secondary"
          disabled={busy}
          onClick={() => void loadList(status, list.nextCursor ?? undefined)}
          type="button"
        >
          Cargar siguientes
        </button>
      ) : null}

      {detail ? (
        <div className="product-review-detail">
          <h3>Comparación de la propuesta</h3>
          <table>
            <caption>Propuesta privada frente a base y revisión global</caption>
            <thead>
              <tr>
                <th scope="col">Campo</th>
                <th scope="col">Base</th>
                <th scope="col">Propuesta</th>
                <th scope="col">Global</th>
              </tr>
            </thead>
            <tbody>
              {differences.map((row) => (
                <tr key={row.key}>
                  <th scope="row">{row.label}</th>
                  <td data-label="Base">{row.base}</td>
                  <td data-label="Propuesta">{row.proposed}</td>
                  <td data-label="Global">{row.global}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {detail.status === "pending" ? (
            <div className="product-review-actions">
              <details>
                <summary>Corregir ficha completa antes de aprobar</summary>
                <form onSubmit={(event) => void correct(event)}>
                  <label>
                    Snapshot JSON completo y validado
                    <textarea
                      aria-describedby="snapshot-help"
                      onChange={(event) => setDraftJson(event.target.value)}
                      rows={14}
                      spellCheck={false}
                      value={draftJson}
                    />
                  </label>
                  <p id="snapshot-help">
                    Se crea una revisión inmutable nueva; la propuesta privada original
                    no se modifica.
                  </p>
                  <button disabled={busy} type="submit">
                    Crear revisión corregida
                  </button>
                </form>
              </details>

              <form onSubmit={(event) => void approve(event)}>
                <h4>Aprobar y preparar matching</h4>
                <label>
                  Alimento canónico
                  <input
                    name="canonicalFoodKey"
                    pattern="food:[a-z0-9][a-z0-9._:-]{0,127}"
                    placeholder="food:pollo.pechuga"
                    required
                  />
                </label>
                <label>
                  Compatibilidad
                  <select defaultValue="review" name="matchState">
                    <option value="exact">Exacta</option>
                    <option value="allowed">Permitida</option>
                    <option value="review">Requiere revisión</option>
                    <option value="excluded">Excluida</option>
                    <option value="insufficient">Datos insuficientes</option>
                  </select>
                </label>
                <label>
                  Evidencia, una referencia por línea
                  <textarea name="evidence" required rows={3} />
                </label>
                <button disabled={busy} type="submit">
                  Aprobar ficha global
                </button>
              </form>

              <form onSubmit={(event) => void reject(event)}>
                <h4>Rechazar propuesta</h4>
                <label>
                  Motivo técnico
                  <select name="reason" required>
                    {Object.entries(REJECTION_LABELS).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                <button disabled={busy} type="submit">
                  Rechazar
                </button>
              </form>
            </div>
          ) : null}

          {matchingRule ? (
            <div className="matching-activation">
              <strong>El matching está en borrador.</strong>
              <button
                disabled={busy}
                onClick={() => void activateMatching()}
                type="button"
              >
                Activar matching global
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
