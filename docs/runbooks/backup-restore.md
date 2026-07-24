# Backup cifrado y restauración aislada

**Propietario:** superadministrador operador
**Última revisión:** 2026-07-23
**Último simulacro:** 2026-07-23, fixture local, cuatro rotaciones, PASS
**RPO/RTO observado:** RPO sintético 0 días; RTO del fixture de cuatro
rotaciones 0,70 s. Development debe medirse durante la activación remota y
Production queda fuera.

## Objetivo y alcance

Crear conjuntos lógicos cifrados que incluyan PostgreSQL, todos los objetos de
Storage privado autorizados y prefijos verificados de `deletions` y
`admin-audit`; conservar cuatro conjuntos `ready`; y demostrar que cada copia
puede restaurarse en un destino local nuevo, vacío y aislado sin resucitar
perfiles borrados.

Quedan fuera: snapshots nativos como sustituto de Storage, restaurar sobre un
proyecto enlazado, promover automáticamente, desplegar y operar Production.

## Autoridad, entorno y secretos

- Solo el superadministrador operador puede crear, podar o solicitar promoción.
- Los jobs remotos requieren AAL2 y TOTP verificado hace menos de cinco minutos.
- Captura y restore reales se limitan a Development tras autorización separada.
- La KEK versionada, las claves Ed25519 de firma del backup y las claves
  públicas versionadas de firma de los ledgers entran por `stdin`; nunca por
  argumentos, variables versionadas, navegador o Edge.
- El destino de restore debe declarar `local-isolated`, un ref distinto de todo
  proyecto conocido, tráfico deshabilitado y un directorio 0700 vacío.

Detenerse si falta un objeto, manifiesto, clave histórica, firma, hash, tag,
AAD, prefijo de ledger o si existe un intent/rango incompleto.

## Dry-run y fixture local

```bash
pnpm backup:create -- --fixture
pnpm restore:drill -- --fixture
```

Resultados esperados: `BACKUP_FIXTURE_PASS` y
`RESTORE_DRILL_FIXTURE_PASS` con `rotations: 4`,
`targetEnvironment: "local-isolated"` y `trafficEnabled: false`.

## Crear y verificar un conjunto

La vía operativa obligatoria captura directamente PostgreSQL, enumera de forma
paginada todos los buckets privados autorizados, descarga y verifica cada
objeto, y copia ambos ledgers desde secuencia cero hasta un head firmado. Un
bucket privado desconocido, un objeto ausente, un intent pendiente o un rango
incompleto abortan el proceso.

```bash
pnpm backup:create -- \
  --capture-live \
  --backup-id <uuid-del-job> \
  --destination <directorio-privado-vacio> \
  --environment development \
  --kind weekly \
  --key-version <version-kek> \
  --schema-version 18
```

La salida dry-run identifica objetivo, entorno, tipo y modo sin leer secretos.
Para ejecutar, se repite con `--apply`, confirmación exacta y el bundle
efímero por `stdin`:

```bash
pnpm backup:create -- \
  --capture-live \
  --backup-id <uuid-del-job> \
  --destination <directorio-privado-vacio> \
  --environment development \
  --kind weekly \
  --key-version <version-kek> \
  --schema-version 18 \
  --apply \
  --confirm <uuid-del-job> \
  --secrets-stdin
```

El bundle contiene las credenciales efímeras de operador, conexión PostgreSQL,
allowlist exacta de buckets privados, claves versionadas de tombstones, KEK,
firma y continuidad. Se canaliza por `stdin` desde el gestor autorizado. El
verificador consulta directamente los heads actuales y los heads exactos de
`deletions` y `admin-audit` mediante la URL HTTPS y el HMAC incluidos en ese
bundle; ambos recibos Ed25519 deben ser válidos. No se admite un archivo local
de heads aportado por el llamador. Después:

```bash
pnpm backup:verify -- \
  --backup <directorio-privado> \
  --secrets-stdin
```

Solo el modo `--capture-live` puede emitir `BACKUP_READY`. La importación
controlada mediante descriptor exige además `--source-root`, rechaza symlinks
y solo emite `BACKUP_DESCRIPTOR_VERIFIED`; nunca sustituye una captura real.
`BACKUP_READY` seguido de `BACKUP_VERIFIED` permite marcar el job `ready`.
Una copia `failed` no desplaza ninguna rotación.

Antes de activar Development se debe comprobar fuera del código que los
buckets R2 de continuidad tienen Object Lock/retención inmutable habilitados.
La ausencia de esa propiedad bloquea la activación remota.

## Rotación y poda

Primero se genera y verifica la copia nueva. Después se calcula, sin borrar:

```bash
pnpm backup:prune -- \
  --inventory <inventario.json> \
  --candidate <copia-nueva.json>
```

Si aparece `pruneCandidateId`, una autorización humana independiente debe
confirmar exactamente ese ID:

```bash
pnpm backup:prune -- \
  --inventory <inventario.json> \
  --candidate <copia-nueva.json> \
  --backup-root <raiz-privada> \
  --environment development \
  --apply \
  --confirm <pruneCandidateId>
```

Un fallo de poda conserva la copia nueva y genera `rotation_prune_pending`.

## Restauración y promoción

La validación local usa `pnpm restore:drill -- --fixture`. Una restauración
operativa debe seguir el mismo orden cerrado: verificar envelope y ledgers,
importar PostgreSQL, restaurar Storage, aplicar migraciones y tombstones,
reconstruir auditoría, revocar sesiones, comprobar RLS/AAL2 y dejar el destino
aislado en `ready_for_promotion`.

```bash
pnpm restore:verify -- \
  --target <directorio-local-aislado> \
  --secrets-stdin
```

La ejecución operativa, siempre sobre PostgreSQL vacío y un Supabase local
aislado sin tráfico, es:

```bash
pnpm restore:execute -- \
  --backup <directorio-cifrado> \
  --backup-id <uuid-backup-ready> \
  --restore-id <uuid-restore> \
  --target-directory <directorio-local-vacio> \
  --target-environment local-isolated \
  --target-ref <ref-local-nueva> \
  --target-fingerprint <sha256-hex> \
  --apply \
  --confirm <uuid-restore> \
  --secrets-stdin
```

El operador ejecuta `pg_restore` usando `PGDATABASE` solo en el entorno del
proceso, aplica únicamente migraciones ausentes, reaplica tombstones con todas
las claves HMAC históricas conocidas, reconstruye outcomes de auditoría,
revoca todas las sesiones y hace readback de cada objeto Storage. Ningún
secreto aparece en argumentos o salida.

Si un intento queda `blocked` o `failed`, el destino se mantiene sin tráfico y
con `restore-quarantine.json`. Para reintentarlo hay que rehacer manualmente el
PostgreSQL y Storage aislados en el mismo endpoint, dejar en el directorio
únicamente el marcador de cuarentena exacto y repetir el comando con
`--retry-quarantined`. El CLI elimina solo ese marcador; después vuelve a
demostrar que PostgreSQL está vacío y repite todas las validaciones. No limpia
ni reutiliza silenciosamente un destino parcial.

El verificador firma una atestación cerrada que vincula manifiesto, heads,
destino aislado, ausencia de intents o rangos incompletos, revocación de
sesiones, perfiles borrados ausentes, Storage completo y RLS comprobada. La
clave pública Ed25519 autorizada se registra en la tabla privada de claves de
validación; PostgreSQL vuelve a verificar criptográficamente el payload y la
firma mediante `pgsodium` tanto al aceptar `ready_for_promotion` como al
promover.
`RESTORE_VERIFIED` no promueve nada. La promoción se solicita por separado en
el panel administrativo y exige que PostgreSQL vuelva a validar esa atestación
completa, además de AAL2, TOTP reciente y doble confirmación. No existe rollback
de una promoción; por eso T18 local no la ejecuta.

## Reanudación, validación y evidencia

- `BackupJob` y `RestoreJob` usan versión esperada; un reintento continúa el
  job, no crea otro efecto.
- Conservar envelope, hashes, versiones, recibos y salida redactada; nunca dump,
  claves o manifiesto descifrado en Git.
- Ejecutar `pnpm verify:tombstones`, `pnpm verify:continuity-ledger`,
  `pnpm verify:audit-ledger`, `pnpm test:operations` y `pnpm test:db`.
- Alertas: backup `ready` >7 días, backup fallido, prefijo atrasado, restore
  bloqueado, RTO ≥24 h o poda pendiente.
- Development requiere medir RPO/RTO reales y archivar el recibo antes de
  declarar cualquier estado remoto.
