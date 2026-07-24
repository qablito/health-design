# Borrado permanente de perfil

**Propietario:** superadministrador
**Última revisión:** 2026-07-23
**Último simulacro:** 2026-07-23, pruebas sintéticas locales, PASS
**RPO/RTO observado:** no aplica al borrado; recuperación no está permitida.

## Objetivo y alcance

Bloquear inmediatamente un perfil, escribir un tombstone externo irreversible
y ejecutar una purga idempotente y reanudable de accesos, exportaciones,
Storage y datos privados. El job terminal conserva únicamente el handle opaco,
marcador y evidencia técnica; `profile_id` queda `NULL`.

Quedan fuera: reactivar `deletion_requested`, recuperar el perfil, borrar
auditoría administrativa, borrar revisiones globales o ejecutar Production.

## Solicitud del usuario

La persona inicia el flujo desde su perfil, acepta la advertencia irreversible
y confirma el alias normalizado y la frase fija. La petición exige sesión,
membresía activa e `Idempotency-Key`.

Al aceptarse, el perfil queda `deletion_requested`: se bloquean lectura,
edición, generación, exportación y compra. La UI solo muestra estado, fecha de
solicitud/finalización y error público allowlisted. Nunca muestra marcador,
hashes, rutas o el código privado.

## Ejecución administrativa

Precondiciones:

- entorno `development` expresamente autorizado;
- cuenta superadministradora separada;
- AAL2 y TOTP reciente;
- doble confirmación, versión esperada e `Idempotency-Key`;
- Worker `deletions`, purga de exportaciones y Storage disponibles;
- ningún dato real durante el primer smoke remoto.

Desde el panel administrativo se inspecciona el job y se pulsa reanudar o
eliminar permanentemente. El servidor aplica, sin saltos:

1. comprobar `deletion_requested`;
2. crear/reutilizar el job y derivar el marcador HMAC versionado;
3. añadir y leer de vuelta el tombstone firmado;
4. fijar `ledger_recorded`;
5. revocar membresías, sesiones, QR, códigos e invitaciones aplicables;
6. fijar `purging`;
7. purgar exportaciones y objetos Storage exactos;
8. purgar cuestionarios, planes, IA, seguimiento, laboratorio, productos
   privados, compra, idempotencias y cachés controladas;
9. eliminar Auth solo cuando quede huérfana;
10. verificar ausencia por recurso y fijar `purged`.

La petición administrativa es:

```text
DELETE /v1/admin/profiles/{profileId}/permanent
GET /v1/admin/deletion-jobs/{jobId}
```

No se invoca desde shell con tokens. El panel aplica autorización, cabeceras
privadas, `intent → mutación/outbox → outcome` y respuestas redactadas.

## Condiciones de parada y reanudación

Detenerse si tombstone, firma o readback fallan; falta un path de Storage; la
purga de exportación no confirma ausencia; Auth conserva membresía, rol,
invitación u operación; o aparece un error no allowlisted.

El job queda `failed` con hitos previos intactos. Reanudar explícitamente con la
misma identidad del job y versión actual. Nunca escribir otro tombstone por un
replay exacto. Un cuerpo distinto con la misma idempotencia es conflicto.

El borrado no tiene rollback. El alias solo se libera tras `purged`.

## Validación y evidencia

```bash
pnpm test:operations
pnpm verify:tombstones
pnpm verify:continuity-ledger
pnpm test:db
```

Confirmar: acceso ordinario bloqueado, tombstone anterior a la purga, cero
objetos privados, cero datos del perfil, globales intactos, Auth compartida
conservada, Auth huérfana eliminada, job terminal consultable y alias liberado.

Archivar solo IDs opacos, secuencias, estados, duraciones, códigos allowlisted y
hashes técnicos autorizados. Alertar por intent >5 min, borrado parcial,
divergencia del ledger o job fallido.
