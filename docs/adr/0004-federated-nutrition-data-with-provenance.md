# ADR-0004: Datos nutricionales federados con procedencia preservada

- Estado: aceptado
- Fecha: 2026-07-16

## Contexto

Las bases de composición difieren por alimento, estado, método, parte comestible, versión y cobertura. Promediarlas oculta discrepancias y puede crear una precisión falsa. Los productos comerciales añaden etiquetas y correcciones que cambian con el tiempo.

## Decisión

El catálogo nutricional será federado:

- conserva cada observación con fuente, versión, fecha, método, estado, parte comestible, unidad y confianza;
- selecciona una revisión efectiva mediante reglas de precedencia;
- no promedia fuentes;
- conserva los valores ausentes como ausentes;
- congela en cada plan la revisión efectiva utilizada.

Para alimento canónico la precedencia general es CIQUAL 2025, BLS 4.0,
Fineli, Livsmedelsverket y USDA Foundation/SR Legacy. Otras fuentes solo se
incorporan tras resolver licencia y compatibilidad.

Las etiquetas confirmadas pueden definir un producto comercial concreto. Una
corrección confirmada del perfil tiene prioridad solo para ese perfil/GTIN;
una revisión global aprobada beneficia a los demás. Ninguna modifica el
alimento canónico genérico. Aprobar crea una revisión nueva y no muta la
propuesta privada.

Toda importación nutricional o comercial crea `SourceManifest` con licencia,
captura, transformaciones y hashes SHA-256 bruto/normalizado. Cada
`CommercialProductRevision`/`CatalogRevision` enlaza ese manifiesto; un lote
sin procedencia completa permanece en cuarentena.

## Consecuencias

### Positivas

- Trazabilidad de cada cifra.
- Reproducción de planes históricos.
- Las discrepancias se revisan en vez de esconderse.
- Una actualización de catálogo no altera planes ya activos.

### Costes

- Modelo de datos y proceso editorial más complejos.
- Necesidad de normalizar unidades e identidades sin perder el original.
- Cobertura inicial desigual y estados de confianza explícitos.

## Alternativas descartadas

- Promedio entre fuentes: oculta identidad y metodología.
- Una única base universal: no cubre suficientemente alimentos, productos y contextos.
- Usar el catálogo del supermercado como verdad nutricional: mezcla compra y composición.
