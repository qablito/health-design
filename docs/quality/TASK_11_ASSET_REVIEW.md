# Registro de revisión de activos de ejercicios T11

**Fecha:** 2026-07-19
**Catálogo canónico:** `packages/domain/src/exercises/index.ts`
**Ledger independiente:** `packages/domain/src/exercises/publication-ledger.ts`
**Resultado:** `PASS` (20/20 activos)

## Alcance

Este registro documenta una revisión visual técnica y anatómica simplificada:
correspondencia entre cada SVG secuencial, el ejercicio identificado y sus pasos
escritos; postura, apoyos y articulaciones visibles; presencia de título,
descripción y secuencia; y ausencia de contenido externo o ejecutable. El
identificador `reviewId` y el SHA-256 del contenido revisado pertenecen al
ledger independiente y no representan a una persona ni una certificación
profesional.

La revisión no es una certificación clínica, biomecánica ni médica. Los activos
son ilustraciones SVG estáticas secuenciales, no animaciones, y no sustituyen una
demostración supervisada cuando el contexto del usuario la requiera.

## Activos revisados

| Ejercicio | Ruta SVG | `reviewId` canónico | Estado |
|---|---|---|---|
| Marcha en el sitio (`march-in-place`) | `apps/web/public/assets/exercises/march-in-place.svg` | `t11-anatomy-march-in-place-20260719` | PASS |
| Paso lateral (`lateral-step`) | `apps/web/public/assets/exercises/lateral-step.svg` | `t11-anatomy-lateral-step-20260719` | PASS |
| Círculos de hombros (`shoulder-circles`) | `apps/web/public/assets/exercises/shoulder-circles.svg` | `t11-anatomy-shoulder-circles-20260719` | PASS |
| Sentadilla con peso corporal (`bodyweight-squat`) | `apps/web/public/assets/exercises/bodyweight-squat.svg` | `t11-anatomy-bodyweight-squat-20260719` | PASS |
| Sentadilla asistida a silla (`supported-squat`) | `apps/web/public/assets/exercises/supported-squat.svg` | `t11-anatomy-supported-squat-20260719` | PASS |
| Flexión inclinada (`incline-push-up`) | `apps/web/public/assets/exercises/incline-push-up.svg` | `t11-anatomy-incline-push-up-20260719` | PASS |
| Flexión en pared (`wall-push-up`) | `apps/web/public/assets/exercises/wall-push-up.svg` | `t11-anatomy-wall-push-up-20260719` | PASS |
| Bisagra de cadera (`hip-hinge`) | `apps/web/public/assets/exercises/hip-hinge.svg` | `t11-anatomy-hip-hinge-20260719` | PASS |
| Puente de glúteos (`glute-bridge`) | `apps/web/public/assets/exercises/glute-bridge.svg` | `t11-anatomy-glute-bridge-20260719` | PASS |
| Dead bug (`dead-bug`) | `apps/web/public/assets/exercises/dead-bug.svg` | `t11-anatomy-dead-bug-20260719` | PASS |
| Asentimiento cervical (`neck-nod`) | `apps/web/public/assets/exercises/neck-nod.svg` | `t11-anatomy-neck-nod-20260719` | PASS |
| Gato-vaca (`cat-cow`) | `apps/web/public/assets/exercises/cat-cow.svg` | `t11-anatomy-cat-cow-20260719` | PASS |
| Rotación torácica (`thoracic-rotation`) | `apps/web/public/assets/exercises/thoracic-rotation.svg` | `t11-anatomy-thoracic-rotation-20260719` | PASS |
| Transición de cadera 90/90 (`hip-90-90`) | `apps/web/public/assets/exercises/hip-90-90.svg` | `t11-anatomy-hip-90-90-20260719` | PASS |
| Extensión de rodilla sentado (`knee-extension`) | `apps/web/public/assets/exercises/knee-extension.svg` | `t11-anatomy-knee-extension-20260719` | PASS |
| Balanceo de tobillo (`ankle-rock`) | `apps/web/public/assets/exercises/ankle-rock.svg` | `t11-anatomy-ankle-rock-20260719` | PASS |
| Sentadilla goblet con mancuerna (`dumbbell-goblet-squat`) | `apps/web/public/assets/exercises/dumbbell-goblet-squat.svg` | `t11-anatomy-dumbbell-goblet-squat-20260719` | PASS |
| Remo con banda elástica (`resistance-band-row`) | `apps/web/public/assets/exercises/resistance-band-row.svg` | `t11-anatomy-resistance-band-row-20260719` | PASS |
| Remo con mancuerna (`dumbbell-row`) | `apps/web/public/assets/exercises/dumbbell-row.svg` | `t11-anatomy-dumbbell-row-20260719` | PASS |
| Press de suelo con mancuernas (`dumbbell-floor-press`) | `apps/web/public/assets/exercises/dumbbell-floor-press.svg` | `t11-anatomy-dumbbell-floor-press-20260719` | PASS |

## Criterio de cierre

Los 20 identificadores, rutas y `reviewId` anteriores coinciden con el catálogo
canónico y con el ledger; cada ruta existe, su SHA-256 coincide con el activo
revisado y supera `node scripts/validate-exercise-assets.mjs`. Cualquier
modificación posterior de un SVG o de sus instrucciones requiere un nuevo
`reviewId`, un nuevo hash, una nueva revisión y una actualización de este
registro.
