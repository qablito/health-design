# Verificación de la Tarea 11

> **Fecha:** 2026-07-19
> **Estado:** `T11_COMPLETE_LOCAL_PASS`
> **Rama:** `codex/task-11-training-mobility`
> **Alcance:** entrenamiento opcional en modos `none`, `own` y `generated`,
> movilidad modular de 5/10/15 minutos, catálogo de 20 ejercicios con
> ilustraciones SVG secuenciales y superficie web accesible. Es un cierre
> local: no demuestra despliegue ni validación remota, adaptación clínica,
> seguimiento, exportación o conformidad AA final.

## Resultado implementado

- `none` no prescribe sesiones; `own` conserva el entrenamiento declarado y
  adapta de forma acotada el contexto nutricional sin inventar una rutina;
  `generated` crea un bloque determinista de cuatro semanas.
- Las sesiones incluyen calentamiento, bloque principal, vuelta a la calma,
  series, repeticiones o tiempo, descanso, tempo, RPE/RIR, técnica,
  alternativas funcionalmente compatibles cuando existen, progresión, duración
  recalculada y validada desde la dosis y días de carga reducida cuando la
  frecuencia lo requiere. Si falta una alternativa real, se declara y el plan
  queda provisional en lugar de fingir equivalencia.
- Equipo, experiencia, estilo, disponibilidad y limitaciones declaradas
  participan en la selección. El objetivo principal —y los secundarios cuando
  la preferencia de estilo está abierta— concreta el enfoque sin anular un
  estilo explícito. Un dato crítico ausente mantiene el resultado provisional;
  una limitación no modelada conserva el módulo visible, sin prescribir una
  rutina estándar.
- La movilidad ofrece un núcleo breve de cinco minutos y extensiones opcionales
  a 10 o 15 minutos, con zonas y anclajes configurables.
- Los 20 ejercicios publicables tienen un SVG estático secuencial propio,
  alternativa textual, texto accesible, procedencia, licencia y registro de
  revisión técnica independiente ligada por SHA-256 al contenido revisado. No
  se implementaron animaciones ni se afirma certificación clínica o
  biomecánica.
- La interfaz anuncia generación y activación, conserva jerarquía semántica,
  navegación por teclado, foco visible, diseño responsive y una alternativa
  textual cuando un activo no puede cargarse.

## Evidencia reproducida

| Comprobación | Resultado |
|---|---|
| `CI=true pnpm verify` | PASS; 32 archivos/267 pruebas Vitest, 2 archivos/4 pruebas de navegador, contratos Edge, formato, lint, tipos, activos y build |
| `CI=true pnpm test:e2e` | PASS; 17/17 flujos Chromium |
| `CI=true pnpm test:a11y` | PASS; 2/2 pruebas de accesibilidad |
| `pnpm test:db` | PASS; 227 pruebas pgTAP |
| `supabase db lint --local --schema public,private --level warning --fail-on warning` | PASS; cero errores o avisos |
| `supabase db diff --local --schema public,private` | PASS; diff vacío |
| `node scripts/validate-exercise-assets.mjs` | PASS; 20/20 activos |
| `pnpm test:supply-chain` | PASS |
| `pnpm worker:check` | PASS; dry-run de desarrollo y producción, sin desplegar Workers |
| `pnpm audit --audit-level high` | PASS; sin vulnerabilidades conocidas |

T11 no incorpora migraciones: la reconstrucción local no detectó cambios ni
deriva de esquema. Tampoco se desplegaron Edge Functions, Workers, base de
datos o aplicación web, y no se ejecutó validación remota.

## Contratos comprobados

- La elección del usuario entre `none`, `own` y `generated` permanece
  diferenciada; no hay rutina oculta cuando se elige `none` o `own`.
- RPE y RIR se entregan conjuntamente —con explicación específica para bloques
  temporales— y el contrato vuelve a calcular la duración desde dosis, tempo,
  series, descansos y transiciones antes de aceptar una sesión.
- La frecuencia alta introduce sesiones de carga reducida en vez de repetir a
  ciegas el mismo bloque.
- Equipo y nivel producen prescripciones distintas; el objetivo concreta una
  preferencia abierta y los estilos explícitos siguen teniendo prioridad.
- Una limitación reconocida excluye patrones afectados; una limitación no
  reconocida impide prescribir una rutina estándar y mantiene el módulo
  provisional visible. Un dato crítico ausente tampoco permite marcar el
  resultado como completo.
- Nutrición usa los minutos realmente prescritos por el bloque generado; si el
  motor de entrenamiento no puede producir sesiones, no aplica esa carga como
  si existiera.
- El módulo de movilidad mantiene el núcleo de cinco minutos y añade extensiones
  solo cuando el usuario elige 10 o 15 minutos.
- Un fallo de carga del SVG conserva instrucciones y alternativa estática; el
  activo no es requisito para entender la sesión.

## Evidencia científica y visual

La base interna y sus límites de aplicación están documentados en
[`T11_TRAINING_EVIDENCE.md`](../research/T11_TRAINING_EVIDENCE.md). T11 usa:

- las guías de actividad física y comportamiento sedentario de la OMS de 2020
  para mínimos poblacionales y progresión gradual;
- el posicionamiento ACSM de 2026 sobre entrenamiento de fuerza en personas
  adultas sanas para frecuencia, series, esfuerzo y progresión;
- la revisión sistemática y metaanálisis de Ingram et al. de 2025 para informar
  la movilidad breve, sin equiparar sus resultados de estiramiento estático a
  toda la rutina de movilidad.

Estas fuentes respaldan valores iniciales poblacionales, no una adaptación
clínica individual ni la seguridad de cada ejercicio ante enfermedad, lesión,
embarazo, medicación o tratamiento hormonal.

El registro [`TASK_11_ASSET_REVIEW.md`](TASK_11_ASSET_REVIEW.md) y el ledger del
dominio relacionan los 20 ejercicios con sus rutas, `reviewId` y SHA-256. Es una
revisión visual técnica y anatómica simplificada; no es certificación clínica,
biomecánica o médica.

## Revisión de seguridad y accesibilidad

- No se añadieron secretos, dependencias ni llamadas de red al motor puro.
- La selección y validación son deterministas; las incertidumbres no se
  convierten en datos conocidos.
- Las ilustraciones no contienen scripts, recursos externos ni contenido
  ejecutable; su contenido debe coincidir con el hash revisado y el gate forma
  parte de `pnpm verify`.
- La comprobación E2E cubre teclado, foco, anuncios de estado, jerarquía de
  encabezados, responsive, movimiento reducido y degradación visual.
- La puerta AA definitiva pertenece a T19; este recibo acredita las pruebas
  locales de T11, no una certificación global de conformidad.

## Fronteras y trabajo diferido

- **T10.1:** activar el catálogo CIQUAL completo sigue diferido y no bloquea
  T11; entrenamiento y movilidad no dependen de ampliar el núcleo nutricional.
- **T12:** adaptación clínica/farmacológica, hidratación, sueño y suplementos.
- **T13:** seguimiento, candidato revisable y activación; incluye F47 y F48.
- **T15:** PDF, impresión y equivalencia de exportaciones.
- **T19:** gate AA final y validación integral de lanzamiento.

## Referencias

- [`T11_TRAINING_EVIDENCE.md`](../research/T11_TRAINING_EVIDENCE.md)
- [`TASK_11_ASSET_REVIEW.md`](TASK_11_ASSET_REVIEW.md)
- [`exercise-assets.md`](../runbooks/exercise-assets.md)
- [`REQUIREMENTS.md`](../../REQUIREMENTS.md)
- [`ACCEPTANCE_GATES.md`](ACCEPTANCE_GATES.md)
