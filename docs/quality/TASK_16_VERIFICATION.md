# Verificación de la Tarea 16

> **Fecha:** 2026-07-21
>
> **Estado:** `T16_COMPLETE_REMOTE_PASS`
>
> **Rama:** `codex/task-16-contract-plan`
>
> **Commits funcionales previos:** `85ee36c`, `b3d5111`, `91c3a2d`, `bf5d679`,
> `d6dba6e`, `b8a42f8` y `90a33b9`
>
> **Entorno validado:** Supabase local, navegador local, Cloudflare Worker y
> despliegue remoto de desarrollo.
>
> **Entorno remoto:** copia, cinco migraciones, cinco Edge Functions y Worker de
> continuidad aplicados solo en desarrollo; smoke funcional, revisión,
> activación, PDF/XLSX, auditoría y limpieza superados. Producción no se ha
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
| `CI=true pnpm verify` | PASS; contratos Edge, formato, lint, tipos, 20 activos visuales, 66 archivos/560 pruebas Vitest, 2 archivos/4 pruebas de navegador y build |
| `CI=true pnpm test:e2e` | PASS; 32/32 recorridos Chromium |
| `pnpm test:db` | PASS; 14 archivos/340 pruebas pgTAP |
| pruebas T16 dirigidas | PASS; contratos/catálogo, persistencia Edge, aplicación al plan, cliente, administración y reconciliador |
| recorrido de código de barras | PASS; consulta, confirmación, candidato y plan activo intacto |
| regresión administrativa | PASS; 3/3, incluido desafío AAL2 caducado sin bloqueo por la carga del catálogo |
| `pnpm edge:generate` y `pnpm edge:check` | PASS; contratos y declaraciones Edge sincronizados |
| `CI=true pnpm worker:check` | PASS; bundles secos de desarrollo y producción, sin despliegue de producción |
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
| `T16-G3 Privacidad` | PASS remoto | dos perfiles aislados, propuesta privada, publicación global separada, exportaciones sin identificadores y purga verificada |
| `T16-G4 Matching` | PASS | exclusiones antes de compatibilidad, cinco estados y una única regla activa por GTIN |
| `T16-G5 Plan` | PASS | candidato recalculado, dos sustituciones, agregados y versión activa byte a byte estable |
| `T16-G6 Administración` | PASS remoto | AAL2/TOTP real, aprobación y activación separadas, Worker compatible y pares `intent/outcome` cerrados |
| `T16-G7 Historia y salida` | PASS remoto | candidato manual, base archivada, PDF/XLSX privados y limpieza sin residuos privados |
| `T16-G8 Remoto` | PASS | copia, migraciones, funciones, Worker, smoke, auditoría, salidas y limpieza en desarrollo; producción intacta |

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

## Copia precrítica T16

| Propiedad | Evidencia |
|---|---|
| Objeto | `/Users/pablito/Documents/health-design-private-backups/t16-precritical-development-20260721T134242Z.dmg` |
| Cifrado | AES-256; clave únicamente en el Llavero de macOS, servicio `health-design-dev-t16-precritical-development-20260721T134242Z` |
| SHA-256 del DMG | `d61a2c2ba30f72a79a78ead94be6184876c9515b434bc1e9628529fac7423960` |
| SHA-256 interno de esquema | `804d25486403acf0d1a5d75ee1f8cdb31857da5f0a4a73b6606a4ded5ab2e906` |
| SHA-256 interno de datos | `98f45cea5cbb8948d35c768d0bbf178121da3b6f0eba643c931f33be0b57e34b` |
| SHA-256 interno de roles | `25873cec56a2cc6514e204f420231777f85c03da818caa7090cdcdfa89776ecd` |
| Verificación | PASS con `hdiutil verify`, montaje de solo lectura y checksums internos |

La copia T12 y su secreto se eliminaron únicamente después del PASS. La rotación
conserva exactamente T13, T14, T15 y T16.

## Desarrollo remoto desplegado

El proyecto enlazado se comprobó como `health-design-dev`
(`nwoivdxdupklervtnovd`). El dry-run previo enumeró únicamente las cinco
migraciones T16 y se aplicaron en su orden canónico:

1. `20260721084023_commercial_products.sql`;
2. `20260721114021_commercial_product_plan_application.sql`;
3. `20260721143000_commercial_product_admin_audit.sql`;
4. `20260721154500_commercial_product_concurrency_sync.sql`;
5. `20260721160000_commercial_product_application_lint.sql`.

El dry-run posterior devuelve `Remote database is up to date`. El secreto
`OPEN_FOOD_FACTS_USER_AGENT` existe en desarrollo sin registrar su contenido.

| Edge Function | Versión | Estado | JWT | SHA-256 remoto |
|---|---:|---|---|---|
| `catalogs` | 5 | `ACTIVE` | obligatorio | `c5856b0e661965561fba9d072a4a04dceffcf0a463c8435dbca1f575a2ccd62b` |
| `plans` | 13 | `ACTIVE` | obligatorio | `f7300f6245aa4dc7b5bc49bbb33944646561510f85bcdd26112b89ccfaa1e223` |
| `admin` | 5 | `ACTIVE` | obligatorio | `7a04b60c4d536a346336eb09f6a7f1836561659468befab886cda949d59700fb` |
| `admin-reconciler` | 5 | `ACTIVE` | firma interna | `4f8076ce4c13e3c1c8051ffd3d1a0b86d258a043eeb5ba72048970452602e0e3` |
| `exports` | 7 | `ACTIVE` | obligatorio | `f02ed2cefebdcb80ffa999ee7604c74098c2e5f4febf81e314fa02d082b4f763` |

Las cuatro funciones con JWT rechazaron llamadas anónimas con
`401/UNAUTHORIZED_NO_AUTH_HEADER`. El primer empaquetado de `admin` reveló que
su import map no cerraba las dependencias transitivas catálogo → motor → dominio;
se añadió una regresión roja/verde y el despliegue posterior de las cuatro
funciones terminó correctamente.

El Worker de continuidad de desarrollo se amplió con las cuatro acciones cerradas
de producto T16 y se desplegó con versión
`5f3cd655-7d8d-4752-b492-1d4e15bc48ac`. El test rojo/verde demostró que el
Worker anterior rechazaba esos intents y que la versión activa acepta únicamente
la pareja acción/tipo de destino prevista. Producción no recibió ese despliegue.

## Validación funcional remota

La secuencia autorizada se ejecutó en `health-design-dev` con dos identidades y
dos perfiles sintéticos, una sesión real de superadministrador elevada a AAL2 y
un GTIN sintético válido. No se guardó ningún secreto ni código TOTP en el
repositorio o en este recibo.

1. El perfil A creó y confirmó una corrección privada. El perfil B no recibió la
   propuesta privada antes de su publicación.
2. El superadministrador aprobó la corrección y activó por separado la regla de
   matching. Ambas llamadas terminaron con `200`.
3. El perfil B confirmó la revisión global y creó un candidato revisable. La
   versión activa no cambió hasta la activación manual; después, el candidato
   quedó `activated` y la base anterior `archived`.
4. La comida aplicada mantuvo la función nutricional, cantidades/macros
   recalculados y exactamente dos sustituciones.
5. La exportación remota autenticada generó un PDF 1.7 de 14.044 bytes y cuatro
   páginas, y un XLSX Excel 2007+ de 33.168 bytes y 168 filas. La descarga
   anónima devolvió `401`; ninguno incluyó GTIN, confirmación, producto ni
   revisión interna.

El primer intento de exportación reveló dos defectos de integración que quedaron
cubiertos antes del PASS: `exports` no se había redeplegado junto a T16 y el
nombre comercial podía contener literalmente el GTIN. La proyección pública
ahora elimina tokens GTIN/UUID solo en productos comerciales. El renderizador se
elevó a `export-v2`, de modo que el hash de configuración invalida artefactos
anteriores y evita devolver un PDF/XLSX obsoleto. Las pruebas dirigidas de
contrato, modelo, PDF, XLSX y Edge pasan 26/26.

La auditoría privada registró una pareja completa `intent/outcome` para
`barcode_correction_approve` y otra para `matching_rule_activate`, con hashes y
recibos completos, cero pares incompletos y cero outbox pendientes.

La limpieza final eliminó los dos perfiles y usuarios Auth sintéticos, el plan,
confirmaciones, correcciones, filas de exportación y objetos privados de Storage.
Las consultas posteriores devolvieron cero residuos privados. Se conservan una
revisión global anonimizada y una regla global activa, sin propietario, tal como
exige el contrato de publicación y borrado. Los archivos temporales locales
también se eliminaron.

Resultado final: `T16_COMPLETE_REMOTE_PASS`. Esta evidencia es exclusivamente de
desarrollo; no declara migración, despliegue ni validación de producción.

## Referencias

- [`2026-07-21-t16-commercial-products-contract.md`](../plans/2026-07-21-t16-commercial-products-contract.md)
- [`commercial-product-publication.md`](../runbooks/commercial-product-publication.md)
- [`API_CONTRACT.md`](../architecture/API_CONTRACT.md)
- [`DOMAIN_DATA_MODEL.md`](../architecture/DOMAIN_DATA_MODEL.md)
- [`DATA_GOVERNANCE.md`](../data/DATA_GOVERNANCE.md)
- [`SECURITY_CONTRACT.md`](../security/SECURITY_CONTRACT.md)
- [`THREAT_MODEL.md`](../security/THREAT_MODEL.md)
