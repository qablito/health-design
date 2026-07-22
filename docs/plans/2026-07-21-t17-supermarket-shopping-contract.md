# Contrato T17 — Catálogos de supermercado y compra consultiva

**Estado:** `T17_PLANNED`
**Fecha:** 2026-07-21
**Aprobación:** contrato funcional y arquitectónico confirmado por el usuario el
2026-07-21.
**Naturaleza de este documento:** planificación aprobada. No acredita código,
migraciones, importaciones, despliegues, activaciones ni validación local o remota.
**Puerta de implementación:** no se empezará ninguna implementación de T17 sin una
confirmación explícita posterior del usuario.

## 1. Resultado comprometido

T17 convertirá la lista nutricional semanal de una versión inmutable del plan en una
cesta de compra orientativa que permita:

1. conservar el supermercado habitual elegido por el usuario;
2. resolver alimentos canónicos a productos de Mercadona, DIA o ALDI mediante reglas
   revisadas y publicadas por cadena;
3. calcular envases completos, coste estimado y sobrante estimado usando únicamente
   contenido y precio base confirmados;
4. cambiar de producto dentro del mismo alimento sin alterar la nutrición;
5. comparar opcionalmente varias cadenas y asignar cada alimento al menor desembolso
   completo, aunque el ahorro sea de céntimos;
6. descontar únicamente sobrantes que el usuario haya confirmado;
7. conservar una instantánea reproducible para pantalla, impresión, PDF y XLSX.

El catálogo de supermercado será consultivo. No permitirá hacer pedidos, no mostrará
stock y no convertirá un SKU comercial en autoridad nutricional.

## 2. Alcance y fronteras

### 2.1 Incluido en T17 V1

- Mercadona, DIA y ALDI como candidatas iniciales independientes.
- Importación del catálogo disponible de cada cadena, incluidos registros sin precio.
- Captura fuente y artefacto normalizado inmutables en almacenamiento R2 privado.
- Revisión versionada por cadena y activación manual con AAL2.
- Catálogo completo consultable y subconjunto utilizable para cálculos.
- Cesta de publicación exacta de 80 alimentos: 60 fijos y 20 dinámicos.
- Matching independiente `cadena + SKU → CanonicalFood`.
- Formato estructurado, precio base, contenido neto y precio normalizado.
- Cesta monoestablecimiento y comparación multiestablecimiento opcional.
- Preferencia habitual editable y avisos de ahorro que nunca la sustituyen.
- Cambio manual de SKU aprobado dentro del mismo alimento canónico.
- Confirmación opcional de sobrantes.
- Orden idéntico en pantalla, impresión, PDF y XLSX.
- Cestas parciales con carencias y costes parciales explícitos.
- Auditoría técnica privada, aislamiento por perfil, idempotencia y límites de uso.

### 2.2 Excluido de T17 V1

- Compra, carrito transaccional, checkout o conexión con pedidos.
- Stock, disponibilidad por tienda o mensajes de existencias en tiempo real.
- Ofertas, cupones, fidelización, transporte, bolsas o pedidos mínimos.
- Elegir automáticamente una cadena habitual.
- Forzar un ahorro mínimo antes de comparar cadenas.
- Costes de desplazamiento, máximo de paradas u optimización de rutas.
- Sustituir un alimento nutricional por otro dentro del cambio de producto.
- Inferir kcal, macros o fibra a partir del producto del supermercado.
- Media automática entre fuentes discrepantes.
- Guardar imágenes de envases o etiquetas.
- Uso de Luna u otro LLM para importar, hacer matching, publicar o calcular la cesta.
- Actualización diaria, caducidad automática o fecha visible de actualización.
- Importación remota de Lidl, Consum o Alcampo.
- Cambios en producción.

### 2.3 Diferido

- Lidl, Consum y Alcampo como cadenas adicionales.
- Refresco automático diario y texto visible `Catálogo actualizado el…`.
- Automatización de nuevas capturas y alertas de deriva.
- Costes logísticos, rutas y límites de establecimientos, si se aprueban en otra versión.
- Cobertura geográfica real por provincia o tienda.

## 3. Lenguaje canónico

| Término | Significado contractual |
|---|---|
| `CanonicalFood` | Alimento genérico y estado culinario usado por el plan nutricional. |
| `SupermarketSku` | Identidad estable de un producto dentro del mercado V1 mediante `market + chain + external_sku`; en España se abrevia `cadena + SKU`. |
| `SupermarketCatalogRevision` | Lote importado, normalizado e inmutable de una cadena. |
| `SupermarketSkuRevision` | Observación inmutable de nombre, categoría, formato, contenido y precio de un SKU en una revisión. |
| `SupermarketSkuMatchingRuleRevision` | Decisión versionada que relaciona un SKU con, como máximo, un alimento canónico. |
| `CatalogPublication` | Activación manual de una revisión de cadena que ha superado su puerta de cobertura. |
| `BasketSeed` | Contrato versionado de 60 alimentos fijos y 20 dinámicos usado para medir cobertura. |
| `ShoppingPreferenceRevision` | Supermercado habitual, modo y orden elegidos por un perfil. |
| `ShoppingSnapshot` | Resultado inmutable y reproducible de una resolución de compra. |
| `LeftoverConfirmation` | Cantidad reutilizable declarada expresamente por el usuario. |
| Producto aprobado | SKU con revisión utilizable y matching `exact` o `allowed` activo. |
| Producto de catálogo | SKU visible por pertenecer a una revisión publicada, aunque no tenga datos suficientes para calcular. |

La ficha nutricional comercial T16 y el SKU de compra T17 son autoridades separadas. Un
GTIN coincidente no fusiona automáticamente ambas entidades.

## 4. Invariantes obligatorias

1. **T17-I01 — Nutrición estable.** Cambiar cadena, SKU, envase, precio o sobrante no
   cambia alimentos, cantidades nutricionales, kcal, macros, fibra ni sustituciones.
2. **T17-I02 — Preferencia soberana.** La cadena habitual nunca se cambia por ahorro.
3. **T17-I03 — Comparación voluntaria.** El modo multiestablecimiento solo se ejecuta
   tras una elección expresa y puede ahorrar cualquier cantidad positiva.
4. **T17-I04 — Sin stock.** La presencia en un catálogo publicado no se presenta como
   disponibilidad física actual.
5. **T17-I05 — Precio base.** No se incorporan ofertas ni costes ajenos al envase.
6. **T17-I06 — Envase confirmado.** Sin contenido neto estructurado no se calculan
   paquetes, coste ni precio normalizado.
7. **T17-I07 — Precio confirmado.** Sin precio base válido el SKU puede mostrarse como
   `Precio no disponible`, pero no participa en cálculos ni cobertura.
8. **T17-I08 — Desconocido no es cero.** Una línea incompleta conserva su carencia y
   no se suma como coste cero.
9. **T17-I09 — Total parcial honesto.** Una cesta con líneas sin resolver muestra un
   subtotal parcial y nunca se denomina cesta completa ni más barata.
10. **T17-I10 — Estado estricto.** `foodState=raw|cooked|unspecified` se combina con
    una forma de compra explícita (`dry`, `fresh`, `drained`, `canned`, `natural`,
    `prepared` o `marinated`). T17 no equipara combinaciones distintas ni aplica
    rendimientos de cocción.
11. **T17-I11 — Dimensiones compatibles.** Solo se comparan cantidades de la misma
    dimensión o con una equivalencia expresamente confirmada.
12. **T17-I12 — Un vínculo por SKU.** Un SKU tiene como máximo un alimento canónico
    activo; un alimento puede tener varios SKU aprobados.
13. **T17-I13 — Exclusiones primero.** Un producto incompatible o incierto para una
    alergia nunca se selecciona automáticamente para ese perfil.
14. **T17-I14 — Sobrante explícito.** Solo se descuenta la cantidad confirmada; el
    remanente calculado es informativo y no se arrastra a otra semana.
15. **T17-I15 — Snapshot inmutable.** Toda modificación crea una revisión nueva y deja
    archivada la anterior.
16. **T17-I16 — Reproducción histórica.** Una actualización de catálogo no reescribe
    snapshots antiguos ni exportaciones ya creadas.
17. **T17-I17 — Publicación independiente.** Una cadena puede activarse o rechazarse sin
    condicionar a las otras dos.
18. **T17-I18 — Decisión humana.** Matching, publicación y ocultación requieren acción
    administrativa manual; no existe publicación automática.
19. **T17-I19 — Resolver determinista.** El cálculo no usa LLM, aleatoriedad ni red.
20. **T17-I20 — Misma proyección.** Pantalla, impresión, PDF y XLSX consumen el mismo
    `ShoppingSnapshot` y mantienen orden y cifras.
21. **T17-I21 — Autoridades paralelas coherentes.** El matching cadena+SKU de T17 no
    sobrescribe el matching GTIN de T16. Si un SKU enlazado a un GTIN contradice su regla
    T16 activa, el candidato T17 queda en `review` hasta una decisión manual.
22. **T17-I22 — Conversión documentada.** Una necesidad en gramos solo se compara con
    volumen o unidades cuando la revisión del SKU contiene una equivalencia de masa
    comestible confirmada y con evidencia; nunca se asume `1 ml = 1 g`.

## 5. Cesta de publicación 60 + 20

T17-P0 ampliará el núcleo oficial del generador con exactamente los alimentos necesarios
para evaluar la cesta. No se importará el catálogo CIQUAL completo en esta tarea.

### 5.1 Núcleo fijo de 60

#### Proteínas — 16

1. Pechuga de pollo cruda.
2. Contramuslo de pollo sin piel crudo.
3. Pechuga de pavo cruda.
4. Vacuno magro crudo.
5. Lomo de cerdo crudo.
6. Conejo crudo.
7. Huevo de gallina.
8. Merluza cruda.
9. Salmón crudo.
10. Bacalao crudo.
11. Atún al natural escurrido.
12. Langostino pelado crudo.
13. Calamar crudo.
14. Tofu firme natural.
15. Soja texturizada seca.
16. Seitán natural.

#### Verduras y hortalizas — 12

1. Tomate.
2. Cebolla.
3. Pimiento rojo.
4. Zanahoria.
5. Calabacín.
6. Berenjena.
7. Brócoli.
8. Coliflor.
9. Espinaca.
10. Lechuga romana.
11. Pepino.
12. Judía verde.

#### Frutas — 8

1. Manzana.
2. Plátano.
3. Naranja.
4. Mandarina.
5. Pera.
6. Kiwi.
7. Fresa.
8. Melón.

#### Cereales, tubérculos y legumbres — 12

1. Arroz blanco seco.
2. Pasta seca.
3. Pan integral.
4. Avena.
5. Cuscús seco.
6. Quinoa seca.
7. Patata.
8. Boniato.
9. Lenteja seca.
10. Garbanzo seco.
11. Alubia seca.
12. Guisante.

#### Lácteos y alternativas — 6

1. Leche semidesnatada.
2. Yogur natural sin azúcar.
3. Queso fresco de Burgos.
4. Queso semicurado de vaca.
5. Bebida de soja sin azúcar enriquecida con calcio.
6. Queso fresco batido natural.

#### Grasas, frutos secos y semillas — 6

1. Aceite de oliva virgen extra.
2. Aguacate.
3. Almendra natural.
4. Nuez natural.
5. Chía.
6. Lino molido.

### 5.2 Conjunto dinámico inicial de 20

La primera revisión activa usa estos 20 alimentos, procedentes de una reserva versionada.
Una revisión posterior solo puede cambiarlos por frecuencia real de uso y con aprobación
administrativa explícita.

#### Proteínas — 6

1. Sardina en conserva escurrida.
2. Caballa en conserva escurrida.
3. Mejillón cocido sin salsa.
4. Dorada cruda.
5. Cordero magro crudo.
6. Tempeh natural.

#### Verduras y hortalizas — 5

1. Calabaza.
2. Alcachofa al natural escurrida.
3. Espárrago verde.
4. Champiñón.
5. Puerro.

#### Frutas — 5

1. Mango.
2. Melocotón.
3. Arándano.
4. Uva.
5. Piña.

#### Cereales, tubérculos y legumbres — 2

1. Trigo sarraceno seco.
2. Maíz dulce cocido escurrido.

#### Lácteos y alternativas — 2

1. Kéfir natural.
2. Bebida de avena sin azúcar enriquecida con calcio.

### 5.3 Regla de revisión de la reserva

- La cesta activa contiene siempre 60 fijos y exactamente 20 dinámicos.
- Los 20 dinámicos se ordenan por frecuencia de aparición en versiones de plan, con
  agregados no identificables y una ventana documentada.
- El candidato se calcula bajo demanda desde `NutritionWeek.shoppingList` de las versiones
  activas dentro de un rango `from/to` obligatorio: cada alimento cuenta como máximo una
  aparición por versión. No se crea un historial analítico nuevo ni una tabla de
  frecuencias por perfil. La eliminación de un perfil afecta al siguiente candidato, no a
  semillas históricas ya publicadas.
- Si no hay 20 candidatos con uso suficiente, se completa desde esta reserva versionada.
- Empates: frecuencia descendente, grupo, clave canónica ascendente.
- Ningún cambio se activa automáticamente; el superadministrador revisa el candidato y
  publica una versión nueva de `BasketSeed` con AAL2.
- Un cambio de semilla no altera publicaciones ni snapshots históricos.

En la semilla inicial, los grupos completos contienen 22 proteínas, 17 verduras y
hortalizas, 13 frutas, 14 cereales/tubérculos/legumbres, 8 lácteos/alternativas y 6
grasas/frutos secos/semillas. El mínimo de grupo es siempre
`ceil(0,75 × tamaño_del_grupo)`: 17, 13, 10, 11, 6 y 5 respectivamente.

## 6. Arquitectura elegida

T17 se implementará como un módulo de dominio profundo, puro y determinista:

```ts
resolveShopping(input: ShoppingResolutionInput): Promise<ShoppingSnapshot>
```

### 6.1 Responsabilidades

- `@health-design/engine/shopping` recibe una lista nutricional agregada, preferencias,
  revisiones publicadas, SKU aprobados, sobrantes y elecciones manuales ya autorizados.
- El módulo valida compatibilidad, calcula opciones, elige envases, agrupa por cadena,
  ordena y produce un snapshot completo.
- No consulta PostgreSQL, R2, internet ni variables de entorno.
- Un adaptador fino de Supabase carga la entrada autorizada y persiste el snapshot.
- Web, impresión y exportadores solo proyectan ese snapshot; no recalculan compras.

### 6.2 Reutilización obligatoria

- La cantidad semanal procede de `NutritionWeek.shoppingList`; no se vuelve a sumar la
  dieta en T17.
- Se reutilizan las utilidades decimales del motor.
- Se amplía el modelo canónico de exportación T15; PDF y XLSX no crean un segundo motor.
- Se reutilizan autorización, AAL2, auditoría, idempotencia, rate limit, borrado y
  snapshots versionados ya existentes.
- No se añade una dependencia nueva para matemáticas, scraping, XLSX o PDF.

## 7. Modelo mínimo de datos

### 7.1 Catálogo y publicación

| Entidad | Campos mínimos |
|---|---|
| `SupermarketSourceManifest` | `id`, `market`, `chain`, `source_kind`, `source_location_internal`, `collected_at`, `importer_version`, `canonicalization_version`, `raw_object_ref`, `normalized_object_ref`, `capture_evidence_ref`, `error_evidence_ref?`, `raw_sha256`, `normalized_sha256`, `record_count`, `price_count`, `error_count`, `coverage`, `license_status`, `source_terms_status`, `created_at` |
| `SupermarketCatalogRevision` | `id`, `market`, `chain`, `manifest_id`, `revision_number`, `state=quarantine\|review\|publishable\|published\|hidden`, `quality_status=current\|review_due\|degraded`, `record_count`, `usable_count`, `observed_at`, `created_at`, `supersedes_id?` |
| `SupermarketSku` | `id`, `market`, `chain`, `external_sku`, `gtin14?`, `created_at`; única por `market + chain + external_sku` |
| `SupermarketSkuRevision` | `id`, `catalog_revision_id`, `sku_id`, `name`, `category_path`, `format_text`, `purchase_form`, `package?`, `equivalent_edible_mass_g?`, `equivalence_evidence?`, `base_price_eur?`, `normalized_price?`, `source_fields`, `usability`, `exclusion_reasons`, `content_hash` |
| `SupermarketSkuMatchingRuleRevision` | `id`, `sku_id`, `canonical_food_id`, `match_state`, `criteria`, `evidence`, `exclusions`, `gtin_consistency`, `version`, `status=draft\|active\|superseded\|withdrawn`, `supersedes_id?`, `reviewed_by`, `activated_at?` |
| `BasketSeedRevision` | `id`, `version`, `fixed_keys`, `dynamic_keys`, `usage_window`, `calculation_hash`, `status=draft\|active\|superseded`, `activated_at?` |
| `CatalogPublication` | `id`, `market`, `chain`, `catalog_revision_id`, `basket_seed_revision_id`, `coverage`, `source_use_decision`, `published_by`, `published_at`, `hidden_by?`, `hidden_at?` |

`SupermarketSourceManifest` permanece separado de `SourceManifest` nutricional porque la
fuente, licencia, transformaciones y autoridad son distintas. Ambos conservan SHA-256,
versiones y trazabilidad compatible.

### 7.2 Perfil y cesta

| Entidad | Campos mínimos |
|---|---|
| `ShoppingPreferenceRevision` | `id`, `profile_id`, `preferred_chain`, `mode=single\|multistore`, `compared_chains`, `sorting`, `supersedes_id?`, `created_by`, `created_at` |
| `ShoppingSnapshot` | `id`, `profile_id`, `plan_version_id`, `preference_revision_id`, `catalog_publication_ids`, `basket_seed_revision_id`, `input_digest`, `revision`, `supersedes_id?`, `status=active\|archived`, `snapshot`, `created_by`, `created_at` |
| `LeftoverConfirmation` | `id`, `shopping_snapshot_id`, `canonical_food_key`, `declared_measure`, `equivalent_quantity_g`, `equivalence_evidence_ref?`, `confirmed_by`, `confirmed_at` |

Los artículos del snapshot se guardan como JSONB validado. Para un máximo de 80 líneas
no se introduce una tabla duplicada de partidas en V1.

## 8. Adquisición, normalización y R2

### 8.1 Evidencia local externa al worktree

El material local no rastreado del worktree principal, fechado el 2026-07-16, se leyó con
un parser CSV consciente de campos entrecomillados y contiene:

| Cadena | Registros | Con precio base |
|---|---:|---:|
| Mercadona | 4.314 | 4.313 |
| DIA | 7.661 | 5.848 |
| ALDI | 1.696 | 1.525 |

La primera importación candidata comprende exactamente 13.671 registros
(`4.314 + 7.661 + 1.696`). Incluye 41 filas con estado de error de captura —39 ALDI y 2
DIA— que deben conservarse en el manifest de entrada, pero no son SKU utilizables ni
aportan cobertura. Los registros sin precio se conservan en el catálogo, pero tampoco son
utilizables para cobertura ni cálculo.

Esos archivos no existen en el worktree de planificación ni están versionados: sus cifras
son evidencia local externa, no un artefacto reproducible de T17. Antes de importar se
deben aportar captura, manifest y hashes verificables. Los activos locales adicionales de
Lidl, Consum y Alcampo no se importarán de forma remota en T17 V1. `datos/` y
`supermercados/` no se añaden al repositorio.

### 8.2 Evidencia inmutable

Por cada cadena y captura se almacenan en R2 privado de desarrollo:

1. captura fuente exacta;
2. artefacto normalizado exacto;
3. SHA-256 de ambos objetos;
4. cadena, tipo de fuente, fecha de captura, ubicación interna e importador;
5. versión del esquema, conteos y resultado de validación;
6. licencia y estado documental de términos: `approved`, `restricted` o `unknown`;
7. decisión de uso por entorno y evidencia que la sustenta.

El backend guarda referencias opacas y hashes, no URLs públicas. R2 no se consulta al
resolver cestas. DIA y ALDI requieren regenerar evidencia fuente antes de su primera
publicación candidata. Mercadona conserva la ubicación 41006 solo como metadato interno;
la referencia Sevilla nunca se muestra al usuario.

El bucket V1 de desarrollo será `health-design-catalog-source-dev`, con jurisdicción EU.
No se crea binding de runtime porque la ingestión usa Wrangler CLI y el resolver solo lee
datos normalizados desde PostgreSQL. T17 no crea ni toca un bucket de producción.

### 8.3 Cuarentena e idempotencia

- Todo registro externo entra en cuarentena.
- El normalizador rechaza claves duplicadas contradictorias, números no finitos,
  monedas distintas de EUR y contenido negativo o nulo.
- Reimportar el mismo hash no crea otra revisión.
- Un hash distinto crea una revisión nueva; nunca sobrescribe la anterior.
- Los campos fuente completos se conservan para auditoría, pero solo los campos
  estructurados aprobados llegan al resolver.
- Un estado `unknown` nunca supera la puerta de publicación. `restricted` solo puede
  activarse en un entorno cuyo uso documentado esté expresamente permitido; producción
  requiere su propia decisión posterior. El estado no se presenta al usuario.
- La activación técnica en desarrollo no constituye permiso jurídico ni publicación en
  producción.
- El importador admite como máximo 25 MiB por archivo, 100.000 filas, 200 columnas,
  2 KiB por celda y 100 MiB descomprimidos; procesa en streaming y rechaza archivos
  anidados, URL arbitrarias, redirecciones y bombas de compresión antes de persistir.

## 9. Formato, contenido y unidades

### 9.1 Paquete estructurado

```ts
type SaleMeasure =
  | { dimension: "mass"; quantity: DecimalString; unit: "g" }
  | { dimension: "volume"; quantity: DecimalString; unit: "ml" }
  | { dimension: "count"; quantity: DecimalString; unit: "unit" };

type ConfirmedPackage = {
  saleMeasure: SaleMeasure;
  // Obligatorio para calcular contra NutritionWeek.shoppingList.amountG cuando
  // saleMeasure no usa masa. Nunca se infiere sin evidencia revisada.
  equivalentEdibleMassG: DecimalString | null;
  equivalenceEvidenceRef: string | null;
};
```

- Formatos claros se analizan de forma determinista.
- Multipacks se normalizan multiplicando unidades y contenido únicamente cuando ambos
  valores son inequívocos.
- Formatos variables, rangos, promociones o texto ambiguo pasan a revisión manual.
- Un paquete sin confirmar puede mostrarse en catálogo, pero no entra en cobertura,
  totales o comparación.
- La necesidad canónica V1 permanece en gramos. Un envase por volumen o unidades solo es
  calculable si su revisión aporta `equivalentEdibleMassG` confirmado. La equivalencia
  forma parte de la revisión del SKU y nunca modifica la nutrición.

### 9.2 Precio normalizado

- Sólidos: EUR/kg.
- Líquidos: EUR/L.
- Contables: EUR/unidad.
- El precio normalizado deriva del precio base y contenido confirmado.
- No se convierte masa a volumen, masa a unidad ni volumen a unidad sin equivalencia
  explícita, versionada y confirmada.
- Las opciones incomparables aparecen después de las comparables.
- La cesta usa siempre el coste de envases completos, no el precio normalizado.

## 10. Matching canónico

### 10.1 Generación de candidatos

Un proceso determinista usa nombre, categoría, formato, ingredientes cuando existan,
estado y exclusiones. Produce candidatos, nunca reglas activas.

- No usa Luna ni similitud generativa.
- Solo se revisan prioritariamente candidatos necesarios para la cesta 60 + 20.
- Un SKU puede tener cero o una regla activa.
- Un alimento canónico puede tener muchos SKU activos de una o varias cadenas.
- Los SKU no revisados permanecen visibles como catálogo, pero no se seleccionan.
- Cuando el SKU contiene GTIN, el candidato T17 contrasta su alimento canónico con la
  regla T16 activa. La concordancia se registra; una discrepancia fuerza `review`. Cada
  regla conserva su identidad y ninguna sobrescribe a la otra.

### 10.2 Estados

- `exact`: misma identidad, estado y parte comestible.
- `allowed`: variante aceptada por una regla explícita sin cambiar la función de compra.
- `review`: candidato plausible que necesita decisión.
- `excluded`: incompatibilidad conocida.
- `insufficient`: datos insuficientes para decidir.

Solo `exact` y `allowed` activos pueden cubrir la cesta o entrar en el resolver. Un cambio
de identidad, ingredientes, formato relevante o estado genera una revisión de matching.
Un cambio exclusivo de precio no cambia la identidad.

## 11. Puerta de cobertura y publicación

Un alimento canónico está cubierto por una revisión candidata si tiene al menos un SKU:

1. perteneciente a esa cadena y revisión;
2. con regla activa `exact` o `allowed`;
3. compatible en estado y parte comestible;
4. con paquete estructurado confirmado;
5. con precio base EUR válido;
6. no retirado, excluido ni descartado.

Una cadena es publicable si cumple simultáneamente:

- al menos 72 de los 80 alimentos activos;
- al menos `ceil(0,75 × N)` en cada grupo: 17/22 proteínas, 13/17 verduras,
  10/13 frutas, 11/14 cereales/tubérculos/legumbres, 6/8 lácteos/alternativas y
  5/6 grasas/frutos secos/semillas en la semilla inicial;
- los dinámicos computan dentro de su grupo real;
- ninguna inconsistencia crítica abierta en los SKU que aportan cobertura;
- manifiesto, revisión y hashes íntegros;
- decisión de uso de fuente permitida para el entorno objetivo;
- activación manual del superadministrador con AAL2.

`review`, `excluded`, `insufficient`, paquete ambiguo o precio ausente no cuentan. Las
pruebas de alergias son una puerta separada: un producto cubierto globalmente puede quedar
fuera para un perfil concreto.

La revisión publicada no caduca ni se oculta automáticamente. `review_due` y `degraded`
son decisiones internas obtenidas durante una revisión administrativa, no temporizadores:
la primera alerta y la segunda impide publicar esa revisión como candidata nueva. Ninguna
de las dos muta una publicación activa; el superadministrador debe ocultarla o sustituirla
manualmente. Fecha y ubicación se conservan internamente, pero V1 no muestra fecha de
catálogo al usuario y siempre califica los precios como orientativos.

## 12. Resolución y optimización

Para cada línea nutricional semanal:

```text
necesidad = max(0, cantidad_semanal - sobrante_confirmado)
capacidad_compatible = contenido_en_g o equivalente_comestible_confirmado_en_g
envases = ceil(necesidad / capacidad_compatible)
coste = envases × precio_base
remanente_estimado = envases × capacidad_compatible - necesidad
```

Los cálculos usan decimal exacto y redondean solo al presentar moneda.

### 12.1 Selección de producto

Entre candidatos válidos de una cadena:

1. menor desembolso por envases completos;
2. menor remanente estimado;
3. menor precio normalizado;
4. `market + chain + external_sku` ascendente.

Una elección manual válida prevalece y recalcula paquetes, coste y remanente. Si deja de
ser válida en una revisión nueva, el resolver no la reemplaza silenciosamente: la línea
queda pendiente hasta que el usuario elija o acepte otra opción.

### 12.2 Monoestablecimiento

- Se usa exclusivamente la cadena elegida.
- Una alternativa más barata en otra cadena se muestra como aviso opcional.
- El aviso nunca cambia la cesta ni la preferencia guardada.
- Las líneas sin candidato válido permanecen como `Sin producto confirmado`.

### 12.3 Multiestablecimiento

- El usuario selecciona las cadenas que desea comparar.
- Cada alimento se asigna al menor desembolso completo entre ellas.
- Puede usar todas las cadenas seleccionadas.
- No existe umbral mínimo de ahorro.
- No se consideran desplazamiento, número de paradas ni pedido mínimo.
- La comparación parcial muestra subtotal comparable, líneas pendientes y cobertura; no
  proclama una cesta ganadora completa cuando las coberturas difieren.

### 12.4 Sobrantes

- La introducción es opcional y controlada.
- Solo se descuenta un valor confirmado y compatible en unidad.
- Si el usuario declara volumen o unidades, la confirmación congela también su equivalente
  en gramos y la revisión de equivalencia usada. Sin equivalencia confirmada no se descuenta.
- El remanente estimado del snapshot actual es informativo.
- Nunca se convierte en sobrante confirmado ni se lleva a otra semana automáticamente.
- Cambiar un sobrante crea un snapshot derivado y archiva el anterior.

## 13. Preferencias, snapshots y flujo de usuario

1. Si el perfil no tiene supermercado habitual, la primera apertura de compra solicita
   una elección; no se preselecciona el más barato.
   Una preferencia heredada fuera de Mercadona, DIA o ALDI se conserva como dato no
   compatible, no se coerciona y obliga a escoger una cadena V1 antes de calcular.
2. La preferencia se guarda como revisión editable del perfil.
3. La apertura desde un plan activo crea o recupera el snapshot idempotente para esa
   versión, preferencia, publicaciones, sobrantes y elecciones.
4. `Cambiar producto` muestra otros SKU aprobados del mismo alimento canónico.
5. `Sustituir alimento` usa el flujo nutricional existente, recalcula el plan completo y
   exige candidato y activación manual; no es una acción de T17.
6. Activar comparación multiestablecimiento crea un snapshot nuevo, sin editar la
   preferencia habitual salvo acción expresa separada.
7. Cambiar cadena, SKU, sobrante, orden o revisión de catálogo crea una nueva revisión de
   snapshot. La anterior queda archivada.
8. Una publicación nueva no cambia snapshots históricos.

El `input_digest` incluye versión del plan, revisión de preferencia, publicaciones,
sobrantes y sus equivalencias, elecciones manuales y versión del resolver. La misma entrada
devuelve el mismo resultado lógico; una clave de idempotencia reutilizada con otra entrada
devuelve conflicto.

## 14. Presentación y exportación

### 14.1 Contenido de una línea

- alimento y cantidad semanal requerida;
- cadena y producto seleccionado;
- precio base y contenido del envase;
- número de envases;
- coste orientativo;
- remanente estimado;
- precio normalizado cuando sea comparable;
- estado `resuelto`, `precio no disponible`, `paquete sin confirmar` o
  `sin producto confirmado`.

No se muestran kcal ni macros del SKU. Esos valores siguen perteneciendo al alimento
pautado en la dieta.

### 14.2 Agrupación y orden

- La cadena habitual aparece primero.
- Las demás cadenas aparecen en orden alfabético.
- Orden predeterminado dentro de cada cadena: precio normalizado ascendente.
- Alternativas: precio ascendente, precio descendente, nombre A–Z y nombre Z–A.
- Opciones no comparables aparecen después de las comparables con desempate estable.
- El orden elegido se conserva de forma idéntica en pantalla, impresión, PDF y XLSX.

### 14.3 Totales

- `estimatedTotal` solo existe como total completo si todas las líneas requeridas están
  resueltas con coste.
- Una cesta incompleta expone `partialSubtotal`, recuento de líneas y cobertura.
- Los avisos de ahorro comparan únicamente universos equivalentes y declaran cuando la
  comparación es parcial.
- Todos los precios se muestran como orientativos, sin revelar la ubicación Sevilla.

### 14.4 PDF, XLSX e impresión

T15 se amplía con una referencia opcional al `ShoppingSnapshot` de la misma versión del
plan. El servidor verifica esa relación. El modelo de exportación incluye exactamente las
líneas, orden, agrupación, totales y carencias del snapshot. La lista canónica de
ingredientes sigue disponible cuando el usuario no selecciona una cesta T17.

Los nombres externos se escapan en HTML/PDF y se neutralizan en XLSX cuando comienzan por
`=`, `+`, `-`, `@`, tabulador o retorno de carro. No se crean macros ni enlaces activos.
Los artefactos siguen en almacenamiento privado y se descargan mediante el proxy T15 con
`Cache-Control: no-store, private` y `Referrer-Policy: no-referrer`. Archivar un snapshot
no invalida su exportación histórica; la purga terminal del perfil elimina sus artefactos
y objetos privados antes de completarse.

## 15. Superficie API V1

| Operación | Resultado |
|---|---|
| `GET /v1/catalogs?chain=&cursor=&limit=` | Devuelve una página de la revisión publicada y sus SKU visibles, sin metadatos internos de captura. |
| `PUT /v1/profiles/{id}/shopping-preference` | Crea una nueva revisión de preferencia. |
| `POST /v1/plans/{version_id}/shopping` | Crea o recupera un snapshot para la entrada confirmada. |
| `GET /v1/shopping/{id}` | Devuelve un snapshot autorizado e inmutable. |
| `POST /v1/shopping/{id}/leftovers` | Crea un snapshot derivado con un sobrante confirmado. |
| `POST /v1/shopping/{id}/product-selection` | Crea un snapshot derivado con otro SKU aprobado del mismo alimento. |
| `GET /v1/admin/catalog-revisions?chain=&state=&cursor=` | Lista revisiones en cuarentena/revisión/publicables. |
| `POST /v1/admin/catalog-revisions/{id}/match-candidates` | Genera candidatos deterministas de matching. |
| `POST /v1/admin/matching-rules/{id}/activate` | Activa una regla revisada con AAL2. |
| `POST /v1/admin/catalog-revisions/{id}/publish` | Publica si la puerta 60 + 20 pasa. |
| `POST /v1/admin/catalog-publications/{id}/hide` | Oculta una publicación sin borrar historia. |

`GET /v1/catalogs` exige sesión y membresía de un perfil accesible, acepta una sola query
`chain=mercadona|dia|aldi`, un cursor opaco opcional y `limit` predeterminado 50/máximo
100. Ordena establemente por `skuId`, sirve únicamente la publicación activa y nunca
devuelve manifest, ubicación, términos, hashes ni referencias R2.

Contratos públicos mínimos:

```ts
type ShoppingPreferencePut = {
  schemaVersion: 1;
  expectedVersion: number | null;
  preferredChain: SupermarketChain;
  mode: "single" | "multistore";
  comparedChains: SupermarketChain[];
  sorting: ShoppingSort;
};

type ShoppingCreateRequest = {
  schemaVersion: 1;
  preferenceRevisionId: string;
};

type ShoppingLeftoverRequest = {
  schemaVersion: 1;
  expectedVersion: number;
  canonicalFoodKey: string;
  declaredMeasure: SaleMeasure;
  skuRevisionId?: string;
};

type ShoppingProductSelectionRequest = {
  schemaVersion: 1;
  expectedVersion: number;
  canonicalFoodKey: string;
  skuId: string;
};
```

El identificador del perfil se resuelve por la versión del plan o el snapshot; nunca se
acepta desde el cuerpo. Las mutaciones requieren `Idempotency-Key`; las administrativas
añaden `expectedVersion`, AAL2 y TOTP reciente. Cuerpos máximos, cardinalidades y
respuestas ACK quedan cerrados en `packages/contracts/src/shopping.ts` antes de crear la
primera migración. Errores públicos mínimos:

Para sobrantes, el servidor convierte `declaredMeasure` a gramos. Masa usa conversión
decimal exacta; volumen o unidades exigen `skuRevisionId` perteneciente al mismo alimento y
una equivalencia confirmada. El cliente no puede aportar su propio factor de conversión.

- `UNAUTHENTICATED`, `FORBIDDEN`, `AAL2_REQUIRED`;
- `INVALID_INPUT`, `PAYLOAD_TOO_LARGE`, `RATE_LIMITED`;
- `IDEMPOTENCY_KEY_REUSED`, `STALE_PLAN_VERSION`;
- `NUTRITION_MODULE_REQUIRED`, `CATALOG_NOT_PUBLISHED`;
- `SHOPPING_SKU_NOT_CALCULABLE`, `SHOPPING_SKU_MATCH_EXCLUDED`,
  `SHOPPING_SKU_MATCH_REVIEW_REQUIRED`;
- `SHOPPING_SNAPSHOT_MISMATCH`, `CATALOG_PUBLICATION_GATE_FAILED`;
- `DEPENDENCY_UNAVAILABLE`, `INTERNAL_ERROR`.

## 16. Seguridad, privacidad y operaciones

- Todas las lecturas de perfil y snapshots validan JWT, actor, sesión, membresía y RLS.
- El identificador de snapshot no es una capacidad de acceso.
- Las tablas administrativas deniegan acceso a usuarios comunes.
- Matching, publicación y ocultación requieren superadministrador AAL2 y auditoría de
  `intent` y `outcome`.
- Los eventos técnicos no guardan respuestas clínicas ni alias.
- Los objetos R2 son privados, cifrados por el proveedor y referenciados con nombres
  opacos; no se sirven a usuarios.
- La primera activación remota exige copia cifrada precrítica y verificada.
- La eliminación permanente del perfil purga preferencias, sobrantes, snapshots,
  vínculos de exportación y objetos privados dependientes antes de finalizar. No borra
  catálogos compartidos ni manifiestos sin datos personales.
- El resolver admite una operación concurrente, 30 resoluciones por perfil y hora,
  60 por actor y hora y 100 por IP y hora. Un `429` devuelve `Retry-After` y
  `request_id`; un replay idempotente exacto no consume otra cuota. La lectura paginada de
  catálogo admite cuatro solicitudes concurrentes, 120 por actor y hora y 240 por IP y
  hora, con el mismo esquema `429`.
- Una segunda operación concurrente con la misma entrada recupera el handle existente.
- Producción no se modifica en T17; cualquier promoción posterior tendrá su propia
  autorización y evidencia.

## 17. Pruebas e invariantes de aceptación

### 17.1 Unidad y contrato

- parser de envases claros, multipacks, ambiguos y variables;
- precio EUR/kg, EUR/L y EUR/unidad con decimal exacto;
- rechazo de conversiones entre dimensiones;
- identidad estable `market + chain + external_sku`;
- una única regla activa por SKU;
- conteo exacto 60 + 20;
- 72/80 y 75 % por grupo;
- combinación estricta de `foodState=raw|cooked|unspecified` con
  `purchaseForm=dry|fresh|drained|canned|natural|prepared|marinated`;
- selección y desempates deterministas;
- sobrante confirmado frente a remanente estimado;
- totales completos y parciales;
- invariancia nutricional al cambiar SKU o cadena.

### 17.2 Base de datos y seguridad

- RLS cruzada entre dos perfiles;
- usuario común rechazado en tablas administrativas;
- AAL1 rechazado y AAL2 aceptado para activar/ocultar;
- auditoría `intent/outcome` incluso ante fallo;
- idempotencia y concurrencia;
- historial inmutable y `supersedes_id` coherente;
- purga de preferencias, sobrantes y snapshots;
- catálogo compartido preservado tras borrar un perfil.

### 17.3 Funcional y E2E

- cesta Mercadona con cobertura suficiente;
- publicación independiente de DIA y ALDI;
- cadena que no llega a 72/80 rechazada sin afectar a las demás;
- supermercado habitual conservado ante aviso de ahorro;
- comparación de céntimos sin umbral;
- multiestablecimiento usa solo cadenas seleccionadas;
- línea sin precio o paquete queda pendiente y no suma cero;
- cambio manual de producto recalcula solo compra;
- `Sustituir alimento` sigue el candidato nutricional;
- orden y cifras idénticos en web, impresión, PDF y XLSX;
- snapshot antiguo estable después de publicar un catálogo nuevo;
- ninguna interfaz muestra stock, Sevilla ni fecha visible de catálogo.

## 18. Puertas de salida T17

T17 solo podrá marcarse `T17_COMPLETE_REMOTE_PASS` cuando exista evidencia de:

1. T17-P0 activo con exactamente 60 fijos y 20 dinámicos provenientes de la reserva
   versionada en desarrollo.
2. Tests, lint, tipos, contratos Edge y build en verde.
3. Captura fuente y normalizada de las tres candidatas en R2 privado con hashes
   verificados; si una cadena no supera su gate, queda no publicada de forma explícita.
4. Migraciones aplicadas en desarrollo y RLS probada con dos perfiles.
5. AAL1 rechazado y AAL2 aceptado en matching/publicación/ocultación.
6. Al menos una cadena publicada únicamente después de superar 72/80 y 75 % por grupo.
7. Cesta monoestablecimiento, multiestablecimiento, sobrantes y cambio de SKU validados
   contra cálculos independientes.
8. PDF, XLSX e impresión equivalentes al mismo snapshot.
9. Purga remota verificada y catálogo compartido intacto.
10. Evidencia documental con IDs, hashes no sensibles, conteos, comandos y resultados.
11. Runbook `catalog-publication.md` verificado para importación, publicación, ocultación,
    rollback manual y limpieza.

Una cadena que no supere su puerta no impide cerrar el motor T17 si queda claramente como
`not_published` y las demás pruebas cubren el flujo. No se afirmará que una cadena está
publicada sin evidencia de activación remota.

## 19. Tramos de implementación

- **T17-P0:** ampliar por la vía oficial el catálogo nutricional con los 60 fijos y 20 de
  reserva; no importar CIQUAL completo.
- **T17A:** contratos de compra, semilla, parser, normalización, importadores endurecidos y
  evidencia R2.
- **T17B:** persistencia de catálogo, matching, cobertura, publicación y administración.
- **T17C:** resolver puro, mono/multiestablecimiento, sobrantes, elecciones y orden.
- **T17D:** API, preferencias, snapshots, UI, idempotencia, rate limit y borrado.
- **T17E:** impresión/PDF/XLSX, E2E, documentación, copia, despliegue y validación remota.

La finalización de este contrato no inicia ninguno de esos tramos. El siguiente paso
requiere que el usuario confirme expresamente el plan de implementación T17.
