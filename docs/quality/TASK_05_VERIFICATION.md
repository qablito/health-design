# Verificación de la Tarea 5

> **Fecha:** 2026-07-17
> **Estado:** `T5_LOCAL_PASS`
> **Alcance:** superadministrador, AAL2, impersonación y continuidad del log
> privilegiado. Este recibo demuestra implementación local; no afirma
> provisión de una cuenta administrativa ni activación remota del ledger.

## Resultado implementado

- Superficie web `/admin` separada del flujo de perfiles, con login propio,
  factor TOTP ya provisionado y comprobación AAL2.
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
- El cron y las rutas de escritura permanecen inertes mientras
  `MUTATIONS_ENABLED="false"`.

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

## Límite y activación pendiente

- No se ha creado una cuenta administrativa real ni un factor TOTP real.
- `admin`, `admin-reconciler`, Worker, Durable Object y R2 no se han desplegado
  o habilitado con secretos reales en este corte.
- Los Workers conservan `MUTATIONS_ENABLED="false"`; el cron no llama al
  reconciliador en ese estado.
- La URL remota del Worker privado debe definirse al activar T5; Supabase Edge
  no puede consumir un Worker sin ruta HTTPS alcanzable.
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
