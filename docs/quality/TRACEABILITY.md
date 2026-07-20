# Trazabilidad de V1

**Estado:** contrato de cobertura.  
**Fuentes:** [`PRODUCT.md`](../../PRODUCT.md), [`REQUIREMENTS.md`](../../REQUIREMENTS.md), [`SCENARIO_CATALOG.md`](SCENARIO_CATALOG.md) y [`ACCEPTANCE_GATES.md`](ACCEPTANCE_GATES.md).

La trazabilidad demuestra cobertura; no demuestra que una prueba haya pasado. Cada ejecución futura añade estado, commit, entorno, dataset y evidencia.

**Evidencia implementada:** B06 y la captura contextual aplicable de B05/B07
tienen recibo remoto de desarrollo `T6_COMPLETE_REMOTE_PASS` en
[`TASK_06_VERIFICATION.md`](TASK_06_VERIFICATION.md). El núcleo de ciclo de
vida de B17 tiene recibo remoto de desarrollo `T7_COMPLETE_REMOTE_PASS` en
[`TASK_07_VERIFICATION.md`](TASK_07_VERIFICATION.md), incluida la evidencia de
INV-06, INV-07 y la persistencia necesaria para INV-16. El núcleo numérico,
la canonicalización, los hashes, la resolución mínima de restricciones y el
corte cuestionario→borrador tienen recibo remoto de desarrollo
`T8_COMPLETE_REMOTE_PASS` en
[`TASK_08_VERIFICATION.md`](TASK_08_VERIFICATION.md). Los catálogos, fórmulas
nutricionales y reglas clínicas selectivas se distribuyen entre T9–T12. El
núcleo del catálogo federado genérico, su procedencia, cuarentena, revisión manual e
historia efectiva tiene recibo remoto de desarrollo `T9_COMPLETE_REMOTE_PASS`
en [`TASK_09_VERIFICATION.md`](TASK_09_VERIFICATION.md): cierra el núcleo de
REQ-DAT-001 y REQ-DAT-002, y la parte genérica de REQ-DAT-004 y REQ-DAT-007.
Las fórmulas y la semana nutricional tienen recibo remoto de desarrollo
`T10_COMPLETE_REMOTE_PASS` en
[`TASK_10_VERIFICATION.md`](TASK_10_VERIFICATION.md). Su núcleo CIQUAL curado no
equivale al catálogo completo, cuya activación queda diferida como T10.1 sin
bloquear el resto del plan. Entrenamiento opcional, movilidad modular y los 20
activos visuales tienen recibo local `T11_COMPLETE_LOCAL_PASS` en
[`TASK_11_VERIFICATION.md`](TASK_11_VERIFICATION.md); no hubo despliegue ni
validación remota. La adaptación clínica/farmacológica selectiva, hidratación,
sueño, suplementos y AEMPS/CIMA tienen recibo remoto de desarrollo
`T12_COMPLETE_REMOTE_PASS` en
[`TASK_12_VERIFICATION.md`](TASK_12_VERIFICATION.md); su experiencia web está
verificada localmente dentro del mismo recibo. La revisión semanal, el diario
opcional, F47/F48, vigencia contextual, historial, tendencias básicas y
recálculo selectivo tienen recibo remoto de desarrollo
`T13_COMPLETE_REMOTE_PASS` en
[`TASK_13_VERIFICATION.md`](TASK_13_VERIFICATION.md). La preparación versionada,
el modelo común, PDF/XLSX privados e impresión A4 de T15 tienen recibo local
`T15B_COMPLETE_LOCAL_PASS`; su estado remoto se registra en
[`TASK_15_VERIFICATION.md`](TASK_15_VERIFICATION.md). La puerta AA final continúa
en T19; los productos comerciales, en T16; y supermercados/precios, en T17.

## 1. Bloques de producto

| Bloque | Contrato | Requisitos principales | Escenarios representativos | Gates |
|---|---|---|---|---|
| B01 | propósito | REQ-QA-001, REQ-PLN-001 | C06, F69 | G1–G8 |
| B02 | alcance V1 | REQ-ACC-001, REQ-MOV-001, REQ-FUT-* | C04, F11, F12 | G1,G4,G7 |
| B03 | principios no negociables | REQ-PLN-002, REQ-PLN-004, REQ-AI-003 | F27, F48, F69 | G2–G5,G7 |
| B04 | acceso, perfiles y administración | REQ-ACC-001–008, REQ-ADM-001–003 | F01–F10 | G1,G5,G7,G8 |
| B05 | módulos y objetivos | REQ-INT-006–007, REQ-MOV-001 | C02–C05, F12–F15 | G1,G4 |
| B06 | cuestionario | REQ-INT-001–005 | C06, F16–F18 | G1,G3,G8 |
| B07 | clínica, farmacología y laboratorio | REQ-CLN-001–003, REQ-LAB-001–002 | C11–C18, F31–F40 | G1–G5 |
| B08 | restricciones y acción | REQ-PLN-002, REQ-CLN-001 | F27, F36, F40, F51 | G2–G4 |
| B09 | alimentación | REQ-NUT-001–008 | C01–C10, F19–F30 | G2–G4,G6,G8 |
| B10 | entrenamiento y movilidad | REQ-MOV-001–004 | C03–C05, C14, F41–F48 | G1,G3,G4,G6,G8 |
| B11 | hidratación | REQ-HYD-001–003 | C02, C11, C12, C16, C20, F49–F54 | G2–G4,G8 |
| B12 | sueño | REQ-SLP-001–002 | C02, C14, C19, F53 | G1,G4,G8 |
| B13 | suplementación | REQ-SUP-001–002 | C10, C15, F55–F60 | G3,G4,G6,G8 |
| B14 | evidencia y datos | REQ-DAT-001–007 | C01, F22, F61–F67 | G2,G3,G5,G6 |
| B15 | compra | REQ-SHP-001–005 | C22, F64–F66 | G4,G6,G8 |
| B16 | catálogo comercial | REQ-DAT-003, REQ-DAT-005–007 | C22, F61–F66 | G3,G5–G7 |
| B17 | generación y versionado | REQ-PLN-001–007 | C06, F18, F39, F40, F48, F67 | G2,G4,G5 |
| B18 | consulta, exportación y seguimiento | REQ-EXP-001–004, REQ-FOL-001–002 | C06, C22, F36, F47, F60, F70 | G4–G8 |
| B19 | arquitectura, IA, seguridad, calidad e identidad | REQ-AI-001–005, REQ-OPS-001–005, REQ-QA-001–003 | F01–F10, F16, F66, F68–F70 | G2,G3,G5–G8 |

## 2. Requisito V1 → escenarios

### Acceso y administración

| Requisito | Escenarios mínimos |
|---|---|
| REQ-ACC-001 | F08, F11 |
| REQ-ACC-002 | F01, F02 |
| REQ-ACC-003 | F03, F04 |
| REQ-ACC-004 | F05, F06, F09 |
| REQ-ACC-005 | F10 |
| REQ-ACC-006 | F10 |
| REQ-ACC-007 | F06, F10 |
| REQ-ACC-008 | F07 |
| REQ-ADM-001 | F10, C06 |
| REQ-ADM-002 | F10 |
| REQ-ADM-003 | F10 |

### Cuestionario y planes

| Requisito | Escenarios mínimos |
|---|---|
| REQ-INT-001 | C06, F12, F17 |
| REQ-INT-002 | C06, F16 |
| REQ-INT-003 | F16 |
| REQ-INT-004 | F17 |
| REQ-INT-005 | F18 |
| REQ-INT-006 | C02, F14, F15 |
| REQ-INT-007 | F14 |
| REQ-PLN-001 | C01, F67, F69 |
| REQ-PLN-002 | F27, F30 |
| REQ-PLN-003 | C06, F40 |
| REQ-PLN-004 | F18, F39, F48 |
| REQ-PLN-005 | F40, F48 |
| REQ-PLN-006 | F67 |
| REQ-PLN-007 | C06, F40, F48 |

### Alimentación

| Requisito | Escenarios mínimos |
|---|---|
| REQ-NUT-001 | C01, C02 |
| REQ-NUT-002 | C02, F26, F27 |
| REQ-NUT-003 | C01, F28, F29 |
| REQ-NUT-004 | C03, C10, C21 |
| REQ-NUT-005 | C01, F19, F20 |
| REQ-NUT-006 | C01, F21, F23, F25 |
| REQ-NUT-007 | C07, C08, F24 |
| REQ-NUT-008 | C09 |

### Entrenamiento, movilidad, hidratación y sueño

| Requisito | Escenarios mínimos |
|---|---|
| REQ-MOV-001 | C03, C04, C05, F12, F13 |
| REQ-MOV-002 | C03, F41, F42, F43 |
| REQ-MOV-003 | C14, F45 |
| REQ-MOV-004 | C03, F46 |
| REQ-HYD-001 | C02, C20, F49, F50 |
| REQ-HYD-002 | C11, C12, C16, C20, F51, F52 |
| REQ-HYD-003 | F54 |
| REQ-SLP-001 | C19, F53 |
| REQ-SLP-002 | C02, C14, F53 |

### Clínica, suplementos y laboratorios

| Requisito | Escenarios mínimos |
|---|---|
| REQ-CLN-001 | C11, C12, F27, F31 |
| REQ-CLN-002 | C17, F31, F32, F33, F34 |
| REQ-CLN-003 | C15, C16, F35 |
| REQ-SUP-001 | C10, C15, F55, F56, F57, F59, F60 |
| REQ-SUP-002 | F58 |
| REQ-LAB-001 | C18, F37, F38 |
| REQ-LAB-002 | C18, F39 |

### IA

| Requisito | Escenarios mínimos |
|---|---|
| REQ-AI-001 | F68, F69 |
| REQ-AI-002 | F68 |
| REQ-AI-003 | F68, F69 |
| REQ-AI-004 | F69 |
| REQ-AI-005 | F67, F68, F69 |

### Datos, catálogo y compra

| Requisito | Escenarios mínimos |
|---|---|
| REQ-DAT-001 | F21, F22, F67 |
| REQ-DAT-002 | C01, F67 |
| REQ-DAT-003 | F61, F62, F63 |
| REQ-DAT-004 | F19, F20, F22, F28, F50 |
| REQ-DAT-005 | C07, F24, F64 |
| REQ-DAT-006 | C22, F66 |
| REQ-DAT-007 | C22, F61, F63 |
| REQ-SHP-001 | C22, F65 |
| REQ-SHP-002 | C22, F64 |
| REQ-SHP-003 | C22, F65 |
| REQ-SHP-004 | C22, F66 |
| REQ-SHP-005 | C22, F66 |

### Exportación, seguimiento, calidad y operación

| Requisito | Escenarios mínimos |
|---|---|
| REQ-EXP-001 | C06, C22, F70 |
| REQ-EXP-002 | C01, C06 |
| REQ-EXP-003 | C06, C22 |
| REQ-EXP-004 | C22, F70 |
| REQ-FOL-001 | C18, F36, F47, F60 |
| REQ-FOL-002 | F39, F48, F67 |
| REQ-QA-001 | C01–C22, F01–F70 |
| REQ-QA-002 | C06, C22, F46, F70 |
| REQ-QA-003 | F05, F07 |
| REQ-OPS-001 | F07 |
| REQ-OPS-002 | C22, F70 |
| REQ-OPS-003 | F10, F70 |
| REQ-OPS-004 | F01, F02, F03, F04, F66, F69, F70 |
| REQ-OPS-005 | F07, F10 |

Los requisitos `REQ-FUT-*` están fuera de V1 y no cuentan para la cobertura de lanzamiento.

## 3. Incertidumbre y nivel de acción de los 92 escenarios

Cada fila de `SCENARIO_CATALOG.md` hereda:

- incertidumbre: `ninguna`;
- nivel de acción: `information`;
- comprobaciones: los requisitos de la sección anterior, los gates y las invariantes de su fila.

Las siguientes listas sustituyen esos valores por el nivel más estricto. Al estar definidas como excepciones exhaustivas, todo escenario conserva un valor explícito.

### `immediate_conservative`

- C12: restricción de líquidos/renal.
- F27: déficit extremo solicitado.
- F36: síntoma importante durante seguimiento.
- F51: restricción de líquidos frente a objetivo genérico.

### `priority_review`

- C17: polimedicación con cobertura parcial.
- C18: valor manual fuera de rango.
- F33: falta dosis que una regla exige.
- F38: laboratorio sin unidad/rango suficiente.
- F40: candidato clínico inválido.
- F44: lesión declarada con patrón afectado.
- F56: interacción farmacológica documentada.

### `adjustment`

- C02–C05, C07–C16 y C19–C22.
- F17–F35 salvo F27 y F33.
- F37, F39 y F41–F60 salvo F44, F51 y F56.
- F61–F67.

El resto permanece en `information` porque prueba admisión, seguridad de acceso, serialización o ausencia de efecto, no una recomendación de módulo.

### Incertidumbres distintas de `ninguna`

| Estado | Escenarios |
|---|---|
| `missing` | C02 cuando falta actividad, C13 cuando falta dato aplicable, C17, F17, F22, F33, F38, F46, F49, F64 |
| `partial_coverage` | C17, F32, F33, F56, F66 |
| `estimated` | C19, F53 |
| `stale` | F37 |
| `conflicting` | F13, F30, F40 |
| `invalid_candidate` | F40 |

Si el fixture no activa la condición indicada, el estado vuelve a `ninguna`; el fixture versionado debe dejarlo explícito.

## 4. Evidencia por ejecución

Cada resultado debe registrar:

- requisito e ID de escenario;
- gates e invariantes;
- incertidumbre y nivel de acción efectivos;
- dataset y versiones;
- hash normativo cuando exista;
- capa de prueba: unitaria, propiedad, integración, contrato, E2E, manual o operación;
- estado `PASS`, `FAIL`, `BLOCKED` o `NOT_IMPLEMENTED`;
- enlace a artefacto o defecto.

No se permiten filas sin requisito ni requisitos V1 sin escenario. Una comprobación automática de documentación debe fallar si desaparece un ID.
