# Verificación de la Tarea 6

> **Fecha:** 2026-07-18
> **Estado:** `T6_COMPLETE_LOCAL_PASS`
> **Alcance:** schema canónico V1, wizard adaptativo, borrador remoto, ramas,
> provisionalidad y ausencia de persistencia clínica local. Este recibo no
> demuestra despliegue remoto ni generación de planes.

## Resultado implementado

- Schema V1 cerrado y compartido entre dominio, contratos, navegador y Edge.
- Wizard `/questionnaire` por secciones, con progreso, tiempo restante,
  selector de perfil, resumen editable y estado completo/provisional.
- Objetivo principal, hasta dos secundarios y peso objetivo condicionado para
  pérdida de grasa o aumento de masa.
- Los seis módulos son opcionales individualmente; se exige al menos uno al
  confirmar. Entrenamiento admite generado, propio o ninguno.
- Ramas fisiológicas, clínicas, farmacológicas, alimentarias, de entrenamiento,
  hidratación, sueño, movilidad, suplementación y analíticas.
- Buscadores con sugerencias y entrada breve libre para términos ausentes;
  alergias con contaminación cruzada, intolerancias con tolerancia/gravedad y
  medicación con detalles opcionales conocidos.
- Supermercado habitual opcional con sugerencias/entrada libre, preferencia
  separada para comparar precios y fuente opcional de analíticas manuales.
- Un único borrador remoto por perfil, sincronizable entre dispositivos, con
  versión optimista, idempotencia de 24 horas y reanudación del último bloque
  confirmado.
- Respuestas críticas ausentes conservadas como incertidumbres estructuradas;
  solo los conflictos estructurales impiden enviar.
- Tabla con RLS, sin grants de navegador y RPC internas ejecutables únicamente
  por `service_role` después de verificar sesión y membresía.
- Edge `plans` con JWT, CORS exacto, `no-store`, límites previos al parseo y
  respuestas de error sin body clínico.
- Service worker limitado a assets públicos inmutables `/assets/`, sin cachear
  documentos, API ni respuestas de usuario, y con limpieza de caches
  controladas en logout y revocación.

## Evidencia RED → GREEN

| Corte | RED observado | GREEN final |
| --- | --- | --- |
| Dominio | no existían módulos, ramas, criticidad ni peso objetivo | 9 pruebas puras |
| Contratos | no existían límites, schema público ni sugerencias | 7 pruebas de contrato |
| Edge | no existían rutas, límites ni provisionalidad | 6 pruebas de handler |
| Cliente | el primer E2E detectó `Window.fetch: Illegal invocation` | llamada independiente protegida por 3 pruebas de cliente |
| Cache local | no existía política de service worker | 2 pruebas de allowlist de assets y prefijo borrable |
| Postgres | no existía borrador versionado por perfil | 14 pruebas pgTAP nuevas, incluida carrera real |
| Navegador | no existía `/questionnaire` | 4 E2E de reanudación, aislamiento de edición, offline, teclado y móvil |

## Evidencia verde reproducida

| Comprobación | Resultado |
| --- | --- |
| Rama aislada | `codex/task-06-adaptive-questionnaire` sobre `dc6b943` |
| `pnpm verify` | PASS; Edge generado, formato, lint, tipos, 91 unitarias, 2 de navegador y build |
| `pnpm test:e2e` | PASS; 10 flujos Chromium combinados, 4 propios de T6 |
| `pnpm test:a11y` | PASS; primer paso con teclado, nombres accesibles y 360 px sin overflow |
| `pnpm test:db` | PASS; 157 pruebas pgTAP combinadas, 14 nuevas de T6 |
| `supabase db lint --local --level warning --fail-on warning` | PASS; cero avisos |
| `supabase functions serve plans` | PASS; runtime Edge 1.74.1 levantó `plans` junto al stack local |
| `pnpm worker:check` | PASS; dry-run de desarrollo y producción |
| `pnpm test:supply-chain` | PASS |
| `pnpm audit --audit-level high` | PASS; sin vulnerabilidades conocidas |

## Propiedades comprobadas

- Cero módulos puede guardarse como borrador, pero no confirmarse.
- Ausencia de entrenamiento oculta todas las preguntas de rutina generada.
- Condición o medicación solo abre su detalle cuando se declara.
- Un objetivo de pérdida/ganancia abre el peso objetivo; omitirlo conserva una
  incertidumbre en vez de inventarlo.
- Cerrar y reabrir recupera respuestas y bloque confirmados desde la API.
- Un fallo de red conserva el cambio únicamente en memoria; recargar recupera
  la versión remota sin duplicados.
- Confirmar otra sección no arrastra una edición todavía no confirmada; las
  escrituras iniciales concurrentes terminan en un éxito y un conflicto de
  versión, nunca en una colisión de unicidad.
- El resumen vuelve al bloque elegido sin borrar el resto.
- El canario clínico E2E no aparece en almacenamiento local, IndexedDB, Cache
  API ni URL.
- Payload sobre profundidad, array, grafemas o bytes se rechaza antes de una
  escritura parcial.
- Otro actor sin membresía no puede leer el borrador y una versión obsoleta no
  lo sobrescribe.

## Límite de cierre

- T6 no crea `ContextSnapshot`, `Plan`, `PlanVersion` ni candidato; corresponde
  a T7 y tareas posteriores.
- No se ha desplegado la migración ni la Edge Function `plans` en desarrollo o
  producción. La evidencia remota requerirá una activación solicitada aparte.
- Las sugerencias farmacológicas son ayuda de entrada, no el catálogo AEMPS ni
  un verificador exhaustivo. La cobertura curada comienza en T12.
- El diseño visual definitivo, auditoría AA completa con tecnologías de apoyo
  y pruebas visuales multidispositivo corresponden a T19. T6 aporta una puerta
  accesible básica, no reclama conformidad final del producto.
- El borrado permanente aún no existe; T18 debe invocar la primitiva ya creada
  para limpiar caches controladas.

## Referencias verificadas

- [Supabase Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [Autenticación de Edge Functions](https://supabase.com/docs/guides/functions/auth)
- [Cabeceras de autorización en Edge Functions](https://supabase.com/docs/guides/functions/auth-legacy-jwt)
