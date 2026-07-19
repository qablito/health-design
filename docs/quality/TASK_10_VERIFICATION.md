# Verificación de la Tarea 10

> **Fecha:** 2026-07-19
> **Estado:** `T10_COMPLETE_REMOTE_PASS`
> **Rama:** `codex/task-10-nutrition`
> **Alcance:** cuestionario nutricional V2, objetivos deterministas, semana de
> 2–6 comidas, dos sustitutos por alimento, recálculo completo, lector de
> revisiones efectivas y núcleo curado oficial CIQUAL 2025. No demuestra reglas
> clínicas/farmacológicas de T12, productos GTIN de T16, supermercados/precios
> de T17 ni despliegue en producción.

## Resultado implementado

- El cuestionario recoge patrón alimentario, 2–6 comidas, modo simple o
  equilibrado, anclajes horarios, alergia y contaminación cruzada,
  intolerancia con gravedad y cantidad tolerada, preferencias, exclusiones,
  ansiedad alimentaria y elección explícita de proteína en polvo.
- La calorimetría indirecta es opcional y fechada. Si faltan anclajes o el
  contexto no permite cerrar el cálculo, el plan queda provisional y explica
  la incertidumbre; no inventa datos.
- El motor calcula banda energética y objetivo central recalculable, proteína
  adaptativa, 30 % central de grasa, carbohidrato residual y fibra con mínimo
  de 25 g y objetivo central de 14 g/1.000 kcal subordinado a tolerancia.
- La salida es una semana estable de siete días. Cada alimento incluye cantidad
  cruda/de referencia, kcal, macros, fibra y nutrientes clínicos disponibles.
- Cada alimento individual expone exactamente dos sustitutos compatibles con
  su función nutricional, patrón, alérgenos, contaminación cruzada e
  intolerancias. Sustituir recalcula alimento, comida, día, semana y lista
  canónica.
- Los modos simple y equilibrado producen semanas diferentes y válidas. La
  proteína en polvo nunca aparece sin elección explícita.
- El motor es determinista y consume únicamente revisiones efectivas; una
  importación en cuarentena no altera ningún plan.

## CIQUAL 2025 oficial

| Propiedad | Evidencia |
|---|---|
| Fuente | DOI `10.57745/RPWYZD`, versión 2025, licencia aprobada |
| Artefacto | XLSX oficial, 1.541.998 bytes, 3.484 alimentos y 84 columnas |
| MD5 | `0d9758ce23f3f13dd63a005bc1bb4f2c` |
| SHA-256 bruto | `5555c572fa3735991298d832d0427788fa69a11b4fd20a5d580d58942369fbb0` |
| SHA-256 normalizado | `ae832168cce3b5d0a7f7e8292c4c01844c69add4ec76b1abc2cc6afe2ff3c16d` |
| Núcleo activo | 24 alimentos curados; no se afirma activación del catálogo completo |
| Preflight | 12 planes válidos: omnívoro, pescetariano, vegetariano y vegano × 2, 4 y 6 comidas |

El adaptador verifica tamaño y ambos digests antes de interpretar el XLSX.
Valida hoja, cabeceras, límites de archivo/filas/columnas/celda/descompresión y
solo activa los cinco valores obligatorios cuando son exactos y conocidos.

## Evidencia local reproducida

| Comprobación | Resultado |
|---|---|
| `CI=true pnpm verify` | PASS; 29 archivos/189 pruebas, 2 archivos/4 pruebas Chromium, contratos Edge, formato, lint, tipos y build |
| `CI=true pnpm test:e2e` | PASS; 11 flujos Chromium |
| `pnpm test:db` | PASS; 227 pruebas pgTAP en 6 archivos |
| `supabase db lint --local --schema public,private --level warning --fail-on warning` | PASS; cero errores o avisos |
| `supabase db diff --local --schema public,private` | PASS; reconstrucción completa sin deriva de esquema |
| `pnpm catalog:activate:ciqual -- --preflight` | PASS; `T10_CIQUAL_CORE_PREFLIGHT_PASS`, 24 alimentos y 12 planes |
| `pnpm test:supply-chain` | PASS |
| `pnpm audit --audit-level high` | PASS; sin vulnerabilidades conocidas |
| `pnpm worker:check` | PASS; dry-run de desarrollo y producción, sin desplegar Workers |

La activación remota descubrió una incompatibilidad real heredada de T9:
Postgres declaraba sodio en `g`, mientras CIQUAL, el contrato clínico y el
lector T10 usan `mg`. La migración `20260719143300_nutrition_sodium_mg.sql`
convierte cualquier observación normalizada previa, fija `mg` como unidad
canónica y deja una aserción pgTAP permanente.

## Evidencia remota de desarrollo

| Comprobación | Resultado |
|---|---|
| Copia precrítica | DMG AES-256 `/Users/pablito/Documents/health-design-private-backups/t10-precritical-development-20260719T131351Z.dmg`; verificada al crearla y SHA-256 actual `b63a32012e501bf311949f9de119b2ff0ac9e4188f38dbcf80f144be9b93bc8f` |
| Entorno | `health-design-dev` (`nwoivdxdupklervtnovd`); producción no fue modificada |
| Migraciones | `20260719143000`–`20260719143300` presentes en el historial remoto |
| Edge Function | `plans` `ACTIVE`, versión 5, `verify_jwt=true`, SHA-256 `e114f2082a9049bf448cdbb91d119ff35271d617dc230fb9102eab97e1df7db9` |
| Runtime Edge | petición sin sesión alcanzó la función y fue rechazada con `401/UNAUTHENTICATED` |
| Catálogo | `catalogs` permanece `ACTIVE`, versión 1 y `verify_jwt=true` |
| Activación | `T10_CIQUAL_CORE_REMOTE_PASS`: 24 revisiones activadas, 24 alimentos legibles y 12 planes preflight |
| Persistencia | manifiesto `validated`, 24/24 revisiones `validated` y 24/24 revisiones efectivas activas |
| Valores obligatorios | 120 observaciones exactas conocidas; 0 `trace`, `less_than`, `missing`, `estimated`, `stale` o `conflicting` activadas como obligatorias |
| Unidad clínica | sodio canónico `mg` en base de datos, importador, contrato y lector Edge |
| Advisor de seguridad | sin hallazgos `ERROR`; permanecen avisos preexistentes sobre acceso anónimo y protección de contraseñas, además de INFO por tablas deliberadamente sin políticas públicas |
| Advisor de rendimiento | no evaluado: el conector remoto devolvió HTTP 451; no se afirma `PASS` |

## Propiedades comprobadas

- Dos sustitutos existen para cada alimento y conservan la función nutricional.
- Alergia y contaminación cruzada excluyen; intolerancia limita o excluye;
  gusto solo ordena preferencias.
- El cambio de una opción recalcula todos los agregados sin modificar la
  revisión nutricional de origen.
- Crudo/cocinado, base y parte comestible permanecen explícitos.
- Un valor ausente nunca se interpreta como cero.
- El catálogo oficial solo se vuelve consumible después de validación y
  activación manual AAL2.
- La semana base no se regenera sola y el entrenamiento sigue siendo opcional.

## Revisión de seguridad

- No se añadieron secretos al repositorio ni se imprimieron contraseña, claves
  privadas o secreto TOTP.
- El script de activación acepta únicamente la URL exacta de desarrollo,
  requiere superadministrador AAL2 y usa idempotencia por mutación.
- El artefacto oficial y el lote generado permanecen fuera de Git.
- Las tablas nutricionales mantienen RLS y las mutaciones siguen encapsuladas
  en funciones SQL privadas y Edge Functions con JWT.
- Producción `rbfrpgafytexrarcfmmp` quedó intacta.

## Límite de cierre

- La selección visual de sustituciones funciona y recalcula la previsualización;
  persistir el cambio como candidato inmutable y activarlo pertenece a T13.
- T12 añadirá reconciliación clínica, farmacológica, hidratación, sueño y
  suplementación; T10 no afirma esa cobertura.
- T16 añadirá productos comerciales, escaneo GTIN y correcciones compartidas.
- T17 añadirá supermercados, envases, disponibilidad y precios.
- Los 24 alimentos son el núcleo generador curado, no el catálogo CIQUAL
  completo ni una promesa de cobertura universal.

## Referencias

- [`nutrition-import.md`](../runbooks/nutrition-import.md)
- [`TASK_09_VERIFICATION.md`](TASK_09_VERIFICATION.md)
- [`NUMERIC_CONTRACT.md`](../data/NUMERIC_CONTRACT.md)
- [`DATA_GOVERNANCE.md`](../data/DATA_GOVERNANCE.md)
- [`ADR-0001`](../adr/0001-deterministic-engine-and-ai-boundary.md)
- [`ADR-0004`](../adr/0004-federated-nutrition-data-with-provenance.md)
