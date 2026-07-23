# Verificación de la Tarea 17

> **Fecha:** 2026-07-23
>
> **Estado actual:** `T17_COMPLETE_REMOTE_PASS`
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
>   (`feat(exports): render frozen shopping snapshots`);
> - `7bc531f27d2d516a7b0da908ea429fbaee9ecd72`
>   (`docs(t17): add publication runbook and verification`);
> - `4c7cf2c4d5c9c4d833279d594a8bdff54c293176`
>   (`fix(shopping): align development remote validation`), árbol funcional
>   exacto validado en Development.
>
> **Entorno validado en este recibo:** local y Supabase Development
> `nwoivdxdupklervtnovd`, con UI exclusiva en Pages Preview. Production no fue
> modificada.

## Alcance acumulado

- T17-P0 dejó la semilla canónica 60 + 20 preparada para la cesta.
- T17A normalizó los catálogos sin mezclar SKU, envase o precio con nutrición.
- T17B alcanzó `T17B_REMOTE_PASS` solo en desarrollo: Mercadona quedó publicada
  con 73/80; DIA y ALDI permanecen `not_published`.
- T17C implementó el resolver puro, decimal, determinista e inmutable.
- T17D persistió preferencias y snapshots, añadió la API autorizada y la
  interfaz consultiva de compra.
- T17E.1 proyecta el mismo snapshot congelado en impresión, PDF y XLSX.
- T17E.2 incorpora el runbook y el smoke remoto.
- T17E.3 activa y valida T17 exclusivamente en Development.

## Evidencia local T17E

| Comprobación | Resultado |
|---|---|
| contratos, modelo, Edge, PDF, XLSX, shopping y equivalencia dirigidos | PASS; 10 archivos/93 pruebas |
| prueba reforzada del contenido PDF | PASS; precio base, envases, coste, remanente, precio normalizado, subtotal y comparación parcial extraídos del PDF real |
| `playwright test tests/e2e/exports.spec.ts tests/e2e/shopping.spec.ts` | PASS; 10/10 |
| `pnpm test:e2e` | PASS; 40/40 |
| `pnpm test:a11y` | PASS; 7/7 |
| reconstrucción desde todo el historial de migraciones | PASS; incluye `20260723140000_export_snapshot_profile_binding.sql` y `20260723154700_shopping_create_schema_version.sql` |
| `supabase test db` | PASS; 19 archivos/423 pruebas pgTAP |
| `pnpm edge:generate` y `pnpm edge:check` | PASS |
| `pnpm worker:check` | PASS; dry-run de desarrollo y producción, sin despliegue |
| `pnpm test:supply-chain` | PASS |
| `pnpm supply-chain:artifacts` | PASS; 331 componentes y 29 artefactos |
| `pnpm audit --audit-level high` | PASS; sin vulnerabilidades conocidas |
| `CI=true pnpm verify` | PASS; 84 archivos/751 pruebas Vitest, 2 archivos/4 pruebas de navegador y build |
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

El modo `--dry-run` no usa red ni exige secretos. El modo `--execute` terminó
en `T17_REMOTE_SMOKE_PASS`.

## Revisión independiente

La auditoría read-only final confirmó que no quedan hallazgos críticos ni altos.
Durante sus pasadas se corrigieron el destino SQL enlazado, la prueba real
AAL1/AAL2, la recencia TOTP, los recibos previos a replay, el acceso directo al
bucket, la descarga activa/archivada, el digest global, la invariancia
nutricional y la limpieza residual/idempotente. El último detalle bajo —consultar
de nuevo el recibo antes del replay conflictivo— también quedó corregido antes
de esta evidencia.

## Evidencia remota T17E.3

| Comprobación | Resultado |
|---|---|
| copia precrítica cifrada | PASS; SHA-256 `385ed979bfbc05735af1f81333a8e7888656c897d995cf94f738e83572dfbd4d`; cuatro rotaciones |
| migraciones Development | PASS; historial local/remoto alineado hasta `20260723154700_shopping_create_schema_version.sql` |
| `catalogs` | ACTIVE v6; SHA-256 `d458168a31ecba8b7c9f7eb49ca674151a3744536f9efa612146252d0ae3cf7e` |
| `exports` | ACTIVE v8; SHA-256 `f960cb6437431fd7801d071d2fac0e462ebe4ac054a5e4c3dea2bab80a1bf07e` |
| Pages Preview | PASS; despliegue `9473ff36-82b2-4c58-8b6f-9568dcb11841`; alias canónico permitido por CORS `https://task-02-environments.health-design.pages.dev` |
| cabeceras Preview | PASS; CSP conecta solo con Development, `noindex`, `no-referrer` y `nosniff` |
| autorización | PASS; AAL1 rechazado antes de administración y AAL2/TOTP reciente aceptado |
| aislamiento | PASS; acceso cruzado entre perfiles rechazado |
| shopping | PASS; una cesta completa y una parcial, sobrante aplicado y snapshot anterior archivado |
| idempotencia | PASS; replay exacto, conflicto de payload y recibos persistidos |
| rate limit | PASS; un único 429 sembrado con `Retry-After` |
| PDF privado | PASS; 25.062 bytes y SHA-256 `bff2bc6d7ba88fb4c3470c642d04a6ba2b3a18488dd7cd73fd1d2f49fad34fa6` |
| XLSX privado | PASS; 61.559 bytes y SHA-256 `c8a542c849906184e147cd0511b2ae0bffc06ab0c3e70ca8f59f605836afe623` |
| snapshot activo y archivado | PASS; ambos exportados desde la misma proyección congelada |
| privacidad de artefactos | PASS; Storage privado, sin redirect público |
| invariancia nutricional | PASS; contenido y hash nutricional sin cambios |
| purga | PASS; cero usuarios, perfiles y objetos sintéticos residuales |
| catálogo global | PASS; digest y estado sin cambios |

La activación requirió una migración aditiva de compatibilidad,
`20260723154700_shopping_create_schema_version.sql`: valida `schemaVersion: 1`
en la frontera pública y conserva la función privada histórica sin modificar
una migración ya aplicada. Las pruebas pgTAP reconstruyen esta conducta desde
todo el historial.

Estado de cadenas:

- Mercadona: `published`, 73/80 y puerta por grupos superada.
- DIA: `not_published`, 62/80.
- ALDI: `not_published`, 41/80.

Subgates declarados:

- selección manual remota:
  `NOT_APPLICABLE_REMOTE_NO_SECOND_PUBLISHED_SKU`; cubierta localmente;
- multitienda:
  `NOT_APPLICABLE_REMOTE_ONLY_ONE_CHAIN_PUBLISHED`; cubierta localmente;
- publicación histórica:
  `NOT_APPLICABLE_WITHOUT_SAFE_PUBLICATION_CHANGE`;
- restauración integral: `FULL_RESTORE_T18: NOT_IMPLEMENTED`.

No se publicaron DIA o ALDI para satisfacer pruebas. No se volvió a importar,
scrapear ni alterar R2. Production, T18 y Pages Production permanecieron
intactos.

## Referencias

- [`2026-07-21-t17-supermarket-shopping-contract.md`](../plans/2026-07-21-t17-supermarket-shopping-contract.md)
- [`2026-07-21-t17-supermarket-shopping-implementation-plan.md`](../plans/2026-07-21-t17-supermarket-shopping-implementation-plan.md)
- [`catalog-publication.md`](../runbooks/catalog-publication.md)
- [`ARCHITECTURE.md`](../architecture/ARCHITECTURE.md)
- [`API_CONTRACT.md`](../architecture/API_CONTRACT.md)
- [`DATA_GOVERNANCE.md`](../data/DATA_GOVERNANCE.md)
- [`SECURITY_CONTRACT.md`](../security/SECURITY_CONTRACT.md)
- [`THREAT_MODEL.md`](../security/THREAT_MODEL.md)
