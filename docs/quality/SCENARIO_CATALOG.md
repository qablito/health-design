# Catálogo de escenarios de prueba de V1

**Total:** 92 escenarios: 22 perfiles completos (`C01–C22`) y 70 casos focales (`F01–F70`).  
Cada escenario usa datos sintéticos, indica los módulos seleccionados y debe guardar evidencia de entrada, versión de reglas, salida, incertidumbres y puerta afectada.

La incertidumbre, el nivel de acción, los requisitos y las comprobaciones
completan cada fila mediante
[`TRACEABILITY.md`](TRACEABILITY.md); no son campos opcionales.

## Convenciones

- **Resultado esperado** describe el comportamiento, no una cifra clínica universal.
- **Gates** usa `G1–G8` de `docs/quality/ACCEPTANCE_GATES.md`.
- **Inv.** usa `INV-01–INV-26` de `docs/quality/TEST_STRATEGY.md`.
- “Provisional” es una salida válida si la incertidumbre está identificada y el módulo conserva un límite conservador.

## 22 perfiles completos

| ID | Perfil sintético y módulos | Foco verificable | Resultado esperado | Gates / Inv. |
|---|---|---|---|---|
| C01 | Adulto sano, composición corporal, nutrición | 4 comidas, alimentos preferidos, 7 días | Semana estable con cantidades crudas, kcal/macros/fibra, dos sustituciones por alimento y timeline orientativo | G1,G2,G4 / INV-01, INV-05 |
| C02 | Adulto con pérdida de grasa, nutrición/hidratación/sueño | Peso objetivo ambicioso | Banda energética, objetivo intermedio seguro, rango temporal y plan provisional si falta actividad | G2,G3,G4 / INV-01, INV-08 |
| C03 | Adulto con ganancia de masa, entrenamiento generado/nutrición | Hipertrofia, 4 sesiones | Bloque de 4 semanas, proteína food-first, progresión y dieta coherente con entrenamiento | G2,G4 / INV-02, INV-05 |
| C04 | Adulto mantenimiento, nutrición/sueño, ausencia de entrenamiento | Selecciona “sin rutina” | No aparece sesión, ni métricas de rendimiento, ni gasto de entrenamiento inventado | G1,G4 / INV-02 |
| C05 | Adulto con entrenamiento propio, nutrición/hidratación | Usuario aporta rutina | Se adapta comida/hidratación a sesiones declaradas sin reemplazar su rutina | G1,G4 / INV-04, INV-06 |
| C06 | Adulto sin restricciones, seis módulos | Flujo completo en 15–20 min | Preguntas adaptativas, autosave, resumen editable, plan activo completo y exportaciones | G1,G4,G6,G8 / INV-01, INV-02, INV-06 |
| C07 | Alergia a frutos secos, nutrición/suplementos | Alergia y contaminación cruzada | Excluye alimento y “puede contener”; sustitutos funcionales sin cross-contact conocido | G2,G3 / INV-03, INV-05 |
| C08 | Intolerancia a lactosa, nutrición | Cantidad tolerada y gravedad | Modela cantidad/gravedad, reduce o elimina según respuesta, no la etiqueta como alergia | G1,G2,G3 / INV-01, INV-03 |
| C09 | Ansiedad alimentaria, nutrición/sueño | Episodios y alimentos detonantes | Estructura flexible, saciedad y estrategias; evita lenguaje moralizante o control compulsivo | G1,G4,G8 / INV-04 |
| C10 | Vegano, nutrición/suplementos | B12 y carencias posibles | Dieta cubre proteína con alimentos; suplemento se ofrece con evidencia/confianza, no se impone | G2,G3 / INV-19 |
| C11 | Hipertensión, nutrición/hidratación | Sodio, actividad y medicación | Restricciones y alternativas compatibles; hidratación no contradice contexto | G3,G4 / INV-03, INV-08 |
| C12 | Restricción de líquidos/renal, nutrición/hidratación | Regla clínica prioritaria | Banda de bebida conservadora, no aplica regla genérica de “más agua” | G3,G4 / INV-03, INV-08 |
| C13 | Embarazo adulto, nutrición/sueño/movilidad | Condición hormonal y actividad | Plan adaptado; provisional solo si falta dato/cobertura, sin objetivos agresivos ni sustancias no validadas | G3,G4 / INV-08, INV-19 |
| C14 | Menopausia, nutrición/entrenamiento/sueño | Síntomas y cambios | Adapta hábitos, fuerza/movilidad y sueño; no diagnostica ni presenta certeza falsa | G3,G4,G8 / INV-01, INV-08 |
| C15 | Medicación tipo GLP-1, nutrición/hidratación/suplementos | Apetito, tolerancia, horarios | Adapta volumen, proteína, fibra e hidratación según reglas documentadas; no pauta fármaco | G3,G4 / INV-03 |
| C16 | Testosterona exógena declarada, entrenamiento/hidratación/sueño | Contexto anabólico | Desplaza hidratación hacia parte alta segura si procede, no aconseja uso/dosis ni lo imprime | G3,G4,G6 / INV-15 |
| C17 | Polimedicación con dosis desconocidas, todos los módulos | Identidad parcial | Pide solo dato crítico, entrega provisional y marca cobertura farmacológica parcial | G1,G3 / INV-01, INV-08 |
| C18 | Laboratorio fuera de rango, nutrición/suplementos | Valor, unidad, fecha y rango | Recalcula solo módulos afectados, muestra tendencia básica y no predice | G2,G3,G5 / INV-06, INV-18 |
| C19 | Sueño medido por wearable, sueño/entrenamiento | REM/profundo/ligero | Trata fases como estimaciones, conserva total/horario y propone hábitos | G4,G8 / INV-18 |
| C20 | Entrenamiento con calor y sudor alto, hidratación | Sweat-rate opcional | Banda y anclajes adaptados; cálculo oculto si hay riesgo de pesaje compulsivo | G3,G4 / INV-08 |
| C21 | Nutrición con preferencia por proteína en polvo | Selector explícito | Mantiene alimentos por defecto; usa polvo solo en opción elegida y recalcula | G2,G4 / INV-04, INV-05 |
| C22 | Dieta española + Mercadona/Lidl, compras/exportación | Un supermercado y ahorro opcional | Canon nutricional estable, formatos/precios orientativos, aviso de ahorro sin cambiar preferencia, PDF/Excel coherentes | G6,G8 / INV-04, INV-09, INV-10, INV-15 |

## 70 casos focales

### Identidad, sesiones y roles (`F01–F10`)

| ID | Entrada focal | Resultado esperado | Gates / Inv. |
|---|---|---|---|
| F01 | Alias inexistente | Respuesta indistinguible de alias válido sin enumeración | G7 / INV-20 |
| F02 | Código privado corto/repetido y ráfaga de acceso | Rechazo sin sesión; quinto fallo/15 min y 30.º/h/IP aplican respuesta uniforme, `Retry-After` y Turnstile sin enumerar alias | G7 / INV-20 |
| F03 | QR caducado | No abre perfil; mensaje genérico y evento técnico | G7 / INV-11 |
| F04 | QR consumido dos veces en paralelo | Solo una solicitud gana; la otra falla sin estado filtrado | G7 / INV-11 |
| F05 | Revocar dispositivo A desde B; replay/expiración de A | Revocar un perfil corta esa membresía con JWT vigente y conserva otros perfiles; cerrar/vencer globalmente el actor revoca todas sus membresías y refresh tokens, las pestañas comparten sesión y cleanup nunca elimina un actor vigente | G7 / INV-12 |
| F06 | Rotar código y elegir “cerrar todo para este perfil” | Código anterior deja de vincular; revoca las demás membresías del perfil, conserva la actual y no afecta otros perfiles | G7 / INV-12 |
| F07 | Release, borrado, rango de auditoría y restore de cuatro rotaciones | `deletions` impide revivir datos/Storage y suprime rangos `admin-audit` borrados; job terminal conserva marcador/handle con `profile_id=NULL`; restore bloquea range-intent incompleto o intent admin pendiente, verifica AEAD/firma/manifiestos y Auth solo se borra si queda huérfana | G7 / INV-13, INV-23 |
| F08 | Invitación anulada, expirada, usada o enviada en URL | No se puede canjear/reactivar; el secreto solo funciona en body POST y no queda en historial/Referer/log | G7 / INV-11, INV-24 |
| F09 | Usuario intenta leer otro `profile_id` | 403/404 uniforme; sin datos laterales | G7 / INV-03 |
| F10 | Dos altas del mismo actor y dos mutaciones admin concurrentes | `ensure_actor` rechaza anon/null/disabled y conserva unicidad; AAL2 e indicador persisten; ledger asigna secuencia total, rechaza AEAD/firma/replay y un rollback antes de outbox termina por compensación/reconciliación normal | G7 / INV-23 |

### Cuestionario y flujo (`F11–F18`)

| ID | Entrada focal | Resultado esperado | Gates / Inv. |
|---|---|---|---|
| F11 | Edad 17 | Alta bloqueada; no se genera plan | G1,G7 / INV-24 |
| F12 | Solo alimentación seleccionada | No aparecen rutina, métricas ni recomendaciones de entrenamiento | G1,G4 / INV-02 |
| F13 | Entrenamiento “ausente” con objetivo rendimiento | Se conserva conflicto como incertidumbre y no se inventa rutina | G1,G4 / INV-02 |
| F14 | Cero módulos u objetivo “otro” enviados por API | Rechazo de schema; conserva borrador y UI solo ofrece categorías válidas | G1,G4 / INV-03, INV-24 |
| F15 | Tres objetivos secundarios | Rechazo/recorte explícito a máximo dos sin perder principal | G1 / INV-03 |
| F16 | Cerrar navegador a mitad del wizard o perder red | Autosave recupera el último estado remoto sin duplicar; lo no confirmado vive solo en memoria y no aparece en localStorage, IndexedDB, Cache API, URL ni service worker | G1,G7 / INV-06, INV-22 |
| F17 | Campo clínico crítico sin responder | Pregunta breve; si persiste, plan provisional conservador | G1,G3 / INV-01, INV-08 |
| F18 | Edición del resumen final | Recalcula módulos afectados y conserva historial anterior | G1,G5 / INV-06 |

### Nutrición y sustituciones (`F19–F30`)

| ID | Entrada focal | Resultado esperado | Gates / Inv. |
|---|---|---|---|
| F19 | 2 comidas/día | Distribución en dos comidas y cierre decimal conforme al contrato | G2 / INV-25 |
| F20 | 6 comidas/día | Distribución en seis sin superar límites ni duplicar energía por redondeo | G2 / INV-25 |
| F21 | Alimento medido en crudo | Cantidad, estado y referencia cruda visibles; no se confunde con el valor cocinado | G2,G6 / INV-16 |
| F22 | Dato ausente o justo en el límite de discrepancia | Ausente sigue desconocido; diferencia igual al umbral no abre revisión y la mínima unidad por encima crea `manual_review` | G2,G6 / INV-01, INV-25 |
| F23 | Sustituto con misma función | Recalcula comida y total diario | G2 / INV-05 |
| F24 | Sustituto incompatible con alergia | No se ofrece ni se activa | G3 / INV-03, INV-05 |
| F25 | Sustituto que cambia fibra | Recalcula fibra y muestra diferencia | G2 / INV-05 |
| F26 | Meta de peso insana | Propone objetivo intermedio seguro y rango temporal, sin bloquear módulos no afectados | G2,G3 / INV-08 |
| F27 | Déficit energético extremo solicitado | Restricción obligatoria domina; alternativa conservadora | G3 / INV-03 |
| F28 | Grasa fuera de banda preferida | Ajuste dentro de 20–35 % si no existe regla superior | G2 / INV-25 |
| F29 | Fibra con baja tolerancia | Adapta desde mínimo/objetivo sin forzar valor central | G2,G3 / INV-03 |
| F30 | Preferencia alimentaria en conflicto | Mantiene preferencia si es segura; explica la limitación si no | G2,G3 / INV-04 |

### Clínica, farmacología y laboratorios (`F31–F40`)

| ID | Entrada focal | Resultado esperado | Gates / Inv. |
|---|---|---|---|
| F31 | Medicación con identidad canónica | Aplica solo reglas documentadas para ese fármaco | G3 / INV-01 |
| F32 | Medicación sin coincidencia | Cobertura parcial; no afirma verificación exhaustiva | G3 / INV-01 |
| F33 | Dosis desconocida cuando la regla la necesita | Pregunta crítica o plan provisional; no asume dosis | G1,G3 / INV-01 |
| F34 | Dosis irrelevante para la regla | No bloquea por pedirla; se ignora de forma explícita | G3 / INV-01 |
| F35 | Compuesto anabólico recreativo | Se registra como contexto; no se recomienda ni modifica | G3 / INV-03 |
| F36 | Síntoma importante durante seguimiento | Alternativa conservadora/alerta en módulo afectado, sin diagnóstico | G3,G4 / INV-08 |
| F37 | Laboratorio antiguo | Confianza decrece por vigencia contextual | G2,G3,G5 / INV-18 |
| F38 | Laboratorio sin unidad/rango | Se conserva como dato incompleto y no activa regla numérica | G2,G3 / INV-01 |
| F39 | Valor fuera de rango en un módulo | Solo ese módulo/dependencias se recalculan | G2,G5 / INV-06 |
| F40 | Candidato clínico no validado | Se muestra para revisión; no puede activarse | G3,G5 / INV-07 |

### Entrenamiento, movilidad y sueño (`F41–F48`)

| ID | Entrada focal | Resultado esperado | Gates / Inv. |
|---|---|---|---|
| F41 | Preferencia fuerza | Sesiones con series/reps/RPE/RIR, descansos y técnica sencilla | G4 / INV-04 |
| F42 | Preferencia Pilates/yoga | Selección coherente, sin convertirla en hipertrofia por defecto | G4 / INV-04 |
| F43 | Calistenia sin equipamiento | Alternativas por nivel y progresión segura | G4 / INV-04 |
| F44 | Lesión declarada | Evita patrón afectado y presenta incertidumbre/ajuste conservador | G3,G4 / INV-08 |
| F45 | Núcleo movilidad 5 minutos | Siempre cabe en cinco minutos; extensiones opcionales hasta 10/15 | G4 / INV-04 |
| F46 | Ejercicio sin animación disponible | Instrucción textual/ilustración alternativa; no bloquea el plan | G4 / INV-01 |
| F47 | Cambio menor de volumen | Ajuste automático dentro de límites y registro | G4,G5 / INV-06 |
| F48 | Cambio estructural de rutina | Candidato con diff y activación manual | G4,G5 / INV-06, INV-07 |

### Hidratación y descanso (`F49–F54`)

| ID | Entrada focal | Resultado esperado | Gates / Inv. |
|---|---|---|---|
| F49 | Consumo medio desconocido | Banda provisional y anclajes, sin precisión fingida | G1,G4 / INV-01 |
| F50 | Café, té y leche registrados | Se contabilizan como bebidas; alcohol no se propone | G4 / INV-25 |
| F51 | Restricción de líquidos | Domina reglas generales y evita objetivo alto genérico | G3,G4 / INV-03 |
| F52 | Calor/sudor alto | Ajusta banda/intervalos y ofrece electrolitos solo si procede | G3,G4 / INV-08, INV-25 |
| F53 | Datos REM/profundo copiados manualmente del wearable | Se muestran como estimaciones y tendencia básica; no hay sincronización/importación | G4,G8 / INV-18 |
| F54 | Recordatorios no activados | No se envían; anclajes siguen disponibles | G4 / INV-04 |

### Suplementos (`F55–F60`)

| ID | Entrada focal | Resultado esperado | Gates / Inv. |
|---|---|---|---|
| F55 | Carencia probable por dieta | Recomendación evidencia/confianza/forma/seguimiento | G3,G4 / INV-03 |
| F56 | Interacción farmacológica documentada | Advertencia y alternativa; no se recomienda sin control | G3 / INV-03 |
| F57 | Solicitud de marca comercial | No se muestran marcas en V1 | G3 / INV-03 |
| F58 | Opción experimental | Sección separada desplegable con baja confianza/riesgos | G3,G8 / INV-19 |
| F59 | Usuario toma suplemento propio | Se analiza contexto; no se convierte en recomendación automática | G3 / INV-01 |
| F60 | Prueba de un suplemento nuevo | Seguimiento de resultado, mantener/quitar/inconcluso y uno cada vez | G4 / INV-06 |

### Catálogo, compras y precios (`F61–F66`)

| ID | Entrada focal | Resultado esperado | Gates / Inv. |
|---|---|---|---|
| F61 | Código de barras sin etiqueta confirmada | Confirmación obligatoria; crea, si se corrige, una revisión privada del perfil y no publica automáticamente | G6 / INV-17 |
| F62 | Corrección de usuario para SKU | Se reutiliza en su perfil; otro perfil no puede verla antes de aprobación global | G5,G6 / INV-17 |
| F63 | Mismo SKU escaneado por otro perfil | Antes de aprobación usa global/etiqueta/importación; después recibe la nueva revisión global sin mutar la propuesta privada | G6 / INV-17 |
| F64 | SKU equivalente no encontrado | “Sin producto confirmado”; no se inventa equivalencia | G6 / INV-01 |
| F65 | Un supermercado elegido | Se mantiene como habitual aunque otro sea más barato; solo aviso | G6 / INV-04 |
| F66 | Límites, procedencia y comparativa parcial | Fixtures en 90 %/75 %, una unidad por debajo, SKU alergénico `unknown` y archivo/fila/celda justo sobre límite; import sin manifest/licencia/hashes o reimport alterado no publica/reutiliza revisión y una cesta parcial nunca se llama ahorro completo | G3,G6,G7 / INV-03, INV-10, INV-26 |

### Versiones, LLM, exportación y operación (`F67–F70`)

| ID | Entrada focal | Resultado esperado | Gates / Inv. |
|---|---|---|---|
| F67 | Fuente cambia tras plan activo | Histórico congelado; nuevo candidato solo para módulos afectados | G5,G6 / INV-06, INV-16 |
| F68 | Salida Luna contiene una dosis nueva | Campo prohibido se descarta; texto determinista de fallback | G3,G5 / INV-14 |
| F69 | Presupuesto Luna al borde, timeout y estimación optimista | `cap_eur=10`; la cota máxima/FX aprobada e idempotente autoriza como máximo una llamada; timeout conserva reserva, sobrecoste externo marca incidente/bloqueo y fallback conserva plan | G5,G7 / INV-21 |
| F70 | HTML/fórmula, canarios secretos, payload grande y exportación | PDF/Excel escapan y omiten compuesto; API rechaza sobrelímite; logs/caches no contienen body, token, QR, medicación ni handle y la descarga proxy no expone bearer en URL, con `no-store`/`no-referrer` | G6,G7,G8 / INV-15, INV-22 |

## Trazabilidad de ejecución

Cada fila debe tener, cuando se implemente:

1. fixture o perfil sintético versionado;
2. módulos y restricciones exactos;
3. versión de reglas, catálogo y modelo configurado;
4. salida estructurada y renderizada;
5. resultado de invariantes y puertas;
6. enlace a defecto o decisión si falla.

Un escenario omitido no se cuenta como “pasado”. Si una función aún no existe, el resultado es `NO IMPLEMENTADO`, no `PASS`.
