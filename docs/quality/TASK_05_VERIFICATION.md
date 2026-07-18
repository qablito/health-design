# Verificación de la Tarea 5

> **Fecha:** 2026-07-18
> **Estado:** `T5_COMPLETE_REMOTE_PASS`
> **Alcance:** superadministrador, AAL2, impersonación y continuidad del log
> privilegiado. Este recibo demuestra implementación local, activación remota
> y el recorrido real completo en desarrollo con la primera cuenta
> superadministradora y su factor TOTP.

## Resultado implementado

- Superficie web `/admin` separada del flujo de perfiles, con login propio,
  Turnstile, factor TOTP provisionado y comprobación AAL2.
- Inicio de impersonación limitado a un desafío TOTP de los últimos cinco
  minutos; el panel conserva AAL2 y la salida permanece siempre disponible.
- Rol `superadmin` no autoasignable, RPC privadas y `service_role` mantenida
  exclusivamente en Edge.
- Inicio, recuperación y salida de impersonación con actor original, perfil
  efectivo, sesión y `request_id` conservados.
- Indicador persistente tras navegar o refrescar y salida inequívoca al
  contexto administrativo.
- Protocolo `intent → transacción + espejo local + outbox → outcome` con
  compensación cerrada si Postgres revierte.
- Reconciliador HMAC cada cinco minutos: vacía outcomes pendientes y cierra
  como fallo técnico los intents externos sin mutación local.
- `TechnicalAuditEvent` inmutable y `AuditOutbox` de columnas fijas, sin body,
  headers, query ni payload libre.
- Ledger serializado en Durable Object, objetos R2 cifrados con AES-256-GCM,
  DEK única, KEK AES-KW versionada, cadena SHA-256 y recibos Ed25519.
- Rechazo de replay de nonce, firma o clave incorrecta, cambio de AAD,
  ciphertext/KEK alterados, conflicto idempotente y cuerpos mayores de 4 KiB.
- El cron y las rutas de escritura solo operan con firmas válidas; desarrollo
  y producción conservan `MUTATIONS_ENABLED="true"`.

## Evidencia RED → GREEN

| Corte | RED observado | GREEN final |
| --- | --- | --- |
| Base y RLS | faltaban tablas/RPC de admin | 45 pruebas pgTAP específicas |
| Contratos | no existían esquemas admin | 3 pruebas de contrato |
| Edge admin | AAL1 e intent no estaban modelados | 7 pruebas de autorización, orden y compensación |
| Criptografía | no había hash/recibo verificable | 2 pruebas de idempotencia y Ed25519 |
| Worker | no existían append, cifrado ni pending journal | 7 pruebas de secuencia, AEAD, replay, cron y reconciliación |
| Reconciliador | no existía endpoint interno | 3 pruebas de autenticación, success y fallo huérfano |
| Navegador | `/admin` no existía | 1 E2E de persistencia y salida |

## Evidencia verde reproducida

| Comprobación | Resultado |
| --- | --- |
| Rama aislada | `codex/task-05-admin-impersonation` sobre `c0c7c46` |
| `pnpm exec supabase db reset` | PASS; cuatro migraciones y seed desde cero |
| pgTAP aislado de T5 | PASS; 45 pruebas |
| `pnpm test:db` | PASS; 143 pruebas combinadas de T3–T5 |
| `supabase db lint --local --level warning --fail-on warning` | PASS |
| `pnpm verify` | PASS; 64 unitarias, 2 de navegador, lint, tipos y build |
| E2E admin + acceso | PASS; 5 flujos Chromium |
| `pnpm worker:check` | PASS; dry-run de desarrollo y producción |
| `pnpm test:supply-chain` | PASS |
| `pnpm audit --audit-level high` | PASS; sin vulnerabilidades conocidas |
| Migraciones remotas | PASS; cuatro migraciones presentes en desarrollo y producción |
| Edge Functions remotas | PASS; `admin` con JWT y `admin-reconciler` con autenticación HMAC propia, activas en ambos entornos |
| Workers remotos | PASS; `/health` devuelve `200` y `mutationsEnabled: true` en desarrollo y producción |
| Smoke remoto de runtime | PASS; `admin` carga su configuración y devuelve `UNAUTHENTICATED` con CORS exacto en ambos entornos |
| Superficie anónima | PASS; `access` y `admin` rechazan; el reconciliador no expone una ruta GET utilizable |
| Primera SU de desarrollo | PASS; identidad separada, rol `superadmin` y factor TOTP real en estado `verified`; credencial solo en Llavero |
| Autorización remota real | PASS; AAL1 devuelve `403/AAL2_REQUIRED`; AAL2 obtiene contexto y perfiles con `200` |
| Impersonación remota real | PASS; inicio `201`, salida `200` y contexto final `active: false` |
| Persistencia remota | PASS; sesión finalizada, cuatro eventos `intent/outcome` con recibo completo y dos outbox `success` |
| R2 remoto cifrado | PASS; objetos `admin-audit` 1–4 presentes, cadena/hash válidos y sin acción, alias, perfil, actor o sesión en claro |
| E2E administrativo actualizado | PASS; 3 flujos, incluido el token Turnstile obligatorio en el login SU |

La primera ejecución de `pnpm verify` quedó bloqueada por `EPERM` al abrir el
puerto efímero de Vitest Browser dentro del sandbox. La repetición autorizada
fuera del sandbox pasó completa; no fue un fallo del producto.

## Propiedades comprobadas

- AAL1 se rechaza antes de tocar ledger o base de datos.
- AAL2 acepta un TOTP con exactamente cinco minutos, rechaza a los 301
  segundos antes de tocar ledger o base de datos y vuelve a mostrar el
  formulario TOTP en el navegador.
- Una mutación no comienza sin recibo durable y firmado de su `intent`.
- El outcome normal se verifica, se refleja localmente y cierra el outbox de
  forma idempotente.
- Si el outcome no está disponible después del commit, la API devuelve `202`,
  conserva el resultado aplicado, muestra la auditoría pendiente y permite el
  reintento automático.
- Si no existe outbox tras cinco minutos, el reconciliador consulta el journal
  y registra `reconciliation_required` sin texto libre.
- Dos appends concurrentes obtienen secuencias externas diferentes; un retry
  idéntico devuelve el mismo recibo sin crear otro objeto.
- El cliente no puede escribir el log, el outbox o las sesiones privadas, y ni
  siquiera `service_role` dispone de inserción directa en el espejo.
- Los identificadores opacos son los únicos datos de contexto que alcanzan el
  ledger; condiciones, medicación, respuestas y contenido del plan quedan
  fuera del schema.

## Límite de cierre

- `admin`, `admin-reconciler`, Worker, Durable Object y R2 están desplegados
  con secretos distintos por entorno; sus valores no se guardan en el repo.
- La primera cuenta superadministradora y su TOTP existen únicamente en
  desarrollo. Producción no recibió ninguna identidad administrativa.
- Los endpoints estables `workers.dev` están activos y las URL de preview están
  deshabilitadas. Las escrituras exigen HMAC aunque la ruta sea alcanzable por
  Internet.
- Solo se implementan en este corte listado/contexto e impersonación. Las
  mutaciones de catálogo, backups, restore y borrado se incorporan en sus
  tareas funcionales, reutilizando la autorización y auditoría de T5.

## Referencias verificadas

- [Supabase MFA y niveles AAL](https://supabase.com/docs/guides/auth/auth-mfa)
- [Supabase `getAuthenticatorAssuranceLevel`](https://supabase.com/docs/reference/javascript/auth-mfa-getauthenticatorassurancelevel)
- [Supabase JWT claims (`aal` y `amr`)](https://supabase.com/docs/guides/auth/jwt-fields)
- [Cloudflare Durable Object migrations](https://developers.cloudflare.com/durable-objects/reference/durable-objects-migrations/)
- [Cloudflare Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/)
- [Cloudflare R2 Workers API](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/)
- [Cloudflare Web Crypto](https://developers.cloudflare.com/workers/runtime-apis/web-crypto/)
