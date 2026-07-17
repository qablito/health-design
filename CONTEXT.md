# Lenguaje ubicuo

Este documento fija el significado de los términos usados por producto, diseño, desarrollo, datos y pruebas. Si una interfaz necesita una palabra distinta para ser comprensible, debe conservar el mismo significado.

## Producto y personas

### Aplicación

La aplicación web descrita por este repositorio. En V1 es privada, accesible por invitación y dirigida únicamente a personas adultas.

### Usuario

Persona adulta invitada que consulta o modifica uno o varios perfiles. No implica paciente, cliente clínico ni deportista.

### Perfil

Contenedor remoto de contexto personal, cuestionarios, planes, seguimientos y preferencias. Se identifica ante el usuario por un **alias**, pero internamente usa un identificador opaco.

### Alias

Nombre visible y modificable de un perfil. En V1 queda reservado y es único
entre perfiles `active` o `deletion_requested` solo para búsqueda y usabilidad;
se libera cuando el `DeletionJob` alcanza `purged` y elimina la fila del
perfil. `purged` no es un estado persistente de `Profile`. No es una
credencial, su unicidad no es un control de seguridad y nunca concede acceso
por sí solo.

### Código privado

Secreto de alta entropía usado para vincular un dispositivo nuevo a un perfil.
Con una sesión activa puede rotarse: la nueva revisión revoca atómicamente la
anterior y queda un solo código activo, sin cerrar sesiones salvo elección
explícita. Nunca se almacena en claro ni se muestra al superadministrador.

### Invitación

Autorización de un solo uso que permite crear un perfil inicial. No equivale a una sesión permanente.

### Dispositivo vinculado

Identidad de sesión independiente con una o varias membresías de perfil. Un
navegador y un móvil se consideran dispositivos distintos aunque pertenezcan a
la misma persona; revocar una membresía no elimina las demás. En V1 caduca tras
30 días sin actividad confirmada o 180 días desde su creación.

### Vinculación

Concesión de acceso a un dispositivo nuevo mediante código privado o QR. El QR
no recupera una cuenta: contiene un payload opaco no URL y crea una membresía
nueva para una identidad de dispositivo ya autenticada.

### Restablecimiento administrativo

Acción excepcional del superadministrador cuando no queda ninguna sesión activa y el usuario ha perdido el código privado. Genera un código nuevo y puede revocar accesos anteriores; no es recuperación autoservicio.

### Superadministrador

Rol operativo con acceso completo a perfiles, respuestas, planes, sesiones,
métricas y acciones administrativas. Puede restablecer acceso e impersonar a
un usuario. Toda acción privilegiada persiste un `intent` y un `outcome` en el
ledger técnico privado independiente.

### Impersonación

Sesión administrativa temporal que muestra y opera la aplicación como un perfil. Debe mantener un indicador persistente e inequívoco; no crea una notificación visible para el usuario en V1.

### Solicitud de borrado

Estado que bloquea el acceso ordinario al perfil mientras el
superadministrador ejecuta una purga idempotente. Solo queda visible un estado
mínimo del trabajo.

### Servicio de ledger independiente

Contenedor y coordinador hash-encadenado externo a Supabase y a sus copias.
Mantiene dos streams separados, con claves y esquemas distintos, y debe
verificarse antes de promover una restauración:

- `deletions`: marcadores irreversibles de perfiles borrados y recibos mínimos
  de rangos de auditoría eliminados;
- `admin-audit`: registro técnico cifrado de acciones privilegiadas.

### Stream `deletions`

Cadena externa con Bucket Lock que conserva solo tombstones mínimos. Impide
restaurar perfiles borrados y documenta, sin payload recuperable, cualquier
rango de `admin-audit` eliminado permanentemente.

### Stream `admin-audit`

Cadena externa cifrada de `intent`, `outcome` y `reconciliation` para acciones
privilegiadas. Su borrado no es una edición ordinaria: solo puede eliminarse
por rangos mediante el protocolo destructivo documentado y un recibo en
`deletions`.

## Planificación

### Módulo

Área que puede activarse o desactivarse independientemente:

1. alimentación;
2. entrenamiento;
3. hidratación;
4. sueño y descanso;
5. movilidad y estiramiento;
6. suplementación.

### Plan

Resultado integrado y versionado de los módulos seleccionados. “Rutina” solo se usa para una secuencia concreta, por ejemplo una sesión de entrenamiento o una rutina de sueño.

### Plan activo

Versión integrada que el usuario ha aceptado y consulta como referencia
actual. Solo puede existir una por perfil.

### Borrador

Versión calculada que todavía no ha sido activada. Es inmutable: cambiar sus
entradas genera otra versión borrador, no una edición interna.

### Candidato

Nueva versión calculada a partir de un cambio relevante. Incluye diferencias, módulos afectados e incertidumbres. No sustituye al plan activo hasta una activación manual.

### Plan archivado

Versión que ya no está activa pero se conserva como historial inmutable.

### Completo

Eje de calidad que indica que el motor dispone de todos los datos obligatorios y todas las reglas requeridas para el alcance solicitado.

### Provisional

Eje de calidad que indica que faltan datos o cobertura de reglas. El sistema entrega una alternativa conservadora, identifica la incertidumbre y reduce la confianza. “Provisional” no es sinónimo de borrador: un plan provisional puede estar activo.

### Cambio menor

Ajuste que no altera la estructura ni las restricciones esenciales del plan, por ejemplo mover una franja horaria dentro de los límites válidos.

### Cambio estructural

Cambio de energía, distribución diaria, alimento base, ejercicio principal, volumen, intensidad, restricción clínica, objetivo o dependencia entre módulos. Siempre crea candidato y exige activación manual.

## Decisión y seguridad

### Restricción obligatoria

Condición que delimita el espacio seguro y no puede relajarse para optimizar una preferencia.

### Restricción condicional

Condición que se activa cuando el contexto o una regla documentada cumple sus precondiciones.

### Preferencia

Deseo del usuario que se optimiza únicamente dentro del espacio resultante de las restricciones obligatorias y condicionales.

### Conflicto

Situación en la que dos datos, objetivos o restricciones explícitas no pueden satisfacerse simultáneamente. El sistema formula una pregunta crítica breve o produce un plan provisional si no hay respuesta.

### Incertidumbre

Dato ausente, antiguo, contradictorio, estimado o cubierto de forma parcial. Debe conservar causa, alcance, confianza e impacto.

### Confianza

Valor cualitativo o categórico sobre la solidez del dato o de la regla. No se expresa como un porcentaje ficticio de beneficio frente a riesgo.

### Matriz beneficio-gravedad-confianza

Método interno para decidir la fuerza de una recomendación y el nivel de acción. La gravedad potencial puede imponer una alternativa conservadora aunque el beneficio esperado sea alto.

### Nivel de acción

Resultado más estricto aplicable a un módulo:

1. información;
2. ajuste;
3. revisión prioritaria;
4. alternativa conservadora inmediata.

Los niveles no se suman ni se promedian.

### Regla determinista

Regla versionada, auditable y reproducible que transforma entradas validadas en restricciones, cálculos o decisiones. Es la única fuente autorizada para números y decisiones de seguridad.

### Cobertura farmacológica

Estado interno de una sustancia o interacción:

- **modelada**: existe una regla documentada aplicable;
- **parcial**: solo algunas implicaciones están modeladas;
- **no modelada**: no existe regla suficiente y se conserva un plan provisional.

## Alimentación y datos nutricionales

### Alimento canónico

Concepto nutricional estable, independiente de marcas y supermercados, que especifica identidad, estado, parte comestible y unidad de referencia.

### Producto comercial

Artículo envasado identificado por etiqueta o código de barras. Puede aportar datos nutricionales confirmados, pero no redefine el alimento canónico sin una revisión aprobada.

### SKU

Presentación comercial concreta vendida por una cadena. Determina formato, precio, disponibilidad, número de envases y sobrante; no modifica la pauta nutricional.

### Función nutricional

Papel que un alimento cumple dentro de una comida: fuente proteica, carbohidrato principal, grasa, fruta, verdura, lácteo o equivalente, entre otros.

### Sustituto

Alternativa de un alimento individual que conserva su función nutricional y recalcula cantidad, energía, macronutrientes, fibra y nutrientes clínicamente relevantes.

### Revisión efectiva

Versión exacta de un dato nutricional aplicada a un plan. Un plan utiliza una sola revisión efectiva por alimento y la conserva aunque la base se actualice después.

### Dato ausente

Nutriente que la fuente no proporciona o no permite inferir con fiabilidad. Se conserva como ausente; nunca se transforma silenciosamente en cero.

### Corrección compartida

Modificación propuesta tras confirmar una etiqueta o un escaneo. Solo beneficia a otros usuarios después de revisión y activación por el superadministrador.

## Compra

### Cesta

Agregación semanal de los alimentos del plan activo, descontando únicamente existencias que el usuario haya confirmado.

### Equivalencia comercial

Relación revisada entre un alimento canónico y un SKU que puede cubrirlo sin cambiar la dieta.

### Catálogo comercial completo

Conjunto íntegro de productos extraídos o importados para una cadena, con procedencia y fecha.

### Núcleo canónico

Conjunto de alimentos canónicos para los que existen reglas explícitas de compatibilidad comercial.

### Cesta de prueba V1

Conjunto de 80 alimentos usado para medir cobertura: 60 fijos por grupos y 20 dinámicos por frecuencia. No es un límite del catálogo.

### Precio base

Precio ordinario registrado, sin ofertas, cupones, fidelización, transporte, bolsas ni pedido mínimo.

### Precio normalizado

Precio calculado por una unidad comparable a partir del precio base y el contenido confirmado del envase.

### Cesta completa

Comparación en la que todos los alimentos requeridos tienen una equivalencia comercial válida y un precio utilizable.

### Cesta parcial

Comparación con productos pendientes. Debe mostrar subtotal, pendientes y cobertura; nunca puede presentarse como la cesta más barata completa.

## Seguimiento, datos e IA

### Seguimiento semanal

Revisión mínima de dos a tres minutos con variables aplicables a los módulos activos.

### Revisión completa

Reevaluación recomendada cada cuatro semanas o antes si existe un cambio material.

### Valor contextual

Dato manual como peso, presión, analítica o métrica de sueño, acompañado cuando corresponda de unidad, fecha y rango.

### Tendencia básica

Descripción retrospectiva simple de los valores registrados. No incluye predicción clínica.

### Asistente de lenguaje

Modelo de IA que solo transforma una salida ya validada en explicaciones, resúmenes o instrucciones sencillas mediante un contrato JSON. No calcula ni decide.

### Fallback determinista

Texto predefinido usado si el asistente de lenguaje falla, excede el presupuesto o entrega una respuesta inválida.

## Términos que deben evitarse

- “Cuenta por alias”: el alias no autentica.
- “Diagnóstico”, “tratamiento” o “prescripción”: no son funciones de V1.
- “Plan seguro al 100 %”: no existe esa garantía.
- “Precio actual de España”: la base es orientativa y puede tener antigüedad.
- “El suplemento corrige”: usar “puede contribuir” y reflejar evidencia, riesgos y seguimiento.
- “La IA ha decidido”: toda decisión pertenece al motor determinista.
- “Calorías exactas”, “fecha exacta de objetivo” o equivalentes cuando el dato sea una estimación.
