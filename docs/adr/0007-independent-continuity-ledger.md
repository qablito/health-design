# ADR-0007: ledger independiente para borrados y auditoría privilegiada

- Estado: aceptado
- Fecha: 2026-07-16

## Contexto

V1 conserva cuatro copias rotativas y exige que un perfil borrado no reaparezca
al restaurar una copia anterior. Guardar el tombstone únicamente en la misma
base de datos es insuficiente: una copia creada antes del borrado no contiene
ese registro.

El marcador debe sobrevivir a la restauración del proyecto y no puede depender
de que el dump antiguo conozca un borrado posterior.

El registro técnico privado tiene conservación indefinida hasta eliminación
permanente del superadministrador. Si viviera solo en Postgres, restaurar una
copia anterior podría truncar acciones administrativas posteriores aunque la
cadena local de esa copia siguiera siendo internamente válida.

## Decisión

- El ledger independiente se implementa como un Worker privado, un Durable
  Object coordinador por entorno y dos buckets/políticas Cloudflare R2
  privadas. El Durable Object serializa el append, asigna secuencia y hash, y
  R2 conserva cada registro como objeto nuevo con escritura condicional y
  checksum.
- Existen dos streams con claves y esquemas separados:
  - `deletions`: tombstones mínimos con Bucket Lock indefinido que impiden
    revivir perfiles y recibos mínimos de rangos de auditoría borrados;
  - `admin-audit`: eventos técnicos cifrados de acciones privilegiadas, sin
    expiración automática y sin operación de borrado expuesta por el Worker de
    append.
- El restore enumera objetos por secuencia y verifica cada cadena; no confía en
  un puntero `latest` mutable ni en la copia restaurada.
- Cada registro de `deletions` contiene únicamente:
  - marcador HMAC-SHA-256 no reversible del `profile_id`;
  - versión de la clave HMAC;
  - identificador del `DeletionJob`;
  - secuencia;
  - fecha;
  - hash del registro anterior;
  - hash/firma del registro actual.
- No contiene alias, respuestas, condiciones, medicación, plan ni otra PII.
- Cada registro de `admin-audit` conserva metadatos de cadena en claro y un
  payload allowlisted cifrado por envolvente con AES-256-GCM: actor original
  opaco, actor efectivo, acción, tipo/ID opaco de objetivo, `request_id`, fase
  `intent|outcome|reconciliation`, resultado técnico y timestamp. Cada objeto
  usa una DEK aleatoria de 256 bits, nonce aleatorio único de 96 bits y tag
  GCM; la DEK se envuelve mediante una KEK versionada con AES-KW o servicio
  gestionado equivalente. El AAD exacto es
  `environment|stream|sequence|schema_version|previous_hash|timestamp`. Nunca
  incluye cuerpos, medicación, valores clínicos, código/QR, token, prompt ni
  contenido del plan. Un checksum de objeto no sustituye el tag AEAD.
- El recibo del coordinador se firma con Ed25519 e incluye entorno, stream,
  secuencia, `record_hash`, timestamp, hash de idempotencia y versión de clave.
  Las claves públicas están fijadas y versionadas en Edge, restore y
  verificador offline; las antiguas se conservan para verificar historia. Se
  rechaza firma inválida, replay, clave desconocida/revocada fuera de su
  vigencia o cambio de campo firmado.
- Antes de cualquier mutación privilegiada, la función servidora debe obtener
  y verificar un recibo durable `intent`. Si ese append falla, la mutación no
  comienza.
- La transacción de Postgres aplica la mutación, inserta el espejo local del
  `intent` y crea `AuditOutbox` para el `outcome`. El outbox finaliza de forma
  idempotente; mientras falte el recibo final, la operación no se considera
  cerrada operativamente y una restauración no puede promoverse.
- Si Postgres revierte después del `intent` pero antes de crear outbox, el
  orquestador intenta en `catch/finally` un `outcome=failure` idempotente y
  cerrado. Si ese append tampoco responde, un reconciliador periódico enumera
  intents externos sin outcome, consulta journal de idempotencia/estado de
  mutación y emite `reconciliation`/`outcome`. El Worker alerta desde los cinco
  minutos. Restore mantiene la barrera final, pero no es la compensación
  operativa ordinaria.
- El ledger se exporta además a una copia local cifrada semanal bajo control
  del superadministrador.
- Un `DeletionJob` solo pasa de `queued` a `ledger_recorded` tras confirmar la
  escritura y lectura del objeto.
- Un restore carga ambos streams remotos y la copia local. La copia puede ser
  un prefijo con antigüedad máxima de siete días; su último hash debe coincidir
  con el mismo punto de cada cadena remota y esta solo puede extenderla. El
  espejo `TechnicalAuditEvent` se reconstruye o completa desde
  `admin-audit`; ningún restore puede truncarlo silenciosamente.
- Si falta el ledger, la cadena no cierra o existe una discrepancia, el restore
  falla cerrado.

### Borrado permanente de un rango `admin-audit`

El superadministrador conserva esta capacidad excepcional, pero nunca se
eliminan eventos sueltos ni se deja un hueco implícito:

1. `AuditDeletionJob` congela un rango contiguo `[from_sequence,to_sequence]` y
   crea un manifiesto ordenado de `sequence + record_hash + object_key`.
2. Calcula `hash_before_range`, `terminal_record_hash` y SHA-256/Merkle root del
   manifiesto. Una doble confirmación AAL2 añade a `deletions` un
   `audit_range_delete_intent` firmado con esos límites y hashes.
3. Una credencial R2 offline, activada just-in-time y limitada al bucket/prefijo
   `admin-audit`, elimina exactamente los objetos del manifiesto. La aplicación
   y el Worker ordinario no tienen permiso ni ruta de borrado.
4. El job enumera y verifica ausencia. Solo entonces añade a `deletions` un
   `audit_range_delete_complete` firmado que referencia el intent y manifiesto.
   La credencial se revoca inmediatamente.
5. Un fallo parcial queda reanudable, bloquea nuevos borrados de auditoría y
   bloquea promoción de restore. Los eventos administrativos posteriores
   pueden continuar encadenándose desde `terminal_record_hash`.
6. El verificador admite el salto únicamente cuando sus límites coinciden
   exactamente con un par intent/complete válido. El registro siguiente debe
   referenciar `terminal_record_hash`; cualquier otro hueco falla cerrado.
7. Restore carga primero `deletions`, ignora o elimina cualquier payload
   restaurado cubierto por el rango, representa el tramo como placeholder de
   hashes y verifica ambos límites. Nunca resucita el contenido eliminado.

## Consecuencias

### Positivas

- Un backup anterior al borrado no puede reactivar por sí solo el perfil.
- La continuidad no depende de una tabla que el propio restore pueda
  retroceder.
- Una copia anterior tampoco puede borrar del historial acciones
  administrativas posteriores.
- Bucket Lock reduce la eliminación o sobrescritura accidental.
- El contenido del ledger no permite reconstruir datos de salud.

### Costes y riesgos

- Aparecen Worker, Durable Object, R2 y credenciales operativas adicionales.
- La cuenta Cloudflare sigue siendo una frontera de confianza; el control no
  protege frente al propietario último de la cuenta.
- El borrado necesita un trabajo reanudable porque base y ledger no comparten
  una transacción.
- Una acción privilegiada usa un protocolo `intent/outcome`; puede quedar
  pendiente de finalización técnica aunque su transacción de negocio haya
  concluido. El outbox y el bloqueo de restore hacen visible ese estado.
- El superadministrador conserva la capacidad excepcional de eliminar
  permanentemente rangos de `admin-audit`, pero el protocolo mantiene una
  prueba hash mínima irreversible en `deletions` y hace visibles los huecos.
- La pérdida simultánea del ledger remoto y la copia local bloquea
  restauraciones hasta resolverla.

## Controles

- El endpoint de append solo acepta autenticación servicio-a-servicio, payload
  allowlisted, timestamp/nonce e idempotency key; no es público ni accesible
  desde el frontend.
- El Durable Object conserva una cabeza por stream y entorno. El registro se
  canonicaliza en UTF-8/NFC, se encadena con SHA-256 y R2 verifica checksum y
  escritura condicional antes de devolver un recibo firmado.
- La clave HMAC del marcador es distinta de la clave de backup, vive en el
  gestor de secretos/recuperación offline y se conserva mientras algún registro
  dependa de su versión.
- La KEK de `admin-audit`, la clave privada Ed25519, la HMAC de tombstones y la
  KEK de backups son independientes. Cada evento/recibo conserva versión de
  clave. La rotación de firma mantiene un solapamiento controlado, publica la
  clave nueva antes de usarla y no retira claves públicas antiguas necesarias
  para verificar historia.
- El Worker ordinario no implementa rutas ni comandos de borrado de
  `admin-audit`; el borrado permanente usa un despliegue/runbook administrativo
  separado y nunca se ejecuta desde el navegador.
- Rotarla exige añadir marcadores equivalentes para todo el ledger, verificar
  cobertura y solo entonces retirar la versión anterior.
- Escritura por objetos nuevos y verificación posterior a la escritura.
- Bucket privado, cifrado en tránsito/reposo y Bucket Lock indefinido.
- Copia local cifrada, hash-encadenada y verificada en cada simulacro.
- Alertas ante huecos de secuencia, divergencia de hash, `intent` sin
  `outcome`, outbox atascado, borrado de rango incompleto o fallo de copia.
- Prueba F07 contra cada una de las cuatro rotaciones y F10 con mutaciones
  administrativas concurrentes. Se añaden pruebas de ciphertext/AAD/tag
  alterados, firma/replay/rotación, rollback sin outbox y borrado parcial/
  completo de rango antes y después de restore.

## Alternativas descartadas

- **Tabla en la base restaurable:** desaparece al volver a una copia anterior.
- **Auditoría solo en la base restaurable:** puede perder acciones posteriores
  al punto de copia.
- **Incluir el tombstone solo en cada dump nuevo:** no protege las copias ya
  existentes.
- **Depender únicamente de memoria/manual:** no es verificable ni reproducible.
- **Borrar todas las copias inmediatamente:** contradice la expiración natural
  de cuatro rotaciones y reduce capacidad de recuperación.

## Referencias

- [Cloudflare R2: Data security](https://developers.cloudflare.com/r2/reference/data-security/)
- [Cloudflare R2: Bucket locks](https://developers.cloudflare.com/r2/buckets/bucket-locks/)
- [Cloudflare Durable Objects](https://developers.cloudflare.com/durable-objects/)
- [Cloudflare R2 Workers API](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/)
- [Supabase: Database backups](https://supabase.com/docs/guides/platform/backups)
