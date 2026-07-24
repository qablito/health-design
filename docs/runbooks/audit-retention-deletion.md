# Borrado excepcional de rangos de auditoría

**Propietario:** superadministrador operador
**Última revisión:** 2026-07-23
**Último simulacro:** 2026-07-23, operador sintético local, PASS
**RPO/RTO observado:** no aplica.

## Objetivo y alcance

Eliminar excepcionalmente un rango contiguo de objetos `admin-audit` dejando
en `deletions` un par verificable `intent/complete`. No se expone en la UI
común ni en el Worker ordinario.

Quedan fuera: rangos no contiguos, objetos no incluidos en el manifiesto,
credenciales R2 normales, Production y cualquier ejecución remota sin una
autorización destructiva independiente.

## Precondiciones

- cuenta superadministradora separada, AAL2 y TOTP <5 min;
- Development y rango sintético durante la primera activación;
- manifiesto canónico ordenado por `sequence`, `record_hash`, `object_key`;
- `hash_before_range`, `terminal_record_hash` y digest exactos;
- ningún `AuditDeletionJob` abierto o fallido anterior;
- doble confirmación por ID del job.

## Flujo cerrado

1. Preparar `AuditDeletionJob` y revisar el manifiesto sin borrar.
2. Añadir `audit_range_delete_intent` a `deletions` y verificar readback.
3. Crear una credencial R2 JIT de solo borrado, TTL máximo 300 s, limitada al
   bucket y a las claves exactas del manifiesto.
4. Borrar solo esas claves y enumerar su ausencia exacta.
5. Añadir `audit_range_delete_complete`.
6. Revocar siempre la credencial en `finally`.
7. Marcar `verified`.

Los verificadores locales se ejecutan con:

```bash
pnpm verify:continuity-ledger
pnpm verify:audit-ledger
pnpm test:operations
```

El código operativo probado vive en
`scripts/operations/audit-range.mjs`. La activación remota no se expresa como
un comando genérico con credenciales persistentes: debe conectar adaptadores
JIT del operador y obtener una autorización independiente cuando el rango
sintético exacto esté preparado.

## Fallo parcial e irreversibilidad

Un fallo tras `intent` queda incompleto y reanudable; bloquea nuevos borrados y
promoción de restore. El verificador no acepta el hueco hasta que los límites,
digest y recibos `intent/complete` coincidan exactamente. La eliminación de
objetos es irreversible.

Archivar el ID opaco, límites, digest, secuencias y recibos firmados; nunca
paths completos, credenciales o payloads. Alertar por intent >5 min,
`audit_range_incomplete`, divergencia o credencial no revocada.
