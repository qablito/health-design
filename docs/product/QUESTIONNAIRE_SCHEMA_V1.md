# Schema canónico del cuestionario V1

> **Versión:** `QUESTIONNAIRE_SCHEMA_VERSION=1`
> **Estado:** implementado y verificado localmente
> **Evidencia:** [`TASK_06_VERIFICATION.md`](../quality/TASK_06_VERIFICATION.md)

Este documento fija qué recoge el asistente V1, cuándo aparece cada pregunta y
qué ausencia impide confirmar o convierte el contexto en provisional. El
contrato ejecutable está en
[`packages/contracts/src/questionnaire.ts`](../../packages/contracts/src/questionnaire.ts)
y las reglas puras de visibilidad y criticidad en
[`packages/domain/src/questionnaire/index.ts`](../../packages/domain/src/questionnaire/index.ts).

## 1. Resultado y límites

El asistente:

- trabaja exclusivamente con perfiles adultos y país `ES` en V1;
- permite activar uno o más módulos entre alimentación, entrenamiento,
  hidratación, sueño, movilidad y suplementación;
- admite un objetivo principal y hasta dos secundarios;
- guarda cada sección confirmada en remoto y reanuda el último bloque
  confirmado entre dispositivos;
- conserva una edición todavía no confirmada solo en memoria;
- permite confirmar un contexto `provisional` cuando faltan respuestas
  críticas, conservando cada incertidumbre y sus módulos afectados;
- no genera todavía dieta, entrenamiento ni otro plan: esa frontera comienza
  en T7–T8.

## 2. Errores estructurales e incertidumbres

Solo tres estados impiden confirmar el contexto:

| Código | Condición |
| --- | --- |
| `modules_required` | no se ha seleccionado ningún módulo |
| `primary_objective_required` | falta el objetivo principal |
| `secondary_objectives_limit` | hay más de dos objetivos secundarios |

Una respuesta clínica, fisiológica o de módulo ausente no se inventa ni se
convierte en un porcentaje de riesgo. Produce `completeness=provisional` y una
entrada estructurada con `answerId`, `blockId`, `affectedModules` y `reason`.

## 3. Bloques y ramas

| Bloque | Contenido principal | Ramas relevantes |
| --- | --- | --- |
| Núcleo | edad, sexo fisiológico, altura, peso, actividad, horario y país interno | embarazo/lactancia y menopausia dependen del sexo declarado |
| Objetivos | principal, hasta dos secundarios y peso objetivo | el peso objetivo aparece para pérdida de grasa o aumento de masa |
| Módulos | seis módulos seleccionables | exige al menos uno al confirmar |
| Alimentación | 2–6 comidas, alergias, contaminación cruzada, intolerancias, gustos, rechazos, ansiedad, proteína y supermercado habitual opcional | los detalles aparecen solo cuando se declara alergia o intolerancia; comparar supermercados es una preferencia independiente |
| Entrenamiento | generado, propio o ninguno; estilo, días, tiempo, material, intensidad y limitaciones | la rutina generada desaparece si se elige entrenamiento propio o ninguno |
| Hidratación | agua habitual, bebidas, clima, sudoración, anclajes y recordatorios | los recordatorios nacen desactivados |
| Sueño | horas, horario, regularidad, calidad y mediciones manuales | REM, profundo y ligero aparecen solo si existen mediciones |
| Movilidad | zonas, molestias y núcleo de 5/10/15 minutos | el detalle aparece solo cuando se declaran molestias |
| Suplementación | productos actuales, detalles conocidos, objetivo y preferencia de recomendación | el listado aparece solo si se declara consumo actual |
| Clínico | condiciones, medicación, tratamientos hormonales, embarazo/lactancia y menopausia | condición y medicación abren sus entradas estructuradas |
| Analíticas | pregunta inicial y valores manuales con unidad, fecha/rango, referencia y fuente | no hay OCR ni importación automática en V1 |
| Resumen | conocido, ausente, módulos afectados y edición por bloque | la activación de un plan no pertenece a T6 |

El modo de entrenamiento se pregunta aunque no se solicite una rutina generada,
porque una actividad propia o su ausencia puede cambiar alimentación,
hidratación, descanso y movilidad. Elegir `none` nunca crea sesiones de
entrenamiento.

## 4. Entradas híbridas y texto libre

Los campos de alimentos, supermercado, condiciones, medicación, suplementos y
analíticas ofrecen sugerencias buscables mediante controles nativos. Si una
opción no aparece, puede escribirse una entrada breve. Las sugerencias no
diagnostican, prescriben ni afirman cobertura farmacológica exhaustiva. La
fuente de una analítica manual es opcional y distingue laboratorio, dispositivo
o dato comunicado por la persona.

Límites antes de normalizar:

- nombre o término de búsqueda: 120 grafemas;
- nota breve: 500 grafemas;
- colección clínica: 50 entradas;
- cuerpo HTTP: 256 KiB;
- profundidad JSON: 12;
- claves JSON: 2.000;
- longitud física de un array antes del schema: 500.

Medicación y suplementos aceptan nombre y, solo cuando se conocen, dosis,
frecuencia, vía y horario. Una alergia admite una nota específica de
contaminación cruzada. Una intolerancia conserva cantidad tolerada y gravedad.

## 5. Persistencia, concurrencia y privacidad local

`public.questionnaire_drafts` mantiene un único borrador por perfil con
`schema_version`, `version`, `status`, `completeness`, respuestas, bloques
confirmados, bloque actual, incertidumbres y errores estructurales. El acceso
directo de `anon` y `authenticated` está revocado; la Edge Function usa RPC
cerradas con `service_role` después de comprobar sujeto Auth, sesión de
dispositivo y membresía activa del perfil.

Cada escritura exige `expectedVersion`, `If-Match` e `Idempotency-Key`. Un
reintento idéntico devuelve la misma confirmación; reutilizar la clave con otro
contenido o escribir sobre una versión obsoleta se rechaza.

Las respuestas no se guardan en `localStorage`, IndexedDB, Cache API, URL ni
historial. El service worker de producción solo considera `GET` del mismo
origen bajo `/assets/`; no intercepta documentos, Edge Functions ni datos de
perfil. Sus caches públicas se eliminan al cerrar sesión o revocar acceso, y
la misma primitiva queda disponible para el flujo de borrado de T18.

## 6. API estable de T6

| Operación | Comportamiento |
| --- | --- |
| `GET /v1/questionnaire/schema` | devuelve copy, opciones, sugerencias, dependencias y versión, sin respuestas |
| `GET /v1/profiles/{id}/draft` | recupera el último borrador remoto autorizado |
| `PUT /v1/profiles/{id}/draft` | confirma una sección con versión e idempotencia |
| `POST /v1/profiles/{id}/draft/submit` | confirma el resumen completo o provisional; no genera plan |

Las cuatro respuestas usan `Cache-Control: no-store, private`. La plataforma
mantiene verificación JWT y la autorización de fila se vuelve a comprobar en
cada operación.
