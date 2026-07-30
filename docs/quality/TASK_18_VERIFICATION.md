# Verificación de la Tarea 18

> **Fecha:** 2026-07-30
>
> **Estado actual:** `T18_COMPLETE_REMOTE_PASS`
>
> **Rama:** `main`
>
> **HEAD validado:** `306b7b2fb49f621dc771403fbbb0f131d9247311`
>
> **Entorno validado:** local y Development `nwoivdxdupklervtnovd`.
> Production no fue consultado ni modificado.

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

## Commits funcionales e integración

- `f832408` — `feat(operations): add durable deletion and recovery jobs`
- `31abd70` — `feat(ledger): append deletion tombstones`
- `9fcb888` — `feat(deletion): purge profiles idempotently`
- `164104a` — `feat(backup): create encrypted recovery sets`
- `5943088` — `feat(restore): verify isolated restores`
- `604380c` — `feat(operations): add audit retention and auth cleanup`
- `b2a7bc8` — `fix(security): harden T18 recovery operations`
- `3cea21f` — `docs(t18): record local security closure`
- `1ec9d52` — `fix(t18): preserve authorized audit gaps`
- `dd0d452` — `fix(restore): reject unbound storage backups`
- `233b729` — `fix(t18): preserve integrated restore metadata`
- `b864063` — `fix(security): close restore integrity gaps`
- `d69898a` — `fix(backup): pass database URL safely to libpq`
- `281ca8b` — `fix(restore): pass database URL safely to libpq`
- `306b7b2` — `fix(restore): select pg_restore target database`

## Evidencia local

| Comprobación | Resultado |
|---|---|
| reconstrucción desde todo el historial de migraciones | PASS; incluye las cuatro migraciones T18 |
| `pnpm test:db` | PASS; 25 archivos/532 pruebas pgTAP |
| seguridad dirigida restore/ledger | PASS; 4 archivos/54 pruebas |
| `pnpm test:operations` | PASS; 5 archivos/69 pruebas |
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
| Codex Security local inicial + revisión independiente | PASS; 17 hallazgos remediados |
| Codex Security final sobre `dd0d452..306b7b2` | PASS; scan `b2ef5e01-f5e2-4b4d-a231-c628c8d160a1` sellado, 7/7 revisiones, 37/37 pruebas dirigidas y 0 hallazgos |

El build conserva los avisos conocidos de importación estática/dinámica del
cliente Supabase y chunk principal >500 kB; no son regresiones funcionales de
T18.

## Evidencia remota de Development

| Comprobación | Resultado |
|---|---|
| migraciones T18 | PASS; `20260723151137`, `20260723153251`, `20260723160000`, `20260723163000` y alineación `20260730133410` aplicadas |
| funciones T18 | PASS; `access` v7, `admin` v11 y `admin-reconciler` v9 activas |
| Worker de continuidad | PASS; `/health` respondió HTTP 200 con `status=ready` y mutaciones habilitadas en Development |
| borrado permanente | PASS; job `2b792cae-d602-4b0f-bdf2-3707d272565e` en `purged`, 7/7 pasos y sin error |
| borrado de auditoría | PASS; job `c7dedd3d-edd3-4f11-a08a-f6dc45aadbcb`, rango 1065–1066, tombstone completo y estado `verified` |
| backup precrítico | PASS; `f86e7571-ebb8-49bc-a98d-fa5c678497fc` en `ready`, clave v1 |
| tres backups semanales | PASS; `a04f3aca-8525-4bec-8f6f-91a3980a0e59`, `dc02b76e-7953-4b69-8904-4e009fbc37d0` y `5b8959e8-a62b-4843-8129-aa52f217bdab` en `ready` |
| poda autorizada | PASS; backup exacto `173a6d84-c391-43f2-8f45-2bc8de8c98eb` en `pruned` |
| cuatro restores aislados | PASS; `16ac0572-b28f-4a43-bfd7-0a25e24af008`, `01f750e5-75ad-4540-bf63-e2316412bcd4`, `7cd77fbd-905e-4bd3-8792-97e193dd6374` y `c92110ef-c030-445f-906b-18e6606faf8b` en `ready_for_promotion` |
| invariantes de restore | PASS; cero intents/rangos incompletos, sesiones revocadas, perfiles borrados ausentes, Storage completo, RLS verificada, destino aislado y tráfico deshabilitado |
| promoción | PASS negativo; los cuatro restores conservan `promoted_at=NULL` |
| cleanup Auth | PASS de selección; consulta/dry-run vigente con 0 identidades anónimas elegibles |

Las cuatro capturas quedaron verificadas el mismo día; la más lenta tardó
16 min 30 s en alcanzar `ready`. Los cuatro restores alcanzaron
`ready_for_promotion` entre 32 s y 4 min 24 s. La observación cumple el RPO
máximo de siete días y el RTO de 24 horas de T18, pero no sustituye la
monitorización longitudinal.

## Límites de esta evidencia

- La evidencia remota acredita exclusivamente Development y el estado
  observado el 2026-07-30; no acredita Production.
- Ningún restore fue promovido ni recibió tráfico.
- La selección Auth no encontró candidatos; no se acredita una eliminación
  Auth mediante `apply`.
- El reintento de un restore bloqueado exige rehacer manualmente PostgreSQL y
  Storage en el destino aislado. El marcador solo se elimina después del CAS
  durable a `verifying`; no existe limpieza destructiva automática.
- Este cierre no autoriza nuevas podas, borrados, restores, promociones ni
  despliegues.
- El fragmento T18 de G7 queda aprobado; T20 debe agregar la evidencia restante
  antes de declarar G7 completo.

## Privacidad y alcance

- No se abrieron, copiaron ni enlazaron `datos/` o `supermercados/`.
- No hay secretos, dumps, backups, credenciales ni datos reales en el diff.
- T19 y T20 no se iniciaron.
- Production no recibió consultas ni mutaciones.

## Estado posterior

T18 queda cerrado como `T18_COMPLETE_REMOTE_PASS` en Development. Cualquier
promoción, nueva operación destructiva o actuación en Production requiere una
autorización independiente. El siguiente bloque del plan es T19, que no forma
parte de este cierre.
