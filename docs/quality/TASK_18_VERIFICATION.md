# Verificación de la Tarea 18

> **Fecha:** 2026-07-24
>
> **Estado actual:** `T18_COMPLETE_LOCAL_PASS`
>
> **Rama:** `codex/task-18-deletion-backup-restore`
>
> **Base:** `3c561abb5d09cfc8538b1580624e8f18b350fb65`
>
> **Entorno validado:** local. Development y Production no fueron modificados.

## Alcance implementado

- T18-P0 inventaría dependencias de perfil y fija el orden de purga.
- `DeletionJob`, `BackupJob`, `RestoreJob`, `AuditDeletionJob` y
  `AuditRangeTombstone` tienen estados cerrados, control de versión,
  idempotencia y RLS/grants restrictivos.
- La solicitud de borrado bloquea el perfil; la purga administrativa escribe
  primero un tombstone externo, conserva hitos y elimina Auth solo si queda
  huérfana.
- El Worker existente serializa `deletions` y `admin-audit`, valida payloads
  cerrados, readback, replay, HMAC y firmas versionadas.
- Los conjuntos de recuperación cifran cada objeto con AES-256-GCM, una DEK
  única envuelta mediante AES-KW, AAD cerrado y firma Ed25519.
- El restore de fixture verifica cuatro rotaciones, aplica tombstones, elimina
  Storage resucitado, reconstruye auditoría, revoca sesiones y permanece
  aislado en `ready_for_promotion`.
- El borrado excepcional de auditoría exige rango exacto, intent/complete y
  credencial JIT revocada; un fallo parcial bloquea la continuidad.
- El cleanup Auth es dry-run por defecto, máximo 100, conserva el actor técnico
  y rechaza perfiles activos y superadministradores.
- La observabilidad admite solo campos y errores allowlisted.

## Commits funcionales locales

- `f832408` — `feat(operations): add durable deletion and recovery jobs`
- `31abd70` — `feat(ledger): append deletion tombstones`
- `9fcb888` — `feat(deletion): purge profiles idempotently`
- `164104a` — `feat(backup): create encrypted recovery sets`
- `5943088` — `feat(restore): verify isolated restores`
- `604380c` — `feat(operations): add audit retention and auth cleanup`
- `b2a7bc8` — `fix(security): harden T18 recovery operations`

El commit documental que contiene este recibo se crea únicamente después de
cerrar las revisiones y repetir las puertas afectadas.

## Evidencia local

| Comprobación | Resultado |
|---|---|
| reconstrucción desde todo el historial de migraciones | PASS; incluye las cuatro migraciones T18 |
| `pnpm test:db` | PASS; 25 archivos/532 pruebas pgTAP |
| seguridad dirigida restore/ledger | PASS; 4 archivos/54 pruebas |
| `pnpm test:operations` | PASS; 5 archivos/57 pruebas |
| `pnpm restore:drill -- --fixture` | PASS; cuatro rotaciones en 0,70 s, destino local aislado, tráfico deshabilitado |
| verificadores de tombstones y ledgers | PASS |
| `pnpm worker:check` | PASS; dry-run Development y Production; Production fija `MUTATIONS_ENABLED=false` |
| `pnpm edge:generate` / `pnpm edge:check` | PASS |
| `pnpm test:supply-chain` | PASS |
| `pnpm supply-chain:artifacts` | PASS; 331 componentes y 29 artefactos |
| `pnpm audit --audit-level high` | PASS; sin vulnerabilidades conocidas |
| `CI=true pnpm verify` | PASS; 88 archivos/813 pruebas unitarias, 2 archivos/4 pruebas de navegador y build |
| `pnpm test:e2e` | PASS; 40/40 |
| `pnpm test:a11y` | PASS; 7/7 |
| `pnpm test:t18:remote -- --dry-run` | PASS; cero red, cero mutaciones y límite explícito a Development |
| `git diff --check` | PASS |
| Codex Security + revisión independiente | PASS; 17 hallazgos remediados y ningún residual crítico, alto, medio o bajo material |

El build conserva los avisos conocidos de importación estática/dinámica del
cliente Supabase y chunk principal >500 kB; no son regresiones funcionales de
T18.

## Límites de esta evidencia

- Los cuatro conjuntos son sintéticos. Captura de PostgreSQL/Storage,
  restauración completa y medición RPO/RTO de Development requieren
  autorizaciones posteriores.
- El RPO sintético es 0 días y el RTO del fixture es 0,70 s; no se
  extrapolan como evidencia remota.
- No se ha ejecutado borrado remoto, credencial R2 JIT, cleanup Auth real,
  migración, Edge deploy, Worker deploy ni promoción de restore.
- El reintento de un restore bloqueado exige rehacer manualmente PostgreSQL y
  Storage en el destino aislado. El marcador solo se elimina después del CAS
  durable a `verifying`; no existe limpieza destructiva automática.
- El preflight remoto no concede autorización y no agrupa las futuras
  aprobaciones destructivas.
- G7 no se declara aprobado: T20 debe agregar la evidencia restante.

## Privacidad y alcance

- No se abrieron, copiaron ni enlazaron `datos/` o `supermercados/`.
- No hay secretos, dumps, backups, credenciales ni datos reales en el diff.
- T19 y T20 no se iniciaron.
- Production no recibió llamadas ni mutaciones.

## Activación posterior

Después de este `T18_COMPLETE_LOCAL_PASS` se requieren autorizaciones separadas
para: copia precrítica, poda exacta si procede, migración Development,
despliegues mínimos, borrado de perfil sintético, rango sintético, cuatro
copias/restores y cleanup Auth dry-run/apply. Solo entonces puede evaluarse
`T18_COMPLETE_REMOTE_PASS`.
