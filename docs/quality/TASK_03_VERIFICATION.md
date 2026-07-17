# Verificación de la Tarea 3

> **Fecha:** 2026-07-17
> **Estado:** `T3_REMOTE_INFRA_PASS`
> **Alcance:** esquema de identidad, perfil, membresía, sesión y RLS. Este
> recibo demuestra la implementación local y el esquema remoto desplegado.

## Resultado implementado

- `Actor`, `Profile`, `ProfileAccess` y `DeviceSession` con claves, estados,
  timestamps y relaciones restrictivas.
- Tablas privadas mínimas para invitaciones, códigos de acceso, trabajos de
  borrado y eventos técnicos, sin exposición directa al cliente.
- Alias ASCII normalizado de forma insensible a mayúsculas y espacios. Se
  rechazan tildes, `ñ` y caracteres no permitidos.
- Reserva única del alias para perfiles `active` y `deletion_requested`; el
  alias solo vuelve a estar disponible después de una purga válida.
- `private.ensure_actor()` sin argumentos controlables por el cliente: deriva
  el sujeto de `auth.uid()`, crea únicamente rol `device`, es idempotente y
  rechaza UID nulo o actor deshabilitado.
- RLS basada en actor, membresía activa, sesión exacta del JWT, sesión no
  revocada y perfil activo. Conocer un UUID no concede acceso.
- Revocación independiente por membresía y cierre global por actor/sesión.
- Contratos TypeScript cerrados y artefactos Edge generados desde la misma
  fuente canónica.

## Evidencia verde reproducida

| Comprobación | Resultado |
| --- | --- |
| Commit funcional | `177c3b9 feat: add profile membership model and rls` |
| Ajuste posterior del descubrimiento de tests | `24acc39 fix(test): scope vitest discovery to project tests` |
| `pnpm exec supabase db reset` | PASS; aplica las tres migraciones actuales desde una base vacía |
| `supabase test db supabase/tests/database/profile_access_test.sql` | PASS; 56 pruebas pgTAP |
| `pnpm test:db` | PASS; 98 pruebas pgTAP combinadas de T3 y T4 |
| `supabase db lint --local --level warning --fail-on warning` | PASS; sin errores ni warnings de esquema |
| `pnpm verify` | PASS; 40 pruebas unitarias, 2 de navegador, lint, tipos y build |
| `pnpm test:supply-chain` | PASS; worktree e historial inspeccionados |
| `pnpm audit --audit-level high` | PASS; sin vulnerabilidades conocidas |
| Supabase remoto | PASS; migraciones `identity_and_profiles` y `profile_access_rls` presentes en desarrollo y producción |

La repetición se ejecutó con Supabase CLI `2.108.0`, Postgres local 17, pnpm
`11.13.1` y Node `v25.6.0`. El runtime objetivo de CI continúa fijado por el
repositorio; este recibo declara el ejecutor local real de la repetición.

## Propiedades comprobadas

- Dos llamadas concurrentes a `ensure_actor()` crean un solo actor y reciben
  el mismo identificador.
- El cliente no puede enviar sujeto, rol, actor o sesión para elevar
  privilegios.
- `PUBLIC` y `anon` no conservan ejecución sobre la función privilegiada.
- Una identidad solo lee perfiles con membresía y sesión activas.
- Una sesión revocada corta el acceso aunque el JWT todavía sea válido.
- Revocar una membresía conserva las demás del mismo actor-dispositivo.
- Un JWT de otra sesión no reutiliza una membresía existente.
- No pueden coexistir dos membresías activas del mismo actor y perfil ni dos
  sesiones activas equivalentes.
- FKs, campos obligatorios y orden temporal rechazan estados imposibles.
- Un perfil activo no puede purgarse; una purga terminal válida elimina el
  perfil y libera el alias.

## Fallos detectados y corregidos durante T3

1. Los primeros tests de contrato fallaron porque todavía no existían la
   normalización de alias ni los schemas de acceso. Se implementaron en los
   paquetes canónicos antes de abrir la migración al cliente.
2. La carrera `ensure_actor()` no podía probarse mediante la conexión interna
   `trust` de Colima: PostgreSQL rechaza ese uso de `dblink` para un usuario no
   superadministrador. Solo la fixture concurrente se encaminó por el puerto
   local autenticado; no se relajó ninguna regla del producto.
3. El generador Edge emitía JavaScript, pero descartaba la declaración del
   nuevo módulo `access.ts`. Se corrigió el generador común y `pnpm edge:check`
   conserva la regresión.

## Límites explícitos

- Las migraciones de T3 están desplegadas en `health-design-dev` y
  `health-design-prod`; todavía no contienen perfiles reales.
- T3 no implementa invitaciones consumibles, código privado o QR; pertenecen a
  T4.
- T3 no implementa superadministrador, MFA, AAL2 ni impersonación; pertenecen a
  T5.
- Las tablas todavía no contienen cuestionarios, datos clínicos ni planes de
  usuario.
