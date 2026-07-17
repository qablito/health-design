# ADR-0001: Motor determinista como única fuente de verdad

- Estado: aceptado
- Fecha: 2026-07-16

## Contexto

La aplicación combina cálculos nutricionales, restricciones clínicas y farmacológicas, progresión de entrenamiento, hidratación, sustituciones y explicaciones en lenguaje natural. Una salida generativa no ofrece por sí sola reproducibilidad, trazabilidad ni garantías suficientes para controlar números y restricciones.

## Decisión

Todos los cálculos y decisiones se ejecutarán mediante un motor determinista, versionado y cubierto por pruebas.

El asistente de lenguaje se invoca solo después de que exista una salida estructurada válida. Recibe un subconjunto mínimo de datos y devuelve JSON validado. Puede resumir o explicar, pero no modificar números, selecciones, límites, estados, advertencias ni niveles de acción.

Si la llamada falla, excede el presupuesto o no cumple el esquema, se usa un texto determinista predefinido.

## Consecuencias

### Positivas

- Un mismo contexto y versiones producen el mismo resultado.
- Las reglas pueden auditarse y probarse por separado.
- Es posible cambiar de proveedor de IA sin cambiar el plan.
- El sistema continúa funcionando con presupuesto cero de IA.

### Costes

- Hay que mantener un catálogo explícito de reglas y explicaciones.
- La generación de planes requiere más modelado que una petición libre a un LLM.
- Cada nueva regla necesita procedencia, versión y pruebas.

## Alternativas descartadas

- Permitir que el LLM calcule el plan completo: no es suficientemente reproducible.
- Generar por módulos y reconciliar libremente con IA: trasladaría decisiones de seguridad al modelo.
- Usar IA solo cuando haya conflictos: seguiría creando dos autoridades distintas.

