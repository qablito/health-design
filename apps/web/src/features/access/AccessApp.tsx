import QRCode from "qrcode";
import { type FormEvent, useCallback, useEffect, useMemo, useState } from "react";

import {
  AccessApiError,
  accessClient,
  clearLocalIdentity,
  ensureAnonymousIdentity,
  type DeviceSessionSummary,
  type DeletionRequestStatus,
  type ProfileAccessSummary,
  type QrGrantResponse,
} from "./access-client";
import { QrScanner } from "./QrScanner";
import { requestTurnstileToken } from "../../services/turnstile";
import { clearPublicAssetCaches } from "../../services/client-cache";

import "./access.css";

type AccessMode = "code" | "deletion" | "home" | "invitation" | "qr";

const PRIVATE_CODE_PATTERN = "(?:[A-Fa-f0-9]{4}-){7}[A-Fa-f0-9]{4}";
const QR_PATTERN = "healthdesign-link-v1\\.[A-Za-z0-9_-]{22}";

const errorMessages: Record<string, string> = {
  ACCESS_NOT_GRANTED:
    "No se ha podido validar el acceso. Revisa los datos e inténtalo de nuevo.",
  CHALLENGE_REQUIRED: "Necesitamos una comprobación de seguridad antes de continuar.",
  DOMAIN_CONSTRAINT: "Los datos entran en conflicto con el estado actual.",
  FORBIDDEN: "Este dispositivo no puede realizar esa operación.",
  IDEMPOTENCY_KEY_REUSED:
    "La petición ya se utilizó con otros datos. Vuelve a intentarlo.",
  RATE_LIMITED: "Demasiados intentos. Espera antes de volver a probar.",
  UNAUTHENTICATED: "La sesión ya no es válida. Vuelve a identificar el dispositivo.",
};

function friendlyError(error: unknown): string {
  if (error instanceof AccessApiError) {
    const base = errorMessages[error.code] ?? "No se ha podido completar la operación.";
    return error.retryAfterSeconds
      ? `${base} Podrás reintentarlo en aproximadamente ${Math.ceil(error.retryAfterSeconds / 60)} min.`
      : base;
  }
  return "No se ha podido completar la operación. Comprueba la conexión y reintenta.";
}

async function prepareIdentity(): Promise<void> {
  await ensureAnonymousIdentity(() =>
    requestTurnstileToken({ action: "access_identity" }),
  );
}

async function retryWithChallenge<T>(
  request: (challengeToken?: string) => Promise<T>,
): Promise<T> {
  try {
    return await request();
  } catch (error) {
    if (!(error instanceof AccessApiError) || error.code !== "CHALLENGE_REQUIRED") {
      throw error;
    }
    const challengeToken = await requestTurnstileToken({ action: "access_link" });
    return request(challengeToken);
  }
}

function formText(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}

function Field({
  autoComplete,
  children,
  help,
  maxLength,
  name,
  pattern,
  required = true,
}: {
  autoComplete?: string;
  children: string;
  help?: string;
  maxLength?: number;
  name: string;
  pattern?: string;
  required?: boolean;
}) {
  const helpId = help ? `${name}-help` : undefined;
  return (
    <label className="field">
      <span>{children}</span>
      <input
        aria-describedby={helpId}
        autoComplete={autoComplete}
        maxLength={maxLength}
        name={name}
        pattern={pattern}
        required={required}
      />
      {help ? (
        <small className="field-help" id={helpId}>
          {help}
        </small>
      ) : null}
    </label>
  );
}

export function AccessApp() {
  const [mode, setMode] = useState<AccessMode>("home");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [profiles, setProfiles] = useState<ProfileAccessSummary[]>([]);
  const [selectedProfileId, setSelectedProfileId] = useState<string>();
  const [sessions, setSessions] = useState<DeviceSessionSummary[]>([]);
  const [privateCodeReveal, setPrivateCodeReveal] = useState<{
    alias: string;
    privateCode: string;
  }>();
  const [qrGrant, setQrGrant] = useState<QrGrantResponse>();
  const [qrImage, setQrImage] = useState<string>();
  const [deletionStatus, setDeletionStatus] = useState<DeletionRequestStatus>();

  const selectedProfile = useMemo(
    () => profiles.find((profile) => profile.profileId === selectedProfileId),
    [profiles, selectedProfileId],
  );

  const refreshProfiles = useCallback(async () => {
    try {
      const nextProfiles = await accessClient.listProfiles();
      setProfiles(nextProfiles);
      setSelectedProfileId((current) => current ?? nextProfiles[0]?.profileId);
      if (nextProfiles.length > 0) {
        void accessClient.touchSession().catch(() => undefined);
      }
    } catch (refreshError) {
      if (
        refreshError instanceof AccessApiError &&
        refreshError.code === "UNAUTHENTICATED"
      ) {
        setProfiles([]);
        setSelectedProfileId(undefined);
        setSessions([]);
        await clearLocalIdentity();
        return;
      }
      setError(friendlyError(refreshError));
    }
  }, []);

  useEffect(() => {
    void refreshProfiles();
  }, [refreshProfiles]);

  useEffect(() => {
    if (!selectedProfileId) {
      setSessions([]);
      return;
    }
    void accessClient
      .listSessions(selectedProfileId)
      .then(setSessions)
      .catch(() => setSessions([]));
  }, [selectedProfileId]);

  async function run(operation: () => Promise<void>) {
    setBusy(true);
    setError(undefined);
    setNotice(undefined);
    try {
      await operation();
    } catch (operationError) {
      if (
        operationError instanceof AccessApiError &&
        operationError.code === "UNAUTHENTICATED"
      ) {
        setProfiles([]);
        setSelectedProfileId(undefined);
        setSessions([]);
        await clearLocalIdentity();
      }
      setError(friendlyError(operationError));
    } finally {
      setBusy(false);
    }
  }

  async function submitInvitation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await run(async () => {
      await prepareIdentity();
      const captchaToken = await requestTurnstileToken({
        action: "access_invitation",
      });
      const result = await accessClient.redeemInvitation({
        adultAttested: true,
        alias: formText(form, "alias"),
        captchaToken,
        deviceLabel: formText(form, "deviceLabel"),
        invitationSecret: formText(form, "invitationSecret"),
        schemaVersion: 1,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      });
      setPrivateCodeReveal({ alias: result.alias, privateCode: result.privateCode });
      setMode("home");
      await refreshProfiles();
    });
  }

  async function submitCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const idempotencyKey = crypto.randomUUID();
    await run(async () => {
      await prepareIdentity();
      const result = await retryWithChallenge((challengeToken) =>
        accessClient.linkWithPrivateCode(
          {
            alias: formText(form, "alias"),
            ...(challengeToken ? { challengeToken } : {}),
            deviceLabel: formText(form, "deviceLabel"),
            privateCode: formText(form, "privateCode"),
            schemaVersion: 1,
          },
          { idempotencyKey },
        ),
      );
      setNotice(`Dispositivo vinculado al perfil ${result.alias}.`);
      setMode("home");
      await refreshProfiles();
    });
  }

  async function submitQr(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const idempotencyKey = crypto.randomUUID();
    await run(async () => {
      await prepareIdentity();
      const result = await retryWithChallenge((challengeToken) =>
        accessClient.linkWithQr(
          {
            ...(challengeToken ? { challengeToken } : {}),
            deviceLabel: formText(form, "deviceLabel"),
            qrPayload: formText(form, "qrPayload"),
            schemaVersion: 1,
          },
          { idempotencyKey },
        ),
      );
      setNotice(`Dispositivo vinculado al perfil ${result.alias}.`);
      setMode("home");
      await refreshProfiles();
    });
  }

  async function createQr() {
    if (!selectedProfileId) return;
    await run(async () => {
      const grant = await accessClient.createQrGrant(selectedProfileId);
      const image = await QRCode.toDataURL(grant.qrPayload, {
        errorCorrectionLevel: "M",
        margin: 2,
        width: 320,
      });
      setQrGrant(grant);
      setQrImage(image);
    });
  }

  async function rotateCode() {
    if (!selectedProfileId) return;
    await run(async () => {
      const result = await accessClient.rotatePrivateCode(selectedProfileId, false);
      setPrivateCodeReveal({
        alias: selectedProfile?.alias ?? "Perfil",
        privateCode: result.privateCode,
      });
      setNotice("Código privado rotado. Las sesiones existentes siguen activas.");
    });
  }

  async function revoke(deviceSessionId: string) {
    if (!selectedProfileId) return;
    await run(async () => {
      await accessClient.revokeSession(selectedProfileId, deviceSessionId);
      await clearPublicAssetCaches();
      setSessions((current) =>
        current.filter((session) => session.deviceSessionId !== deviceSessionId),
      );
      setNotice("Acceso de ese dispositivo revocado para este perfil.");
    });
  }

  async function requestDeletion(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedProfileId || !selectedProfile) return;
    const form = new FormData(event.currentTarget);
    if (formText(form, "confirmation") !== "BORRAR MI PERFIL PERMANENTEMENTE") {
      setError("La frase de confirmación no coincide.");
      return;
    }
    await run(async () => {
      const status = await accessClient.createDeletionRequest(
        selectedProfileId,
        {
          alias: formText(form, "alias"),
          confirmationPhrase: "BORRAR MI PERFIL PERMANENTEMENTE",
          irreversible: true,
          schemaVersion: 1,
        },
        { idempotencyKey: crypto.randomUUID() },
      );
      setDeletionStatus(status);
      setNotice(
        "La solicitud irreversible ha sido registrada. Guarda el identificador de seguimiento.",
      );
    });
  }

  async function refreshDeletionStatus() {
    if (!deletionStatus) return;
    await run(async () => {
      setDeletionStatus(await accessClient.getDeletionRequest(deletionStatus.handle));
    });
  }

  return (
    <main className="access-shell">
      <header className="access-header">
        <div>
          <p className="eyebrow">HEALTH DESIGN · ACCESO V1</p>
          <h1>Tus perfiles, disponibles donde los necesites</h1>
          <p className="lede">
            Entra mediante invitación o vincula este dispositivo con un código privado o
            un QR temporal.
          </p>
        </div>
        {mode !== "home" ? (
          <button className="text-button" onClick={() => setMode("home")} type="button">
            Volver
          </button>
        ) : null}
      </header>

      {error ? (
        <div className="message error-message" role="alert">
          {error}
        </div>
      ) : null}
      {notice ? (
        <div className="message success-message" role="status">
          {notice}
        </div>
      ) : null}

      {privateCodeReveal ? (
        <section className="reveal-card" aria-labelledby="private-code-title">
          <p className="eyebrow">MOSTRADO UNA SOLA VEZ</p>
          <h2 id="private-code-title">Guarda tu código privado</h2>
          <output className="private-code">{privateCodeReveal.privateCode}</output>
          <p>
            Servirá para vincular otro dispositivo. Al cerrar este aviso, el código no
            volverá a mostrarse.
          </p>
          <button
            className="primary-button"
            onClick={() => setPrivateCodeReveal(undefined)}
            type="button"
          >
            Ya lo he guardado
          </button>
        </section>
      ) : null}

      {mode === "home" ? (
        <>
          <section className="choice-grid" aria-label="Opciones de acceso">
            <button className="choice-card" onClick={() => setMode("invitation")}>
              <span className="choice-number">01</span>
              <strong>Crear perfil invitado</strong>
              <span>Usa la invitación privada recibida.</span>
            </button>
            <button className="choice-card" onClick={() => setMode("code")}>
              <span className="choice-number">02</span>
              <strong>Vincular con código</strong>
              <span>Introduce alias y código privado.</span>
            </button>
            <button className="choice-card" onClick={() => setMode("qr")}>
              <span className="choice-number">03</span>
              <strong>Escanear QR</strong>
              <span>Vincula este dispositivo en menos de un minuto.</span>
            </button>
          </section>

          {profiles.length > 0 ? (
            <section className="profile-panel" aria-labelledby="profiles-title">
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">DISPOSITIVO ACTUAL</p>
                  <h2 id="profiles-title">Perfiles vinculados</h2>
                </div>
                <select
                  aria-label="Perfil activo"
                  onChange={(event) => setSelectedProfileId(event.target.value)}
                  value={selectedProfileId}
                >
                  {profiles.map((profile) => (
                    <option key={profile.profileId} value={profile.profileId}>
                      {profile.alias}
                    </option>
                  ))}
                </select>
              </div>
              <div className="profile-actions">
                <a className="primary-button inline-link" href="/questionnaire">
                  Abrir cuestionario
                </a>
                <button
                  className="secondary-button"
                  disabled={busy}
                  onClick={() => void createQr()}
                  type="button"
                >
                  Crear QR de 5 minutos
                </button>
                <button
                  className="secondary-button"
                  disabled={busy}
                  onClick={() => void rotateCode()}
                  type="button"
                >
                  Rotar código privado
                </button>
                <button
                  className="danger-button"
                  disabled={busy}
                  onClick={() => setMode("deletion")}
                  type="button"
                >
                  Solicitar borrado permanente
                </button>
              </div>
              {qrGrant && qrImage ? (
                <div className="qr-grant" role="status">
                  <img alt="QR temporal para vincular otro dispositivo" src={qrImage} />
                  <div>
                    <h3>QR temporal listo</h3>
                    <p>
                      Escanéalo desde el otro dispositivo. Caduca a las{" "}
                      {new Intl.DateTimeFormat("es-ES", {
                        hour: "2-digit",
                        minute: "2-digit",
                      }).format(new Date(qrGrant.expiresAt))}
                      .
                    </p>
                    <button
                      className="text-button"
                      onClick={() => {
                        setQrGrant(undefined);
                        setQrImage(undefined);
                      }}
                      type="button"
                    >
                      Ocultar QR
                    </button>
                  </div>
                </div>
              ) : null}
              <h3>Dispositivos con acceso</h3>
              <ul className="session-list">
                {sessions.map((session) => (
                  <li key={session.deviceSessionId}>
                    <div>
                      <strong>
                        {session.label} {session.isCurrent ? "· Este dispositivo" : ""}
                      </strong>
                      <small>
                        Último uso:{" "}
                        {new Date(session.lastSeenAt).toLocaleDateString("es-ES")}
                      </small>
                    </div>
                    {!session.isCurrent ? (
                      <button
                        className="danger-button"
                        disabled={busy}
                        onClick={() => void revoke(session.deviceSessionId)}
                        type="button"
                      >
                        Revocar
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </>
      ) : null}

      {mode === "invitation" ? (
        <form
          className="access-form"
          onSubmit={(event) => void submitInvitation(event)}
        >
          <p className="eyebrow">ALTA POR INVITACIÓN</p>
          <h2>Crea tu primer perfil</h2>
          <Field
            autoComplete="nickname"
            help="Sin tildes ni ñ. Mayúsculas y minúsculas cuentan como el mismo alias."
            maxLength={64}
            name="alias"
            pattern="[A-Za-z0-9 _-]+"
          >
            Alias
          </Field>
          <Field
            autoComplete="off"
            help="La invitación se envía únicamente al confirmar."
            maxLength={256}
            name="invitationSecret"
          >
            Código de invitación
          </Field>
          <Field maxLength={64} name="deviceLabel">
            Nombre de este dispositivo
          </Field>
          <label className="check-field">
            <input name="adultAttested" required type="checkbox" />
            <span>Confirmo que tengo 18 años o más.</span>
          </label>
          <button className="primary-button" disabled={busy} type="submit">
            {busy ? "Comprobando…" : "Crear perfil"}
          </button>
        </form>
      ) : null}

      {mode === "code" ? (
        <form className="access-form" onSubmit={(event) => void submitCode(event)}>
          <p className="eyebrow">VINCULACIÓN PRIVADA</p>
          <h2>Usa el alias y el código guardado</h2>
          <label className="field">
            <span>Alias</span>
            <input maxLength={64} name="alias" pattern="[A-Za-z0-9 _-]+" required />
            <small className="field-help">Sin tildes ni ñ.</small>
          </label>
          <label className="field">
            <span>Código privado</span>
            <input
              autoComplete="off"
              inputMode="text"
              maxLength={39}
              name="privateCode"
              pattern={PRIVATE_CODE_PATTERN}
              placeholder="0000-0000-0000-0000-0000-0000-0000-0000"
              required
            />
          </label>
          <label className="field">
            <span>Nombre de este dispositivo</span>
            <input maxLength={64} name="deviceLabel" required />
          </label>
          <button className="primary-button" disabled={busy} type="submit">
            {busy ? "Vinculando…" : "Vincular dispositivo"}
          </button>
        </form>
      ) : null}

      {mode === "deletion" && selectedProfile ? (
        <section className="access-form" aria-labelledby="deletion-title">
          <p className="eyebrow">ACCIÓN IRREVERSIBLE</p>
          <h2 id="deletion-title">Borrar permanentemente este perfil</h2>
          <p>
            Se eliminarán el plan, cuestionarios, seguimientos, compras y archivos
            privados. No existe recuperación posterior.
          </p>
          {deletionStatus ? (
            <div role="status">
              <p>
                Estado: <strong>{deletionStatus.status}</strong>
              </p>
              <p>
                Identificador de seguimiento: <code>{deletionStatus.handle}</code>
              </p>
              {deletionStatus.errorCode ? (
                <p>Incidencia redactada: {deletionStatus.errorCode}</p>
              ) : null}
              <button
                className="secondary-button"
                disabled={busy}
                onClick={() => void refreshDeletionStatus()}
                type="button"
              >
                Actualizar estado
              </button>
            </div>
          ) : (
            <form onSubmit={(event) => void requestDeletion(event)}>
              <label className="check-field">
                <input required type="checkbox" />
                <span>Entiendo que el borrado no se puede deshacer.</span>
              </label>
              <label className="field">
                <span>Escribe el alias exacto: {selectedProfile.alias}</span>
                <input
                  autoComplete="off"
                  name="alias"
                  pattern="[A-Za-z0-9 _-]+"
                  required
                />
              </label>
              <label className="field">
                <span>Escribe BORRAR MI PERFIL PERMANENTEMENTE</span>
                <input
                  autoComplete="off"
                  name="confirmation"
                  pattern="BORRAR MI PERFIL PERMANENTEMENTE"
                  required
                />
              </label>
              <button className="danger-button" disabled={busy} type="submit">
                Confirmar solicitud irreversible
              </button>
            </form>
          )}
        </section>
      ) : null}

      {mode === "qr" ? <QrLinkForm busy={busy} onSubmit={submitQr} /> : null}
    </main>
  );
}

function QrLinkForm({
  busy,
  onSubmit,
}: {
  busy: boolean;
  onSubmit: (event: FormEvent<HTMLFormElement>) => Promise<void>;
}) {
  const [value, setValue] = useState("");
  const handleScannedValue = useCallback(
    (nextValue: string) => setValue(nextValue),
    [],
  );
  return (
    <form className="access-form" onSubmit={(event) => void onSubmit(event)}>
      <p className="eyebrow">QR DE UN SOLO USO</p>
      <h2>Escanea el QR del dispositivo vinculado</h2>
      <QrScanner disabled={busy} onValue={handleScannedValue} />
      <label className="field">
        <span>Código QR</span>
        <input
          autoComplete="off"
          maxLength={43}
          name="qrPayload"
          onChange={(event) => setValue(event.target.value)}
          pattern={QR_PATTERN}
          required
          value={value}
        />
        <small className="field-help">
          Si la cámara no está disponible, introduce aquí el contenido mostrado en el
          otro dispositivo.
        </small>
      </label>
      <label className="field">
        <span>Nombre de este dispositivo</span>
        <input maxLength={64} name="deviceLabel" required />
      </label>
      <button className="primary-button" disabled={busy} type="submit">
        {busy ? "Vinculando…" : "Vincular dispositivo"}
      </button>
    </form>
  );
}
