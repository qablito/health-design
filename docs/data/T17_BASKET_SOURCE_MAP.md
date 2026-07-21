# T17-P0: mapa oficial de la cesta 60 + 20

Estado: `T17_P0_LOCAL_PASS`
Fecha de recuperación reproducible: `2026-07-21T00:00:00.000Z`

## Contrato aplicado

- La cesta confirmada contiene 60 alimentos fijos y 20 de reserva, todos con identidad canónica, forma, estado, porción comestible, fuente y código exactos.
- El núcleo del generador contiene además los ocho alimentos heredados de T10. Total: 88 revisiones.
- Ningún catálogo de supermercado aporta valores nutricionales. Los SKU y precios de T17 se enlazarán después con estas identidades canónicas.
- Las fuentes se importan como lotes privados en cuarentena. Esta fase no activa ni despliega datos remotos.
- CIQUAL `traces` se conserva en el parser. Solo cuando afecta a uno de los cinco macronutrientes numéricos obligatorios del generador se materializa explícitamente como `0`, con la transformación `trace:required_generator_nutrients_as_zero`. Los estados `missing` y `less_than` no se convierten.
- `Lino molido` usa la composición oficial de semilla de lino CIQUAL `15034`: el molido es presentación física y no aplica rendimiento ni conversión nutricional.

## Artefactos oficiales verificados

| Fuente | Versión | Selección importada | Artefacto bruto SHA-256 | Referencia oficial |
|---|---:|---:|---|---|
| CIQUAL | 2025 | 69 | `5555c572fa3735991298d832d0427788fa69a11b4fd20a5d580d58942369fbb0` | [DOI 10.57745/RPWYZD](https://entrepot.recherche.data.gouv.fr/api/access/datafile/:persistentId?persistentId=doi:10.57745/RPWYZD) |
| Fineli | 20.0 | 15 | `036de08cd1a95f9aab8f0020661190a92485cccd664f08f2538cec8cc3ac2b1c` | [Fineli Open Data](https://fineli.fi/fineli/en/avoin-data) |
| USDA SR Legacy | 2018-04 | 2 | `571b8b95f98857a6615ef4071534b13dc608e086a0526d75cd5bef8f51e85c0a` | [FoodData Central Downloads](https://fdc.nal.usda.gov/download-datasets/) |
| BEDCA pública | Base pública | 2 | `43b943edc4844c5194203ce3c3758d45746fbb9a0b9bac472b2cae8f8c2b0c31` | [BEDCA](https://www.bedca.net/) |

Los hashes de Fineli, USDA y BEDCA corresponden al snapshot JSON selectivo que conserva la respuesta oficial bruta necesaria para estas identidades. Los ficheros masivos no se versionan en Git.

## Núcleo fijo (60)

| Alimento | Clave canónica | Fuente | Código | Estado | Porción comestible |
|---|---|---|---:|---|---|
| Pechuga de pollo cruda | `food:ciqual-36017` | CIQUAL | `36017` | raw | meat_without_skin |
| Contramuslo de pollo sin piel crudo | `food:ciqual-36019` | CIQUAL | `36019` | raw | meat_without_skin |
| Pechuga de pavo cruda | `food:ciqual-36304` | CIQUAL | `36304` | raw | meat |
| Ternera magra cruda | `food:ciqual-6106` | CIQUAL | `6106` | raw | lean_meat |
| Lomo de cerdo crudo | `food:ciqual-28204` | CIQUAL | `28204` | raw | meat |
| Conejo crudo | `food:ciqual-34001` | CIQUAL | `34001` | raw | meat |
| Huevo de gallina | `food:ciqual-22000` | CIQUAL | `22000` | raw | without_shell |
| Merluza cruda | `food:ciqual-26044` | CIQUAL | `26044` | raw | flesh |
| Salmón crudo | `food:ciqual-26161` | CIQUAL | `26161` | raw | flesh |
| Bacalao crudo | `food:fineli-804` | Fineli | `804` | raw | flesh |
| Atún al natural escurrido | `food:ciqual-26039` | CIQUAL | `26039` | cooked | drained_product |
| Gamba pelada cruda | `food:ciqual-10021` | CIQUAL | `10021` | raw | peeled_flesh |
| Calamar crudo | `food:ciqual-10001` | CIQUAL | `10001` | raw | flesh |
| Tofu firme natural | `food:usda-sr-172475` | USDA SR Legacy | `172475` | raw | whole_edible_product |
| Soja texturizada seca | `food:fineli-33499` | Fineli | `33499` | raw | dry_product |
| Seitán natural | `food:ciqual-25598` | CIQUAL | `25598` | unspecified | whole_edible_product |
| Tomate | `food:fineli-352` | Fineli | `352` | raw | whole_edible_product |
| Cebolla | `food:ciqual-20034` | CIQUAL | `20034` | raw | without_skin |
| Pimiento rojo | `food:fineli-386` | Fineli | `386` | raw | whole_edible_product |
| Zanahoria | `food:fineli-300` | Fineli | `300` | raw | without_skin |
| Calabacín | `food:ciqual-20020` | CIQUAL | `20020` | raw | flesh_and_skin |
| Berenjena | `food:ciqual-20053` | CIQUAL | `20053` | raw | whole_edible_product |
| Brócoli | `food:ciqual-20057` | CIQUAL | `20057` | raw | whole_edible_product |
| Coliflor | `food:ciqual-20016` | CIQUAL | `20016` | raw | whole_edible_product |
| Espinaca | `food:ciqual-20059` | CIQUAL | `20059` | raw | whole_edible_product |
| Lechuga romana | `food:ciqual-20171` | CIQUAL | `20171` | raw | whole_edible_product |
| Pepino | `food:ciqual-20019` | CIQUAL | `20019` | raw | flesh_and_skin |
| Judía verde | `food:ciqual-20061` | CIQUAL | `20061` | raw | whole_edible_product |
| Manzana | `food:ciqual-13039` | CIQUAL | `13039` | raw | flesh_and_skin |
| Plátano | `food:fineli-11049` | Fineli | `11049` | raw | flesh_without_skin |
| Naranja | `food:fineli-11045` | Fineli | `11045` | raw | flesh_without_skin |
| Mandarina | `food:fineli-11046` | Fineli | `11046` | raw | flesh_without_skin |
| Pera | `food:ciqual-13037` | CIQUAL | `13037` | raw | flesh_and_skin |
| Kiwi | `food:ciqual-13021` | CIQUAL | `13021` | raw | flesh_without_skin |
| Fresa | `food:fineli-447` | Fineli | `447` | raw | whole_edible_product |
| Melón | `food:fineli-477` | Fineli | `477` | raw | flesh_without_skin_and_seeds |
| Arroz blanco seco | `food:ciqual-9100` | CIQUAL | `9100` | raw | dry_product |
| Pasta seca | `food:ciqual-9810` | CIQUAL | `9810` | raw | dry_product |
| Pan integral | `food:ciqual-7110` | CIQUAL | `7110` | unspecified | whole_edible_product |
| Avena | `food:ciqual-9310` | CIQUAL | `9310` | raw | dry_product |
| Cuscús seco | `food:ciqual-9681` | CIQUAL | `9681` | raw | dry_product |
| Quinoa seca | `food:ciqual-9340` | CIQUAL | `9340` | raw | dry_product |
| Patata | `food:ciqual-4008` | CIQUAL | `4008` | raw | without_skin |
| Boniato | `food:ciqual-4101` | CIQUAL | `4101` | raw | whole_edible_product |
| Lenteja seca | `food:ciqual-20359` | CIQUAL | `20359` | raw | dry_seed |
| Garbanzo seco | `food:ciqual-20516` | CIQUAL | `20516` | raw | dry_seed |
| Alubia seca | `food:ciqual-20525` | CIQUAL | `20525` | raw | dry_seed |
| Guisante | `food:ciqual-20072` | CIQUAL | `20072` | raw | whole_edible_product |
| Leche semidesnatada | `food:ciqual-19033` | CIQUAL | `19033` | unspecified | whole_edible_product |
| Yogur natural sin azúcar | `food:fineli-11736` | Fineli | `11736` | unspecified | whole_edible_product |
| Queso fresco de Burgos | `food:bedca-2507` | BEDCA | `2507` | unspecified | whole_edible_product |
| Queso semicurado de vaca | `food:bedca-2515` | BEDCA | `2515` | unspecified | whole_edible_product |
| Bebida de soja sin azúcar enriquecida en calcio | `food:usda-sr-175215` | USDA SR Legacy | `175215` | unspecified | whole_edible_product |
| Queso fresco batido natural | `food:ciqual-19646` | CIQUAL | `19646` | unspecified | whole_edible_product |
| Aceite de oliva virgen extra | `food:ciqual-17270` | CIQUAL | `17270` | unspecified | whole_edible_product |
| Aguacate | `food:fineli-11057` | Fineli | `11057` | raw | flesh_without_skin_and_stone |
| Almendra natural | `food:ciqual-15000` | CIQUAL | `15000` | unspecified | whole_edible_product |
| Nuez natural | `food:ciqual-15005` | CIQUAL | `15005` | unspecified | kernel |
| Chía | `food:ciqual-15047` | CIQUAL | `15047` | unspecified | dry_seed |
| Lino molido | `food:ciqual-15034` | CIQUAL | `15034` | unspecified | ground_seed |

## Reserva (20)

| Alimento | Clave canónica | Fuente | Código | Estado | Porción comestible |
|---|---|---|---:|---|---|
| Sardina en conserva escurrida | `food:ciqual-26034` | CIQUAL | `26034` | cooked | drained_product |
| Caballa en conserva al natural escurrida | `food:ciqual-26123` | CIQUAL | `26123` | cooked | drained_product |
| Mejillón cocido sin salsa | `food:ciqual-10013` | CIQUAL | `10013` | cooked | whole_edible_product |
| Dorada cruda | `food:ciqual-26080` | CIQUAL | `26080` | raw | flesh |
| Cordero magro crudo | `food:ciqual-21505` | CIQUAL | `21505` | raw | lean_meat |
| Tempeh natural | `food:ciqual-20917` | CIQUAL | `20917` | unspecified | whole_edible_product |
| Calabaza | `food:ciqual-20139` | CIQUAL | `20139` | raw | whole_edible_product |
| Alcachofa al natural escurrida | `food:ciqual-20067` | CIQUAL | `20067` | cooked | drained_product |
| Espárrago verde | `food:ciqual-20279` | CIQUAL | `20279` | raw | whole_edible_product |
| Champiñón | `food:ciqual-20056` | CIQUAL | `20056` | raw | whole_edible_product |
| Puerro | `food:ciqual-20039` | CIQUAL | `20039` | raw | whole_edible_product |
| Mango | `food:fineli-34361` | Fineli | `34361` | raw | flesh_without_skin_and_stone |
| Melocotón | `food:ciqual-13043` | CIQUAL | `13043` | raw | flesh_and_skin_without_stone |
| Arándano | `food:ciqual-13028` | CIQUAL | `13028` | raw | whole_edible_product |
| Uva | `food:ciqual-13395` | CIQUAL | `13395` | raw | whole_edible_product |
| Piña | `food:fineli-11056` | Fineli | `11056` | raw | flesh_without_skin |
| Trigo sarraceno seco | `food:ciqual-9380` | CIQUAL | `9380` | raw | dry_product |
| Maíz dulce cocido escurrido | `food:ciqual-20066` | CIQUAL | `20066` | cooked | drained_product |
| Kéfir natural | `food:ciqual-19865` | CIQUAL | `19865` | unspecified | whole_edible_product |
| Bebida de avena sin azúcar enriquecida en calcio | `food:fineli-30208` | Fineli | `30208` | unspecified | whole_edible_product |

## Recibo local

- Lotes en cuarentena: 69 CIQUAL + 15 Fineli + 2 USDA + 2 BEDCA = 88.
- Cesta: 80/80 identidades resueltas; 60/60 núcleo fijo y 20/20 reserva.
- Preflight: 88/88 revisiones y 440/440 observaciones obligatorias conocidas.
- Estado: `T17_NUTRITION_CORE_PREFLIGHT_PASS`.
