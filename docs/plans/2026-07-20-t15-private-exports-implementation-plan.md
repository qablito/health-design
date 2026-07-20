# Plan de implementación T15: exportaciones privadas PDF, impresión y XLSX

> **Para Claude:** SUBHABILIDAD OBLIGATORIA: usa superpowers:executing-plans para implementar este plan tarea por tarea.

**Objetivo:** Añadir una preparación breve y determinista de las comidas y después exportar el resultado nutricional de una versión inmutable del plan como PDF/XLSX privado o como impresión accesible del navegador, sin cambiar su contenido nutricional.

**Arquitectura:** T15A introduce un conjunto versionado de reglas de preparación e incorpora la instrucción resuelta en cada alimento principal y sustituto. T15B construye un único modelo de vista canónico de exportación a partir de la versión almacenada del plan y una configuración acotada de elecciones; la impresión del navegador, `pdf-lib` y SheetJS CE consumen ese mismo modelo. Una Edge Function autenticada almacena los archivos generados en un bucket privado de Supabase Storage y sirve las descargas mediante proxy sin URL firmadas.

**Stack técnico:** TypeScript 6, Zod, React/Vite, Vitest, Playwright, Deno 2 / Supabase Edge Functions, PostgreSQL 17, Supabase Storage, `pdf-lib@1.17.1`, SheetJS CE `0.20.3` fijado desde el CDN oficial de SheetJS.

---

## 0. Alcance y límites confirmados

### T15A — contrato de preparación

- La preparación es determinista y nunca llama a Luna ni a otro modelo.
- Nunca cambia alimentos, cantidades, kcal, macros, fibra, nutrientes clínicos ni sustituciones.
- Cada alimento principal y cada uno de sus dos sustitutos almacena una instrucción resuelta, un ID de regla, una versión del conjunto de reglas y el estado `complete|provisional`.
- Las reglas de categoría/estado proporcionan el valor predeterminado; las excepciones se cubren con sobrescrituras por alimento canónico.
- Los alimentos desconocidos reciben la instrucción congelada `legacy-fallback-v1` y la incertidumbre `PREPARATION_RULE_MISSING`, sin invalidar la nutrición.
- Todos los alimentos disponibles para el generador activo deben tener cobertura de preparación completa antes de cerrar T15A.
- Las cargas nutricionales antiguas siguen siendo inmutables y legibles; se adaptan en memoria con el fallback heredado congelado, en lugar de actualizarse en la base de datos.

Payload de fallback congelado:

```ts
{
  instruction:
    "Utiliza la cantidad indicada. Consulta el envase o la información del alimento para su preparación habitual.",
  ruleId: "legacy-fallback",
  ruleSetVersion: "legacy-fallback-v1",
  status: "provisional",
}
```

Su uso añade `PREPARATION_RULE_MISSING`; las implementaciones no pueden reescribir este texto dentro de la misma versión.

### T15B — contrato de exportación

- Los artefactos de V1 exportan el **resultado nutricional** del `plan_version_id` integrado seleccionado; no vuelcan cargas sin procesar de entrenamiento, sueño, hidratación, movilidad ni suplementación.
- `compact` contiene las elecciones actuales. `complete` incluye además las dos alternativas de cada alimento.
- `ingredients` y `preparation` son modos de presentación sobre valores nutricionales idénticos.
- El intervalo de día/semana, la lista de la compra y la preparación semanal se pueden seleccionar de forma independiente cuando corresponda.
- La impresión del navegador usa HTML/CSS nativo y no crea un artefacto almacenado.
- El PDF y el XLSX se generan en el servidor, se almacenan en un bucket privado y se descargan mediante un proxy autenticado.
- La exportación nunca incluye alias, respuestas del cuestionario, condiciones, nombres de medicación, suplementos en uso, compuestos sensibles, referencias internas de evidencia ni hallazgos de seguridad sin procesar.
- Los artefactos permanecen disponibles hasta la eliminación permanente del perfil; T15 no introduce caducidad automática. La eliminación permanente debe retirar tanto los metadatos del artefacto como el objeto físico de Storage, y el trabajo de eliminación debe fallar de forma cerrada hasta confirmar esa retirada.
- T15 no añade entrega por correo electrónico, enlaces compartidos, URL públicas, archivos ZIP, recetas, imágenes, temporizadores de cocina ni exportaciones de módulos no nutricionales.

### Solicitud de exportación v1

```ts
type ExportCreateRequest = {
  schemaVersion: 1;
  format: "pdf" | "xlsx";
  detail: "compact" | "complete";
  presentation: "ingredients" | "preparation";
  range:
    | { kind: "week" }
    | { kind: "day"; day: 1 | 2 | 3 | 4 | 5 | 6 | 7 };
  includeShopping: boolean;
  includeWeeklyPreparation: boolean;
  // Only deviations from the stored primary choices. Tuple values are
  // dayIndex, mealIndex, foodIndex and original choice 0|1|2.
  choices: Array<readonly [number, number, number, 0 | 1 | 2]>;
};
```

Reglas:

- Tamaño máximo del cuerpo: 16 KiB antes de analizar el JSON.
- `dayIndex`, `mealIndex` y `foodIndex` empiezan en cero. La elección `0` significa el alimento principal almacenado y `1|2` el sustituto almacenado correspondiente.
- `choices` no contiene posiciones de alimento duplicadas y cada índice se valida contra la versión inmutable almacenada.
- `includeWeeklyPreparation=true` requiere `range.kind=week`.
- El servidor añade `rendererVersion=export-v1` antes de calcular el hash de la configuración.
- Reutilizar una clave de idempotencia con la misma solicitud devuelve el mismo artefacto; reutilizarla con otra solicitud devuelve `409 IDEMPOTENCY_KEY_REUSED`.
- Una clave de idempotencia distinta con la misma versión/configuración reutiliza el artefacto listo.

### Respuesta de exportación v1

```ts
type ExportArtifactAck = {
  artifactId: string;
  createdAt: string;
  detail: "compact" | "complete";
  format: "pdf" | "xlsx";
  planVersionId: string;
  presentation: "ingredients" | "preparation";
  schemaVersion: 1;
  status: "ready";
};
```

La descarga sigue siendo `GET /v1/exports/{artifactId}/content`. El ID del artefacto es un identificador, nunca una capacidad de autorización.

---

## T15A — preparación breve versionada

### Tarea 1: Añadir un contrato de preparación nutricional compatible con versiones anteriores

**Archivos:**

- Modificar: `packages/domain/src/nutrition/index.ts:86-141`
- Modificar: `packages/contracts/src/nutrition.ts:100-181`
- Crear: `tests/nutrition-contracts.test.ts`

**Paso 1: Escribir las pruebas de contrato que deben fallar**

Cubrir:

- un alimento planificado V2 requiere `preparation` en el principal y en ambos sustitutos;
- la instrucción tiene entre 1 y 240 caracteres;
- los ID y las versiones de regla coinciden con `^[a-z0-9][a-z0-9._-]{0,63}$`;
- una semana V2 requiere `nutritionSchemaVersion: 2` y metadatos de preparación;
- el payload heredado actual sigue siendo analizable mediante un esquema heredado específico;
- los payloads mixtos V1/V2 mal formados fallan en lugar de ser interpretados por suposición.

Forma esperada:

```ts
type FoodPreparation = Readonly<{
  instruction: string;
  ruleId: string;
  ruleSetVersion: string;
  status: "complete" | "provisional";
}>;

type NutritionPreparation = Readonly<{
  completeness: "complete" | "provisional";
  ruleSetVersion: string;
  uncertainties: readonly NutritionUncertainty[];
}>;
```

**Paso 2: Ejecutar la prueba enfocada y verificar RED**

Ejecutar: `pnpm exec vitest run tests/nutrition-contracts.test.ts`

Esperado: FAIL porque los esquemas/tipos V2 no existen.

**Paso 3: Añadir los tipos de dominio y esquemas Zod mínimos**

- Conservar el esquema actual como `LegacyNutritionWeekSchema`.
- Definir el `NutritionWeekV2Schema` requerido.
- Exportar `NutritionWeekSchema` como parser aceptado para legado o V2.
- Exportar un normalizador que devuelva datos compatibles con V2 sin mutar su entrada.
- No añadir campos de preparación a `EffectiveNutritionFood`; la preparación pertenece al plan generado, no a los datos de nutrientes de origen.

**Paso 4: Generar y verificar los contratos de Edge**

Ejecutar: `pnpm edge:generate && pnpm edge:check`

Esperado: PASS y las declaraciones generadas incluyen los nuevos contratos de exportación/preparación.

**Paso 5: Ejecutar las pruebas enfocadas y la comprobación de tipos**

Ejecutar: `pnpm exec vitest run tests/nutrition-contracts.test.ts && pnpm typecheck`

Esperado: PASS.

**Paso 6: Hacer commit durante la implementación**

```bash
git add packages/domain/src/nutrition/index.ts packages/contracts/src/nutrition.ts tests/nutrition-contracts.test.ts supabase/functions/_shared/generated
git commit -m "feat(nutrition): version brief preparation contract"
```

### Tarea 2: Crear el conjunto determinista de reglas de preparación

**Archivos:**

- Crear: `packages/engine/src/modules/nutrition/preparation.ts`
- Modificar: `packages/engine/src/modules/nutrition/index.ts:741-781`
- Crear: `tests/nutrition-preparation.test.ts`
- Modificar fixture: `packages/test-fixtures/src/profiles/nutrition/index.ts`

**Paso 1: Escribir las pruebas fallidas de resolución de reglas**

Comprobar:

- la resolución de reglas depende únicamente de los datos del alimento canónico;
- la sobrescritura canónica prevalece sobre el valor predeterminado de categoría/estado;
- cada alimento activo de los fixtures se resuelve como `complete`;
- una clave desconocida recibe exactamente el fallback congelado y el estado provisional;
- la salida no contiene texto de condiciones, medicación, suplementos ni evidencia interna;
- las resoluciones repetidas son profundamente iguales.

**Paso 2: Ejecutar la prueba enfocada y verificar RED**

Ejecutar: `pnpm exec vitest run tests/nutrition-preparation.test.ts`

Esperado: FAIL porque falta el conjunto de reglas.

**Paso 3: Implementar el catálogo versionado más pequeño**

Usar:

```ts
export const PREPARATION_RULE_SET_VERSION = "meal-preparation-v1";
export const LEGACY_PREPARATION_RULE_SET_VERSION = "legacy-fallback-v1";

export function resolveFoodPreparation(
  food: Pick<EffectiveNutritionFood, "canonicalFoodKey" | "category" | "foodState">,
): FoodPreparation;
```

- Mantener los valores predeterminados de categoría/estado en un único mapa cerrado.
- Añadir sobrescrituras canónicas únicamente cuando un valor predeterminado sea incorrecto.
- Mantener las instrucciones breves, en español sencillo e independientes de las cantidades.
- No añadir temperaturas exactas de cocción, duraciones de conservación ni instrucciones de etiquetas de producto no verificadas.

**Paso 4: Adjuntar la preparación al crear cualquier alternativa**

Modificar únicamente `alternative(...)`; `plannedFood(...)` y `plannedSubstitute(...)` ya pasan por ella. Así un único cambio en la raíz cubre principales y sustitutos.

**Paso 5: Añadir metadatos de preparación a nivel de semana**

- Establecer `nutritionSchemaVersion: 2`.
- Agregar las incertidumbres de reglas ausentes por clave canónica.
- Marcar como provisionales únicamente los metadatos de preparación; no invalidar la validación nutricional.

**Paso 6: Verificar la generación y la cobertura**

Ejecutar:

```bash
pnpm exec vitest run tests/nutrition-preparation.test.ts
pnpm exec vitest run tests/nutrition-engine.test.ts
pnpm exec vitest run tests/nutrition-substitution.test.ts
```

Esperado: PASS, incluida la cobertura exacta de dos sustitutos.

**Paso 7: Hacer commit durante la implementación**

```bash
git add packages/engine/src/modules/nutrition packages/test-fixtures/src/profiles/nutrition tests/nutrition-preparation.test.ts
git commit -m "feat(nutrition): generate deterministic meal preparation"
```

### Tarea 3: Conservar la preparación mediante sustituciones y planes heredados

**Archivos:**

- Modificar: `packages/engine/src/modules/nutrition/index.ts:924-993,1240-1272`
- Modificar: `packages/contracts/src/nutrition.ts`
- Crear: `tests/nutrition-substitution.test.ts`
- Modificar: `tests/nutrition-preparation.test.ts`

**Paso 1: Añadir las pruebas fallidas de sustitución e historial**

Comprobar:

- seleccionar cualquiera de los sustitutos promueve su propia instrucción de preparación;
- el alimento principal anterior se convierte en una alternativa con su instrucción original;
- kcal/macros/fibra/nutrientes clínicos se siguen recalculando exactamente;
- cambiar la presentación no puede afectar a los totales;
- normalizar un payload heredado usa el fallback congelado sin cambiar los bytes de entrada;
- cambiar el mapa de reglas activo no puede cambiar una instrucción V2 almacenada.

**Paso 2: Ejecutar las pruebas enfocadas y verificar RED**

Ejecutar: `pnpm exec vitest run tests/nutrition-substitution.test.ts tests/nutrition-preparation.test.ts`

Esperado: al menos falla la nueva aserción del historial.

**Paso 3: Implementar el adaptador heredado y conservar las sustituciones**

- Mantener `applyNutritionSubstitution` ajeno a la búsqueda de reglas; solo mueve las alternativas almacenadas.
- Normalizar únicamente en el límite donde se lee un payload heredado.
- Añadir `PREPARATION_NOT_VERSIONED` a los metadatos de preparación heredados.
- No persistir nunca los datos heredados normalizados de nuevo en `module_results`.

**Paso 4: Ejecutar el conjunto de regresión nutricional**

Ejecutar: `pnpm exec vitest run tests/nutrition-contracts.test.ts tests/nutrition-preparation.test.ts tests/nutrition-substitution.test.ts tests/nutrition-engine.test.ts tests/plan-nutrition-catalog.test.ts tests/nutrition-client.test.ts`

Esperado: PASS.

**Paso 5: Hacer commit durante la implementación**

```bash
git add packages/contracts/src/nutrition.ts packages/engine/src/modules/nutrition/index.ts tests/nutrition-preparation.test.ts tests/nutrition-substitution.test.ts
git commit -m "fix(nutrition): preserve preparation across choices"
```

### Tarea 4: Añadir en pantalla el selector accesible de ingredientes/preparación

**Archivos:**

- Modificar: `apps/web/src/features/nutrition/NutritionApp.tsx:534-688`
- Modificar: `apps/web/src/features/nutrition/nutrition.css`
- Modificar: `tests/e2e/nutrition-plan.spec.ts`

**Paso 1: Añadir una prueba E2E fallida**

Nombrar el caso de accesibilidad con `accesible` para que lo ejecute el grep de accesibilidad establecido en el repositorio.

Comprobar:

- el modo predeterminado es `Ingredientes y cantidades`;
- cambiar a `Preparación breve` muestra las instrucciones de los alimentos seleccionados;
- los nutrientes y selectores de sustitutos siguen visibles;
- seleccionar un sustituto actualiza la instrucción visible;
- el selector se puede usar con teclado y tiene una etiqueta de grupo accesible;
- no se muestra código interno de preparación.

**Paso 2: Ejecutar el caso E2E y verificar RED**

Ejecutar: `pnpm exec playwright test tests/e2e/nutrition-plan.spec.ts`

Esperado: FAIL porque el selector no existe.

**Paso 3: Implementar el selector con controles nativos**

- Usar un `fieldset` y dos inputs de radio; no añadir una biblioteca de componentes.
- Mostrar la instrucción almacenada de cada alimento seleccionado debajo de su cantidad actual.
- No ocultar nutrientes ni alternativas en el modo de preparación.
- Mantener la elección únicamente en el estado del componente; no son datos de salud y no es necesario persistirla.

**Paso 4: Verificar la interfaz y la accesibilidad**

Ejecutar:

```bash
pnpm exec playwright test tests/e2e/nutrition-plan.spec.ts
pnpm exec playwright test tests/e2e/nutrition-plan.spec.ts --grep accesible
```

Esperado: PASS.

**Paso 5: Punto de control T15A**

Ejecutar:

```bash
pnpm edge:check
pnpm lint
pnpm typecheck
pnpm exec vitest run tests/nutrition-contracts.test.ts tests/nutrition-preparation.test.ts tests/nutrition-substitution.test.ts tests/nutrition-engine.test.ts tests/plan-nutrition-catalog.test.ts tests/nutrition-client.test.ts
pnpm exec playwright test tests/e2e/nutrition-plan.spec.ts
```

Punto de control requerido: `T15A_COMPLETE_LOCAL_PASS`.

**Paso 6: Hacer commit durante la implementación**

```bash
git add apps/web/src/features/nutrition tests/e2e/nutrition-plan.spec.ts
git commit -m "feat(web): show brief meal preparation"
```

---

## T15B — un modelo, PDF/XLSX privado e impresión nativa

### Tarea 5: Añadir los contratos de la API de exportación y el modelo de vista canónico

**Archivos:**

- Crear: `packages/contracts/src/exports.ts`
- Modificar: `packages/contracts/src/index.ts`
- Modificar: `packages/engine/package.json`
- Crear: `packages/export/package.json`
- Crear: `packages/export/src/model.ts`
- Crear: `packages/export/src/index.ts`
- Modificar: `tsconfig.json`
- Crear: `tests/export-contract.test.ts`
- Crear: `tests/export-model.test.ts`

**Paso 1: Escribir las pruebas fallidas de esquema**

Cubrir el contrato de solicitud/respuesta definido arriba, incluidas elecciones acotadas compatibles con 16 KiB, ausencia de posiciones duplicadas y el refinamiento día/semana.

**Paso 2: Escribir las pruebas fallidas del modelo**

El modelo canónico debe demostrar:

- compact/full comparten el mismo `planVersionId` y los totales elegidos;
- ingredients/preparation comparten filas idénticas de alimentos y nutrientes;
- las elecciones se aplican desde los índices originales y no pueden seleccionar una alternativa que no pertenezca al usuario;
- el alcance de día contiene un día; el de semana contiene siete;
- la compra se recalcula a partir de los alimentos elegidos en el intervalo seleccionado;
- la preparación semanal agrupa únicamente alimentos canónicos elegidos;
- los tokens sensibles inyectados en resultados de módulos no relacionados nunca entran en el modelo;
- el orden de filas es estable: día, comida, alimento, elemento seleccionado, alternativas.

**Paso 3: Ejecutar las pruebas y verificar RED**

Ejecutar: `pnpm exec vitest run tests/export-contract.test.ts tests/export-model.test.ts`

Esperado: FAIL porque faltan el paquete y los esquemas.

**Paso 4: Implementar el modelo de vista puro**

El modelo recibe únicamente:

```ts
createExportModel({
  config,
  nutrition,
  planVersionId,
  planOutputHash,
  rendererVersion: "export-v1",
});
```

- No debe recibir datos del cuestionario/contexto.
- Exponer `@health-design/engine/nutrition` como una subruta de paquete estrecha y usar su `applyNutritionSubstitution`; no duplicar cálculos de nutrientes ni importar todo el barrel del motor.
- Exportar un modelo serializable y seguro para impresión, sin tipos específicos de bibliotecas PDF/XLSX.
- Dar a `@health-design/export` exports explícitos de paquete y dependencias de workspace sobre contracts y la subruta de nutrición del motor. Registrar los alias de TypeScript; no depender de un alias de workspace no declarado.

**Paso 5: Verificar las pruebas y el límite del bundle frontend**

Ejecutar: `pnpm exec vitest run tests/export-contract.test.ts tests/export-model.test.ts && pnpm typecheck`

Esperado: PASS.

**Paso 6: Hacer commit durante la implementación**

```bash
git add packages/contracts/src packages/engine/package.json packages/export tests/export-contract.test.ts tests/export-model.test.ts supabase/functions/_shared/generated tsconfig.json
git commit -m "feat(export): add canonical versioned export model"
```

### Tarea 6: Generar PDF con pdf-lib y XLSX con SheetJS CE

**Archivos:**

- Modificar: `packages/export/package.json`
- Crear: `packages/export/src/pdf.ts`
- Crear: `packages/export/src/xlsx.ts`
- Modificar: `packages/export/src/index.ts`
- Modificar: `pnpm-lock.yaml`
- Crear: `tests/export-pdf.test.ts`
- Crear: `tests/export-xlsx.test.ts`
- Crear: `packages/test-fixtures/src/exports/index.ts`
- Modificar: `packages/test-fixtures/package.json`

**Paso 1: Añadir dependencias con versiones exactas**

Ejecutar durante la implementación:

```bash
pnpm --filter @health-design/export add pdf-lib@1.17.1
pnpm --filter @health-design/export add xlsx@https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz
```

Si la política de cadena de suministro del repositorio rechaza el tarball oficial fijado, detenerse e informar. No usar silenciosamente el paquete npm obsoleto `xlsx@0.18.5`.

**Paso 2: Escribir las pruebas PDF fallidas**

Comprobar:

- los bytes comienzan por `%PDF-` y se cargan mediante `PDFDocument.load`;
- se crean páginas A4 y nunca están vacías;
- los metadatos compact/full hacen referencia a la misma versión del plan;
- la salida completa es mayor e incluye secciones de alternativas en el modelo;
- los metadatos neutros del documento no contienen alias ni contexto de salud;
- la puntuación española, las tildes y la `ñ` se renderizan sin glifos de sustitución;
- el fixture máximo permanece por debajo de 25 MiB.

**Paso 3: Escribir las pruebas fallidas de ida y vuelta XLSX**

Comprobar:

- las hojas obligatorias son `Plan` y `Metadatos`;
- `Compra` y `Preparación` existen únicamente cuando se seleccionan;
- la versión y las unidades sobreviven a una lectura posterior con SheetJS;
- las cadenas que comienzan por `=`, `+`, `-`, `@`, tabulador o retorno de carro se almacenan como texto neutro;
- compact/full conservan los totales elegidos;
- el libro permanece por debajo de 25 MiB.

**Paso 4: Implementar los renderizadores mínimos**

- El PDF usa Helvetica/Helvetica Bold integradas; sin recurso de fuente ni runtime de navegador.
- Usar un único escritor de páginas con márgenes A4 explícitos, texto ajustado y saltos de página.
- XLSX usa arrays-of-arrays y anchos de columna explícitos; sin fórmulas, macros ni enlaces externos.
- Exportar `renderPdf(model)` y `renderXlsx(model)` devolviendo `Uint8Array`.

**Paso 5: Verificar la compatibilidad de imports locales de Deno**

Añadir el futuro mapeo de imports de Edge en un `deno.json` temporal y aislado o usar el mapeo de la función de la Tarea 8. Ejecutar `deno info` cuando esté disponible y `supabase functions serve exports` después de la Tarea 8. No afirmar compatibilidad con Edge basándose únicamente en Vitest.

**Paso 6: Ejecutar las comprobaciones enfocadas y de cadena de suministro**

Ejecutar:

```bash
pnpm exec vitest run tests/export-pdf.test.ts tests/export-xlsx.test.ts
pnpm test:supply-chain
```

Esperado: PASS.

**Paso 7: Hacer commit durante la implementación**

```bash
git add packages/export packages/test-fixtures/src/exports packages/test-fixtures/package.json tests/export-pdf.test.ts tests/export-xlsx.test.ts pnpm-lock.yaml
git commit -m "feat(export): render private pdf and xlsx artifacts"
```

### Tarea 7: Añadir persistencia privada de artefactos y reserva transaccional

**Archivos:**

- Crear mediante CLI: `supabase/migrations/<generated>_private_plan_exports.sql`
- Crear: `supabase/tests/database/private_plan_exports_test.sql`

**Paso 1: Generar correctamente el nombre del archivo de migración**

Ejecutar: `pnpm exec supabase migration new private_plan_exports`

No inventar manualmente la marca temporal.

**Paso 2: Escribir primero las pruebas pgTAP fallidas**

Probar:

- el bucket `plan-exports` existe, es privado, acepta únicamente PDF/XLSX y limita los archivos a 25 MiB;
- `private.export_artifacts` no es accesible para `anon` ni `authenticated`;
- el acceso requiere una sesión Auth actual, un DeviceSession activo y pertenencia al perfil;
- un artefacto pendiente por perfil bloquea la generación concurrente duplicada;
- se aplican los límites móviles por hora de 20/perfil, 30/actor y 60/IP;
- la misma clave de idempotencia/solicitud reutiliza la respuesta;
- la misma clave con otra solicitud produce `idempotency_key_reused`;
- la misma versión/configuración devuelve el artefacto listo;
- la eliminación del perfil no puede llegar a `purged` mientras exista un objeto físico de exportación;
- la eliminación en dos fases enumera únicamente las rutas de exportación de ese perfil, confirma la eliminación de Storage y después elimina los metadatos del artefacto;
- una eliminación permanente completada no deja ni metadatos ni un objeto en `plan-exports`;
- los wrappers públicos revocan `PUBLIC` y conceden acceso únicamente a `service_role`.

**Paso 3: Ejecutar la prueba de base de datos y verificar RED**

Ejecutar: `pnpm test:db -- private_plan_exports_test.sql`

Esperado: FAIL porque los objetos no existen.

**Paso 4: Implementar el esquema mínimo**

Crear:

- bucket privado `plan-exports`;
- `private.export_artifacts` con perfil, actor, versión del plan, hash de renderizador/configuración, ruta de Storage, MIME, tamaño en bytes, hash de contenido, `pending|ready|failed`, marcas temporales y restricciones únicas;
- `private.export_rate_limit_events` que contenga únicamente el digest HMAC de IP junto con los ID de actor/perfil y la marca temporal;
- índices por perfil/actor/IP y marca temporal, además de un bloqueo consultivo transaccional que siga el patrón establecido de límites de acceso;
- un índice único parcial para un artefacto pendiente por perfil;
- `private.reserve_plan_export(...)`;
- `private.complete_plan_export(...)`;
- `private.fail_plan_export(...)`;
- `private.get_plan_export(...)`;
- RPC de eliminación de exportaciones en dos fases y solo para servicio, que enumeren las rutas de un perfil dentro de un trabajo de eliminación válido y confirmen su retirada;
- wrappers estrechos `public.internal_*` que vuelvan a comprobar siempre la sesión y el acceso al perfil.

Reutilizar `private.plan_idempotency` ampliando su restricción de operación con `export-create`; no crear un segundo framework general de idempotencia. Reutilizar el `ACCESS_RATE_LIMIT_PEPPER` existente para aplicar HMAC a la IP remota; nunca añadir ni almacenar una IP en texto claro. Actualizar `private.purge_profile_after_deletion_job()` para que rechace la transición final mientras un objeto de exportación carezca de una eliminación de Storage confirmada.

**Paso 5: Ejecutar las pruebas de base de datos y los asesores**

Ejecutar:

```bash
pnpm test:db -- private_plan_exports_test.sql
pnpm exec supabase db advisors --local --type all --level warn --fail-on warn
pnpm exec supabase db lint --local --schema public,private --level warning --fail-on warning
pnpm exec supabase migration list --local
```

Esperado: PASS sin nuevos ERROR/WARN atribuibles a T15; documentar por separado cualquier línea base INFO preexistente.

**Paso 6: Hacer commit durante la implementación**

```bash
git add supabase/migrations supabase/tests/database/private_plan_exports_test.sql
git commit -m "feat(db): reserve private versioned exports"
```

### Tarea 8: Añadir la Edge Function autenticada de exportaciones

**Archivos:**

- Crear: `supabase/functions/exports/deno.json`
- Crear: `supabase/functions/exports/index.ts`
- Modificar: `supabase/config.toml`
- Modificar: `tsconfig.json`
- Crear: `tests/export-edge.test.ts`
- Modificar: `tests/runtime-contract.test.ts`

**Paso 1: Escribir las pruebas fallidas del handler**

Inyectar las dependencias de Auth, RPC, renderizado y Storage. Probar:

- una ruta/consulta mal formada, la ausencia de bearer y un cuerpo no válido fallan de manera uniforme;
- se rechaza el cuerpo por encima de 16 KiB antes de analizarlo;
- la generación obtiene únicamente la versión del plan autorizada y analiza la nutrición mediante el normalizador heredado/V2;
- un duplicado `pending` devuelve `409 EXPORT_IN_PROGRESS`;
- un fallo del renderizador/Storage marca la reserva como fallida;
- los archivos de más de 25 MiB se rechazan antes de subirlos;
- la descarga vuelve a validar JWT, sesión y pertenencia;
- la descarga devuelve los bytes directamente, nunca `Location` ni una URL firmada;
- la eliminación de servicio retira las rutas exactas reservadas de Storage antes de confirmar la limpieza en base de datos;
- un fallo de eliminación deja bloqueado el trabajo de eliminación y permite reintentarlo de forma segura;
- los fallos de límite devuelven `429` con un `Retry-After` acotado, mientras que el RPC recibe únicamente un digest HMAC derivado de cabeceras de IP de Cloudflare/reenviadas de confianza;
- las cabeceras incluyen `Cache-Control: no-store, private`, un nombre neutro de archivo `Content-Disposition: attachment` sin alias, `Referrer-Policy: no-referrer` y `X-Content-Type-Options: nosniff`;
- los errores/registros públicos no contienen payload del plan ni bearer de Storage.

**Paso 2: Ejecutar las pruebas de Edge y verificar RED**

Ejecutar: `pnpm exec vitest run tests/export-edge.test.ts`

Esperado: FAIL porque el handler no existe.

**Paso 3: Implementar el análisis de rutas y la autenticación**

Rutas dentro de la función `exports`:

- `POST /v1/plans/{version_id}/exports`
- `GET /v1/exports/{artifact_id}/content`
- `POST /v1/internal/deletion-jobs/{job_id}/export-purge`

Seguir el patrón existente de autenticación/decodificación de sesión de `plans` para las rutas de usuario. La ruta interna de eliminación solo acepta el bearer de servicio, requiere que el trabajo de eliminación referenciado esté en su fase de purge, elimina las rutas reservadas exactas mediante la API de Storage y confirma la eliminación de forma transaccional antes de que pueda continuar la purga del perfil. Nunca se puede llamar con un JWT de usuario. Usar el rol de servicio únicamente dentro de la Edge Function; nunca devolverlo ni pasarlo al navegador.

Añadir `[functions.exports]` con `verify_jwt=true` a `supabase/config.toml`. Añadir las fuentes de la función al include de TypeScript raíz y comprobar el contrato runtime/configuración en `tests/runtime-contract.test.ts`; de lo contrario, la comprobación de tipos raíz podría omitir la nueva función.

**Paso 4: Fijar los imports de Deno por función**

Mapear las versiones exactas:

```json
{
  "imports": {
    "@health-design/contracts": "../_shared/generated/contracts.js",
    "@health-design/domain": "../../../packages/domain/src/index.ts",
    "@health-design/engine/nutrition": "../../../packages/engine/src/modules/nutrition/index.ts",
    "@health-design/export/model": "../../../packages/export/src/model.ts",
    "@health-design/export/pdf": "../../../packages/export/src/pdf.ts",
    "@health-design/export/xlsx": "../../../packages/export/src/xlsx.ts",
    "@supabase/supabase-js": "npm:@supabase/supabase-js@2.110.6",
    "pdf-lib": "npm:pdf-lib@1.17.1",
    "xlsx": "https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs"
  }
}
```

Ejecutar el grafo real de puntos de entrada mediante `deno info` si Deno está disponible. En caso contrario, considerar el arranque y la invocación correctos de `supabase functions serve exports` como la prueba mínima de compatibilidad. Resolver explícitamente cada import transitivo del workspace; no añadir un fallback npm para el código local de nutrición/motor.

**Paso 5: Servir localmente y verificar el bundle Deno real**

Ejecutar:

```bash
pnpm exec supabase functions serve exports --no-verify-jwt
```

Usar la inyección de secretos locales existente; no inventar ni hacer commit de `supabase/.env.local`. La opción local `--no-verify-jwt` desactiva únicamente la comprobación del gateway local para que las propias pruebas de sesión autenticada del handler puedan ejecutarse con un JWT de prueba local real. La configuración desplegada mantiene `verify_jwt=true`. Esperado: ambos renderizadores cargan y no aparece ningún error de módulo nativo.

**Paso 6: Ejecutar las comprobaciones enfocadas**

Ejecutar: `pnpm exec vitest run tests/export-contract.test.ts tests/export-model.test.ts tests/export-pdf.test.ts tests/export-xlsx.test.ts tests/export-edge.test.ts && pnpm edge:check && pnpm typecheck`

Esperado: PASS.

**Paso 7: Hacer commit durante la implementación**

```bash
git add supabase/functions/exports supabase/config.toml tests/export-edge.test.ts tests/runtime-contract.test.ts tsconfig.json
git commit -m "feat(edge): generate and proxy private exports"
```

### Tarea 9: Añadir controles de exportación, descarga privada e impresión nativa

**Archivos:**

- Crear: `apps/web/src/features/exports/export-client.ts`
- Crear: `apps/web/src/features/exports/ExportPanel.tsx`
- Crear: `apps/web/src/features/exports/exports.css`
- Modificar: `apps/web/src/features/nutrition/NutritionApp.tsx`
- Crear: `tests/export-client.test.ts`
- Crear: `tests/e2e/exports.spec.ts`

**Paso 1: Escribir las pruebas fallidas del cliente**

Comprobar:

- las rutas rechazan la inyección de consulta/fragmento;
- POST envía JWT, clave publicable, tipo de contenido JSON, no-referrer y clave de idempotencia;
- la respuesta se analiza mediante `ExportArtifactAckSchema`;
- la descarga obtiene el proxy autenticado y rechaza respuestas de redirección;
- Blob/URL de objeto es local y se revoca después de la descarga;
- no se acepta ninguna URL firmada desde JSON.

**Paso 2: Escribir las pruebas E2E fallidas**

Incluir un caso cuyo título contenga `accesible` para que el comando de accesibilidad enfocado no pueda pasar con cero pruebas coincidentes.

Cubrir:

- controles compact/complete, ingredients/preparation y día/semana;
- la opción de preparación semanal se desactiva para el alcance de día;
- las elecciones locales de sustitutos se codifican y se reflejan en la solicitud de impresión/exportación;
- los botones PDF y XLSX muestran estados claros de ocupado/éxito/error;
- la impresión muestra las mismas filas ordenadas y oculta navegación, selectores y botones;
- los nombres para teclado y lector de pantalla están completos;
- no se escribe ningún dato del plan en localStorage.

**Paso 3: Implementar el cliente mínimo**

Usar `fetch`, `Blob`, `URL.createObjectURL` nativos y un `<a download>` temporal. Sin Axios, biblioteca de consultas ni dependencia de descarga.

**Paso 4: Implementar ExportPanel**

- Grupos de radio/select/checkboxes nativos.
- Predeterminado: compact, ingredients, semana completa, compra activada y preparación semanal desactivada.
- `Imprimir` llama a `window.print()` sobre el modelo canónico que ya está en memoria.
- PDF/XLSX crean el artefacto privado y después obtienen su contenido autenticado.
- La exportación sigue disponible para cualquier versión validada de borrador/activa; una nutrición no válida no se exporta.

**Paso 5: Añadir CSS de impresión A4**

- `@page { size: A4; margin: 12mm; }`
- ocultar controles interactivos y navegación bajo `@media print`;
- evitar separar los encabezados de las comidas de su primera fila;
- conservar encabezados visibles y etiquetas de tabla;
- no usar contenido generado como única etiqueta accesible.

**Paso 6: Verificar interfaz, impresión y cliente**

Ejecutar:

```bash
pnpm exec vitest run tests/export-client.test.ts
pnpm exec playwright test tests/e2e/exports.spec.ts
pnpm exec playwright test tests/e2e/exports.spec.ts --grep accesible
```

Esperado: PASS.

**Paso 7: Hacer commit durante la implementación**

```bash
git add apps/web/src/features/exports apps/web/src/features/nutrition/NutritionApp.tsx tests/export-client.test.ts tests/e2e/exports.spec.ts
git commit -m "feat(web): download and print private plan exports"
```

### Tarea 10: Completar la evidencia local, de desarrollo remoto y documental

**Archivos:**

- Crear: `scripts/export-remote-smoke.mjs`
- Modificar: `package.json`
- Crear: `docs/adr/0008-edge-pdf-and-xlsx-renderers.md`
- Crear: `docs/quality/TASK_15_VERIFICATION.md`
- Modificar: `docs/architecture/API_CONTRACT.md`
- Modificar: `docs/architecture/DOMAIN_DATA_MODEL.md`
- Modificar: `docs/quality/TRACEABILITY.md`
- Modificar: `docs/quality/ACCEPTANCE_GATES.md`
- Modificar: `docs/plans/2026-07-16-v1-implementation-plan.md:987-1033`

**Paso 1: Añadir el script smoke de desarrollo remoto**

El script usa datos sintéticos y las credenciales locales seguras existentes. Debe verificar:

- creación/descarga sin autenticación rechazada;
- creación de miembro aceptada;
- la segunda solicitud con la misma clave de idempotencia devuelve el mismo artefacto;
- tipos de contenido y cabeceras de seguridad PDF/XLSX;
- ninguna redirección/URL firmada;
- un fixture de tamaño máximo por formato se renderiza sin errores de CPU/memoria;
- 20 solicitudes ligeras permitidas ejercen configuraciones distintas, la solicitud 21 del perfil queda limitada y las repeticiones idempotentes reutilizan un artefacto sin otra subida;
- el objeto privado de Storage existe y sigue inaccesible para el cliente del navegador;
- el tamaño del artefacto permanece por debajo de 25 MiB.

No registrar nunca JWT, bytes de objetos, respuestas del cuestionario ni rutas de Storage.

Registrarlo en `package.json` como `"test:t15:remote": "node scripts/export-remote-smoke.mjs"` antes de invocar el script por nombre.

**Paso 2: Ejecutar la puerta local completa**

```bash
pnpm edge:generate
pnpm verify
pnpm test:db
pnpm exec supabase db advisors --local --type all --level warn --fail-on warn
pnpm exec supabase db lint --local --schema public,private --level warning --fail-on warning
pnpm exec supabase db diff --local --schema public,private
pnpm exec playwright test tests/e2e/exports.spec.ts
pnpm exec playwright test tests/e2e/exports.spec.ts --grep accesible
pnpm test:supply-chain
```

Resultado requerido: `T15B_COMPLETE_LOCAL_PASS`.

**Paso 3: Revisar el diff sensible a seguridad**

Inspeccionar manualmente:

- concesiones de migración/RLS/rutas de búsqueda de `SECURITY DEFINER`;
- privacidad del bucket de Storage;
- comprobaciones de tamaño de solicitud antes del análisis;
- neutralización de fórmulas;
- redacción de salida;
- cabeceras de descarga y ausencia de redirección;
- secretos y registros;
- origen/integridad del lockfile de SheetJS.

**Paso 4: Crear la copia previa a cambios críticos exigida por operaciones**

El `docs/runbooks/backup-restore.md` definitivo pertenece a T18 y todavía no existe. Para T15, reproducir el último procedimiento de desarrollo cifrado verificado y registrado en `docs/quality/TASK_14_VERIFICATION.md`, registrar el comando exacto de T15, la ruta del objeto, el servicio de Keychain y el SHA-256 en `TASK_15_VERIFICATION.md`, y verificar la imagen antes de la migración. No afirmar que existe el runbook de T18. No eliminar una rotación sin autorización explícita si el límite de cuatro ranuras está completo.

**Paso 5: Aplicar y desplegar únicamente en desarrollo**

Tras recibir autorización explícita de ejecución:

```bash
pnpm exec supabase db push --linked
pnpm exec supabase functions deploy exports --use-api
pnpm test:t15:remote
```

No desplegar en producción durante la implementación de T15 salvo que el usuario lo autorice por separado.

Si cualquiera de las bibliotecas supera el límite de recursos de Edge alojado, detenerse y documentar la evidencia. No añadir silenciosamente un worker ni un runtime alternativo.

**Paso 6: Registrar la evidencia**

El documento de verificación debe distinguir:

- contrato implementado;
- pruebas locales superadas;
- migración de desarrollo aplicada;
- Edge Function desplegada;
- generación autenticada remota superada;
- objeto privado confirmado;
- producción sin tocar.

Actualizar el contrato de la API para que solo PDF/XLSX sean artefactos generados por el servidor y la impresión siga siendo una vista nativa del navegador. Actualizar el modelo de dominio con los hashes de versión/configuración, el estado y la referencia de Storage que exige la implementación, manteniendo el concepto existente `ExportArtifact` en lugar de inventar un agregado paralelo.

Solo después de superar todas las comprobaciones de desarrollo podrá el estado convertirse en:

`T15_COMPLETE_REMOTE_PASS`

**Paso 7: Crear el commit final de implementación**

```bash
git add scripts/export-remote-smoke.mjs package.json docs
git commit -m "test(export): record private export validation"
```

---

## Orden de ejecución y condiciones de parada

```text
T15A Tarea 1 → Tarea 2 → Tarea 3 → Tarea 4 → control local de T15A
                                                ↓
T15B Tarea 5 → Tarea 6 → Tarea 7 → Tarea 8 → Tarea 9 → Tarea 10
```

Detenerse y preguntar al usuario si:

- un alimento del generador activo no tiene suficiente información canónica para una regla completa segura;
- el límite confirmado de exportación de V1 únicamente nutricional debe ampliarse a otros módulos;
- el artefacto oficial de SheetJS fijado incumple la política de cadena de suministro;
- una migración requiere eliminar o reescribir payloads de planes existentes;
- Storage no puede seguir siendo privado sin ampliar la exposición de credenciales;
- la rotación de cuatro copias de seguridad está completa;
- el runtime remoto de Edge falla con el fixture máximo tras dos intentos materialmente distintos;
- cualquier paso tocaría producción.

## Definición de terminado

T15 solo está terminado cuando:

1. New plans embed versioned preparation for primaries and both substitutes.
2. Legacy plans remain immutable and readable.
3. Active generator coverage is complete; fallback is tested for future unknowns.
4. Screen and print expose ingredients/preparation without changing nutrition.
5. Compact/full PDF and XLSX reference the same `plan_version_id` and current choices.
6. XLSX sheets, units and formula neutralization pass round-trip tests.
7. Auth/session/membership, idempotency, concurrency and rate-limit tests pass.
8. Browser receives no signed Storage capability.
9. Local full verification passes.
10. Development migration, Edge deployment and remote synthetic smoke pass.
11. Production remains untouched.
