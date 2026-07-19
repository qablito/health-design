# Importación nutricional federada

**Estado:** operativo para fixtures de T9 y núcleo curado CIQUAL 2025 en
desarrollo

**Ámbito:** catálogo genérico; nunca productos GTIN ni catálogos de supermercado

## Contrato de seguridad y procedencia

- Importar significa dejar un lote completo en cuarentena; nunca publicarlo.
- El artefacto bruto y el resultado normalizado conservan SHA-256 distintos,
  algoritmo y versión de canonicalización.
- Un dato ausente sigue ausente. No se transforma en cero.
- No se mezclan alimento, estado, parte comestible, denominador o método
  incompatibles.
- Un conflicto material abre revisión y conserva la revisión efectiva anterior.
- Validar, resolver una revisión y activar exigen superadministrador con AAL2.
- Toda mutación deja un evento técnico privado.

## Fuentes canónicas de V1

El orden es fijo: CIQUAL 2025, BLS 4.0, Fineli, Livsmedelsverket, USDA
Foundation Foods y USDA SR Legacy. Una fuente posterior solo cubre una laguna
compatible; nunca se usa una media silenciosa.

Puntos de entrada oficiales verificados para esta tarea:

1. [ANSES-CIQUAL 2025](https://ciqual.anses.fr/cms/en/2025-anses-ciqual-table),
   Licence Ouverte 2.0.
2. [BLS 4.0](https://blsdb.de/download), CC BY 4.0.
3. [Fineli](https://fineli.fi/fineli/en/index), términos de datos abiertos de
   THL.
4. [Livsmedelsverket](https://soknaringsinnehall.livsmedelsverket.se/) y su
   [API oficial](https://dataportal.livsmedelsverket.se/livsmedel/swagger/index.html),
   CC BY.
5. [USDA FoodData Central](https://fdc.nal.usda.gov/download-datasets/),
   Foundation Foods y SR Legacy.

La licencia, versión exacta, fecha de recuperación y transformaciones del lote
deben revisarse de nuevo cuando se obtenga cada artefacto real. Los datasets
brutos no se guardan en Git.

## Artefacto oficial CIQUAL 2025 activado

El adaptador descarga el XLSX oficial mediante el DOI
[`10.57745/RPWYZD`](https://doi.org/10.57745/RPWYZD), limita la respuesta antes
de escribirla y exige simultáneamente estos digests:

- tamaño: `1.541.998` bytes;
- MD5: `0d9758ce23f3f13dd63a005bc1bb4f2c`;
- SHA-256: `5555c572fa3735991298d832d0427788fa69a11b4fd20a5d580d58942369fbb0`.

El libro validado contiene 3.484 alimentos y 84 columnas. T10 no activa el
libro completo: publica manualmente un núcleo curado de 24 alimentos que cubre
las funciones del generador. Cada uno exige valores exactos conocidos para
energía, proteína, carbohidratos, grasa y fibra; `trace`, `less_than`, valores
ausentes o estimados se conservan en el bruto pero no se activan como esos
cinco valores obligatorios.

El lote activado en desarrollo tiene:

- import key
  `manifest:cfda7d1b1e7fa182b335caff4ec4afb005e87ff933ad76e2e5f87d5a39badcdb`;
- hash normalizado
  `ae832168cce3b5d0a7f7e8292c4c01844c69add4ec76b1abc2cc6afe2ff3c16d`;
- 24 revisiones validadas y 24 revisiones efectivas activas.

## Prueba reproducible

```bash
pnpm run import:nutrition -- --fixture
```

La salida debe confirmar cero publicaciones automáticas, una revisión material,
rechazo de la etiqueta comercial y selección de CIQUAL/BLS según precedencia y
lagunas.

## Descriptor genérico de una importación real

El flujo genérico de T9 sigue disponible para otras fuentes. Un adaptador
produce un descriptor JSON y conserva el artefacto bruto fuera del repositorio:

```json
{
  "sourceKey": "ciqual_2025",
  "sourceVersion": "2025",
  "licenseStatus": "approved",
  "retrievedAt": "2026-07-19T00:00:00.000Z",
  "rawArtifactPath": "./Table-Ciqual-2025.csv",
  "transformations": ["ciqual-2025-adapter-v1"],
  "envelope": {
    "archiveDepth": 0,
    "columnCount": 84,
    "maximumCellBytes": 512,
    "rowCount": 3484,
    "uncompressedBytes": 12345678
  },
  "records": []
}
```

El descriptor se valida y convierte en lote de cuarentena con:

```bash
pnpm run import:nutrition -- --descriptor /ruta/manifest.json
```

Límites previos a cualquier escritura: 25 MiB por archivo, 100.000 filas, 200
columnas, 2 KiB por celda y 100 MiB descomprimidos. Se rechazan archivos
anidados. Los conjuntos mayores se dividen en lotes independientes, cada uno
con su manifiesto.

## Descarga y cuarentena reproducibles de CIQUAL

Ejecutar desde la raíz del repositorio y usar rutas privadas fuera de Git:

```bash
pnpm run import:nutrition -- --ciqual-2025 \
  --download /ruta/privada/Table-Ciqual-2025.xlsx \
  --output /ruta/privada/ciqual-2025-core.json \
  --retrieved-at 2026-07-19T13:10:53.118Z

CIQUAL_BATCH_PATH=/ruta/privada/ciqual-2025-core.json \
  pnpm catalog:activate:ciqual -- --preflight
```

La primera orden debe confirmar `source=ciqual_2025`, `sourceVersion=2025`, 24
registros y estado `quarantined`. La segunda debe devolver
`T10_CIQUAL_CORE_PREFLIGHT_PASS`, 24 alimentos y 12 planes: cuatro patrones
alimentarios por 2, 4 y 6 comidas.

## Activación manual en desarrollo

1. Confirmar que `SUPABASE_URL` coincide exactamente con el proyecto de
   desarrollo; el script rechaza cualquier otra URL.
2. Cargar las claves de desarrollo y las credenciales del superadministrador
   desde almacenamiento seguro, sin imprimirlas ni guardarlas en el shell
   history. Se requiere un TOTP vigente y AAL2.
3. Descargar, verificar y generar el lote con las órdenes anteriores.
4. Revisar el diff y el resultado del preflight antes de enviar datos.
5. Si el resultado supera 512 KiB, dividirlo antes de calcular hashes en
   descriptores independientes; cada descriptor genera su propio manifiesto.
6. Ejecutar la activación:

   ```bash
   CIQUAL_BATCH_PATH=/ruta/privada/ciqual-2025-core.json \
   SUPABASE_URL=https://proyecto-desarrollo.supabase.co \
   SUPABASE_PUBLISHABLE_KEY='[desde almacenamiento seguro]' \
   SUPABASE_SERVICE_ROLE_KEY='[desde almacenamiento seguro]' \
   SUPERADMIN_EMAIL='[cuenta autorizada]' \
   SUPERADMIN_PASSWORD='[desde almacenamiento seguro]' \
   SUPERADMIN_TOTP_CODE='[código vigente]' \
     pnpm catalog:activate:ciqual
   ```

7. El script envía el lote a `POST /v1/admin/nutrition/imports` con AAL2 e
   `Idempotency-Key` UUID.
8. Correlacionar los `revision_id` devueltos con el diff y abrir cada conflicto
   mediante `POST /v1/admin/nutrition/reviews`.
9. Validar cada revisión mediante
   `POST /v1/admin/nutrition/revisions/{id}/validate`.
10. Resolver revisiones abiertas mediante
   `POST /v1/admin/nutrition/reviews/{id}/resolve`.
11. Activar manualmente la revisión exacta mediante
   `POST /v1/admin/nutrition/revisions/{id}/activate`.
12. Confirmar que la revisión anterior quedó histórica y que los planes activos
   no cambiaron.

La salida aceptable de T10 es `T10_CIQUAL_CORE_REMOTE_PASS` con 24 revisiones
activadas, 24 alimentos legibles y 12 planes de preflight. Reejecutar el mismo
lote es seguro: el import key recupera el manifiesto existente y activar la
misma revisión/contexto devuelve la revisión efectiva ya activa. Un fallo
parcial se reanuda; nunca se elimina ni se sustituye historia para “empezar de
cero”. Esta ruta no se usa en producción durante T10.
