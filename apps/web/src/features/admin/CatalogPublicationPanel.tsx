import { useCallback, useEffect, useState } from "react";

import type {
  AdminCatalogRevisionList,
  AdminCatalogRevisionSummary,
  AdminSupermarketMatchingRuleList,
} from "@health-design/contracts";

import { adminClient } from "./admin-client";

type CatalogPublicationPanelProps = Readonly<{
  execute: <T>(operation: () => Promise<T>) => Promise<T | undefined>;
  initialList?: AdminCatalogRevisionList;
}>;

type SourceUseDecision =
  "" | "development_approved" | "development_restricted_approved";

const CHAIN_LABELS = {
  aldi: "ALDI",
  dia: "DIA",
  mercadona: "Mercadona",
} as const;

const STATE_LABELS = {
  hidden: "Oculto",
  publishable: "Publicable",
  published: "Publicado",
  quarantine: "Cuarentena",
  review: "En revisión",
} as const;

function manifestLabel(item: AdminCatalogRevisionSummary): string {
  if (!item.sourceDecisionReady) return "Licencia o términos sin resolver";
  if (
    item.manifest.licenseStatus === "restricted" ||
    item.manifest.sourceTermsStatus === "restricted"
  ) {
    return "Uso restringido: requiere decisión explícita";
  }
  return "Licencia aprobada";
}

function requiredSourceUseDecision(
  item: AdminCatalogRevisionSummary,
): Exclude<SourceUseDecision, ""> | null {
  if (!item.sourceDecisionReady) return null;
  if (
    item.manifest.licenseStatus === "restricted" ||
    item.manifest.sourceTermsStatus === "restricted"
  ) {
    return "development_restricted_approved";
  }
  return item.manifest.licenseStatus === "approved" &&
    item.manifest.sourceTermsStatus === "approved"
    ? "development_approved"
    : null;
}

export function catalogPublicationSummaryText(list: AdminCatalogRevisionList): string {
  return list.items
    .map((item) => {
      const coverage = item.coverage;
      const groups =
        coverage?.groups
          .map(({ groupKey, required, usable }) => `${groupKey} ${usable}/${required}`)
          .join(", ") ?? "sin cobertura";
      return [
        coverage
          ? `${coverage.totalUsable} / ${coverage.totalRequired}`
          : "sin cobertura",
        groups,
        `${item.manifest.errorCount} errores`,
        manifestLabel(item),
      ].join(" · ");
    })
    .join("\n");
}

export function CatalogPublicationPanel({
  execute,
  initialList,
}: CatalogPublicationPanelProps) {
  const [busy, setBusy] = useState(false);
  const [chain, setChain] = useState<"" | "mercadona" | "dia" | "aldi">("");
  const [feedback, setFeedback] = useState<string>();
  const [list, setList] = useState<AdminCatalogRevisionList | undefined>(initialList);
  const [matchingCatalogId, setMatchingCatalogId] = useState<string>();
  const [matchingRules, setMatchingRules] =
    useState<AdminSupermarketMatchingRuleList>();
  const [reviewDecisions, setReviewDecisions] = useState<
    Record<string, "exact" | "allowed" | "excluded">
  >({});
  const [sourceDecisions, setSourceDecisions] = useState<
    Record<string, SourceUseDecision>
  >({});
  const [state, setState] = useState<
    "" | "quarantine" | "review" | "publishable" | "published" | "hidden"
  >("");

  const run = useCallback(
    async <T,>(operation: () => Promise<T>): Promise<T | undefined> => {
      setBusy(true);
      setFeedback(undefined);
      try {
        return await execute(operation);
      } finally {
        setBusy(false);
      }
    },
    [execute],
  );

  const load = useCallback(async () => {
    const next = await run(() =>
      adminClient.listCatalogRevisions({
        ...(chain ? { chain } : {}),
        ...(state ? { state } : {}),
      }),
    );
    if (next) setList(next);
  }, [chain, run, state]);

  useEffect(() => {
    if (!initialList) void load();
  }, [initialList, load]);

  async function generateCandidates(item: AdminCatalogRevisionSummary) {
    const result = await run(async () => {
      let candidatesCreated = 0;
      let hasMore = true;
      let rounds = 0;
      let skusProcessed = 0;
      while (hasMore && rounds < 1_000) {
        const ack = await adminClient.generateCatalogMatchCandidates(
          item.catalogRevisionId,
          item.revisionNumber,
        );
        candidatesCreated += ack.candidatesCreated;
        skusProcessed += ack.skusProcessed;
        hasMore = ack.hasMore;
        rounds += 1;
        if (ack.skusProcessed === 0 && ack.hasMore) {
          throw new Error("catalog_matching_no_progress");
        }
      }
      if (hasMore) throw new Error("catalog_matching_batch_limit");
      return { candidatesCreated, skusProcessed };
    });
    if (result) {
      setFeedback(
        `${result.skusProcessed} productos procesados y ${result.candidatesCreated} candidatos creados.`,
      );
      await loadMatching(item.catalogRevisionId);
      await load();
    }
  }

  async function loadMatching(catalogRevisionId: string, cursor?: string) {
    const next = await run(() =>
      adminClient.listSupermarketMatchingRules(catalogRevisionId, cursor),
    );
    if (next) {
      setMatchingCatalogId(catalogRevisionId);
      setMatchingRules((current) =>
        cursor && current
          ? { ...next, items: [...current.items, ...next.items] }
          : next,
      );
    }
  }

  async function reviewMatching(matchingRuleId: string, expectedVersion: number) {
    const matchState = reviewDecisions[matchingRuleId];
    if (!matchState) return;
    const ack = await run(() =>
      adminClient.reviewSupermarketMatchingRule(
        matchingRuleId,
        expectedVersion,
        matchState,
      ),
    );
    if (ack && matchingCatalogId) {
      setFeedback(
        `Candidato revisado como ${ack.matchState}; la activación sigue siendo independiente.`,
      );
      await loadMatching(matchingCatalogId);
    }
  }

  async function activateMatching(matchingRuleId: string, expectedVersion: number) {
    const ack = await run(() =>
      adminClient.activateMatchingRule(matchingRuleId, expectedVersion),
    );
    if (ack && matchingCatalogId) {
      setFeedback(
        `Matching activado en versión ${ack.version}; aún no se ha publicado.`,
      );
      await loadMatching(matchingCatalogId);
      await load();
    }
  }

  async function publish(item: AdminCatalogRevisionSummary) {
    const sourceUseDecision = sourceDecisions[item.catalogRevisionId] ?? "";
    if (
      !sourceUseDecision ||
      !item.catalogHash ||
      !item.coverageHash ||
      !item.basketSeedHash
    ) {
      setFeedback("Falta confirmar la decisión de uso o la evidencia de cobertura.");
      return;
    }
    const ack = await run(() =>
      adminClient.publishCatalogRevision(item.catalogRevisionId, {
        expectedCatalogHash: item.catalogHash,
        expectedCoverageHash: item.coverageHash as string,
        expectedSeedHash: item.basketSeedHash as string,
        expectedVersion: item.revisionNumber,
        sourceUseDecision,
      }),
    );
    if (ack) {
      setFeedback(`${CHAIN_LABELS[ack.chain]} publicado con revisión ${ack.version}.`);
      await load();
    }
  }

  async function hide(item: AdminCatalogRevisionSummary) {
    if (!item.activePublicationId || !item.publicationVersion) return;
    const ack = await run(() =>
      adminClient.hideCatalogPublication(
        item.activePublicationId as string,
        item.publicationVersion as number,
      ),
    );
    if (ack) {
      setFeedback(`${CHAIN_LABELS[ack.chain]} ocultado sin borrar su historial.`);
      await load();
    }
  }

  return (
    <section
      aria-labelledby="catalog-publication-title"
      className="admin-card catalog-publication"
    >
      <div className="catalog-publication-header">
        <div>
          <p className="admin-eyebrow">CATÁLOGOS · T17B</p>
          <h2 id="catalog-publication-title">Revisión y publicación</h2>
          <p>
            Matching y publicación son pasos independientes. Nada se activa de forma
            automática.
          </p>
        </div>
        <button disabled={busy} onClick={() => void load()} type="button">
          Actualizar
        </button>
      </div>

      <div className="catalog-filters">
        <label>
          Cadena
          <select
            value={chain}
            onChange={(event) => setChain(event.target.value as typeof chain)}
          >
            <option value="">Todas</option>
            <option value="mercadona">Mercadona</option>
            <option value="dia">DIA</option>
            <option value="aldi">ALDI</option>
          </select>
        </label>
        <label>
          Estado
          <select
            value={state}
            onChange={(event) => setState(event.target.value as typeof state)}
          >
            <option value="">Todos</option>
            <option value="quarantine">Cuarentena</option>
            <option value="review">En revisión</option>
            <option value="publishable">Publicable</option>
            <option value="published">Publicado</option>
            <option value="hidden">Oculto</option>
          </select>
        </label>
      </div>

      {feedback ? (
        <p className="catalog-feedback" role="status">
          {feedback}
        </p>
      ) : null}
      {list?.items.length === 0 ? <p>No hay revisiones para estos filtros.</p> : null}

      <div className="catalog-revision-list">
        {list?.items.map((item) => {
          const coverage = item.coverage;
          const allowedSourceDecision = requiredSourceUseDecision(item);
          const selectedSourceDecision =
            sourceDecisions[item.catalogRevisionId] === allowedSourceDecision
              ? allowedSourceDecision
              : "";
          const canPublish =
            allowedSourceDecision !== null &&
            coverage?.publishable === true &&
            item.activePublicationId === null;
          return (
            <article className="catalog-revision" key={item.catalogRevisionId}>
              <header>
                <div>
                  <strong>
                    {CHAIN_LABELS[item.chain]} · revisión {item.revisionNumber}
                  </strong>
                  <span>
                    {STATE_LABELS[item.state]} · calidad {item.qualityStatus}
                  </span>
                </div>
                <b>{coverage ? `${coverage.totalUsable} / 80` : "Sin cobertura"}</b>
              </header>
              <dl>
                <div>
                  <dt>Registros</dt>
                  <dd>{item.manifest.recordCount}</dd>
                </div>
                <div>
                  <dt>Utilizables</dt>
                  <dd>{item.usableCount}</dd>
                </div>
                <div>
                  <dt>Errores</dt>
                  <dd>{item.manifest.errorCount}</dd>
                </div>
                <div>
                  <dt>Manifest</dt>
                  <dd>{manifestLabel(item)}</dd>
                </div>
              </dl>
              {coverage ? (
                <ul className="catalog-coverage-groups">
                  {coverage.groups.map((group) => (
                    <li key={group.groupKey}>
                      <span>{group.groupKey}</span>
                      <strong>
                        {group.usable} / {group.required}
                      </strong>
                    </li>
                  ))}
                </ul>
              ) : null}
              <div className="catalog-actions">
                <button
                  disabled={busy}
                  onClick={() => void generateCandidates(item)}
                  type="button"
                >
                  Generar candidatos
                </button>
                <button
                  disabled={busy}
                  onClick={() => void loadMatching(item.catalogRevisionId)}
                  type="button"
                >
                  Revisar matching
                </button>
                {canPublish ? (
                  <label>
                    Decisión documental
                    <select
                      value={selectedSourceDecision}
                      onChange={(event) =>
                        setSourceDecisions((current) => ({
                          ...current,
                          [item.catalogRevisionId]: event.target
                            .value as SourceUseDecision,
                        }))
                      }
                    >
                      <option value="">Confirmar antes de publicar</option>
                      {allowedSourceDecision === "development_approved" ? (
                        <option value="development_approved">
                          Uso aprobado en desarrollo
                        </option>
                      ) : (
                        <option value="development_restricted_approved">
                          Uso restringido aprobado en desarrollo
                        </option>
                      )}
                    </select>
                  </label>
                ) : null}
                {canPublish ? (
                  <button
                    disabled={busy || selectedSourceDecision === ""}
                    onClick={() => void publish(item)}
                    type="button"
                  >
                    Publicar esta revisión
                  </button>
                ) : null}
                {item.activePublicationId ? (
                  <button disabled={busy} onClick={() => void hide(item)} type="button">
                    Ocultar publicación
                  </button>
                ) : null}
              </div>
            </article>
          );
        })}
      </div>

      {matchingRules ? (
        <div className="catalog-matching" aria-label="Candidatos de matching">
          <div>
            <strong>Revisión manual de matching</strong>
            <span>Revisar y activar son acciones separadas.</span>
          </div>
          <ul className="catalog-matching-list">
            {matchingRules.items.map((rule) => {
              const canActivate =
                rule.reviewed &&
                rule.status === "draft" &&
                (rule.matchState === "exact" || rule.matchState === "allowed") &&
                rule.gtinConsistency !== "conflict" &&
                !rule.criticalIssueOpen;
              return (
                <li key={rule.matchingRuleId}>
                  <div>
                    <strong>{rule.skuName}</strong>
                    <span>
                      {rule.externalSku} → {rule.canonicalFoodName} · v{rule.version}
                    </span>
                    <small>
                      {rule.matchState} · {rule.purchaseForm} · {rule.foodState}
                    </small>
                    <small>{rule.reasons.join(" · ")}</small>
                  </div>
                  {!rule.reviewed && rule.status === "draft" ? (
                    <label>
                      Decisión
                      <select
                        value={reviewDecisions[rule.matchingRuleId] ?? ""}
                        onChange={(event) =>
                          setReviewDecisions((current) => ({
                            ...current,
                            [rule.matchingRuleId]: event.target.value as
                              "exact" | "allowed" | "excluded",
                          }))
                        }
                      >
                        <option value="">Seleccionar</option>
                        <option value="exact">Coincidencia exacta</option>
                        <option value="allowed">Alternativa permitida</option>
                        <option value="excluded">Excluir</option>
                      </select>
                    </label>
                  ) : null}
                  {!rule.reviewed && rule.status === "draft" ? (
                    <button
                      disabled={busy || !reviewDecisions[rule.matchingRuleId]}
                      onClick={() =>
                        void reviewMatching(rule.matchingRuleId, rule.version)
                      }
                      type="button"
                    >
                      Confirmar revisión
                    </button>
                  ) : null}
                  {canActivate ? (
                    <button
                      disabled={busy}
                      onClick={() =>
                        void activateMatching(rule.matchingRuleId, rule.version)
                      }
                      type="button"
                    >
                      Activar matching
                    </button>
                  ) : null}
                </li>
              );
            })}
          </ul>
          {matchingRules.nextCursor && matchingCatalogId ? (
            <button
              disabled={busy}
              onClick={() =>
                void loadMatching(
                  matchingCatalogId,
                  matchingRules.nextCursor ?? undefined,
                )
              }
              type="button"
            >
              Cargar más candidatos
            </button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
