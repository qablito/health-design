# Limpieza de identidades Auth huérfanas

**Propietario:** superadministrador operador
**Última revisión:** 2026-07-23
**Último simulacro:** 2026-07-23, fixture local dry-run, PASS
**RPO/RTO observado:** no aplica.

## Objetivo y alcance

Detectar y eliminar en lotes de hasta 100 identidades Auth abandonadas sin
afectar perfiles, administradores, invitaciones ni operaciones. El actor
técnico se deshabilita y se conserva para auditoría.

Solo son elegibles identidades anónimas abandonadas durante más de 24 horas,
siempre sin membresía activa, rol administrativo, invitación u operación
pendiente. Las identidades no anónimas, Production y los actores activos
quedan fuera.

## Dry-run obligatorio

```bash
pnpm cleanup:anonymous-auth -- \
  --fixture \
  --now 2026-07-23T12:00:00.000Z
```

La salida contiene solo conteos, modo e ID técnico. `attempted` y `succeeded`
deben ser cero. Para Development, los secretos —URL, service role, sujeto,
sesión AAL2, ref, URL/HMAC del ledger y clave pública de firma del ledger— se
pasan como un único JSON por `stdin`:

```bash
pnpm cleanup:anonymous-auth -- \
  --environment development \
  --project-ref <development-ref> \
  --cleanup-id <cleanup-id> \
  --limit 100 \
  --secrets-stdin
```

Revisar humanamente el resumen. Detenerse si aparece cualquier exclusión
protegida, si el ref o la URL no coinciden exactamente con el proyecto
Development canónico o si el lote supera 100.

## Aplicación autorizada

Solo después del dry-run aprobado y con autorización separada:

```bash
pnpm cleanup:anonymous-auth -- \
  --environment development \
  --project-ref <development-ref> \
  --cleanup-id <cleanup-id> \
  --limit 100 \
  --apply \
  --confirm <cleanup-id> \
  --secrets-stdin
```

Antes de mutar, el operador registra un intent en PostgreSQL y en
`admin-audit`; el recibo externo debe superar la verificación Ed25519. La base
vuelve a comprobar elegibilidad con AAL2 y bloqueo de fila, deshabilita primero
el actor y después elimina Auth. Tras el efecto registra y finaliza el outcome
con el mismo control de recibo. Si Auth falla, el actor deshabilitado y el
intent pendiente quedan reanudables. Un 404 de Auth es éxito idempotente.
Nunca se registran UUID, correo, alias, tokens o payloads.

## Validación, reanudación y alertas

```bash
pnpm test:operations
pnpm test:db
```

Repetir el dry-run con el cursor siguiente hasta que no haya candidatos. Un
segundo apply no debe producir cambios adicionales. Confirmar que perfiles
activos y superadministradores siguen presentes y que el actor técnico
deshabilitado sobrevive con `auth_subject = NULL`.

No existe rollback del borrado Auth. Conservar el job/actor técnico y reanudar
solo el paso fallido. Alertar por `auth_cleanup_failed`; la evidencia ordinaria
se limita a conteos, duración, estado y error allowlisted.
