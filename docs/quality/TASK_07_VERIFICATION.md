# Verificación de la Tarea 7

> **Fecha:** 2026-07-18
> **Estado:** `T7_COMPLETE_LOCAL_PASS`
> **Alcance:** snapshots de contexto, ciclo inmutable y versionado del plan,
> candidatos revisables, activación manual, concurrencia, contratos y rutas
> Edge. Este recibo no demuestra el motor numérico de T8, una generación
> clínica real ni activación remota.

## Resultado implementado

- `ContextSnapshot` congela las respuestas enviadas, su versión de borrador,
  completitud, normalización, canonicalización e `input_hash`. Un trigger
  impide modificarlo después de crearlo.
- `Plan`, `PlanVersion`, `PlanCandidate`, `ChangeEvent`, `ModuleResult` y
  `SafetyFinding` conservan el historial normativo sin sobrescribir el plan
  activo.
- Los ejes `draft|active|archived` y `complete|provisional` son independientes.
- La primera generación crea únicamente un borrador válido. La activación
  inicial y la sustitución por un candidato válido requieren operaciones
  manuales separadas.
- Un cambio de contexto se compara en servidor y produce campos cambiados,
  módulos afectados e impacto `unaffected|module_only|dependent_modules|structural`.
- Cada versión conserva motor, reglas, manifiesto de fuentes, hashes,
  algoritmo y versión de canonicalización declarada por el motor.
- Los niveles de hallazgo coinciden con el contrato aprobado:
  `information`, `adjustment`, `priority_review` e
  `immediate_conservative`.
- La activación usa `expected_version`, bloqueo transaccional, una restricción
  parcial de versión activa única y transiciones protegidas por triggers.
- Las mutaciones usan claves idempotentes digeridas; las activaciones
  conservan el recibo sin caducidad y el resto expira a las 24 horas.
- Las tablas no se exponen a `anon` ni `authenticated`. `service_role` tiene
  solo lectura directa mínima y ejecuta RPC internas que vuelven a comprobar
  sujeto, sesión vigente y membresía del perfil.
- Las respuestas internas se validan con contratos cerrados. Una forma
  inesperada devuelve `503 DEPENDENCY_UNAVAILABLE`, mientras los conflictos
  de estado conocidos devuelven `409 VERSION_CONFLICT`.
- La Edge Function expone snapshot, generación, historial, detalle, creación
  de candidato, activación y descarte. El motor real permanece deliberadamente
  no disponible hasta T8 y responde `503 ENGINE_UNAVAILABLE`.

## Evidencia RED → GREEN

| Corte | RED inicial | GREEN final |
|---|---|---|
| Dominio | no existían estados ni detector de impacto | 6 pruebas puras |
| Contratos | no existían schemas cerrados de snapshot, versión o candidato | 6 pruebas de contrato |
| Edge | `plans` solo transportaba el cuestionario | 12 pruebas de handler |
| Postgres | no existía ninguna entidad persistente de T7 | 40 pruebas pgTAP nuevas |
| Concurrencia | dos activaciones podían competir sin contrato demostrado | carrera real con `dblink`: un éxito, un `PT409` y un único activo |
| Runtime | las rutas nuevas no habían cargado bajo Deno | función servida y rechazo anónimo estable |

## Evidencia verde reproducida

| Comprobación | Resultado |
|---|---|
| Pruebas T7 | PASS; 24 pruebas: 6 de dominio, 6 de contratos y 12 de Edge |
| `pnpm verify` | PASS; contratos Edge, formato, lint, tipos, 115 unitarias en 20 archivos, 2 de navegador y build de producción |
| `pnpm test:db` | PASS; 197 pruebas pgTAP en 5 archivos, 40 propias de T7 |
| `supabase db lint --local --level warning --fail-on warning` | PASS; cero avisos |
| `supabase db diff --local --schema public,private` | PASS; `No schema changes found` |
| `pnpm test:e2e` | PASS; 10 flujos Chromium, sin regresiones en acceso, SU y cuestionario |
| `pnpm test:supply-chain` | PASS; historial y cadena de suministro válidos |
| `supabase functions serve plans --no-verify-jwt` | PASS; Edge Runtime 1.74.1 cargó `plans` |
| Smoke HTTP local | PASS; lectura anónima `401 UNAUTHENTICATED`, `cache-control: no-store, private`, `referrer-policy: no-referrer` |

El primer intento de `pnpm verify` dentro del sandbox no pudo abrir el puerto
efímero de Vitest Browser (`listen EPERM`). La misma suite se repitió fuera de
esa restricción y terminó íntegramente en verde; no se contabiliza el intento
incompleto como evidencia funcional.

## Propiedades comprobadas

- Repetir la misma creación de snapshot devuelve el mismo recibo; reutilizar
  la clave para otra petición se rechaza.
- Editar el borrador no modifica snapshots ya creados.
- Generar no activa implícitamente y una versión inválida no es activable.
- Un candidato válido archiva el activo anterior y pasa a activo en una única
  transacción.
- Un candidato inválido conserva visible e intacto el plan anterior.
- Dos activaciones con el mismo `expected_version` dejan exactamente una
  versión activa y la perdedora recibe conflicto.
- Una versión no permite cambiar contexto, resultados, hashes, revisiones,
  completitud ni validación después de creada.
- `PlanVersion` conserva la canonicalización del motor, no la copia
  silenciosamente del snapshot.
- El borrado permanente de un perfil puede eliminar snapshots, borrador y
  línea de versiones en cascada sin dejar filas clínicas huérfanas.
- Otro actor sin membresía no puede consultar snapshot, historial ni detalle.
- El cliente no puede introducir resultados del motor en una petición de
  generación o candidato.

## Revisión de seguridad del diff

- No se añadieron dependencias ni secretos.
- RLS está activa en todas las tablas públicas y privadas nuevas.
- No hay grants de tabla para navegador ni ejecución RPC para `anon` o
  `authenticated`.
- Las funciones `security definer` fijan `search_path=pg_catalog`, reciben
  UUID y digests tipados y limitan tamaños/estructuras JSON.
- Las rutas exigen JWT antes de leer datos, `If-Match` en mutaciones
  versionadas, clave idempotente y origen permitido.
- Los cuerpos tienen límites de bytes, profundidad, claves y longitud de
  arrays antes de persistirse.
- Ningún mensaje SQL, respuesta clínica ni bearer se devuelve en el cuerpo de
  error estable.

## Límite de cierre

- T7 implementa la infraestructura del ciclo; no calcula energía, macros,
  hidratación, entrenamiento, restricciones clínicas ni recomendaciones.
- T8 debe aportar serialización canónica UTF-8/NFC, aritmética decimal, hashes
  reproducibles, reglas y salida normativa. Hasta entonces, la dependencia
  real del motor rechaza generar en vez de inventar un plan.
- Los UUID de reglas y manifiestos se conservan, pero sus catálogos y
  revisiones activables corresponden a tareas posteriores.
- No se implementó todavía la interfaz de consulta/activación del plan; la
  experiencia visual final pertenece a T19.
- No se desplegó la migración ni la Edge Function en Supabase remoto. El
  proyecto de producción no se enlazó ni recibió cambios.

## Referencias verificadas

- [Supabase Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [Supabase Edge Functions: quickstart](https://supabase.com/docs/guides/functions/quickstart)
- [Métodos HTTP en Edge Functions](https://supabase.com/docs/guides/functions/http-methods)
- [`ADR-0002`](../adr/0002-versioned-plans-and-manual-activation.md)
- [`API_CONTRACT.md`](../architecture/API_CONTRACT.md)
- [`DECISION_ENGINE.md`](../architecture/DECISION_ENGINE.md)
