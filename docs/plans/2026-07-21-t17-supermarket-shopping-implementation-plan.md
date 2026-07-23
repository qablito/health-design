# Plan de implementación T17: catálogos de supermercado y compra consultiva

> **Para Claude:** SUBHABILIDAD OBLIGATORIA: usa superpowers:executing-plans para implementar este plan tarea por tarea.

**Objetivo:** Convertir la lista nutricional semanal de una versión inmutable del plan en una cesta orientativa, reproducible y opcional para Mercadona, DIA y ALDI, con envases, precio base, remanente, comparación multiestablecimiento y equivalencia en pantalla/PDF/XLSX/impresión, sin alterar nunca la nutrición.

**Arquitectura:** T17-P0 amplía por el pipeline oficial únicamente el catálogo canónico necesario para la cesta 60 + 20. T17A importa catálogos externos a cuarentena con evidencia privada e inmutable. T17B persiste y publica revisiones y matching manuales. T17C añade un único módulo puro y profundo `resolveShopping(input): Promise<ShoppingSnapshot>`. T17D conecta ese módulo a Supabase y a una UI fina. T17E proyecta el mismo snapshot en todos los formatos y valida desarrollo remoto. PostgreSQL y los adaptadores autorizan y persisten; el motor no realiza I/O.

**Stack técnico:** TypeScript 6, Zod 4, React 19/Vite, Vitest 4, Playwright 1.58, PostgreSQL 17/Supabase, Deno 2 Edge Functions, Cloudflare R2 mediante Wrangler, `pdf-lib@1.17.1` y SheetJS CE `0.20.3` ya fijados. No se añade ninguna dependencia.

---

## 0. Condiciones de ejecución

### 0.1 Puerta explícita

Este documento es solo planificación. No ejecutar código, migraciones, importaciones,
uploads, despliegues ni acciones remotas hasta recibir una confirmación expresa posterior
del usuario.

Al ejecutar:

1. trabajar en un worktree dedicado creado desde `main` limpio;
2. preservar los directorios no rastreados `datos/` y `supermercados/` del worktree
   principal;
3. no añadir capturas ni catálogos masivos al repositorio;
4. usar TDD en cada tarea: prueba RED, cambio mínimo, prueba GREEN, refactor;
5. distinguir siempre `PLANNED`, `LOCAL_PASS`, `MERGED`, `PUSHED`,
   `COMPLETE_REMOTE_PASS` y producción;
6. solicitar autorización separada antes de copia precrítica, migración, upload R2,
   despliegue o validación remota;
7. no tocar producción en T17.

### 0.2 Fronteras confirmadas que no se reabren

- Cadenas V1: Mercadona, DIA y ALDI; cada publicación es independiente.
- Futuro: Lidl, Consum y Alcampo.
- No hay stock, checkout, ofertas, fidelización, transporte ni compra directa.
- No hay actualización diaria ni fecha de catálogo visible.
- España es el mercado V1; la localización Sevilla/41006 es solo metadato interno.
- Matching T17 `market + chain + external_sku → CanonicalFood`, separado del matching
  GTIN T16; en V1 `market` siempre es ES.
- Exactamente 60 alimentos fijos y 20 dinámicos.
- Publicación: al menos 72/80 y 75 % por grupo, más activación AAL2.
- La lista nutricional canónica es la autoridad y el SKU no aporta nutrientes.
- La preferencia habitual no se cambia en silencio.
- Multiestablecimiento es opt-in y no exige ahorro mínimo.
- Sobrantes solo confirmados; remanentes calculados no se arrastran.
- Un único snapshot impulsa web, impresión, PDF y XLSX.
- No Luna, IA ni nuevas dependencias.

### 0.3 Prerrequisitos documentales que deben resolverse sin cambiar producto

Antes del primer commit de implementación:

- reconciliar el encabezado T16 (`T16_LOCAL_PASS`) con su evidencia remota real sin
  presentarlo como producción;
- actualizar el texto antiguo `hasta 20 dinámicos` a `exactamente 20`;
- eliminar de documentos T17 cualquier promesa de stock/disponibilidad;
- separar escenarios T16 de corrección GTIN y T17 de elección de SKU;
- actualizar C22 y el cuestionario de cadenas heredadas a las candidatas V1
  Mercadona/DIA/ALDI;
- alinear el desempate documental con la decisión confirmada por línea:
  desembolso → remanente → precio normalizado → cadena+SKU;
- alinear la calidad de catálogo con la política confirmada: no hay caducidad ni
  ocultación automática; una publicación activa cambia solo por acción administrativa;
- conservar las rutas canónicas `/v1/admin/catalog-revisions` y
  `/v1/admin/matching-rules` y las mutaciones públicas específicas de sobrantes/SKU;
- documentar que los prototipos `datos/` y `supermercados/` están fuera del repositorio y
  aún no son artefactos de importación verificados;
- reproducir con un parser CSV correcto el conteo local ya observado de 13.671 registros
  —4.314 Mercadona, 7.661 DIA y 1.696 ALDI— y registrar por separado las 41 filas con
  error antes de aceptar el manifest definitivo.

La corrección documental no autoriza importación ni publicación.

---

# T17-P0 — Núcleo nutricional exacto 60 + 20

> **Estado 2026-07-21:** `T17_P0_LOCAL_PASS`. P0.1 y P0.2 están implementadas
> localmente: 80/80 correspondencias oficiales, 88 revisiones totales y 440/440
> observaciones nutricionales obligatorias conocidas. No se ha importado, activado ni
> desplegado nada en Supabase remoto. Recibo: [`T17_BASKET_SOURCE_MAP.md`](../data/T17_BASKET_SOURCE_MAP.md).

## Tarea P0.1: Fijar la semilla canónica y demostrar el déficit actual

**Archivos:**

- Crear: `packages/test-fixtures/src/shopping/basket-seed.ts`
- Modificar: `packages/test-fixtures/package.json`
- Crear: `tests/shopping-basket-seed.test.ts`
- Modificar: `PRODUCT.md`
- Modificar: `CONTEXT.md`
- Modificar: `REQUIREMENTS.md`
- Modificar: `docs/data/DATA_GOVERNANCE.md`
- Modificar: `docs/quality/ACCEPTANCE_GATES.md`

**Paso 1: escribir la prueba fallida de la semilla**

Definir en el fixture, con claves todavía por resolver contra el catálogo oficial:

```ts
export const T17_FIXED_BASKET_KEYS = [/* exactamente las 60 del contrato */] as const;
export const T17_RESERVE_BASKET_KEYS = [/* exactamente las 20 del contrato */] as const;
export const T17_BASKET_SEED_VERSION = "t17-basket-v1";
```

La prueba debe comprobar:

- 60 claves fijas únicas;
- 20 claves de reserva únicas;
- cero intersecciones;
- conteos de grupo `16/12/8/12/6/6` para las fijas;
- grupo explícito para las 20 de reserva;
- `foodState=raw|cooked|unspecified`, forma de compra cerrada
  `dry|fresh|drained|canned|natural|prepared|marinated` y parte comestible explícitos;
- cada clave existe en el catálogo efectivo del generador;
- el catálogo actual falla en la última condición, demostrando el déficit real.

**Paso 2: verificar RED**

Ejecutar:

```bash
pnpm exec vitest run tests/shopping-basket-seed.test.ts
```

Esperado: FAIL únicamente porque faltan alimentos canónicos efectivos; los conteos y la
estructura de la semilla ya deben ser correctos.

**Paso 3: reconciliar documentación antigua**

- Sustituir `hasta 20` por `exactamente 20` donde represente la puerta T17.
- Mantener que el catálogo comercial completo no queda limitado a 80.
- Corregir referencias a stock/disponibilidad visible.
- Añadir enlace al contrato T17 sin afirmar implementación.
- Reconciliar el estado T16 con `TASK_16_VERIFICATION.md`; conservar la frontera entre
  desarrollo remoto y producción.

**Paso 4: validar solo documentación y fixture**

Ejecutar:

```bash
pnpm exec prettier --check packages/test-fixtures/src/shopping/basket-seed.ts tests/shopping-basket-seed.test.ts PRODUCT.md CONTEXT.md REQUIREMENTS.md docs/data/DATA_GOVERNANCE.md docs/quality/ACCEPTANCE_GATES.md
git diff --check
```

Esperado: formato y diff PASS; la prueba enfocada sigue RED por catálogo insuficiente.

**Paso 5: commit**

```bash
git add packages/test-fixtures/src/shopping packages/test-fixtures/package.json tests/shopping-basket-seed.test.ts PRODUCT.md CONTEXT.md REQUIREMENTS.md docs/data/DATA_GOVERNANCE.md docs/quality/ACCEPTANCE_GATES.md
git commit -m "test(catalog): fix T17 basket seed contract"
```

## Tarea P0.2: Incorporar únicamente los alimentos oficiales ausentes

**Archivos:**

- Modificar: `packages/catalog/src/nutrition/generator-metadata.ts`
- Modificar: `packages/catalog/src/nutrition/index.ts`
- Modificar: `scripts/import-nutrition/index.ts`
- Modificar: `scripts/import-nutrition/ciqual-2025.ts`
- Modificar: `scripts/activate-ciqual-core.mjs`
- Modificar: `tests/nutrition-catalog.test.ts`
- Modificar: `tests/ciqual-import.test.ts`
- Crear: `tests/nutrition-catalog-import.test.ts`
- Modificar: `tests/shopping-basket-seed.test.ts`
- Crear: `docs/data/T17_BASKET_SOURCE_MAP.md`

**Paso 1: añadir pruebas RED por correspondencia oficial**

Para cada una de las 80 claves exigir:

- fuente oficial, código fuente y versión;
- estado/parte comestible compatible con el contrato;
- composición válida y manifest SHA-256;
- selección por la precedencia oficial existente;
- ausencia de duplicados semánticos;
- ningún alimento extra activado exclusivamente por T17-P0.

**Paso 2: ejecutar RED**

```bash
pnpm exec vitest run tests/nutrition-catalog.test.ts tests/nutrition-catalog-import.test.ts tests/shopping-basket-seed.test.ts
```

Esperado: FAIL con la lista exacta de claves ausentes; no aceptar un conteo aproximado.

**Paso 3: resolver códigos y revisiones oficiales**

- Reutilizar el pipeline CIQUAL/EuroFIR ya implementado.
- Importar solo revisiones necesarias para cerrar las 80 claves.
- Registrar correspondencias en `T17_BASKET_SOURCE_MAP.md`.
- Mantener `foodState=raw|cooked|unspecified` separado de la forma de compra
  `dry|fresh|drained|canned|natural|prepared|marinated`; no ampliar el enum nutricional
  global para representar presentación comercial.
- No aplicar conversión de rendimiento culinario.
- Si una identidad no puede resolverse de forma inequívoca, detener esta tarea y pedir
  decisión; no crear una composición aproximada.

**Paso 4: verificar GREEN**

```bash
pnpm exec vitest run tests/nutrition-catalog.test.ts tests/nutrition-catalog-import.test.ts tests/shopping-basket-seed.test.ts
pnpm typecheck
```

Esperado: PASS, exactamente 80/80 claves utilizables en el generador y ninguna fuente de
supermercado usada como autoridad nutricional.

**Paso 5: commit**

```bash
git add packages/catalog/src/nutrition packages/test-fixtures/src/shopping scripts/import-nutrition scripts/activate-ciqual-core.mjs tests/nutrition-catalog.test.ts tests/ciqual-import.test.ts tests/nutrition-catalog-import.test.ts tests/shopping-basket-seed.test.ts docs/data/T17_BASKET_SOURCE_MAP.md
git commit -m "feat(nutrition): cover the T17 60 plus 20 basket"
```

---

# T17A — Contratos, normalización y cuarentena

> **Estado 2026-07-21:** `T17A_LOCAL_PASS`. A.1–A.3 están implementadas en el
> worktree dedicado: contratos estrictos, normalización decimal pura, parser CSV
> endurecido, manifest y CLI de cuarentena. Los tres `--dry-run` reprodujeron 13.671
> filas, 11.686 precios base y 41 errores de captura, con cero rechazos de
> normalización. No se ha escrito en R2, aplicado migraciones, desplegado, fusionado ni
> enviado a GitHub. Recibo: [`SUPERMARKET_IMPORT_FORMAT.md`](../data/SUPERMARKET_IMPORT_FORMAT.md).

## Tarea A.1: Crear contratos estrictos de catálogo y compra

**Archivos:**

- Crear: `packages/contracts/src/shopping.ts`
- Modificar: `packages/contracts/src/index.ts`
- Crear: `tests/shopping-contracts.test.ts`
- Regenerar: `supabase/functions/_shared/generated/contracts.js`
- Regenerar: `supabase/functions/_shared/generated/contracts.d.ts`

**Paso 1: escribir pruebas RED de contratos**

Cubrir esquemas estrictos para:

```ts
type SupermarketChain = "mercadona" | "dia" | "aldi";
type ShoppingMarket = "ES";
type MatchState = "exact" | "allowed" | "review" | "excluded" | "insufficient";
type ShoppingSort = "normalized_price_asc" | "price_asc" | "price_desc" | "name_asc" | "name_desc";
```

Y para:

- `SupermarketSourceManifest`;
- `SupermarketSourceRecord` de cuarentena;
- `ConfirmedPackage` con medida de venta por masa, volumen o unidad y equivalencia de
  masa comestible confirmada cuando la venta no usa masa;
- `CatalogSkuProjection` sin nutrientes ni stock;
- `CatalogCoverage` exacta 60 + 20;
- `ShoppingPreferenceRevision` con cadenas multi explícitas;
- `ShoppingResolutionInput`;
- `ShoppingSnapshot` inmutable con estados completos/parciales;
- `ShoppingLeftoverRequest` y `ShoppingProductSelectionRequest`; modo, cadenas y orden
  pertenecen a `ShoppingPreferencePut`;
- ACK públicos sin metadatos internos.

Validar límites:

- cuerpo HTTP común 16 KiB, salvo import administrativo por streaming;
- nombres 1–240 caracteres;
- máximo 80 líneas requeridas y alternativas acotadas;
- cantidades decimales positivas y finitas;
- EUR como única moneda;
- `comparedChains` únicas y solo permitidas en modo multi;
- ninguna propiedad `stock`, `available`, `nutrition`, `kcal`, `macros`,
  `sourceLocationInternal` o ruta R2 en respuestas públicas.
- `ShoppingResolutionInput` consume `NutritionWeek.shoppingList.amountG`; un SKU por
  volumen/unidades solo es calculable con `equivalentEdibleMassG` y evidencia.

**Paso 2: ejecutar RED**

```bash
pnpm exec vitest run tests/shopping-contracts.test.ts
```

Esperado: FAIL porque `shopping.ts` no existe.

**Paso 3: implementar el contrato mínimo**

- Usar Zod `.strict()` en todas las fronteras públicas.
- Representar dinero y cantidades como strings decimales canónicos.
- Incluir `schemaVersion: 1` y `resolverVersion` en el snapshot.
- Usar `shoppingItemId` para una posición del snapshot, `skuId` para una elección y
  `canonicalFoodKey` para un sobrante; no el ambiguo `productId`.
- Mantener `market: "ES"` y ubicación de captura fuera de respuestas públicas.
- Identificar SKU por `market + chain + externalSku` y dejar `gtin14` como referencia
  opcional de consistencia con T16, nunca como clave T17.

**Paso 4: generar contratos Edge**

```bash
pnpm edge:generate
pnpm edge:check
pnpm exec vitest run tests/shopping-contracts.test.ts
pnpm typecheck
```

Esperado: PASS y generated contracts sin diferencias pendientes.

**Paso 5: commit**

```bash
git add packages/contracts/src/shopping.ts packages/contracts/src/index.ts tests/shopping-contracts.test.ts supabase/functions/_shared/generated
git commit -m "feat(shopping): add strict catalog and basket contracts"
```

## Tarea A.2: Implementar normalización pura de catálogos

**Archivos:**

- Crear: `packages/catalog/src/supermarkets/index.ts`
- Crear: `packages/catalog/src/supermarkets/package-parser.ts`
- Crear: `packages/catalog/src/supermarkets/manifest.ts`
- Modificar: `packages/catalog/package.json`
- Crear: `packages/test-fixtures/src/shopping/catalogs.ts`
- Modificar: `packages/test-fixtures/package.json`
- Crear: `tests/supermarket-import.test.ts`
- Crear: `tests/supermarket-package-parser.test.ts`

**Paso 1: escribir pruebas RED del parser**

Casos mínimos:

- `500 g`, `1 kg`, `750 ml`, `6 x 1,5 L`, `12 unidades`;
- separador decimal coma y punto;
- multipack inequívoco;
- peso variable, rango, promoción y texto ambiguo → revisión;
- precio base faltante → visible, no calculable;
- precio no finito/negativo, otra moneda o contenido cero → rechazado;
- masa/volumen/unidad nunca se cruzan;
- un envase de volumen o unidades sin `equivalentEdibleMassG` confirmado se muestra pero
  no se calcula contra `amountG`;
- una equivalencia confirmada conserva evidencia y permite calcular sin asumir
  `1 ml = 1 g` ni un peso universal por unidad;
- precio normalizado exacto en EUR/kg, EUR/L o EUR/unidad;
- nombres y categorías se sanitizan sin borrar la fuente original del manifest;
- celdas que empiezan por `=`, `+`, `-` o `@` se neutralizan antes de XLSX;
- dos importaciones iguales producen el mismo hash normalizado.

**Paso 2: verificar RED**

```bash
pnpm exec vitest run tests/supermarket-import.test.ts tests/supermarket-package-parser.test.ts
```

Esperado: FAIL por módulos ausentes.

**Paso 3: implementar sin nuevas dependencias**

- Reutilizar canonicalización/hash de `@health-design/catalog/products` y decimal de
  `@health-design/engine`.
- Exportar `./supermarkets` desde `packages/catalog/package.json`.
- Separar `sourceFields` de la proyección pública.
- Producir `usableForShopping` y razones cerradas, sin campo de stock.
- Aceptar todos los registros bien formados en el catálogo; solo el subconjunto con
  paquete, precio base y equivalencia dimensional necesaria confirmados es calculable.

**Paso 4: verificar GREEN**

```bash
pnpm exec vitest run tests/supermarket-import.test.ts tests/supermarket-package-parser.test.ts
pnpm typecheck
```

Esperado: PASS y cero operaciones aritméticas con `number` binario para dinero.

**Paso 5: commit**

```bash
git add packages/catalog/src/supermarkets packages/catalog/package.json packages/test-fixtures/src/shopping packages/test-fixtures/package.json tests/supermarket-import.test.ts tests/supermarket-package-parser.test.ts
git commit -m "feat(catalog): normalize supermarket packages and prices"
```

## Tarea A.3: Convertir prototipos en importadores reproducibles de cuarentena

**Archivos:**

- Crear: `scripts/import-supermarket-catalog/index.ts`
- Crear: `scripts/import-supermarket-catalog/sources.ts`
- Crear: `scripts/import-supermarket-catalog/r2-manifest.ts`
- Modificar: `package.json`
- Revisar y modificar solo si están presentes: `supermercados/catalogo.py`
- Revisar y modificar solo si está presente: `supermercados/mercadona_chrome.mjs`
- Crear: `tests/supermarket-import-cli.test.ts`
- Crear: `docs/data/SUPERMARKET_IMPORT_FORMAT.md`

**Paso 1: escribir pruebas RED del importador**

- `--dry-run` nunca escribe ni sube objetos;
- entrada máxima 25 MiB, 100.000 filas, 200 columnas, 2 KiB por celda y 100 MiB
  descomprimidos;
- procesamiento streaming y sin URL arbitraria, redirecciones o archivos anidados;
- misma clave+hash reutiliza el lote;
- misma clave con otro hash devuelve conflicto;
- un error fatal no persiste una revisión parcial;
- filas erróneas quedan contabilizadas y excluidas mediante regla documentada;
- captura bruta y normalizada obtienen SHA-256 independientes;
- el manifest incluye cadena, mercado ES, fecha, importador, ubicación interna, conteos y
  estado documental de la fuente;
- el parser CSV deriva exactamente 4.314 Mercadona, 7.661 DIA y 1.696 ALDI: 13.671;
- 39 filas ALDI y 2 DIA con error quedan declaradas en el manifest y fuera del subconjunto
  utilizable;
- `unknown` en licencia/términos no puede publicarse; `restricted` exige decisión de uso
  documentada para desarrollo.

**Paso 2: ejecutar RED**

```bash
pnpm exec vitest run tests/supermarket-import-cli.test.ts
```

Esperado: FAIL por CLI ausente.

**Paso 3: implementar el CLI local**

Comandos previstos:

```bash
pnpm import:supermarkets -- --chain mercadona --input /ruta/captura --dry-run
pnpm import:supermarkets -- --chain dia --input /ruta/captura --dry-run
pnpm import:supermarkets -- --chain aldi --input /ruta/captura --dry-run
```

- No copiar `datos/` al repo.
- No capturar credenciales, cookies ni datos de perfiles.
- Generar artefactos temporales fuera del repo.
- Upload R2 solo con `--upload` y confirmación operativa separada.
- Usar Wrangler CLI y nombres de bucket por entorno; no añadir SDK S3.
- La base de datos recibe referencias opacas y hashes, nunca URL pública.

**Paso 4: ejecutar dry-run contra copias explícitas**

Solo durante implementación y después de localizar los archivos reales:

```bash
pnpm import:supermarkets -- --chain mercadona --input "/Users/pablito/Documents/health design/datos/catalogo_mercadona.csv" --dry-run
pnpm import:supermarkets -- --chain dia --input "/Users/pablito/Documents/health design/datos/catalogo_dia.csv" --dry-run
pnpm import:supermarkets -- --chain aldi --input "/Users/pablito/Documents/health design/datos/catalogo_aldi.csv" --dry-run
```

Esperado: manifiestos deterministas con 13.671 entradas totales y 41 errores de captura
separados de filas utilizables, además de cuarentena y exclusiones; ninguna escritura
remota.

**Paso 5: verificar GREEN**

```bash
pnpm exec vitest run tests/supermarket-import-cli.test.ts tests/supermarket-import.test.ts
pnpm typecheck
git status --short
```

Esperado: PASS y ningún catálogo/artefacto temporal rastreado.

**Paso 6: commit**

```bash
git add scripts/import-supermarket-catalog package.json tests/supermarket-import-cli.test.ts docs/data/SUPERMARKET_IMPORT_FORMAT.md
git commit -m "feat(catalog): add quarantined supermarket import pipeline"
```

---

# T17B — Persistencia, matching y publicación

> **Estado 2026-07-22:** `T17B_REMOTE_PASS` en desarrollo. Las capturas v2 de
> Mercadona, DIA y ALDI están en R2 privado e importadas de forma idempotente; la cesta
> activa `t17-basket-v1.1` conserva 60 fijos + 20 dinámicos. AAL1 fue rechazado y AAL2
> permitió revisar y activar 176 reglas con pares `intent/outcome` y outbox cerrados.
> Mercadona superó la puerta con 73/80 y ≥75 % en cada grupo, y quedó publicada. DIA
> (62/80) y ALDI (41/80) permanecen sin publicar. `pnpm test:db` pasó 381 pruebas y
> `CI=true pnpm verify` pasó 655 unitarias, 4 de navegador, tipos, lint, formato y build.
> Producción no se modificó. Este recibo cierra T17B, no T17C–T17E ni T17 completo.

## Tarea B.1: Crear esquema inmutable de catálogos

**Archivos:**

- Crear: `supabase/migrations/20260721200000_supermarket_catalogs.sql`
- Crear: `supabase/tests/database/supermarket_catalogs_test.sql`

**Paso 1: escribir prueba SQL RED**

Exigir:

- unicidad `market + chain + external_sku`;
- revisiones append-only y guardas contra UPDATE/DELETE indebido;
- manifest obligatorio antes de una revisión;
- hash y clave de importación idempotentes;
- filas públicas solo desde publicación activa;
- ninguna columna nutricional o de stock;
- `license_status`, `source_terms_status`, cobertura y evidencia de captura obligatorios;
- usuario común sin acceso a manifest, cuarentena ni observaciones internas;
- servicio puede importar, pero no saltarse constraints;
- cadenas cerradas a Mercadona, DIA y ALDI;
- mercado cerrado a ES en V1.

**Paso 2: verificar RED**

```bash
pnpm test:db
```

Esperado: FAIL porque las tablas no existen.

**Paso 3: implementar el esquema mínimo**

Crear `private.supermarket_source_manifests`, `private.supermarket_catalog_revisions`,
`private.supermarket_skus`, `private.supermarket_sku_revisions` y vistas/RPC públicas
autorizadas. Añadir índices por publicación, cadena, SKU y contenido.

**Paso 4: verificar GREEN y lint**

```bash
pnpm test:db
supabase db lint --local --level warning
supabase db diff --local --schema public,private
```

Esperado: PASS y diff limitado al esquema previsto.

**Paso 5: commit**

```bash
git add supabase/migrations/20260721200000_supermarket_catalogs.sql supabase/tests/database/supermarket_catalogs_test.sql
git commit -m "feat(catalog): persist immutable supermarket revisions"
```

## Tarea B.2: Implementar matching SKU canónico y gate 60 + 20

**Archivos:**

- Crear: `packages/catalog/src/supermarkets/matching.ts`
- Crear: `packages/catalog/src/supermarkets/coverage.ts`
- Modificar: `packages/catalog/src/supermarkets/index.ts`
- Crear: `tests/supermarket-matching.test.ts`
- Crear: `tests/supermarket-coverage.test.ts`
- Crear: `supabase/migrations/20260721201000_supermarket_publication.sql`
- Crear: `supabase/tests/database/supermarket_publication_test.sql`

**Paso 1: escribir pruebas RED**

- candidatos por palabras completas, categoría, formato, ingredientes y estado;
- exclusiones antes de inclusiones;
- `foodState=raw|cooked|unspecified` se combina con
  `purchaseForm=dry|fresh|drained|canned|natural|prepared|marinated`; combinaciones
  distintas no se mezclan;
- `unknown` de alérgeno/contacto cruzado nunca se autoelige;
- un SKU → máximo una regla activa; un alimento → muchos SKU;
- la regla T17 sigue `market + chain + external_sku` incluso si el SKU tiene GTIN y no
  modifica la regla T16; una discrepancia con el matching T16 activo fuerza `review`;
- `exact|allowed` cuentan; los demás estados no;
- cada alimento se cuenta una vez aunque tenga varios SKU;
- 71/80 falla, 72/80 puede pasar;
- 72/80 con un grupo a 74 % falla;
- 72/80 con todos los grupos ≥75 % pasa;
- paquete/precio ausente no aporta cobertura;
- semilla exacta 60 + 20 y revisión manual de dinámicos.
- candidato dinámico exige rango `from/to`, cuenta como máximo una aparición de cada
  alimento por versión activa, completa desde reserva y no crea analítica por perfil;
- borrar un perfil solo cambia candidatos futuros, nunca semillas históricas.

**Paso 2: verificar RED**

```bash
pnpm exec vitest run tests/supermarket-matching.test.ts tests/supermarket-coverage.test.ts
pnpm test:db
```

Esperado: FAIL por matching, cobertura y tablas ausentes.

**Paso 3: implementar lógica pura y esquema**

- Mantener candidatos puros en catálogo.
- Persistir reglas y semillas como revisiones inmutables.
- Crear publicación activa única por `market + chain`.
- `publish` falla de forma cerrada si cambia semilla, revisión o cobertura entre revisión
  y mutación.
- `hide` conserva publicación y snapshots históricos.
- No introducir caducidad automática.

**Paso 4: verificar GREEN**

```bash
pnpm exec vitest run tests/supermarket-matching.test.ts tests/supermarket-coverage.test.ts
pnpm test:db
pnpm typecheck
```

Esperado: PASS.

**Paso 5: commit**

```bash
git add packages/catalog/src/supermarkets tests/supermarket-matching.test.ts tests/supermarket-coverage.test.ts supabase/migrations/20260721201000_supermarket_publication.sql supabase/tests/database/supermarket_publication_test.sql
git commit -m "feat(catalog): add SKU matching and publication gate"
```

## Tarea B.3: Añadir administración AAL2 y auditoría

**Archivos:**

- Modificar: `packages/contracts/src/admin.ts`
- Modificar: `supabase/functions/admin/index.ts`
- Crear: `supabase/functions/admin/supermarket-catalogs.ts`
- Modificar: `supabase/functions/_shared/audit.ts`
- Modificar: `supabase/functions/admin-reconciler/index.ts`
- Crear: `tests/admin-supermarket-catalogs.test.ts`
- Modificar: `tests/admin-edge.test.ts`
- Crear: `supabase/migrations/20260721202000_supermarket_catalog_admin.sql`
- Crear: `supabase/tests/database/supermarket_catalog_admin_test.sql`
- Crear: `apps/web/src/features/admin/CatalogPublicationPanel.tsx`
- Modificar: `apps/web/src/features/admin/AdminApp.tsx`
- Modificar: `apps/web/src/features/admin/admin-client.ts`
- Crear: `tests/admin-catalog-publication.test.ts`

**Paso 1: escribir pruebas RED de autorización y mutación**

- usuario común y AAL1 rechazados antes de RPC;
- AAL2 con TOTP reciente requerido para activar matching, publicar y ocultar;
- `expectedVersion` evita cambios obsoletos;
- replay exacto devuelve el mismo ACK;
- misma clave con otro cuerpo devuelve `409 IDEMPOTENCY_KEY_REUSED`;
- cada mutación escribe `intent` antes y `outcome` después;
- error tras intent queda reconciliable;
- auditoría no contiene nombres importados, SKU, precios ni payload;
- activar matching y publicar son acciones distintas;
- panel muestra 80, cobertura global, grupo, errores y estado de manifest.

**Paso 2: verificar RED**

```bash
pnpm exec vitest run tests/admin-supermarket-catalogs.test.ts tests/admin-edge.test.ts tests/admin-catalog-publication.test.ts
pnpm test:db
```

Esperado: FAIL por rutas y RPC ausentes.

**Paso 3: implementar el corte vertical mínimo**

- Reutilizar guardas de superadministrador, TOTP, expected version y auditoría T16.
- No copiar lógica de cobertura en Edge; llamar al módulo puro.
- La UI nunca recibe referencias R2 ni ubicación interna.
- Una cadena se activa de forma independiente.

**Paso 4: generar contratos y verificar GREEN**

```bash
pnpm edge:generate
pnpm edge:check
pnpm exec vitest run tests/admin-supermarket-catalogs.test.ts tests/admin-edge.test.ts tests/admin-catalog-publication.test.ts
pnpm test:db
pnpm typecheck
```

Esperado: PASS.

**Paso 5: commit**

```bash
git add packages/contracts/src/admin.ts supabase/functions/admin supabase/functions/_shared/audit.ts supabase/functions/admin-reconciler apps/web/src/features/admin tests/admin-supermarket-catalogs.test.ts tests/admin-edge.test.ts tests/admin-catalog-publication.test.ts supabase/migrations/20260721202000_supermarket_catalog_admin.sql supabase/tests/database/supermarket_catalog_admin_test.sql supabase/functions/_shared/generated
git commit -m "feat(admin): review and publish supermarket catalogs"
```

---

# T17C — Resolver puro de compra

> **Estado 2026-07-22:** `T17C_LOCAL_PASS` en la rama
> `codex/task-17c-shopping-resolver`. Los commits locales `f08b9f0`, `8efefca`,
> `854eedb`, `5045182`, `5572ed6` y `c70531d` alinean los contratos e implementan
> `resolveShopping` como resolver puro, asíncrono, decimal, determinista e inmutable,
> con modos mono/multiestablecimiento, cestas parciales, elección manual y orden estable.
> Los archivos principales son `packages/contracts/src/shopping.ts`,
> `packages/engine/src/shopping/index.ts`, el subpath del paquete y las cuatro suites
> T17C. `edge:generate`, `edge:check`, contratos y suites T17C pasaron 45 pruebas;
> `CI=true pnpm verify` pasó 689 pruebas unitarias, 4 de navegador, formato, lint,
> tipos y build; `git diff --check` pasó. La revisión independiente terminó sin
> hallazgos críticos, altos ni medios en el delta T17C. No se iniciaron T17D, T17E,
> cambios remotos ni producción; no se ejecutaron pruebas de base de datos porque T17C
> no modifica SQL.

## Tarea C.1: Implementar opciones, envases y desempates

**Archivos:**

- Crear: `packages/engine/src/shopping/index.ts`
- Modificar: `packages/engine/package.json`
- Crear: `tests/shopping-engine.test.ts`
- Crear: `tests/shopping-determinism.test.ts`

**Paso 1: escribir pruebas RED de la función pública única**

```ts
resolveShopping(input: ShoppingResolutionInput): Promise<ShoppingSnapshot>
```

Comprobar:

- consume `NutritionWeek.shoppingList`, no días/comidas sin agregar;
- usa directamente `amountG` para envases vendidos por masa;
- para volumen/unidades exige `equivalentEdibleMassG` confirmado y congela su evidencia
  en el snapshot; sin equivalencia la opción no es calculable;
- `need=max(0, amount-leftover)`;
- `compatibleCapacityG` usa contenido en masa o equivalente comestible confirmado;
- `packages=ceil(need/compatibleCapacityG)` con decimal exacto;
- `cost=packages*basePrice`;
- `remainder=packages*compatibleCapacityG-need`;
- cero necesidad produce cero envases sin fabricar coste negativo;
- precio normalizado solo ordena dimensiones compatibles;
- desempate: desembolso, remanente, precio normalizado, cadena+SKU;
- incomparables después de comparables;
- elección manual válida prevalece;
- elección manual obsoleta queda pendiente, no se reemplaza;
- misma entrada produce snapshot y digest iguales;
- orden de entrada no altera resultado;
- el objeto de entrada no se muta;
- ninguna llamada DB/HTTP/env/Date/random.

**Paso 2: ejecutar RED**

```bash
pnpm exec vitest run tests/shopping-engine.test.ts tests/shopping-determinism.test.ts
```

Esperado: FAIL por módulo ausente.

**Paso 3: implementar el módulo profundo**

- Exportar solo contratos necesarios y `resolveShopping` desde `./shopping`.
- Reutilizar `packages/engine/src/decimal.ts`.
- Recibir `resolvedAt` y versiones como datos; no leer reloj global.
- Congelar/serializar la salida en orden canónico.
- Mantener estados de línea cerrados.

**Paso 4: verificar GREEN**

```bash
pnpm exec vitest run tests/shopping-engine.test.ts tests/shopping-determinism.test.ts
pnpm typecheck
```

Esperado: PASS.

**Paso 5: commit**

```bash
git add packages/engine/src/shopping packages/engine/package.json tests/shopping-engine.test.ts tests/shopping-determinism.test.ts
git commit -m "feat(shopping): resolve package outlay deterministically"
```

## Tarea C.2: Añadir monoestablecimiento, multiestablecimiento y parciales

**Archivos:**

- Modificar: `packages/engine/src/shopping/index.ts`
- Modificar: `tests/shopping-engine.test.ts`
- Crear: `tests/shopping-multistore.test.ts`
- Crear: `tests/shopping-nutrition-invariance.test.ts`

**Paso 1: escribir pruebas RED**

- monoestablecimiento usa solo la habitual;
- una cadena más barata solo genera aviso;
- multi solo usa cadenas seleccionadas;
- ahorro de 0,01 EUR se conserva;
- no hay coste de viaje, paradas ni pedido mínimo;
- cada alimento va al menor desembolso completo;
- cesta parcial expone subtotal, cobertura y pendientes;
- no aparece `más barata`/`ahorro total` para universos no equivalentes;
- ausencia de producto muestra `Sin producto confirmado`;
- precio ausente muestra `Precio no disponible` y no suma cero;
- cambiar cadena/SKU/paquete/precio/sobrante deja idénticos alimentos, gramos, kcal,
  macros, fibra, sustituciones y hash nutricional.

**Paso 2: ejecutar RED**

```bash
pnpm exec vitest run tests/shopping-engine.test.ts tests/shopping-multistore.test.ts tests/shopping-nutrition-invariance.test.ts
```

Esperado: FAIL en comportamiento multi/parcial todavía ausente.

**Paso 3: implementar el comportamiento mínimo**

- Componer mono y multi sobre la misma resolución por línea.
- Agrupar cadena habitual primero; restantes A–Z.
- Conservar las comparaciones parciales como datos estructurados, no texto ambiguo.
- No modificar el modelo nutricional.

**Paso 4: verificar GREEN**

```bash
pnpm exec vitest run tests/shopping-engine.test.ts tests/shopping-multistore.test.ts tests/shopping-nutrition-invariance.test.ts
pnpm typecheck
```

Esperado: PASS.

**Paso 5: commit**

```bash
git add packages/engine/src/shopping tests/shopping-engine.test.ts tests/shopping-multistore.test.ts tests/shopping-nutrition-invariance.test.ts
git commit -m "feat(shopping): add optional multistore comparison"
```

---

# T17D — Persistencia de snapshots, API y UI

> **Recibo T17D_LOCAL_PASS (2026-07-23).** Rama local
> `codex/task-17d-shopping-api-ui`, basada en `7df10ee`. Commits:
> `61f0eed`, `75098c0`, `8e9dc63`, `58905ea`, `5a939c9`, `9bf0f4c`,
> `a41faf1`, `cf7b91d` y `068ff4d`. Se implementaron contratos de transporte, preferencias
> revisables, snapshots inmutables y su contexto confirmado, RLS/purga/cuotas,
> adaptador Edge autorizado, replay/CAS, catálogo paginado y la interfaz `/shopping`
> con cesta completa o parcial, cambio manual de producto y sobrantes confirmados.
> Las migraciones principales son
> `20260722193055_shopping_snapshots.sql` y
> `20260722193107_shopping_security.sql`; los puntos de entrada principales son
> `supabase/functions/catalogs/shopping.ts` y
> `apps/web/src/features/shopping/ShoppingApp.tsx`.
>
> Validación local: reconstrucción íntegra con 31 migraciones; `pnpm test:db`
> 421/421; lint de esquemas `public` y `private` sin errores; `CI=true pnpm verify`
> con 730/730 pruebas unitarias y 4/4 de navegador, además de contratos Edge,
> formato, lint, tipos, activos y build; `pnpm test:a11y` 7/7; `pnpm test:e2e`
> 39/39; `git diff --check` PASS. Una segunda revisión independiente confirmó
> que no quedan hallazgos críticos ni altos. T17E, PDF/XLSX/impresión, validación
> remota, desarrollo remoto, producción, merge y push no se iniciaron.

## Tarea D.1: Persistir preferencias y snapshots inmutables

**Archivos:**

- Crear: `supabase/migrations/20260721203000_shopping_snapshots.sql`
- Crear: `supabase/tests/database/shopping_snapshots_test.sql`
- Crear: `supabase/migrations/20260721204000_shopping_security_and_deletion.sql`
- Crear: `supabase/tests/database/shopping_security_test.sql`

**Paso 1: escribir pruebas SQL RED**

- una revisión activa de preferencia por perfil;
- `preferred_chain` nunca deriva del precio;
- multi exige lista explícita de cadenas;
- snapshot enlaza perfil, versión del plan, preferencia, publicaciones, semilla y digest;
- actualizar una entrada crea revisión y archiva la anterior;
- publicación nueva no cambia bytes/hash del snapshot anterior;
- RLS perfil A/B;
- `deletion_requested` bloquea operaciones ordinarias;
- purga borra preferencias, sobrantes y snapshots privados;
- catálogos/publicaciones compartidos permanecen;
- idempotencia exacta y conflicto por cuerpo distinto;
- una resolución concurrente por perfil;
- 30/h perfil, 60/h actor y 100/h IP con replay sin consumo.

**Paso 2: verificar RED**

```bash
pnpm test:db
```

Esperado: FAIL por tablas/RPC ausentes.

**Paso 3: implementar tablas y funciones**

- `public.shopping_preference_revisions` con RLS.
- `public.shopping_snapshots` con JSONB validado e inmutable.
- `public.shopping_leftover_confirmations` enlazado por `canonical_food_key`, con medida
  declarada, equivalente confirmado en gramos y referencia de equivalencia cuando proceda.
- idempotencia/rate limit en `private` reutilizando patrones existentes.
- Integración de purga limitada a datos T17; no proclamar restauración T18.

**Paso 4: verificar GREEN**

```bash
pnpm test:db
supabase db lint --local --level warning
```

Esperado: PASS.

**Paso 5: commit**

```bash
git add supabase/migrations/20260721203000_shopping_snapshots.sql supabase/migrations/20260721204000_shopping_security_and_deletion.sql supabase/tests/database/shopping_snapshots_test.sql supabase/tests/database/shopping_security_test.sql
git commit -m "feat(shopping): persist isolated immutable snapshots"
```

## Tarea D.2: Conectar el adaptador Supabase y las rutas públicas

**Archivos:**

- Crear: `supabase/functions/catalogs/shopping.ts`
- Modificar: `supabase/functions/catalogs/index.ts`
- Modificar: `supabase/functions/catalogs/deno.json`
- Crear: `tests/shopping-edge.test.ts`
- Modificar: `package.json`

**Paso 1: escribir pruebas Edge RED**

- anónimo 401;
- perfil ajeno 403/404 sin filtración;
- `GET /v1/catalogs` exige cadena permitida, pagina 50/máximo 100 con cursor opaco y
  orden estable, sirve solo publicación activa y nunca filtra metadatos internos;
- lectura de catálogo respeta concurrencia 4, 120/h actor y 240/h IP;
- versión sin nutrición 422 `NUTRITION_MODULE_REQUIRED`;
- catálogo no publicado `CATALOG_NOT_PUBLISHED`;
- petición válida carga `NutritionWeek.shoppingList`, publicaciones y preferencias y
  llama una vez al resolver;
- el cliente no puede inyectar precios, SKU o líneas;
- primera apertura sin preferencia exige elección, no elige barato;
- `POST /v1/shopping/{id}/leftovers` y
  `POST /v1/shopping/{id}/product-selection` producen snapshots derivados;
- sobrante en volumen/unidades exige SKU del mismo alimento y equivalencia confirmada;
  el cliente nunca envía el factor de conversión;
- modo/cadenas/orden se cambian mediante una revisión de preferencia y una nueva
  resolución, sin cambiar la cadena habitual salvo acción expresa;
- replay exacto devuelve handle existente;
- límites devuelven 429, `Retry-After` y request ID;
- respuesta `Cache-Control: no-store, private`;
- logs sin cuerpo, alias, salud, SKU o precios.

**Paso 2: ejecutar RED**

```bash
pnpm exec vitest run tests/shopping-edge.test.ts
```

Esperado: FAIL por módulo ausente.

**Paso 3: implementar adaptador fino**

- Mantener en Edge autorización, carga, llamada pura y persistencia.
- Servir solo publicaciones activas.
- Conservar las rutas públicas existentes y añadir las dos mutaciones específicas; no
  sustituir `leftovers` por un endpoint genérico incompatible.
- Resolver snapshot histórico por ID sin recalcular.
- Añadir `test:t17:remote` a `package.json`, pero no ejecutarlo aún.

**Paso 4: verificar GREEN**

```bash
pnpm edge:generate
pnpm edge:check
pnpm exec vitest run tests/shopping-edge.test.ts
pnpm typecheck
```

Esperado: PASS.

**Paso 5: commit**

```bash
git add supabase/functions/catalogs package.json tests/shopping-edge.test.ts supabase/functions/_shared/generated
git commit -m "feat(api): expose authorized shopping snapshots"
```

## Tarea D.3: Crear la interfaz de compra sobre el snapshot

**Archivos:**

- Crear: `apps/web/src/features/shopping/ShoppingApp.tsx`
- Crear: `apps/web/src/features/shopping/shopping-client.ts`
- Crear: `apps/web/src/features/shopping/shopping.css`
- Modificar: `apps/web/src/main.tsx`
- Modificar: `apps/web/src/features/nutrition/NutritionApp.tsx`
- Modificar: `packages/contracts/src/questionnaire.ts`
- Modificar: `tests/questionnaire-contracts.test.ts`
- Crear: `tests/shopping-client.test.ts`
- Crear: `tests/e2e/shopping.spec.ts`

**Paso 1: escribir pruebas RED de cliente y UI**

- enlace desde la lista nutricional a `/shopping`;
- estado sin preferencia con selector explícito;
- modo habitual y multi opt-in;
- selector multi solo contiene publicaciones disponibles;
- habitual primero y demás A–Z;
- producto, envase, precio base, paquetes, coste y remanente;
- estados parciales visibles y no engañosos;
- cambio de producto solo muestra SKU aprobados del mismo alimento;
- `Sustituir alimento` navega al flujo nutricional existente;
- sobrante requiere edición y confirmación;
- orden predeterminado y cuatro alternativas;
- ninguna mención de stock, Sevilla ni fecha de actualización;
- estados de carga, error, vacío, teclado, foco y lector de pantalla;
- viewport móvil y escritorio sin desbordamiento.
- el selector V1 ofrece Mercadona, DIA y ALDI; una preferencia heredada Lidl, Carrefour o
  Alcampo se conserva como no compatible y solicita elección, sin coerción silenciosa.

**Paso 2: ejecutar RED**

```bash
pnpm exec vitest run tests/shopping-client.test.ts
pnpm exec playwright test tests/e2e/shopping.spec.ts
```

Esperado: FAIL por interfaz ausente.

**Paso 3: implementar UI fina**

- No recalcular envases ni totales en React.
- Presentar el snapshot recibido.
- Al cambiar una opción, solicitar revisión al servidor y reemplazar la vista solo al
  recibir el nuevo snapshot.
- Mantener la preferencia habitual separada del modo comparativo.
- Usar controles existentes y estilos del proyecto; la revisión visual general sigue
  fuera de T17.
- Actualizar solo las sugerencias de supermercado del cuestionario a las tres cadenas V1;
  mantener las demás como expansión futura documentada.

**Paso 4: verificar GREEN y accesibilidad**

```bash
pnpm exec vitest run tests/shopping-client.test.ts tests/questionnaire-contracts.test.ts
pnpm exec playwright test tests/e2e/shopping.spec.ts
pnpm test:a11y
pnpm build
```

Esperado: PASS.

**Paso 5: commit**

```bash
git add apps/web/src/features/shopping apps/web/src/main.tsx apps/web/src/features/nutrition/NutritionApp.tsx packages/contracts/src/questionnaire.ts tests/questionnaire-contracts.test.ts tests/shopping-client.test.ts tests/e2e/shopping.spec.ts
git commit -m "feat(web): present consultative shopping snapshots"
```

---

# T17E — Exportación, operaciones y validación remota

## Tarea E.1: Proyectar el mismo snapshot en impresión, PDF y XLSX

**Archivos:**

- Modificar: `packages/contracts/src/exports.ts`
- Modificar: `packages/export/src/model.ts`
- Modificar: `packages/export/src/pdf.ts`
- Modificar: `packages/export/src/xlsx.ts`
- Modificar: `supabase/functions/exports/index.ts`
- Modificar: `apps/web/src/features/exports/ExportPanel.tsx`
- Modificar: `tests/export-model.test.ts`
- Modificar: `tests/export-pdf.test.ts`
- Modificar: `tests/export-xlsx.test.ts`
- Modificar: `tests/export-edge.test.ts`
- Modificar: `tests/e2e/exports.spec.ts`
- Crear: `tests/shopping-export-equivalence.test.ts`

**Paso 1: escribir pruebas RED**

Extender `ExportCreateRequest` con `shoppingSnapshotId?: string` y comprobar:

- el servidor carga el snapshot; el cliente no envía filas;
- snapshot y export pertenecen al mismo perfil y `planVersionId`;
- snapshot archivado sigue exportable si está autorizado;
- configuración/digest/renderizador incluyen ID y digest de compra;
- pantalla, impresión, PDF y XLSX conservan exactamente cadena, fila, orden, envases,
  coste, remanente, subtotal/total y pendientes;
- si no hay snapshot se mantiene la lista canónica T15;
- nombres importados no ejecutan HTML ni fórmulas XLSX;
- no aparecen IDs privados, GTIN, ubicación, hashes o referencias R2;
- respuesta privada y proxy autenticado conservan cabeceras T15.

**Paso 2: ejecutar RED**

```bash
pnpm exec vitest run tests/export-model.test.ts tests/export-pdf.test.ts tests/export-xlsx.test.ts tests/export-edge.test.ts tests/shopping-export-equivalence.test.ts
```

Esperado: FAIL porque exportación no conoce `ShoppingSnapshot`.

**Paso 3: implementar una única proyección**

- Ampliar `ExportModel`, no duplicar el resolver.
- Hacer que PDF/XLSX/print consuman la misma lista ya ordenada.
- Subir `rendererVersion` de forma explícita.
- Preservar exportaciones T15 existentes.

**Paso 4: verificar GREEN**

```bash
pnpm edge:generate
pnpm edge:check
pnpm exec vitest run tests/export-model.test.ts tests/export-pdf.test.ts tests/export-xlsx.test.ts tests/export-edge.test.ts tests/shopping-export-equivalence.test.ts
pnpm exec playwright test tests/e2e/exports.spec.ts tests/e2e/shopping.spec.ts
pnpm typecheck
```

Esperado: PASS.

**Paso 5: commit**

```bash
git add packages/contracts/src/exports.ts packages/export/src supabase/functions/exports/index.ts apps/web/src/features/exports/ExportPanel.tsx tests/export-model.test.ts tests/export-pdf.test.ts tests/export-xlsx.test.ts tests/export-edge.test.ts tests/e2e/exports.spec.ts tests/shopping-export-equivalence.test.ts supabase/functions/_shared/generated
git commit -m "feat(exports): render frozen shopping snapshots"
```

## Tarea E.2: Completar runbook, trazabilidad y smoke remoto

**Archivos:**

- Crear: `docs/runbooks/catalog-publication.md`
- Modificar: `docs/runbooks/README.md`
- Crear: `scripts/supermarket-catalog-remote-smoke.mjs`
- Modificar: `package.json`
- Crear: `docs/quality/TASK_17_VERIFICATION.md`
- Modificar: `docs/architecture/ARCHITECTURE.md`
- Modificar: `docs/architecture/API_CONTRACT.md`
- Modificar: `docs/architecture/DOMAIN_DATA_MODEL.md`
- Modificar: `docs/data/DATA_GOVERNANCE.md`
- Modificar: `docs/product/USER_FLOWS.md`
- Modificar: `docs/quality/TEST_STRATEGY.md`
- Modificar: `docs/quality/SCENARIO_CATALOG.md`
- Modificar: `docs/quality/TRACEABILITY.md`
- Modificar: `docs/quality/ACCEPTANCE_GATES.md`
- Modificar: `docs/security/SECURITY_CONTRACT.md`
- Modificar: `docs/security/THREAT_MODEL.md`
- Modificar: `docs/operations/OPERATIONS.md`
- Modificar: `docs/backlog/FUTURE.md`
- Modificar: `ROADMAP.md`
- Modificar: `docs/plans/2026-07-16-v1-implementation-plan.md`

**Paso 1: escribir el smoke en modo dry-run**

El script debe:

- exigir proyecto `health-design-dev` (`nwoivdxdupklervtnovd`);
- rechazar cualquier referencia de producción;
- requerir dos perfiles sintéticos y superadministrador AAL2/TOTP reciente;
- consultar recibos antes de reintentar;
- no imprimir secretos, TOTP, nombres importados, precios ni datos de salud;
- permitir seed de rate-limit para probar un único 429 sin 130 llamadas;
- registrar IDs redactados, hashes no sensibles, conteos y cleanup;
- tener `--dry-run` sin mutaciones.

**Paso 2: verificar dry-run y documentación**

```bash
node scripts/supermarket-catalog-remote-smoke.mjs --dry-run
pnpm exec prettier --check docs scripts/supermarket-catalog-remote-smoke.mjs package.json
git diff --check
```

Esperado: PASS sin red ni mutaciones.

**Paso 3: ejecutar la batería local completa**

```bash
pnpm edge:generate
pnpm edge:check
pnpm test:db
pnpm worker:check
pnpm test:supply-chain
CI=true pnpm verify
```

Esperado: PASS. Si falla cualquier gate, T17 permanece `T17_LOCAL_PENDING`.

**Paso 4: revisión independiente antes de remoto**

Usar `requesting-code-review` y corregir hallazgos verificados. Repetir:

```bash
CI=true pnpm verify
pnpm test:db
pnpm worker:check
git diff --check
```

Esperado: PASS y worktree solo con cambios T17.

**Paso 5: commit local de cierre**

```bash
git add docs scripts/supermarket-catalog-remote-smoke.mjs package.json
git commit -m "docs(t17): add publication runbook and verification"
```

En este punto el máximo estado permitido es `T17_LOCAL_PASS`.

> **Recibo local 2026-07-23 — `T17_LOCAL_PASS`:** la migración aditiva
> `20260723140000_export_snapshot_profile_binding.sql` se reconstruyó desde todo
> el historial y quedó cubierta por pgTAP. Los commits funcionales son
> `e3d109b8bcf7ad4e8b1c91d29cfc8b3503e58978` y
> `7da7333fc67734de163b22797dae72065ff612a6`. Pasaron 93 pruebas dirigidas,
> 743 Vitest, 422 pgTAP, 40 E2E, 7 de accesibilidad, los dry-run de Worker,
> audit, supply chain, build y revisión independiente sin hallazgos críticos ni
> altos. El smoke permanece en dry-run; T17E.3, remoto, Preview y Production no
> se iniciaron. Mercadona sigue publicada; DIA y ALDI siguen sin publicar.
> Multitienda remoto continúa
> `NOT_APPLICABLE_REMOTE_ONLY_ONE_CHAIN_PUBLISHED`, publicación histórica
> `NOT_APPLICABLE_WITHOUT_SAFE_PUBLICATION_CHANGE` y restauración integral T18
> `NOT_IMPLEMENTED`.

## Tarea E.3: Activar y validar exclusivamente en desarrollo

**Esta tarea requiere autorización explícita independiente.**

### Paso 1: preflight y copia

```bash
git status --short
git rev-parse HEAD
supabase migration list --linked
CI=true pnpm verify
pnpm test:db
pnpm worker:check
pnpm test:supply-chain
```

- Confirmar `health-design-dev`; detenerse ante cualquier referencia de producción.
- Eliminar una rotación antigua solo con autorización si el límite de cuatro lo exige.
- Crear copia cifrada precrítica T17 y verificar hash/restaurabilidad antes de migrar.

### Paso 2: crear almacenamiento privado de desarrollo

- Crear el bucket R2 EU privado de desarrollo
  `health-design-catalog-source-dev`, documentado en el runbook.
- No crear ni tocar el bucket de producción.
- Subir captura bruta y normalizada de cada cadena mediante Wrangler CLI.
- Leer de vuelta y verificar SHA-256 y ausencia de acceso público.
- DIA y ALDI deben disponer de evidencia fuente regenerada antes de ser candidatas.

### Paso 3: aplicar migraciones y desplegar

```bash
supabase db push --linked --dry-run
supabase db push --linked
supabase functions deploy catalogs --project-ref nwoivdxdupklervtnovd
supabase functions deploy admin --project-ref nwoivdxdupklervtnovd
supabase functions deploy admin-reconciler --project-ref nwoivdxdupklervtnovd
supabase functions deploy exports --project-ref nwoivdxdupklervtnovd
```

Desplegar solo funciones realmente modificadas. Conservar verificación JWT y comprobar
hash de cada bundle.

### Paso 4: importar a cuarentena

- Importar las tres capturas con manifest y hashes verificados.
- Confirmar cero publicaciones automáticas.
- Repetir el mismo import y verificar idempotencia.
- Probar una variación con la misma clave y confirmar conflicto sin escritura parcial.
- Reproducir con parser CSV 4.314 + 7.661 + 1.696 = 13.671 y verificar que el manifest
  separa las 41 filas de error del subconjunto utilizable.
- Verificar `license_status`, términos y decisión de uso de desarrollo; `unknown` no puede
  pasar a publicación.

### Paso 5: matching y publicación AAL2

- Generar candidatos deterministas de las 80 claves.
- Revisar/activar reglas necesarias con AAL2 y TOTP reciente.
- Probar AAL1 rechazado antes de mutación.
- Evaluar cada cadena de forma independiente.
- Publicar solo las cadenas que demuestren ≥72/80 y ≥75 % por grupo.
- Mantener explícitamente `not_published` las que fallen.
- Verificar `intent`, `outcome` y reconciliación sin payload sensible.

### Paso 6: smoke funcional

Con dos perfiles sintéticos:

- RLS A/B;
- selección habitual explícita;
- cesta monoestablecimiento completa o parcial;
- aviso de ahorro sin cambiar habitual;
- multi opt-in y ahorro de céntimos;
- sobrante confirmado y recálculo de paquetes;
- cambio manual de SKU del mismo alimento;
- `Sin producto confirmado` y `Precio no disponible`;
- orden idéntico en web/print/PDF/XLSX;
- hash nutricional estable;
- snapshot histórico estable después de publicar otra revisión;
- 429 con `Retry-After` mediante seed controlado;
- ninguna mención pública de stock, Sevilla o fecha de catálogo.

### Paso 7: purga y cleanup

- Purgar perfiles sintéticos y verificar preferencias, sobrantes, snapshots y artefactos
  privados eliminados.
- Confirmar que el catálogo global permanece sin vínculo identificable.
- Eliminar objetos R2 temporales, no las capturas/manifests de evidencia publicados.
- Cerrar outbox y ledger sin pendientes.
- Borrar secretos y archivos temporales locales.
- Si la restauración integral T18 todavía no existe, marcar ese subgate como
  `NOT_IMPLEMENTED`; no convertirlo en PASS por inferencia.

### Paso 8: evidencia y estado

Actualizar `docs/quality/TASK_17_VERIFICATION.md` con:

- commit exacto;
- migraciones y funciones desplegadas;
- hashes de bundles y manifiestos no sensibles;
- conteos por cadena, cobertura total y por grupo;
- resultados AAL1/AAL2, RLS, idempotencia y rate limit;
- snapshot/digest y equivalencia de exportaciones;
- cleanup final;
- producción sin cambios.

Solo si todas las puertas aplicables pasan:

```text
T17_COMPLETE_REMOTE_PASS
```

Una cadena fallida debe figurar `not_published`; nunca se inventará evidencia para cerrar
su publicación.

> **Recibo remoto 2026-07-23 — `T17_COMPLETE_REMOTE_PASS`:** Development quedó
> alineado hasta la migración aditiva
> `20260723154700_shopping_create_schema_version.sql`; `catalogs` v6 y `exports`
> v8 están activos, y la UI se validó exclusivamente en Pages Preview. El smoke
> remoto pasó AAL1/AAL2, aislamiento RLS, cestas completa/parcial, snapshot
> archivado, idempotencia, 429 controlado, PDF/XLSX privados, invariancia
> nutricional y purga con cero residuos. Mercadona permanece publicada; DIA y
> ALDI permanecen `not_published`. Selección manual sin segundo SKU,
> multitienda con una sola cadena y publicación histórica sin cambio seguro
> figuran como `NOT_APPLICABLE`; la restauración integral T18 continúa
> `NOT_IMPLEMENTED`. Producción no se modificó. La evidencia íntegra está en
> [`TASK_17_VERIFICATION.md`](../quality/TASK_17_VERIFICATION.md).

**Commit de evidencia después del smoke:**

```bash
git add docs/quality/TASK_17_VERIFICATION.md docs/runbooks/catalog-publication.md
git commit -m "docs(t17): record development remote validation"
```

---

## Matriz final de trazabilidad

| Contrato | Tarea | Evidencia principal |
|---|---|---|
| Semilla exacta 60 + 20 | P0.1–P0.2 | fixture, fuente oficial, 80/80 |
| Import reproducible y R2 privado | A.2–A.3, E.3 | hashes bruto/normalizado y manifest |
| Matching cadena+SKU separado de T16 | B.2 | unitarias, SQL y regla activa única |
| Gate 72/80 + 75 % por grupo | B.2–B.3 | cobertura pura, RPC AAL2, publicación |
| Precio/envase/remanente | A.2, C.1 | parser y resolver decimal |
| Habitual estable | C.2, D.3 | unitarias y E2E |
| Multi opt-in sin umbral | C.2, D.3 | unitarias y E2E |
| Sobrante solo confirmado | C.1, D.1–D.3 | resolver, SQL y E2E |
| Parcial no se llama más barata | C.2, D.3 | unitarias, copy y E2E |
| Nutrición inmutable | C.2 | hash y agregados byte-estables |
| Snapshot inmutable | D.1–D.2 | SQL, API, replay histórico |
| Misma salida web/PDF/XLSX/print | E.1 | prueba de equivalencia |
| RLS/AAL2/auditoría/rate limit | B.3, D.1–D.2, E.3 | SQL, Edge y remoto |
| Sin stock/Sevilla/fecha visible | A.1, D.3, E.1 | contratos, UI y exportaciones |

## Secuencia de integración recomendada

1. Ejecutar y revisar T17-P0; fusionar solo cuando 80/80 esté demostrado.
2. Ejecutar T17A; no subir datos ni tocar remoto.
3. Ejecutar T17B; validar migraciones localmente, sin publicarlas aún.
4. Ejecutar T17C y solicitar revisión independiente del resolver puro.
5. Ejecutar T17D y E.1; validar E2E y equivalencia.
6. Ejecutar E.2 y alcanzar `T17_LOCAL_PASS`.
7. Solicitar autorización para E.3.
8. Tras `T17_COMPLETE_REMOTE_PASS`, solicitar por separado commit/fusión/push si aún no
   se han autorizado.

## Criterio de parada

Detenerse y preguntar al usuario si aparece cualquiera de estos casos:

- una identidad del núcleo 60 + 20 no tiene correspondencia oficial inequívoca;
- un formato necesita una conversión masa/volumen/unidad no confirmada;
- una captura real, ruta, fuente o conteo no coincide con el manifest esperado;
- ninguna cadena puede alcanzar la cobertura sin relajar matching o alergias;
- un cambio exige stock, disponibilidad, ofertas o comportamiento no confirmado;
- una acción remota apunta a producción o requiere eliminar una copia/objeto existente;
- una prueba revela que T17 alteraría la versión nutricional activa.

No resolver esos casos mediante aproximaciones, promedios ni IA.
