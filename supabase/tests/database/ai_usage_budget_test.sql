select no_plan();

begin;

select ok(
  to_regclass('private.ai_provider_revisions') is not null
  and to_regclass('private.pricing_fx_revisions') is not null
  and to_regclass('private.ai_budget_months') is not null
  and to_regclass('private.ai_usage_events') is not null
  and to_regclass('private.ai_explanations') is not null,
  'el ledger de IA permanece en el esquema privado'
);

select ok(
  not has_table_privilege(
    'authenticated', 'private.ai_usage_events', 'SELECT,INSERT,UPDATE,DELETE'
  ),
  'el navegador no accede al ledger de gasto'
);

insert into auth.users (
  instance_id, id, aud, role, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at, is_anonymous
) values
  (
    '00000000-0000-0000-0000-000000000000',
    '00000000-0000-4000-8000-000000014101',
    'authenticated', 'authenticated',
    '{"provider":"anonymous","providers":["anonymous"]}'::jsonb,
    '{}'::jsonb, now(), now(), true
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '00000000-0000-4000-8000-000000014102',
    'authenticated', 'authenticated',
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb, now(), now(), false
  );

insert into auth.sessions (id, user_id, created_at, updated_at, aal)
values
  (
    '21000000-0000-4000-8000-000000014101',
    '00000000-0000-4000-8000-000000014101', now(), now(), 'aal1'
  ),
  (
    '21000000-0000-4000-8000-000000014102',
    '00000000-0000-4000-8000-000000014102', now(), now(), 'aal1'
  ),
  (
    '21000000-0000-4000-8000-000000014103',
    '00000000-0000-4000-8000-000000014102', now(), now(), 'aal2'
  );

insert into public.actors (id, auth_subject, role)
values
  (
    '31000000-0000-4000-8000-000000014101',
    '00000000-0000-4000-8000-000000014101', 'device'
  ),
  (
    '31000000-0000-4000-8000-000000014102',
    '00000000-0000-4000-8000-000000014102', 'superadmin'
  );

insert into public.profiles (id, alias, timezone, adult_attested_at)
values (
  '51000000-0000-4000-8000-000000014101',
  'AI Budget Test', 'Europe/Madrid', now()
);

insert into public.profile_access (id, profile_id, actor_id)
values (
  '61000000-0000-4000-8000-000000014101',
  '51000000-0000-4000-8000-000000014101',
  '31000000-0000-4000-8000-000000014101'
);

insert into public.device_sessions (
  id, actor_id, auth_session_id, label, created_at, last_seen_at,
  idle_expires_at, absolute_expires_at
) values (
  '41000000-0000-4000-8000-000000014101',
  '31000000-0000-4000-8000-000000014101',
  '21000000-0000-4000-8000-000000014101',
  'AI budget', now(), now(), now() + interval '30 days',
  now() + interval '180 days'
);

insert into public.questionnaire_drafts (
  id, profile_id, schema_version, version, status, completeness, answers,
  confirmed_block_ids, current_block_id, uncertainties, hard_errors
) values (
  '71000000-0000-4000-8000-000000014101',
  '51000000-0000-4000-8000-000000014101',
  2, 1, 'submitted', 'complete',
  '{"activeModules":["nutrition"],"age":35,"weightKg":82}'::jsonb,
  array['core', 'modules', 'summary'], 'summary', '[]'::jsonb, '[]'::jsonb
);

insert into public.context_snapshots (
  id, profile_id, source_draft_id, source_draft_version, schema_version,
  effective_at, answers, completeness, normalization_version, input_hash,
  canonicalization_version
) values (
  '72000000-0000-4000-8000-000000014101',
  '51000000-0000-4000-8000-000000014101',
  '71000000-0000-4000-8000-000000014101', 1, 2, now(),
  '{"activeModules":["nutrition"],"age":35,"weightKg":82}'::jsonb,
  'complete', 'normalization-v1', decode(repeat('11', 32), 'hex'),
  'canonical-json-v1'
);

insert into public.plans (id, profile_id)
values (
  '73000000-0000-4000-8000-000000014101',
  '51000000-0000-4000-8000-000000014101'
);

insert into public.plan_versions (
  id, plan_id, ordinal, status, completeness, validation_status, validation,
  context_snapshot_id, engine_version, rule_set_revision_id,
  source_manifest_id, input_hash, output_hash, canonicalization_version
) values (
  '74000000-0000-4000-8000-000000014101',
  '73000000-0000-4000-8000-000000014101', 1, 'draft', 'complete', 'valid',
  '{"completeness":"complete"}'::jsonb,
  '72000000-0000-4000-8000-000000014101', 'engine-v1',
  '75000000-0000-4000-8000-000000014101',
  '76000000-0000-4000-8000-000000014101',
  decode(repeat('12', 32), 'hex'), decode(repeat('13', 32), 'hex'),
  'canonical-json-v1'
);

insert into public.module_results (
  plan_version_id, module, status, confidence, payload, uncertainties
) values (
  '74000000-0000-4000-8000-000000014101', 'nutrition', 'valid', 'high',
  '{"redacted":"not_returned_to_ai"}'::jsonb, '[]'::jsonb
);

insert into private.pricing_fx_revisions (
  id, provider, provider_currency, input_per_million, output_per_million,
  fx_to_eur, source_refs, observed_at, effective_from, expires_at,
  decimal_precision, canonical_hash, status
) values (
  '81000000-0000-4000-8000-000000014101', 'openai', 'USD', 1, 6, 0.90,
  '["https://openai.com/api/pricing/"]'::jsonb, now(), now() - interval '1 hour',
  now() + interval '30 days', 8, decode(repeat('21', 32), 'hex'), 'draft'
);

insert into private.ai_provider_revisions (
  id, provider, endpoint_id, model, processing_region, retention_mode,
  training_use, timeout_ms, retry_policy, source_refs, canonical_hash,
  pricing_fx_revision_id,
  minimization_policy_version, reasoning_effort, max_input_tokens,
  max_output_tokens, effective_from, expires_at, status
) values (
  '82000000-0000-4000-8000-000000014101', 'openai',
  'openai_responses_v1', 'gpt-5.6-luna', 'global', 'standard_30_day', false,
  8000, 'none',
  '["https://developers.openai.com/api/docs/models/gpt-5.6-luna"]'::jsonb,
  decode(repeat('22', 32), 'hex'),
  '81000000-0000-4000-8000-000000014101',
  'ai-minimization-v1', 'none', 2048, 256, now() - interval '1 hour',
  now() + interval '30 days', 'draft'
);

select throws_ok(
  $$
    select public.internal_admin_activate_ai_provider_revision(
      '00000000-0000-4000-8000-000000014102',
      '21000000-0000-4000-8000-000000014102',
      '82000000-0000-4000-8000-000000014101'
    )
  $$,
  '42501', 'aal2_required', 'AAL1 no activa el proveedor'
);

select is(
  public.internal_admin_activate_ai_provider_revision(
    '00000000-0000-4000-8000-000000014102',
    '21000000-0000-4000-8000-000000014103',
    '82000000-0000-4000-8000-000000014101'
  ) ->> 'status',
  'active',
  'AAL2 activa atómicamente precio y proveedor documentados'
);

select is(
  public.internal_admin_activate_ai_provider_revision_requested(
    '00000000-0000-4000-8000-000000014102',
    '21000000-0000-4000-8000-000000014103',
    '82000000-0000-4000-8000-000000014101',
    '83000000-0000-4000-8000-000000014199'
  ) ->> 'status',
  'active', 'la activación solicitada es idempotente y queda registrada'
);

select is(
  (
    select action from private.technical_audit_events
    where request_id = '83000000-0000-4000-8000-000000014199'
  ),
  'ai_provider_revision_activate', 'la activación deja registro técnico privado'
);

select is(
  public.internal_ai_get_explanation_context(
    '00000000-0000-4000-8000-000000014101',
    '21000000-0000-4000-8000-000000014101',
    '74000000-0000-4000-8000-000000014101'
  ) #>> '{modules,0,module}',
  'nutrition', 'el contexto minimizado expone estado, no el payload clínico'
);

select ok(
  not (
    public.internal_ai_get_explanation_context(
      '00000000-0000-4000-8000-000000014101',
      '21000000-0000-4000-8000-000000014101',
      '74000000-0000-4000-8000-000000014101'
    )::text like '%redacted%'
  ),
  'los datos normativos del módulo no salen hacia Luna'
);

create temporary table first_reservation as
select public.internal_ai_reserve_explanation(
  '00000000-0000-4000-8000-000000014101',
  '21000000-0000-4000-8000-000000014101',
  '51000000-0000-4000-8000-000000014101',
  '74000000-0000-4000-8000-000000014101',
  decode(repeat('31', 32), 'hex'),
  '83000000-0000-4000-8000-000000014101'
) as response;

select is(
  (select response ->> 'status' from first_reservation),
  'reserved', 'una versión válida reserva antes de llamar'
);

select is(
  public.internal_ai_reserve_explanation(
    '00000000-0000-4000-8000-000000014101',
    '21000000-0000-4000-8000-000000014101',
    '51000000-0000-4000-8000-000000014101',
    '74000000-0000-4000-8000-000000014101',
    decode(repeat('31', 32), 'hex'),
    '83000000-0000-4000-8000-000000014101'
  ) ->> 'eventId',
  (select response ->> 'eventId' from first_reservation),
  'la misma clave no duplica la reserva'
);

select public.internal_ai_reserve_explanation(
  '00000000-0000-4000-8000-000000014101',
  '21000000-0000-4000-8000-000000014101',
  '51000000-0000-4000-8000-000000014101',
  '74000000-0000-4000-8000-000000014101',
  decode(lpad(to_hex(number), 64, '0'), 'hex'), gen_random_uuid()
)
from generate_series(2, 10) number;

select is(
  public.internal_ai_reserve_explanation(
    '00000000-0000-4000-8000-000000014101',
    '21000000-0000-4000-8000-000000014101',
    '51000000-0000-4000-8000-000000014101',
    '74000000-0000-4000-8000-000000014101',
    decode(repeat('41', 32), 'hex'), gen_random_uuid()
  ) ->> 'reason',
  'daily_profile_quota', 'la explicación once del día se rechaza'
);

select throws_ok(
  $$
    insert into private.ai_budget_months (month, cap_eur)
    values ('2040-01-01', 11.00)
  $$,
  '23514', null, 'el límite mensual no puede ser distinto de 10,00 EUR'
);

select is(
  public.internal_ai_settle_usage(
    (select (response ->> 'eventId')::uuid from first_reservation),
    '83000000-0000-4000-8000-000000014101', 100, 20
  ) ->> 'status',
  'settled', 'la liquidación usa tokens reales'
);

select is(
  public.internal_ai_settle_usage(
    (select (response ->> 'eventId')::uuid from first_reservation),
    '83000000-0000-4000-8000-000000014101', 100, 20
  ) ->> 'status',
  'settled', 'liquidar dos veces es idempotente'
);

select * from finish();

rollback;
