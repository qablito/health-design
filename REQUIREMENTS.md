# Requisitos verificables V1

Estado: contrato funcional para diseño, prototipo y pruebas. Prioridad `V1`
significa necesario para la primera versión; `FUTURO` queda fuera del alcance
actual. Los IDs son estables y no deben reciclarse.

## Cómo leer la trazabilidad

Las ocho puertas de salida son:

- **G1** cuestionario y contexto
- **G2** cálculos deterministas
- **G3** seguridad clínica/farmacológica
- **G4** coherencia entre módulos
- **G5** versionado, activación y seguimiento
- **G6** datos, catálogo y exportación
- **G7** resiliencia, seguridad y restauración
- **G8** UX, accesibilidad e impresión

Un requisito puede tener varias puertas; una puerta no se considera aprobada si
falla cualquiera de sus requisitos críticos.

## Acceso, identidad y sesiones

| ID | Pri. | Requisito verificable | Criterio de aceptación | Gate |
|---|---|---|---|---|
| REQ-ACC-001 | V1 | El alta requiere invitación de un uso y edad ≥18 | Abrir la ruta pública de la aplicación no crea perfil: el secreto de invitación solo se entrega en el cuerpo de un POST; una invitación expirada/revocada/reutilizada o una edad menor tampoco crean perfil; TTL inicial 7 días | G1,G7 |
| REQ-ACC-002 | V1 | El perfil usa alias visible y código privado de vinculación | El alias queda reservado y es único entre perfiles `active` o `deletion_requested`; se libera solo cuando `DeletionJob` alcanza `purged` y elimina la fila del perfil, y nunca autentica; el código tiene ≥128 bits CSPRNG, no se almacena en claro y se muestra una vez | G7,G8 |
| REQ-ACC-003 | V1 | La vinculación entre dispositivos admite código o QR | QR ≥128 bits, TTL 5 minutos, consumo atómico de un uso y sin datos de salud; cada dispositivo obtiene identidad propia | G7 |
| REQ-ACC-004 | V1 | Las sesiones son independientes, rotatorias y revocables | Cada identidad Auth representa un dispositivo lógico; el usuario ve dispositivo/fecha/actividad y puede revocar el acceso a un perfil sin afectar otras membresías; access token exacto de 15 min, refresh rotation activa/reuse 10 s y sesión de dispositivo con 30 días idle/180 días máximos | G7,G8 |
| REQ-ACC-005 | V1 | El superadministrador puede restablecer, revocar e impersonar | La interfaz indica persistentemente la sesión de superadministrador | G7,G8 |
| REQ-ACC-006 | V1 | El registro técnico del superadministrador es privado | El usuario común no ve trazas; el superadministrador sí puede consultar el registro | G7 |
| REQ-ACC-007 | V1 | La pérdida del código tiene flujos separados | Con sesión se rota y revoca atómicamente el código anterior sin cerrar sesiones; sin sesión no hay autoservicio y el restablecimiento administrativo genera código nuevo y permite revocar accesos | G7,G8 |
| REQ-ACC-008 | V1 | El borrado permanente no revive tras una restauración | La solicitud bloquea acceso ordinario; la ejecución purga membresías/datos/Storage/exportaciones, elimina Auth solo si queda huérfana, libera alias y conserva un `DeletionJob` terminal mínimo aunque `Profile` ya no exista; el ledger externo se aplica al probar las cuatro copias | G7 |

## Administración

| ID | Pri. | Requisito verificable | Criterio de aceptación | Gate |
|---|---|---|---|---|
| REQ-ADM-001 | V1 | El superadministrador dispone del control completo confirmado | Puede consultar y modificar perfiles, respuestas, planes, reglas, catálogos, sesiones y métricas mediante operaciones explícitas | G5,G6,G7 |
| REQ-ADM-002 | V1 | El acceso administrativo exige identidad separada y MFA | Login y acciones privilegiadas requieren AAL2; el cliente no puede autoasignar rol ni acceder directamente con `service_role` | G7 |
| REQ-ADM-003 | V1 | La impersonación conserva actor original y perfil efectivo | Indicador persistente, salida inequívoca y evento privado con actor/objetivo/request_id para cada mutación | G5,G7,G8 |

## Cuestionario y contexto

| ID | Pri. | Requisito verificable | Criterio de aceptación | Gate |
|---|---|---|---|---|
| REQ-INT-001 | V1 | El asistente adapta preguntas a módulos y respuestas | En un perfil simple no aparecen ramas irrelevantes; las ramas clínicas sí aparecen cuando aplican | G1,G8 |
| REQ-INT-002 | V1 | El recorrido prioriza selectores y persigue 15–20 min | En piloto, mediana ≤20 min en perfiles completos; ningún texto largo es obligatorio y el tiempo restante se muestra como estimación | G1,G8 |
| REQ-INT-003 | V1 | El cuestionario guarda automáticamente y permite reanudar | Cerrar y volver a abrir conserva el último bloque confirmado | G1,G7 |
| REQ-INT-004 | V1 | Preguntas críticas sin respuesta producen provisional conservador | El sistema identifica la incertidumbre y no inventa un valor | G1,G3 |
| REQ-INT-005 | V1 | El resumen permite editar datos antes de generar | Cada dato vuelve a su selector/búsqueda y el resumen se actualiza | G1,G8 |
| REQ-INT-006 | V1 | Solo adultos y objetivos limitados | Se permite un objetivo principal y hasta dos secundarios entre composición, rendimiento y bienestar | G1,G4 |
| REQ-INT-007 | V1 | Se selecciona al menos un módulo | Una petición con cero módulos se rechaza antes de generar y conserva el borrador | G1,G4 |

## Motor de planes y versionado

| ID | Pri. | Requisito verificable | Criterio de aceptación | Gate |
|---|---|---|---|---|
| REQ-PLN-001 | V1 | El motor sigue contexto→normalización→reglas→módulos→reconciliación→validación | La misma entrada canónica y versiones devuelve iguales `input_hash`/`output_hash`; el texto LLM queda fuera del hash normativo | G2,G4 |
| REQ-PLN-002 | V1 | Las restricciones obligatorias dominan a condicionales y preferencias | Ninguna preferencia relaja una restricción obligatoria | G2,G3 |
| REQ-PLN-003 | V1 | El plan separa estado de ciclo y completitud | Son distinguibles borrador/activo/archivado y completo/provisional | G5,G8 |
| REQ-PLN-004 | V1 | Todo cambio calcula impacto antes de modificar | El plan activo queda intacto y se crea candidato con diff | G4,G5 |
| REQ-PLN-005 | V1 | La activación de cambios estructurales es manual | Candidato no activado no cambia consulta, PDF ni lista de compra | G5,G7 |
| REQ-PLN-006 | V1 | Una versión conserva contexto, reglas, fuentes y configuración | Un plan archivado puede reproducir el resultado original | G5,G6 |
| REQ-PLN-007 | V1 | Borrador inicial y candidato apuntan a versiones calculadas concretas | La primera generación crea una versión calculada en borrador y solo una activación manual la convierte en activa; cada candidato enlaza versiones base y candidata inmutables | G5 |

## Alimentación

| ID | Pri. | Requisito verificable | Criterio de aceptación | Gate |
|---|---|---|---|---|
| REQ-NUT-001 | V1 | Energía adaptativa muestra banda y objetivo central | La pantalla muestra rango, centro recalculable y supuestos | G2,G8 |
| REQ-NUT-002 | V1 | Objetivos de composición incluyen rango temporal y fecha central orientativa | Una regla versionada evalúa objetivo/ritmo con edad, medidas, contexto y restricciones; los fixtures inadecuados reciben objetivo intermedio y nunca fecha exacta | G2,G3 |
| REQ-NUT-003 | V1 | Macronutrientes siguen reglas confirmadas | Grasa central 30 % (banda 20–35 %), carbohidrato residual y fibra ≥25 g/objetivo 14 g/1000 kcal sujeto a contexto | G2,G3 |
| REQ-NUT-004 | V1 | La proteína prioriza alimentos reales | La proteína en polvo solo aparece si el usuario la elige explícitamente | G2,G4 |
| REQ-NUT-005 | V1 | La semana base es estable, repetible y de 2–6 comidas | Se puede elegir modo simple o equilibrado y el número de comidas | G4,G8 |
| REQ-NUT-006 | V1 | Cada alimento muestra cantidad de referencia, kcal, macros, fibra y sustituciones | Hay dos sustitutos por alimento; conservan función/estado compatible, respetan restricciones y mantienen las bandas tras recalcular | G2,G4,G6 |
| REQ-NUT-007 | V1 | Alergia, contaminación cruzada, intolerancia y gusto son distintos | Alérgeno excluye contaminación declarada; intolerancia refleja cantidad/gravedad; gusto solo prioriza | G3,G4 |
| REQ-NUT-008 | V1 | Ansiedad alimentaria modifica estructura y estrategias | El plan ofrece saciedad, regularidad y estrategias sin moralizar | G3,G4,G8 |

## Entrenamiento, movilidad, hidratación y sueño

| ID | Pri. | Requisito verificable | Criterio de aceptación | Gate |
|---|---|---|---|---|
| REQ-MOV-001 | V1 | El entrenamiento tiene tres estados | Generado, propio o ausencia; ausencia no crea sesiones ocultas | G1,G4 |
| REQ-MOV-002 | V1 | Una sesión generada es ejecutable y progresiva | Incluye calentamiento, ejercicios, series/reps/tiempo, RPE/RIR, descanso, técnica, alternativas, progresión y vuelta a la calma | G4,G8 |
| REQ-MOV-003 | V1 | La movilidad tiene núcleo de 5 min y extensiones de 10/15 min | Se puede anclar a momentos diarios y omitir extensiones | G4,G8 |
| REQ-MOV-004 | V1 | Cada ejercicio de V1 tiene explicación e ilustración secuencial propia | Cobertura 100 % del catálogo publicable; alternativa estática accesible, licencia/procedencia y revisión anatómica registradas | G6,G8 |
| REQ-HYD-001 | V1 | Hidratación separa agua total y bebidas propuestas | La banda y el centro consideran alimentos, bebidas, actividad y contexto | G2,G4 |
| REQ-HYD-002 | V1 | El motor aplica reglas de calor, sudor, ejercicio y farmacología | Pérdidas, retención, electrolitos y restricciones se distinguen; anabolizantes desplazan al extremo alto seguro sin suma fija | G3,G4 |
| REQ-HYD-003 | V1 | Recordatorios son opcionales y están apagados por defecto | Los anclajes y señales dentro de la aplicación funcionan sin notificaciones del sistema operativo; estas quedan fuera de V1 | G8 |
| REQ-SLP-001 | V1 | Sueño usa registro manual y datos de dispositivo como estimaciones | Horas, horario, regularidad, calidad y fases opcionales se introducen manualmente; no existe sincronización/importación en V1 | G1,G4 |
| REQ-SLP-002 | V1 | Seguimiento semanal es mínimo y diario opcional | La ausencia diaria no bloquea; la tendencia no predice diagnósticos | G4,G8 |

## Clínica, medicación, suplementos y laboratorios

| ID | Pri. | Requisito verificable | Criterio de aceptación | Gate |
|---|---|---|---|---|
| REQ-CLN-001 | V1 | Las reglas clínicas/farmacológicas son versionadas y clasificadas | Obligatoria, condicional y preferente son visibles internamente y se aplican en ese orden | G3,G5 |
| REQ-CLN-002 | V1 | AEMPS/CIMA es identidad canónica y la cobertura es selectiva | Dosis/frecuencia/vía/horario solo afectan una regla documentada; nunca se afirma cobertura exhaustiva | G3,G6 |
| REQ-CLN-003 | V1 | Se contextualizan tratamientos de pérdida de peso y hormonas | Nunca se recomienda, pauta o ajusta uso recreativo anabólico | G3 |
| REQ-SUP-001 | V1 | Suplementos priorizan carencias dieta+medicación+contexto | Cada recomendación incluye evidencia, confianza, riesgos, contraindicaciones, interacción, métrica y salida | G3,G6 |
| REQ-SUP-002 | V1 | Opciones experimentales están separadas | Evidencia baja/conflictiva, beneficio pequeño, riesgos y alternativa con más respaldo quedan desplegables | G3,G8 |
| REQ-LAB-001 | V1 | Los valores manuales conservan fecha/unidad/rango e historial | Se usa el más reciente, se muestra tendencia básica y la confianza decae con el tiempo | G3,G5 |
| REQ-LAB-002 | V1 | Un valor fuera de rango recalcula solo lo afectado | La UI informa módulo, confianza y no bloquea el resto | G3,G4 |

## Asistente de lenguaje

| ID | Pri. | Requisito verificable | Criterio de aceptación | Gate |
|---|---|---|---|---|
| REQ-AI-001 | V1 | Luna se invoca únicamente tras una salida normativa válida | Una validación fallida no produce llamada; el payload excluye secretos e identificadores innecesarios | G2,G3,G7 |
| REQ-AI-002 | V1 | La respuesta cumple un JSON Schema cerrado | Cualquier número, dosis, límite, alimento, ejercicio, estado o claim clínico no derivado del plan se rechaza íntegramente | G2,G3 |
| REQ-AI-003 | V1 | El fallo o ausencia de IA no bloquea el producto | Timeout, JSON inválido, proveedor caído o presupuesto agotado muestran fallback determinista y no cambian el hash normativo | G2,G5,G7 |
| REQ-AI-004 | V1 | La aplicación aplica un corte duro de autorización de 10 € al mes | `cap_eur` queda fijado por constraint a 10,00; una reserva transaccional idempotente usa la cota máxima contractual de cada petición y una revisión aprobada de precio/FX, mantiene la reserva ante timeout hasta reconciliar y bloquea nuevas llamadas ante anomalía del proveedor; un incumplimiento de facturación externo se registra como riesgo residual, no como gasto autorizado | G7 |
| REQ-AI-005 | V1 | Toda explicación conserva una configuración de proveedor aprobada y reproducible | Se guardan proveedor/modelo, `prompt_version`, `prompt_hash`, schema, política, precio y revisión de proveedor; nunca prompt completo ni payload clínico, y Luna permanece apagada si no se confirman región, retención y no entrenamiento | G5,G6,G7 |

## Datos, catálogo y compra

| ID | Pri. | Requisito verificable | Criterio de aceptación | Gate |
|---|---|---|---|---|
| REQ-DAT-001 | V1 | Cada dato nutricional o comercial importado conserva identidad, estado, unidad o formato, fuente, versión, fecha, licencia y procedencia verificable | Ningún promedio silencioso entre fuentes; lo desconocido permanece desconocido; cada lote conserva hashes bruto/normalizado y manifiesto de captura/transformación | G2,G6 |
| REQ-DAT-002 | V1 | El catálogo federado aplica CIQUAL 2025 y fuentes prioritarias documentadas | La procedencia es consultable internamente por alimento y plan | G6 |
| REQ-DAT-003 | V1 | El escaneo comercial requiere confirmación del usuario | La corrección confirmada se reutiliza de inmediato solo en el perfil propietario; otros perfiles la reciben únicamente después de que el superadministrador cree una revisión global aprobada | G6,G7 |
| REQ-DAT-004 | V1 | Comparaciones, redondeos y discrepancias siguen el contrato numérico | Un valor supera exactamente el umbral documentado y abre revisión; redondear la UI no cambia el valor interno | G2,G6 |
| REQ-DAT-005 | V1 | El matching comercial es versionado y aplica exclusiones primero | Estados exact/allowed/review/excluded/insufficient; un SKU tiene como máximo un canónico activo y unknown alergénico no se autoelige | G3,G6 |
| REQ-DAT-006 | V1 | Una cadena solo se publica al superar su puerta de cobertura | Sobre cesta 60+20: cobertura ≥90 %, cada grupo esencial ≥75 %, precio/formato utilizables y activación manual; caída oculta sin borrar historia | G6,G7 |
| REQ-DAT-007 | V1 | Producto comercial y alimento canónico usan resoluciones separadas | Una corrección de etiqueta solo rige ese producto; el alimento genérico mantiene su revisión efectiva y precedencia propia | G2,G6 |
| REQ-SHP-001 | V1 | El plan activo es la verdad nutricional | Cambiar SKU afecta envases, sobrante y coste, nunca kcal/macros de la comida | G4,G6 |
| REQ-SHP-002 | V1 | La lista agrega cantidades semanales y descuenta solo sobrante confirmado | Un producto sin equivalencia muestra «Sin producto confirmado» y no se autoelige | G4,G6 |
| REQ-SHP-003 | V1 | El supermercado habitual es una preferencia vinculante | Se puede avisar de ahorro en otra cadena, pero no se cambia la elección | G6,G8 |
| REQ-SHP-004 | V1 | El comparador calcula desembolso real y cobertura | No se declara «más barato» si falta una línea; no hay ofertas, cupones, transporte o checkout | G6,G7 |
| REQ-SHP-005 | V1 | Orden y filtros son consistentes | Precio normalizado ascendente por defecto; precio asc/desc y A–Z/Z–A idénticos en UI/PDF/impresión | G6,G8 |

## Exportación, seguimiento y calidad

| ID | Pri. | Requisito verificable | Criterio de aceptación | Gate |
|---|---|---|---|---|
| REQ-EXP-001 | V1 | PDF compacto y completo representan el mismo plan versionado | Compacto muestra elecciones; completo incluye alternativas; ambos omiten compuestos sensibles | G6,G8 |
| REQ-EXP-002 | V1 | Existe modo ingredientes y cantidades o preparación breve | El usuario elige el modo sin perder nutrientes ni sustituciones | G6,G8 |
| REQ-EXP-003 | V1 | Hay lista de compra y preparación semanal opcionales | Se puede exportar día, semana, lista y preparación | G6,G8 |
| REQ-EXP-004 | V1 | Excel/Google Sheets es editable | Se genera XLSX con hojas Plan, Compra, Preparación y Metadatos cuando apliquen; conserva unidades/versión y neutraliza fórmulas | G6,G7 |
| REQ-FOL-001 | V1 | Revisión semanal pregunta solo variables activas | El seguimiento no añade carga de módulos desactivados | G4,G8 |
| REQ-FOL-002 | V1 | Revisión de cuatro semanas o cambio material crea candidato | Se mantiene plan base estable y activación manual | G5 |
| REQ-QA-001 | V1 | Se prueban 22 perfiles completos y 70 casos focales | Cada escenario comprueba requisitos, invariantes, incertidumbre, nivel de acción y puerta de salida | G1,G2,G3,G4,G5,G6,G7,G8 |
| REQ-QA-002 | V1 | Se cumple WCAG 2.2 AA e impresión equivalente | Teclado, lector de pantalla, contraste, reduced motion y orden impreso se verifican | G8 |
| REQ-QA-003 | V1 | Hay aislamiento dev/prod, backups, restore y cadena de suministro verificables | Cuatro rotaciones, streams externos con AEAD/recibos firmados/rangos borrados verificables, sesión/cleanup anónimo, copia previa crítica, SCA, SBOM, procedencia/firma y restore aislado sin truncamiento se prueban | G7 |

## Operación y protección de datos

| ID | Pri. | Requisito verificable | Criterio de aceptación | Gate |
|---|---|---|---|---|
| REQ-OPS-001 | V1 | Continuidad usa copia semanal, precrítica y streams externos independientes | Cuatro rotaciones cifradas y verificadas; RPO ≤7 días, RTO ≤24 h, claves versionadas y restore aislado que aplica `deletions`, suprime rangos de auditoría borrados y reconstruye `admin-audit` antes de promover | G7 |
| REQ-OPS-002 | V1 | Exportaciones y activos sensibles usan almacenamiento privado | La descarga se proxyfica tras autenticar actor y perfil, sin bearer en URL; usa `no-store`, nombre sin PII y revocación inmediata tras borrar | G6,G7 |
| REQ-OPS-003 | V1 | Logs y auditoría usan esquema redactado y continuidad verificable | Ningún sink recibe body/query/headers ni códigos, tokens, Turnstile, respuestas, valores clínicos, medicación o prompts; cada acción privilegiada persiste `intent/outcome`, los intents huérfanos se reconcilian en operación normal y un rango borrado solo produce un hueco válido mediante recibo firmado en `deletions` | G7 |
| REQ-OPS-004 | V1 | Los endpoints sensibles resisten enumeración, abuso y payloads hostiles | Acceso usa 5/15 min y 30/h/IP; generación/exportación/compra/Luna aplican concurrencia, ventanas, idempotencia y `Retry-After`; bytes/profundidad/filas se rechazan según contrato y Turnstile conserva CSP exacta | G7 |
| REQ-OPS-005 | V1 | Desarrollo y producción están aislados | Proyectos, datos, claves, buckets y dominios separados; CI usa solo datos sintéticos | G7 |

## Requisitos explícitamente diferidos

| ID | Pri. | Requisito futuro | Condición para abrirlo | Gate futuro |
|---|---|---|---|---|
| REQ-FUT-001 | FUTURO | Integraciones Apple Health, Health Connect, Garmin, Fitbit y similares | Consentimiento, conectores estables y pruebas de calidad | G1,G7 |
| REQ-FUT-002 | FUTURO | Proveedor LLM local intercambiable | Igualar contratos, pruebas y límites del proveedor Luna | G2,G3,G7 |
| REQ-FUT-003 | FUTURO | Refresco diario de precios/catálogo | Política de acceso, legalidad, monitorización y rollback | G6,G7 |
| REQ-FUT-004 | FUTURO | OCR/importación de analíticas y documentos | Extracción revisable, trazabilidad y confirmación humana | G3,G6 |
| REQ-FUT-005 | FUTURO | AAA selectivo y personalización visual avanzada | Auditoría AA estable y pruebas específicas por componente | G8 |
