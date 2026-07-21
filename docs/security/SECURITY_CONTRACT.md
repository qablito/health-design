# Contrato de seguridad de V1

**Estado:** requisitos técnicos obligatorios; todavía no implementados.  
**Fecha:** 2026-07-16  
**Amenazas relacionadas:** [`THREAT_MODEL.md`](THREAT_MODEL.md)

Este documento convierte la intención de seguridad en valores y comportamientos verificables. Los valores son la configuración inicial de V1 y solo pueden cambiar mediante una decisión documentada y nuevas pruebas.

## 1. Arquitectura de sesión elegida

V1 es una SPA/PWA, no una aplicación renderizada íntegramente en servidor. Por tanto:

1. cada navegador o instalación crea una identidad independiente mediante Supabase Auth;
2. el cliente oficial conserva el access token JWT y el refresh token de esa identidad;
3. las llamadas usan `Authorization: Bearer <JWT>` sobre HTTPS;
4. el acceso al perfil no procede del JWT por sí solo, sino de una membresía activa `ProfileAccess`;
5. RLS comprueba en cada lectura y escritura que `auth.uid()` tiene una membresía no revocada;
6. revocar un dispositivo de un perfil invalida inmediatamente esa membresía;
   no elimina otras membresías del mismo actor;
7. un JWT todavía no expirado no puede leer datos después de revocar la membresía.

La rotación de refresh tokens queda activada explícitamente y el intervalo de
reutilización permitido es de 10 segundos para tolerar carreras legítimas sin
aceptar replay prolongado. Una identidad Auth equivale a un dispositivo lógico
y tiene como máximo una `DeviceSession` activa; varias pestañas del mismo
navegador comparten esa identidad. La expiración efectiva se calcula como el
menor entre `idle_expires_at` y `absolute_expires_at`: 30 días desde la última
actividad confirmada o 180 días desde la creación. La PWA toca la sesión como
máximo una vez al día mediante una
operación servidora; RLS exige que actor, membresía, perfil y sesión sigan
vigentes.

Revocar acceso a un perfil solo revoca `ProfileAccess`. Cerrar globalmente el
dispositivo o vencer su `DeviceSession` deshabilita el actor, revoca todas sus
membresías y ejecuta el cierre servidor de Supabase, que invalida todos los
refresh tokens de esa identidad. No se promete revocar individualmente un
refresh token servidor. Un JWT ya emitido queda igualmente inutilizable porque
RLS consulta `Actor` y `DeviceSession`. Estos límites propios son la fuente de
verdad y no dependen de que el plan contratado de Supabase ofrezca timeboxing
nativo; esa capacidad, si existe, solo se usa como defensa adicional.

No se promete una cookie `HttpOnly`: Supabase documenta esa opción para aplicaciones web tradicionales renderizadas en servidor. Como consecuencia, V1 trata XSS y dependencias del frontend como riesgos críticos.

## 2. Alta y vinculación de dispositivos

### Alta inicial

1. El cliente obtiene una identidad anónima de Supabase Auth protegida con Turnstile.
2. Canjea una invitación válida desde esa identidad.
3. La función servidora consume la invitación de forma atómica, crea el perfil y concede la primera membresía.
4. Una identidad anónima sin invitación o membresía no puede acceder a ninguna fila de perfil.

El secreto de invitación se introduce y envía únicamente en el body de
`POST /v1/invitations/redeem`. No aparece en enlaces, path, query, fragmento,
historial, `Referer` ni logs. Un enlace de invitación, si se distribuye por
comodidad, solo abre la ruta pública sin secreto y muestra el formulario.

### Segundo dispositivo

1. El dispositivo nuevo obtiene su propia identidad anónima.
2. Presenta el código privado o un QR de vinculación.
3. La función servidora valida el secreto y concede una membresía al `auth.uid()` del nuevo dispositivo.
4. Nunca se copia el refresh token de otro dispositivo.

El QR codifica un payload opaco no URL con forma versionada, por ejemplo
`healthdesign-link-v1.<nonce>`. El escáner propio lo mantiene en memoria el
tiempo imprescindible y lo envía solo en el cuerpo JSON de un `POST`. No se
abre como enlace, no entra en historial, `Referer`, clipboard, analítica ni
telemetría.

### Restablecimiento

- Con una sesión activa, el usuario puede rotar su código privado.
- Solo existe un `PrivateAccessCode` activo por perfil. Rotar crea una nueva
  revisión y revoca atómicamente la anterior antes de devolver el nuevo valor;
  las sesiones y membresías existentes no cambian salvo elección explícita.
- Sin sesión activa y sin código, no existe recuperación autoservicio en V1.
- El superadministrador puede ejecutar un restablecimiento excepcional que genera un código nuevo y puede revocar las membresías anteriores.
- El QR solo vincula dispositivos; no es una “recuperación de cuenta”.
- La sesión Auth se revoca globalmente solo al cerrar ese dispositivo en todos
  los perfiles o cuando la identidad deja de tener membresías y no es
  administrativa.

## 3. Valores criptográficos y temporales

| Control | Valor V1 |
|---|---|
| Código privado | mínimo 128 bits generados por CSPRNG; representación legible con checksum o agrupación |
| Almacenamiento del código | HMAC-SHA-256 con pepper exclusivo del entorno o KDF resistente equivalente; nunca texto claro |
| Comparación | tiempo constante |
| QR de vinculación | nonce CSPRNG de 128 bits como mínimo |
| TTL de QR | 5 minutos |
| Consumo de QR | exactamente una vez, mediante transacción atómica |
| Invitación | nonce CSPRNG de 128 bits como mínimo |
| TTL predeterminado de invitación | 7 días, configurable a menos por el superadministrador |
| JWT de acceso | 15 minutos exactos en V1 |
| Rotación de refresh token | activada; intervalo de reutilización 10 segundos |
| Sesión de dispositivo | 30 días de inactividad y máximo absoluto de 180 días |
| Membresía revocada | denegación inmediata mediante RLS, sin esperar a expirar el JWT |
| Descarga de exportación | proxy autenticado por Edge; ningún bearer o capability de Storage en URL |

El código privado, payload QR, JWT, invitación, identificadores personales y
datos de salud no aparecen en URL, query string, fragmento, nombre de archivo,
historial, `Referer`, analítica, log, PDF ni mensaje de error. V1 no entrega al
navegador URLs firmadas de Storage: la descarga pasa por una Edge Function
autenticada que valida autorización y transmite un único objeto privado con
`Referrer-Policy: no-referrer` y `Cache-Control: no-store, private`.

## 4. Límites de abuso

### Código y QR

- Máximo 5 fallos por 15 minutos para la combinación más restrictiva de IP, identidad de dispositivo y perfil candidato.
- Tras el límite: enfriamiento exponencial y respuesta genérica `429`.
- Máximo 30 intentos de vinculación por hora por IP como límite global inicial.
- Éxito y fallo usan el mismo esquema de respuesta pública y no confirman si existe el alias.
- Turnstile es obligatorio para crear identidades anónimas, canjear invitaciones y comenzar una vinculación tras comportamiento anómalo.

### Operaciones costosas

| Operación | Concurrencia | Ventana por perfil | Ventana por actor | Ventana por IP |
|---|---:|---:|---:|---:|
| Generar/recalcular plan | 1 | 6/h | 12/h | 30/h |
| Generar exportación | 1; reutiliza mismo artefacto/version/config | 20/h | 30/h | 60/h |
| Resolver compra/comparación | 1 | 30/h | 60/h | 100/h |
| Resolver GTIN comercial | deduplicación por GTIN | 60/h | 120/h | control Edge |
| Confirmar etiqueta comercial | idempotente por clave | 30/h | 60/h | control Edge |
| Explicación Luna | 1 | 6/h y cuota diaria | 12/h | 30/h |

- Los contadores se aplican por la clave más restrictiva y no se promedian.
- Toda mutación costosa exige `Idempotency-Key`; repetirla devuelve el mismo
  trabajo o artefacto y no consume otra cuota.
- Saturación devuelve `429`, `Retry-After` y `request_id` sin datos sensibles;
  una operación ya en curso devuelve su handle en vez de comenzar otra.
- Luna añade cuota por perfil, ledger mensual servidor y corte duro de 10 EUR.
  `AIBudgetMonth.cap_eur` tiene constraint exacto de 10,00 en V1. Una
  transacción bloquea el mes, calcula con `PricingFxRevision` vigente la cota
  máxima contractual de la petición y solo llama si
  `settled_eur + reserved_upper_bound_eur + new_upper_bound_eur <= 10`.
  La cota usa máximos de tokens/bytes y precio aprobado, no una media. Timeout
  o conexión incierta dejan la reserva en `pending_reconciliation`; solo una
  evidencia autoritativa permite liquidarla o liberarla. Si el proveedor cobra
  por encima de la cota, se registra `provider_cost_anomaly`, se contabiliza el
  coste real y se bloquean nuevas llamadas.

El corte es absoluto para la autorización bajo la tarifa aprobada: la
aplicación nunca autoriza una petición cuya cota rebase 10 EUR. No puede
impedir que un proveedor incumpla su propio contrato; antes de activarlo se
habilita además un hard billing cap o prepago del proveedor cuando exista. Un
incumplimiento externo queda como incidente y riesgo residual, no se
reclasifica como gasto autorizado.

## 5. Matriz de autorización

| Recurso/acción | Usuario con membresía | Superadministrador en navegador | Función servidora privilegiada |
|---|---:|---:|---:|
| Leer/editar su contexto permitido | sí, con RLS | no directamente | sí, tras autorizar actor y objetivo |
| Leer otro perfil | no | no directamente | sí |
| Crear o revocar `ProfileAccess` | no | no | sí |
| Escribir rol o claim administrativo | no | no | solo proceso operativo controlado |
| Publicar reglas, fuentes o catálogo | no | no | sí, con AAL2 y auditoría |
| Resolver/confirmar ficha comercial del perfil | sí, solo su perfil | no directamente | sí, tras autorizar actor, sesión y membresía |
| Corregir/aprobar/rechazar ficha o activar matching | no | no directamente | sí, AAL2, TOTP reciente, idempotencia y auditoría |
| Borrado permanente/restore | no | no | sí, con AAL2 y confirmación reforzada |
| Consultar log técnico | no | no directamente | sí, solo superadministrador |

### Política RLS base

- Todo objeto de usuario se relaciona directa o indirectamente con `profile_id`.
- `ProfileAccess.actor_id` referencia `Actor.id`; `Actor.auth_subject` es el
  único campo que se compara con `auth.uid()`.
- `Actor.auth_subject` es UUID `NOT NULL UNIQUE`.
  `private.ensure_actor()` solo es ejecutable por `authenticated`, revoca
  `EXECUTE` a `anon/public`, exige `auth.uid() IS NOT NULL`, deriva el sujeto
  exclusivamente de ese valor, hace upsert idempotente, falla si el actor está
  deshabilitado y nunca acepta rol o sujeto desde el cliente.
- Existe un índice único parcial de membresía activa sobre
  `(profile_id, actor_id) WHERE revoked_at IS NULL`.
- Las policies llaman a una función estable
  `private.has_active_profile_access(target_profile_id)` que comprueba en una
  sola unión: actor no deshabilitado, `Actor.auth_subject = auth.uid()`,
  membresía no revocada, sesión de dispositivo no expirada y
  `Profile.status = active`.
- La función fija `search_path`, no acepta un actor proporcionado por el
  cliente, tiene dueño controlado y solo expone un booleano.
- `Profile.status = deletion_requested` deja de satisfacer la policy. Solo una
  función de estado mínimo, ligada al actor solicitante y a un handle opaco,
  puede informar de que el borrado sigue pendiente.
- El cliente no puede insertar, actualizar ni eliminar `ProfileAccess`, roles, invitaciones, tombstones, reglas publicadas o auditoría.
- Las tablas internas viven fuera del esquema expuesto o no tienen grants para `authenticated`.
- El `service_role` solo existe en Edge Functions/operación; nunca en Cloudflare Pages ni en el bundle.
- Una función `SECURITY DEFINER` fija `search_path`, valida actor/rol y tiene grants de ejecución explícitos.

## 6. Superadministrador

- Usa una cuenta permanente separada de cualquier perfil.
- MFA TOTP es obligatorio; las acciones privilegiadas exigen `aal2`.
- Iniciar una impersonación, publicar, borrar o restaurar exige un desafío TOTP
  realizado durante los cinco minutos anteriores. Consultar el panel requiere
  AAL2 sin esa frescura adicional y salir de una impersonación nunca queda
  bloqueado por la ventana temporal.
- Cada petición conserva `original_actor_id`, `effective_profile_id`, `impersonation_session_id` y `request_id`.
- La interfaz muestra un indicador persistente durante la impersonación.
- Ningún usuario puede autoasignarse rol, claim o membresía administrativa.

## 7. Frontend y API

- Producción envía por header una CSP base:
  `default-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors
  'none'; form-action 'self'; script-src 'self'
  https://challenges.cloudflare.com; frame-src
  https://challenges.cloudflare.com; connect-src 'self'
  https://<SUPABASE_HOST> wss://<SUPABASE_HOST>
  https://challenges.cloudflare.com; img-src 'self' data: blob:
  https://<SUPABASE_HOST>; style-src 'self'; font-src 'self'; manifest-src
  'self'; worker-src 'self' blob:; upgrade-insecure-requests`.
  `<SUPABASE_HOST>` es el host exacto de cada entorno, no un comodín.
- No se permite `unsafe-eval`; Turnstile es el único script/frame de tercero
  admitido y se valida también en servidor con Siteverify.
- Headers mínimos: `Referrer-Policy: no-referrer`,
  `X-Content-Type-Options: nosniff`,
  `Strict-Transport-Security: max-age=31536000; includeSubDomains` en
  producción y
  `Permissions-Policy: camera=(self), microphone=(), geolocation=(),
  payment=()`.
- Trusted Types se activa cuando el soporte objetivo lo permita.
- CORS usa una allowlist exacta de orígenes de producción y preview autorizados.
- Operaciones sensibles validan `Origin`; no aceptan comodín.
- Todos los payloads se validan con esquema, tamaño, profundidad y enumeraciones cerradas.
- El texto se escapa por contexto; ninguna cadena importada se interpreta como HTML.
- Los errores públicos son uniformes y los detalles quedan en logs redactados.

### Límites de entrada

El proxy rechaza antes de parsear con `413` o `422` y registra solo código,
ruta, tamaño y `request_id`.

| Superficie | Límite V1 |
|---|---|
| JSON general | 256 KiB, profundidad 12, 2.000 claves, array máximo 500 |
| Alias/búsqueda/texto libre breve | 64/120/500 grafemas respectivamente |
| Comando de generación o cambio | 64 KiB; referencia snapshots por ID, no los duplica |
| Borrador de cuestionario | 256 KiB, máximo 500 respuestas |
| Seguimiento/laboratorio | 64 KiB y 50 observaciones por petición |
| Snapshot comercial | 64 KiB, nombre/marca 200 grafemas, 64 nutrientes clínicos y 100 elementos por lista estructurada |
| Confirmación de etiqueta | body 80 KiB; GTIN, base, unidades y decimales con esquema cerrado |
| Mutación administrativa comercial | body 128 KiB; snapshot completo, `expectedVersion` e `idempotency-key` obligatorios |
| Explicación Luna interna | request 64 KiB, response 32 KiB, profundidad JSON 8 |
| Configuración de exportación | 16 KiB; artefacto generado máximo 25 MiB |
| Importación administrativa | 25 MiB por archivo, 100.000 filas, 200 columnas, 2 KiB por celda y 100 MiB descomprimidos; lotes mayores se fragmentan |

No se aceptan archivos anidados, rutas de archivo, fetch de URL arbitraria ni
bombas de compresión. Los parsers trabajan en streaming cuando aplique y
detienen el trabajo al superar cualquier límite.

### Caché del cliente y HTTP

- Perfil, cuestionario, plan, seguimiento, administración y metadatos de
  exportación responden `Cache-Control: no-store, private`.
- V1 no persiste respuestas de salud en `localStorage`, `IndexedDB`, Cache API
  ni URLs. Un cambio sin confirmar vive solo en memoria hasta el autosave.
- El service worker cachea únicamente assets públicos, inmutables y
  versionados; no intercepta API, endpoints de descarga ni documentos
  generados.
- Logout, revocación y borrado limpian estado en memoria y caches controladas.

## 8. Storage y exportaciones

- Buckets de exportación y evidencia son privados.
- La descarga verifica JWT, actor, `DeviceSession`, membresía, versión y
  artefacto antes de abrir el objeto privado.
- La Edge Function proxyfica el contenido con credencial servidora de mínimo
  alcance; no devuelve redirección ni URL firmada, y el navegador nunca recibe
  un bearer de Storage.
- Respuesta con `Cache-Control: no-store, private` y
  `Referrer-Policy: no-referrer`.
- Nombres y metadatos no contienen alias, condición, medicación ni objetivo.
- XLSX neutraliza celdas que comienzan por `=`, `+`, `-`, `@`, tabulador o retorno.
- PDF/impresión/XLSX de plan no incluyen nombres de compuestos sensibles.
- La revocación o eliminación del perfil elimina objetos y bloquea nuevas URLs.

## 9. Logs

Todo logging de Pages/Worker, Edge Functions, Postgres, proveedor de errores y
jobs pasa primero por una allowlist común. El middleware no captura cuerpos,
query strings ni headers completos. Los únicos campos de petición permitidos
son:

- `request_id`, ruta como plantilla, método, status, latencia y entorno;
- actor original/efectivo como ID opaco cuando la acción es privilegiada;
- acción, tipo de objeto e identificador opaco;
- código de error allowlisted, versión o hash técnico cuando proceda.

Se descartan antes de cualquier sink `Authorization`, cookies, refresh/access
tokens, token Turnstile, payload/código QR, GTIN, código privado, invitación,
handle de exportación, body, query, snapshots de etiqueta, respuestas, valores
clínicos, nombres de medicación, prompts y contenido de planes. El proxy y los proveedores externos tienen
desactivada la captura automática de body/header. Las excepciones se
serializan desde códigos y metadatos seguros, nunca con el objeto de petición
crudo.

`TechnicalAuditEvent` vive en esquema privado, sin grants directos de
`INSERT`, `UPDATE` o `DELETE` para el cliente ni para la ruta normal de
servicio. Es un espejo verificable del stream externo `admin-audit` de
[`ADR-0007`](../adr/0007-independent-continuity-ledger.md). El coordinador
externo serializa cada append, asigna secuencia total, encadena SHA-256 sobre
codificación canónica versionada y devuelve un recibo firmado.

Antes de mutar, la operación privilegiada persiste y verifica un evento
`intent`; si falla, no comienza. La transacción de negocio inserta el espejo
local y `AuditOutbox`; después se añade un `outcome` idempotente. El outbox usa
schema cerrado de máximo 4 KiB con `outcome_status`, `error_code` allowlisted,
IDs opacos, hashes SHA-256 y timestamps; vive en esquema privado y no admite
texto, body, headers, salud, medicación, URL, token, QR/código ni prompt. Un
`intent` sin `outcome` queda visible, bloquea promoción de restore y requiere
reconciliación. Un trigger rechaza `UPDATE`/`DELETE` local. La retención es
indefinida hasta que el superadministrador ejecute el runbook destructivo
separado con AAL2, doble confirmación y recibo mínimo irreversible; nunca se
editan eventos individuales.

Si la transacción de negocio revierte antes de insertar `AuditOutbox`, el
orquestador ejecuta en `catch/finally` un append externo idempotente
`outcome=failure` con `error_code` allowlisted. Si tampoco puede completarlo,
un reconciliador periódico enumera intents externos sin outcome, consulta el
journal de idempotencia y el estado de la mutación, y emite
`reconciliation`/`outcome` sin texto libre. El Worker alerta a los cinco
minutos y reintenta; restore es una segunda barrera, no el mecanismo normal de
cierre.

## 10. Backup, borrado y continuidad

- Un job diario idempotente vence `DeviceSession` por inactividad/edad máxima,
  deshabilita el actor-dispositivo, revoca todas sus membresías y ejecuta
  `signOut` servidor para todos los refresh tokens de esa identidad. La RLS ya
  deniega desde `expires_at`, sin esperar al job.
- Otro job elimina de Supabase Auth solo usuarios `is_anonymous=true`:
  - abandonados hace más de 24 horas sin membresía, rol, invitación en curso ni
    operación pendiente;
  - o sin membresía activa ni rol durante 30 días.
  Trabaja por lotes de 100, hace dry-run previo, es idempotente, audita totales
  sin IDs sensibles y nunca selecciona un actor con perfil activo. El `Actor`
  técnico referenciado por auditoría puede quedar deshabilitado aunque se
  elimine su identidad Auth.
- Cada rotación es un conjunto: dump lógico Postgres, export/manifiesto de
  objetos privados de Storage y manifiesto raíz. Las copias de base de datos de
  Supabase no incluyen por sí solas el contenido de Storage.
- El conjunto se cifra con AES-256-GCM o cifrado autenticado equivalente y una
  clave de datos aleatoria por copia.
- La clave de datos se envuelve con una KEK versionada guardada en el gestor de
  secretos/contraseñas del superadministrador y con copia de recuperación
  cifrada offline. Solo el superadministrador puede descifrar.
- La KEK rota al menos anualmente y de inmediato ante sospecha. Las versiones
  antiguas se conservan offline hasta que expire la última copia que dependa de
  ellas.
- El marcador de borrado usa una clave HMAC distinta de la KEK. El registro
  guarda `marker_key_version`; cada versión se conserva mientras exista un
  tombstone que dependa de ella. Una rotación solo retira la clave anterior
  después de añadir y verificar marcadores equivalentes bajo la nueva.
- Manifiesto con hash por archivo, tabla y objeto de Storage.
- RPO normal: máximo 7 días; antes de un cambio crítico se crea una copia inmediatamente.
- RTO de la prueba privada: 24 horas.
- Cuatro rotaciones; una nueva elimina la más antigua.
- El ledger independiente contiene `deletions` con Bucket Lock indefinido y
  `admin-audit` cifrado sin expiración automática. Ambos están fuera del
  proyecto Supabase y de las cuatro copias y tienen copia local cifrada
  semanal. La decisión completa está en
  [`ADR-0007`](../adr/0007-independent-continuity-ledger.md).
- Toda acción privilegiada persiste `intent` en `admin-audit` antes de mutar y
  finaliza `outcome` por outbox. Una copia antigua no puede truncar ese stream.
- Cada objeto de `admin-audit` usa AES-256-GCM, nonce aleatorio único de 96
  bits y DEK aleatoria de 256 bits. La DEK se envuelve con una KEK versionada;
  el AAD contiene entorno, stream, secuencia, versión de schema, hash anterior
  y timestamp. El checksum de R2 no sustituye al tag AEAD.
- Los recibos se firman con Ed25519 e incluyen entorno, stream, secuencia,
  `record_hash`, timestamp, hash de idempotencia y versión de clave. Edge,
  restore y verificador offline fijan las claves públicas versionadas,
  conservan las antiguas para verificar historia y rechazan firma, replay o
  versión desconocida.
- El borrado excepcional de `admin-audit` prepara un manifiesto ordenado,
  registra en `deletions` un recibo de intención con límites y hashes, elimina
  el rango con credencial offline JIT de alcance mínimo, verifica ausencia y
  registra un recibo de finalización. Un hueco solo es válido si coincide
  exactamente con ese par; un intento incompleto bloquea restore y se reanuda.
- El `DeletionJob` no marca la purga como completa hasta confirmar ese append.
- Sus estados son `queued`, `ledger_recorded`, `purging`, `purged` y `failed`.
  Un fallo se reanuda idempotentemente y nunca reactiva el perfil.
- Un restore carga ambos streams externos, verifica cadenas, secuencias,
  recibos e intents pendientes. La copia local, con antigüedad máxima de siete
  días, debe ser un prefijo exacto. Después aplica tombstones, reconstruye o
  completa `TechnicalAuditEvent` y resuelve intents pendientes en aislamiento;
  solo entonces puede promoverse.
- Borrado permanente elimina membresías, datos, Storage, exportaciones, cachés
  controladas y artefactos de IA asociados. Una identidad Auth se elimina solo
  si no conserva otra membresía ni rol administrativo.

## 11. Evidencia obligatoria

Antes de la primera invitación deben existir:

- pruebas de RLS cruzadas para cada tabla expuesta;
- tests de autoescalada y funciones privilegiadas;
- replay y carrera de QR;
- rotación del código que invalida el anterior sin cerrar sesiones;
- upsert concurrente de `Actor`, unicidad de `auth_subject` y membresía activa;
- rotación/replay de refresh token, vencimiento idle/absoluto y limpieza segura
  de identidades anónimas huérfanas;
- ausencia del payload QR en URL, historial, `Referer`, analítica y logs;
- canarios de código, QR, Turnstile, `Authorization`, medicación y body ausentes
  en todos los sinks de observabilidad;
- CSP/headers de producción compatibles con Turnstile sin comodines amplios;
- ausencia de respuestas de salud en almacenamiento persistente del cliente,
  Cache API, service worker, historial y caches HTTP;
- rate limits y respuestas no enumerables;
- saturación e idempotencia de generación, exportación, compra y Luna;
- rechazo de payloads justo por encima de cada límite de bytes/profundidad;
- AAL2 obligatorio para superadministrador;
- AAL2 más TOTP de menos de cinco minutos para corregir, aprobar, rechazar o
  activar matching comercial; AAL1 es rechazado y cada mutación deja
  `intent/outcome` con hashes, no snapshots;
- dos perfiles demuestran que la corrección privada no se resuelve de forma
  cruzada y que una revisión solo se comparte después de aprobación global;
- cámara revocada/desmontada sin subida de fotogramas, entrada manual operativa
  y ausencia de GTIN/snapshot en logs, cachés, historial y Storage;
- revocación inmediata aun con JWT vigente;
- exportaciones privadas proxyficadas, sin bearer en URL, `no-referrer`,
  `no-store` y neutralización de fórmulas;
- restore de las cuatro rotaciones sin revivir un perfil borrado;
- ledger externo de borrado y auditoría verificado antes de cada restore, sin
  truncar eventos y con reconciliación normal de `intent` pendiente;
- cifrado/tag/AAD alterados, recibo Ed25519 inválido, replay o clave desconocida
  rechazados; rotación mantiene verificable la historia;
- borrado parcial y completo de un rango `admin-audit`: restore suprime el
  payload cubierto, bloquea si falta recibo final y acepta el hueco solo tras
  verificar límites, hashes y manifiesto;
- rollback de Postgres después de `intent` pero antes de outbox termina en
  `failure` o `reconciliation` sin depender de restore;
- carrera de reservas Luna que demuestra que gasto liquidado más cotas
  reservadas no supera 10 EUR, un timeout conserva la reserva y una
  subestimación/anomalía bloquea llamadas posteriores;
- SCA, SBOM, procedencia y firma/hash del artefacto desplegado;
- escaneo de secretos del bundle y del historial Git.

## 12. Referencias oficiales de implementación

- [Supabase: anonymous sign-ins](https://supabase.com/docs/guides/auth/auth-anonymous)
  y [sesiones](https://supabase.com/docs/guides/auth/sessions).
- [Cloudflare Turnstile: CSP](https://developers.cloudflare.com/turnstile/reference/content-security-policy/).
- [Cloudflare Durable Objects](https://developers.cloudflare.com/durable-objects/)
  para serializar los streams del ledger.
- [Cloudflare R2: seguridad de datos](https://developers.cloudflare.com/r2/reference/data-security/)
  y [Bucket Locks](https://developers.cloudflare.com/r2/buckets/bucket-locks/)
  para el ledger de continuidad.

Las URLs concretas se mantienen en [`ARCHITECTURE.md`](../architecture/ARCHITECTURE.md) para evitar duplicar una lista que pueda quedar obsoleta.
