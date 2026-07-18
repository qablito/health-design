# Verificación de la Tarea 8

> **Fecha:** 2026-07-18
> **Estado:** `T8_COMPLETE_REMOTE_PASS`
> **Alcance:** núcleo decimal, normalización de magnitudes, contrato numérico,
> JSON canónico UTF-8/NFC, SHA-256, reglas obligatorias/condicionales/preferentes,
> salida provisional por módulo y corte remoto cuestionario→plan en desarrollo.
> No demuestra catálogos nutricionales, planes finales, reglas clínicas
> exhaustivas, Luna, interfaz final ni despliegue en producción.

## Resultado implementado

- `@health-design/engine` es puro: no usa red, reloj, almacenamiento ni
  aleatoriedad.
- La aritmética decimal usa coeficiente entero y escala; suma, producto,
  comparación, cierre y redondeo explícito no dependen de coma flotante.
- Las cantidades conservan valor/unidad/base originales, estado de alimento,
  método y estado `known|estimated|missing|conflicting|stale`. `missing` nunca
  se transforma en cero.
- Las conversiones de unidad y denominador están versionadas; estados
  crudo/cocinado y bases incompatibles no se mezclan.
- Los umbrales, intervalos y balance de masa ejecutan
  [`NUMERIC_CONTRACT.md`](../data/NUMERIC_CONTRACT.md), incluido el límite
  estricto: igual al umbral no abre revisión y por encima sí.
- El JSON canónico normaliza Unicode NFC, ordena claves por unidades de código,
  serializa decimales normalizados y rechaza valores, prototipos o colisiones
  de claves no representables.
- `input_hash` cubre contexto, contexto base, cambio, reglas, fuentes y
  versiones. `output_hash` cubre la salida normativa y excluye timestamps y
  explicaciones generativas.
- Las restricciones obligatorias y condicionales se resuelven por conjunción;
  las preferencias solo ordenan opciones permitidas y prevalece el nivel de
  acción más estricto.
- La revisión inicial versionada contiene selección de módulos y
  `trainingMode=none`; cada revisión declara evidencia, fecha, alcance y estado.
- La salida siempre contiene los seis módulos. Los solicitados permanecen
  `provisional` hasta sus tareas funcionales; los no solicitados quedan
  `not_requested`. Entrenamiento desactivado no se prescribe indirectamente.
- Un cambio recalcula solo los módulos afectados y conserva exactamente los
  resultados normativos restantes.
- La completitud del motor se persiste dentro de `validation`; un trigger solo
  puede degradar el snapshot a `provisional`, nunca elevarlo silenciosamente.
- `plans` ejecuta el motor real. Generar crea un borrador y ningún candidato se
  activa automáticamente.

## Evidencia RED → GREEN

| Corte | RED inicial | GREEN final |
|---|---|---|
| Decimal y hash | el paquete y sus funciones no existían | operaciones exactas, vector SHA conocido y paridad Node/Chromium |
| Contrato numérico | no había normalización ni umbrales ejecutables | unidad/base/estado, intervalos, discrepancias, masa y cierre cubiertos |
| Reglas | no existía resolución ejecutable | conjunción, condicional desconocida, preferencia subordinada y acción estricta |
| Pipeline | T7 devolvía `ENGINE_UNAVAILABLE` | seis módulos, hashes, provisionalidad y entrenamiento opcional |
| Candidatos | los módulos no afectados se recalculaban | preservación exacta y recálculo selectivo |
| Persistencia | un snapshot completo podía ocultar motor provisional | trigger de completitud y 41 pruebas pgTAP del ciclo |
| Runtime | Deno no resolvía imports sin extensión | imports `.ts`, bundle remoto y `plans` versión 3 activa |

## Evidencia verde reproducida

| Comprobación | Resultado |
|---|---|
| `pnpm verify` | PASS; 23 archivos/138 pruebas unitarias, 2 archivos/3 pruebas Chromium, contratos Edge, formato, lint, tipos y build |
| `pnpm test:db` | PASS; 198 pruebas pgTAP en 5 archivos, 41 del ciclo de plan |
| `supabase db lint --local --level warning --fail-on warning` | PASS; cero errores/avisos locales |
| `supabase db diff --local --schema public,private` | PASS; `No schema changes found` |
| `pnpm test:e2e` | PASS; 10 flujos Chromium |
| `pnpm test:supply-chain` | PASS |
| `pnpm audit --audit-level high` | PASS; sin vulnerabilidades conocidas |
| `pnpm worker:check` | PASS; dry-run de desarrollo y producción, sin desplegar Workers |
| Runtime local | PASS; Edge Runtime 1.74.1/Deno 2.1.4 cargó `plans`; lectura anónima `401` con headers privados |
| Revisión del diff | PASS; sin hallazgos bloqueantes y `git diff --check` limpio |

El primer `pnpm verify` dentro del sandbox no pudo abrir el puerto efímero de
Vitest Browser (`listen EPERM`). La ejecución autorizada fuera de esa
restricción pasó completa. El primer empaquetado remoto intentó usar Docker y
falló antes de publicar por ausencia de `docker-credential-desktop` en ese
proceso; `supabase functions deploy --use-api`, vía oficial sin Docker, publicó
el mismo grafo de imports correctamente.

## Evidencia remota de desarrollo

| Comprobación | Resultado |
|---|---|
| Copia precrítica | PASS; DMG AES-256 `/Users/pablito/Documents/health-design-private-backups/t8-precritical-development-20260718T195532Z.dmg`, SHA-256 `889ae01f677f47c5c842b3aa3b0e693875fce8b7a311d7da88d57e0530c30030`; clave solo en Llavero, servicio `health-design-dev-t8-precritical-20260718T195532Z` |
| Integridad de copia | schema SHA-256 `2e522cfea82d4f3be891269ff2a51701af293b9a73451b4dd612fe7b02f69447`; data SHA-256 `2f6f331b4fd0a155b2aaf1972b3c687aec7b80381685856a3a3b57e98da2dcb4` |
| Entorno | `health-design-dev` (`nwoivdxdupklervtnovd`), `ACTIVE_HEALTHY`; producción no se enlazó ni recibió cambios |
| Migración | `20260718193402_enforce_engine_completeness.sql` aplicada y presente en el historial remoto |
| Edge Function | `plans` `ACTIVE`, versión 3, `verify_jwt=true`, SHA-256 `ef6d622a2bd393c0f4bbcd992f3a8454a16dcd908e6c36d522383013b23505db` |
| Preview | build de desarrollo publicado en `task-02-environments.health-design.pages.dev`; producción intacta |
| Entrada | cuestionario sintético `complete/submitted`; snapshot y replay devolvieron el mismo identificador |
| Generación | `200`, `draft`, `activeVersionId=null`, `valid/provisional`, seis módulos, hashes de 64 hex y `no-store, private` |
| Entrenamiento opcional | `not_requested`, razón `training_disabled_by_user` |
| Idempotencia | replay de generación devolvió el mismo borrador |
| Activación | operación manual separada: versión inicial `active`, `aggregateVersion=2` |
| Cambio selectivo | `habitualWaterMl` produjo `module_only`, solo `hydration` afectado |
| Candidato | `pending/draft`, plan activo intacto, replay idéntico, cinco módulos preservados exactamente y solo hidratación recalculada |
| Persistencia | dos versiones, candidato sin activar y `aggregateVersion=3` |
| Limpieza | PASS; usuario Auth, actor, sesión, perfil, borrador, snapshots, planes, cambios e idempotencias sintéticos verificados a cero |
| Advisors | sin `ERROR`; avisos preexistentes de acceso anónimo/protección de contraseñas e información de índices quedan registrados para hardening posterior |

## Propiedades comprobadas

- Igual entrada, revisión y configuración producen iguales hashes.
- Cambiar campos volátiles no forma parte de la salida normativa.
- Los valores ausentes siguen ausentes y las incompatibilidades no se
  convierten en una comparación aparentemente válida.
- Una preferencia nunca reabre una opción eliminada por obligación.
- Una condición sin respuesta queda sin resolver y eleva provisionalidad.
- Un formulario completo puede producir un plan provisional cuando el módulo
  funcional todavía no está modelado; ambos estados se conservan sin
  contradicción.
- Crear el plan no lo activa. La activación inicial fue una llamada manual
  separada y el candidato posterior quedó pendiente.
- Cambiar solo hidratación no altera nutrición, entrenamiento, sueño,
  movilidad ni suplementos.

## Revisión de seguridad

- No se añadieron secretos ni dependencias externas.
- El cliente no aporta cálculos, hashes, resultados ni reglas; solo contexto e
  intención de cambio.
- Los resultados se validan con schemas cerrados antes de persistirse.
- La migración usa trigger privado, `search_path=pg_catalog` y no concede
  ejecución a roles públicos.
- La función mantiene JWT, CORS exacto, límites de cuerpo, `If-Match`,
  idempotencia y respuestas `no-store` de T6–T7.
- El token sintético del smoke se usó exclusivamente dentro del navegador con
  autorización expresa, no se imprimió ni se guardó fuera del cliente, y la
  identidad se eliminó al terminar.

## Límite de cierre

- El manifiesto de fuentes del núcleo está vacío deliberadamente hasta T9.
- T8 no calcula calorías, macros, cantidades, menús, hidratación final,
  sesiones, sueño, movilidad, suplementos ni adaptaciones clínicas.
- Las dos reglas iniciales prueban la arquitectura; la cobertura científica y
  clínica pertenece a T9–T13.
- Luna no participa en números, seguridad, reglas, hashes ni activación.
- No se desplegó ninguna migración, función, Worker o build en producción.

## Referencias verificadas

- [Supabase Edge Functions](https://supabase.com/docs/guides/functions)
- [Despliegue de Edge Functions](https://supabase.com/docs/guides/functions/deploy)
- [Deno configuration](https://supabase.com/docs/guides/functions/import-maps)
- [`NUMERIC_CONTRACT.md`](../data/NUMERIC_CONTRACT.md)
- [`DECISION_ENGINE.md`](../architecture/DECISION_ENGINE.md)
- [`ADR-0001`](../adr/0001-deterministic-engine-and-ai-boundary.md)
- [`ADR-0002`](../adr/0002-versioned-plans-and-manual-activation.md)
