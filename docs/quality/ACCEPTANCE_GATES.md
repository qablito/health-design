# Puertas de salida de V1

Estas puertas forman el contrato de lanzamiento. Son ocho comprobaciones independientes, pero todas deben pasar para abrir invitaciones. `PASS WITH DEFERRED` solo permite continuar cuando la decisión diferida está fuera de V1, tiene dueño, fecha y no debilita un control obligatorio.

| ID | Puerta | Pregunta de salida | Evidencia mínima | Bloqueadores |
|---|---|---|---|---|
| G1 | Cuestionario y contexto | ¿Se obtiene el contexto aplicable con carga medida y se conserva lo que falta? | E2E de wizard, autosave, edición, resumen y escenarios G1 | pérdida de respuestas, campo clínico sin incertidumbre, módulo incorrecto |
| G2 | Cálculo determinista | ¿Energía, macros, fibra, sustituciones y tiempos son reproducibles y trazables? | tests de propiedades, hashes, fuentes/revisiones y diff de candidato | número inventado, kcal/macros incoherentes, sustituto sin función |
| G3 | Seguridad clínica | ¿Las restricciones obligatorias y niveles de acción dominan las preferencias? | matriz de reglas, pruebas de conflicto, provisionalidad y fallback | relajación de restricción, advertencia omitida, recomendación activa de sustancia prohibida |
| G4 | Coherencia entre módulos | ¿Nutrición, entrenamiento, hidratación, sueño, movilidad y suplementos encajan con el mismo contexto? | perfiles completos, validación cruzada y pruebas de impacto | entrenamiento cuando se eligió ausencia, hidratación incompatible con restricción, timeline roto |
| G5 | Versionado y activación | ¿Un cambio crea candidato y el plan activo sigue estable hasta activación manual? | pruebas de estados, concurrencia, rollback y auditoría | mutación silenciosa, candidato inválido activable, histórico reescrito |
| G6 | Datos, catálogo y exportación | ¿Fuentes, SKU, compras, precios y PDF/Excel conservan significado y privacidad? | fixtures de fuentes, matching, cobertura, exportaciones y sanitización | precio presentado como nutrición, compuesto sensible en PDF, fórmula ejecutable |
| G7 | Resiliencia, seguridad y restauración | ¿Sesiones, RLS, backups, borrado, restore, cuotas y entornos aislados resisten abuso? | pruebas de seguridad, restore de cuatro rotaciones, ledger externo, SBOM/procedencia y alertas | IDOR, replay QR, perfil borrado reaparece, artefacto no verificable, claves en frontend, sin rate limit |
| G8 | UX y accesibilidad | ¿Una persona puede completar, revisar, entender y exportar el plan con accesibilidad AA? | recorrido teclado/lector, contraste, responsive, PDF/impresión y mensajes | foco perdido, alertas solo por color, progreso ilegible, contenido no accionable |

La evidencia específica de T15 para los fragmentos de G6–G8 se conserva en
[`TASK_15_VERIFICATION.md`](TASK_15_VERIFICATION.md). Ese recibo no convierte por
sí solo ninguna puerta completa en `PASS`: G6 mantiene T16–T17 y G8 mantiene la
auditoría AA final de T19.

## Criterio de evaluación por puerta

### G1 — Cuestionario y contexto

- Debe existir selector de módulos: alimentación, entrenamiento, hidratación, sueño/descanso, movilidad/estiramiento y suplementación.
- El entrenamiento admite generado, propio o ausencia; al elegir ausencia no se genera rutina encubierta.
- Objetivo principal obligatorio y hasta dos secundarios entre composición corporal, rendimiento y bienestar.
- Las preguntas clínicas/farmacológicas son breves y adaptativas; si falta una respuesta crítica se entrega plan provisional conservador.
- El resumen final permite editar sin perder las respuestas anteriores y muestra fecha/estado de guardado.
- Se exige al menos un módulo.
- En piloto, la mediana de los perfiles completos es ≤20 minutos; no existe
  texto largo obligatorio y todo abandono conserva el último bloque confirmado.

### G2 — Cálculo determinista

- La banda energética y su objetivo central son visibles; el objetivo temporal es un rango con fecha central orientativa.
- Proteína preferentemente con alimentos; polvo solo si el usuario lo elige.
- Grasa central 30 % dentro de 20–35 % y carbohidrato como restante, sujeto a restricciones.
- Fibra mínima 25 g y objetivo central 14 g/1000 kcal subordinados a tolerancia y contexto clínico.
- Cada alimento tiene cantidad cruda/referencia, kcal, macros, fibra y nutrientes relevantes; dos sustituciones preservan función y recalculan.
- Precisión, redondeo, hash y discrepancias cumplen
  [`NUMERIC_CONTRACT.md`](../data/NUMERIC_CONTRACT.md); el mismo fixture y
  versiones producen exactamente el mismo hash normativo.

### G3 — Seguridad clínica

- Las reglas se clasifican obligatorias, condicionales o preferentes; el optimizador no sale del espacio seguro.
- Identidades farmacológicas se contrastan con catálogo canónico; dosis/frecuencia/vía/horario solo se usan cuando la regla documentada lo exige.
- Medicación para pérdida de peso, terapia hormonal y contexto anabólico alteran los módulos pertinentes sin pautar ni modificar sustancias.
- Los niveles de acción son información, ajuste, revisión prioritaria o alternativa conservadora; gana el nivel más estricto.
- Suplementos experimentales se separan, muestran confianza/riesgos y no sustituyen la opción estándar.
- Cada regla activa pertenece a una `RuleSetRevision`, tiene evidencia,
  aprobación y casos positivo/negativo; cobertura parcial o no modelada nunca
  se presenta como exhaustiva.

### G4 — Coherencia entre módulos

- Hidratación considera agua de alimentos y bebidas, actividad, clima, sudor, fármacos y restricciones de líquidos.
- Café, té y leche cuentan como bebidas; alcohol se registra pero nunca se propone.
- Sueño distingue medidas de dispositivo y tendencias de predicción clínica; el seguimiento diario es opcional.
- Movilidad tiene núcleo de cinco minutos y extensiones opcionales; entrenamiento detallado incluye técnica comprensible y alternativas.
- Suplementación cubre carencias y rendimiento contextual, con una novedad cada vez y condiciones de parada.

### G5 — Versionado y activación

- Estados independientes: borrador/activo/archivado y completo/provisional.
- Solo se recalculan módulos afectados y dependencias; un cambio estructural crea candidato revisable.
- La activación es manual y presenta diff, incertidumbres, fuentes, reglas y
  resultado de las validaciones normativas.
- La activación es idempotente y transaccional: dos activaciones concurrentes
  producen una sola versión activa. El candidato enlaza versión base y
  candidata y muestra validaciones normativas, no el resultado de las puertas
  de lanzamiento.
- El plan activo conserva el contexto y fuentes usados para generarlo, incluso si el catálogo cambia.

### G6 — Datos, catálogo y exportación

- Jerarquía de evidencia documentada; no se promedian fuentes federadas.
- Cada importación conserva SHA-256 bruto/normalizado, versión canónica y
  rechaza límites excedidos sin publicación parcial. Esto también rige
  catálogos comerciales, que enlazan manifest/licencia/evidencia de captura.
- Una corrección de código de barras es privada y reutilizable por su perfil
  hasta que una nueva revisión global sea aprobada; nunca se filtra una
  propuesta entre perfiles.
- Un SKU comercial nunca sustituye la verdad nutricional canónica; solo determina formato, coste y sobrante.
- Comparativa de supermercados respeta el habitual del usuario; alternativas de ahorro son avisos, no cambios silenciosos.
- Precio base, sin ofertas/cupones/transporte; “cesta más barata” solo cuando todos los ingredientes están cubiertos.
- PDF compacto y completo, ingredientes/cantidades o preparación breve, lista/plan/preparación semanal, impresión y Excel/Sheets tienen la misma versión y orden.
- PDF/XLSX se generan en servidor dentro de un bucket privado; impresión es una
  vista nativa A4. La descarga autenticada no redirige ni entrega una URL de
  Storage y aplica idempotencia, límites y cabeceras privadas.
- Compuestos sensibles quedan fuera de PDF y de archivos de usuario.
- Una cadena usa exactamente la cesta 60+20: cobertura ≥90 %, cada grupo
  esencial ≥75 %, precio/formato válido y activación manual. Cero falsos
  positivos en alimentos con alergia dentro de la cesta crítica.

### G7 — Resiliencia, seguridad y restauración

- No hay acceso cruzado entre perfiles; RLS y autorización se prueban en servidor, no solo en UI.
- Alias no es secreto; QR es payload opaco no URL, de un uso y corta duración;
  un solo código queda activo tras rotación, las membresías son independientes
  y una revocación no corta otros perfiles.
- `Actor.auth_subject` y membresía activa son únicos; refresh rotation/replay,
  actor-dispositivo único, TTL 30/180 y cleanup anónimo se prueban sin tocar
  perfiles activos. Revocación de perfil y cierre global tienen alcances
  distintos y RLS bloquea JWT residual.
- Superadmin tiene sesión separada, indicador persistente y log técnico privado
  `intent/outcome` serializado en ledger externo sin bifurcación; rollback sin
  outbox se reconcilia en operación normal, y AEAD/Ed25519/replay/rotación se
  verifican.
- Backup cifrado semanal, precrítico y cuatro rotaciones; restore aislado carga
  los streams externos de borrados/auditoría antes de importar o servir datos,
  no revive perfiles ni trunca eventos posteriores. Un rango de auditoría
  borrado conserva manifiesto y recibos en `deletions`; un hueco no cubierto o
  job parcial bloquea.
- Dev/prod aislados; no hay claves de servicio en el bundle; CSP/headers,
  redacción previa a logs, caches, límites de payload y rate limits numéricos
  están activos.
- El presupuesto Luna usa reserva EUR transaccional/idempotente y fallback; una
  carrera usa la cota máxima, `cap_eur=10`, timeout mantiene reserva y anomalía
  de coste bloquea llamadas. La aplicación no autoriza por encima del tope; el
  hard billing cap del proveedor se activa si existe y cualquier
  incumplimiento externo se trata como incidente residual.
- El release conserva lockfile, SCA, SBOM, hash/firma y procedencia verificable;
  un hallazgo crítico/alto de cadena de suministro bloquea.
- Se cumplen los valores de
  [`SECURITY_CONTRACT.md`](../security/SECURITY_CONTRACT.md): código ≥128 bits,
  QR 5 min/un uso, límites de acceso/operaciones/payload, AAL2 de admin, RPO
  ≤7 días y RTO ≤24 h.

### G8 — UX y accesibilidad

- Estilo riguroso, sereno y accesible; sin moralizar, alarmismo ni jerga sin explicación.
- “Conocido”, “estimado” e “incierto” se distinguen en texto y no solo en color.
- Los errores dicen qué corregir y no borran el resto del cuestionario.
- El usuario puede leer la semana, el día, el módulo, la compra y las alternativas en móvil y escritorio.
- WCAG 2.2 AA es el mínimo; AAA selectivo queda como evolución, no como bloqueo de V1.
- Matriz mínima: Chrome y Edge actuales/anterior en escritorio, Safari
  macOS/iOS y Chrome Android; 320–1440 px; VoiceOver+Safari y NVDA+Chrome.
- Contraste 4,5:1 para texto normal, 3:1 para texto grande y componentes;
  objetivos táctiles de al menos 24×24 CSS px, zoom 200 %, movimiento reducido
  y prueba A4 de todas las exportaciones.

## Regla final

V1 solo puede pasar a producción cuando G1–G8 tengan evidencia archivada, cero bloqueadores críticos/altos abiertos en identidad, autorización, motor clínico, borrado/restauración o exportación, y los 92 escenarios estén trazados a una ejecución. La existencia de un plan provisional no es un fallo: es una salida válida cuando la incertidumbre está etiquetada y el módulo se mantiene dentro de las reglas conservadoras.

La severidad se calibra con `THREAT_MODEL.md`: un riesgo `critical` o `high`
abierto en esas áreas bloquea. `PASS WITH DEFERRED` solo se admite para trabajo
fuera de V1 y no puede usarse para aceptar un control obligatorio ausente.
