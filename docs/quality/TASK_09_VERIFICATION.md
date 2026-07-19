# Verificación de la Tarea 9

> **Fecha:** 2026-07-19
> **Estado:** `T9_COMPLETE_REMOTE_PASS`
> **Commit funcional:** `0f24c3e` (`feat(catalog): add federated nutrition catalog`)
> **Alcance:** catálogo federado de alimentos genéricos, cuarentena de
> importaciones, manifiestos con procedencia y hashes, valores nutricionales
> con estado explícito, revisiones manuales y revisiones efectivas históricas.
> No demuestra generación de dietas, catálogo comercial por GTIN, productos de
> supermercados, precios ni despliegue en producción.

## Resultado implementado

- El orden canónico es CIQUAL 2025, BLS 4.0, Fineli, Livsmedelsverket, USDA
  Foundation y USDA SR Legacy; una fuente posterior solo cubre una laguna
  compatible.
- La compatibilidad exige coincidencia explícita de base, estado del alimento,
  parte comestible y método. Crudo, cocinado o denominadores distintos no se
  mezclan.
- Cada lote conserva fuente, versión, licencia, fecha de recuperación,
  transformaciones, cobertura, SHA-256 bruto y normalizado, algoritmo y versión
  de canonicalización.
- Un cambio de bytes solo altera el hash bruto; un cambio normalizado o de
  transformación crea otra identidad normalizada.
- `missing`, `trace`, `less_than`, `estimated`, `stale` y `conflicting` son
  estados persistidos. Ningún valor ausente se convierte en cero.
- Los límites de 25 MiB, 100.000 filas, 200 columnas, 2 KiB por celda, 100 MiB
  descomprimidos y profundidad de archivo cero se validan antes de persistir.
- El catálogo solo acepta `generic_food`; un producto comercial o GTIN queda
  fuera de este flujo y no puede alterar una revisión genérica.
- Importar deja el lote en cuarentena. Validar y activar son operaciones AAL2
  independientes; ninguna importación publica automáticamente.
- Una discrepancia material abre una revisión manual idempotente. Mientras está
  abierta, la revisión candidata no puede activarse.
- Activar una candidata conserva la revisión anterior como superseded y deja
  una única revisión efectiva por contexto exacto.
- Los registros de fuente, manifiesto, observación, revisión y efectividad son
  privados; RLS está activa y los roles públicos no reciben acceso directo.

## Evidencia verde reproducida

| Comprobación | Resultado |
|---|---|
| `pnpm verify` | PASS; 25 archivos/157 pruebas unitarias, 2 archivos/3 pruebas Chromium, contratos Edge, formato, lint, tipos y build |
| Pruebas T9 dirigidas | PASS; 19 pruebas en `nutrition-catalog` y `nutrition-catalog-edge` |
| `pnpm test:db` | PASS; 223 pruebas pgTAP en 6 archivos, 25 del catálogo nutricional |
| `supabase db lint --local --schema public,private --level warning --fail-on warning` | PASS; cero errores o avisos |
| `supabase db diff --local --schema public,private` | PASS; `No schema changes found` |
| `pnpm test:e2e` | PASS; 10 flujos Chromium |
| `pnpm run import:nutrition -- --fixture` | PASS; 5 manifiestos, 1 incompatibilidad excluida, 1 lote rechazado, 1 revisión abierta y 0 publicaciones automáticas |
| `pnpm test:supply-chain` | PASS |
| `pnpm audit --audit-level high` | PASS; sin vulnerabilidades conocidas |
| `pnpm worker:check` | PASS; dry-run de desarrollo y producción, sin desplegar Workers |
| Revisión del diff | PASS; `git diff --check` limpio |

La primera ejecución de `pnpm verify` dentro del sandbox no pudo abrir el
puerto efímero de Vitest Browser (`listen EPERM`). La misma ejecución fuera de
esa restricción pasó completa. El smoke remoto detectó además una incompatibilidad
en el propio arnés: Auth JS 2.110.6 devuelve `access_token` directamente tras
`mfa.verify()`, no `data.session`. Corregida la lectura, el mismo recorrido pasó
completo sin cambiar ni volver a enrolar el factor TOTP.

## Evidencia remota de desarrollo

| Comprobación | Resultado |
|---|---|
| Copia precrítica | PASS; DMG AES-256 `/Users/pablito/Documents/health-design-private-backups/t9-precritical-development-20260718T232913Z.dmg`, SHA-256 `843e1c7df3ab7346d95d9f81f5c317fe806299bf63bb7bb2193e810eee5f4eee`; clave solo en Llavero, servicio `health-design-dev-t9-precritical-20260718T232913Z` |
| Integridad de copia | schema SHA-256 `b027542ccadb219f069586dbbb170ff91f784086972a7513d981d801e720713a`; data SHA-256 `8fb98f258ed0992541923bb5fc76a1403c706f6e56d2b82282e9abfc1dcb535c` |
| Entorno | `health-design-dev` (`nwoivdxdupklervtnovd`); producción no contiene la migración T9 ni la función `catalogs` |
| Migración | `20260718230452_nutrition_catalog.sql` aplicada y presente en el historial remoto |
| Edge Function | `catalogs` `ACTIVE`, versión 1, `verify_jwt=true`, SHA-256 `9d82e703be61e17161c4eb54c6d1e6bdcd227fc13d18823e2697ba98e07b339c` |
| Autorización | AAL1 rechazado con `403/AAL2_REQUIRED`; AAL2 aceptado con el factor TOTP verificado existente |
| Importación | 2 manifiestos y 2 revisiones creados; replay de importación devolvió el mismo manifiesto |
| Revisión | replay de apertura devolvió el mismo identificador; la revisión abierta bloqueó activación con `409/REVIEW_OPEN` |
| Resolución | revisión `resolved_approved`; 0 revisiones abiertas al finalizar |
| Historia efectiva | 2 entradas: la primera superseded y la segunda activa; alimento sintético activo |
| Auditoría | 8 outcomes `success`: 2 stage, 2 validate, 2 activate, 1 review open y 1 review resolve, ligados a sus request IDs |
| Advisors | sin `ERROR`; avisos preexistentes de acceso anónimo y protección de contraseñas, e información de índices aún sin tráfico |
| Resultado del smoke | `T9_REMOTE_SMOKE_PASS` |

El alimento `food:t9-remote-smoke-2fb2765203a646b180305fcc0f92ccd5`
permanece en desarrollo como fixture sintético identificable. No se borra porque
el contrato T9 exige historia nutricional inmutable; no contiene datos de una
persona ni existe en producción.

## Propiedades comprobadas

- La prioridad de fuente solo se aplica después de comprobar compatibilidad.
- Lo desconocido permanece desconocido y los negativos no pueden validarse.
- Un lote repetido con la misma clave de idempotencia debe corresponder al mismo
  manifiesto.
- Una revisión repetida con la misma clave devuelve la revisión original.
- Una candidata rechazada o con revisión abierta no puede activarse.
- La revisión efectiva anterior no se sobrescribe cuando cambia la activa.
- Pantalla, dieta y compra futura podrán referirse a una revisión concreta sin
  que una importación posterior cambie silenciosamente el pasado.

## Revisión de seguridad

- No se añadieron secretos ni se imprimieron claves API, contraseña o secreto
  TOTP; las claves se recuperaron de forma transitoria y se eliminaron.
- El smoke solo acepta la URL exacta del proyecto de desarrollo.
- El factor MFA existente se desafió, pero no se creó, sustituyó ni eliminó.
- La función exige JWT, AAL2, origen permitido, cuerpo y schemas cerrados,
  idempotencia y respuestas `no-store, private`.
- Las mutaciones viven en funciones SQL privadas con `search_path=pg_catalog`,
  controles de rol y auditoría técnica inmutable.
- Producción `rbfrpgafytexrarcfmmp` quedó intacta.

## Límite de cierre

- No se han descargado todavía los datasets oficiales completos; T9 entrega el
  importador, el contrato, la cuarentena y la gobernanza necesarios para hacerlo
  de forma reproducible.
- T10 debe consumir únicamente revisiones efectivas para calcular comidas,
  energía, macros, fibra y sustituciones.
- T16 implementará productos comerciales, confirmación de escaneo y correcciones
  por GTIN sin contaminar este catálogo genérico.
- T17 implementará supermercados, disponibilidad, envases y precios; esos datos
  no son composición nutricional canónica.
- Luna no decide fuentes, valores, discrepancias, aprobación o activación.

## Referencias

- [`nutrition-import.md`](../runbooks/nutrition-import.md)
- [`NUMERIC_CONTRACT.md`](../data/NUMERIC_CONTRACT.md)
- [`DATA_GOVERNANCE.md`](../data/DATA_GOVERNANCE.md)
- [`ADR-0001`](../adr/0001-deterministic-engine-and-ai-boundary.md)
- [`ADR-0004`](../adr/0004-federated-nutrition-data-with-provenance.md)
