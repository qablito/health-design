# Verificación de la Tarea 15

> **Fecha:** 2026-07-20
>
> **Estado:** `T15_COMPLETE_REMOTE_PASS`
>
> **Rama:** `codex/task-15b-private-exports`
>
> **Commits funcionales:** `516dc83`, `8f73abc`, `6c2ad30`, `bbfb9b5`,
> `3f2a441`, `a8e7176`, `386256f`
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
- `pdf-lib` está fijado a `1.17.1`; SheetJS CE a `0.20.3` desde su tarball del
  CDN oficial. El lockfile conserva origen e integridad y la Edge Function
  empaqueta el módulo ya instalado, sin una descarga de red durante el
  despliegue.

## Copia precrítica

- Se eliminó, con autorización explícita, la copia T10 más antigua y su secreto
  asociado del Llavero.
- Se creó y montó en solo lectura
  `t15-precritical-development-20260720T173643Z.dmg`.
- SHA-256 del DMG:
  `6d0e2a19abb3e789eaa96902517c74fe254db9d8d2d64ffd91d7a28c9ba6ad45`.
- Hash interno del esquema:
  `c4e900617fc957607dff72d91d4fe544a9ec440ee73c67ba5b84adbe8d6dd138`.
- Hash interno de los datos:
  `8937ba5d96e395ca8c9cfb87171b0363e6592db3b6188538514b9021c412ddfa`.
- El secreto T15 existe en el Llavero y la rotación vuelve a contener exactamente
  T12, T13, T14 y T15.

## Desarrollo remoto

- La migración `20260720162606_private_plan_exports.sql` está aplicada y un
  `db push --dry-run` confirma que desarrollo está al día.
- El bucket `plan-exports` es privado, limita cada objeto a 25 MiB y admite
  únicamente PDF y XLSX. Una subida y eliminación real con rol servidor pasó.
- `exports` versión 3 está `ACTIVE` con verificación JWT en
  `health-design-dev`; `plans` permanece en versión 11.
- El primer despliegue reveló que el empaquetador remoto no podía descargar
  SheetJS desde su CDN. Se conservó el mismo tarball oficial fijado y se hizo que
  el import map reutilizara el módulo ya instalado.
- La primera ejecución útil detectó una incompatibilidad real: la confirmación
  persistida devolvía `status=ready` sin el campo transitorio `outcome`. El
  parser ahora infiere ese resultado desde el estado persistido; la regresión
  cubre tanto confirmación como descarga. Los logs técnicos solo registran etapa
  y código genérico, sin identificadores ni contenido privado.
- `pnpm test:t15:remote` pasó con 22 artefactos: PDF máximo de 72.707 bytes,
  XLSX máximo de 92.354 bytes, 168 elecciones, rechazo anónimo de creación y
  descarga, idempotencia, objeto privado, 20 intentos admitidos y solicitud 21
  limitada. La limpieza sintética terminó con residuo cero.
- Una repetición intermedia sufrió un fallo DNS externo después de crear tres
  objetos; se eliminaron expresamente objetos, filas, actor y usuario y se
  verificó `remaining_count=0` antes de repetir la prueba definitiva.
- Los advisors remotos no devuelven errores ni hallazgos de rendimiento. Los dos
  avisos globales de seguridad no pertenecen al delta de exportación: política
  anónima de `profiles` y protección de contraseñas filtradas desactivada.

## Producción

La lista remota de producción conserva únicamente las funciones `access`,
`admin` y `admin-reconciler`. No existe `exports`; no se desplegó función ni se
ejecutó ningún comando de migración T15 contra producción.

## Estado de cierre

- `T15B_COMPLETE_LOCAL_PASS`: alcanzado con la puerta local completa.
- `T15_COMPLETE_REMOTE_PASS`: alcanzado tras crear/verificar la copia T15,
  aplicar la migración en desarrollo, desplegar `exports`, superar el smoke
  remoto y confirmar que producción sigue intacta.

## Referencias

- [`2026-07-20-t15-private-exports-implementation-plan.md`](../plans/2026-07-20-t15-private-exports-implementation-plan.md)
- [`0008-edge-pdf-and-xlsx-renderers.md`](../adr/0008-edge-pdf-and-xlsx-renderers.md)
- [`API_CONTRACT.md`](../architecture/API_CONTRACT.md)
- [`DOMAIN_DATA_MODEL.md`](../architecture/DOMAIN_DATA_MODEL.md)
- [`SECURITY_CONTRACT.md`](../security/SECURITY_CONTRACT.md)
- [`TASK_14_VERIFICATION.md`](TASK_14_VERIFICATION.md)
