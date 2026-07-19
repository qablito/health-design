# Publicación y retirada de ilustraciones de ejercicios

**Propietario:** mantenedor del catálogo de ejercicios T11
**Última revisión:** 2026-07-19
**Último simulacro:** 2026-07-19, entorno local aislado, `PASS` (20/20)

## Objetivo y alcance

Publicar SVG secuenciales originales para los ejercicios disponibles, con
licencia, procedencia, texto alternativo y revisión visual técnica/anatómica
simplificada. También define cómo sustituir o retirar un activo visual sin
romper planes guardados.

Quedan fuera la creación de animaciones, la incorporación de material de
terceros sin licencia verificable y cualquier cambio en la prescripción del
ejercicio. El validador comprueba el contrato técnico; no sustituye la revisión
visual del movimiento. No constituye una certificación clínica, biomecánica ni
médica, y los SVG secuenciales no son animaciones.

## Entorno, roles y precondiciones

- Ejecutar el alta y la validación en una rama o worktree de desarrollo. No se
  editan archivos directamente en producción.
- Se requiere procedencia explícita y un identificador técnico de revisión único
  para cada ejercicio en el catálogo; ese identificador no acredita a una persona
  ni una certificación clínica. La publicación necesita la
  aprobación normal de mantenimiento del repositorio; no usa AAL de la
  aplicación.
- Usar las versiones de Node y pnpm fijadas en `package.json` y las dependencias
  instaladas con el lockfile vigente.
- No se necesitan secretos. No deben incrustarse URLs externas, datos reales,
  scripts, fuentes remotas ni imágenes enlazadas.
- El ejercicio debe existir en
  `packages/domain/src/exercises/index.ts`, conservar un identificador estable y
  disponer de una aprobación explícita independiente en
  `packages/domain/src/exercises/publication-ledger.ts`. El helper del catálogo
  no crea ni autoaprueba registros nuevos.

## Alta o sustitución

1. Crea una ilustración original en
   `apps/web/public/assets/exercises/<exercise-id>.svg`. Si sustituyes un activo
   ya desplegado, usa un nombre nuevo y versionado, por ejemplo
   `<exercise-id>-v2.svg`; no sobrescribas ni borres el anterior.
2. Incluye `role="img"`, un `<title>`, un `<desc>` y dos o tres grupos con
   `data-step="1"`, `data-step="2"` y, si procede, `data-step="3"`.
3. Actualiza `visual.src` y `visual.alt` en el catálogo y crea manualmente su
   entrada en `publication-ledger.ts`. La licencia, procedencia, identificador
   técnico, alcance, fecha y SHA-256 del SVG revisado deben ser explícitos; solo
   puede publicarse con licencia y revisión visual en estado `approved`. El
   validador rechaza altas sin ledger, duplicadas, divergentes o cuyo contenido
   ya no coincida con el hash revisado.
4. Revisa visualmente cada paso al tamaño de uso y confirma:
   postura inicial, dirección del movimiento, articulaciones implicadas,
   apoyos, lateralidad, legibilidad del texto y ausencia de una amplitud que
   contradiga la explicación sencilla.
5. Ejecuta:

   ```bash
   node scripts/validate-exercise-assets.mjs
   CI=true pnpm vitest run tests/exercise-assets.test.ts
   ```

La salida necesaria para continuar es `PASS: N ilustraciones de ejercicios
validadas.` y tres pruebas aprobadas. Cualquier error detiene la publicación.

## Fallo parcial, reanudación y rollback

El validador es de solo lectura e idempotente: puede repetirse después de cada
corrección. Su informe identifica ejercicio, código y ruta afectados; se corrige
solo ese activo y se repite el comando completo.

Para retirar un SVG ya publicado, cambia `visual.src` a un nuevo activo aprobado
y conserva el archivo anterior. Así los clientes con caché y las versiones
históricas no reciben un archivo distinto bajo la misma ruta. Para revertir,
restaura en el catálogo la última ruta aprobada y vuelve a desplegar. Retirar el
ejercicio del generador es un cambio funcional independiente y no se realiza
desde este runbook.

## Validación posterior y evidencia

Tras el despliegue, abre al menos una sesión que use cada activo modificado y
comprueba imagen, texto alternativo y orden de pasos con ancho móvil y de
escritorio. Archiva junto al cambio:

- commit y entorno;
- identificadores y rutas revisadas;
- SHA-256 exacto de cada SVG revisado;
- licencia y procedencia;
- identificador, alcance y fecha de la revisión técnica;
- salida redactada del validador y de la prueba;
- resultado `PASS` o defecto enlazado.

El inventario revisado de T11 queda registrado en
`docs/quality/TASK_11_ASSET_REVIEW.md`.

No se archivan perfiles, respuestas, secretos ni capturas con datos de usuario.
