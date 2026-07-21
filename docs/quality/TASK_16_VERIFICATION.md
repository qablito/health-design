# Verificación de la Tarea 16

> **Fecha:** 2026-07-21
>
> **Estado:** `T16_LOCAL_PASS`
>
> **Rama:** `codex/task-16-contract-plan`
>
> **Commits funcionales:** `85ee36c`, `b3d5111`, `91c3a2d`, `bf5d679`,
> `d6dba6e` y `b8a42f8`
>
> **Entorno validado:** Supabase local y navegador local.
>
> **Entorno remoto:** pendiente de autorización explícita; producción no se ha
> modificado.

## Contrato implementado

- Los GTIN `EAN-8`, `EAN-13`, `UPC-A`, `UPC-E` e `ITF-14` se validan y
  normalizan de forma determinista, conservando ceros iniciales y simbología.
- La resolución usa la precedencia cerrada perfil → global → etiqueta confirmada
  → Open Food Facts → ficha manual vacía. Una consulta no confirma ni aplica.
- La ficha es estructurada, editable y requiere confirmación expresa. No se
  guardan fotografías; los fotogramas de cámara son efímeros y la entrada manual
  siempre permanece disponible.
- Cada revisión es inmutable. Una corrección privada se aísla por perfil y puede
  entrar en la cola administrativa sin exponer su snapshot a otros perfiles.
- El superadministrador puede corregir, aprobar o rechazar con AAL2 y TOTP
  reciente. Aprobar la ficha global y activar su matching son pasos separados.
- Aplicar un producto confirmado crea un candidato recalculado. Conserva la
  función nutricional y dos sustituciones, propaga los estados de nutrientes y
  no altera la versión activa hasta una activación manual posterior.
- La procedencia comercial se proyecta en pantalla, impresión, PDF y XLSX sin
  incluir GTIN, IDs privados ni evidencia administrativa.
- Ficha nutricional comercial T16 y SKU/cadena/precio T17 permanecen separados.

## Evidencia local

| Comprobación | Resultado |
|---|---|
| `CI=true pnpm verify` | PASS; contratos Edge, formato, lint, tipos, 20 activos visuales, 66 archivos/557 pruebas Vitest, 2 archivos/4 pruebas de navegador y build |
| `CI=true pnpm test:e2e` | PASS; 32/32 recorridos Chromium |
| `pnpm test:db` | PASS; 14 archivos/340 pruebas pgTAP |
| pruebas T16 dirigidas | PASS; contratos/catálogo, persistencia Edge, aplicación al plan, cliente, administración y reconciliador |
| recorrido de código de barras | PASS; consulta, confirmación, candidato y plan activo intacto |
| regresión administrativa | PASS; 3/3, incluido desafío AAL2 caducado sin bloqueo por la carga del catálogo |
| `pnpm edge:generate` y `pnpm edge:check` | PASS; contratos y declaraciones Edge sincronizados |
| `node --check scripts/commercial-products-remote-smoke.mjs` | PASS; smoke remoto válido sintácticamente y cerrado ante configuración incompleta |
| `pnpm test:supply-chain` | PASS; lockfile e historial de dependencias válidos |
| `pnpm audit --prod --audit-level=high` | PASS; sin vulnerabilidades conocidas |
| `git diff --check` y comprobación de secretos añadidos | PASS |
| `supabase db diff --local --schema public,private` | PASS; esquema reproducible desde cero y diff vacío tras las migraciones aditivas de sincronización |
| `supabase db lint --local --level warning` | PASS; cero errores y cero avisos tras conservar el control de acceso con `PERFORM` |

El build conserva los dos avisos ya conocidos: una importación dinámica no puede
separarse del módulo que también se importa estáticamente y el chunk principal
supera 500 kB. El fallback de código de barras se mantiene diferido en su propio
chunk y no se descarga cuando `BarcodeDetector` nativo cubre el navegador.

## Evidencia por puerta T16

| Puerta | Estado local | Evidencia |
|---|---|---|
| `T16-G1 Identidad` | PASS | formatos, checksum, expansión UPC-E, ceros, entrada manual y fallback cubiertos |
| `T16-G2 Confirmación` | PASS | consulta sin escritura, confirmación obligatoria, idempotencia y `unknown` conservado |
| `T16-G3 Privacidad` | PASS local | RLS de dos perfiles, propuesta privada aislada, revisión global separada y purga cubiertas |
| `T16-G4 Matching` | PASS | exclusiones antes de compatibilidad, cinco estados y una única regla activa por GTIN |
| `T16-G5 Plan` | PASS | candidato recalculado, dos sustituciones, agregados y versión activa byte a byte estable |
| `T16-G6 Administración` | PASS local | AAL1 rechazado, AAL2/TOTP exigidos, concurrencia, idempotencia e `intent/outcome` cubiertos |
| `T16-G7 Historia y salida` | PASS local | revisiones inmutables, histórico, retirada, borrado y regresiones PDF/XLSX/impresión cubiertos |
| `T16-G8 Remoto` | PENDING | exige copia precrítica, migración, despliegue y smoke contra desarrollo real |

Los PASS locales no sustituyen la prueba con identidades y funciones remotas. La
puerta `T16-G8` solo puede cerrarse con la secuencia del runbook y autorización
expresa del usuario.

## Revisión sensible a seguridad

- Las tablas privadas revocan acceso directo y exponen únicamente RPC cerradas de
  mínimo alcance; las políticas RLS comprueban membresía activa.
- Las mutaciones administrativas exigen superadministrador, AAL2 y TOTP reciente.
- Consultas, bodies y estados usan esquemas cerrados, límites previos al parseo y
  errores sin snapshots ni identificadores sensibles.
- Las claves de idempotencia distinguen replay exacto de cuerpo distinto. Las
  revisiones, aprobaciones y activaciones usan versiones esperadas para evitar
  carreras.
- El ledger conserva actor real y efectivo, `intent/outcome` y hashes técnicos;
  no registra etiqueta, GTIN, token, perfil ni payload en claro.
- Open Food Facts tiene timeout, caché negativa, single-flight y selección de
  campos. Su respuesta solo produce un borrador revisable.
- La cámara no transmite ni persiste fotogramas y se detiene al cerrar o desmontar
  el componente.

## Operación remota pendiente

No se ha creado todavía una copia precrítica T16, no se han aplicado las cinco
migraciones T16 al proyecto enlazado y no se han desplegado las nuevas versiones
de `catalogs`, `plans`, `admin` o `admin-reconciler`. Tampoco se ha ejecutado
`pnpm test:t16:remote`.

El siguiente paso, separado de este recibo local, requiere autorización para:

1. crear y verificar la copia cifrada respetando cuatro rotaciones;
2. aplicar las migraciones solo a `health-design-dev`;
3. desplegar las cuatro funciones en desarrollo;
4. ejecutar el smoke con dos perfiles sintéticos y un superadministrador AAL2;
5. revisar y activar manualmente el candidato de prueba;
6. registrar objetos, auditoría, limpieza y ausencia de cambios en producción.

## Referencias

- [`2026-07-21-t16-commercial-products-contract.md`](../plans/2026-07-21-t16-commercial-products-contract.md)
- [`commercial-product-publication.md`](../runbooks/commercial-product-publication.md)
- [`API_CONTRACT.md`](../architecture/API_CONTRACT.md)
- [`DOMAIN_DATA_MODEL.md`](../architecture/DOMAIN_DATA_MODEL.md)
- [`DATA_GOVERNANCE.md`](../data/DATA_GOVERNANCE.md)
- [`SECURITY_CONTRACT.md`](../security/SECURITY_CONTRACT.md)
- [`THREAT_MODEL.md`](../security/THREAT_MODEL.md)
