# Verificación de la Tarea 14

> **Fecha:** 2026-07-20
>
> **Estado:** `T14_COMPLETE_REMOTE_PASS`
>
> **Rama:** `codex/task-14-luna`
>
> **Commits funcionales:** `1935f81`, `7f26ae8`, `a4c61dd`, `0e125d8`,
> `533177d`
>
> **Entorno remoto validado:** `health-design-dev`
> (`nwoivdxdupklervtnovd`)
>
> **Alcance:** explicación opcional con Luna, contrato cerrado, fallback
> determinista, revisión de proveedor activada con AAL2, ledger de uso, cuota
> de 10 explicaciones por perfil y día y corte mensual de 10 EUR. Producción no
> fue modificada.

## Resultado implementado

- El motor determinista conserva toda la autoridad. Luna recibe una versión ya
  validada, solo mejora su explicación y no puede alterar `output_hash`,
  alimentos, ejercicios, cantidades, límites ni advertencias.
- La respuesta usa un JSON Schema cerrado. Cualquier segmento, entidad o valor
  fuera del contrato invalida la respuesta completa y activa el fallback
  determinista.
- La petición minimiza datos, usa `store: false`, no persiste el prompt ni el
  payload clínico y conserva únicamente hashes, versiones, tokens y coste.
- La revisión activa fija `gpt-5.6-luna`, razonamiento `none`, timeout de 8
  segundos y cero reintentos automáticos. Su activación exige superadministrador
  con AAL2 y deja eventos técnicos `intent` y `outcome`.
- El ledger reserva antes de llamar usando la cota contractual máxima y una
  revisión fechada de precio/FX. La liquidación, liberación, reconciliación e
  idempotencia son transaccionales.
- `AIBudgetMonth.cap_eur` tiene un constraint exacto de 10,00 EUR. Una reserva
  que exceda el disponible, un perfil con 10 usos diarios o una anomalía de
  coste bloquean la llamada y conservan el plan utilizable mediante fallback.
- La interfaz ofrece «Explicar mi plan» de forma opcional, identifica Luna o
  fallback y no muestra configuración, costes internos ni contexto clínico.

## Evidencia local reproducida

| Comprobación | Resultado |
|---|---|
| `CI=true pnpm verify` | PASS; 50 archivos/458 pruebas Vitest, 2 archivos/4 pruebas de navegador, formato, lint, tipos, contratos Edge, 20 activos visuales y build |
| `CI=true pnpm test:e2e` | PASS; 28/28 flujos Chromium |
| `pnpm test:db` | PASS; 10 archivos/294 pruebas pgTAP |
| `supabase db lint --local --schema public,private --level warning --fail-on warning` | PASS; cero errores o avisos |
| `supabase db diff --local --schema public,private` | PASS; diff vacío |
| `pnpm test:supply-chain` | PASS |
| `pnpm audit --prod --audit-level=high` | PASS; sin vulnerabilidades conocidas |
| `pnpm worker:check` | PASS; dry-run de desarrollo y producción, sin desplegar Workers |
| `git diff --check` y `node --check scripts/ai-remote-smoke.mjs` | PASS |

El build conserva únicamente los avisos previos de importación dinámica y un
chunk superior a 500 kB; T14 no introduce un fallo de compilación.

## Copia precrítica

| Propiedad | Evidencia |
|---|---|
| Objeto | `/Users/pablito/Documents/health-design-private-backups/t14-precritical-development-20260720T130448Z.dmg` |
| Cifrado | AES-256; clave únicamente en el Llavero de macOS, servicio `health-design-dev-t14-precritical-20260720T130448Z` |
| SHA-256 del DMG | `a160e642b887e0a8e8550d977f4384e1cb758f93cb5d55fac06c5af1594c2683` |
| SHA-256 interno de esquema | `05ad54295c64f39facc07dd440eda9411f2e3d70debd673ce441c768dfb780f1` |
| SHA-256 interno de datos | `3b5a64d170e818b0e5325d078be6a506c9dcde1625994ac2a96ea8e519697864` |
| Verificación | PASS con `hdiutil verify`, montaje de solo lectura y checksums internos |

La copia precrítica de T9 se eliminó tras autorización explícita. La rotación
queda en cuatro objetos cifrados: T10, T12, T13 y T14.

## Despliegue remoto de desarrollo

Se aplicó únicamente en desarrollo:

1. `20260720102807_ai_usage_budget`

`supabase db push --linked --dry-run` confirmó `Remote database is up to date`.

| Edge Function | Versión | JWT | SHA-256 remoto |
|---|---:|---|---|
| `plans` | 11 | obligatorio | `6f01341cdb4cfadba796d4107ad622f10712e59f4b543c698cbfc54231b6ddf4` |

`OPENAI_API_KEY` existe solo como secreto remoto de desarrollo; la verificación
registró únicamente su presencia y fecha, nunca su valor. No se añadió a
archivos, historial de Git, frontend ni salida de pruebas.

## Validación remota de desarrollo

El comando reproducible `pnpm test:t14:remote` usa identidades y sesiones
reales, exige un TOTP vigente para la activación y conserva el fixture final
como evidencia financiera inmutable.

| Contrato | Resultado |
|---|---|
| AAL1 | PASS; activación rechazada con `403/AAL2_REQUIRED` |
| AAL2 | PASS; revisión activa con `intent` y `outcome` técnicos |
| proveedor | PASS; `gpt-5.6-luna`, razonamiento `none`, timeout 8000 ms y revisión activa |
| llamada real | PASS; respuesta `source=luna` |
| uso | PASS; 317 tokens de entrada, 61 de salida y coste liquidado de `0.00059729` EUR |
| persistencia | PASS; un evento `settled` y una explicación; ninguna duplicación |
| presupuesto | PASS; `cap_eur=10.00`, reserva final `0.00000000` y mes no bloqueado |
| autoridad normativa | PASS; `planOutputHash` idéntico antes y después de Luna |
| cuota diaria | PASS; el undécimo intento sintético usó fallback y registró `daily_profile_quota`; filas sintéticas eliminadas después |
| idempotencia | PASS; las pruebas unitarias y pgTAP impiden doble reserva o doble liquidación |

Un primer intento sin crédito del proveedor quedó prudentemente como
`pending_reconciliation`. Tras comprobar en la fuente autoritativa cero gasto,
cero solicitudes y cero tokens, se liquidó a coste cero conservando el evento;
la reserva mensual volvió a cero antes de la llamada real.

## Producción intacta

La lista remota de producción conserva únicamente las funciones `access`,
`admin` y `admin-reconciler`. No existe `plans`, no se aplicó la migración T14
y no se modificaron secretos, datos ni configuración de producción.

## Fronteras y trabajo diferido

- **T10.1:** catálogo CIQUAL completo; sigue diferido y no bloquea T14.
- **T15:** PDF, impresión y XLSX privados con equivalencia de versión.
- **T16:** productos comerciales, GTIN y correcciones compartidas.
- **T17:** supermercados, disponibilidad y precios orientativos.
- **T19:** auditoría AA final y validación visual integral.
- El proveedor local para el PC del usuario sigue diferido; T14 conserva el
  seam sin implementarlo.
- Fuera de T14: generación normativa por IA, reintentos automáticos, prompts
  clínicos completos y autoridad de Luna sobre seguridad o cálculo.

## Referencias

- [`2026-07-20-t14-luna-implementation-plan.md`](../plans/2026-07-20-t14-luna-implementation-plan.md)
- [`API_CONTRACT.md`](../architecture/API_CONTRACT.md)
- [`SECURITY_CONTRACT.md`](../security/SECURITY_CONTRACT.md)
- [`TASK_13_VERIFICATION.md`](TASK_13_VERIFICATION.md)
- [`REQUIREMENTS.md`](../../REQUIREMENTS.md)
- [`ACCEPTANCE_GATES.md`](ACCEPTANCE_GATES.md)
