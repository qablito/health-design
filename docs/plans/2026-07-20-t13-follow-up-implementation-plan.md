# T13 — Seguimiento, impacto y recálculo selectivo

> **Para Codex:** usar `executing-plans`, `supabase` y pruebas primero para
> ejecutar este plan por bloques.

**Objetivo:** implementar la revisión semanal mínima, el diario opcional, el
historial manual de analíticas y la creación de candidatos únicamente cuando
un cambio material afecta al plan.

**Arquitectura:** T13 añade observaciones inmutables y un flujo web sobre el
ciclo de vida ya existente. Reutiliza `detectContextChange`, el recálculo
selectivo de `runDeterministicEngine`, `change_events`, `plan_candidates` y la
activación manual; el plan activo nunca se modifica. La vigencia y las
tendencias son deterministas, no diagnósticas y solo usan reglas documentadas.

**Stack:** React, TypeScript, Zod, Vitest, Playwright, Supabase Edge Functions,
Postgres 17, RLS y pgTAP.

---

## Contrato cerrado

- La revisión semanal dura aproximadamente 2–3 minutos y solo muestra módulos
  activos.
- Campos comunes: adherencia, cambios relevantes y síntomas importantes.
- Alimentación: adherencia, hambre/saciedad y ansiedad alimentaria.
- Entrenamiento: sesiones, esfuerzo/fatiga, dolor y cambio de volumen.
- Hidratación: consumo medio y problemas percibidos.
- Sueño: horas, calidad y regularidad; fases opcionales.
- Movilidad: cumplimiento y molestias.
- Suplementación: inicio/suspensión, beneficio y efectos adversos.
- El diario reutiliza estas métricas y es completamente opcional.
- Un ajuste menor de entrenamiento puede recomendar hasta ±10 % para la
  siguiente sesión, sin mutar el plan activo; dolor, síntomas o cambios
  estructurales impiden el ajuste automático.
- La revisión de cuatro semanas sin cambios materiales se registra sin crear
  un candidato idéntico.
- La vigencia analítica es específica por analito y contexto. Sin regla curada,
  la confianza queda `unknown`/provisional y no se inventa un plazo.

## Tarea 1 — Contratos y lógica pura

**Archivos:**

- Crear `packages/contracts/src/follow-up.ts`.
- Modificar `packages/contracts/src/index.ts`.
- Crear `packages/engine/src/impact/index.ts`.
- Modificar `packages/engine/src/index.ts`.
- Modificar `packages/engine/src/modules/supplements/index.ts` para reutilizar
  normalización de analitos y unidades.
- Crear `tests/follow-up-contracts.test.ts` y `tests/follow-up-impact.test.ts`.

**Pasos:**

1. Escribir pruebas que rechacen módulos inactivos, datos diarios obligatorios,
   unidades incompatibles y ajustes superiores al 10 %.
2. Definir contratos estrictos para revisión, analítica, historial, tendencia,
   vigencia, impacto y resultado.
3. Implementar tendencia `up|down|stable|insufficient` solo entre dos valores
   comparables; no emitir predicción.
4. Implementar vigencia desde un catálogo curado y devolver `unknown` cuando no
   exista regla aplicable.
5. Ejecutar `pnpm test -- follow-up-contracts follow-up-impact`.

## Tarea 2 — Persistencia, RLS e idempotencia

**Archivos:**

- Crear una migración mediante `pnpm exec supabase migration new follow_up`.
- Crear `supabase/tests/database/follow_up_test.sql`.

**Pasos:**

1. Escribir pgTAP para aislamiento entre perfiles, inmutabilidad, historial,
   orden temporal, límites de payload e idempotencia.
2. Crear `follow_up_entries` y `lab_observations` con fecha, unidad, rango,
   origen, completitud y referencias al perfil/plan base.
3. Activar RLS, revocar acceso público y conceder únicamente lo necesario a
   `service_role`, conforme al contrato actual de Data API.
4. Añadir RPC internas autenticadas para registrar y listar entradas.
5. Ejecutar `pnpm test:db` y los asesores de base de datos disponibles.

## Tarea 3 — Edge Function y recálculo selectivo

**Archivos:**

- Crear `supabase/functions/plans/follow-up.ts`.
- Modificar `supabase/functions/plans/lifecycle.ts` e `index.ts`.
- Crear `tests/follow-up-edge.test.ts`.

**Pasos:**

1. Escribir pruebas para `GET/POST /v1/profiles/{id}/labs` y
   `GET/POST /v1/profiles/{id}/follow-ups`.
2. Reutilizar autenticación, límites, CORS, `no-store`, idempotencia y errores
   del endpoint `plans`.
3. Registrar siempre la observación válida, aun si el resto del plan permanece
   estable.
4. Para laboratorio fuera del rango aportado o solicitud explícita de
   recálculo, crear un contexto derivado y ejecutar solo módulos afectados.
5. Crear candidato/diff con el lifecycle actual y mantener el activo intacto.
6. Devolver revisión, tendencias, vigencia, impacto y candidato opcional.
7. Regenerar y verificar el contrato Edge.

## Tarea 4 — Experiencia web

**Archivos:**

- Crear `apps/web/src/features/follow-up/FollowUpApp.tsx`.
- Crear `apps/web/src/features/follow-up/follow-up-client.ts`.
- Crear `apps/web/src/features/follow-up/follow-up.css`.
- Modificar `apps/web/src/main.tsx`.
- Crear `tests/follow-up-client.test.ts` y
  `tests/e2e/follow-up.spec.ts`.

**Pasos:**

1. Escribir pruebas del cliente y E2E para módulos activos, omisión diaria,
   errores, historial y candidato manual.
2. Crear `/follow-up` con progreso, guardado explícito y controles accesibles;
   evitar texto libre salvo donde el contrato lo requiera.
3. Mostrar revisión semanal, diario opcional y formulario de 1–4 analíticas.
4. Mostrar tendencias como descripción básica, confianza y antigüedad, nunca
   como diagnóstico o predicción.
5. Mostrar el diff y ofrecer activar/descartar solo si existe candidato válido.

## Tarea 5 — Barrera local y evidencia remota de desarrollo

**Archivos:**

- Crear `docs/quality/TASK_13_VERIFICATION.md`.
- Actualizar `README.md`, `docs/quality/TRACEABILITY.md` y el encabezado de T13
  en `docs/plans/2026-07-16-v1-implementation-plan.md`.

**Pasos:**

1. Ejecutar `pnpm verify`, `pnpm test:db`, `pnpm test:e2e -- follow-up.spec.ts`
   y `pnpm worker:check`.
2. Revisar el diff y ejecutar la revisión de seguridad/arquitectura aplicable.
3. Crear y verificar una copia cifrada precrítica de desarrollo.
4. Aplicar migración y desplegar únicamente `plans` en desarrollo.
5. Validar con un perfil invitado real: semanal, diario omitido, analítica,
   tendencia, candidato, activación/descartado y aislamiento.
6. Mantener producción sin cambios.
7. Registrar hashes, versiones y resultado final
   `T13_COMPLETE_REMOTE_PASS` solo si toda la evidencia pasa.

## Fuera de T13

- Sin sincronización con wearables, OCR, predicciones ni diagnóstico.
- Sin notificaciones del sistema operativo.
- Sin PDF/XLSX, Luna ni automatización de compra.
- Sin motor de candidatos alternativo ni activación automática.
- Sin reglas genéricas de vigencia para analitos no modelados.
