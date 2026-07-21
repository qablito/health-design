select no_plan();

begin;

insert into auth.users (
  instance_id, id, aud, role, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at, is_anonymous
) values (
  '00000000-0000-0000-0000-000000000000',
  '00000000-0000-4000-8000-000000016201',
  'authenticated', 'authenticated',
  '{"provider":"anonymous","providers":["anonymous"]}'::jsonb,
  '{}'::jsonb, now(), now(), true
);

insert into auth.sessions (id, user_id, created_at, updated_at, aal)
values (
  '21000000-0000-4000-8000-000000016201',
  '00000000-0000-4000-8000-000000016201', now(), now(), 'aal1'
);

insert into public.actors (id, auth_subject)
values (
  '31000000-0000-4000-8000-000000016201',
  '00000000-0000-4000-8000-000000016201'
);

insert into public.profiles (id, alias, timezone, adult_attested_at)
values (
  '51000000-0000-4000-8000-000000016201',
  'Aplicacion T16', 'Europe/Madrid', now()
);

insert into public.profile_access (id, profile_id, actor_id)
values (
  '61000000-0000-4000-8000-000000016201',
  '51000000-0000-4000-8000-000000016201',
  '31000000-0000-4000-8000-000000016201'
);

insert into public.device_sessions (
  id, actor_id, auth_session_id, label, created_at, last_seen_at,
  idle_expires_at, absolute_expires_at
) values (
  '41000000-0000-4000-8000-000000016201',
  '31000000-0000-4000-8000-000000016201',
  '21000000-0000-4000-8000-000000016201',
  'Aplicacion comercial', now(), now(), now() + interval '30 days',
  now() + interval '180 days'
);

insert into public.questionnaire_drafts (
  id, profile_id, schema_version, version, status, completeness, answers,
  confirmed_block_ids, current_block_id, uncertainties, hard_errors
) values (
  '71000000-0000-4000-8000-000000016201',
  '51000000-0000-4000-8000-000000016201',
  2, 1, 'submitted', 'complete',
  '{"activeModules":["nutrition"],"age":35,"weightKg":80,"heightCm":178}'::jsonb,
  array['core', 'modules', 'summary'], 'summary', '[]'::jsonb, '[]'::jsonb
);

create temporary table application_context as
select public.internal_create_context_snapshot(
  '00000000-0000-4000-8000-000000016201',
  '21000000-0000-4000-8000-000000016201',
  '51000000-0000-4000-8000-000000016201',
  1, 'normalization-v1', 'canonical-json-v1',
  decode(repeat('11', 32), 'hex'), decode(repeat('12', 32), 'hex'),
  decode(repeat('13', 32), 'hex')
) as response;

create temporary table application_plan as
select public.internal_create_plan_draft(
  p_auth_subject => '00000000-0000-4000-8000-000000016201',
  p_auth_session_id => '21000000-0000-4000-8000-000000016201',
  p_profile_id => '51000000-0000-4000-8000-000000016201',
  p_context_snapshot_id => (
    select (response ->> 'id')::uuid from application_context
  ),
  p_engine_version => 'engine-contract-v1',
  p_canonicalization_version => 'plan-canonical-v1',
  p_rule_set_revision_id => '81000000-0000-4000-8000-000000016201',
  p_source_manifest_id => '82000000-0000-4000-8000-000000016201',
  p_input_hash => decode(repeat('21', 32), 'hex'),
  p_output_hash => decode(repeat('22', 32), 'hex'),
  p_engine_completeness => 'complete',
  p_validation_status => 'valid',
  p_validation => '{"completeness":"complete"}'::jsonb,
  p_module_results => '[{"module":"nutrition","status":"valid","confidence":"high","payload":{"nutritionSchemaVersion":2},"uncertainties":[]}]'::jsonb,
  p_safety_findings => '[]'::jsonb,
  p_idempotency_key_digest => decode(repeat('23', 32), 'hex'),
  p_request_digest => decode(repeat('24', 32), 'hex')
) as response;

select public.internal_activate_plan_version(
  '00000000-0000-4000-8000-000000016201',
  '21000000-0000-4000-8000-000000016201',
  (select (response ->> 'planId')::uuid from application_plan),
  (select (response ->> 'planVersionId')::uuid from application_plan),
  1, decode(repeat('25', 32), 'hex'), decode(repeat('26', 32), 'hex')
);

create temporary table application_snapshot as
select jsonb_build_object(
  'schemaVersion', 1, 'basis', 'per_100_g',
  'density', jsonb_build_object('state', 'unknown'),
  'gtin', jsonb_build_object(
    'displayGtin', '8412345678905',
    'gtin14', '08412345678905', 'symbology', 'ean_13'
  ),
  'name', 'Pechuga de pollo envasada',
  'nutrients', jsonb_build_object(
    'energyKcal', jsonb_build_object('state', 'known', 'unit', 'kcal', 'value', '110'),
    'fatG', jsonb_build_object('state', 'known', 'unit', 'g', 'value', '1.5'),
    'saturatedFatG', jsonb_build_object('state', 'known', 'unit', 'g', 'value', '0.4'),
    'carbohydratesG', jsonb_build_object('state', 'known', 'unit', 'g', 'value', '0'),
    'sugarsG', jsonb_build_object('state', 'known', 'unit', 'g', 'value', '0'),
    'proteinG', jsonb_build_object('state', 'known', 'unit', 'g', 'value', '23.4'),
    'saltG', jsonb_build_object('state', 'known', 'unit', 'g', 'value', '0.2'),
    'fiberG', jsonb_build_object('state', 'unknown'), 'clinical', '{}'::jsonb
  ),
  'safety', jsonb_build_object(
    'ingredients', jsonb_build_object('state', 'known', 'values', jsonb_build_array('Pollo')),
    'allergens', jsonb_build_object('state', 'known', 'values', '[]'::jsonb),
    'crossContactAllergens', jsonb_build_object('state', 'known', 'values', '[]'::jsonb)
  )
) as snapshot;

create temporary table application_confirmation as
select public.internal_commercial_product_confirm(
  '00000000-0000-4000-8000-000000016201',
  '21000000-0000-4000-8000-000000016201',
  '51000000-0000-4000-8000-000000016201',
  '08412345678905', null, null,
  (select snapshot from application_snapshot), decode(repeat('31', 32), 'hex'),
  'complete', '["fiberG_unknown"]'::jsonb,
  '91000000-0000-4000-8000-000000016201', decode(repeat('32', 32), 'hex')
) as response;

select is(
  public.internal_commercial_product_for_application(
    '00000000-0000-4000-8000-000000016201',
    '21000000-0000-4000-8000-000000016201',
    '51000000-0000-4000-8000-000000016201',
    (select (response ->> 'confirmationId')::uuid from application_confirmation),
    'food:chicken-breast'
  ) -> 'matching' ->> 'state',
  'exact',
  'una confirmacion activa sin regla global usa el canónico contextual firmado'
);

create temporary table product_candidate as
select public.internal_create_commercial_product_candidate(
  p_auth_subject => '00000000-0000-4000-8000-000000016201',
  p_auth_session_id => '21000000-0000-4000-8000-000000016201',
  p_plan_id => (select (response ->> 'planId')::uuid from application_plan),
  p_expected_version => 2,
  p_base_version_id => (
    select (response ->> 'planVersionId')::uuid from application_plan
  ),
  p_context_snapshot_id => (
    select (response ->> 'id')::uuid from application_context
  ),
  p_confirmation_id => (
    select (response ->> 'confirmationId')::uuid from application_confirmation
  ),
  p_product_revision_id => (
    select (response ->> 'revisionId')::uuid from application_confirmation
  ),
  p_selection => '{"dayIndex":0,"mealIndex":0,"foodIndex":0,"expectedCanonicalFoodKey":"food:chicken-breast"}'::jsonb,
  p_change_kind => 'commercial_product_applied',
  p_change_payload => '{"confirmationId":"80000000-0000-4000-8000-000000016201"}'::jsonb,
  p_impact => 'module_only',
  p_diff => '{"changedFields":["nutrition.productApplication"],"affectedModules":["nutrition"]}'::jsonb,
  p_engine_version => 'engine-contract-v1',
  p_canonicalization_version => 'plan-canonical-v1',
  p_rule_set_revision_id => '81000000-0000-4000-8000-000000016201',
  p_source_manifest_id => '82000000-0000-4000-8000-000000016201',
  p_input_hash => decode(repeat('41', 32), 'hex'),
  p_output_hash => decode(repeat('42', 32), 'hex'),
  p_engine_completeness => 'provisional',
  p_validation_status => 'valid',
  p_validation => '{"completeness":"provisional"}'::jsonb,
  p_module_results => '[{"module":"nutrition","status":"provisional","confidence":"high","payload":{"nutritionSchemaVersion":2},"uncertainties":["fiberG_estimated_from_canonical"]}]'::jsonb,
  p_safety_findings => '[]'::jsonb,
  p_idempotency_key_digest => decode(repeat('43', 32), 'hex'),
  p_request_digest => decode(repeat('44', 32), 'hex')
) as response;

select ok(
  (select response ->> 'candidateStatus' from product_candidate) = 'pending'
  and (select response ->> 'activeVersionId' from product_candidate) =
    (select response ->> 'planVersionId' from application_plan)
  and (select count(*) from public.product_application_events) = 1,
  'aplicar crea un candidato y un evento sin cambiar la version activa'
);

select is(
  public.internal_create_commercial_product_candidate(
    p_auth_subject => '00000000-0000-4000-8000-000000016201',
    p_auth_session_id => '21000000-0000-4000-8000-000000016201',
    p_plan_id => (select (response ->> 'planId')::uuid from application_plan),
    p_expected_version => 2,
    p_base_version_id => (select (response ->> 'planVersionId')::uuid from application_plan),
    p_context_snapshot_id => (select (response ->> 'id')::uuid from application_context),
    p_confirmation_id => (select (response ->> 'confirmationId')::uuid from application_confirmation),
    p_product_revision_id => (select (response ->> 'revisionId')::uuid from application_confirmation),
    p_selection => '{"dayIndex":0,"mealIndex":0,"foodIndex":0,"expectedCanonicalFoodKey":"food:chicken-breast"}'::jsonb,
    p_change_kind => 'commercial_product_applied',
    p_change_payload => '{"confirmationId":"80000000-0000-4000-8000-000000016201"}'::jsonb,
    p_impact => 'module_only',
    p_diff => '{"changedFields":["nutrition.productApplication"],"affectedModules":["nutrition"]}'::jsonb,
    p_engine_version => 'engine-contract-v1', p_canonicalization_version => 'plan-canonical-v1',
    p_rule_set_revision_id => '81000000-0000-4000-8000-000000016201',
    p_source_manifest_id => '82000000-0000-4000-8000-000000016201',
    p_input_hash => decode(repeat('41', 32), 'hex'), p_output_hash => decode(repeat('42', 32), 'hex'),
    p_engine_completeness => 'provisional', p_validation_status => 'valid',
    p_validation => '{"completeness":"provisional"}'::jsonb,
    p_module_results => '[{"module":"nutrition","status":"provisional","confidence":"high","payload":{"nutritionSchemaVersion":2},"uncertainties":["fiberG_estimated_from_canonical"]}]'::jsonb,
    p_safety_findings => '[]'::jsonb,
    p_idempotency_key_digest => decode(repeat('43', 32), 'hex'),
    p_request_digest => decode(repeat('44', 32), 'hex')
  ),
  (select response from product_candidate),
  'el replay devuelve el mismo candidato sin duplicar eventos'
);

select is(
  (select count(*) from public.product_application_events),
  1::bigint,
  'la aplicacion idempotente conserva un solo evento'
);

select * from finish();

rollback;
