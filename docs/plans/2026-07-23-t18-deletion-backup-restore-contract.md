# Contrato ejecutable T18: borrado, backup, restore y operaciones

**Estado:** `T18_COMPLETE_LOCAL_PASS`

**Base:** `3c561abb5d09cfc8538b1580624e8f18b350fb65`

**Entornos:** implementación y validación local. Development requiere una
autorización posterior y Production permanece fuera de alcance.

## Invariantes

- `deletion_requested` es terminal; un perfil no vuelve a `active`.
- El tombstone externo, firmado y leído de vuelta precede a cualquier purga.
- Un dato desconocido o un recurso no verificado nunca se trata como ausente.
- La purga es idempotente, reanudable y conserva hitos cerrados.
- `DeletionJob` sobrevive con `profile_id = NULL`; el alias solo se libera al
  alcanzar `purged`.
- `TechnicalAuditEvent`, `AuditOutbox`, actores administrativos y revisiones
  globales no se eliminan por borrar un perfil.
- Auth solo se elimina cuando la base confirma que la identidad está huérfana.
- Un backup válido incluye PostgreSQL y el contenido real de todos los buckets
  privados autorizados; los metadatos de Storage no bastan.
- Restore solo opera sobre un destino nuevo, vacío, local y aislado. Verifica
  primero ambos streams de continuidad y aplica tombstones antes de habilitar
  cualquier promoción.
- Las acciones privilegiadas conservan `intent → RPC/outbox → outcome`.
- Ningún contrato o log público expone alias, UUID de perfil, marcador, hashes
  internos, rutas Storage, secretos, cuerpos o contexto clínico.

## Inventario P0

La inspección se realizó sobre metadatos del PostgreSQL local reconstruido
desde migraciones. No se consultaron filas de usuarios ni directorios privados.

### Dependencias directas de `Profile`

| Recurso | `ON DELETE` actual | Decisión T18 |
|---|---:|---|
| `profile_access` | `RESTRICT` | revocar y eliminar antes del perfil |
| `private.private_access_codes` | `RESTRICT` | revocar y eliminar |
| `private.qr_grants` | `RESTRICT` | revocar y eliminar |
| `private.export_artifacts` | `RESTRICT` | usar la primitiva de purga existente; verificar objetos y filas |
| `private.ai_usage_events` | `RESTRICT` | eliminar eventos y explicaciones del perfil |
| `private.deletion_jobs` | `SET NULL` | conservar el job terminal mínimo |
| `commercial_product_revisions.owner_profile_id` | `SET NULL` | conservar revisión global aprobada, desvinculada |
| `barcode_corrections` | `CASCADE` | eliminar corrección privada del perfil |
| `commercial_product_idempotency` | `CASCADE` | eliminar con el perfil |
| `commercial_product_lookup_events` | `CASCADE` | eliminar con el perfil |
| `context_snapshots` y `change_events` | `CASCADE` | eliminar con el perfil |
| `follow_up_entries` | `CASCADE` | eliminar con el perfil |
| `lab_batches` y `lab_observations` | `CASCADE` | eliminar con el perfil |
| `plans` y grafo descendiente | `CASCADE` | eliminar con el perfil tras resolver relaciones `RESTRICT` |
| `plan_idempotency` | `CASCADE` | eliminar con el perfil |
| `questionnaire_drafts` e idempotencia | `CASCADE` | eliminar con el perfil |
| `product_confirmations` y eventos privados | `CASCADE` | eliminar con el perfil |
| `shopping_preference_revisions` | `CASCADE` | eliminar con el perfil |
| `shopping_snapshots` y descendientes | `CASCADE` | eliminar con el perfil |
| límites de exportación y compra | `CASCADE` | eliminar con el perfil |

### Recursos indirectos y globales

| Recurso | Autoridad | Conservación o purga | Verificación |
|---|---|---|---|
| versiones, módulos, findings y candidatos del plan | PostgreSQL | purga por el grafo del plan | ausencia por `profile_id`/`plan_id` |
| explicaciones de IA | PostgreSQL | purga antes del evento de uso `RESTRICT` | cero filas ligadas a eventos del perfil |
| revisiones comerciales compartidas | PostgreSQL | conservar; anular propietario cuando aplique | sin vínculo al perfil |
| reglas, fuentes, catálogos y publicaciones globales | PostgreSQL/R2 privado | conservar | digest global sin cambios |
| `TechnicalAuditEvent` y `AuditOutbox` | PostgreSQL + `admin-audit` | conservar y reconciliar | continuidad y ausencia de actor borrado como PII |
| actor de dispositivo | PostgreSQL/Auth | conservar si tiene otra membresía, rol, invitación u operación; si no, deshabilitar y eliminar Auth tras la purga | decisión de elegibilidad atómica |
| sesiones y membresías | PostgreSQL/Auth | revocar primero; no afectar otros perfiles | no queda acceso al perfil |
| invitaciones | PostgreSQL | conservar registros operativos; bloquean eliminación Auth cuando estén pendientes | consulta de elegibilidad |
| bucket `plan-exports` | Storage privado | eliminar paths exactos con primitiva existente | listado vacío para el perfil |
| futuros buckets privados autorizados | Storage privado | enumerar de forma paginada; nunca asumir un bucket único | manifiesto y readback/listado |
| streams `deletions` y `admin-audit` | Worker/DO/R2 | conservar fuera de las cuatro rotaciones | cadena, firma, secuencia y copia local prefijo |

## Orden canónico de purga

1. bloquear el perfil y crear o recuperar `DeletionJob`;
2. derivar el marcador con HMAC versionada;
3. escribir y verificar el tombstone externo;
4. fijar `ledger_recorded`;
5. revocar accesos, sesiones, QR, códigos e invitaciones aplicables;
6. fijar `purging`;
7. purgar y verificar exportaciones y objetos privados;
8. purgar IA, cuestionarios, contexto, planes, seguimiento, productos privados,
   laboratorio, compra, idempotencias y cachés controladas;
9. comprobar elegibilidad Auth y eliminar solo si queda huérfana;
10. verificar ausencia exacta de cada recurso;
11. fijar `purged`; el trigger elimina `Profile`, libera el alias y deja
    `DeletionJob.profile_id = NULL`.

Cada paso posee estado cerrado, puede repetirse sin duplicar efectos y falla
con un código allowlisted. Una dependencia no disponible conserva el job
reanudable y nunca reactiva el perfil.

## Fronteras de implementación

- Las tablas operativas viven en `private`, sin grants para `anon` o
  `authenticated`; las mutaciones usan funciones `SECURITY DEFINER` con
  `search_path` fijo.
- Edge crea y gobierna jobs. Los scripts de operador ejecutan `pg_dump`,
  cifrado, verificación y restore; la KEK no entra en Edge ni en el navegador.
- Los scripts destructivos son dry-run por defecto, exigen entorno e ID exactos
  y no reciben secretos por argumentos.
- T19, T20, Production, despliegues y datos reales no forman parte de T18 local.

## Operación versionada

- [`backup-restore.md`](../runbooks/backup-restore.md)
- [`permanent-deletion.md`](../runbooks/permanent-deletion.md)
- [`anonymous-auth-cleanup.md`](../runbooks/anonymous-auth-cleanup.md)
- [`audit-retention-deletion.md`](../runbooks/audit-retention-deletion.md)

`pnpm test:t18:remote -- --dry-run` verifica sin red que el plan de activación
está limitado a Development. No concede autorización, no ejecuta mutaciones y
no sustituye las aprobaciones independientes exigidas para cada operación.
