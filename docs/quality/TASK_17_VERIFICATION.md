# Verificación de la Tarea 17

> **Fecha:** 2026-07-23
>
> **Estado actual:** `T17_LOCAL_PASS`
>
> **Rama:** `codex/task-17e-shopping-exports-ops`
>
> **Base:** `2ff970c5d765adeee46a07887659f86a43adcb37`
>
> **Commits funcionales:**
>
> - `e3d109b8bcf7ad4e8b1c91d29cfc8b3503e58978`
>   (`fix(exports): expose authorized profile binding`);
> - `7da7333fc67734de163b22797dae72065ff612a6`
>   (`feat(exports): render frozen shopping snapshots`).
>
> **Entorno validado en este recibo:** TypeScript, navegador, Supabase local y
> empaquetado local de Cloudflare Worker. T17E.3 no se ha ejecutado; no se han
> aplicado migraciones, desplegado funciones ni modificado datos en remoto.

## Alcance acumulado

- T17-P0 dejó la semilla canónica 60 + 20 preparada para la cesta.
- T17A normalizó los catálogos sin mezclar SKU, envase o precio con nutrición.
- T17B alcanzó `T17B_REMOTE_PASS` solo en desarrollo: Mercadona quedó publicada
  con 73/80; DIA y ALDI permanecen `not_published`.
- T17C implementó el resolver puro, decimal, determinista e inmutable.
- T17D persistió preferencias y snapshots, añadió la API autorizada y la
  interfaz consultiva de compra.
- T17E.1 proyecta el mismo snapshot congelado en impresión, PDF y XLSX.
- T17E.2 incorpora el runbook y un smoke remoto ejecutable, pero no ejecutado.

## Evidencia local T17E

| Comprobación | Resultado |
|---|---|
| contratos, modelo, Edge, PDF, XLSX, shopping y equivalencia dirigidos | PASS; 10 archivos/93 pruebas |
| prueba reforzada del contenido PDF | PASS; precio base, envases, coste, remanente, precio normalizado, subtotal y comparación parcial extraídos del PDF real |
| `playwright test tests/e2e/exports.spec.ts tests/e2e/shopping.spec.ts` | PASS; 10/10 |
| `pnpm test:e2e` | PASS; 40/40 |
| `pnpm test:a11y` | PASS; 7/7 |
| reconstrucción desde todo el historial de migraciones | PASS; incluye `20260723140000_export_snapshot_profile_binding.sql` |
| `supabase test db` | PASS; 19 archivos/422 pruebas pgTAP |
| `pnpm edge:generate` y `pnpm edge:check` | PASS |
| `pnpm worker:check` | PASS; dry-run de desarrollo y producción, sin despliegue |
| `pnpm test:supply-chain` | PASS |
| `pnpm supply-chain:artifacts` | PASS; 331 componentes y 29 artefactos |
| `pnpm audit --audit-level high` | PASS; sin vulnerabilidades conocidas |
| `CI=true pnpm verify` | PASS; 83 archivos/743 pruebas Vitest, 2 archivos/4 pruebas de navegador y build |
| `node scripts/supermarket-catalog-remote-smoke.mjs --dry-run` | PASS; cero red y cero secretos |
| dry-run con referencias de Production | PASS de seguridad; rechazo cerrado `production_is_forbidden` |
| `git diff --check` | PASS |

El build mantiene los avisos conocidos: el cliente Supabase se importa de forma
estática y dinámica, y el chunk principal supera 500 kB. No son regresiones de
T17E.

## Exportación de snapshots

- La solicitud transporta únicamente `shoppingSnapshotId`; el cliente no envía
  filas de compra.
- PostgreSQL autoriza primero el plan y devuelve internamente su `profileId`.
  La Edge Function exige que el snapshot tenga ese mismo perfil y
  `planVersionId` antes de reservar cuota o escribir en Storage.
- Los snapshots activos y archivados son exportables si siguen autorizados.
- Impresión, PDF y XLSX consumen una sola proyección, conservan el orden
  congelado y distinguen total completo de subtotal parcial.
- La lista incluye cadena, producto, precio base, envases, coste, remanente,
  precio normalizado, elección manual, cobertura y comparación.
- La ruta canónica T15 permanece disponible cuando no se selecciona un
  snapshot.
- Nombres externos se neutralizan para HTML y fórmulas XLSX; GTIN, UUID, hashes,
  URL/R2, referencias de bucket y ubicación interna no se proyectan.

## Smoke remoto preparado

El smoke `test:t17:remote`:

1. acepta solo `health-design-dev`, comprueba el enlace local exacto y rechaza
   la referencia de Production;
2. exige confirmación explícita, rechaza AAL1 y comprueba superadministrador
   AAL2 con TOTP verificado hace menos de cinco minutos;
3. confirma la puerta publicada de Mercadona y congela un digest del estado
   completo de publicaciones, revisiones, SKU, matching y semilla;
4. crea dos identidades y perfiles sintéticos aislados;
5. resuelve una cesta completa y otra parcial;
6. consulta recibos privados antes de reintentar, prueba replay, conflicto de
   idempotencia, acceso cruzado, sobrante confirmado, selección manual y
   snapshot archivado;
7. genera y descarga PDF/XLSX privados desde snapshots activos y archivados,
   y rechaza el acceso directo público al bucket;
8. siembra treinta eventos para producir un único 429, sin realizar 130
   llamadas;
9. confirma que la nutrición no cambió y purga perfiles, usuarios, snapshots,
   límites y objetos privados con replay idempotente y verificación residual;
10. comprueba que el digest del catálogo global no cambió.

El modo `--dry-run` no usa red ni exige secretos. El modo `--execute` no se ha
ejecutado en este recibo.

## Revisión independiente

La auditoría read-only final confirmó que no quedan hallazgos críticos ni altos.
Durante sus pasadas se corrigieron el destino SQL enlazado, la prueba real
AAL1/AAL2, la recencia TOTP, los recibos previos a replay, el acceso directo al
bucket, la descarga activa/archivada, el digest global, la invariancia
nutricional y la limpieza residual/idempotente. El último detalle bajo —consultar
de nuevo el recibo antes del replay conflictivo— también quedó corregido antes
de esta evidencia.

## T17E.3 pendiente

Estado: `NOT_RUN`.

Requiere una autorización independiente antes de:

- comprobar las migraciones enlazadas de desarrollo;
- crear y verificar la copia cifrada precrítica T17;
- aplicar la migración aditiva;
- desplegar únicamente `catalogs` y `exports`, si el diff remoto confirma que
  siguen siendo las únicas funciones modificadas;
- publicar la UI únicamente en Pages Preview;
- ejecutar el smoke con AAL2/TOTP real;
- verificar PDF/XLSX privados y limpieza;
- registrar hashes y recibos remotos no sensibles.

Producción permanece fuera de alcance. No se declara
`T17_COMPLETE_REMOTE_PASS`.

## Referencias

- [`2026-07-21-t17-supermarket-shopping-contract.md`](../plans/2026-07-21-t17-supermarket-shopping-contract.md)
- [`2026-07-21-t17-supermarket-shopping-implementation-plan.md`](../plans/2026-07-21-t17-supermarket-shopping-implementation-plan.md)
- [`catalog-publication.md`](../runbooks/catalog-publication.md)
- [`ARCHITECTURE.md`](../architecture/ARCHITECTURE.md)
- [`API_CONTRACT.md`](../architecture/API_CONTRACT.md)
- [`DATA_GOVERNANCE.md`](../data/DATA_GOVERNANCE.md)
- [`SECURITY_CONTRACT.md`](../security/SECURITY_CONTRACT.md)
- [`THREAT_MODEL.md`](../security/THREAT_MODEL.md)
