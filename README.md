# Health Design

Especificación de una aplicación web privada, por invitación, para generar y mantener planes personales de alimentación, entrenamiento, hidratación, sueño, movilidad y suplementación.

## Estado del proyecto

- Estado actual: **Tareas 1–11 implementadas**. T1–T10 conservan sus recibos remotos cuando corresponde; T11 está verificada localmente y no requiere migraciones ni despliegue remoto.
- Implementación funcional disponible: **acceso privado, vinculación de dispositivos, administración con impersonación, cuestionario adaptativo, ciclo de vida de planes, motor determinista, catálogo nutricional federado, alimentación, entrenamiento y movilidad**.
- Evidencia: los recibos [T1](docs/quality/TASK_01_VERIFICATION.md)–[T10](docs/quality/TASK_10_VERIFICATION.md) y [T11](docs/quality/TASK_11_VERIFICATION.md) distinguen las pruebas locales de los recursos remotos realmente comprobados.
- Próxima frontera: **T12**. La ampliación del catálogo CIQUAL completo queda diferida como **T10.1** y no bloquea esa tarea.
- Público inicial: adultos de 18 años o más, con España como contexto geográfico de V1.
- Acceso inicial previsto: hasta 10 usuarios invitados.
- Los scripts y datos de `supermercados/` y `datos/` son material exploratorio; no constituyen todavía un catálogo de producción ni demuestran cobertura comercial.

## Fuente de verdad documental

En caso de contradicción, se aplica este orden:

1. [PRODUCT.md](PRODUCT.md): alcance y decisiones de producto confirmadas.
2. [REQUIREMENTS.md](REQUIREMENTS.md): requisitos verificables y trazabilidad.
3. Documentos de arquitectura, dominio, datos, seguridad y operación.
4. ADR de `docs/adr/`: decisiones técnicas irreversibles o costosas de cambiar.
5. Planes de `docs/plans/`: orden de implementación; nunca amplían el alcance por sí solos.
6. Backlog futuro: ideas expresamente fuera de V1.

Ningún prototipo, prueba, dato extraído o texto generado por IA puede modificar silenciosamente este contrato.

## Mapa documental

### Producto y experiencia

- [PRODUCT.md](PRODUCT.md): contrato maestro de V1.
- [CONTEXT.md](CONTEXT.md): lenguaje ubicuo y términos canónicos.
- [REQUIREMENTS.md](REQUIREMENTS.md): requisitos funcionales y no funcionales.
- [docs/product/USER_FLOWS.md](docs/product/USER_FLOWS.md): recorridos completos.
- [docs/ui/DESIGN_BRIEF.md](docs/ui/DESIGN_BRIEF.md): dirección visual, accesibilidad y estados.

### Arquitectura y datos

- [docs/architecture/ARCHITECTURE.md](docs/architecture/ARCHITECTURE.md): componentes, fronteras y despliegue.
- [docs/architecture/DOMAIN_DATA_MODEL.md](docs/architecture/DOMAIN_DATA_MODEL.md): agregados, entidades y estados.
- [docs/architecture/API_CONTRACT.md](docs/architecture/API_CONTRACT.md): operaciones, errores e idempotencia.
- [docs/architecture/DECISION_ENGINE.md](docs/architecture/DECISION_ENGINE.md): motor determinista y frontera de IA.
- [docs/data/DATA_GOVERNANCE.md](docs/data/DATA_GOVERNANCE.md): procedencia, versionado y publicación de datos.
- [docs/data/NUMERIC_CONTRACT.md](docs/data/NUMERIC_CONTRACT.md): precisión, redondeo y umbrales de discrepancia.

### Seguridad, operación y calidad

- [docs/security/THREAT_MODEL.md](docs/security/THREAT_MODEL.md): activos, amenazas y mitigaciones.
- [docs/security/SECURITY_CONTRACT.md](docs/security/SECURITY_CONTRACT.md): autenticación, RLS y controles medibles.
- [docs/operations/OPERATIONS.md](docs/operations/OPERATIONS.md): sesiones, copias, borrado y entornos.
- [docs/runbooks/README.md](docs/runbooks/README.md): contrato y lista de runbooks que se completan con comandos reales durante la implementación.
- [docs/adr/0007-independent-continuity-ledger.md](docs/adr/0007-independent-continuity-ledger.md): borrados y auditoría privilegiada fuera de las copias restaurables.
- [docs/quality/TEST_STRATEGY.md](docs/quality/TEST_STRATEGY.md): estrategia de verificación.
- [docs/quality/SCENARIO_CATALOG.md](docs/quality/SCENARIO_CATALOG.md): banco inicial de 92 escenarios.
- [docs/quality/TRACEABILITY.md](docs/quality/TRACEABILITY.md): bloques, requisitos, escenarios y puertas.
- [docs/quality/ACCEPTANCE_GATES.md](docs/quality/ACCEPTANCE_GATES.md): ocho puertas obligatorias de salida.
- [docs/quality/TASK_01_VERIFICATION.md](docs/quality/TASK_01_VERIFICATION.md)–[TASK_11_VERIFICATION.md](docs/quality/TASK_11_VERIFICATION.md): recibos reproducibles por tarea.

### Entrega

- [ROADMAP.md](ROADMAP.md): fases y hitos.
- [docs/plans/2026-07-16-v1-implementation-plan.md](docs/plans/2026-07-16-v1-implementation-plan.md): secuencia ejecutable.
- [docs/backlog/FUTURE.md](docs/backlog/FUTURE.md): capacidades diferidas.
- [docs/adr/](docs/adr/): decisiones arquitectónicas.

## Reglas de mantenimiento

- Toda decisión nueva debe modificar primero `PRODUCT.md` o registrarse en un ADR si es técnica.
- Todo requisito nuevo necesita identificador, criterio verificable y puerta de aceptación.
- Todo cambio estructural de un plan de usuario crea un candidato revisable; nunca altera en silencio el plan activo.
- Los datos históricos conservan las versiones de reglas y fuentes usadas al generarlos.
- La documentación distingue siempre entre **diseñado**, **implementado** y **verificado**.
