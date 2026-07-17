# Verificación de la Tarea 4

> **Fecha:** 2026-07-17
> **Estado:** `T4_REMOTE_INFRA_PASS`
> **Alcance:** invitación, código privado, QR, sesiones y superficie web mínima
> de acceso. Este recibo demuestra la implementación local y su infraestructura
> remota; no habilita altas sin una invitación válida.

## Resultado implementado

- Alta de perfil mediante invitación de un uso y Turnstile.
- Código privado de 128 bits mostrado una sola vez y persistido únicamente
  como digest HMAC con pepper del entorno.
- Vinculación de otro dispositivo mediante código privado o QR opaco de cinco
  minutos, un uso y sin datos personales.
- Sesiones independientes por dispositivo, listado, revocación por perfil y
  cierre global separado.
- Expiración por 30 días de inactividad o 180 días absolutos, con RLS como
  barrera inmediata frente a un JWT residual.
- Rate limiting por candidato e IP, respuestas no enumerables e idempotencia
  cifrada y ligada a la operación.
- Secretos de invitación, código y QR aceptados solo en el body de `POST`, con
  rutas, queries y respuestas `no-store` libres de credenciales.
- Interfaz web funcional para invitación, código y QR, incluido escáner con
  alternativa manual accesible.

## Evidencia verde reproducida

| Comprobación | Resultado |
| --- | --- |
| Commit funcional | `f3f8ac0 feat: implement invitation and device linking` |
| `pnpm exec supabase db reset` | PASS; esquema y seed sintético recreados desde cero |
| `supabase test db supabase/tests/database/access_tokens_test.sql` | PASS; 42 pruebas pgTAP |
| `pnpm test:db` | PASS; 98 pruebas pgTAP combinadas de T3 y T4 |
| `pnpm test:e2e -- access.spec.ts` | PASS; 3 flujos E2E en Chromium |
| `pnpm edge:smoke:access` | PASS; `401`, query secreta `400`, origen ajeno `403` y preflight local controlado |
| `supabase db lint --local --level warning --fail-on warning` | PASS; sin errores ni warnings de esquema |
| `pnpm verify` | PASS; 40 pruebas unitarias, 2 de navegador, lint, tipos y build |
| `pnpm test:supply-chain` | PASS; worktree e historial inspeccionados |
| `pnpm audit --audit-level high` | PASS; sin vulnerabilidades conocidas |
| Supabase remoto | PASS; `access_tokens`, función `access` y secretos de runtime separados en desarrollo y producción |
| Smoke remoto de runtime | PASS; la clave pública anon alcanza Edge y recibe `UNAUTHENTICATED` con CORS exacto en ambos entornos |

La repetición se ejecutó con Supabase CLI `2.108.0`, Postgres local 17, pnpm
`11.13.1` y Node `v25.6.0`. El smoke utilizó exclusivamente claves y secretos
de prueba locales; no imprimió credenciales del stack.

## Propiedades comprobadas

- Una invitación válida crea exactamente un perfil, una membresía, una sesión
  y un código; expirada, revocada, consumida o repetida falla sin enumerar.
- El replay idempotente devuelve el resultado previo sin duplicar membresías.
- Dos consumos concurrentes del mismo QR producen un único éxito y una sola
  membresía adicional.
- La rotación deja exactamente un código activo, revoca el anterior y conserva
  las sesiones salvo elección explícita.
- Alias inexistente y código incorrecto producen la misma respuesta pública.
- Cinco fallos en 15 minutos o 30 intentos por IP en una hora activan sus
  límites contractuales.
- Revocar un perfil conserva las demás membresías y la sesión global cuando
  todavía existe otro perfil.
- El job dry-run de limpieza incluye solo identidades anónimas huérfanas
  elegibles y excluye actores con rol o membresía.
- La expiración cierra el actor, revoca sus membresías y elimina la sesión Auth;
  RLS vuelve inútil un JWT residual.
- El navegador no conserva invitación, QR o código en URL, historial,
  almacenamiento, logs ni payloads de navegación.

## Fallos detectados y corregidos durante T4

1. La primera implementación del job de expiración combinaba `FOR UPDATE` con
   `DISTINCT`, construcción rechazada por PostgreSQL. La selección bloqueante
   se reescribió y la base volvió a reconstruirse desde cero.
2. La prueba concurrente del QR obligó a concentrar consumo y creación de
   membresía en una única operación transaccional; el resultado final conserva
   exactamente un consumidor ganador.
3. El primer recorrido de navegador podía confundir un estado Auth previo con
   una sesión utilizable. El arranque distingue navegador limpio de JWT
   residual y elimina localmente una sesión rechazada.

## Límites explícitos

- T4 está fusionada en `main` y desplegada en ambos proyectos remotos; no se
  han provisionado invitaciones reales.
- Las pruebas usan identidades, invitaciones, QR y claves completamente
  sintéticas.
- El restablecimiento excepcional por superadministrador, AAL2, impersonación
  y ledger privilegiado pertenecen a T5.
- La interfaz demuestra los flujos de acceso; no es el diseño visual final. El
  sistema de diseño, AA y responsive se completará en T19.
