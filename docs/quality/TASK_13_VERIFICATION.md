# Verificación de la Tarea 13

> **Fecha:** 2026-07-20
>
> **Estado:** `T13_COMPLETE_REMOTE_PASS`
>
> **Rama:** `codex/task-13-follow-up`
>
> **Commits funcionales:** `d02837b`, `5b53ca8`, `121b245`, `4e24874`,
> `2094d93`
>
> **Entorno remoto validado:** `health-design-dev`
> (`nwoivdxdupklervtnovd`)
>
> **Alcance:** revisión semanal mínima, diario opcional, historial manual de
> analíticas, tendencia básica, vigencia contextual, detección de impacto y
> candidatos con activación siempre manual. Producción no fue modificada.

## Resultado implementado

- La experiencia `/follow-up` solo presenta módulos activos. La revisión
  semanal conserva los campos comunes mínimos; el diario y la revisión de
  cuatro semanas son opciones independientes.
- Las entradas de seguimiento y los lotes analíticos son inmutables, se
  ordenan temporalmente y se aíslan por perfil. Cada lote admite de una a
  cuatro observaciones manuales con fecha exacta, rango o fecha desconocida.
- El historial conserva todos los valores, usa principalmente el más reciente
  y muestra únicamente `up`, `down`, `stable` o `insufficient`; no calcula
  predicciones ni diagnósticos.
- La vigencia solo existe cuando una regla curada depende del analito y del
  contexto. T13 incorpora reglas documentadas para B12, magnesio y función
  renal; sin regla aplicable la confianza queda desconocida sin bloquear el
  plan.
- El impacto respeta módulos activos y dependencias. Un cambio de volumen de
  entrenamiento de hasta ±10 % puede quedar como recomendación acotada; dolor,
  síntomas importantes, una variación superior o una solicitud explícita
  crean un candidato revisable.
- Un cambio estructural —por ejemplo, medicación, embarazo o nuevo objetivo—
  se registra como provisional y exige completar el contexto; el sistema no
  inventa el dato ni genera un candidato sobre una suposición.
- Un valor fuera del rango aportado o una solicitud explícita recalcula solo
  los módulos afectados. El plan activo permanece estable hasta activar
  manualmente el candidato; descartarlo no cambia el activo.
- Los candidatos pendientes se persisten y reaparecen en otro dispositivo con
  acceso válido. Antes de vincularlo, el segundo dispositivo recibe
  `403/FORBIDDEN`.
- El navegador no accede directamente a las tablas. Todas las operaciones
  pasan por la Edge Function `plans`, JWT, sesión, membresía, CORS,
  idempotencia, límites de entrada y cabeceras privadas.

## Evidencia local reproducida

| Comprobación | Resultado |
|---|---|
| `CI=true pnpm verify` | PASS; 46 archivos/441 pruebas Vitest, 2 archivos/4 pruebas de navegador, formato, lint, tipos, contratos Edge, 20 activos visuales y build |
| `CI=true pnpm test:e2e` | PASS; 28/28 flujos Chromium, incluidos 3 de seguimiento |
| `pnpm test:db` | PASS; 9 archivos/280 pruebas pgTAP |
| `supabase db lint --local --schema public,private --level warning --fail-on warning` | PASS; cero errores o avisos |
| `supabase db diff --local --schema public,private` | PASS; diff vacío |
| `pnpm test:supply-chain` | PASS |
| `pnpm audit --prod --audit-level=high` | PASS; sin vulnerabilidades conocidas |
| `pnpm worker:check` | PASS; dry-run de desarrollo y producción, sin desplegar Workers |
| `git diff --check` | PASS |

El build conserva únicamente los avisos ya conocidos de importación dinámica y
un chunk superior a 500 kB; no son fallos introducidos por T13.

## Verificación visual

Se revisaron los estados de resumen semanal, candidato analítico y ancho móvil
de 390 px. La interfaz mantiene el sistema marfil/verde existente, jerarquía
legible, controles accesibles y ausencia de desbordamiento horizontal.

| Estado | Captura local |
|---|---|
| revisión semanal | `/Users/pablito/.codex/visualizations/2026/07/20/t13-follow-up/t13-follow-up-review.png` |
| candidato y analítica | `/Users/pablito/.codex/visualizations/2026/07/20/t13-follow-up/t13-follow-up-candidate.png` |
| móvil 390 px | `/Users/pablito/.codex/visualizations/2026/07/20/t13-follow-up/t13-follow-up-mobile.png` |

## Copia precrítica

| Propiedad | Evidencia |
|---|---|
| Objeto | `/Users/pablito/Documents/health-design-private-backups/t13-precritical-development-20260720T090217Z.dmg` |
| Cifrado | AES-256; clave únicamente en el Llavero de macOS, servicio `health-design-dev-t13-precritical-20260720T090217Z` |
| SHA-256 del DMG | `44739f4805eb68f6414826ff4012a3815d07fb37693b4a6003d8e09fa4586c6b` |
| SHA-256 interno de esquema | `f7825bfeee19aa0361989248f03ff515dc4cedaacf81e7b19b3787b50cf8ecdf` |
| SHA-256 interno de datos | `4dfdb5c111af281f60ffdaeb983e0c88788d7377137da9d757a1595a412347a5` |
| Verificación | PASS con `hdiutil verify`, montaje de solo lectura y checksums internos |

Existen cinco DMG precríticos (`T8`, `T9`, `T10`, `T12` y `T13`). La rotación
contractual es de cuatro, pero no se eliminó `T8` porque esa eliminación
permanente requiere confirmación explícita del usuario. No afecta al código,
al despliegue ni a la reversibilidad de T13.

## Despliegue remoto de desarrollo

Se aplicó únicamente en desarrollo:

1. `20260720081340_follow_up_tracking`

Después del despliegue, `supabase db push --linked --dry-run` informó
`Remote database is up to date`.

| Edge Function | Versión | JWT | SHA-256 remoto |
|---|---:|---|---|
| `plans` | 8 | obligatorio | `f6337895e0a47c1e1302a23f1462840520157cbf224cf838139561bc7769a7b6` |

La función figura `ACTIVE`. El despliegue se limitó a `plans`; no se desplegó
ningún Worker ni se alteraron otras funciones.

## Validación remota de desarrollo

El comando reproducible `pnpm test:t13:remote` crea dos identidades Auth
temporales, usa JWT y sesiones reales, recorre el flujo de producto y elimina
todos los datos al terminar.

| Contrato | Resultado |
|---|---|
| plan base | PASS; cuestionario, snapshot, borrador y activación inicial reales |
| revisión semanal | PASS; mínimo común registrado sin candidato idéntico |
| diario opcional | PASS; entrada diaria independiente y sin bloqueo |
| cambio estructural | PASS; registro provisional, `contextUpdateRequired=true` y ningún candidato inferido |
| analíticas | PASS; dos valores B12 conservados, `410 → 150`, tendencia `down` e interpretación `below_range` |
| recálculo selectivo | PASS; candidato limitado a suplementación para el valor fuera de rango |
| aislamiento | PASS; segundo dispositivo rechazado con `403/FORBIDDEN` antes de obtener membresía |
| continuidad entre dispositivos | PASS; candidato pendiente recuperado tras vinculación |
| decisión manual | PASS; un candidato activado y un segundo candidato descartado; cero pendientes al final |
| limpieza | PASS; cero perfiles, actores, sesiones, seguimientos, analíticas y usuarios Auth temporales |

Resultado emitido: `T13_REMOTE_SMOKE_PASS`.

## Asesores de Supabase

- Seguridad: cero `ERROR` y ningún `WARN` atribuible a T13. Sus cuatro avisos
  son `INFO` por RLS sin políticas en `follow_up_entries`, `lab_batches`,
  `lab_observations` y `context_snapshot_origins`; es el cierre deliberado
  porque se revocó el acceso directo y solo operan wrappers de `service_role`.
- Rendimiento: ocho avisos T13 `INFO` por claves foráneas sin índice dedicado.
  Los lotes son de 1–4 valores, los accesos de lectura ya usan índices por
  perfil/fecha/analito y no existe un cuello medido; se evita añadir índices
  especulativos en V1.
- Los dos `WARN` globales de seguridad —inicio anónimo permitido y protección
  de contraseñas filtradas— son configuración/base previa y no fueron creados
  por T13.
- Referencias de los asesores:
  [RLS sin políticas](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy),
  [claves foráneas sin índice](https://supabase.com/docs/guides/database/database-linter?lint=0001_unindexed_foreign_keys),
  [protección de contraseñas](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).

## Producción intacta

La comprobación posterior conserva en producción únicamente las cuatro
migraciones base de identidad/acceso/administración y las funciones `access`,
`admin` y `admin-reconciler`. No se aplicó `follow_up_tracking`, no se desplegó
`plans` y no se modificaron secretos ni datos de producción.

## Fronteras y trabajo diferido

- **T10.1:** catálogo CIQUAL completo; sigue diferido y no bloquea T13.
- **T14:** adaptador Luna y límite mensual de 10 EUR.
- **T15:** PDF, impresión y equivalencia de exportaciones.
- **T16:** productos comerciales, GTIN y correcciones compartidas.
- **T17:** supermercados, disponibilidad y precios orientativos.
- **T19:** auditoría AA final y validación visual integral.
- Fuera de T13: wearables, OCR, predicciones, diagnósticos, notificaciones del
  sistema operativo y activación automática.

## Referencias

- [`2026-07-20-t13-follow-up-implementation-plan.md`](../plans/2026-07-20-t13-follow-up-implementation-plan.md)
- [`API_CONTRACT.md`](../architecture/API_CONTRACT.md)
- [`TASK_12_VERIFICATION.md`](TASK_12_VERIFICATION.md)
- [`REQUIREMENTS.md`](../../REQUIREMENTS.md)
- [`ACCEPTANCE_GATES.md`](ACCEPTANCE_GATES.md)
