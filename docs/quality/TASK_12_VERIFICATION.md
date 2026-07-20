# Verificación de la Tarea 12

> **Fecha:** 2026-07-20
> **Estado:** `T12_COMPLETE_REMOTE_PASS`
> **Rama:** `codex/task-12-contextual-wellness`
> **Entorno remoto validado:** `health-design-dev`
> (`nwoivdxdupklervtnovd`)
> **Alcance:** hidratación, sueño, suplementación y contexto
> clínico/farmacológico selectivo; identidad de medicamentos AEMPS/CIMA;
> catálogo clínico versionado; experiencia web integrada y restauración del
> plan actual por perfil. Producción no fue modificada.

## Resultado implementado

- El motor determinista reconcilia hidratación, sueño, suplementos,
  alimentación, entrenamiento y movilidad dentro del espacio seguro resultante.
  Mantiene separados el agua total y la bebida propuesta; no suma a ciegas
  calor, sudor, ejercicio, restricciones de líquidos o farmacología.
- El contexto clínico usa niveles `modeled`, `partial` y `unmodeled`. Una regla
  parcial, un dato crítico ausente o una identidad farmacológica sin cobertura
  suficiente conserva el módulo visible y vuelve provisional el plan; no
  presenta cobertura falsa.
- El uso declarado de sustancias anabólicas solo condiciona el contexto. No se
  recomienda, pauta, ajusta ni optimiza su uso recreativo.
- La ausencia de datos diarios de sueño no bloquea el plan; T12 ofrece anclajes
  flexibles y evita predicciones diagnósticas. El diario y las notificaciones
  del sistema operativo siguen fuera de T12.
- Cada propuesta de suplementación expone evidencia, confianza, riesgos,
  interacción, métrica y condición de salida. Las opciones experimentales se
  separan y muestran menor confianza; la proteína en polvo continúa siendo una
  elección explícita del usuario.
- Los laboratorios de T12 son contexto puntual: B12, folato, magnesio,
  creatinina y eGFR solo participan cuando existen. Fechas, vigencia, historial,
  tendencias y recálculo selectivo pertenecen a T13.
- El cuestionario ofrece búsqueda controlada de medicamentos mediante la API
  oficial AEMPS/CIMA y conserva una caché privada de identidad canónica. Dosis,
  frecuencia, vía y horario solo intervienen cuando una regla documentada los
  necesita.
- La aplicación restaura el plan actual por perfil. Prefiere la versión activa
  frente a borradores más recientes y falla cerrado si el 404 corresponde al
  detalle de una versión, no al descubrimiento del plan.
- El catálogo clínico conserva descriptor y hash; cualquier cambio posterior
  exige activación manual. La base de datos persiste la completitud efectiva:
  cualquier provisionalidad del contexto o del motor prevalece.

## Evidencia local reproducida

| Comprobación | Resultado |
|---|---|
| `CI=true pnpm verify` | PASS; 42 archivos/417 pruebas Vitest, 2 archivos/4 pruebas de navegador, formato, lint, tipos, contratos Edge y build |
| `CI=true pnpm test:e2e` | PASS; 25/25 flujos Chromium |
| `pnpm test:db` | PASS; 8 archivos/261 pruebas pgTAP |
| `supabase db lint --local --schema public,private --level warning --fail-on warning` | PASS; cero errores o avisos |
| `supabase db diff --local --schema public,private` | PASS; diff vacío |
| `pnpm test:supply-chain` | PASS |
| `pnpm worker:check` | PASS; dry-run de desarrollo y producción, sin desplegar Workers |
| `pnpm audit --prod --audit-level=high` | PASS; sin vulnerabilidades conocidas |
| revisión independiente final | PASS doble; restauración por perfil, prioridad activa, activación manual y discriminación de 404 confirmadas |

El build conserva únicamente los avisos ya conocidos de importación dinámica y
un chunk superior a 500 kB; no son fallos de T12.

## Copia precrítica

| Propiedad | Evidencia |
|---|---|
| Objeto | `/Users/pablito/Documents/health-design-private-backups/t12-precritical-development-20260719T201755Z.dmg` |
| Cifrado | AES-256; clave únicamente en el Llavero de macOS, servicio `health-design-dev-t12-precritical-20260719T201755Z` |
| SHA-256 | `066e5910d32f74da017aa1ed5d54c0b8cd3f93347457ef23e98a28baf3245c48` |
| Verificación | PASS con `hdiutil verify`; checksum interno válido |
| Alcance | esquema y datos de desarrollo previos al cambio crítico; producción no fue consultada ni copiada |

Existen cinco DMG precríticos (`T7`, `T8`, `T9`, `T10` y `T12`). La rotación
contractual es de cuatro, pero no se eliminó `T7` porque esa eliminación
permanente requiere confirmación explícita del usuario. Este mantenimiento no
afecta al código, al despliegue ni a la reversibilidad de T12.

## Despliegue remoto de desarrollo

Las siguientes migraciones se aplicaron, en este orden, solo en desarrollo:

1. `20260719193820_clinical_rule_catalog`
2. `20260719223120_persist_effective_plan_completeness`
3. `20260720004000_profile_current_plan_lookup`

Después del despliegue, `supabase db push --linked --dry-run` informó
`Remote database is up to date`.

| Edge Function | Versión | JWT | SHA-256 remoto |
|---|---:|---|---|
| `plans` | 6 | obligatorio | `eead3d20ab7d80d5ef718c668bb43675f765e21abca2054a45efd09b61d2c7ec` |
| `catalogs` | 2 | obligatorio | `50bdd6384d56f175842b5fbabd0a34b4aa4ddd9a601faaaf152801e19b71e503` |
| `medications` | 1 | obligatorio | `2aacde965dcc293807d21ae9ff710fb2b82981346c87f88ead1903c8e9229c3a` |

Las tres funciones figuran `ACTIVE`. El despliegue usó el empaquetado remoto
oficial de Supabase porque las funciones importan paquetes del monorepo.

## Validación remota de desarrollo

| Contrato | Resultado |
|---|---|
| catálogo clínico activo | PASS; revisión bootstrap `validated`, versión `clinical-selective-v2`, canonicalización `canonical-json-v1`, SHA-256 `af2fb4b04376b25e6054e0c12bc9df144a5ee8a0df585813c871f9505530752e` y una sola activación vigente |
| permisos y RLS | PASS; tablas clínicas con RLS; `anon` y `authenticated` no ejecutan wrappers internos; solo `service_role` puede hacerlo |
| reglas ejecutables | PASS; el descriptor no almacena columnas JSON/JSONB ni expresiones ejecutables |
| autorización administrativa | PASS; AAL1 rechazado por la ruta clínica con `403/AAL2_REQUIRED`; no se cambió el catálogo activo |
| AEMPS/CIMA | PASS; búsqueda autenticada real de `metformina`, respuesta `200`, tres resultados y fuente `AEMPS_CIMA` |
| validación de entrada AEMPS/CIMA | PASS; consulta demasiado corta rechazada con `400/INVALID_INPUT`; sin autenticación, `401/UNAUTHENTICATED` |
| caché farmacológica | PASS; tres identidades, nombres no vacíos, versión `CIMA_REST_API_1_23` y hashes de 32 bytes |
| descubrimiento de plan | PASS; sin JWT devuelve `401`; con sesión y acceso temporales válidos, un perfil sin plan devuelve `404/NOT_FOUND` y cabecera `no-store, private` |
| limpieza de fixture de acceso | PASS; cero sesiones `T12 remote smoke`, cero accesos activos temporales y cero planes/versiones residuales |
| completitud efectiva | PASS en transacción revertida; contexto provisional + motor completo persiste `provisional` |
| fallo cerrado de completitud | PASS en transacción revertida; ausencia de completitud del motor rechazada con SQLSTATE `23514` y `invalid_engine_completeness` |

No se solicitó un TOTP para mutar el catálogo: la prueba remota verificó el
rechazo AAL1 y el descriptor activo, mientras que la ruta AAL2 de
stage/validate/activate quedó cubierta por pruebas locales y por el mecanismo
AAL2 ya validado en T9. Alterar el catálogo activo solo para una prueba habría
creado historia remota innecesaria.

## Asesores de Supabase

- Seguridad: ningún `ERROR` ni `WARN` atribuible a T12. Los tres avisos T12 son
  `INFO` por RLS sin políticas; es el cierre deliberado porque las tablas
  revocan acceso directo y se sirven mediante wrappers `security definer` de
  `service_role`.
- Rendimiento: siete avisos T12 `INFO` por claves foráneas sin índice de
  cobertura e índices aún no usados. Los catálogos son pequeños, la activación
  es manual y los accesos críticos ya usan índices dedicados; no justifican una
  migración especulativa en T12.
- Los dos `WARN` globales de seguridad —inicio anónimo permitido y protección
  de contraseñas filtradas— son configuración/base previa y no fueron creados
  por T12.

## Producción intacta

La comprobación posterior conserva en producción únicamente las cuatro
migraciones base de identidad/acceso/administración y las funciones `access`,
`admin` y `admin-reconciler`. No se aplicó ninguna migración T6–T12, no se
desplegó `plans`, `catalogs` o `medications` y no se modificaron secretos ni
datos de producción.

## Fronteras y trabajo diferido

- **T10.1:** catálogo CIQUAL completo; sigue diferido y no bloquea T12.
- **T13:** fechas y vigencia clínica, historial y tendencias de laboratorio,
  revisión semanal/diario opcional, detección de impacto, recálculo selectivo y
  candidatos revisables.
- **T14:** adaptador Luna y presupuesto máximo de 10 EUR.
- **T15:** PDF, impresión y equivalencia de exportaciones.
- **T16:** productos comerciales, GTIN y correcciones compartidas.
- **T17:** supermercados, disponibilidad y precios orientativos.
- **T19:** auditoría AA final y validación visual integral.

## Referencias

- [`T12_CONTEXTUAL_WELLNESS_EVIDENCE.md`](../research/T12_CONTEXTUAL_WELLNESS_EVIDENCE.md)
- [`API_CONTRACT.md`](../architecture/API_CONTRACT.md)
- [`TASK_09_VERIFICATION.md`](TASK_09_VERIFICATION.md)
- [`TASK_11_VERIFICATION.md`](TASK_11_VERIFICATION.md)
- [`REQUIREMENTS.md`](../../REQUIREMENTS.md)
- [`ACCEPTANCE_GATES.md`](ACCEPTANCE_GATES.md)
