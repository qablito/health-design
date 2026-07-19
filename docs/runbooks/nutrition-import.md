# Importación nutricional federada

**Estado:** operativo para fixtures y descriptores normalizados de T9

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

## Prueba reproducible

```bash
pnpm run import:nutrition -- --fixture
```

La salida debe confirmar cero publicaciones automáticas, una revisión material,
rechazo de la etiqueta comercial y selección de CIQUAL/BLS según precedencia y
lagunas.

## Descriptor de una importación real

T9 no incorpora ni publica automáticamente copias completas de las bases
oficiales. Un adaptador de fuente produce un descriptor JSON y conserva el
artefacto bruto fuera del repositorio:

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
    "columnCount": 74,
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

## Activación en desarrollo

1. Descargar el artefacto oficial en una zona privada de cuarentena.
2. Registrar versión, licencia, fecha y transformación del adaptador.
3. Generar el descriptor y revisar el diff antes de enviar datos.
4. Si el resultado supera 512 KiB, dividirlo antes de calcular hashes en
   descriptores independientes; cada descriptor genera su propio manifiesto.
   Enviar cada lote completo a la Edge Function `catalogs`.
5. Enviar cada lote a `POST /v1/admin/nutrition/imports` con AAL2 e
   `Idempotency-Key` UUID.
6. Correlacionar los `revision_id` devueltos con el diff y abrir cada conflicto
   mediante `POST /v1/admin/nutrition/reviews`.
7. Validar cada revisión mediante
   `POST /v1/admin/nutrition/revisions/{id}/validate`.
8. Resolver revisiones abiertas mediante
   `POST /v1/admin/nutrition/reviews/{id}/resolve`.
9. Activar manualmente la revisión exacta mediante
   `POST /v1/admin/nutrition/revisions/{id}/activate`.
10. Confirmar que la revisión anterior quedó histórica y que los planes activos
   no cambiaron.

No se usa esta ruta en producción durante T9.
