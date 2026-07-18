# Motor de decisión determinista y frontera de IA

**Estado:** núcleo ejecutable T8; catálogos y módulos finales pendientes
**Versión:** 1.0  
**Fuente:** [`PRODUCT.md`](../../PRODUCT.md)

## 1. Principio rector

El motor determinista es la única verdad de V1. La IA Luna puede explicar el
resultado ya validado, pero no puede calcularlo, completar huecos clínicos,
relajar restricciones ni activar cambios.

## 2. Pipeline obligatorio

```text
entrada declarada
 → normalización y calidad
 → restricciones obligatorias
 → reglas condicionales activas
 → preferencias y objetivos
 → cálculos por módulo
 → reconciliación entre módulos
 → validación de seguridad y coherencia
 → hallazgos/ incertidumbres
 → versión de plan o candidato
 → explicación opcional Luna
```

El pipeline es determinista con el mismo `context_snapshot`, revisiones de
datos, `rule_set_revision_id` y configuración. La salida se serializa en JSON
canónico y conserva hashes de entrada/salida para reproducibilidad según
[`NUMERIC_CONTRACT.md`](../data/NUMERIC_CONTRACT.md).

## 3. Tipos de regla

Cada regla versionada declara:

```json
{
  "id": "rule.example",
  "version": "1.0.0",
  "kind": "mandatory|conditional|preferential",
  "scope": ["nutrition", "hydration"],
  "trigger": {"field": "...", "operator": "...", "value": "..."},
  "effect": {"type": "constraint|adjustment|finding", "payload": {}},
  "evidence_refs": ["..."],
  "reviewed_at": "...",
  "status": "active"
}
```

- **Obligatoria:** define el espacio seguro; no puede ser relajada por objetivo,
  preferencia ni IA.
- **Condicional:** se activa solo con contexto suficiente; si falta un dato,
  produce incertidumbre y plan provisional, salvo que una regla obligatoria
  exija una alternativa conservadora.
- **Preferente:** ordena opciones dentro del espacio seguro; nunca convierte
  una preferencia en requisito clínico.

Las restricciones se resuelven por conjunción. No se suman porcentajes ni se
promedian beneficios y gravedad: el nivel de acción más estricto prevalece.

## 4. Estado de información

Cada valor puede estar `known`, `estimated`, `missing`, `conflicting` o
`stale`. El motor conserva origen, fecha de vigencia y confianza. `missing` no
se rellena con una suposición silenciosa.

La salida siempre contiene:

- módulos calculados y módulos no solicitados;
- objetivos y banda/centro cuando correspondan;
- restricciones aplicadas;
- incertidumbres y datos que las originan;
- nivel de completitud `complete|provisional`;
- nivel de acción por hallazgo: `information`, `adjustment`,
  `priority_review`, `immediate_conservative`.

## 5. Cálculos de alto nivel

Las fórmulas concretas y constantes viven en el catálogo de reglas, no en el
cliente. Como contrato funcional:

- energía: banda adaptativa y objetivo central recalculable;
- composición: objetivo principal y hasta dos secundarios; el principal
  gobierna conflictos;
- grasa: centro del 30 % de energía y banda contextual 20–35 %, siempre
  subordinada a restricciones;
- carbohidratos: residuo tras proteína y grasa, salvo regla obligatoria;
- fibra: mínimo 25 g y centro de 14 g/1000 kcal, subordinado a tolerancia y
  contexto clínico;
- proteína: objetivo contextual cubierto por alimentos por defecto; polvo solo
  si el usuario lo elige;
- nutrición: semana estable de siete días, 2–6 comidas, cantidades en crudo o
  base declarada, dos sustitutos por alimento, misma función y recálculo;
- pérdida/ganancia: rango temporal y fecha central orientativa, con objetivo
  intermedio seguro cuando el objetivo declarado sea inadecuado;
- hidratación: banda y centro de bebidas; agua de alimentos y bebidas se
  contabiliza internamente; alcohol nunca se propone; reglas de pérdida,
  retención, electrolitos, calor y ejercicio; override por restricción de
  líquidos;
- entrenamiento: solo si `generated`; bloque progresivo de cuatro semanas,
  sesión completa y ajustes conservadores;
- movilidad: núcleo de cinco minutos y extensiones de 10/15 minutos;
- sueño: ventana flexible, hábitos y tendencias manuales; REM/profundo/ligero
  se tratan como estimaciones, no como diagnóstico;
- suplementos: primero carencias probables, luego rendimiento/bienestar,
  evidencia, riesgos, interacción, métrica y condición de parada.

## 6. Reglas clínicas, farmacológicas y de sustancias

- Identidad farmacológica canónica: AEMPS/CIMA cuando exista.
- Dosis, frecuencia, vía y horario solo se utilizan si una regla documentada
  depende expresamente de ellos.
- La cobertura se marca `modeled`, `partial` o `unmodeled`; nunca se presenta
  como verificador exhaustivo.
- Medicación para pérdida de peso, terapias hormonales y testosterona exógena
  pueden modificar módulos según reglas activas.
- No se recomiendan ni ajustan anabolizantes recreativos, SARMs, péptidos,
  test boosters ni mezclas opacas; el dato solo contextualiza.
- El contexto anabolizante puede desplazar hidratación hacia la parte alta de
  la banda segura cuando una regla lo establezca, sin sumar una cantidad fija ni
  afirmar que corrige hematocrito.

## 7. Impacto, candidatos y activación

Cada `ChangeEvent` se evalúa con un grafo de dependencias:

```text
dato → regla → módulo → dependencia cruzada → plan/compra/exportación
```

El detector devuelve `unaffected`, `module_only`, `dependent_modules` o
`structural`. Los módulos no afectados conservan su resultado. Todo cambio
estructural crea una `PlanVersion:draft` y un `PlanCandidate` que enlaza la
versión base y la candidata, con diff, hallazgos, incertidumbres y validaciones
normativas ejecutadas. La activación es siempre manual. Las puertas G1–G8 son
evidencia de lanzamiento y no forman parte del payload de cada plan.

## 8. Sustituciones y compras

Una sustitución declara función (`protein`, `carbohydrate`, `fat`, `fiber`,
`micronutrient`, `preference`) y límites de alergia/intolerancia. Se acepta
solo si el solver encuentra una cantidad válida y los totales vuelven a pasar
las validaciones normativas y bandas aplicables. Si no existe equivalencia, se
ofrece “Sin sustituto confirmado”.

En compra, el motor no reoptimiza la dieta: asigna productos confirmados,
formatos, paquetes, precio base y sobrantes, con desempates documentados.

## 9. Frontera de Luna

### Entrada permitida

- `plan_version_id`, módulos visibles, objetivos ya calculados,
  segmentos de contenido allowlisted, `message_keys`, variables normativas,
  glosario y límites de longitud;
- nunca el código privado, tokens, identificadores innecesarios ni datos no
  requeridos para la explicación.

### Salida permitida

```json
{
  "segments": [
    {"slot": "summary", "message_key": "plan.summary", "text": "..."},
    {"slot": "term", "message_key": "term.rir", "text": "..."}
  ],
  "model_version": "provider-config",
}
```

La salida se valida contra esquema, slots, `message_key`, longitud, idioma y
lista de campos. Se rechaza la respuesta completa si introduce cualquier
número, dosis, límite, claim clínico, alimento, ejercicio, advertencia o estado
que no proceda de una variable allowlisted del plan. El renderer inserta las
variables normativas, en vez de confiar en cifras redactadas por el modelo.

Cada explicación conserva `provider_revision_id`, modelo, `prompt_version`,
`prompt_hash`, schema y política, pero nunca el prompt completo ni el payload
clínico y no cambia `output_hash`.

Luna solo se habilita cuando existen `AIProviderRevision` y
`PricingFxRevision` aprobadas y vigentes que fijan:

- endpoint y secreto exclusivamente server-side;
- modelo y región de procesamiento;
- retención y exclusión del uso para entrenamiento confirmadas;
- calendario de precios, conversión EUR, fuentes/fechas y cota máxima
  contractual de la llamada;
- política de minimización y segmentos allowlisted;
- timeout V1 de 8 segundos;
- cero reintentos automáticos para evitar duplicar coste o tratamiento.

Si falta cualquiera de esas condiciones, la salida usa el fallback
determinista. Un timeout conserva la cota reservada hasta reconciliar el cargo
y una anomalía de coste bloquea nuevas llamadas. El proveedor local futuro
debe implementar el mismo contrato y pasar las mismas pruebas antes de
sustituir Luna.
