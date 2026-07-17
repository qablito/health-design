# Contrato numérico de V1

**Estado:** obligatorio para importación, cálculo y pruebas.  
**Fecha:** 2026-07-16  
**Ámbito:** valores por 100 g o 100 ml salvo indicación distinta.

## 1. Principios

- Los cálculos usan precisión decimal; no dependen de igualdad binaria de coma flotante.
- Se normaliza la unidad y el denominador antes de comparar.
- El valor original, sus decimales y su método se conservan.
- El redondeo solo ocurre al presentar o exportar.
- Un valor ausente no equivale a cero.
- Un intervalo que se solapa con otro no crea un conflicto cuantitativo.
- Una etiqueta redondeada se convierte primero en el intervalo que representa.
- `traza` o `<x` se representa como intervalo; no como cero.
- Cerca de cero se usan diferencias absolutas, no porcentajes desproporcionados.

## 2. Umbrales de discrepancia para revisión

La fuente prioritaria compatible es el ancla. Estos valores abren revisión manual; no son una regla legal de fusión ni autorizan promediar fuentes.

| Nutriente | Valor del ancla | Diferencia absoluta que abre revisión |
|---|---:|---:|
| Proteína, carbohidratos, azúcares o fibra | < 10 g | > 2 g |
| Proteína, carbohidratos, azúcares o fibra | 10–40 g | > 20 % |
| Proteína, carbohidratos, azúcares o fibra | > 40 g | > 8 g |
| Grasa total | < 10 g | > 1,5 g |
| Grasa total | 10–40 g | > 20 % |
| Grasa total | > 40 g | > 8 g |
| Saturadas, monoinsaturadas o poliinsaturadas | < 4 g | > 0,8 g |
| Saturadas, monoinsaturadas o poliinsaturadas | ≥ 4 g | > 20 % |
| Sodio | < 0,5 g | > 0,15 g |
| Sodio | ≥ 0,5 g | > 20 % |
| Sal | < 1,25 g | > 0,375 g |
| Sal | ≥ 1,25 g | > 20 % |
| Vitaminas | cualquier valor cuantificable | por encima de +50 % o por debajo de −35 % |
| Minerales | cualquier valor cuantificable | por encima de +45 % o por debajo de −35 % |

La envolvente procede de la guía europea de tolerancias de etiquetado y se adopta como disparador operativo conservador. Cuando una regla clínica usa un umbral más estricto, prevalece esa regla.

## 3. Revisión prioritaria independientemente de la diferencia

Se abre revisión prioritaria si existe:

- conflicto de identidad, especie, preparación, fortificación, estado o parte comestible;
- definición INFOODS o método analítico incompatible;
- unidad, denominador o conversión dudosos;
- indicio de error por factor 10, 100 o 1000;
- valor negativo imposible;
- total menor que uno de sus componentes;
- cruce de un límite clínico o de seguridad;
- fracciones de fibra obtenidas con métodos incompatibles;
- dato estimado frente a una medición directa claramente mejor trazada.

La revisión prioritaria bloquea el dato candidato, no el resto del plan. Se mantiene la revisión efectiva anterior o se genera una salida provisional con incertidumbre.

## 4. Balance de masa

Para registros que dispongan de los componentes necesarios, se comprueba:

`agua + proteína + grasa + carbohidratos + fibra + alcohol + cenizas`

- 97–103 g/100 g: zona preferida.
- 95–105 g/100 g: aceptable con la calidad documentada.
- fuera de 95–105 g/100 g: revisión prioritaria.

No se ejecuta la comprobación si faltan componentes de forma que el resultado no sea interpretable.

## 5. Estados de comparación

1. `no_conflict`: compatible dentro de intervalos y umbrales.
2. `informative_discrepancy`: diferencia visible pero menor que el umbral.
3. `manual_review`: supera un umbral numérico.
4. `priority_review`: existe un disparador cualitativo o de integridad.

Una fuente secundaria nunca reemplaza automáticamente una revisión efectiva por el simple hecho de parecer más precisa. Si el ancla carece totalmente de un nutriente, la siguiente fuente compatible puede completarlo y queda registrada en el manifiesto.

## 6. Precisión de cálculo

| Magnitud | Precisión interna mínima | Presentación predeterminada |
|---|---:|---:|
| Masa de alimento | 0,01 g | 1 g, salvo cantidades pequeñas |
| Volumen | 0,01 ml | 1 ml |
| Energía | 0,01 kcal | 1 kcal |
| Macronutriente/fibra | 0,001 g | 0,1 g |
| Micronutriente | unidad fuente con al menos 4 cifras significativas | unidad y precisión clínicamente útil |
| Agua | 0,1 ml | 10 ml o 0,1 l |
| Tiempo | 1 segundo | minuto o intervalo comprensible |
| Precio | 0,001 € interno para normalización | 0,01 € |

Las conversiones usan factores versionados. Los tests comparan la representación decimal normalizada; no introducen una tolerancia que permita ocultar un error de fórmula.

## 7. Cierre y redondeo

- Totales de comida, día y semana se suman desde valores internos sin redondear.
- La suma interna de elementos debe coincidir exactamente con el total serializado a la misma escala decimal.
- La interfaz puede mostrar una diferencia aparente por redondeo; el tooltip o metadato indica que los totales proceden de valores no redondeados.
- Energía, macros, fibra y agua deben permanecer dentro de las bandas definidas por el plan, no de un porcentaje universal inventado.
- Un sustituto es válido si conserva la función, respeta restricciones y, tras recalcular, mantiene comida, día y semana dentro de sus bandas aplicables.

## 8. Serialización reproducible

- JSON canónico: claves ordenadas, Unicode NFC, fechas ISO-8601, decimales como
  cadenas normalizadas y sin campos volátiles.
- Algoritmo predeterminado: SHA-256 sobre los bytes UTF-8 de ese JSON. Cada hash
  conserva `hash_algorithm=sha256` y `canonicalization_version`; HMAC y firmas
  se usan solo cuando otro contrato lo exige expresamente.
- El `input_hash` cubre contexto, reglas, fuentes, revisiones y configuración.
- El `output_hash` cubre la salida normativa, no explicaciones Luna ni timestamps de transporte.
- `prompt_hash`, hashes de manifiesto y hashes de auditoría usan la misma base
  de Unicode/encoding, pero cada dominio declara sus campos incluidos y
  excluidos para no mezclar contratos.
- Igual entrada canónica e igual versión deben producir hashes iguales.

## 9. Referencias

- Comisión Europea, guía de tolerancias para valores nutricionales declarados.
- FAO/INFOODS, directrices para comprobar datos de composición antes de publicar.

Estas referencias justifican la envolvente de revisión; no convierten el motor en un control legal de etiquetado.
