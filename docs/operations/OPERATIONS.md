# Operación y ciclo de vida de V1

**Estado:** contrato operativo planificado; no hay backend desplegado todavía.  
**Objetivo:** que las operaciones de acceso, cambio, respaldo, borrado y
recuperación operativa sean repetibles y verificables sin convertir el
prototipo en una plataforma de soporte manual.

## 1. Principios operativos

- Producción y desarrollo son proyectos, claves, buckets y datos independientes.
- Las previews se protegen o solo usan datos sintéticos de desarrollo; nunca
  se conectan a producción por comodidad.
- El plan activo es inmutable; cualquier cambio estructural crea un candidato y requiere activación manual.
- Los estados `completo`/`provisional` son independientes de `borrador`/`activo`/`archivado`.
- El motor determinista calcula; el LLM solo explica después de validación.
- La omisión de un dato reduce precisión y confianza, pero no bloquea módulos no afectados.
- Las operaciones privilegiadas son visibles al superadministrador mediante indicador persistente y quedan en log técnico privado.
- No se imprimen ni incluyen compuestos farmacológicos/anabólicos en PDF; sí se conserva el contexto interno necesario para recalcular.

## 2. Alta por invitación

### 2.1 Flujo

1. El superadministrador crea una invitación con alcance de un único perfil y caducidad.
2. El usuario elige un alias visible y el sistema genera un código privado de alta entropía.
3. La invitación se entrega por un canal externo elegido por el administrador;
   V1 no envía mensajes automáticos. El secreto se introduce en el formulario
   y viaja solo en el body del POST: cualquier enlace distribuido contiene
   únicamente la ruta pública, nunca el token.
4. El dispositivo obtiene una identidad de Supabase Auth, el usuario confirma que es adulto (18+) y solicita el perfil remoto.
5. El backend consume de forma atómica el token de invitación, concede la primera membresía y registra el evento técnico.
6. La invitación usada queda inutilizable; una invitación anulada no se puede reactivar.

### 2.2 Reglas

- El alias sirve para identificar el perfil, nunca como secreto.
- El código privado no se guarda en claro ni aparece en logs, URLs, PDFs o backups legibles.
- El QR de vinculación contiene un nonce opaco, caducidad y audiencia; no contiene datos de salud ni el código permanente.
- El límite inicial de usuarios invitados es diez como capacidad operativa, no como límite lógico del modelo.
- Una persona no adulta no puede completar el alta. La V1 no ofrece flujo para menores.

## 3. Sesiones y dispositivos

### 3.1 Modelo

- Cada dispositivo tiene una sesión independiente, con identificador aleatorio, fecha de creación, último uso y estado revocado/activo.
- Un dispositivo puede acceder a varios perfiles mediante membresías
  independientes.
- El usuario puede ver los dispositivos vinculados al perfil y revocar
  cualquiera salvo su acceso actual; la revocación ordinaria no afecta a otros
  perfiles del mismo dispositivo y la renovación del código no cierra
  sesiones.
- “Proteger perfil” genera un código nuevo, revoca atómicamente el anterior,
  conserva sesiones activas por defecto y permite revocar otras sesiones. Solo
  existe un código activo por perfil.
- “Cerrar todo para este perfil” revoca todas sus demás membresías excepto la
  actual. El cierre global de una identidad es una operación separada.
- Una sesión caduca tras 30 días sin actividad confirmada o 180 días desde su
  creación, lo que ocurra antes. La caducidad no borra el perfil, pero exige
  volver a vincular ese dispositivo.

### 3.2 Controles mínimos a implementar

- JWT y refresh token gestionados por el cliente oficial de Supabase Auth;
  nunca se copian entre dispositivos ni se guardan en URL/log.
- Access token exacto de 15 minutos, rotación de refresh token activada e
  intervalo de reutilización de 10 segundos. Replay fuera de ese intervalo
  invalida el actor-dispositivo y exige volver a vincularlo.
- RLS comprueba membresía activa en cada acceso; la revocación no espera a que
  el JWT expire.
- Rate limit por IP, dispositivo y perfil en intentos de código/QR según
  [`SECURITY_CONTRACT.md`](../security/SECURITY_CONTRACT.md).
- Respuestas indistinguibles para alias inexistente, invitación inválida y código incorrecto.
- Confirmación explícita antes de revocar dispositivos o rotar el código.
- CSP y headers exactos del contrato de seguridad; Turnstile es la única
  excepción de script/frame de tercero.

### 3.3 Vencimiento y limpieza

- La PWA actualiza `last_seen_at` como máximo una vez al día mediante una
  llamada idempotente. RLS usa el menor entre `idle_expires_at` y
  `absolute_expires_at`, por lo que una sesión vencida se deniega aunque el job
  todavía no haya corrido.
- Una identidad Auth equivale a un dispositivo lógico, con una
  `DeviceSession` activa; las pestañas comparten esa identidad. Un job diario
  deshabilita actores con sesión vencida, revoca todas sus membresías y ejecuta
  `signOut` servidor para todos los refresh tokens del actor. La revocación de
  un perfil, en cambio, solo elimina su membresía. Estos límites propios no
  dependen de timeboxing nativo de un plan de pago de Supabase.
- Otro job elimina de Auth por lotes de 100 únicamente identidades
  `is_anonymous=true` sin membresía activa ni rol: a las 24 horas si nunca se
  vincularon, o a los 30 días desde la última membresía/actividad si quedaron
  huérfanas. Excluye invitaciones, links y operaciones pendientes, hace
  dry-run, es idempotente y nunca selecciona perfiles activos.
- El `Actor` técnico puede conservarse deshabilitado cuando lo referencian
  auditoría o historia; eliminar Auth no borra esos recibos.

## 4. Roles y modo superadministrador

### 4.1 Roles

| Rol | Puede consultar | Puede modificar | Restricciones |
|---|---|---|---|
| Usuario | su perfil, planes, seguimiento, exportaciones | su contexto mediante opciones y sus preferencias | no ve otros perfiles ni reglas internas |
| Superadministrador | todo el sistema, métricas, cuestionarios, logs y backups | usuarios, planes, reglas, catálogo, activación, borrado, restauración e impersonación | sesión separada y señalización persistente |

El acceso total del superadministrador es un requisito de producto; no se pretende ocultar sus actos al usuario común. Sí se exige un registro técnico privado para que el propio administrador pueda reconstruirlos.

### 4.2 Impersonación

1. El superadministrador se autentica con su cuenta administrativa independiente y MFA TOTP.
2. Solicita impersonar un perfil y realiza reautenticación para acciones de alto impacto.
3. La interfaz muestra de forma persistente “Modo superadministrador · perfil X”.
4. Cada lectura/escritura incluye actor administrativo, perfil objetivo, motivo opcional, timestamp y resultado en el log privado.
5. Salir del modo devuelve a la sesión administrativa; no se conserva una sesión de usuario accidental.

## 5. Versionado y activación

- Todo cambio de cuestionario, dato contextual, regla, fuente, catálogo o preferencia se guarda como evento/versionado.
- El detector calcula el impacto: solo módulo afectado, dependencias y timeline cuando corresponda.
- Cambios estructurales generan candidato con diff, módulos, incertidumbres, nivel de acción y validaciones.
- La activación es manual siempre para cambios estructurales, reglas, fuentes, restricciones clínicas y publicaciones de catálogo.
- Los planes históricos se congelan con contexto, fuentes, reglas, configuración de modelo y fecha; no se reescriben al actualizar una fuente.
- Recalcular un candidato inválido no puede reemplazar ni desactivar el plan activo.

## 6. Backups, restauración y borrado

### 6.1 Política confirmada

- Backup lógico cifrado semanal.
- Backup previo a cambio crítico (migración, reglas, fuente, publicación, borrado masivo o cambio de autenticación).
- Cuatro versiones rotativas.
- Cada versión incluye dump Postgres y copia/manifiesto de objetos privados de
  Storage; no se asume que el backup de base contenga los archivos.
- Conservación indefinida de datos operativos hasta que el superadministrador ejecute un borrado permanente.
- El backup no es una vía para recuperar silenciosamente perfiles borrados.
- RPO máximo normal de siete días y RTO de 24 horas para la prueba privada.
- Cada dump usa clave de datos aleatoria y cifrado autenticado. La clave se
  envuelve con una KEK versionada que solo controla el superadministrador desde
  su gestor de secretos/contraseñas, con recuperación offline cifrada.
- La KEK rota anualmente o ante sospecha; las versiones antiguas se conservan
  hasta que expire la última copia dependiente.
- La clave HMAC de tombstones es independiente y se conserva mientras exista
  un marcador de esa versión; rotarla exige reemitir/verificar todos los
  marcadores antes de retirar la anterior.
- El manifiesto registra algoritmo, versión de clave, hash por archivo/tabla y
  objeto de Storage, además de la firma del trabajo; nunca la clave en claro.

### 6.2 Borrado permanente

1. El usuario puede solicitar el borrado; el superadministrador inicia su
   ejecución con AAL2 y confirmación reforzada.
2. El perfil pasa a `deletion_requested`. RLS bloquea lectura, generación,
   edición y exportación ordinarias; solo queda un endpoint de estado mínimo.
3. El administrador crea o reanuda un `DeletionJob`. Antes de purgar, añade el
   marcador al ledger de continuidad independiente y verifica su hash.
4. Se revocan membresías, invitaciones, tokens y enlaces del perfil.
5. Se eliminan membresías, perfil, respuestas, planes, seguimiento,
   exportaciones, objetos de Storage, cachés controladas y artefactos de IA.
   Una identidad Auth se elimina únicamente si ya no conserva otra membresía
   ni rol administrativo.
6. Se registra únicamente un marcador técnico irreversible mínimo: UUID
   aleatorio o HMAC con clave no incluida en la copia, fecha y trabajo de
   borrado; no contiene alias ni contenido recuperable.
7. El alias queda reutilizable solo después de completar el proceso.
8. El trabajo parcial nunca devuelve el perfil a `active`: queda bloqueado y
   reanudable hasta finalizar.
9. El marcador se aplica a cualquier restauración futura para impedir que el perfil vuelva a servirse.
10. Antes de eliminar `Profile`, el job conserva `profile_marker`,
    `request_handle_hash` y, si procede, el actor solicitante. La FK
    `profile_id` queda nula al purgar y el `DeletionJob.status=purged` persiste
    para consulta técnica. El solicitante puede consultar el handle mientras
    su identidad exista; después solo el superadministrador accede al job.

### 6.3 Restauración

- La restauración se ejecuta primero en un entorno aislado y de solo lectura.
- Antes de importar o hacerla visible se descargan los streams externos
  `deletions` y `admin-audit`. La copia local, de no más de siete días, debe
  coincidir como prefijo de ambas cadenas; después se aplican los marcadores,
  se reconstruye el espejo de auditoría y se resuelven intents pendientes.
- Un Worker privado y un Durable Object serializan los streams. `deletions`
  vive en R2 con Bucket Lock indefinido; `admin-audit` está cifrado, no expira
  automáticamente y el Worker ordinario no expone borrado. Ambos están fuera
  de Supabase y de las cuatro copias y se exportan cifrados cada semana.
- Después se aplican migraciones y comprobaciones de integridad.
- Cualquier recibo de borrado de rango `admin-audit` se aplica antes de
  reconstruir el espejo: el payload cubierto se ignora aunque reaparezca en una
  copia. Un `audit_range_delete_intent` sin recibo `complete` bloquea
  promoción; un hueco solo se acepta si límites, hashes y manifiesto coinciden.
- Se verifica que RLS, roles, sesiones y expiraciones siguen activos.
- Se comparan recuentos, hashes de tablas y perfiles eliminados; la restauración falla cerrada ante discrepancias críticas.
- Se documenta quién, cuándo, qué versión y qué resultado.
- Debe existir una prueba programada antes de abrir invitaciones y después de cualquier cambio de esquema.
- La promoción requiere verificación completa; ante una discrepancia crítica
  falla cerrada.

## 7. Operación de catálogo y fuentes

- La ingestión externa deposita datos en cuarentena; no publica directamente.
- El superadministrador revisa discrepancias, identidad, formato, precio base y cobertura.
- Una corrección de código de barras confirmada se reutiliza de inmediato solo
  en el perfil propietario. La aprobación crea una nueva revisión global,
  inmutable y referenciada; solo entonces otros perfiles la reciben.
- Precio y disponibilidad pueden caducar sin alterar la verdad nutricional canónica.
- El origen de Sevilla se mantiene como metadato interno y no se muestra al usuario como explicación del precio nacional.
- El scraper local (`supermercados/mercadona_chrome.mjs`) no debe ejecutarse con credenciales de producción ni conectarse a la base de perfiles.

## 8. Presupuesto y disponibilidad

- Límite operativo de IA: 10 €/mes.
- Alertas internas al 50 %, 75 % y 90 %; al superar el presupuesto se usa explicación determinista y se bloquean llamadas no esenciales.
- Las llamadas LLM tienen cota máxima previa, cuota por perfil y timeout.
  `cap_eur` queda fijado por constraint a 10,00. Una transacción bloquea el mes
  y reserva con idempotency key la cota contractual calculada desde límites de
  entrada/salida y una `PricingFxRevision` aprobada, únicamente si
  `liquidado + cotas_reservadas + nueva_cota <= 10`. Timeout o fallo incierto
  deja la reserva pendiente hasta reconciliar; un sobrecoste del proveedor
  bloquea llamadas posteriores.
- Generación, exportación, compra y Luna aplican los valores por IP, actor y
  perfil de [`SECURITY_CONTRACT.md`](../security/SECURITY_CONTRACT.md),
  devuelven `429`/`Retry-After` y priorizan leer el plan activo.
- Un fallo parcial deja el plan activo intacto y muestra “No se pudo generar la explicación; los cálculos siguen siendo válidos”.
- Luna queda apagada mientras no existan `AIProviderRevision` y
  `PricingFxRevision` aprobadas/vigentes con región, retención, prohibición de
  entrenamiento, precio/FX, endpoint, timeout de 8 segundos, cero reintentos
  automáticos y política de minimización.
- El secreto del proveedor vive solo en secretos de Edge Functions. Se guardan
  `prompt_version` y `prompt_hash`, nunca el prompt o payload clínico completo.

## 9. Observabilidad y respuesta a incidentes

### Eventos mínimos del log técnico privado

- alta/uso/anulación de invitación;
- creación, renovación y revocación de sesiones;
- acceso administrativo, impersonación y salida;
- lectura/escritura de datos sensibles desde superadmin;
- activación, archivado, borrado y restauración;
- publicación de fuente, regla, catálogo o corrección compartida;
- denegaciones de autorización, rate limits, fallos de validación y agotamiento de presupuesto.

Pages/Worker, Edge Functions, Postgres, jobs y proveedor de errores comparten
una allowlist previa al logging. Solo admiten `request_id`, plantilla de ruta,
método, status, latencia, entorno, IDs opacos, acción y código técnico. No
capturan body, query ni headers completos y eliminan `Authorization`, cookies,
Turnstile, QR/código, invitación, handle de exportación, medicación, valores clínicos,
prompts y payloads antes de cualquier sink.

El stream externo `admin-audit` persiste un `intent` antes de cada mutación
privilegiada y un `outcome` mediante outbox. El espejo Postgres vive en esquema
privado; `UPDATE` y `DELETE` fallan por trigger. Si el intent no persiste, la
acción no comienza. Si la transacción revierte antes de crear outbox,
`catch/finally` intenta cerrar el intent como `failure`; un reconciliador
periódico enumera pendientes externos y los resuelve desde journal/estado de
mutación. Un restore no se promueve con secuencias ausentes o intents sin
reconciliar.

El borrado permanente de auditoría opera solo sobre rangos contiguos:
manifiesto ordenado y hashes, recibo `intent` en `deletions`, credencial R2
offline JIT de alcance mínimo, borrado/verificación y recibo `complete`.
AES-256-GCM autentica cada objeto y Ed25519 firma los recibos con claves
versionadas. Un trabajo parcial es reanudable y bloquea restore y nuevos
borrados de auditoría.

### Respuesta

1. Contener: revocar sesiones/tokens afectados y desactivar llamadas o invitaciones.
2. Preservar: congelar log y hashes de artefactos sin copiar contenido de salud innecesario.
3. Evaluar: diferenciar exposición, modificación, indisponibilidad y error clínico.
4. Recuperar: restaurar solo tras aplicar marcadores de borrado y validar invariantes.
5. Aprender: registrar causa, test de regresión y cambio de procedimiento.

## 10. Checklist antes de producción

- [ ] Proyecto Supabase de producción separado y claves de servicio ausentes del frontend.
- [ ] RLS y pruebas de aislamiento por perfil, rol e impersonación.
- [ ] Flujo alias/código/QR con consumo atómico, expiración, rate limit y auditoría.
- [ ] Rotación de refresh, TTL 30/180 días y limpieza de Auth anónimo huérfano ensayados.
- [ ] MFA/AAL2 para superadministrador, CSP, CORS, exportaciones privadas y redacción de logs.
- [ ] Copia cifrada semanal, precrítica y cuatro rotaciones; restauración ensayada.
- [ ] KEK versionada, recuperación offline y rotación probadas.
- [ ] Borrado y auditoría con ledger externo, copia local y restore sin truncamiento probados.
- [ ] Rate limits, límites de payload, reservas Luna en EUR y fallback determinista verificados.
- [ ] Lockfile, SCA, SBOM y procedencia/firma del release verificadas.
- [ ] 92 escenarios y ocho puertas de salida superados en un entorno aislado.
