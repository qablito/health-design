# Contrato de producto V1

## 1. Propósito

Health Design V1 será una aplicación web privada que recopila contexto personal mediante un asistente breve y genera un plan integrado, explicable y versionado de los módulos que el usuario seleccione:

- alimentación;
- entrenamiento;
- hidratación;
- sueño y descanso;
- movilidad y estiramiento;
- suplementación.

El producto busca producir la mejor propuesta posible dentro de un espacio de restricciones explícitas. Cuando falten datos o cobertura, no inventará certeza ni eliminará el resto del plan: entregará una versión provisional conservadora, identificará cada incertidumbre y recalculará únicamente los módulos afectados.

## 2. Alcance de V1

### Incluido

- Aplicación web responsive y PWA desplegada en internet.
- Acceso solo mediante invitación.
- Personas adultas de 18 años o más.
- Contexto de alimentos, compra, idioma y mercado centrado en España.
- Hasta 10 usuarios iniciales.
- Perfiles remotos utilizables desde varios dispositivos.
- Plan semanal estable y repetible, seguimiento y regeneración solicitada.
- Consulta web, impresión, PDF y exportación editable compatible con Excel o Google Sheets.
- Catálogos curados y versionados de alimentos, reglas farmacológicas y productos comerciales.
- Intervención completa del superadministrador y registro técnico privado.

### Fuera de V1

- Menores de edad.
- Diagnosticar enfermedades o sustituir un acto clínico.
- Recomendar, iniciar, retirar o modificar medicación.
- Recomendar o ayudar a usar anabolizantes recreativos, SARMs, péptidos u otras sustancias de riesgo.
- Checkout, entrega, pedido mínimo, bolsas, cupones, ofertas o programas de fidelización.
- Marcas concretas de suplementos.
- Integración directa con Apple Health, Health Connect, Garmin, Fitbit u otros servicios.
- Lectura automática de informes clínicos, OCR o importación de PDF.
- Verificador farmacológico exhaustivo.
- Actualización diaria automática de todos los supermercados.
- Aplicación nativa móvil.
- Afirmación formal de conformidad regulatoria o clasificación sanitaria.

## 3. Principios no negociables

1. El motor determinista versionado es la única fuente de cálculos, límites y decisiones.
2. Las restricciones obligatorias y condicionales se aplican antes de optimizar preferencias.
3. Ningún cambio estructural sustituye silenciosamente al plan activo.
4. La falta de información produce incertidumbre explícita, no datos inventados.
5. Un módulo desactivado no introduce recomendaciones encubiertas en otros módulos.
6. El entrenamiento es opcional y admite rutina generada, entrenamiento propio o ausencia de entrenamiento.
7. Los datos históricos conservan las reglas y fuentes con las que fueron calculados.
8. La IA explica una salida validada; no puede alterarla.
9. El alimento canónico determina nutrición; el SKU determina envases, coste y sobrante.
10. La preferencia explícita del usuario prevalece mientras respete el espacio seguro.

## 4. Acceso, perfiles y administración

### Usuario invitado

- Accede inicialmente con una invitación válida.
- Crea un perfil con alias visible y recibe un código privado de alta entropía.
- El alias queda reservado y es único entre perfiles activos o con borrado
  solicitado para facilitar el acceso, pero no es secreto ni autentica; solo
  tras completar la purga puede reutilizarse.
- Puede vincular otro dispositivo introduciendo el código o escaneando un QR de un solo uso y corta duración.
- Cada dispositivo mantiene una sesión independiente y revocable.
- Un mismo dispositivo puede conservar acceso a varios perfiles; revocar su
  acceso a uno no elimina sus otras membresías.
- Puede consultar sesiones con nombre del dispositivo, actividad aproximada y fecha.
- Puede renovar el código privado: el anterior deja de vincular de inmediato,
  mientras las sesiones se conservan o revocan según la acción elegida.
- Con una sesión activa puede rotar el código.
- Una sesión expira tras 30 días de inactividad o 180 días desde su creación y
  puede volver a vincularse con código o QR.
- Si pierde el código y no conserva ninguna sesión, no existe recuperación autoservicio: el superadministrador puede ejecutar un restablecimiento excepcional.

### Superadministrador

- Puede ver, crear, editar, archivar y eliminar perfiles, respuestas, planes y datos.
- Puede restablecer acceso, revocar sesiones e impersonar un perfil.
- Durante la impersonación existe un indicador persistente para evitar operar por error como el usuario.
- Las acciones privilegiadas quedan en un registro técnico privado, no visible para el usuario.
- Puede ejecutar eliminación permanente y administrar restauraciones.

### Conservación y borrado

- Los datos se conservan indefinidamente mientras el perfil exista.
- El usuario puede solicitar el borrado y el superadministrador ejecuta la eliminación permanente con confirmación reforzada.
- La solicitud cambia el perfil a `deletion_requested`: bloquea consulta,
  generación, edición y exportación ordinarias mientras se completa la purga.
- Completar la eliminación permanente borra los datos activos y permite
  reutilizar el alias.
- Se conserva solo un marcador técnico irreversible y mínimo en un ledger
  externo a Supabase y a las copias, que impide reintroducir el perfil borrado
  mediante una restauración.
- Las copias antiguas expiran naturalmente dentro de las cuatro rotaciones; el marcador se aplica antes de cualquier restauración.

## 5. Selección de módulos y objetivos

### Módulos

El primer tramo del asistente permite activar o desactivar cada módulo con una descripción breve de su utilidad. La selección debe completarse en segundos.

Debe seleccionarse al menos un módulo para generar un plan.

Para entrenamiento se elige exactamente uno:

1. generar una rutina;
2. adaptar el plan a entrenamiento propio;
3. no realizar entrenamiento.

Movilidad puede activarse de forma independiente aunque entrenamiento esté desactivado.

### Objetivos

- Un objetivo principal obligatorio.
- Hasta dos objetivos secundarios.
- El principal determina las prioridades de optimización.
- Los secundarios se integran cuando no contradigan restricciones o el objetivo principal.
- Solo se admiten categorías de composición corporal, rendimiento y bienestar con opciones definidas; no existe “Otro” de texto libre.

### Horizonte

El sistema presenta un rango temporal y una fecha central orientativa, nunca una fecha exacta. Si el objetivo solicitado no es prudente para el contexto, propone un objetivo intermedio seguro y muestra cómo se relaciona con la meta original.

## 6. Cuestionario adaptativo

### Experiencia

- Asistente secuencial por pasos.
- Duración objetivo de 15 a 20 minutos para un perfil completo.
- Progreso visible y estimación de tiempo restante.
- Guardado automático.
- Selectores, búsqueda con sugerencias, chips, escalas y opciones antes que texto libre.
- Resumen final editable antes de generar.
- Se pregunta solo aquello que modifica un cálculo, una restricción, una decisión o el nivel de confianza.
- Ningún campo de texto largo es obligatorio. Las altas manuales que no estén en un catálogo usan una descripción breve y limitada.

En el piloto, el objetivo de experiencia es una mediana de finalización igual o inferior a 20 minutos para los perfiles completos definidos en pruebas; el percentil 90 puede superar ese valor cuando existan ramas clínicas, pero se mide y se muestra antes de comenzar.

### Núcleo común

- Edad adulta, sexo y contexto fisiológico.
- Altura, peso y datos de composición disponibles.
- Actividad cotidiana y entorno.
- Objetivo principal y secundarios.
- País de residencia y preferencias de compra.
- Condiciones, síntomas relevantes, embarazo, lactancia, menopausia u otro contexto hormonal.
- Medicación y sustancias declaradas.
- Módulos deseados.

### Ramificación

Cada módulo añade únicamente sus preguntas necesarias. Las condiciones clínicas, farmacológicas, hormonales y de laboratorio activan campos breves adicionales.

Si falta una respuesta crítica:

1. se formula una pregunta breve;
2. si sigue sin respuesta, se genera un plan provisional;
3. se identifica la incertidumbre, los módulos afectados y su efecto;
4. el resto del plan continúa si puede validarse.

## 7. Contexto clínico, farmacológico y de laboratorio

### Condiciones

Las condiciones declaradas modifican restricciones de alimentación, ejercicio, hidratación, sueño, movilidad y suplementos cuando existe una regla documentada. El sistema no diagnostica ni cambia tratamientos.

### Medicación y sustancias

- Entrada mediante buscador con sugerencias y opción mínima de texto cuando no aparezca.
- Identidad canónica basada en AEMPS/CIMA.
- Se solicita nombre y, solo cuando una regla lo necesita, dosis, frecuencia, vía u horario.
- Cada identidad tiene cobertura modelada, parcial o no modelada.
- Los tratamientos para pérdida de peso, terapias hormonales, testosterona exógena y otras sustancias declaradas condicionan el plan.
- Los compuestos sensibles no aparecen en PDF ni impresión.
- Un cambio o suspensión declarada crea un candidato que reevalúa los módulos afectados.
- El sistema nunca pauta el uso recreativo ni ofrece optimización de ciclos.

### Analíticas y valores

- Introducción manual en V1.
- Pregunta inicial y campos sugeridos dinámicamente.
- Buscador opcional para añadir otros valores.
- Cada registro conserva valor, unidad, fecha o rango aproximado, intervalo de referencia cuando exista y procedencia declarada.
- Se conserva todo el historial; el valor más reciente es el principal.
- Solo se muestra una tendencia básica, sin predicciones.
- La confianza disminuye gradualmente con la antigüedad.
- Un valor fuera de rango recalcula únicamente módulos afectados, con explicación breve y confianza visible.

## 8. Motor de restricciones y nivel de acción

El motor opera en este orden:

1. normalizar y validar entradas;
2. activar restricciones obligatorias;
3. activar restricciones condicionales;
4. resolver conflictos explícitos con preguntas críticas;
5. construir el espacio permitido;
6. optimizar el objetivo principal;
7. incorporar objetivos secundarios y preferencias;
8. validar cada módulo;
9. reconciliar dependencias entre módulos;
10. validar el plan completo.

La fuerza de una salida usa una matriz de beneficio esperado, gravedad potencial y confianza de evidencia/datos. No se presentan porcentajes literales de beneficio y riesgo.

Cada módulo obtiene el nivel más estricto aplicable:

- información;
- ajuste;
- revisión prioritaria;
- alternativa conservadora inmediata.

Los niveles no se suman ni se promedian. El sistema siempre intenta producir una alternativa útil; no publica una instrucción que contradiga una restricción obligatoria.

## 9. Alimentación

### Energía y objetivos

- Motor energético adaptativo y determinista.
- Banda visible de energía y objetivo central recalculable dentro de ella.
- Ritmo y horizonte subordinados a contexto, tolerancia y objetivo.
- Reajuste a partir del seguimiento sin reescribir silenciosamente el plan activo.

### Macronutrientes y fibra

- Proteína contextual por objetivo, actividad, dieta y condiciones.
- Grasa dentro de una banda del 20 al 35 % de la energía, con 30 % como centro predeterminado.
- Carbohidratos cubren la energía restante.
- Fibra con mínimo general de 25 g y objetivo central de 14 g por 1000 kcal, siempre subordinado a tolerancia y contexto clínico.
- Se muestran energía, macronutrientes, fibra y nutrientes clínicamente relevantes cuando corresponda.

### Estructura

- Semana base de siete días, estable y repetible.
- De dos a seis comidas por día.
- Modo simple y modo equilibrado, explicados antes de elegir.
- Franjas flexibles con anclajes, no horarios rígidos.
- Dos vistas por comida: ingredientes y cantidades; preparación breve.
- Lista de compra y preparación semanal opcionales.

### Detalle y sustituciones

Cada alimento muestra:

- cantidad cruda o estado de referencia;
- energía;
- proteína, carbohidratos y grasa;
- fibra;
- nutrientes clínicamente relevantes cuando una regla los use.

Cada alimento individual dispone de dos sustitutos que mantienen su función nutricional. Al seleccionar uno se recalculan cantidades, energía y nutrientes de la comida, del día y de la semana, y se revalida el plan.

La equivalencia no usa un porcentaje universal: debe respetar estado/unidad, alergias e intolerancias, conservar la función declarada y mantener los totales dentro de las bandas aplicables después del recalculo.

### Preferencias y seguridad alimentaria

- Alergia: exclusión del alimento y de equivalencias con contaminación cruzada incompatible.
- Intolerancia: alimento, cantidad tolerada y gravedad de síntomas; puede limitar o excluir.
- Rechazo o disgusto: preferencia, no restricción clínica.
- Ansiedad alimentaria: adapta estructura, saciedad, alimentos, flexibilidad y estrategias; evita diseños que refuercen conductas compulsivas.

### Proteína en polvo

La dieta cubre por defecto la proteína mediante alimentos. El usuario puede elegir proteína en polvo como preferencia o sustituto; nunca se añade silenciosamente para cerrar el objetivo.

## 10. Entrenamiento y movilidad

### Modalidades

La rutina generada ofrece un conjunto breve pero amplio:

- pesas orientadas a fuerza;
- pesas orientadas a hipertrofia;
- fuerza e hipertrofia combinadas;
- calistenia o peso corporal;
- cardio;
- Pilates;
- yoga;
- funcional o HIIT;
- preparación para deporte;
- sin preferencia;
- otra modalidad mediante descripción breve.

### Bloque generado

- Bloque progresivo inicial de cuatro semanas.
- Cada sesión incluye calentamiento, ejercicios, series, repeticiones o duración, RPE/RIR cuando proceda, descanso, tempo, técnica, alternativas, progresión y vuelta a la calma.
- Todo tecnicismo tiene una explicación sencilla.
- Cada ejercicio requiere una ilustración secuencial propia; se añade animación cuando mejora materialmente la ejecución.
- Los recursos visuales reutilizados deben tener licencia compatible; los generados o reutilizados requieren revisión anatómica manual.

### Entrenamiento propio

El usuario describe mediante selectores su frecuencia, tipo, duración, intensidad y horario. Alimentación, hidratación, sueño y movilidad se adaptan a ese contexto sin generar una rutina nueva.

### Sin entrenamiento

No se añaden sesiones ni métricas de rendimiento. El resto de módulos se calcula para la actividad cotidiana declarada.

### Movilidad

- Módulo independiente.
- Núcleo breve de cinco minutos.
- Extensiones opcionales hasta 10 o 15 minutos.
- Anclajes flexibles a momentos del día o sesiones.

### Seguimiento

- Rutina generada: registro posterior de 20 a 30 segundos.
- Entrenamiento propio: resumen semanal.
- Sin entrenamiento: no se piden métricas de sesión.
- Ajustes menores pueden automatizarse dentro de límites; los estructurales generan candidato.

## 11. Hidratación

- Cálculo interno de agua total procedente de alimentos y bebidas registradas.
- El usuario ve una banda de bebidas y un objetivo central.
- Contexto: ingesta habitual, dieta, actividad, clima, sudor, entrenamiento, horarios, embarazo/lactancia, medicación y condiciones.
- Café, té y leche cuentan como líquidos; el alcohol puede registrarse, pero nunca se propone como estrategia de hidratación.
- Reglas específicas para ejercicio, calor y electrolitos.
- Estimación de sudor opcional y oculta cuando pueda reforzar trastornos alimentarios, pesaje compulsivo o malestar corporal.
- Restricciones renales, cardiacas, de hiponatremia o de fluidos prevalecen.
- El contexto farmacológico diferencia mecanismos de pérdida, retención, electrolitos, función renal y hematocrito.
- El uso declarado de anabolizantes desplaza el objetivo hacia la parte alta de la banda segura; no suma una cantidad fija ni afirma corregir el hematocrito.
- La pauta se distribuye mediante anclajes flexibles.
- Los recordatorios están desactivados inicialmente y son opcionales. En V1
  son señales dentro de la aplicación ligadas a los anclajes; las
  notificaciones del sistema operativo, calendarios y automatizaciones quedan
  para una versión posterior.

## 12. Sueño y descanso

- Registro manual de duración, horario, regularidad y calidad percibida.
- REM, sueño profundo y ligero son opcionales, se introducen manualmente desde
  el dispositivo y se tratan como estimaciones para tendencia. V1 no sincroniza
  ni importa datos del wearable.
- Objetivo en ventana flexible.
- Intervenciones contextuales sobre rutina, luz, pantallas, cafeína, alcohol, comidas, entrenamiento, siestas, turnos, medicación, embarazo y menopausia.
- Seguimiento semanal mínimo y diario detallado opcional.
- Tendencias básicas sin predicciones clínicas.
- Primero se ajustan hábitos, entorno, alimentación, hidratación y entrenamiento; los suplementos se evalúan en su módulo propio.

## 13. Suplementación

### Orden de decisión

1. cubrir mediante alimentación cuando sea posible;
2. detectar carencias confirmadas o plausibles;
3. considerar el contexto farmacológico y clínico;
4. valorar objetivos de rendimiento o bienestar;
5. aplicar evidencia, contraindicaciones e interacciones;
6. proponer seguimiento y criterio de retirada.

### Ficha de recomendación

Cada recomendación incluye:

- finalidad;
- nivel de evidencia y confianza;
- beneficio esperado;
- forma estudiada y dosis de referencia cuando proceda;
- duración o periodo de prueba;
- contraindicaciones, interacciones y riesgos;
- métrica de seguimiento;
- condición para mantener, retirar o considerar inconclusa la prueba.

### Niveles

- evidencia alta;
- evidencia moderada o dependiente del contexto;
- evidencia limitada o experimental;
- no recomendado.

Las opciones experimentales aparecen en una sección separada y desplegable con evidencia escasa o conflictiva, beneficio probablemente pequeño, riesgos y alternativas mejor respaldadas.

No se recomiendan marcas. Se introduce un suplemento nuevo cada vez. Sustancias recreativas, mezclas opacas y productos no validados pueden registrarse para analizar contexto, pero no reciben una recomendación activa.

## 14. Evidencia y datos nutricionales

### Jerarquía científica

Las revisiones manuales priorizan:

1. guías clínicas;
2. revisiones sistemáticas y metaanálisis;
3. ensayos controlados para lagunas;
4. estudios observacionales como apoyo;
5. estudios aislados revisados por pares como señal complementaria.

Cada regla conserva fuente, versión, fecha de revisión, población, fuerza, aplicabilidad y responsable de activación.

### Catálogo federado

No se promedian fuentes. Para un alimento canónico genérico, el orden general
es:

1. CIQUAL 2025;
2. BLS 4.0;
3. Fineli;
4. Livsmedelsverket;
5. USDA Foundation o SR Legacy.

BEDCA, EFSA y EuroFIR se usan solo cuando licencia, acceso y compatibilidad estén resueltos.

Cada dato nutricional conserva identidad, estado, parte comestible, unidad, método, fuente, versión, fecha y confianza. Los datos ausentes siguen ausentes.

Una corrección exacta aprobada tiene prioridad únicamente para el producto
comercial/GTIN al que pertenece; no reemplaza el alimento genérico.

### Productos comerciales

- Open Food Facts puede aportar candidatos.
- La etiqueta confirmada por el usuario tiene prioridad para ese producto.
- El escaneo de código de barras exige confirmación obligatoria.
- El usuario puede corregir los datos antes de guardar.
- La corrección se reutiliza en su perfil.
- Solo una corrección aprobada por el superadministrador se comparte con todos.
- GS1 se usa como identidad cuando sea accesible, no como verdad nutricional.
- El catálogo del supermercado aporta producto, formato, precio y disponibilidad, no macros canónicos.

## 15. Compra, supermercados y comparación

### Generación de cesta

- La fuente es el plan activo.
- Se agregan cantidades para la semana.
- Solo se descuentan existencias confirmadas por el usuario.
- La elección de SKU no modifica los nutrientes pautados.

### Un supermercado

- El usuario puede fijar un supermercado habitual.
- Esa elección es vinculante para la cesta mostrada.
- Se pueden mostrar avisos de ahorro en otra cadena, pero nunca se cambia la selección automáticamente.
- El optimizador minimiza el desembolso real combinando formatos válidos.
- En empate prioriza: menor sobrante, menos productos distintos, menos envases, menor precio normalizado y orden alfabético estable.

### Varios supermercados

- Modo opcional elegido por el usuario.
- Busca el máximo ahorro posible entre las cadenas seleccionadas, aunque sea de céntimos.
- No obliga a aceptar el resultado.

### Cobertura y precios

- Solo se denomina “cesta más barata completa” si todos los alimentos están cubiertos.
- Una cesta parcial muestra subtotal, productos pendientes y porcentaje de cobertura.
- Sin equivalencia válida se muestra “Sin producto confirmado”.
- Cambiar de cadena o hacer una sustitución nutricional requiere confirmación.
- Solo se usa precio base.
- No se incluyen ofertas, cupones, fidelización, transporte, bolsas ni pedido mínimo.
- Orden inicial: precio normalizado ascendente.
- Ordenaciones adicionales: precio ascendente/descendente y nombre A–Z/Z–A.
- Pantalla, PDF e impresión conservan el mismo orden.
- En V1 los precios se presentan como referencia para España; la procedencia operativa de Sevilla no se expone en la interfaz.

## 16. Catálogo comercial, matching y publicación

### Capas

1. catálogo comercial completo;
2. alimentos canónicos y reglas de equivalencia;
3. cesta de prueba V1.

La cesta de prueba contiene 60 alimentos fijos:

- 16 fuentes de proteína;
- 12 verduras;
- 8 frutas;
- 12 cereales, tubérculos o legumbres;
- 6 lácteos o alternativas;
- 6 grasas, frutos secos o semillas.

Se añaden 20 alimentos dinámicos según frecuencia de uso. Los 80 no limitan el catálogo extraído.

### Regla canónica de compatibilidad

Cada regla versionada define:

- categorías;
- alias;
- exclusiones;
- estado y parte comestible;
- presentación;
- variantes aceptadas;
- unidad;
- motivos de revisión.

Las exclusiones se evalúan primero y las coincidencias usan palabras completas. Un SKU queda en uno de cinco estados:

- exacto;
- variante permitida;
- requiere revisión;
- excluido;
- información insuficiente.

Solo puede tener un alimento canónico activo. Un cambio de metadatos reevalúa el enlace; precio y disponibilidad no cambian identidad. Los productos con advertencia alérgica incompatible o desconocida no pueden autoseleccionarse.

### Publicación de cadenas

Las reglas pueden generarse con asistencia, pero el superadministrador debe activarlas. Tras la activación, solo los casos inequívocos se vinculan automáticamente.

Una cadena puede mostrarse cuando:

- cubre al menos el 90 % de la cesta de prueba;
- ningún grupo esencial baja del 75 %;
- dispone de precio base y formato utilizables;
- el superadministrador la activa.

Si su calidad cae se oculta para nuevas cestas, manteniendo las referencias históricas.

## 17. Generación, versionado y edición

### Pipeline

1. capturar contexto;
2. normalizar;
3. calcular determinísticamente;
4. aplicar restricciones clínicas y farmacológicas;
5. generar módulos;
6. reconciliar dependencias;
7. validar;
8. producir explicaciones;
9. versionar.

### Estados

Eje de ciclo:

- borrador;
- activo;
- archivado.

Eje de calidad:

- completo;
- provisional.

Son independientes.

### Recalculo

Todo cambio detecta impacto y dependencias. El candidato muestra:

- dato que cambió;
- módulos recalculados;
- diferencias frente al activo;
- incertidumbres;
- nuevos objetivos o plazos.

Un candidato inválido no puede activarse. Los cambios estructurales requieren siempre revisión y activación manual.

Cada versión conserva contexto, fecha, reglas, fuentes, catálogo, configuración farmacológica y configuración del asistente de lenguaje.

## 18. Consulta, exportación y seguimiento

### Consulta

- Estado activo, fecha y condición completo/provisional siempre visibles.
- Vista por día, semana y módulo.
- Alternancia entre ingredientes/cantidades y preparación breve.
- Edición controlada de alimentos, horarios, días y ejercicios mediante opciones válidas.
- Toda edición recalcula y revalida.

### PDF e impresión

- PDF compacto con selecciones actuales.
- PDF completo con todas las alternativas.
- Ambos ofrecen ingredientes/cantidades y preparación breve.
- Ambos proceden de la misma versión estructurada que la pantalla.
- Los compuestos farmacológicos sensibles se omiten.

### Exportación editable

Formato compatible con Excel y Google Sheets, con estructura estable, unidades, versión y fecha. La importación de cambios desde hojas de cálculo no forma parte de V1.

El formato editable de V1 es XLSX con hojas separadas para plan, compra, preparación y metadatos cuando cada contenido exista.

### Seguimiento

- Revisión semanal mínima de dos a tres minutos.
- Detalle diario completamente opcional.
- Revisión completa cada cuatro semanas o ante cambio material.
- Solo se preguntan variables aplicables a módulos activos.
- Omitir el diario no bloquea; reduce precisión.
- Síntomas importantes activan una alternativa conservadora del módulo y una comunicación proporcional, sin diagnóstico.

## 19. Arquitectura, IA, seguridad, calidad e identidad

### Arquitectura confirmada

- React, TypeScript y Vite.
- PWA responsive.
- Cloudflare Pages para frontend.
- Cloudflare Worker, Durable Object y R2 privados para los streams
  independientes de borrado y auditoría privilegiada.
- Supabase en región europea para autenticación, base de datos, sincronización, funciones y almacenamiento.
- Row Level Security y privilegio mínimo.
- Secretos únicamente del lado servidor.
- Entornos de desarrollo y producción aislados.

### IA

La configuración objetivo es `gpt-5.6-luna` con el nivel de razonamiento más
bajo disponible. Solo se usa después de validar el resultado estructurado y
tras aprobar la revisión de proveedor. Puede:

- resumir;
- explicar;
- redactar instrucciones breves;
- aclarar tecnicismos.

No puede cambiar:

- números;
- alimentos;
- ejercicios;
- dosis;
- límites;
- advertencias;
- estados;
- decisiones clínicas.

La entrada y salida usan JSON validado. No se realiza búsqueda web normal
durante la generación. El límite mensual es de 10 €, con alertas al 50, 75 y
90 %. `cap_eur` queda fijado a 10,00 y cada llamada reserva
transaccionalmente su cota máxima contractual en EUR mediante una revisión
aprobada de precio/FX. Un timeout conserva la reserva hasta reconciliar; una
anomalía de coste bloquea llamadas posteriores. Siempre existe fallback
determinista si la reserva no cabe, falta conversión vigente o el proveedor
falla.

La interfaz del proveedor permitirá incorporar un modelo local en el futuro, sometido al mismo contrato y pruebas. Tampoco podrá controlar seguridad o cálculos.

Luna permanece desactivada hasta que exista una revisión de proveedor aprobada
que documente endpoint, modelo, región de procesamiento, retención, exclusión
de entrenamiento, precio, timeout y política de minimización. No se persisten
prompts completos ni payloads clínicos; se conservan versiones y hashes.
Si ese modelo/configuración no está disponible, no se sustituye en silencio:
se usa el fallback determinista hasta activar otra revisión.

### Seguridad operativa

- Cifrado en tránsito y reposo provisto y configurado en la plataforma.
- Sesiones independientes y revocables.
- QR de un solo uso, corta duración y sin datos de salud.
- Código privado almacenado mediante hash resistente.
- Copia lógica cifrada semanal.
- Copia previa a cambios críticos.
- Cuatro versiones rotativas.
- Ledger de borrados independiente de Supabase y de las copias restaurables.
- Prueba de restauración antes de invitar usuarios y tras cambios de esquema.
- Registro técnico privado para acciones de superadministrador.
- Lockfile, SCA, SBOM y procedencia/firma verificable del artefacto de release.

Los valores verificables de código, QR, invitación, sesiones, RLS, MFA, rate limits, exportaciones y continuidad se fijan en `docs/security/SECURITY_CONTRACT.md`.

### Calidad

Banco inicial:

- 22 perfiles completos;
- 70 casos focales;
- total de 92 escenarios.

Todo escenario define entradas, módulos, restricciones, resultado permitido, incertidumbres, nivel de acción y comprobaciones.

Invariantes mínimas:

- no inventar;
- no activar módulos ocultos;
- no relajar restricciones obligatorias;
- no ignorar preferencias silenciosamente;
- no aceptar sustituciones incompatibles;
- no mutar el plan activo;
- disponer de fallback.

La salida de V1 requiere aprobar ocho puertas:

1. cuestionario;
2. cálculos deterministas;
3. seguridad clínica;
4. coherencia entre módulos;
5. versionado;
6. datos, catálogo y exportación;
7. resiliencia, seguridad y restauración;
8. experiencia y accesibilidad.

### Accesibilidad e identidad

- Objetivo WCAG 2.2 AA.
- AAA selectivo se reserva para versiones posteriores según validación.
- Personalidad: rigurosa, serena y accesible.
- Se distingue visualmente lo conocido, estimado e incierto.
- Alertas proporcionales, sin dramatismo ni moralización.
- Estados provisional, confianza limitada y revisión se explican sin culpar.
- Se evitan tres direcciones: portal sanitario frío y burocrático, aplicación de gimnasio oscura y agresiva, bienestar pastel genérico.
- La interfaz prioriza legibilidad, espacio, jerarquía y acentos contenidos.
- El mismo vocabulario se usa en asistente, plan, alertas, PDF e impresión.

## 20. Métricas de éxito de la prueba privada

Las métricas sirven para validar utilidad y operabilidad, no eficacia clínica:

- porcentaje de cuestionarios terminados;
- tiempo mediano de finalización;
- preguntas abandonadas o corregidas;
- porcentaje de planes completos frente a provisionales;
- motivos de incertidumbre más frecuentes;
- activación de candidatos;
- uso de sustituciones, PDF, exportación y compra;
- finalización de seguimiento semanal;
- errores de validación y fallbacks;
- cobertura de alimentos y cadenas;
- gasto mensual de IA;
- incidencias de acceso, restauración y sesión;
- resultados de accesibilidad y de las ocho puertas.

## 21. Condiciones para iniciar implementación

La implementación puede comenzar cuando:

1. este contrato y `REQUIREMENTS.md` sean coherentes;
2. arquitectura, dominio, API y datos definan estados e invariantes;
3. el modelo de amenazas tenga mitigaciones asignadas;
4. los 92 escenarios estén catalogados;
5. las ocho puertas tengan evidencia exigida;
6. el plan de implementación divida el trabajo en incrementos verificables;
7. cualquier contradicción restante esté resuelta o registrada explícitamente.
