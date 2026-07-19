# Base científica interna de T12: bienestar contextual y reglas clínicas

> **Fecha de revisión:** 2026-07-19
> **Estado:** evidencia interna curada para T12
> **Población V1:** personas adultas de 18 años o más
> **Ámbito:** hidratación, sueño, suplementación, analítica actual e identidad
> farmacológica selectiva
> **Límite:** no es un verificador farmacológico exhaustivo, no diagnostica y
> no pauta, modifica ni suspende medicación o sustancias

## 1. Pregunta de decisión

Esta revisión determina qué valores poblacionales, restricciones y opciones
contextuales puede aplicar el motor determinista de T12. La literatura informa
el espacio permitido; nunca sustituye datos ausentes por supuestos ni convierte
una asociación, una ficha regulatoria o un valor aislado en un diagnóstico.

El orden de uso es:

1. reglas obligatorias que excluyen una salida insegura;
2. reglas condicionales que solo se activan con contexto suficiente;
3. preferencias que optimizan dentro del espacio restante;
4. plan provisional y conservador cuando la cobertura es parcial o no modelada.

## 2. Jerarquía y fuentes incluidas

| Área | Fuente principal | Tipo | Decisión permitida |
|---|---|---|---|
| Agua total | EFSA 2010[^efsa-water] | opinión científica de referencia poblacional | referencias de agua total de 2,0 L/día para mujeres, 2,5 L/día para hombres, 2,3 L/día en embarazo y 2,7 L/día en lactancia |
| Sueño | AASM/SRS 2015 y NSF 2015/2023[^aasm][^nsf-sleep] | consensos multidisciplinares | al menos 7 horas entre 18–60 años; 7–9 horas recomendadas entre 18–64 y 7–8 a partir de 65, con 9 horas todavía apropiadas en ciertos contextos |
| B12, magnesio y omega-3 | NIH ODS[^b12][^magnesium][^omega3] | fichas técnicas públicas con revisión de evidencia e interacciones | food-first, carencia/contexto, riesgos e interacciones; ninguna dosis automática por un único dato |
| Ácido fólico | CDC 2025[^folate] | recomendación de salud pública | 400 µg/día en contexto preconcepcional general, sin escalar automáticamente a dosis altas |
| Cafeína | EFSA 2015[^caffeine] | opinión científica de seguridad | límite contextual para adulto sano; nunca compensar sueño pobre ni usar polvo puro |
| Sodio e hipertensión | OMS 2012 y actualización pública 2026[^sodium-guideline][^sodium-current] | guía y ficha de salud pública | revisión del objetivo de sodio sin afirmar que el menú ya cumple el límite |
| Tratamientos GLP-1 | advisory conjunto 2025[^glp1] | advisory multidisciplinar basado en literatura | considerar tolerancia, ingesta, carencias, masa magra, sueño y actividad sin tocar el tratamiento |
| Identidad farmacológica | AEMPS/CIMA REST API v1.23[^cima] | catálogo regulatorio oficial | resolver identidad, principio activo, vía y estado; no inferir una interacción no curada |
| Semaglutida/tirzepatida | EMA EPAR[^ozempic][^mounjaro] | información regulatoria de producto | confirmar identidad y contexto regulatorio, sin pautar dosis, frecuencia o indicación |

Las opciones experimentales se apoyan únicamente en revisiones sistemáticas o
metaanálisis registrados en el manifiesto del motor. Se muestran aparte, con
confianza baja, riesgos y sin dosis automática.

## 3. Hidratación

### 3.1. Agua total y bebidas no son lo mismo

La referencia EFSA es **agua total**, procedente tanto de bebidas como de los
alimentos. T12 conserva esa referencia y calcula una banda operativa de bebidas
del 70–80 %, con centro inicial del 75 %. No presenta esta aproximación como una
medición individual exacta.[^efsa-water]

El motor aplica las siguientes reglas:

- mujeres: 2.000 ml de agua total;
- hombres: 2.500 ml;
- embarazo: 2.300 ml;
- lactancia: 2.700 ml;
- calor, sudoración alta o contexto anabólico pueden desplazar el centro hacia
  la parte alta de una banda que ya sea segura; nunca suman una cantidad fija;
- café, té y leche pueden contabilizarse como bebidas;
- el alcohol puede registrarse, pero queda excluido de toda propuesta;
- electrolitos solo entran como revisión contextual en calor con sudoración
  alta o en una sesión prolongada; no existe dosis diaria genérica;
- los recordatorios nacen desactivados y los anclajes siguen disponibles sin
  notificaciones del sistema operativo.

### 3.2. Restricciones que prevalecen

Una restricción de líquidos declarada, enfermedad renal o cardiaca relevante,
hiponatremia o mecanismo farmacológico que impida aplicar una regla general
anulan la banda operativa hasta disponer de un límite individual. T12 mantiene
la referencia poblacional como contexto, pero no fabrica una cifra de bebidas.

La declaración de GLP-1 o diuréticos no añade agua por sí sola. La declaración
de anabolizantes solo permite elegir la parte alta de una banda previamente
segura; no afirma corregir hematocrito ni viscosidad sanguínea.

## 4. Sueño y descanso

El consenso AASM/SRS recomienda al menos 7 horas con regularidad para personas
adultas de 18–60 años y no fijó un límite superior universal: dormir más de 9
horas puede ser apropiado en ciertos contextos y no se trata como patología por
sí solo.[^aasm] El panel de la National Sleep Foundation recomienda 7–9 horas
entre 18–64 años y 7–8 a partir de 65; su actualización mantiene que 9 horas
pueden ser apropiadas en algunas personas mayores.[^nsf-sleep]

T12 usa 7–9 horas como ventana operativa orientativa común, no como
diagnóstico. La base interna conserva la distinción de que, a partir de 65
años, la recomendación específica es 7–8 y 9 horas pueden ser apropiadas según
el contexto; la salida no convierte ninguno de esos límites poblacionales en
una conclusión clínica individual. Se mantienen como datos críticos:

- promedio de horas;
- calidad percibida;
- regularidad del horario.

Hora de acostarse/levantarse y fases REM, profunda y ligera son opcionales. En
V1 las fases solo pueden introducirse manualmente, se etiquetan como
estimaciones y no producen diagnóstico, predicción ni sincronización con un
wearable.

## 5. Suplementación

### 5.1. Orden y contrato de una recomendación

El orden es food-first, carencias/contexto y, después, rendimiento o bienestar.
Cada opción contiene propósito, beneficio esperado, evidencia, confianza,
forma, referencia de dosis cuando esté justificada, duración, riesgos,
interacciones, contraindicaciones, métrica y condición de salida.

Como máximo una opción nueva puede tener estado de prueba. Las demás quedan
para revisión posterior o se excluyen. No se recomiendan marcas, quemagrasas,
potenciadores de testosterona, SARMs, péptidos ni mezclas opacas.

### 5.2. Reglas selectivas

- **B12:** el veganismo o un valor actual bajo reconocido pueden abrir una
  opción food-first. Un valor aislado no diagnostica la causa ni fija dosis.[^b12]
- **Ácido fólico:** el contexto preconcepcional general permite 400 µg/día; T12
  nunca infiere automáticamente una pauta de 4–5 mg.[^folate]
- **Creatina:** solo puede proponerse en rendimiento/fuerza con cobertura
  clínica suficiente y sin incertidumbre renal o de líquidos.
- **Omega-3:** una ingesta baja de pescado o patrón vegetariano/vegano puede
  abrir revisión; no se formula una promesa cardiovascular universal y se
  revisan anticoagulantes.[^omega3]
- **Cafeína:** se limita al contexto de rendimiento de una persona adulta sana,
  con 200 mg por toma y 400 mg/día como techos de seguridad poblacional; el
  sueño pobre la excluye como estrategia.[^caffeine]
- **Magnesio:** dieta, valor actual reconocido o contexto PPI pueden abrir una
  revisión. La función renal y las interacciones con antibióticos o
  bisfosfonatos prevalecen.[^magnesium]
- **Melatonina:** solo queda como revisión contextual de baja confianza, sin
  dosis automática y con condición de salida.
- **Embarazo/lactancia:** las opciones contextuales pasan a revisión requerida,
  se eliminan experimentales y no se automatizan cafeína, creatina o
  electrolitos como suplementos.

## 6. Analítica actual

T12 reconoce únicamente B12, folato, magnesio, creatinina y eGFR cuando existen
valor, unidad y rango aportado por el usuario. La interpretación se limita a
`below_range`, `within_range` o `above_range` respecto de **ese rango**.

- Una unidad incompatible, un rango ambiguo o un dato incompleto no activa una
  regla numérica.
- No se utiliza un rango universal oculto.
- No se diagnostica una carencia o enfermedad desde un valor aislado.
- Fecha, histórico, tendencia, pérdida de vigencia y recálculo longitudinal
  pertenecen a T13; T12 no afirma haberlos implementado.

## 7. Contexto farmacológico y clínico

### 7.1. Identidad canónica

El cuestionario permite texto libre, pero también una búsqueda autenticada en
AEMPS/CIMA. Si el usuario selecciona una coincidencia, el motor confía en el
identificador CIMA y en la identidad canónica almacenada; ignora el nombre libre
para la clasificación farmacológica. Si la identidad no se resuelve, conserva
el contexto como no modelado y produce un plan provisional.

La caché privada conserva identificador, nombre canónico, principios activos,
vías, comercialización, condición de receta, versión de CIMA, fecha de captura
y SHA-256. Esos nombres no se incorporan a las salidas públicas del plan.

### 7.2. Cobertura selectiva

Los niveles internos son `modeled`, `partial` y `unmodeled`. T12 comienza por
las reglas que pueden modificar sus módulos: restricción de líquidos, contexto
renal/cardiaco, hiponatremia, hipertensión, GLP-1, diuréticos,
anticoagulantes, interacciones de magnesio, embarazo/lactancia/preconcepción,
menopausia, retatrutida y contexto anabólico.

Esta lista no convierte CIMA en un verificador exhaustivo de interacciones. El
motor solo utiliza dosis, frecuencia, vía u horario cuando una regla curada lo
requiere expresamente. Ninguna regla recomienda, modifica o suspende
medicación, testosterona, anabolizantes recreativos, SARMs o péptidos.

## 8. Versionado, revisión y actualización

- El manifiesto científico y las revisiones de reglas están compilados y
  versionados.
- La base de datos persiste un descriptor y su SHA-256, no expresiones
  ejecutables de reglas.
- Preparar, validar y activar una revisión futura son acciones separadas,
  idempotentes, AAL2 y auditadas; activar nunca es automático.
- El Edge de planes exige coincidencia exacta entre descriptor activo y
  constantes compiladas. Una divergencia falla cerrada.
- La revisión científica es manual. Debe repetirse al actualizar una guía,
  ficha regulatoria, versión CIMA, interacción curada o decisión del producto.

## 9. Referencias primarias y autoritativas

[^efsa-water]: EFSA NDA Panel. *Scientific Opinion on Dietary Reference Values
    for water*. EFSA Journal. 2010;8(3):1459.
    [DOI](https://doi.org/10.2903/j.efsa.2010.1459) y
    [resumen oficial](https://www.efsa.europa.eu/en/press/news/nda100326).

[^aasm]: Watson NF, Badr MS, Belenky G, et al. *Recommended Amount of Sleep
    for a Healthy Adult: A Joint Consensus Statement of the AASM and SRS*.
    2015. [Consenso](https://aasm.org/resources/pdf/adultsleepdurationconsensus.pdf)
    y [metodología](https://aasm.org/resources/pdf/adultsleepdurationmethods.pdf).

[^nsf-sleep]: Hirshkowitz M, Whiton K, Albert SM, et al. *National Sleep
    Foundation's updated sleep duration recommendations: final report*. Sleep
    Health. 2015;1(4):233–243. DOI `10.1016/j.sleh.2015.10.004`.
    [Artículo](https://www.sleephealthjournal.org/article/S2352-7218(15)00160-6/fulltext)
    y [actualización para personas mayores](https://www.sleephealthjournal.org/article/S2352-7218(23)00196-1/fulltext).

[^b12]: NIH Office of Dietary Supplements. *Vitamin B12 Fact Sheet for Health
    Professionals*. [Ficha oficial](https://ods.od.nih.gov/factsheets/VitaminB12-HealthProfessional/).

[^magnesium]: NIH Office of Dietary Supplements. *Magnesium Fact Sheet for
    Health Professionals*. Actualizada en 2026.
    [Ficha oficial](https://ods.od.nih.gov/factsheets/Magnesium-HealthProfessional/).

[^omega3]: NIH Office of Dietary Supplements. *Omega-3 Fatty Acids Fact Sheet
    for Health Professionals*.
    [Ficha oficial](https://ods.od.nih.gov/factsheets/Omega3FattyAcids-HealthProfessional/).

[^folate]: Centers for Disease Control and Prevention. *About Folic Acid*.
    2025. [Guía oficial](https://www.cdc.gov/folic-acid/about/index.html).

[^caffeine]: EFSA NDA Panel. *Scientific Opinion on the safety of caffeine*.
    2015;13(5):4102. [Resumen oficial](https://www.efsa.europa.eu/en/topics/topic/caffeine)
    y [DOI](https://doi.org/10.2903/j.efsa.2015.4102).

[^sodium-guideline]: World Health Organization. *Guideline: Sodium intake for
    adults and children*. 2012.
    [Publicación oficial](https://www.who.int/publications/i/item/9789241504836).

[^sodium-current]: World Health Organization. *Sodium reduction*. Actualizada
    el 11 de mayo de 2026.
    [Ficha oficial](https://www.who.int/news-room/fact-sheets/detail/sodium-reduction).

[^glp1]: Mozaffarian D, Agarwal M, Aggarwal M, et al. *Nutritional priorities
    to support GLP-1 therapy for obesity: a joint Advisory*. 2025. PMID
    40445127. [PubMed](https://pubmed.ncbi.nlm.nih.gov/40445127/).

[^cima]: Agencia Española de Medicamentos y Productos Sanitarios. *CIMA REST
    API v1.23*. [Documentación oficial](https://cima.aemps.es/cima/resources/docs/CIMA_REST_API.pdf).

[^ozempic]: European Medicines Agency. *Ozempic: EPAR*.
    [Información regulatoria](https://www.ema.europa.eu/en/medicines/human/EPAR/ozempic).

[^mounjaro]: European Medicines Agency. *Mounjaro: EPAR*.
    [Información regulatoria](https://www.ema.europa.eu/en/medicines/human/EPAR/mounjaro).
