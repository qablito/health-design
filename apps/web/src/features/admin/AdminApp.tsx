import { type FormEvent, useCallback, useEffect, useMemo, useState } from "react";

import {
  AdminApiError,
  adminClient,
  type AdminBackupJob,
  type AdminImpersonationContext,
  type AdminDeletionJob,
  type AdminProfileSummary,
  type AdminRestoreJob,
} from "./admin-client";
import { ProductReviewPanel } from "./ProductReviewPanel";
import { CatalogPublicationPanel } from "./CatalogPublicationPanel";
import { supabaseAuth } from "../../services/supabase";
import { clearPublicAssetCaches } from "../../services/client-cache";
import { requestTurnstileToken } from "../../services/turnstile";

import "./admin.css";

type Stage = "loading" | "mfa" | "ready" | "signed-out";

function decodeAal(token: string): "aal1" | "aal2" {
  try {
    const payload = token.split(".")[1];
    if (!payload) return "aal1";
    const base64 = payload.replaceAll("-", "+").replaceAll("_", "/");
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
    const claims = JSON.parse(atob(padded)) as Record<string, unknown>;
    return claims.aal === "aal2" ? "aal2" : "aal1";
  } catch {
    return "aal1";
  }
}

function friendlyError(error: unknown): string {
  if (error instanceof AdminApiError) {
    if (error.code === "AAL2_REQUIRED") {
      return "Debes volver a confirmar el código TOTP antes de continuar.";
    }
    if (error.code === "FORBIDDEN") {
      return "Esta cuenta no tiene autorización de superadministrador.";
    }
    if (error.code === "DOMAIN_CONSTRAINT") {
      return "La operación entra en conflicto con el estado actual.";
    }
    if (error.retryable) return "El servicio está temporalmente indisponible.";
  }
  return "No se ha podido completar la operación.";
}

function formValue(form: FormData, field: string): string {
  const value = form.get(field);
  return typeof value === "string" ? value : "";
}

async function sha256Hex(value: string): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
  );
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function AdminApp() {
  const [stage, setStage] = useState<Stage>("loading");
  const [profiles, setProfiles] = useState<AdminProfileSummary[]>([]);
  const [context, setContext] = useState<AdminImpersonationContext>({
    active: false,
  });
  const [factorId, setFactorId] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [deletionJob, setDeletionJob] = useState<AdminDeletionJob>();
  const [deletionConfirmation, setDeletionConfirmation] = useState("");
  const [backups, setBackups] = useState<AdminBackupJob[]>([]);
  const [restores, setRestores] = useState<AdminRestoreJob[]>([]);
  const [restoreConfirmation, setRestoreConfirmation] = useState("");

  const activeProfile = useMemo(
    () =>
      context.active
        ? profiles.find((profile) => profile.profileId === context.effectiveProfileId)
        : undefined,
    [context, profiles],
  );

  const loadAdminData = useCallback(async () => {
    const [nextProfiles, nextContext, nextBackups, nextRestores] = await Promise.all([
      adminClient.listProfiles(),
      adminClient.currentContext(),
      adminClient.listBackups(),
      adminClient.listRestores(),
    ]);
    setProfiles(nextProfiles);
    setContext(nextContext);
    setBackups(nextBackups);
    setRestores(nextRestores);
  }, []);

  const prepareMfa = useCallback(async () => {
    const { data: factors, error: factorError } = await supabaseAuth.mfa.listFactors();
    const verifiedFactor = factors?.totp.find((factor) => factor.status === "verified");
    setStage("mfa");
    if (factorError || !verifiedFactor) {
      setError(
        "La cuenta administrativa debe provisionarse con un factor TOTP verificado.",
      );
      return false;
    }
    setFactorId(verifiedFactor.id);
    return true;
  }, []);

  const resolveSession = useCallback(async () => {
    const { data, error: sessionError } = await supabaseAuth.getSession();
    if (sessionError || !data.session) {
      setStage("signed-out");
      return;
    }
    if (decodeAal(data.session.access_token) === "aal2") {
      setStage("ready");
      await loadAdminData();
      return;
    }
    await prepareMfa();
  }, [loadAdminData, prepareMfa]);

  useEffect(() => {
    void resolveSession().catch((loadError) => {
      setError(friendlyError(loadError));
      setStage("signed-out");
    });
  }, [resolveSession]);

  const executeOperation = useCallback(
    async <T,>(operation: () => Promise<T>): Promise<T | undefined> => {
      setError(undefined);
      try {
        return await operation();
      } catch (operationError) {
        if (
          operationError instanceof AdminApiError &&
          operationError.code === "AAL2_REQUIRED" &&
          !(await prepareMfa())
        ) {
          return undefined;
        }
        setError(friendlyError(operationError));
        return undefined;
      }
    },
    [prepareMfa],
  );

  const run = useCallback(
    async <T,>(operation: () => Promise<T>): Promise<T | undefined> => {
      setBusy(true);
      try {
        return await executeOperation(operation);
      } finally {
        setBusy(false);
      }
    },
    [executeOperation],
  );

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await run(async () => {
      const captchaToken = await requestTurnstileToken({ action: "admin_signin" });
      const { error: signInError } = await supabaseAuth.signInWithPassword({
        email: formValue(form, "email"),
        options: { captchaToken },
        password: formValue(form, "password"),
      });
      if (signInError) throw signInError;
      await resolveSession();
    });
  }

  async function verifyTotp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!factorId) {
      setError("No existe un factor TOTP verificado para esta cuenta.");
      return;
    }
    const form = new FormData(event.currentTarget);
    await run(async () => {
      const { error: verifyError } = await supabaseAuth.mfa.challengeAndVerify({
        code: formValue(form, "totp"),
        factorId,
      });
      if (verifyError) throw verifyError;
      await resolveSession();
    });
  }

  async function start(profileId: string) {
    await run(async () => {
      const nextContext = await adminClient.startImpersonation(profileId);
      setContext(nextContext);
    });
  }

  async function end() {
    if (!context.active) return;
    await run(async () => {
      const nextContext = await adminClient.endImpersonation(
        context.impersonationSessionId,
      );
      setContext(nextContext);
    });
  }

  async function signOut() {
    await run(async () => {
      try {
        await supabaseAuth.signOut({ scope: "local" });
      } finally {
        await clearPublicAssetCaches();
      }
      setProfiles([]);
      setBackups([]);
      setRestores([]);
      setContext({ active: false });
      setStage("signed-out");
    });
  }

  async function permanentlyDelete(profile: AdminProfileSummary) {
    if (
      profile.status !== "deletion_requested" ||
      !profile.deletionJobVersion ||
      deletionConfirmation !== "PURGAR PERFIL PERMANENTEMENTE"
    ) {
      setError("Escribe la frase de confirmación completa antes de continuar.");
      return;
    }
    await run(async () => {
      const job = await adminClient.permanentlyDeleteProfile(
        profile.profileId,
        profile.deletionJobVersion!,
      );
      setDeletionJob(job);
      setDeletionConfirmation("");
      await loadAdminData();
    });
  }

  async function createBackup(kind: "precritical" | "weekly") {
    await run(async () => {
      await adminClient.createBackup(kind);
      await loadAdminData();
    });
  }

  async function createRestore(backupId: string) {
    await run(async () => {
      const targetFingerprint = await sha256Hex(
        `local-isolated:${backupId}:${crypto.randomUUID()}`,
      );
      await adminClient.createRestore(backupId, targetFingerprint);
      await loadAdminData();
    });
  }

  async function promoteRestore(restore: AdminRestoreJob) {
    if (restoreConfirmation !== "PROMOVER RESTAURACIÓN VERIFICADA") {
      setError("Escribe la frase exacta antes de autorizar la promoción.");
      return;
    }
    await run(async () => {
      await adminClient.promoteRestore(restore.restoreId, restore.version);
      setRestoreConfirmation("");
      await loadAdminData();
    });
  }

  return (
    <main className="admin-shell">
      {context.active ? (
        <section className="impersonation-banner" role="status">
          <div>
            <strong>
              Estás operando como {activeProfile?.alias ?? "un perfil seleccionado"}
            </strong>
            <span>La cuenta original de superadministrador sigue siendo el actor.</span>
          </div>
          <button disabled={busy} onClick={() => void end()} type="button">
            Salir de la impersonación
          </button>
        </section>
      ) : null}

      <header className="admin-header">
        <div>
          <p className="admin-eyebrow">HEALTH DESIGN · SUPERADMINISTRADOR</p>
          <h1>Administración privada</h1>
          <p>Superficie separada del flujo de perfiles y protegida por TOTP.</p>
        </div>
        {stage === "ready" ? (
          <button
            className="admin-secondary"
            onClick={() => void signOut()}
            type="button"
          >
            Cerrar sesión
          </button>
        ) : null}
      </header>

      {stage === "ready" ? (
        <div className="admin-audit-pending" role="status">
          Sesión de superadministrador activa. Las acciones de esta pantalla afectan a
          datos reales del entorno seleccionado.
        </div>
      ) : null}

      {error ? (
        <div className="admin-error" role="alert">
          {error}
        </div>
      ) : null}

      {context.auditClosure === "pending" ? (
        <div className="admin-audit-pending" role="status">
          La operación se ha aplicado. Su cierre técnico de auditoría está pendiente y
          el reconciliador volverá a intentarlo automáticamente.
        </div>
      ) : null}

      {stage === "loading" ? <p>Comprobando la sesión administrativa…</p> : null}

      {stage === "signed-out" ? (
        <form
          className="admin-card admin-form"
          onSubmit={(event) => void signIn(event)}
        >
          <h2>Cuenta administrativa</h2>
          <label>
            Correo
            <input autoComplete="username" name="email" required type="email" />
          </label>
          <label>
            Contraseña
            <input
              autoComplete="current-password"
              name="password"
              required
              type="password"
            />
          </label>
          <button disabled={busy} type="submit">
            Continuar
          </button>
        </form>
      ) : null}

      {stage === "mfa" ? (
        <form
          className="admin-card admin-form"
          onSubmit={(event) => void verifyTotp(event)}
        >
          <h2>Confirmación TOTP</h2>
          <label>
            Código de seis dígitos
            <input
              autoComplete="one-time-code"
              inputMode="numeric"
              maxLength={6}
              minLength={6}
              name="totp"
              pattern="[0-9]{6}"
              required
            />
          </label>
          <button disabled={busy || !factorId} type="submit">
            Verificar acceso
          </button>
        </form>
      ) : null}

      {stage === "ready" ? (
        <>
          <CatalogPublicationPanel execute={executeOperation} />
          <ProductReviewPanel execute={executeOperation} />
          <section aria-labelledby="admin-recovery-title" className="admin-card">
            <h2 id="admin-recovery-title">Copias y restauraciones</h2>
            <p>
              El panel gobierna los trabajos. La captura y la restauración se ejecutan
              mediante scripts de operador y nunca guardan la KEK aquí.
            </p>
            <div className="admin-actions">
              <button
                disabled={busy}
                onClick={() => void createBackup("weekly")}
                type="button"
              >
                Crear job semanal
              </button>
              <button
                disabled={busy}
                onClick={() => void createBackup("precritical")}
                type="button"
              >
                Crear job precrítico
              </button>
            </div>
            <h3>Backups</h3>
            <ul className="admin-profile-list">
              {backups.map((backup) => (
                <li key={backup.backupId}>
                  <div>
                    <strong>{backup.kind}</strong>
                    <span>
                      {backup.status} · versión {backup.version}
                    </span>
                  </div>
                  <button
                    disabled={busy || backup.status !== "ready"}
                    onClick={() => void createRestore(backup.backupId)}
                    type="button"
                  >
                    Preparar restore aislado
                  </button>
                </li>
              ))}
            </ul>
            <h3>Restores</h3>
            <ul className="admin-profile-list">
              {restores.map((restore) => (
                <li key={restore.restoreId}>
                  <div>
                    <strong>{restore.status}</strong>
                    <span>Backup {restore.backupId}</span>
                  </div>
                  {restore.status === "ready_for_promotion" ? (
                    <div className="admin-form">
                      <label>
                        Confirmación de promoción
                        <input
                          autoComplete="off"
                          onChange={(event) =>
                            setRestoreConfirmation(event.target.value)
                          }
                          placeholder="PROMOVER RESTAURACIÓN VERIFICADA"
                          value={restoreConfirmation}
                        />
                      </label>
                      <button
                        disabled={
                          busy ||
                          restoreConfirmation !== "PROMOVER RESTAURACIÓN VERIFICADA"
                        }
                        onClick={() => void promoteRestore(restore)}
                        type="button"
                      >
                        Autorizar promoción
                      </button>
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          </section>
          <section aria-labelledby="admin-profiles-title" className="admin-card">
            <h2 id="admin-profiles-title">Perfiles</h2>
            {profiles.length === 0 ? <p>No hay perfiles disponibles.</p> : null}
            <ul className="admin-profile-list">
              {profiles.map((profile) => (
                <li key={profile.profileId}>
                  <div>
                    <strong>{profile.alias}</strong>
                    <span>
                      {profile.status === "active" ? "Activo" : "Borrado solicitado"}
                    </span>
                  </div>
                  <button
                    disabled={busy || context.active || profile.status !== "active"}
                    onClick={() => void start(profile.profileId)}
                    type="button"
                  >
                    Acceder como este perfil
                  </button>
                  {profile.status === "deletion_requested" &&
                  profile.deletionJobVersion ? (
                    <div className="admin-form">
                      <label>
                        Confirmación final
                        <input
                          autoComplete="off"
                          onChange={(event) =>
                            setDeletionConfirmation(event.target.value)
                          }
                          placeholder="PURGAR PERFIL PERMANENTEMENTE"
                          value={deletionConfirmation}
                        />
                      </label>
                      <button
                        disabled={
                          busy ||
                          deletionConfirmation !== "PURGAR PERFIL PERMANENTEMENTE"
                        }
                        onClick={() => void permanentlyDelete(profile)}
                        type="button"
                      >
                        Ejecutar borrado permanente
                      </button>
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
            {deletionJob ? (
              <div className="admin-audit-pending" role="status">
                <strong>Job {deletionJob.status}</strong>
                <span>
                  {deletionJob.steps.filter((step) => step.completed).length}/
                  {deletionJob.steps.length} pasos completados. Los errores mostrados
                  están redactados.
                </span>
              </div>
            ) : null}
          </section>
        </>
      ) : null}
    </main>
  );
}
