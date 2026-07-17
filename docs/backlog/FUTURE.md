# Backlog futuro confirmado

Este archivo contiene únicamente trabajo que se decidió diferir de V1. No es
permiso para ampliar el alcance actual. Cada entrada necesita investigación,
criterios de salida y revisión del contrato antes de activarse.

## Integraciones de datos personales

### F-001 — Apple Health, Health Connect, Garmin, Fitbit y similares

Importar sueño, actividad, frecuencia cardiaca u otros datos solo después de
definir consentimiento, permisos mínimos, cadencia, revocación, borrado y
calidad por fuente. V1 registra datos manualmente.

**No incluye:** decisiones clínicas automáticas ni sincronización silenciosa.

### F-002 — OCR/importación de analíticas y documentos

Permitir adjuntar o leer informes solo con extracción revisable, unidad/fecha/
rango detectables, confianza visible y confirmación humana antes de influir en
un plan. V1 acepta valores manuales.

### F-003 — Recuperación autoservicio y migración de identidad

El perfil y el historial remoto ya existen en V1. Queda diferida una
recuperación autoservicio sin código ni sesión, además de la migración a cuentas
convencionales, siempre que no debilite la seguridad ni la trazabilidad. El
restablecimiento excepcional por superadministrador sí pertenece a V1.

## Motor y evidencia

### F-004 — Proveedor LLM local

Añadir un proveedor local intercambiable para reducir coste, manteniendo la
misma interfaz JSON, validaciones, límites y prohibición de cálculo/seguridad
delegados. No se cambia el motor determinista ni se permite que el modelo local
active candidatos.

### F-005 — Revisiones de literatura con automatización asistida

La actualización de evidencia seguirá siendo manual en V1. En el futuro se
puede añadir una bandeja de estudios para revisión humana, con jerarquía de
guías, revisiones sistemáticas, metaanálisis, ensayos y apoyo observacional.

## Catálogo y compra

### F-006 — Refresco diario de supermercados

Actualizar precio, disponibilidad y formatos diariamente cuando exista una vía
permitida y estable para cada cadena. El catálogo V1 es orientativo, versionado
y con precios base; no se convierte en checkout.

### F-007 — Más cobertura de cadenas y regiones

Ampliar la muestra española después de medir calidad de equivalencia, cobertura
del 90 % de la cesta de prueba y ausencia de grupos esenciales por debajo del
75 %. La fuente interna de Sevilla no se expondrá como ubicación al usuario.

### F-008 — Optimización avanzada de cestas

El modo multitienda básico pertenece a V1. Queda diferido optimizar preferencias
avanzadas de envase, desperdicio, presupuesto, número máximo de paradas o
criterios personales adicionales. El plan sigue mandando en nutrición y la
persona mantiene la decisión del supermercado habitual.

## Experiencia y seguimiento

### F-009 — Accesibilidad AAA selectiva

Tras demostrar WCAG 2.2 AA, auditar componentes concretos y aplicar AAA donde
sea viable sin degradar legibilidad, rendimiento o densidad de información.

### F-010 — Recordatorios y automatizaciones más ricos

V1 deja recordatorios desactivados y anclajes opcionales. El futuro puede añadir
calendarios, notificaciones y reglas de recurrencia con opt-in explícito.

### F-011 — Analítica de producto y métricas avanzadas

Solo después de definir minimización, acceso del superadministrador, retención y
separación de datos de salud. No se añade telemetría invasiva para completar V1.

## Fuera de alcance hasta nueva decisión

- Menores de 18 años.
- Diagnóstico, tratamiento o cambios de medicación/sustancias.
- Recomendación activa de anabolizantes, SARMs, péptidos, “test boosters” o
  quemadores opacos.
- Checkout, pagos, transporte, cupones, fidelización o pedido mínimo.
- Marcas comerciales recomendadas por el motor de salud.
- Predicciones clínicas, promesas de resultado o porcentajes de beneficio.
- OCR silencioso, integraciones automáticas o refresco diario sin revisión.
