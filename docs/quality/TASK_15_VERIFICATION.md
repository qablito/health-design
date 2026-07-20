# Verificación de la Tarea 15

> **Fecha:** 2026-07-20
>
> **Estado:** `T15B_COMPLETE_LOCAL_PASS`
>
> **Rama:** `codex/task-15b-private-exports`
>
> **Commits funcionales:** `516dc83`, `8f73abc`, `6c2ad30`, `bbfb9b5`,
> `3f2a441`
>
> **Entorno remoto objetivo:** `health-design-dev`
> (`nwoivdxdupklervtnovd`)
>
> **Alcance:** preparación breve determinista y versionada; modelo canónico de
> exportación nutricional; PDF/XLSX privados; impresión A4; almacenamiento y
> descarga proxyficada. Producción no se modifica.

## Contrato implementado

- Los planes nuevos incorporan preparación versionada para el alimento principal
  y sus dos sustitutos; los planes anteriores se normalizan sin reescribir su
  versión almacenada.
- Pantalla, impresión, PDF y XLSX parten de la misma versión nutricional y de la
  misma lista ordenada de elecciones.
- Compacto conserva las elecciones actuales; completo añade las dos alternativas.
- El usuario elige ingredientes o preparación breve, día o semana, lista de la
  compra y preparación semanal cuando corresponde.
- PDF/XLSX se generan en servidor. La impresión es una vista nativa del navegador
  y no crea un artefacto persistente.
- El bucket `plan-exports` es privado, limita a 25 MiB y admite solo PDF/XLSX.
- La descarga exige JWT, sesión y membresía vigentes, devuelve bytes con
  `no-store`, `no-referrer`, `nosniff` y nombre neutro, sin redirección ni URL
  firmada.
- Las reservas son idempotentes, serializan una generación por perfil y aplican
  20/h por perfil, 30/h por actor y 60/h por digest HMAC de IP.
- XLSX neutraliza fórmulas y no contiene macros ni enlaces externos. Ningún
  formato incluye alias, cuestionario, medicación, compuestos sensibles,
  hallazgos internos o referencias de evidencia.
- La purga de perfil elimina primero los objetos exactos de Storage y no permite
  finalizar mientras quede una exportación física pendiente.

## Evidencia local

| Comprobación | Resultado |
|---|---|
| `CI=true pnpm verify` | PASS; 59 archivos/497 pruebas Vitest, 2 archivos/4 pruebas de navegador, contratos Edge, formato, lint, tipos, 20 activos visuales y build |
| `CI=true pnpm test:e2e` | PASS; 31/31 flujos Chromium |
| `pnpm test:db` | PASS; 11 archivos/315 pruebas pgTAP |
| advisors y lint SQL | PASS; cero errores o avisos |
| `supabase db diff --local --schema public,private` | PASS; diff vacío desde cero |
| E2E de exportación | PASS; 2/2, incluido caso accesible enfocado 1/1 |
| runtime Edge local | PASS; Deno cargó ambos renderizadores y una petición sin sesión fue rechazada con `401` |
| `pnpm test:supply-chain` | PASS; lockfile y origen fijado de SheetJS válidos |
| `pnpm audit --prod --audit-level=high` | PASS; sin vulnerabilidades conocidas |
| `node --check scripts/export-remote-smoke.mjs` y `git diff --check` | PASS |

El build conserva los avisos ya conocidos de importación dinámica y chunk mayor
de 500 kB. El bundle web no contiene `pdf-lib` ni SheetJS: los renderizadores
permanecen en la función de servidor.

## Revisión sensible a seguridad

- Funciones SQL internas con `SECURITY DEFINER` fijan
  `search_path=pg_catalog`; las funciones privadas y tablas no conceden acceso a
  `anon`, `authenticated` ni `service_role`.
- Los wrappers públicos de mínimo alcance solo se conceden al rol de servicio y
  la Edge Function vuelve a comprobar Auth, sesión y membresía.
- El cuerpo se limita a 16 KiB antes del análisis JSON; el artefacto se limita a
  25 MiB antes de persistirlo.
- El digest de IP es HMAC; no se guarda una IP en claro.
- La respuesta pública usa un contrato estricto y no contiene ruta de Storage,
  digest interno, perfil, actor ni URL.
- La descarga rechaza redirecciones en Edge y en el navegador; la URL Blob local
  se revoca después de activar la descarga.
- `pdf-lib` está fijado a `1.17.1`; SheetJS CE a `0.20.3` desde su CDN oficial.
  El lockfile y la puerta de cadena de suministro conservan su resolución e
  integridad.

## Copia precrítica

Pendiente de autorización y rotación. La rotación confirmada en T14 ya contiene
cuatro objetos (T10, T12, T13 y T14), por lo que T15 no eliminará ninguno sin
autorización explícita del usuario.

## Desarrollo remoto

Pendiente de autorización explícita. El script reproducible
`pnpm test:t15:remote` usa únicamente perfiles sintéticos y comprueba rechazo
anónimo, dos formatos máximos, idempotencia, veinte configuraciones distintas,
límite de la solicitud 21, objeto privado, cabeceras y limpieza final. Nunca
registra JWT, contenido del plan, bytes, respuestas del cuestionario ni rutas de
Storage.

## Producción

Producción permanece fuera de alcance y no se tocará durante T15.

## Estado de cierre

- `T15B_COMPLETE_LOCAL_PASS`: solo después de la puerta local completa.
- `T15_COMPLETE_REMOTE_PASS`: solo después de crear/verificar la copia T15,
  aplicar la migración en desarrollo, desplegar `exports`, superar el smoke
  remoto y confirmar que producción sigue intacta.

## Referencias

- [`2026-07-20-t15-private-exports-implementation-plan.md`](../plans/2026-07-20-t15-private-exports-implementation-plan.md)
- [`0008-edge-pdf-and-xlsx-renderers.md`](../adr/0008-edge-pdf-and-xlsx-renderers.md)
- [`API_CONTRACT.md`](../architecture/API_CONTRACT.md)
- [`DOMAIN_DATA_MODEL.md`](../architecture/DOMAIN_DATA_MODEL.md)
- [`SECURITY_CONTRACT.md`](../security/SECURITY_CONTRACT.md)
- [`TASK_14_VERIFICATION.md`](TASK_14_VERIFICATION.md)
