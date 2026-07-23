# Gobernanza de datos nutricionales, farmacológicos y comerciales

**Estado:** contrato de datos de V1  
**Versión:** 1.0  
**Fuente funcional:** [`PRODUCT.md`](../../PRODUCT.md)

## 1. Principios

1. No se promedia una fuente con otra para ocultar discrepancias.
2. Cada valor conserva identidad, estado, parte comestible, unidad, método,
   fuente, versión, fecha y confianza.
3. Un dato ausente permanece ausente; el motor puede ofrecer una alternativa
   provisional visible, nunca inventar precisión.
4. Los planes históricos quedan congelados con su manifiesto de fuentes.
5. La ficha nutricional comercial por GTIN y el SKU de compra son capas
   distintas. Solo una ficha confirmada puede proponerse para una línea del
   plan; cadena y precio nunca son autoridad nutricional, y la presencia en
   catálogo no acredita stock.

## 2. Fuentes y precedencia

Hay dos contextos de resolución que nunca compiten entre sí.

### Alimento canónico

La precedencia del núcleo genérico V1 es federada y explícita:

1. CIQUAL 2025.
2. BLS 4.0.
3. Fineli.
4. Livsmedelsverket.
5. USDA Foundation/SR Legacy.
6. BEDCA, EFSA y EuroFIR cuando la licencia, acceso y uso sean válidos.
7. Estudios revisados por pares aislados solo como señal complementaria, nunca
   para sustituir una base de composición sin revisión.

### Producto comercial

Para un GTIN concreto, una corrección exacta aprobada o etiqueta confirmada
puede ser la revisión efectiva de ese producto. Nunca reemplaza la composición
de un alimento canónico genérico usado por otra comida.

Las guías clínicas, revisiones sistemáticas, metaanálisis y ensayos controlados
son la jerarquía de evidencia de reglas; los observacionales apoyan lagunas y
no se convierten en certeza automática.

Cada importación nutricional o comercial crea `SourceManifest` con fuente,
licencia/uso permitido, fecha de consulta, versión, transformaciones, cobertura
y responsable de revisión. Conserva además SHA-256 del artefacto bruto y del
resultado normalizado, junto con la versión de canonicalización; reimportar un
contenido distinto nunca reutiliza silenciosamente el mismo manifiesto.

La selección oficial exacta que cubre la cesta nutricional T17 se documenta en
[`T17_BASKET_SOURCE_MAP.md`](T17_BASKET_SOURCE_MAP.md). La selección es
multifuente, pero cada alimento conserva una única identidad y revisión de
origen; no se promedian valores entre bases.
`CatalogRevision.source_manifest_id` y `capture_evidence_ref` enlazan cada lote
de supermercado con esa evidencia. Ninguna revisión comercial puede publicarse
si falta manifiesto, licencia, hashes o descripción de captura/transformación.

## 3. Esquema de composición

Una revisión de composición debe poder responder:

```json
{
  "canonical_food_id": "food:...",
  "basis": "per_100g|per_100ml|per_portion",
  "state": "raw|cooked|drained|...",
  "edible_part": "...",
  "method": "...",
  "nutrients": {
    "energy_kcal": {"value": 0, "unit": "kcal"},
    "protein_g": {"value": 0, "unit": "g"},
    "fat_g": {"value": 0, "unit": "g"},
    "carbohydrate_g": {"value": 0, "unit": "g"},
    "fiber_g": {"value": 0, "unit": "g"}
  },
  "source_ref": "...",
  "source_version": "...",
  "observed_at": "2026-07-16",
  "confidence": "high|moderate|low",
  "status": "active|superseded|rejected"
}
```

Se amplía con micronutrientes clínicamente relevantes solo cuando el contexto
o la regla los necesita. No se muestra una falsa exhaustividad.

## 4. Productos comerciales y códigos de barras

- La identidad primaria de un código es GTIN/GS1 cuando esté disponible.
- Open Food Facts y la etiqueta confirmada son fuentes de producto; consultar o
  escanear no persiste y la confirmación estructurada del usuario es obligatoria.
- Una confirmación crea/reutiliza `ProductConfirmation` y una revisión privada
  inmutable. Si difiere de la base, crea `BarcodeCorrection(status=pending)`;
  solo el perfil propietario la resuelve de inmediato.
- La propuesta privada no se muta al corregirla o aprobarla. El
  superadministrador crea revisiones nuevas, conserva anterior/nueva por hash y
  exige AAL2+TOTP reciente. Aprobar crea una revisión `global_approved` y una
  regla de matching `draft`; activar el matching es una acción independiente.
- La precedencia para un GTIN es: confirmación del perfil, revisión global
  aprobada, etiqueta confirmada, Open Food Facts y ficha manual vacía. Una
  propuesta privada nunca se filtra a otro perfil.
- La ficha conserva ocho nutrientes base con estado
  `known|estimated|unknown`, ingredientes, alérgenos, contaminación cruzada,
  base por 100 g/ml y densidad cuando corresponde. `unknown` no se convierte en
  cero; una densidad necesaria ausente impide la aplicación.
- La aplicación exige confirmación, posición canónica exacta y versión activa.
  Recalcula cantidad, kcal, macros, fibra, totales y lista semanal, conserva la
  función nutricional y exactamente dos sustituciones, y crea un candidato.
  Nunca muta la versión activa.
- Alérgenos “puede contener” o desconocidos no se auto-seleccionan cuando el
  perfil exige exclusión por alergia.

La eliminación del perfil purga confirmaciones, correcciones privadas y
eventos de aplicación dependientes. Una revisión global ya aprobada conserva
solo procedencia anonimizada y no vuelve a exponer `profile_id` ni el snapshot
privado que la originó.

## 5. Catálogo de supermercados

El catálogo se divide en tres capas:

1. catálogo comercial completo importado;
2. alimentos canónicos y reglas de matching;
3. cesta de prueba V1: 60 productos fijos + exactamente 20 dinámicos frecuentes.

La cesta de prueba no limita el catálogo total. Una cadena solo se publica si
alcanza al menos 90 % de cobertura de la cesta, ningún grupo esencial baja del
75 %, tiene precio base y formato utilizables y cuenta con activación manual.
Una publicación activa no caduca ni se oculta automáticamente. Si la calidad
cae, se abre una revisión y solo una acción administrativa puede sustituirla u
ocultarla; la revisión histórica se conserva.

Reglas de matching:

- se aplican exclusiones antes que inclusiones;
- los aliases usan coincidencia de palabras completas;
- los estados son `exact`, `allowed`, `review`, `excluded`, `insufficient`;
- solo hay una regla canónica activa por SKU;
- cambios de nombre, ingredientes, formato o estado reevalúan la regla;
- un cambio de precio no cambia identidad; el catálogo no acredita stock físico.

El origen real del lote puede ser Sevilla para V1, pero esa referencia es
interna: nunca se expone al usuario como explicación geográfica del precio.
Los precios son orientativos para España y solo precio base: sin ofertas,
cupones, fidelización, transporte, bolsas ni pedido mínimo.
La publicación no tiene caducidad automática ni fecha visible: permanece
activa hasta que una revisión posterior se publique u oculte manualmente.

## 6. Reglas de discrepancia y revisión

Una discrepancia abre revisión manual cuando afecta identidad, estado crudo/
cocinado, unidad, parte comestible, alérgenos, energía o macronutrientes de
forma material según
[`NUMERIC_CONTRACT.md`](NUMERIC_CONTRACT.md). No se resuelve con una media
automática. La revisión debe registrar:

- fuentes comparadas y valores;
- razón de discrepancia;
- decisión y justificación;
- revisor, fecha y nueva revisión;
- planes afectados y si requieren candidato.

## 7. Reglas farmacológicas y clínicas

- Catálogo canónico: AEMPS/CIMA cuando haya identidad española verificable.
- Regla separada por interacción/mecanismo y módulo afectado.
- Cada regla declara nivel `modeled`, `partial` o `unmodeled`, evidencia,
  vigencia, condiciones necesarias y acción.
- Dosis, frecuencia, vía u horario se persisten y usan solo si la regla lo
  exige expresamente.
- No se muestran compuestos sensibles en PDFs; sí pueden afectar reglas internas.
- Una regla nueva no altera planes activos: genera revisión/candidato según
  impacto y activación manual.

## 8. Laboratorio y seguimiento

Los valores V1 se introducen manualmente. Cada observación requiere analito,
valor, unidad, fecha/rango aproximado si se conocen, origen y confianza. Se
conserva historial; el último valor tiene prioridad y solo se muestra tendencia
básica, sin predicciones. La vigencia contextual pierde confianza
progresivamente. Un dato fuera de rango recalcula solo módulos afectados y
deja hallazgo breve; no bloquea el resto.

## 9. Publicación, corrección y borrado

- Importar no publica: requiere validación de esquema, procedencia, licencia,
  cobertura y revisión.
- Activar corrección, regla, alimento o catálogo es acción manual del
  superadministrador.
- Toda revisión publicada es inmutable; se crea otra para corregir.
- Borrado permanente elimina los datos activos, exportaciones y enlaces; deja
  únicamente un marcador técnico irreversible en el ledger de continuidad
  externo. Las cuatro copias rotativas cargan y aplican esa exclusión antes de
  restaurar.

## 10. Métricas de calidad

Se deben poder calcular sin exponer datos clínicos al usuario:

- cobertura por fuente y por nutriente;
- discrepancias abiertas/cerradas;
- edad de la revisión;
- porcentaje de reglas `exact/allowed/review/excluded/insufficient`;
- cobertura de cesta por cadena;
- productos sin equivalencia confirmada;
- errores de importación y activaciones rechazadas.

## 11. Resolución efectiva

Para elegir una revisión de alimento canónico:

1. debe coincidir identidad, estado, parte comestible, denominador y método
   compatible;
2. se aplica el orden de fuentes;
3. dentro de la misma fuente se elige la revisión activa más reciente que haya
   pasado controles, no simplemente la fecha más nueva;
4. un empate o discrepancia material abre revisión y mantiene la revisión
   efectiva anterior;
5. el plan persiste el `effective_revision_id` exacto.

Actualizar una revisión o aprobar una corrección no muta planes activos.

## 12. Revisión manual de evidencia científica

La base científica se actualiza únicamente mediante revisiones manuales
solicitadas por el superadministrador. No existe actualización automática de
recomendaciones clínicas en V1.

Cada revisión sigue este flujo:

1. definir la pregunta, población, módulo, resultado y fecha de búsqueda;
2. buscar primero guías clínicas vigentes, revisiones sistemáticas y
   metaanálisis;
3. usar ensayos controlados para completar lagunas y observacionales como
   apoyo, sin elevar por sí solos la confianza;
4. registrar estrategia, fuentes examinadas, inclusión/exclusión, calidad,
   aplicabilidad y conflictos;
5. comparar la evidencia con la regla efectiva y clasificar el cambio como
   confirmación, ajuste, retirada o incertidumbre;
6. crear una `RuleRevision` candidata con casos positivo, negativo, límite y
   conflicto;
7. ejecutar los escenarios afectados y revisar beneficio, gravedad y confianza;
8. activar manualmente una nueva `RuleSetRevision`;
9. calcular qué planes podrían verse afectados y crear candidatos revisables,
   sin modificar planes activos.

La ausencia de evidencia nueva conserva la revisión anterior y registra la
fecha de comprobación. Una publicación aislada puede abrir una revisión, pero
no desplaza automáticamente una regla de mayor jerarquía.

## 13. Fuentes oficiales de referencia

Estas páginas son puntos de entrada, no sustituyen conservar el dataset,
versión, licencia y manifiesto exactos usados en cada importación:

- [ANSES-CIQUAL 2025](https://ciqual.anses.fr/cms/en/2025-anses-ciqual-table).
- [BLS 4.0](https://www.blsdb.de/) y
  [descarga/licencia](https://blsdb.de/download).
- [Fineli](https://fineli.fi/fineli/en/index).
- [Livsmedelsverkets Livsmedelsdatabas](https://soknaringsinnehall.livsmedelsverket.se/).
- [USDA FoodData Central](https://fdc.nal.usda.gov/) y
  [datasets descargables](https://fdc.nal.usda.gov/download-datasets/).
- [BEDCA](https://www.bedca.net/) y la
  [referencia institucional de AESAN](https://www.aesan.gob.es/AECOSAN/web/seguridad_alimentaria/subdetalle/composicion.htm).
- [FAO/INFOODS Standards and Guidelines](https://www.fao.org/infoods/infoods/standards-guidelines/en/).
- [Comisión Europea: etiquetado nutricional](https://food.ec.europa.eu/food-safety/labelling-and-nutrition/food-information-consumers-legislation/nutrition-labelling_en).

El importador conserva siempre el dato original. Cualquier conversión,
normalización o cálculo derivado vive en una capa separada y trazable. Esto es
especialmente importante cuando una fuente exige citar versión o no alterar
los datos publicados.
