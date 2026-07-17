# Brief de diseño V1

## Dirección

Personalidad: **rigurosa, serena y accesible**. La interfaz explica lo justo,
no moraliza y no convierte la incertidumbre en alarma. El lenguaje debe ser
español claro, consistente y accionable.

### Antirreferencias visuales

- Portal sanitario frío, burocrático y dominado por tablas.
- Aplicación de gimnasio agresiva, oscura o competitiva.
- Wellness genérico de pasteles, degradados y promesas vagas.

La dirección visual final (paleta, tipografía, componentes y motion) se cerrará
en el prototipo; este brief fija los límites, no una implementación concreta.

## Principios de experiencia

1. **Una decisión por pantalla:** mostrar solo campos que puedan cambiar el
   plan; usar chips, selectores y búsqueda antes que texto libre.
2. **Progreso visible:** etapa actual, etapas restantes y tiempo estimado de
   finalización; guardado automático silencioso y confirmable.
3. **Contexto antes que consejo:** el usuario puede revisar qué sabe el sistema
   y qué está estimado antes de generar.
4. **Acción proporcional:** información, ajuste, revisión prioritaria o salida
   conservadora según el módulo; nunca sumar alertas para dramatizar.
5. **No ocultar la incertidumbre:** cada dato y cada plan indica conocido,
   estimado, ausente, provisional o confianza limitada.
6. **Control del usuario:** editar mediante opciones, comparar candidatos y
   activar manualmente; no mutar el plan activo sin confirmación.

## Estructura de pantallas

### 1. Acceso

Entrada por invitación, alta de alias, código privado y vinculación QR. El
secreto se presenta una vez; la ayuda explica cómo guardarlo sin mostrar datos
de salud en enlaces o códigos. Si el dispositivo tiene varias membresías, un
selector compacto muestra únicamente sus perfiles autorizados.

### 2. Asistente

- Cabecera con progreso y «Guardado hace…».
- Panel central con la pregunta actual.
- Ayuda contextual breve y término técnico desplegable.
- Pie con «Atrás», «Continuar» y «Guardar y salir».
- Indicador de campos obligatorios y de campos que mejoran precisión.

### 3. Resumen

Tarjetas por módulo con estado, datos faltantes y botón de edición. La acción
principal es «Generar plan»; las incertidumbres críticas se agrupan sin bloquear
las ramas no afectadas.

### 4. Plan activo

Encabezado con fecha, versión, estado completo/provisional y confianza. Navegación
por día/semana/módulo. Una barra de alertas prioriza el cambio más relevante y
permite desplegar el razonamiento breve.

### 5. Candidato de cambio

Comparación antes/después: dato cambiado, módulos recalculados, objetivo,
incertidumbres y resultado de validación. Botones «Activar» y «Descartar».

### 6. Compra y exportación

Tabla o tarjetas con orden seleccionado, cobertura, precio orientativo, formato,
paquetes y sobrante. La impresión conserva encabezados, orden, etiquetas y
estado del plan.

## Estados y alertas

| Estado | Presentación | Acción |
|---|---|---|
| Conocido | Etiqueta discreta «Confirmado» | Ninguna |
| Estimado | «Estimación» + explicación corta | Mejorar dato opcional |
| Falta contexto | «Pendiente» | Responder o continuar provisional |
| Provisional | Banda visible en cabecera | Revisar incertidumbres |
| Confianza limitada | Icono + texto accesible | Ver qué la reduce |
| Ajuste | Aviso informativo | Revisar candidato |
| Revisión prioritaria | Color/ícono contrastado, no alarmista | Abrir módulo afectado |
| Conservador | Mensaje claro de límite y alternativa | Continuar con opción segura |

Las alertas nunca se basan en porcentajes de beneficio ficticios. No se usan
rojos saturados como decoración ni se mezclan mensajes de módulos distintos.

## Accesibilidad y responsive

- Objetivo base: WCAG 2.2 AA; AAA selectivo queda diferido.
- Teclado completo, foco visible, orden lógico, etiquetas asociadas y mensajes
  de error junto al campo.
- Contraste AA, texto redimensionable al 200 %, áreas táctiles cómodas y sin
  depender solo de color, icono o animación.
- Animación de ejercicios con controles de pausa/repetición, texto alternativo
  y explicación estática equivalente.
- Diseño mobile-first; el mismo flujo funciona en móvil, tableta y escritorio.
- En anchuras pequeñas se apilan tarjetas; en escritorio se usa una columna de
  contexto y otra de resultado sin esconder el resumen.
- Respeta `prefers-reduced-motion`; no exige gestos complejos.

## Impresión y PDF

- CSS de impresión sin navegación, botones ni fondos innecesarios.
- Encabezado: alias, fecha, versión y estado completo/provisional.
- Tabla con cantidades, unidades, kcal, macros, fibra y sustituciones según el
  modo elegido.
- Mismo orden que la pantalla y la lista de compra.
- Se omiten compuestos sensibles; se conservan advertencias y restricciones
  necesarias para ejecutar el plan.

## Contenido y microcopy

- Preferir «Qué sabemos», «Qué falta», «Qué cambia» y «Revisar».
- Explicar tecnicismos en una frase ejecutable, por ejemplo: «RIR 2 = termina
  la serie dejando aproximadamente dos repeticiones posibles».
- No usar culpa, promesas de curación, lenguaje de apariencia corporal ni
  instrucciones para modificar medicación o sustancias recreativas.

## Criterios de salida visual

Antes de implementar, un prototipo debe demostrar: completar el cuestionario sin
texto largo, distinguir plan provisional de completo, localizar una alerta y su
módulo, cambiar un alimento y activar el candidato, imprimir el mismo orden y
usar el recorrido con teclado y lector de pantalla. La revisión visual no puede
cerrar la fase si alguna de esas tareas depende de color, hover o conocimiento
previo.
