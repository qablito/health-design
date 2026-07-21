# Formato de importación de supermercados T17A

**Estado:** `T17A_LOCAL_DRY_RUN`

Este documento define el importador local reproducible de Mercadona, DIA y ALDI. La
salida queda siempre en cuarentena: T17A no crea revisiones en PostgreSQL, no publica
catálogos y no altera planes nutricionales.

## Entrada

El comando acepta únicamente un archivo CSV local regular. Rechaza URL, redirecciones,
enlaces simbólicos, ZIP y archivos anidados.

```bash
pnpm import:supermarkets -- \
  --chain mercadona \
  --input "/ruta/catalogo_mercadona.csv" \
  --dry-run
```

Las cadenas admitidas son `mercadona`, `dia` y `aldi`; el mercado queda fijado en `ES`.
El CSV debe contener encabezado único y, como mínimo, `retailer`, `sku`, `name`,
`source_category`, `package_text`, `price_eur`, `data_status` y `last_error`. El parser
respeta comas, comillas escapadas y saltos de línea dentro de celdas.

Límites de entrada:

| Límite | Valor |
|---|---:|
| Archivo | 25 MiB |
| Filas | 100.000 |
| Columnas | 200 |
| Celda normalizada T17 | 2 KiB |
| Contenido descomprimido | 100 MiB |

El CSV bruto se conserva íntegro por hash y, durante un upload autorizado, como objeto
privado. La proyección normalizada retiene solo campos de identidad, nombre, categoría,
formato, precio base, GTIN, fecha y metadato interno de captura. Ingredientes, nutrientes,
stock, disponibilidad, ofertas e imágenes no entran en T17. Por eso el límite de celda se
aplica a los campos retenidos; las celdas ajenas a T17 siguen cubiertas por los límites de
archivo y se conservan exclusivamente en la captura bruta.

## Normalización y cuarentena

- Identidad: `market + chain + externalSku`; `gtin14` es opcional y nunca es la clave.
- Precio: solo `price_eur`; no se usa `observed_offer_price_eur`.
- Paquete: masa en gramos, volumen en mililitros o unidades. Un formato ambiguo queda
  visible, pero no calculable.
- Volumen o unidades no cubren una necesidad en gramos sin equivalencia de masa
  comestible confirmada y evidenciada.
- Una fila `data_status=error` se contabiliza como error de captura y se excluye de los
  SKU normalizados.
- Un precio ausente conserva el producto visible con `base_price_missing`; nunca se
  interpreta como coste cero.
- La captura bruta y el artefacto normalizado reciben SHA-256 independientes.
- Dos ejecuciones sobre la misma entrada producen el mismo artefacto y hash normalizado.

`licenseStatus` y `sourceTermsStatus` valen `unknown` si no se indican. Cualquier
`unknown` bloquea publicación. `restricted` solo puede superar esa condición con una
decisión de uso documentada para desarrollo; producción queda cerrada en T17.

## Upload privado opcional

T17A no ejecuta upload. La vía existe, pero falla cerrada si no se confirma literalmente
el bucket de desarrollo:

```bash
pnpm import:supermarkets -- \
  --chain mercadona \
  --input "/ruta/catalogo_mercadona.csv" \
  --license-status restricted \
  --source-terms-status restricted \
  --upload \
  --confirm-upload health-design-catalog-source-dev
```

Wrangler escribe en `health-design-catalog-source-dev`, jurisdicción EU. Primero consulta
el manifest remoto: misma clave y mismos hashes reutilizan el lote; una clave existente
con otro hash devuelve `supermarket_r2_key_conflict`. Los objetos son privados y sus
referencias son opacas.

## Recibo local del 21 de julio de 2026

Los tres `--dry-run` se ejecutaron contra las copias externas no rastreadas de `datos/`.
No se creó ni subió ningún artefacto.

| Cadena | Filas | Precio base | Error captura | Rechazo normalización | Calculable contra gramos | SHA-256 bruto | SHA-256 normalizado |
|---|---:|---:|---:|---:|---:|---|---|
| Mercadona | 4.314 | 4.313 | 0 | 0 | 2.215 | `02e72943285db7322c90f261efdb6bf311fdc686e8cf79e605dc6febe0278a3a` | `ef578eb0dceb892097b1bff4699cd087920c0b33d9d16b70bfe70a69d4bad566` |
| DIA | 7.661 | 5.848 | 2 | 0 | 3.402 | `e93216ceaa1ceec8010355422ebe8d7693fed26b33a58ceec3b32c8f8d86c94e` | `eb6eb41a3925de746d65358f0830a77ef5f16e8f7e960428503ad384d130e03a` |
| ALDI | 1.696 | 1.525 | 39 | 0 | 1.046 | `0f4d1f29d27d2336d711e80941cd7072c1e9597c36fb6a7cfe214e1b428a9b7c` | `4bdcc5d3de55d2bdb1492151ba6419e7ddbc7d81b1422946c9774c8ed5876bee` |
| **Total** | **13.671** | **11.686** | **41** | **0** | **6.663** | — | — |

“Calculable contra gramos” solo describe integridad técnica de precio, paquete y dimensión;
no es cobertura 60 + 20, matching aprobado, disponibilidad ni autorización de publicación.
