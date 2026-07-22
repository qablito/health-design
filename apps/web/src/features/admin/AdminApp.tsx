import { type FormEvent, useCallback, useEffect, useMemo, useState } from "react";

import {
  AdminApiError,
  adminClient,
  type AdminImpersonationContext,
  type AdminProfileSummary,
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

export function AdminApp() {
  const [stage, setStage] = useState<Stage>("loading");
  const [profiles, setProfiles] = useState<AdminProfileSummary[]>([]);
  const [context, setContext] = useState<AdminImpersonationContext>({
    active: false,
  });
  const [factorId, setFactorId] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const activeProfile = useMemo(
    () =>
      context.active
        ? profiles.find((profile) => profile.profileId === context.effectiveProfileId)
        : undefined,
    [context, profiles],
  );

  const loadAdminData = useCallback(async () => {
    const nextProfiles = await adminClient.listProfiles();
    const nextContext = await adminClient.currentContext();
    setProfiles(nextProfiles);
    setContext(nextContext);
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
      setContext({ active: false });
      setStage("signed-out");
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
                </li>
              ))}
            </ul>
          </section>
        </>
      ) : null}
    </main>
  );
}
