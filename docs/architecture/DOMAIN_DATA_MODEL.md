# Modelo de dominio y datos de V1

**Estado:** contrato lógico  
**Versión:** 1.0  
**Fuente funcional:** [`PRODUCT.md`](../../PRODUCT.md) · vocabulario en
[`CONTEXT.md`](../../CONTEXT.md)

El siguiente modelo es lógico. Los nombres SQL definitivos pueden cambiar,
pero las relaciones, estados, invariantes y trazabilidad no.

## 1. Agregados principales

### Actor y acceso

| Entidad | Propósito | Campos mínimos |
|---|---|---|
| `Actor` | identidad técnica | `id`, `auth_subject UUID NOT NULL UNIQUE`, `role=device\|superadmin`, `created_at`, `disabled_at?` |
| `Invitation` | permiso de alta | `id`, `token_hash`, `created_at`, `expires_at`, `consumed_at?`, `revoked_at?`, `created_by` |
| `Profile` | perfil adulto y sus planes | `id`, `alias`, `country=ES`, `timezone`, `adult_attested_at`, `status=active\|deletion_requested`, `created_at`, `deletion_requested_at?` |
| `ProfileAccess` | vínculo actor-perfil | `profile_id`, `actor_id`, `access_scope`, `created_at`, `revoked_at?`, `revoked_by?` |
| `DeviceSession` | sesión técnica independiente por dispositivo | `id`, `actor_id`, `auth_session_id`, `label`, `created_at`, `last_seen_at`, `idle_expires_at`, `absolute_expires_at`, `revoked_at?` |
| `PrivateAccessCode` | código privado no legible | `profile_id`, `key_version`, `secret_digest`, `created_at`, `rotated_at?`, `revoked_at?` |
| `QrGrant` | concesión QR de un solo uso | `id`, `profile_id`, `token_hash`, `issued_by_actor`, `audience`, `issued_at`, `expires_at`, `consumed_at?`, `consumed_by_actor?` |
| `ImpersonationSession` | contexto administrativo efectivo | `id`, `admin_actor_id`, `effective_profile_id`, `aal`, `started_at`, `ended_at?` |
| `TechnicalAuditEvent` | espejo local append-only del ledger externo | `id`, `external_sequence`, `event_phase=intent\|outcome\|reconciliation`, `canonical_encoding_version`, `original_actor_id`, `effective_profile_id?`, `impersonation_session_id?`, `action`, `target_type`, `target_id`, `result`, `request_id`, `previous_hash`, `record_hash`, `external_receipt`, `retention_class`, `created_at` |
| `AuditOutbox` | finalización idempotente del resultado externo | `id`, `intent_sequence`, `request_id`, `schema_version`, `outcome_status=success\|failure\|partial`, `error_code?`, `target_hash`, `mutation_hash`, `occurred_at`, `status=pending\|delivered\|failed`, `attempts`, `next_attempt_at?`, `delivered_sequence?` |
| `AuditDeletionJob` | borrado excepcional de un rango administrativo | `id`, `from_sequence`, `to_sequence`, `hash_before_range`, `terminal_record_hash`, `ordered_manifest_hash`, `intent_receipt_sequence?`, `complete_receipt_sequence?`, `status=prepared\|intent_recorded\|deleting\|verified\|failed`, `confirmed_by`, `created_at`, `completed_at?` |
| `AuditRangeTombstone` | recibo externo que permite verificar un hueco borrado | `id`, `stream=admin-audit`, `from_sequence`, `to_sequence`, `hash_before_range`, `terminal_record_hash`, `ordered_manifest_hash`, `deletion_job_id`, `intent_sequence`, `complete_sequence?`, `created_at`, `completed_at?` |
| `DeletionJob` | purga idempotente y reanudable que sobrevive al perfil | `id`, `profile_id?`, `profile_marker`, `request_handle_hash`, `requester_actor_id?`, `status=queued\|ledger_recorded\|purging\|purged\|failed`, `requested_at`, `confirmed_by`, `ledger_record_id?`, `attempts`, `last_error_code?`, `completed_at?` |
| `DeletionTombstone` | registro externo que excluye restores | `id`, `profile_marker`, `marker_key_version`, `sequence`, `previous_hash`, `record_hash`, `deleted_at`, `deletion_job_id`, `remote_object_ref` |

El alias nunca es secreto ni credencial. El código privado se almacena solo
como hash. Un QR no incluye datos de salud ni el código permanente.
`Actor.auth_subject` tiene restricción `NOT NULL UNIQUE` y solo se crea o recupera
mediante una función confiable que deriva el sujeto de `auth.uid()`; nunca
acepta ese valor desde el payload del cliente. `ProfileAccess` tiene índice
único parcial para `(profile_id, actor_id)` mientras `revoked_at IS NULL`, y
`PrivateAccessCode` para un perfil tiene como máximo una revisión activa.
Cada identidad Auth representa un único dispositivo lógico y tiene como máximo
una `DeviceSession` activa; varias pestañas del mismo navegador comparten esa
identidad y sesión. Cerrar o vencer globalmente ese actor revoca todas sus
membresías y todos sus refresh tokens, mientras revocar un perfil solo elimina
la membresía correspondiente.
`DeletionTombstone` pertenece al ledger de continuidad externo descrito en
[`ADR-0007`](../adr/0007-independent-continuity-ledger.md), no a la base que
puede retroceder durante un restore.

### Integridad relacional mínima

- `Actor.auth_subject` es UUID `NOT NULL UNIQUE`.
- `ProfileAccess.profile_id/actor_id`, `DeviceSession.actor_id/auth_session_id`,
  `PrivateAccessCode.profile_id`, `QrGrant.profile_id/token_hash` e
  `Invitation.token_hash` son `NOT NULL`; salvo las excepciones de borrado
  explícitas siguientes, todos los IDs referencian su entidad con FK
  restrictiva y los hashes/IDs de sesión tienen unicidad aplicable.
- `DeletionJob.profile_id` usa `ON DELETE SET NULL`: antes de purgar conserva
  `profile_marker` y `request_handle_hash`; al borrar `Profile`, el job terminal
  persiste sin datos recuperables. `requester_actor_id` también puede quedar
  nulo si se elimina la identidad huérfana.
- Solo existe una `DeviceSession` activa por `Actor`; `auth_session_id` es
  único. La sesión activa exige actor habilitado y límites idle/absoluto
  vigentes.
- Invitación cumple `expires_at > created_at`; sesión cumple
  `idle_expires_at > created_at` y `absolute_expires_at > created_at`; QR
  cumple `expires_at > issued_at`;
  `consumed_at` y `revoked_at` nunca preceden creación/emisión.
- Estados se limitan con `CHECK`/enum y una transición terminal no puede volver
  a un estado anterior.
- `AuditOutbox` no contiene JSON libre: su schema técnico cerrado ocupa como
  máximo 4 KiB, solo admite status/error allowlisted, hashes SHA-256, IDs opacos
  y timestamps. Nunca incluye texto de usuario, salud, medicación, body,
  headers, handle de exportación, token, QR/código o prompt.

### Contexto y seguimiento

| Entidad | Propósito | Campos mínimos |
|---|---|---|
| `ContextDraft` | respuestas parciales del asistente | `id`, `profile_id`, `schema_version`, `status`, `answers`, `updated_at` |
| `ContextSnapshot` | contexto normalizado inmutable usado en generación | `id`, `profile_id`, `source_draft_id`, `effective_at`, `answers`, `normalization_version` |
| `ConditionRecord` | condición clínica/fisiológica declarada | `id`, `snapshot_id`, `term_id`, `status`, `onset?`, `confidence` |
| `MedicationRecord` | medicamento declarado | `id`, `snapshot_id`, `aemps_id?`, `name_entered`, `dose?`, `frequency?`, `route?`, `schedule?`, `confidence` |
| `LabObservation` | valor manual contextual | `id`, `profile_id`, `analyte`, `value`, `unit`, `reference_range?`, `measured_at?`, `source`, `confidence` |
| `FollowUpEntry` | revisión semanal o detalle diario | `id`, `profile_id`, `scope`, `observed_at`, `values`, `completeness` |
| `ChangeEvent` | dato que puede recalcular | `id`, `profile_id`, `kind`, `payload`, `effective_at`, `impact_status` |

`ContextSnapshot` congela lo que el motor vio. Editar el borrador no cambia un
plan histórico.

### Generación y planes

| Entidad | Propósito | Campos mínimos |
|---|---|---|
| `Plan` | raíz de una línea de versiones | `id`, `profile_id`, `active_version_id?`, `created_at` |
| `PlanVersion` | resultado inmutable | `id`, `plan_id`, `status`, `completeness`, `validation_status`, `context_snapshot_id`, `engine_version`, `rule_set_revision_id`, `source_manifest_id`, `input_hash`, `output_hash`, `created_at`, `validated_at?`, `activated_at?`, `activated_by?` |
| `PlanCandidate` | propuesta pendiente de revisión | `id`, `plan_id`, `base_version_id?`, `candidate_version_id`, `impact`, `diff`, `validation`, `status=pending\|activated\|discarded\|invalid`, `created_at`, `resolved_at?` |
| `ModuleResult` | resultado por módulo | `id`, `plan_version_id`, `module`, `status`, `confidence`, `payload`, `uncertainties` |
| `SafetyFinding` | hallazgo presentado o interno | `id`, `plan_version_id`, `module`, `action_level`, `code`, `message_key`, `evidence_ref` |
| `PlanAdjustment` | cambio controlado aceptado | `id`, `candidate_id`, `kind`, `payload`, `confirmed_at`, `confirmed_by` |

Estados de `PlanVersion`: `draft`, `active`, `archived`. La completitud es
independiente: `complete` o `provisional`. Un plan puede estar `active` y ser
provisional.

Módulos válidos: `nutrition`, `training`, `hydration`, `sleep`, `mobility`,
`supplements`. `training` admite `generated`, `own` y `none`; con `none` no se
generan prescripciones de entrenamiento. `shopping` no es un módulo: es una
proyección dependiente de una versión con nutrición válida.

### Reglas, evidencia y operación

| Entidad | Propósito | Campos mínimos |
|---|---|---|
| `DecisionRule` | identidad estable de una regla | `id`, `scope`, `kind`, `created_at` |
| `RuleRevision` | contenido versionado | `id`, `rule_id`, `version`, `trigger`, `effect`, `evidence_refs`, `status=draft\|active\|superseded`, `effective_from`, `reviewed_at`, `approved_by?` |
| `RuleSetRevision` | conjunto activable y congelable | `id`, `version`, `rule_revision_ids`, `status`, `activated_at?`, `activated_by?` |
| `EvidenceReference` | procedencia científica | `id`, `citation`, `evidence_type`, `population`, `applicability`, `reviewed_at` |
| `AIProviderRevision` | configuración aprobada del proveedor | `id`, `provider`, `endpoint_id`, `model`, `processing_region`, `retention_mode`, `training_use`, `timeout_ms`, `retry_policy`, `pricing_fx_revision_id`, `minimization_policy_version`, `status`, `approved_at?`, `approved_by?` |
| `PricingFxRevision` | precio y conversión reproducibles | `id`, `provider`, `provider_currency`, `price_schedule`, `fx_to_eur`, `source_refs`, `source_manifest_id`, `observed_at`, `effective_from`, `expires_at`, `decimal_precision`, `canonical_hash`, `status=draft\|active\|superseded`, `approved_at?`, `approved_by?` |
| `AIExplanation` | texto no normativo | `id`, `plan_version_id`, `provider_revision_id`, `prompt_version`, `prompt_hash`, `schema_version`, `policy_version`, `input_manifest_hash`, `output_segments`, `created_at` |
| `AIBudgetMonth` | contador mensual bloqueable en EUR | `month`, `cap_eur=10.00`, `settled_eur`, `reserved_upper_bound_eur`, `version`, `updated_at` |
| `AIUsageEvent` | reserva y liquidación idempotente de gasto | `id`, `profile_id`, `month`, `provider_revision_id`, `pricing_fx_revision_id`, `provider_currency`, `estimated_provider_cost`, `estimated_eur`, `reserved_upper_bound_eur`, `actual_provider_cost?`, `actual_eur?`, `status=reserved\|pending_reconciliation\|settled\|released\|rejected\|provider_cost_anomaly`, `idempotency_key`, `request_id`, `created_at`, `settled_at?` |
| `BackupJob` | copia lógica completa | `id`, `kind=weekly\|precritical`, `database_manifest_hash`, `storage_manifest_hash`, `encryption_algorithm`, `wrapped_data_key`, `key_version`, `status`, `started_at`, `completed_at?` |
| `RestoreJob` | restauración aislada | `id`, `backup_job_id`, `status`, `continuity_ledger_hash`, `audit_range_manifest_hash`, `tombstones_applied_at?`, `verified_at?`, `promoted_at?`, `actor_id` |

`AIBudgetMonth.cap_eur` tiene `CHECK (cap_eur = 10.00)` en V1 y no es editable
desde una operación ordinaria. Cambiarlo exige migración, ADR y repetir las
pruebas de presupuesto. La reserva que participa en el corte es el coste
máximo contractual de la petición —calculado con límites máximos de
entrada/salida, precios y FX aprobados—, no una media optimista. Un timeout o
fallo de conexión conserva la reserva como `pending_reconciliation` hasta
obtener evidencia de cargo o no cargo; nunca se libera por mera ausencia de
respuesta.

### Datos nutricionales y comerciales

| Entidad | Propósito | Campos mínimos |
|---|---|---|
| `CanonicalFood` | alimento genérico canónico | `id`, `name`, `category`, `state`, `edible_part`, `aliases`, `active` |
| `FoodCompositionRevision` | valores nutricionales con procedencia | `id`, `canonical_food_id`, `basis`, `state`, `edible_part`, `method`, `nutrients`, `source_ref`, `source_version`, `observed_at`, `confidence`, `status` |
| `EffectiveFoodRevision` | selección efectiva por contexto | `canonical_food_id`, `resolution_context`, `revision_id`, `precedence_reason`, `activated_at`, `approved_by` |
| `SourceManifest` | inventario verificable usado por una revisión o plan | `id`, `source_ref`, `license_status`, `version`, `retrieved_at`, `transformations`, `coverage`, `raw_content_hash`, `normalized_content_hash`, `hash_algorithm`, `canonicalization_version`, `reviewer` |
| `CommercialProduct` | identidad estable de producto de marca o supermercado | `id`, `barcode_gtin?`, `chain?`, `created_at`, `active_revision_id?` |
| `CommercialProductRevision` | etiqueta/formato/precio versionados | `id`, `commercial_product_id`, `name`, `format`, `package_quantity`, `base_price`, `availability`, `ingredients?`, `allergen_state`, `nutrition_label?`, `observed_at`, `catalog_revision_id?`, `source_manifest_id`, `status=quarantined\|confirmed\|published\|superseded`, `created_at` |
| `BarcodeCorrection` | corrección versionada de etiqueta | `id`, `barcode_gtin`, `commercial_product_revision_id`, `scope=profile\|global`, `owner_profile_id?`, `proposed_by_actor_id`, `fields`, `evidence`, `status=profile_confirmed\|global_approved\|rejected\|superseded`, `supersedes_id?`, `created_at`, `approved_by?`, `approved_at?` |
| `MatchingRule` | relación canónico-SKU | `id`, `canonical_food_id`, `rule_version`, `aliases`, `exclusions`, `accepted_states`, `match_state`, `review_reason`, `active` |
| `CatalogRevision` | lote versionado de cadena | `id`, `chain`, `source_location_internal`, `collected_at`, `catalog_version`, `quality`, `publication_state`, `source_manifest_id`, `capture_evidence_ref` |
| `CatalogPublication` | revisión visible | `id`, `catalog_revision_id`, `published_at`, `hidden_at?`, `activation_note` |

Estados de compatibilidad: `exact`, `allowed`, `review`, `excluded`,
`insufficient`. La fuente del supermercado no sustituye la composición
nutricional canónica del plan.

Una corrección `profile_confirmed` requiere `owner_profile_id` y solo se
resuelve para ese perfil mediante RLS. La aprobación administrativa no muta la
propuesta: crea una nueva revisión `global_approved` que la referencia. La
precedencia para un GTIN es: corrección confirmada del perfil solicitante,
corrección global aprobada, etiqueta de producto confirmada y, por último,
fuente comercial importada.

### Compra y exportación

| Entidad | Propósito | Campos mínimos |
|---|---|---|
| `ShoppingPreferenceRevision` | supermercado habitual y modo versionados | `id`, `profile_id`, `preferred_chain`, `compare_multistore`, `sorting`, `created_at`, `supersedes_id?` |
| `ShoppingSnapshot` | lista calculada para una versión | `id`, `plan_version_id`, `week_start`, `chain_mode`, `items`, `coverage`, `estimated_total`, `generated_at` |
| `LeftoverConfirmation` | sobrante confirmado por usuario | `shopping_snapshot_id`, `product_id`, `quantity`, `confirmed_at` |
| `ExportArtifact` | PDF, impresión o hoja editable | `id`, `plan_version_id`, `mode`, `format`, `storage_ref`, `created_at`, `expires_at?` |

## 2. Invariantes de dominio

1. Solo perfiles adultos; el asistente no puede cerrar un perfil sin edad
   declarada de 18 años o más.
2. El alias normalizado es único entre perfiles `active` o
   `deletion_requested`. Al completar `DeletionJob.status=purged`, la misma
   operación elimina la fila `Profile` y libera el alias; `purged` no es un
   estado persistente del perfil. El alias nunca sustituye al secreto.
3. Un perfil tiene como máximo una versión integrada `active`.
4. `active_version_id` debe apuntar a una versión validada; una versión
   `provisional` puede activarse, una inválida no.
5. Toda versión activa conserva contexto, reglas, fuentes, catálogo y
   configuración del motor usados para producirla.
6. Una operación estructural nunca muta una versión activa: crea candidato.
7. Un módulo no seleccionado no produce prescripción ni métricas fingidas.
8. `training=none` no puede contener sesiones de entrenamiento.
9. Una sustitución alimentaria debe conservar la función declarada y
   recalcular kcal, macros, fibra y nutrientes relevantes.
10. Una alergia incluye contaminación cruzada y excluye producto con riesgo
   desconocido; una intolerancia registra tolerancia y gravedad.
11. El SKU comercial no cambia los valores nutricionales del plan; solo envase,
    precio, disponibilidad y sobrante.
12. Solo existe una regla canónica activa por SKU. La ambigüedad permanece en
    `review`.
13. Un actor representa un dispositivo lógico y puede tener varias membresías
    de perfil. Revocar una membresía no invalida las demás. El cierre global o
    expiración del actor revoca todas sus membresías y todos sus refresh
    tokens; una identidad Auth solo se elimina cuando no conserva membresía ni
    rol administrativo.
14. Una corrección de código de barras confirmada se reutiliza inmediatamente
    solo dentro de su perfil propietario. No se comparte hasta que el
    superadministrador cree una revisión global aprobada e inmutable.
15. Un QR se consume una sola vez y caduca; su payload opaco no es una URL y
    solo se acepta en el cuerpo de una petición autorizada.
16. `deletion_requested` bloquea lectura de datos, generación, edición y
    exportación ordinarias; solo expone el estado mínimo de la solicitud.
17. Un `DeletionJob` no vuelve a `active`: ante fallo permanece bloqueado y se
    reanuda hasta completar la purga. Su fila terminal sobrevive con
    `profile_id=NULL`, marcador mínimo y handle técnico, sin depender de la
    fila `Profile`.
18. El tombstone se escribe en el ledger de continuidad independiente antes de
    purgar y no conserva alias, condiciones ni contenido recuperable.
19. Una restauración no se promueve si no ha cargado y verificado el último
    ledger externo. Un hueco de `admin-audit` solo es válido cuando coincide
    exactamente con un `AuditRangeTombstone` completado y firmado.
20. El motor determinista es la autoridad; Luna no puede escribir resultados
    normativos ni activar planes.
21. Luna permanece desactivada si no existen `AIProviderRevision` y
    `PricingFxRevision` aprobadas y vigentes. Cada llamada reserva atómicamente
    su cota máxima en EUR y solo comienza si
    `settled_eur + reserved_upper_bound_eur + new_upper_bound_eur <= 10`.
    Liquidar, reconciliar o liberar es idempotente; un coste superior a la cota
    activa `provider_cost_anomaly`, bloquea llamadas posteriores y nunca se
    oculta ajustando el contador.
22. Existe una única línea de plan integrada por perfil; solo contiene
    resultados de los módulos seleccionados.
23. Un candidato siempre apunta a una versión candidata inmutable y, salvo la
    primera generación, a una versión base.
24. Una cesta solo puede generarse desde una versión con resultado
    `nutrition` válido.
25. `Actor.auth_subject`, membresía activa actor-perfil y código activo por
    perfil son únicos; un rol o una membresía nunca puede ser creado por el
    propio cliente.
26. `TechnicalAuditEvent` no admite actualización ni borrado por la ruta
    operativa. Cada fila verifica el recibo, secuencia total y hash del stream
    externo; una acción privilegiada no comienza si no puede persistir primero
    su evento `intent`. El borrado excepcional de un rango usa manifiesto,
    recibos externo de intención/finalización y nunca convierte un hueco no
    cubierto en una cadena válida.

## 3. Versionado y concurrencia

- `schema_version` identifica la forma del documento.
- `engine_version`, `rule_set_revision_id`, `source_manifest_id`,
  `input_hash` y `output_hash` se guardan en cada versión.
- Salvo HMAC o firma expresamente documentados, todos los hashes de integridad
  usan SHA-256 sobre bytes UTF-8 de la serialización canónica versionada:
  claves ordenadas, Unicode NFC, fechas ISO-8601, decimales normalizados y
  exclusión explícita de timestamps de transporte, IDs de petición y otros
  campos volátiles. Cada registro conserva algoritmo y versión de
  canonicalización.
- La explicación Luna conserva revisión de proveedor, modelo,
  `prompt_version`, `prompt_hash` y schema; nunca el prompt completo y no forma
  parte del hash normativo.
- Las escrituras del mismo agregado usan `expected_version` o ETag lógico; un
  conflicto devuelve `409` y obliga a recargar, nunca a sobrescribir.
- Un plan histórico es inmutable. Las correcciones futuras generan nuevas
  revisiones y nuevos candidatos.
