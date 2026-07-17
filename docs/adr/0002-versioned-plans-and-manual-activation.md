# ADR-0002: Planes versionados y activación manual

- Estado: aceptado
- Fecha: 2026-07-16

## Contexto

Los cambios de peso, objetivos, medicación, síntomas, disponibilidad, alimentos o ejercicios pueden afectar uno o varios módulos. Modificar en el sitio el plan que el usuario está siguiendo impediría entender qué cambió, recuperar la versión anterior o comparar resultados.

## Decisión

El plan tendrá dos ejes independientes:

- ciclo: borrador, activo o archivado;
- calidad: completo o provisional.

Un cambio material crea un candidato inmutable con el contexto, reglas, fuentes y diferencias utilizadas. El candidato no sustituye al activo hasta una confirmación manual. Un candidato inválido no puede activarse.

Los cambios puramente de presentación no crean versión. Los ajustes menores definidos por regla pueden preparar automáticamente un candidato, pero nunca activarlo si alteran estructura, restricciones u objetivos.

## Consecuencias

### Positivas

- Historial reproducible y auditable.
- Comparación explícita antes de aceptar cambios.
- Recuperación inmediata del plan anterior mediante reactivación controlada.
- Recalculo limitado a módulos afectados y dependencias.

### Costes

- Mayor complejidad del modelo y de la interfaz.
- Necesidad de almacenar instantáneas y manifiestos de procedencia.
- Requiere un clasificador de impacto y pruebas de transición de estados.

## Alternativas descartadas

- Sobrescribir el plan activo: pierde trazabilidad.
- Regenerar siempre todos los módulos: aumenta coste y riesgo de cambios no relacionados.
- Activar automáticamente cambios “seguros”: contradice el control explícito confirmado.

