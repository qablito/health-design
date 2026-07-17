# Estrategia de pruebas de V1

**Estado:** plan de verificación; ninguna prueba significa que la función ya esté implementada.  
**Contrato:** 22 perfiles completos + 70 casos focales = 92 escenarios, ocho puertas de salida, invariantes estrictas y activación manual de cambios estructurales.

## 1. Objetivos

- Demostrar que los cálculos y restricciones son reproducibles sin depender de un LLM.
- Impedir que un módulo no seleccionado aparezca o que un cambio local mutile el plan activo.
- Detectar exposición, suplantación o escalada de privilegios antes de invitar a usuarios.
- Verificar que incertidumbre, provisionalidad, confianza y nivel de acción se muestran correctamente.
- Probar exportaciones, catálogo comercial, restauración y borrado con datos sintéticos.
- Mantener una experiencia accesible y comprensible sin convertir el cuestionario en un formulario interminable.

## 2. Pirámide mínima

| Nivel | Qué cubre | Criterio V1 |
|---|---|---|
| Unitario | normalización, conversiones, energía/macros/fibra, reglas, estados, matching | determinismo y bordes de unidades/ausencias |
| Propiedad/invariante | no invención, no relajación, monotonicidad de cambios, aislamiento | 100 % de invariantes críticas |
| Integración | Postgres/RLS, Storage, sesiones, motor, exportación, catálogo | migraciones reproducibles y rollback |
| Contrato API | schemas, errores, autorización, versionado | payloads válidos e inválidos explícitos |
| E2E | wizard, resumen, generación, seguimiento, exportación y admin | flujos críticos; los 92 escenarios se ejecutan en la capa adecuada |
| Seguridad | IDOR, replay, XSS, robo de token, CORS/origen, rate limit, restore | sin hallazgos críticos/altos abiertos |
| Accesibilidad | teclado, lector, foco, contraste, errores, responsive | WCAG 2.2 AA; AAA solo donde sea selectivo |
| Operación | backups, ledger externo, restauración, borrado, supply chain y presupuesto LLM | runbook probado y evidencias archivadas |

## 3. Datos de prueba

- Datos totalmente sintéticos; nunca usar perfiles reales en CI, screenshots o fixtures.
- Catálogo nutricional pequeño pero con procedencia, estado crudo/cocinado, parte comestible, unidad y revisión.
- Catálogo comercial con SKU exacto, variantes permitidas, exclusiones, “puede contener”, precio, formato y disponibilidad caducable.
- Medicación/farmacología representada por identidades ficticias y reglas de prueba; CIMA/AEMPS real se usa solo en ingestión controlada.
- Laboratorios con valor, unidad, fecha, rango y ausencia; incluir valores antiguos, fuera de rango y sin intervalo.
- Semillas de aleatoriedad fijadas para fixtures; el plan activo debe producir el mismo hash ante el mismo contexto y revisión.

## 4. Invariantes obligatorias

| ID | Invariante | Prueba mínima |
|---|---|---|
| INV-01 | No inventar un dato faltante | dato ausente permanece ausente y reduce confianza |
| INV-02 | No mostrar módulo no seleccionado | generar con módulos parciales y buscar contenido fuera de alcance |
| INV-03 | Nunca relajar restricción obligatoria | introducir preferencia en conflicto y comprobar rechazo |
| INV-04 | Preferencia explícita no se sustituye en silencio | supermercado, alimento o ejercicio elegido se mantiene |
| INV-05 | Sustitución conserva función | cada sustituto conserva rol y recalcula kcal/macros/fibra |
| INV-06 | Plan activo no se muta en segundo plano | cambiar contexto crea candidato o nueva versión |
| INV-07 | Inconsistencia bloquea activación, no lectura | candidato inválido no se activa y plan anterior sigue visible |
| INV-08 | Restricción/acción estricta gana por módulo | información, ajuste, revisión prioritaria o conservadora no se promedia |
| INV-09 | Canon nutricional no depende del SKU | cambiar supermercado solo cambia envases, coste y sobrante |
| INV-10 | Precio incompleto no se llama cesta más barata | cobertura parcial muestra pendiente |
| INV-11 | QR solo se consume una vez | segundo consumo falla sin filtrar estado interno |
| INV-12 | Revocar una membresía no revoca otros perfiles ni dispositivos salvo acción explícita | comprobar actor con dos perfiles, perfil con dos dispositivos y expiración global claramente diferenciada |
| INV-13 | Borrado y auditoría sobreviven a restore | ambos streams externos se aplican; el perfil no reaparece, un rango borrado solo deja hueco firmado y no se truncan acciones posteriores en cuatro rotaciones |
| INV-14 | LLM no cambia campos protegidos | salida con números/dosis/estado prohibido se descarta |
| INV-15 | Exportación excluye compuestos sensibles | PDF/Excel no contiene nombres farmacológicos/anabólicos |
| INV-16 | Historial conserva procedencia | plan histórico mantiene fuente/regla/fecha/configuración |
| INV-17 | Corrección de código de barras queda aislada hasta aprobarse | el perfil propietario la reutiliza; otro perfil no la ve; superadmin crea después una revisión global publicada |
| INV-18 | Datos estimados se distinguen de medidos | sueño REM/dispositivo y tendencias se etiquetan como estimación |
| INV-19 | Opciones experimentales no se mezclan con recomendación estándar | sección separada, confianza y riesgos visibles |
| INV-20 | Respuestas y límites de acceso no permiten enumeración | alias existente/inexistente tienen forma/tiempo comparables y el rate limit responde uniformemente |
| INV-21 | Limitar coste no altera el plan ni autoriza llamadas sobre el tope | cap 10 EUR, cotas máximas concurrentes/idempotentes, timeout pendiente y anomalía externa bloqueante usan fallback sin cambiar cálculos |
| INV-22 | Entradas/salidas hostiles no ejecutan ni se filtran | HTML/fórmula/payload grande se neutraliza o rechaza; secretos y bearer de exportación no llegan a URL, cache o logs |
| INV-23 | Toda acción privilegiada conserva identidad y cadena total | AAL2, actor original/efectivo, AEAD/firma/secuencia sin bifurcación y compensación de intent sin outbox no pueden eludirse |
| INV-24 | No se crea perfil/plan fuera de admisión | invitación válida recibida solo por body POST, edad adulta y al menos un módulo |
| INV-25 | El contrato numérico es único | precisión, redondeo, umbrales y hashes coinciden en todas las capas |
| INV-26 | Importar no publica | reglas, correcciones y cadenas requieren activación y mantienen historia |

## 5. Matriz de cobertura

Los recuentos de tests no son una métrica de calidad. Cada área debe cubrir
comportamiento normal, bordes, fallo, concurrencia y autorización según
[`TRACEABILITY.md`](TRACEABILITY.md).

| Área | Evidencia de menor nivel | Evidencia integrada | Puerta |
|---|---|---|---|
| Identidad, sesiones y roles | tokens, TTL, transiciones y policies | dos dispositivos, IDOR, AAL2 e impersonación | G7 |
| Cuestionario y resumen | schemas, dependencias y normalización | autosave, reanudación, edición y tiempo | G1,G8 |
| Motor y restricciones | propiedades, reglas y hashes | perfiles completos y conflictos | G2,G3,G4 |
| Nutrición y sustituciones | aritmética decimal y solver | comida→día→semana y restricciones | G2,G4 |
| Entrenamiento/movilidad/sueño | progresión y estados | plan integrado y seguimiento | G4 |
| Hidratación/suplementos | bandas, precedencia y evidencia | conflictos clínicos/farmacológicos | G3,G4 |
| Catálogos/compras | parsing, matching y optimizador | publicación, cobertura y cesta | G6 |
| Exportación y accesibilidad | serialización y sanitización | UI/PDF/XLSX/impresión equivalentes | G6,G8 |
| Backups/borrado/operación | manifests y tombstones | restore de cuatro copias | G7 |

## 6. Pruebas de seguridad

- **Autenticación:** enumeración, fuerza bruta, replay QR, expiración,
  rotación, robo de token, XSS y validación de origen/CORS.
- **Autorización:** IDOR por `profile_id`, cross-tenant, RLS, permisos de superadmin, impersonación y funciones privilegiadas.
- **Entrada:** XSS almacenado/reflejado, HTML/Markdown, fórmulas Excel, path traversal, JSON profundo, unicode y límites.
- **Fuente externa:** feed envenenado, redirección SSRF, contenido gigante, discrepancias, publicación no autorizada.
- **Disponibilidad:** cuotas, concurrencia, exportaciones repetidas, almacenamiento y presupuesto de Luna.
- **Recuperación:** restore de cada rotación, tombstones, sesiones revocadas y separación dev/prod.
- **Cadena de suministro:** lockfile, SCA, SBOM, procedencia, hash/firma del
  artefacto y escaneo de secretos.

No se acepta el primer usuario invitado si existe un hallazgo crítico o alto en identidad, autorización, borrado/restauración, motor de restricciones o exposición de datos.

## 7. Pruebas del LLM

El LLM no se prueba como fuente de verdad. Se prueban:

1. validación de JSON/schema;
2. rechazo de campos protegidos o instrucciones contradictorias;
3. sanitización de texto devuelto;
4. timeout, error, cuota y presupuesto agotado;
5. consistencia de la explicación con el plan determinista;
6. ausencia de compuestos sensibles en exportaciones.

Los tests deben comparar el documento estructurado del motor antes y después de la llamada: solo se permiten cambios en campos de explicación, resumen o instrucción breve.

## 8. Accesibilidad y UX

- Recorrer el wizard completo con teclado sin trampas de foco.
- Anunciar progreso, campos obligatorios, errores y cambios de módulo a lector de pantalla.
- Mantener contraste AA, foco visible, targets táctiles adecuados y reducción de movimiento.
- Comprobar que provisionalidad, confianza, alertas y experimental no dependen solo del color.
- Probar anchuras móvil, escritorio y PDF impreso; la tabla no debe ocultar unidades ni cantidades.
- Verificar que el texto libre mínimo no impide añadir un alimento, medicación o nota desconocida.

## 9. Evidencia y salida

Cada ejecución de puerta debe producir:

- commit/artefacto probado y versión de reglas/catalogo;
- entorno y dataset/seed;
- resultado por escenario e invariant;
- defectos abiertos con severidad y módulo afectado;
- screenshots o archivos exportados solo con datos sintéticos;
- decisión PASS, BLOCK o PASS WITH DEFERRED con responsable y fecha.

No se marca una puerta como pasada porque exista un documento: debe existir una ejecución reproducible o una justificación explícita de que la función aún no está implementada.

## 10. Contratos auxiliares obligatorios

- Precisión, redondeo, hashes y discrepancias:
  [`NUMERIC_CONTRACT.md`](../data/NUMERIC_CONTRACT.md).
- Sesiones, RLS, MFA, rate limits, Storage y continuidad:
  [`SECURITY_CONTRACT.md`](../security/SECURITY_CONTRACT.md).
- Mapeo de requisitos y escenarios:
  [`TRACEABILITY.md`](TRACEABILITY.md).
