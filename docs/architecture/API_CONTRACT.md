# Contrato lógico de API de V1

**Estado:** diseño de operaciones; no es un OpenAPI generado  
**Versión:** 1.0  
**Fuente:** [`PRODUCT.md`](../../PRODUCT.md) y [`DOMAIN_DATA_MODEL.md`](DOMAIN_DATA_MODEL.md)

La interfaz pública puede implementarse como REST/JSON sobre Edge Functions.
Los nombres son estables a nivel de intención; el esquema OpenAPI se generará
cuando comience la implementación. Todas las fechas son ISO-8601 con zona y
las cantidades incluyen unidad explícita.

## 1. Convenciones comunes

### Autenticación y alcance

- `Authorization: Bearer <session>` para toda operación autenticada.
- El token es el JWT de la identidad Supabase Auth propia del dispositivo.
- El token identifica actor y sesión, nunca el alias por sí solo.
- El servidor comprueba `profile_id` y RLS en cada lectura/escritura.
- Las operaciones de superadministrador requieren rol explícito y escriben
  `TechnicalAuditEvent`; las acciones sensibles requieren `aal2`.
- El flujo completo y los límites se definen en
  [`SECURITY_CONTRACT.md`](../security/SECURITY_CONTRACT.md).

### Idempotencia y concurrencia

- Toda mutación acepta `Idempotency-Key` obligatorio. El servidor guarda clave,
  actor, operación, hash de entrada, resultado y caducidad técnica.
- El alcance es `actor + endpoint + key` y la escritura del resultado ocurre
  en la misma transacción que la mutación.
- Retención inicial: 24 horas para mutaciones ordinarias; borrado, restore,
  publicación y activación conservan además su trabajo/auditoría permanente.
- Repetir la misma clave con el mismo hash devuelve el mismo resultado.
- Repetirla con otro hash devuelve `409 IDEMPOTENCY_KEY_REUSED`.
- `If-Match`/`expected_version` protege borradores, preferencias, candidatos y
  activaciones. Conflicto: `409 VERSION_CONFLICT`.
- Las lecturas son seguras para reintentar; no se asume orden de llegada de
  dispositivos.
- `429 RATE_LIMITED` incluye `Retry-After`; generación, exportación, compra y
  Luna aplican las ventanas exactas de `SECURITY_CONTRACT.md`.
- El servidor rechaza tamaño/profundidad/filas antes de normalizar y nunca
  procesa parcialmente un payload sobrelímite.

### Caché y observabilidad

- Toda respuesta que contenga perfil, borrador, plan, seguimiento,
  administración o metadatos de exportación usa `Cache-Control: no-store,
  private`.
- El middleware registra solo la plantilla de ruta, nunca query, body,
  `Authorization`, cookies, Turnstile, QR/código ni handle de exportación.

### Respuesta de error

```json
{
  "error": {
    "code": "PLAN_CANDIDATE_INVALID",
    "message_key": "plan.candidate.invalid",
    "details": {"modules": ["nutrition"]},
    "request_id": "req_...",
    "retryable": false
  }
}
```

Nunca se devuelven secretos, hashes de códigos, datos de otro perfil ni
detalles internos de reglas que faciliten evasión.

Errores mínimos comunes: `400 INVALID_INPUT`, `401 UNAUTHENTICATED`, `403
FORBIDDEN`, `404 NOT_FOUND`, `409 VERSION_CONFLICT`, `409
IDEMPOTENCY_KEY_REUSED`, `422 DOMAIN_CONSTRAINT`, `429 RATE_LIMITED`, `500
INTERNAL_ERROR`, `503 DEPENDENCY_UNAVAILABLE`. El acceso puede devolver `403
CHALLENGE_REQUIRED` sin confirmar si alias, invitación o código existen.

## 2. Operaciones de acceso

| Operación | Entrada principal | Salida/efecto |
|---|---|---|
| `POST /v1/invitations/redeem` | identidad de dispositivo, `captcha_token`, secreto de invitación en body, declaración adulta y alias | consume invitación, crea perfil, membresía y código privado |
| `POST /v1/profiles/{id}/device-links/qr` | sesión autorizada | concesión QR de un solo uso con TTL fijo; no devuelve salud |
| `POST /v1/device-links/qr/consume` | identidad nueva + payload QR en cuerpo + `challenge_token?` | crea membresía, consume token y devuelve `profile_access_id`, `profile_id` y alias mínimo |
| `POST /v1/device-links/code/consume` | identidad nueva + alias + código privado + `challenge_token?` | crea membresía y devuelve el mismo handle sin revelar si falló alias o código |
| `GET /v1/me/profiles` | identidad autenticada | lista únicamente `profile_id`, alias y estado de sus membresías |
| `POST /v1/profiles/{id}/private-code/rotate` | sesión autorizada | revoca atómicamente el código anterior y devuelve el único nuevo; sesiones existentes siguen salvo opción de revocación |
| `POST /v1/profiles/{id}/sessions/{sid}/revoke` | sesión autorizada | revoca la membresía del dispositivo en ese perfil; otras membresías permanecen |
| `POST /v1/me/session/touch` | sesión autenticada | actualiza actividad idempotentemente y devuelve expiración idle/absoluta |
| `GET /v1/profiles/{id}/sessions` | sesión autorizada | lista dispositivo, actividad y fecha |
| `POST /v1/profiles/{id}/deletion-requests` | sesión autorizada + confirmación reforzada | cambia a `deletion_requested`, bloquea acceso ordinario y devuelve handle opaco |
| `GET /v1/deletion-requests/{handle}` | identidad que solicitó | devuelve solo estado del trabajo y fecha, nunca contenido del perfil |

La creación de la identidad anónima ocurre con el SDK de Supabase Auth y no
concede acceso a perfiles. La llamada incluye la prueba antiabuso soportada por
Auth. Tras `CHALLENGE_REQUIRED`, el cliente obtiene Turnstile y repite
`code/qr/consume` con `challenge_token`; el servidor verifica acción, hostname
y vigencia. El alias repetido no concede acceso. QR y código son vinculación,
no recuperación autoservicio. Una identidad puede pertenecer a varios perfiles
y la revocación ordinaria se limita al perfil indicado.

El payload QR es texto opaco no URL y solo se acepta en el cuerpo JSON. Se
rechaza si llega por query, fragmento reenviado o cabecera no prevista.
El secreto de invitación sigue la misma regla. Un enlace distribuible, si se
usa, solo abre la ruta pública de la aplicación y puede contener una pista no
secreta; nunca transporta el token en path, query o fragmento.

Cada identidad Auth representa un dispositivo lógico y tiene una sola
`DeviceSession` activa; las pestañas del mismo navegador comparten sesión.
Revocar `/profiles/{id}/sessions/{sid}` elimina únicamente la membresía de ese
perfil. El cierre global o vencimiento del actor deshabilita su sesión, revoca
todas sus membresías y ejecuta el cierre servidor de Supabase para invalidar
todos los refresh tokens de esa identidad. Un access JWT residual tampoco
autoriza porque RLS consulta actor, sesión y membresía en cada petición.

El estado de borrado se resuelve por `request_handle_hash`, no mediante la fila
`Profile`. Cuando la purga elimina el perfil, `DeletionJob.profile_id` queda
nulo y el job terminal conserva solo marcador/estado mínimo. El actor
solicitante puede consultarlo mientras su identidad exista; si Auth queda
huérfana y se elimina, solo el superadministrador conserva acceso técnico.

## 3. Operaciones de cuestionario y contexto

| Operación | Propósito | Notas |
|---|---|---|
| `GET /v1/questionnaire/schema` | devuelve preguntas, opciones, dependencias y versión | sin respuestas del usuario |
| `GET /v1/profiles/{id}/draft` | reanuda borrador | devuelve `status`, progreso y `updated_at` |
| `PUT /v1/profiles/{id}/draft` | guarda respuestas parciales | idempotente; permite campos sugeridos dinámicamente |
| `POST /v1/profiles/{id}/draft/submit` | valida resumen final | no genera plan todavía |
| `POST /v1/profiles/{id}/contexts/snapshot` | normaliza y congela contexto | rechaza menor de edad o unidades inválidas |
| `GET /v1/profiles/{id}/labs` | recupera historial, tendencia, vigencia y candidatos pendientes | usa todos los valores y destaca el más reciente; sin predicción |
| `POST /v1/profiles/{id}/labs` | registra 1–4 valores manuales | fecha/rango/confianza; no OCR en V1 |
| `GET /v1/profiles/{id}/follow-ups` | recupera revisiones y candidatos pendientes | aislado por perfil y disponible tras vincular otro dispositivo |
| `POST /v1/profiles/{id}/follow-ups` | guarda revisión semanal, de cuatro semanas o diaria opcional | omisión del diario no bloquea; un cambio estructural exige completar contexto |
| `PUT /v1/profiles/{id}/reminder-preferences` | guarda anclajes y recordatorios | apagados por defecto; opt-in explícito |

Una respuesta desconocida o un conflicto clínico sin contestar se conserva como
incertidumbre y permite snapshot provisional.

## 4. Operaciones de planes

| Operación | Propósito | Resultado |
|---|---|---|
| `POST /v1/profiles/{id}/plans/generate` | ejecuta pipeline determinista | crea `PlanVersion:draft` y validación |
| `GET /v1/profiles/{id}/plans/current` | descubre el plan único del perfil | devuelve historial versionado; `404` solo cuando el perfil accesible todavía no tiene plan |
| `GET /v1/plans/{plan_id}/versions` | historial | incluye estado y completitud |
| `GET /v1/plans/{plan_id}/versions/{version_id}` | consulta activa, borrador o archivada | panel por día/módulo |
| `POST /v1/plans/{plan_id}/versions/{version_id}/activate` | activa el primer borrador válido | activación inicial atómica |
| `POST /v1/plans/{plan_id}/candidates` | recalcula tras cambio con impacto | crea versión candidata y devuelve diff, módulos y hallazgos |
| `POST /v1/candidates/{id}/activate` | activa manualmente versión candidata válida | archiva anterior de forma atómica |
| `POST /v1/candidates/{id}/discard` | descarta propuesta | conserva razón técnica opcional |
| `POST /v1/plans/{plan_id}/adjustments/preview` | previsualiza cambio controlado | no muta activo |
| `POST /v1/plans/{plan_id}/adjustments` | confirma una edición controlada | crea evento, versión candidata y candidato; nunca muta activo |

`generate` no puede saltarse validaciones normativas. Si falla una restricción
o la salida es inconsistente, devuelve `PLAN_VALIDATION_FAILED` y mantiene el
plan activo. Las puertas G1–G8 evalúan el lanzamiento, no cada petición.

## 5. Operaciones de catálogo y compra

| Operación | Propósito |
|---|---|
| `GET /v1/foods/search?q=` | busca alimento canónico y aliases |
| `GET /v1/profiles/{id}/products/barcode/{gtin}` | resuelve producto comercial con precedencia del perfil |
| `POST /v1/profiles/{id}/products/barcode/{gtin}/confirm` | confirma o corrige etiqueta para reutilización privada inmediata; crea revisión `profile_confirmed` |
| `GET /v1/catalogs?chain=` | consulta revisión publicada y cobertura |
| `PUT /v1/profiles/{id}/shopping-preference` | guarda cadena habitual, comparación y orden |
| `POST /v1/plans/{version_id}/shopping` | calcula cesta consultiva |
| `POST /v1/shopping/{id}/leftovers` | confirma sobrantes; recalcula paquetes |
| `GET /v1/shopping/{id}` | devuelve precio base, cobertura, pendientes y reglas de orden |

El plan nutricional es la verdad. Si no hay equivalencia confirmada, el item
queda `Sin producto confirmado`; no se sustituye alimento ni se oculta la
carencia. La comparación multitienda es opcional y nunca cambia la cadena
habitual.

La aprobación administrativa crea una nueva corrección `global_approved`
referenciando la propuesta; nunca muta ni expone a otros perfiles la revisión
privada. La resolución aplica: corrección del perfil, global aprobada, etiqueta
confirmada y fuente importada.

`shopping` devuelve `422 NUTRITION_MODULE_REQUIRED` si la versión no contiene
un resultado válido de alimentación.

## 6. Operaciones de explicación y exportación

| Operación | Propósito | Regla |
|---|---|---|
| `POST /v1/plans/{version_id}/explanation` | solicita texto Luna postvalidación | solo campos permitidos; respuesta no autoritativa |
| `POST /v1/plans/{version_id}/exports` | genera un artefacto PDF o XLSX compacto/completo | congela versión, elecciones, modo, periodo y renderizador; nunca genera impresión |
| `GET /v1/exports/{id}/content` | proxyfica el objeto privado después de validar JWT, actor, sesión, membresía y artefacto | nunca redirige ni expone una capability de Storage; compuestos sensibles omitidos |

La petición Luna se rechaza si intenta escribir una entidad de dominio. Un
fallo de proveedor devuelve `AI_EXPLANATION_UNAVAILABLE` y texto determinista.

Los artefactos viven en bucket privado. La Edge Function lee el objeto con una
credencial servidora de mínimo alcance y transmite la respuesta al cliente
autenticado. No redirige a una URL firmada ni coloca bearer alguno en path,
query o fragmento. La respuesta usa `Cache-Control: no-store, private`,
`Content-Disposition` con nombre neutro y `Referrer-Policy: no-referrer`.

La solicitud de exportación usa `schemaVersion=1`, formato `pdf|xlsx`, detalle
`compact|complete`, presentación `ingredients|preparation`, alcance de día o
semana, opciones de compra/preparación semanal y una lista acotada de elecciones
`[dayIndex,mealIndex,foodIndex,choice]`. El servidor incorpora
`rendererVersion=export-v1` al hash de configuración. La respuesta pública solo
contiene identificadores, formato, detalle, presentación, estado y fecha; no
contiene perfil, actor, ruta, digest ni URL.

La impresión se construye localmente desde el mismo modelo canónico en memoria,
usa CSS A4 y no persiste un `ExportArtifact`.

## 7. Operaciones de superadministrador

Se exponen bajo `/v1/admin/*`, requieren cuenta separada, AAL2, autorización
servidora y auditoría técnica. Antes de cada mutación se verifica el recibo
externo `intent`; el `outcome` se completa por outbox idempotente. Si la
transacción revierte antes de poder crear outbox, un bloque `catch/finally`
intenta registrar `failure` con schema cerrado. Un reconciliador periódico
enumera intents externos sin outcome, consulta el journal de idempotencia y
los cierra idempotentemente; restore no es el único mecanismo de compensación:

| Operación | Propósito |
|---|---|
| `POST /v1/admin/invitations` | crea invitación con caducidad |
| `POST /v1/admin/invitations/{id}/revoke` | anula una invitación |
| `GET /v1/admin/profiles` | lista perfiles, cuestionarios, planes y métricas |
| `PATCH /v1/admin/profiles/{id}` | edición administrativa explícita; genera impacto/candidato cuando proceda |
| `POST /v1/admin/profiles/{id}/access-reset` | genera código nuevo y opción de revocar accesos |
| `POST /v1/admin/profiles/{id}/impersonations` | inicia contexto de actor efectivo |
| `POST /v1/admin/impersonations/{id}/end` | termina impersonación |
| `DELETE /v1/admin/profiles/{id}/permanent` | crea/reanuda `DeletionJob`, registra ledger externo y ejecuta purga idempotente |
| `GET /v1/admin/deletion-jobs/{id}` | consulta estado, pasos completados y error redactado |
| `POST /v1/admin/barcode-corrections/{id}/approve` | crea una nueva revisión global compartida desde una propuesta privada |
| `POST /v1/admin/matching-rules/{id}/activate` | activa revisión de matching |
| `POST /v1/admin/rule-sets/{id}/activate` | activa conjunto de reglas |
| `POST /v1/admin/ai-provider-revisions/{id}/activate` | habilita proveedor solo tras validar región, retención, no entrenamiento, precio y minimización |
| `POST /v1/admin/catalog-revisions/{id}/publish` | publica revisión de cadena |
| `POST /v1/admin/catalog-publications/{id}/hide` | oculta sin borrar historia |
| `POST /v1/admin/backups` | crea copia precrítica |
| `POST /v1/admin/restores` | inicia restauración aislada |
| `POST /v1/admin/restores/{id}/promote` | promueve solo tras validación |
| `GET /v1/admin/audit-events` | consulta log privado redactado |

Cada acción registra actor administrador, objetivo, timestamp, resultado y
`request_id`; durante impersonación conserva actor original y perfil efectivo.
No se muestra al usuario común.

## 8. Versionado del contrato

- Prefijo `/v1`; cambios incompatibles requieren `/v2`.
- Campos nuevos son opcionales y deben tolerarse en cliente.
- Se valida `schema_version` del payload y se rechaza una versión futura con
  `UNSUPPORTED_SCHEMA_VERSION`.
- Un plan conserva el contrato, motor, reglas y fuentes con los que fue
  generado aunque la API evolucione.
