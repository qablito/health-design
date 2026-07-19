select no_plan();

begin;

insert into auth.users (
  instance_id, id, aud, role, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at, is_anonymous
) values (
  '00000000-0000-0000-0000-000000000000',
  '00000000-0000-4000-8000-000000007101',
  'authenticated', 'authenticated',
  '{"provider":"anonymous","providers":["anonymous"]}'::jsonb,
  '{}'::jsonb, now(), now(), true
);

insert into auth.sessions (id, user_id, created_at, updated_at, aal)
values (
  '21000000-0000-4000-8000-000000007101',
  '00000000-0000-4000-8000-000000007101', now(), now(), 'aal1'
);

insert into public.actors (id, auth_subject)
values (
  '31000000-0000-4000-8000-000000007101',
  '00000000-0000-4000-8000-000000007101'
);

insert into public.profiles (id, alias, timezone, adult_attested_at)
values (
  '51000000-0000-4000-8000-000000007101',
  'Planes Test', 'Europe/Madrid', now()
);

insert into public.profile_access (id, profile_id, actor_id)
values (
  '61000000-0000-4000-8000-000000007101',
  '51000000-0000-4000-8000-000000007101',
  '31000000-0000-4000-8000-000000007101'
);

insert into public.device_sessions (
  id, actor_id, auth_session_id, label, created_at, last_seen_at,
  idle_expires_at, absolute_expires_at
) values (
  '41000000-0000-4000-8000-000000007101',
  '31000000-0000-4000-8000-000000007101',
  '21000000-0000-4000-8000-000000007101',
  'Plan lifecycle', now(), now(), now() + interval '30 days',
  now() + interval '180 days'
);

insert into public.questionnaire_drafts (
  id, profile_id, schema_version, version, status, completeness, answers,
  confirmed_block_ids, current_block_id, uncertainties, hard_errors
) values (
  '71000000-0000-4000-8000-000000007101',
  '51000000-0000-4000-8000-000000007101',
  2, 1, 'submitted', 'provisional',
  '{"activeModules":["nutrition","hydration"],"age":35,"weightKg":82}'::jsonb,
  array['core', 'modules', 'summary'], 'summary',
  '[{"answerId":"heightCm","affectedModules":["nutrition","hydration"]}]'::jsonb,
  '[]'::jsonb
);

select ok(
  to_regclass('public.context_snapshots') is not null
  and to_regclass('public.plans') is not null
  and to_regclass('public.plan_versions') is not null
  and to_regclass('public.plan_candidates') is not null
  and to_regclass('public.change_events') is not null
  and to_regclass('public.safety_findings') is not null,
  'el esquema expone todas las entidades persistentes de T7'
);

select ok(
  not has_table_privilege('authenticated', 'public.context_snapshots', 'SELECT')
  and not has_table_privilege('authenticated', 'public.plan_versions', 'SELECT')
  and has_table_privilege('service_role', 'public.context_snapshots', 'SELECT')
  and not has_table_privilege('service_role', 'public.context_snapshots', 'INSERT')
  and has_table_privilege('service_role', 'public.plan_versions', 'SELECT'),
  'las tablas sanitarias solo exponen lecturas mínimas al servicio'
);

create temporary table first_snapshot as
select public.internal_create_context_snapshot(
  '00000000-0000-4000-8000-000000007101',
  '21000000-0000-4000-8000-000000007101',
  '51000000-0000-4000-8000-000000007101',
  1,
  'normalization-v1', 'canonical-json-v1',
  decode(repeat('11', 32), 'hex'),
  decode(repeat('12', 32), 'hex'),
  decode(repeat('13', 32), 'hex')
) as response;

select is(
  (select response ->> 'completeness' from first_snapshot),
  'provisional',
  'el snapshot conserva la completitud del borrador enviado'
);

select is(
  (
    select answers ->> 'weightKg'
    from public.context_snapshots
    where id = (select (response ->> 'id')::uuid from first_snapshot)
  ),
  '82',
  'el snapshot congela las respuestas que vio el motor'
);

select is(
  public.internal_get_context_snapshot(
    '00000000-0000-4000-8000-000000007101',
    '21000000-0000-4000-8000-000000007101',
    '51000000-0000-4000-8000-000000007101',
    (select (response ->> 'id')::uuid from first_snapshot)
  ) -> 'answers' ->> 'weightKg',
  '82',
  'el motor puede leer el snapshot congelado sin consultar el borrador vivo'
);

select throws_ok(
  $$
    update public.context_snapshots
    set answers = '{"weightKg":1}'::jsonb
    where profile_id = '51000000-0000-4000-8000-000000007101'
  $$,
  '55000',
  'immutable_context_snapshot',
  'un snapshot no se puede modificar después de crearlo'
);

select is(
  public.internal_create_context_snapshot(
    '00000000-0000-4000-8000-000000007101',
    '21000000-0000-4000-8000-000000007101',
    '51000000-0000-4000-8000-000000007101',
    1,
    'normalization-v1', 'canonical-json-v1',
    decode(repeat('11', 32), 'hex'),
    decode(repeat('12', 32), 'hex'),
    decode(repeat('13', 32), 'hex')
  ),
  (select response from first_snapshot),
  'repetir una creación con la misma clave devuelve el mismo snapshot'
);

select throws_ok(
  $$
    select public.internal_create_context_snapshot(
      '00000000-0000-4000-8000-000000007101',
      '21000000-0000-4000-8000-000000007101',
      '51000000-0000-4000-8000-000000007101',
      2, 'normalization-v1', 'canonical-json-v1',
      decode(repeat('11', 32), 'hex'),
      decode(repeat('16', 32), 'hex'),
      decode(repeat('17', 32), 'hex')
    )
  $$,
  'PT409',
  'version_conflict',
  'un expected_version obsoleto no congela un borrador diferente'
);

select throws_ok(
  $$
    select public.internal_create_context_snapshot(
      '00000000-0000-4000-8000-000000007101',
      '21000000-0000-4000-8000-000000007101',
      '51000000-0000-4000-8000-000000007101',
      1,
      'normalization-v1', 'canonical-json-v1',
      decode(repeat('14', 32), 'hex'),
      decode(repeat('12', 32), 'hex'),
      decode(repeat('15', 32), 'hex')
    )
  $$,
  '23505',
  'idempotency_key_reused',
  'una clave idempotente no puede representar otro snapshot'
);

create temporary table first_plan as
select public.internal_create_plan_draft(
  '00000000-0000-4000-8000-000000007101',
  '21000000-0000-4000-8000-000000007101',
  '51000000-0000-4000-8000-000000007101',
  (select (response ->> 'id')::uuid from first_snapshot),
  'engine-contract-v1',
  'plan-canonical-v1',
  '81000000-0000-4000-8000-000000007101',
  '82000000-0000-4000-8000-000000007101',
  decode(repeat('21', 32), 'hex'),
  decode(repeat('22', 32), 'hex'),
  'complete',
  'valid', '{"checks":["structure"],"completeness":"complete"}'::jsonb,
  '[{"module":"nutrition","status":"valid","confidence":"medium","payload":{"days":7},"uncertainties":[]}]'::jsonb,
  '[{"module":"hydration","actionLevel":"information","code":"HYDRATION_CONTEXT","messageKey":"plan.hydration.context","evidenceRef":"rule:hydration-v1"}]'::jsonb,
  decode(repeat('23', 32), 'hex'),
  decode(repeat('24', 32), 'hex')
) as response;

select is(
  (select response ->> 'status' from first_plan),
  'draft',
  'la primera generación crea un borrador'
);

select is(
  (select response ->> 'validationStatus' from first_plan),
  'valid',
  'el borrador guarda la validación normativa recibida del motor'
);

select is(
  (select response ->> 'completeness' from first_plan),
  'provisional',
  'la completitud provisional es independiente del estado draft'
);

select is(
  (
    select canonicalization_version
    from public.plan_versions
    where id = (select (response ->> 'planVersionId')::uuid from first_plan)
  ),
  'plan-canonical-v1',
  'la versión conserva la canonicalización declarada por el motor'
);

select is(
  (
    select count(*)
    from public.module_results
    where plan_version_id =
      (select (response ->> 'planVersionId')::uuid from first_plan)
  ),
  1::bigint,
  'los resultados modulares quedan ligados a la versión inmutable'
);

select is(
  (
    select count(*)
    from public.safety_findings
    where plan_version_id =
      (select (response ->> 'planVersionId')::uuid from first_plan)
  ),
  1::bigint,
  'los hallazgos de seguridad quedan ligados a la versión'
);

select is(
  (
    select active_version_id::text
    from public.plans
    where id = (select (response ->> 'planId')::uuid from first_plan)
  ),
  null,
  'generar no activa el plan de manera implícita'
);

create temporary table first_activation as
select public.internal_activate_plan_version(
  '00000000-0000-4000-8000-000000007101',
  '21000000-0000-4000-8000-000000007101',
  (select (response ->> 'planId')::uuid from first_plan),
  (select (response ->> 'planVersionId')::uuid from first_plan),
  1,
  decode(repeat('31', 32), 'hex'),
  decode(repeat('32', 32), 'hex')
) as response;

select is(
  (select response ->> 'status' from first_activation),
  'active',
  'una operación manual activa el primer borrador válido'
);

select is(
  (select (response ->> 'aggregateVersion')::integer from first_activation),
  2,
  'la activación incrementa la versión optimista del agregado'
);

select is(
  public.internal_activate_plan_version(
    '00000000-0000-4000-8000-000000007101',
    '21000000-0000-4000-8000-000000007101',
    (select (response ->> 'planId')::uuid from first_plan),
    (select (response ->> 'planVersionId')::uuid from first_plan),
    1,
    decode(repeat('31', 32), 'hex'),
    decode(repeat('32', 32), 'hex')
  ),
  (select response from first_activation),
  'repetir una activación devuelve el recibo original sin reactivar'
);

select ok(
  exists (
    select 1
    from private.plan_idempotency
    where operation = 'version-activate' and expires_at is null
  ),
  'el recibo idempotente de activación no caduca'
);

select throws_ok(
  $$
    select public.internal_activate_plan_version(
      '00000000-0000-4000-8000-000000007101',
      '21000000-0000-4000-8000-000000007101',
      (select (response ->> 'planId')::uuid from first_plan),
      (select (response ->> 'planVersionId')::uuid from first_plan),
      1,
      decode(repeat('33', 32), 'hex'),
      decode(repeat('34', 32), 'hex')
    )
  $$,
  'PT409',
  'version_conflict',
  'una activación con expected_version obsoleto no sobrescribe estado'
);

update public.questionnaire_drafts
set version = 2,
    completeness = 'complete',
    answers = '{"activeModules":["nutrition","hydration"],"age":35,"weightKg":80,"heightCm":178}'::jsonb,
    updated_at = clock_timestamp()
where profile_id = '51000000-0000-4000-8000-000000007101';

create temporary table second_snapshot as
select public.internal_create_context_snapshot(
  '00000000-0000-4000-8000-000000007101',
  '21000000-0000-4000-8000-000000007101',
  '51000000-0000-4000-8000-000000007101',
  2,
  'normalization-v1', 'canonical-json-v1',
  decode(repeat('41', 32), 'hex'),
  decode(repeat('42', 32), 'hex'),
  decode(repeat('43', 32), 'hex')
) as response;

create temporary table valid_candidate as
select public.internal_create_plan_candidate(
  '00000000-0000-4000-8000-000000007101',
  '21000000-0000-4000-8000-000000007101',
  (select (response ->> 'planId')::uuid from first_plan),
  2,
  (select (response ->> 'planVersionId')::uuid from first_plan),
  (select (response ->> 'id')::uuid from second_snapshot),
  'context_changed', '{"changedFields":["heightCm","weightKg"]}'::jsonb,
  'dependent_modules',
  '{"changedFields":["heightCm","weightKg"],"affectedModules":["nutrition","hydration"]}'::jsonb,
  'engine-contract-v1',
  'plan-canonical-v1',
  '81000000-0000-4000-8000-000000007101',
  '82000000-0000-4000-8000-000000007101',
  decode(repeat('44', 32), 'hex'),
  decode(repeat('45', 32), 'hex'),
  'provisional',
  'valid', '{"checks":["structure","constraints"],"completeness":"provisional"}'::jsonb,
  '[{"module":"nutrition","status":"valid","confidence":"high","payload":{"days":7},"uncertainties":[]}]'::jsonb,
  '[]'::jsonb,
  decode(repeat('46', 32), 'hex'),
  decode(repeat('47', 32), 'hex')
) as response;

select is(
  (select response ->> 'candidateStatus' from valid_candidate),
  'pending',
  'un cambio posterior crea un candidato pendiente'
);

select is(
  (select response ->> 'impact' from valid_candidate),
  'dependent_modules',
  'el candidato conserva el impacto estructurado'
);

select is(
  (
    select active_version_id::text
    from public.plans
    where id = (select (response ->> 'planId')::uuid from first_plan)
  ),
  (select response ->> 'planVersionId' from first_plan),
  'crear un candidato no cambia la versión activa'
);

select is(
  (
    select impact_status
    from public.change_events
    where id = (select (response ->> 'changeEventId')::uuid from valid_candidate)
  ),
  'dependent_modules',
  'el evento de cambio queda enlazado con su impacto'
);

create temporary table candidate_activation as
select public.internal_activate_plan_candidate(
  '00000000-0000-4000-8000-000000007101',
  '21000000-0000-4000-8000-000000007101',
  (select (response ->> 'candidateId')::uuid from valid_candidate),
  3,
  decode(repeat('51', 32), 'hex'),
  decode(repeat('52', 32), 'hex')
) as response;

select is(
  (select response ->> 'candidateStatus' from candidate_activation),
  'activated',
  'la activación del candidato es explícita y manual'
);

select is(
  (
    select status
    from public.plan_versions
    where id = (select (response ->> 'planVersionId')::uuid from first_plan)
  ),
  'archived',
  'activar el candidato archiva atómicamente la versión anterior'
);

select is(
  (
    select completeness || ':' || status
    from public.plan_versions
    where id = (select (response ->> 'planVersionId')::uuid from valid_candidate)
  ),
  'provisional:active',
  'la completitud provisional del motor prevalece aunque el snapshot esté completo'
);

select throws_ok(
  $$
    select public.internal_create_plan_candidate(
      '00000000-0000-4000-8000-000000007101',
      '21000000-0000-4000-8000-000000007101',
      (select (response ->> 'planId')::uuid from first_plan),
      4,
      (select (response ->> 'planVersionId')::uuid from valid_candidate),
      (select (response ->> 'id')::uuid from second_snapshot),
      'context_changed', '{"changedFields":["weightKg"]}'::jsonb,
      'module_only',
      '{"changedFields":["weightKg"],"affectedModules":["nutrition"]}'::jsonb,
      'engine-contract-v1', 'plan-canonical-v1',
      '81000000-0000-4000-8000-000000007101',
      '82000000-0000-4000-8000-000000007101',
      decode(repeat('54', 32), 'hex'), decode(repeat('55', 32), 'hex'),
      'complete',
      'valid', '{"completeness":"provisional"}'::jsonb,
      '[{"module":"nutrition","status":"valid","confidence":"high","payload":{},"uncertainties":[]}]'::jsonb,
      '[]'::jsonb,
      decode(repeat('56', 32), 'hex'), decode(repeat('57', 32), 'hex')
    )
  $$,
  '22023',
  'invalid_input',
  'la RPC rechaza una completitud del motor incoherente con su validación'
);

select throws_ok(
  $$
    insert into public.plan_versions (
      id, plan_id, ordinal, status, completeness, validation_status, validation,
      context_snapshot_id, engine_version, rule_set_revision_id,
      source_manifest_id, input_hash, output_hash, canonicalization_version
    ) values (
      '74000000-0000-4000-8000-000000007197',
      (select (response ->> 'planId')::uuid from first_plan),
      97, 'draft', 'complete', 'valid', '{}'::jsonb,
      (select (response ->> 'id')::uuid from second_snapshot),
      'engine-contract-v1',
      '81000000-0000-4000-8000-000000007197',
      '82000000-0000-4000-8000-000000007197',
      decode(repeat('58', 32), 'hex'), decode(repeat('59', 32), 'hex'),
      'plan-canonical-v1'
    )
  $$,
  '23514',
  'invalid_engine_completeness',
  'la persistencia falla cerrada si falta la completitud del motor'
);

select throws_ok(
  $$
    insert into public.plan_versions (
      id, plan_id, ordinal, status, completeness, validation_status, validation,
      context_snapshot_id, engine_version, rule_set_revision_id,
      source_manifest_id, input_hash, output_hash, canonicalization_version
    ) values (
      '74000000-0000-4000-8000-000000007198',
      (select (response ->> 'planId')::uuid from first_plan),
      99, 'draft', 'complete', 'valid',
      '{"completeness":"unknown"}'::jsonb,
      (select (response ->> 'id')::uuid from second_snapshot),
      'engine-contract-v1',
      '81000000-0000-4000-8000-000000007198',
      '82000000-0000-4000-8000-000000007198',
      decode(repeat('48', 32), 'hex'), decode(repeat('49', 32), 'hex'),
      'plan-canonical-v1'
    )
  $$,
  '23514',
  'invalid_engine_completeness',
  'la base rechaza una completitud del motor fuera del contrato'
);

update public.questionnaire_drafts
set version = 3,
    answers = answers || '{"weightKg":79}'::jsonb,
    updated_at = clock_timestamp()
where profile_id = '51000000-0000-4000-8000-000000007101';

create temporary table third_snapshot as
select public.internal_create_context_snapshot(
  '00000000-0000-4000-8000-000000007101',
  '21000000-0000-4000-8000-000000007101',
  '51000000-0000-4000-8000-000000007101',
  3,
  'normalization-v1', 'canonical-json-v1',
  decode(repeat('61', 32), 'hex'),
  decode(repeat('62', 32), 'hex'),
  decode(repeat('63', 32), 'hex')
) as response;

create temporary table invalid_candidate as
select public.internal_create_plan_candidate(
  '00000000-0000-4000-8000-000000007101',
  '21000000-0000-4000-8000-000000007101',
  (select (response ->> 'planId')::uuid from first_plan),
  4,
  (select (response ->> 'planVersionId')::uuid from valid_candidate),
  (select (response ->> 'id')::uuid from third_snapshot),
  'context_changed', '{"changedFields":["weightKg"]}'::jsonb,
  'module_only',
  '{"changedFields":["weightKg"],"affectedModules":["nutrition"]}'::jsonb,
  'engine-contract-v1',
  'plan-canonical-v1',
  '81000000-0000-4000-8000-000000007101',
  '82000000-0000-4000-8000-000000007101',
  decode(repeat('64', 32), 'hex'),
  decode(repeat('65', 32), 'hex'),
  'provisional',
  'invalid', '{"errors":["constraint_failed"],"completeness":"provisional"}'::jsonb,
  '[]'::jsonb,
  '[{"module":"nutrition","actionLevel":"immediate_conservative","code":"CONSTRAINT_FAILED","messageKey":"plan.constraint.failed","evidenceRef":"rule:mandatory-v1"}]'::jsonb,
  decode(repeat('66', 32), 'hex'),
  decode(repeat('67', 32), 'hex')
) as response;

select is(
  (select response ->> 'candidateStatus' from invalid_candidate),
  'invalid',
  'una validación fallida crea un candidato explícitamente inválido'
);

select throws_ok(
  $$
    select public.internal_activate_plan_candidate(
      '00000000-0000-4000-8000-000000007101',
      '21000000-0000-4000-8000-000000007101',
      (select (response ->> 'candidateId')::uuid from invalid_candidate),
      5,
      decode(repeat('68', 32), 'hex'),
      decode(repeat('69', 32), 'hex')
    )
  $$,
  'PT422',
  'plan_candidate_invalid',
  'un candidato inválido no se puede activar'
);

select is(
  (
    select active_version_id::text
    from public.plans
    where id = (select (response ->> 'planId')::uuid from first_plan)
  ),
  (select response ->> 'planVersionId' from valid_candidate),
  'el candidato inválido no altera el plan activo anterior'
);

select throws_ok(
  $$
    update public.plan_versions
    set engine_version = 'motor-manipulado'
    where id = (select (response ->> 'planVersionId')::uuid from valid_candidate)
  $$,
  '55000',
  'immutable_plan_version',
  'el resultado normativo de una versión no se puede reescribir'
);

select is(
  jsonb_array_length(public.internal_list_plan_versions(
    '00000000-0000-4000-8000-000000007101',
    '21000000-0000-4000-8000-000000007101',
    (select (response ->> 'planId')::uuid from first_plan)
  ) -> 'versions'),
  3,
  'el historial devuelve borradores, activos y archivados'
);

select is(
  jsonb_array_length(public.internal_get_plan_version(
    '00000000-0000-4000-8000-000000007101',
    '21000000-0000-4000-8000-000000007101',
    (select (response ->> 'planId')::uuid from first_plan),
    (select (response ->> 'planVersionId')::uuid from valid_candidate)
  ) -> 'moduleResults'),
  1,
  'la lectura de una versión incluye sus resultados modulares congelados'
);

insert into auth.users (
  instance_id, id, aud, role, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at, is_anonymous
) values (
  '00000000-0000-0000-0000-000000000000',
  '00000000-0000-4000-8000-000000007103',
  'authenticated', 'authenticated',
  '{"provider":"anonymous","providers":["anonymous"]}'::jsonb,
  '{}'::jsonb, now(), now(), true
);
insert into auth.sessions (id, user_id, created_at, updated_at, aal)
values (
  '21000000-0000-4000-8000-000000007103',
  '00000000-0000-4000-8000-000000007103', now(), now(), 'aal1'
);
insert into public.actors (id, auth_subject)
values (
  '31000000-0000-4000-8000-000000007103',
  '00000000-0000-4000-8000-000000007103'
);
insert into public.device_sessions (
  id, actor_id, auth_session_id, label, created_at, last_seen_at,
  idle_expires_at, absolute_expires_at
) values (
  '41000000-0000-4000-8000-000000007103',
  '31000000-0000-4000-8000-000000007103',
  '21000000-0000-4000-8000-000000007103',
  'Sin acceso al plan', now(), now(), now() + interval '30 days',
  now() + interval '180 days'
);

select throws_ok(
  $$
    select public.internal_list_plan_versions(
      '00000000-0000-4000-8000-000000007103',
      '21000000-0000-4000-8000-000000007103',
      (select (response ->> 'planId')::uuid from first_plan)
    )
  $$,
  '42501',
  'access_not_granted',
  'un actor sin membresía no puede consultar el historial'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'public.internal_list_plan_versions(uuid,uuid,uuid)',
    'EXECUTE'
  ),
  'los RPC internos solo se ejecutan con rol servidor'
);

insert into public.profiles (id, alias, timezone, adult_attested_at)
values (
  '51000000-0000-4000-8000-000000007102',
  'Borrado Plan', 'Europe/Madrid', now()
);
insert into public.questionnaire_drafts (
  id, profile_id, schema_version, version, status, completeness, answers,
  confirmed_block_ids, current_block_id, uncertainties, hard_errors
) values (
  '71000000-0000-4000-8000-000000007102',
  '51000000-0000-4000-8000-000000007102',
  2, 1, 'submitted', 'complete', '{}', '{}', 'summary', '[]', '[]'
);
insert into public.context_snapshots (
  id, profile_id, source_draft_id, source_draft_version, schema_version,
  effective_at, answers, completeness, normalization_version, input_hash,
  canonicalization_version
) values (
  '72000000-0000-4000-8000-000000007102',
  '51000000-0000-4000-8000-000000007102',
  '71000000-0000-4000-8000-000000007102', 1, 2, now(), '{}', 'complete',
  'normalization-v1', decode(repeat('91', 32), 'hex'), 'canonical-json-v1'
);
select lives_ok(
  $$
    delete from public.profiles
    where id = '51000000-0000-4000-8000-000000007102'
  $$,
  'el borrado permanente del perfil puede eliminar snapshots y borrador en cascada'
);

rollback;

-- Carrera real entre dos activaciones iniciales con el mismo expected_version.
create extension if not exists dblink with schema extensions;
drop function if exists private.test_concurrent_plan_activation(bytea, bytea);

insert into auth.users (
  instance_id, id, aud, role, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at, is_anonymous
) values (
  '00000000-0000-0000-0000-000000000000',
  '00000000-0000-4000-8000-000000007199',
  'authenticated', 'authenticated',
  '{"provider":"anonymous","providers":["anonymous"]}'::jsonb,
  '{}'::jsonb, now(), now(), true
);
insert into auth.sessions (id, user_id, created_at, updated_at, aal)
values (
  '21000000-0000-4000-8000-000000007199',
  '00000000-0000-4000-8000-000000007199', now(), now(), 'aal1'
);
insert into public.actors (id, auth_subject)
values (
  '31000000-0000-4000-8000-000000007199',
  '00000000-0000-4000-8000-000000007199'
);
insert into public.profiles (id, alias, timezone, adult_attested_at)
values (
  '51000000-0000-4000-8000-000000007199',
  'Planes Carrera', 'Europe/Madrid', now()
);
insert into public.profile_access (id, profile_id, actor_id)
values (
  '61000000-0000-4000-8000-000000007199',
  '51000000-0000-4000-8000-000000007199',
  '31000000-0000-4000-8000-000000007199'
);
insert into public.device_sessions (
  id, actor_id, auth_session_id, label, created_at, last_seen_at,
  idle_expires_at, absolute_expires_at
) values (
  '41000000-0000-4000-8000-000000007199',
  '31000000-0000-4000-8000-000000007199',
  '21000000-0000-4000-8000-000000007199',
  'Plan carrera', now(), now(), now() + interval '30 days',
  now() + interval '180 days'
);
insert into public.questionnaire_drafts (
  id, profile_id, schema_version, version, status, completeness, answers,
  confirmed_block_ids, current_block_id, uncertainties, hard_errors
) values (
  '71000000-0000-4000-8000-000000007199',
  '51000000-0000-4000-8000-000000007199',
  2, 1, 'submitted', 'complete',
  '{"activeModules":["nutrition"],"age":35,"weightKg":82,"heightCm":178}'::jsonb,
  array['core', 'modules', 'summary'], 'summary', '[]'::jsonb, '[]'::jsonb
);
insert into public.context_snapshots (
  id, profile_id, source_draft_id, source_draft_version, schema_version,
  effective_at, answers, completeness, normalization_version, input_hash,
  canonicalization_version
) values (
  '72000000-0000-4000-8000-000000007199',
  '51000000-0000-4000-8000-000000007199',
  '71000000-0000-4000-8000-000000007199', 1, 2, now(),
  '{"activeModules":["nutrition"],"age":35,"weightKg":82,"heightCm":178}'::jsonb,
  'complete', 'normalization-v1', decode(repeat('71', 32), 'hex'),
  'canonical-json-v1'
);
insert into public.plans (
  id, profile_id, active_version_id, aggregate_version
) values (
  '73000000-0000-4000-8000-000000007199',
  '51000000-0000-4000-8000-000000007199', null, 1
);
insert into public.plan_versions (
  id, plan_id, ordinal, status, completeness, validation_status, validation,
  context_snapshot_id, engine_version, rule_set_revision_id,
  source_manifest_id, input_hash, output_hash, canonicalization_version
) values (
  '74000000-0000-4000-8000-000000007199',
  '73000000-0000-4000-8000-000000007199', 1, 'draft', 'complete',
  'valid', '{"checks":["structure"],"completeness":"complete"}'::jsonb,
  '72000000-0000-4000-8000-000000007199', 'engine-contract-v1',
  '81000000-0000-4000-8000-000000007199',
  '82000000-0000-4000-8000-000000007199',
  decode(repeat('72', 32), 'hex'), decode(repeat('73', 32), 'hex'),
  'canonical-json-v1'
);

create function private.test_concurrent_plan_activation(
  p_key_digest bytea,
  p_request_digest bytea
)
returns text
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  perform public.internal_activate_plan_version(
    '00000000-0000-4000-8000-000000007199',
    '21000000-0000-4000-8000-000000007199',
    '73000000-0000-4000-8000-000000007199',
    '74000000-0000-4000-8000-000000007199',
    1, p_key_digest, p_request_digest
  );
  return 'ok';
exception
  when sqlstate 'PT409' then return 'PT409';
  when others then return sqlstate || ':' || sqlerrm;
end;
$$;

create temporary table concurrent_plan_results (result text not null);

do $$
declare
  connection_string text := format(
    'hostaddr=%s port=%s dbname=%s user=postgres password=postgres',
    inet_server_addr(), inet_server_port(), current_database()
  );
begin
  perform extensions.dblink_connect('plan_activation_one', connection_string);
  perform extensions.dblink_connect('plan_activation_two', connection_string);
  perform extensions.dblink_send_query(
    'plan_activation_one',
    $query$
      with barrier as materialized (select pg_sleep(0.25))
      select private.test_concurrent_plan_activation(
        decode(repeat('81', 32), 'hex'), decode(repeat('82', 32), 'hex')
      ) from barrier
    $query$
  );
  perform extensions.dblink_send_query(
    'plan_activation_two',
    $query$
      with barrier as materialized (select pg_sleep(0.25))
      select private.test_concurrent_plan_activation(
        decode(repeat('83', 32), 'hex'), decode(repeat('84', 32), 'hex')
      ) from barrier
    $query$
  );
end;
$$;

insert into concurrent_plan_results
select result
from extensions.dblink_get_result('plan_activation_one') as response(result text);
insert into concurrent_plan_results
select result
from extensions.dblink_get_result('plan_activation_two') as response(result text);

select is(
  (select count(*) from concurrent_plan_results where result = 'ok'),
  1::bigint,
  'una única activación concurrente obtiene el lock y activa el borrador'
);
select is(
  (select count(*) from concurrent_plan_results where result = 'PT409'),
  1::bigint,
  'la activación concurrente perdedora recibe VERSION_CONFLICT'
);
select is(
  (
    select count(*)
    from public.plan_versions
    where plan_id = '73000000-0000-4000-8000-000000007199'
      and status = 'active'
  ),
  1::bigint,
  'la carrera conserva exactamente una versión activa'
);

do $$
begin
  perform extensions.dblink_disconnect('plan_activation_one');
  perform extensions.dblink_disconnect('plan_activation_two');
end;
$$;
drop table concurrent_plan_results;
drop function private.test_concurrent_plan_activation(bytea, bytea);

update public.plans
set active_version_id = null
where id = '73000000-0000-4000-8000-000000007199';
delete from public.plans where id = '73000000-0000-4000-8000-000000007199';
delete from public.context_snapshots
where id = '72000000-0000-4000-8000-000000007199';
delete from public.questionnaire_drafts
where id = '71000000-0000-4000-8000-000000007199';
delete from public.profile_access
where profile_id = '51000000-0000-4000-8000-000000007199';
delete from public.device_sessions
where actor_id = '31000000-0000-4000-8000-000000007199';
delete from public.profiles
where id = '51000000-0000-4000-8000-000000007199';
delete from public.actors
where id = '31000000-0000-4000-8000-000000007199';
delete from auth.sessions
where id = '21000000-0000-4000-8000-000000007199';
delete from auth.users
where id = '00000000-0000-4000-8000-000000007199';

select * from finish();
