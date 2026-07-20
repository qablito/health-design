create table private.pricing_fx_revisions (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider = 'openai'),
  provider_currency text not null check (provider_currency = 'USD'),
  input_per_million numeric(18,8) not null check (input_per_million > 0),
  output_per_million numeric(18,8) not null check (output_per_million > 0),
  fx_to_eur numeric(18,8) not null check (fx_to_eur > 0),
  source_refs jsonb not null check (
    jsonb_typeof(source_refs) = 'array' and jsonb_array_length(source_refs) > 0
  ),
  observed_at timestamptz not null,
  effective_from timestamptz not null,
  expires_at timestamptz not null,
  decimal_precision integer not null check (decimal_precision between 2 and 12),
  canonical_hash bytea not null check (octet_length(canonical_hash) = 32),
  status text not null default 'draft'
    check (status in ('draft', 'active', 'superseded')),
  approved_at timestamptz,
  approved_by uuid references public.actors (id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  check (expires_at > effective_from),
  check (
    (status = 'draft' and approved_at is null and approved_by is null)
    or (status in ('active', 'superseded') and approved_at is not null and approved_by is not null)
  )
);

create unique index pricing_fx_revisions_one_active_idx
on private.pricing_fx_revisions (provider)
where status = 'active';

create table private.ai_provider_revisions (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider = 'openai'),
  endpoint_id text not null check (endpoint_id = 'openai_responses_v1'),
  model text not null check (model = 'gpt-5.6-luna'),
  processing_region text not null check (processing_region = 'global'),
  retention_mode text not null check (retention_mode = 'standard_30_day'),
  training_use boolean not null check (training_use is false),
  timeout_ms integer not null check (timeout_ms = 8000),
  retry_policy text not null check (retry_policy = 'none'),
  source_refs jsonb not null check (
    jsonb_typeof(source_refs) = 'array' and jsonb_array_length(source_refs) > 0
  ),
  canonical_hash bytea not null check (octet_length(canonical_hash) = 32),
  pricing_fx_revision_id uuid not null
    references private.pricing_fx_revisions (id) on delete restrict,
  minimization_policy_version text not null
    check (minimization_policy_version = 'ai-minimization-v1'),
  reasoning_effort text not null check (reasoning_effort = 'none'),
  max_input_tokens integer not null check (max_input_tokens between 1 and 2048),
  max_output_tokens integer not null check (max_output_tokens between 1 and 256),
  effective_from timestamptz not null,
  expires_at timestamptz not null,
  status text not null default 'draft'
    check (status in ('draft', 'active', 'superseded')),
  approved_at timestamptz,
  approved_by uuid references public.actors (id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  check (expires_at > effective_from),
  check (
    (status = 'draft' and approved_at is null and approved_by is null)
    or (status in ('active', 'superseded') and approved_at is not null and approved_by is not null)
  )
);

create unique index ai_provider_revisions_one_active_idx
on private.ai_provider_revisions (provider)
where status = 'active';

create table private.ai_budget_months (
  month date primary key,
  cap_eur numeric(12,2) not null default 10.00 check (cap_eur = 10.00),
  settled_eur numeric(18,8) not null default 0 check (settled_eur >= 0),
  reserved_upper_bound_eur numeric(18,8) not null default 0
    check (reserved_upper_bound_eur >= 0),
  alerted_percentages integer[] not null default '{}',
  blocked boolean not null default false,
  blocked_reason text,
  version integer not null default 1 check (version > 0),
  updated_at timestamptz not null default clock_timestamp(),
  check (month = date_trunc('month', month)::date),
  check (not blocked or blocked_reason is not null)
);

create table private.ai_usage_events (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null references public.actors (id) on delete restrict,
  profile_id uuid not null references public.profiles (id) on delete restrict,
  plan_version_id uuid not null
    references public.plan_versions (id) on delete restrict,
  provider_revision_id uuid not null
    references private.ai_provider_revisions (id) on delete restrict,
  pricing_fx_revision_id uuid not null
    references private.pricing_fx_revisions (id) on delete restrict,
  budget_month date not null
    references private.ai_budget_months (month) on delete restrict,
  profile_local_date date not null,
  idempotency_key_digest bytea not null
    check (octet_length(idempotency_key_digest) = 32),
  request_id uuid not null,
  max_input_tokens integer not null check (max_input_tokens > 0),
  max_output_tokens integer not null check (max_output_tokens > 0),
  reserved_upper_bound_eur numeric(18,8) not null
    check (reserved_upper_bound_eur >= 0),
  input_tokens integer check (input_tokens is null or input_tokens >= 0),
  output_tokens integer check (output_tokens is null or output_tokens >= 0),
  actual_eur numeric(18,8) check (actual_eur is null or actual_eur >= 0),
  status text not null check (
    status in (
      'reserved', 'pending_reconciliation', 'settled', 'released',
      'rejected', 'provider_cost_anomaly'
    )
  ),
  rejection_code text check (
    rejection_code is null
    or rejection_code in ('daily_profile_quota', 'monthly_budget')
  ),
  created_at timestamptz not null default clock_timestamp(),
  settled_at timestamptz,
  unique (actor_id, idempotency_key_digest),
  check (
    (status = 'rejected' and rejection_code is not null)
    or (status <> 'rejected' and rejection_code is null)
  )
);

create index ai_usage_events_profile_day_idx
on private.ai_usage_events (profile_id, profile_local_date, status);

create table private.ai_explanations (
  id uuid primary key default gen_random_uuid(),
  usage_event_id uuid not null unique
    references private.ai_usage_events (id) on delete restrict,
  plan_version_id uuid not null
    references public.plan_versions (id) on delete restrict,
  provider_revision_id uuid not null
    references private.ai_provider_revisions (id) on delete restrict,
  prompt_version text not null check (prompt_version = 'ai-explanation-v1'),
  schema_version integer not null check (schema_version = 1),
  policy_version text not null check (policy_version = 'ai-minimization-v1'),
  input_manifest_hash bytea not null check (octet_length(input_manifest_hash) = 32),
  output_segments jsonb not null check (
    jsonb_typeof(output_segments) = 'array'
    and octet_length(output_segments::text) <= 16384
  ),
  created_at timestamptz not null default clock_timestamp()
);

alter table private.pricing_fx_revisions enable row level security;
alter table private.ai_provider_revisions enable row level security;
alter table private.ai_budget_months enable row level security;
alter table private.ai_usage_events enable row level security;
alter table private.ai_explanations enable row level security;

revoke all on table private.pricing_fx_revisions from public, anon, authenticated;
revoke all on table private.ai_provider_revisions from public, anon, authenticated;
revoke all on table private.ai_budget_months from public, anon, authenticated;
revoke all on table private.ai_usage_events from public, anon, authenticated;
revoke all on table private.ai_explanations from public, anon, authenticated;

grant select, insert, update on table private.pricing_fx_revisions to service_role;
grant select, insert, update on table private.ai_provider_revisions to service_role;
grant select, insert, update on table private.ai_budget_months to service_role;
grant select, insert, update on table private.ai_usage_events to service_role;
grant select, insert on table private.ai_explanations to service_role;

insert into private.pricing_fx_revisions (
  id, provider, provider_currency, input_per_million, output_per_million,
  fx_to_eur, source_refs, observed_at, effective_from, expires_at,
  decimal_precision, canonical_hash, status
) values (
  'a1400000-0000-4000-8000-000000000001', 'openai', 'USD', 1, 6,
  0.87450809,
  '["https://developers.openai.com/api/docs/models/gpt-5.6-luna","https://www.ecb.europa.eu/stats/policy_and_exchange_rates/euro_reference_exchange_rates/html/index.es.html"]'::jsonb,
  '2026-07-17T16:00:00Z', '2026-07-17T16:00:00Z',
  '2026-08-17T16:00:00Z', 8,
  decode('e6a2e0195077c46e436d18dff9ada55eb54db1f67c4426aaadc473e016432e83', 'hex'),
  'draft'
);

insert into private.ai_provider_revisions (
  id, provider, endpoint_id, model, processing_region, retention_mode,
  training_use, timeout_ms, retry_policy, source_refs, canonical_hash,
  pricing_fx_revision_id, minimization_policy_version, reasoning_effort,
  max_input_tokens, max_output_tokens, effective_from, expires_at, status
) values (
  'a1400000-0000-4000-8000-000000000002', 'openai',
  'openai_responses_v1', 'gpt-5.6-luna', 'global', 'standard_30_day', false,
  8000, 'none',
  '["https://developers.openai.com/api/docs/models/gpt-5.6-luna","https://platform.openai.com/docs/models/default-usage-policies-by-endpoint"]'::jsonb,
  decode('658fbbb8227847d3519262286ea3ba2c1ac46f92bd95a57ca5d40e7f0cbf04ae', 'hex'),
  'a1400000-0000-4000-8000-000000000001', 'ai-minimization-v1', 'none',
  2048, 256, '2026-07-17T16:00:00Z', '2026-08-17T16:00:00Z', 'draft'
);

create function public.internal_admin_activate_ai_provider_revision(
  p_auth_subject uuid,
  p_auth_session_id uuid,
  p_revision_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_actor_id uuid;
  v_revision private.ai_provider_revisions%rowtype;
  v_pricing private.pricing_fx_revisions%rowtype;
begin
  v_actor_id := private.require_superadmin_aal2(
    p_auth_subject,
    p_auth_session_id
  );

  select revision.* into v_revision
  from private.ai_provider_revisions revision
  where revision.id = p_revision_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'revision_not_found';
  end if;

  select pricing.* into v_pricing
  from private.pricing_fx_revisions pricing
  where pricing.id = v_revision.pricing_fx_revision_id
  for update;

  if v_revision.status = 'active' then
    return jsonb_build_object(
      'pricingRevisionId', v_pricing.id,
      'revisionId', v_revision.id,
      'status', 'active'
    );
  end if;

  if v_revision.status <> 'draft'
    or v_revision.provider <> 'openai'
    or v_revision.endpoint_id <> 'openai_responses_v1'
    or v_revision.model <> 'gpt-5.6-luna'
    or v_revision.reasoning_effort <> 'none'
    or v_revision.timeout_ms <> 8000
    or v_revision.retry_policy <> 'none'
    or v_revision.training_use
    or jsonb_array_length(v_revision.source_refs) = 0
    or octet_length(v_revision.canonical_hash) <> 32
    or v_revision.effective_from > clock_timestamp()
    or v_revision.expires_at <= clock_timestamp()
    or v_pricing.status <> 'draft'
    or v_pricing.effective_from > clock_timestamp()
    or v_pricing.expires_at <= clock_timestamp()
  then
    raise exception using errcode = '23514', message = 'revision_not_activatable';
  end if;

  update private.ai_provider_revisions
  set status = 'superseded'
  where provider = v_revision.provider and status = 'active';

  update private.pricing_fx_revisions
  set status = 'superseded'
  where provider = v_pricing.provider and status = 'active';

  update private.pricing_fx_revisions
  set status = 'active', approved_at = clock_timestamp(), approved_by = v_actor_id
  where id = v_pricing.id;

  update private.ai_provider_revisions
  set status = 'active', approved_at = clock_timestamp(), approved_by = v_actor_id
  where id = v_revision.id;

  return jsonb_build_object(
    'pricingRevisionId', v_pricing.id,
    'revisionId', v_revision.id,
    'status', 'active'
  );
end;
$$;

create function public.internal_admin_activate_ai_provider_revision_requested(
  p_auth_subject uuid,
  p_auth_session_id uuid,
  p_revision_id uuid,
  p_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_actor_id uuid;
  v_existing private.technical_audit_events%rowtype;
  v_response jsonb;
begin
  v_actor_id := private.require_superadmin_aal2(
    p_auth_subject,
    p_auth_session_id
  );
  select event.* into v_existing
  from private.technical_audit_events event
  where event.request_id = p_request_id and event.phase = 'outcome';
  if found then
    if v_existing.action <> 'ai_provider_revision_activate'
      or v_existing.target_type <> 'ai_provider_revision'
      or v_existing.target_id <> p_revision_id
      or v_existing.actor_id <> v_actor_id
    then
      raise exception using errcode = '23505', message = 'idempotency_key_reused';
    end if;
    return jsonb_build_object(
      'revisionId', p_revision_id,
      'status', 'active'
    );
  end if;

  v_response := public.internal_admin_activate_ai_provider_revision(
    p_auth_subject,
    p_auth_session_id,
    p_revision_id
  );
  insert into private.technical_audit_events (
    actor_id, action, target_type, target_id, result, request_id, phase,
    original_actor_id
  ) values (
    v_actor_id, 'ai_provider_revision_activate', 'ai_provider_revision',
    p_revision_id, 'success', p_request_id, 'outcome', v_actor_id
  );
  return v_response;
end;
$$;

create function public.internal_ai_reserve_explanation(
  p_auth_subject uuid,
  p_auth_session_id uuid,
  p_profile_id uuid,
  p_plan_version_id uuid,
  p_idempotency_key_digest bytea,
  p_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_actor_id uuid;
  v_provider private.ai_provider_revisions%rowtype;
  v_pricing private.pricing_fx_revisions%rowtype;
  v_existing private.ai_usage_events%rowtype;
  v_event private.ai_usage_events%rowtype;
  v_month private.ai_budget_months%rowtype;
  v_profile_date date;
  v_budget_month date;
  v_reserved numeric(18,8);
  v_daily_count integer;
begin
  if octet_length(p_idempotency_key_digest) <> 32 or p_request_id is null then
    raise exception using errcode = '22023', message = 'invalid_request_identity';
  end if;

  v_actor_id := private.require_questionnaire_access(
    p_auth_subject,
    p_auth_session_id,
    p_profile_id
  );

  if not exists (
    select 1
    from public.plan_versions version
    join public.plans plan on plan.id = version.plan_id
    where version.id = p_plan_version_id
      and plan.profile_id = p_profile_id
      and version.validation_status = 'valid'
  ) then
    raise exception using errcode = '23514', message = 'plan_validation_failed';
  end if;

  select usage.* into v_existing
  from private.ai_usage_events usage
  where usage.actor_id = v_actor_id
    and usage.idempotency_key_digest = p_idempotency_key_digest;

  if found then
    if v_existing.request_id <> p_request_id
      or v_existing.profile_id <> p_profile_id
      or v_existing.plan_version_id <> p_plan_version_id
    then
      raise exception using errcode = '23505', message = 'idempotency_key_reused';
    end if;
    return jsonb_build_object(
      'eventId', v_existing.id,
      'reason', v_existing.rejection_code,
      'status', v_existing.status
    );
  end if;

  select revision.* into v_provider
  from private.ai_provider_revisions revision
  where revision.status = 'active'
    and revision.effective_from <= clock_timestamp()
    and revision.expires_at > clock_timestamp();

  if not found then
    raise exception using errcode = '55000', message = 'ai_provider_unavailable';
  end if;

  select pricing.* into v_pricing
  from private.pricing_fx_revisions pricing
  where pricing.id = v_provider.pricing_fx_revision_id
    and pricing.status = 'active'
    and pricing.effective_from <= clock_timestamp()
    and pricing.expires_at > clock_timestamp();

  if not found then
    raise exception using errcode = '55000', message = 'ai_pricing_unavailable';
  end if;

  select timezone(profile.timezone, clock_timestamp())::date
  into v_profile_date
  from public.profiles profile
  where profile.id = p_profile_id;
  v_budget_month := date_trunc('month', clock_timestamp())::date;
  v_reserved := ceiling((
    (
      v_provider.max_input_tokens * v_pricing.input_per_million
      + v_provider.max_output_tokens * v_pricing.output_per_million
    ) / 1000000 * v_pricing.fx_to_eur
  ) * 100000000) / 100000000;

  insert into private.ai_budget_months (month)
  values (v_budget_month)
  on conflict (month) do nothing;

  select budget.* into v_month
  from private.ai_budget_months budget
  where budget.month = v_budget_month
  for update;

  select usage.* into v_existing
  from private.ai_usage_events usage
  where usage.actor_id = v_actor_id
    and usage.idempotency_key_digest = p_idempotency_key_digest;
  if found then
    return jsonb_build_object(
      'eventId', v_existing.id,
      'reason', v_existing.rejection_code,
      'status', v_existing.status
    );
  end if;

  select count(*) into v_daily_count
  from private.ai_usage_events usage
  where usage.profile_id = p_profile_id
    and usage.profile_local_date = v_profile_date
    and usage.status in (
      'reserved', 'pending_reconciliation', 'settled', 'provider_cost_anomaly'
    );

  if v_daily_count >= 10
    or v_month.blocked
    or v_month.settled_eur + v_month.reserved_upper_bound_eur + v_reserved
      > v_month.cap_eur
  then
    insert into private.ai_usage_events (
      actor_id, profile_id, plan_version_id, provider_revision_id,
      pricing_fx_revision_id, budget_month, profile_local_date,
      idempotency_key_digest, request_id, max_input_tokens,
      max_output_tokens, reserved_upper_bound_eur, status, rejection_code
    ) values (
      v_actor_id, p_profile_id, p_plan_version_id, v_provider.id,
      v_pricing.id, v_budget_month, v_profile_date,
      p_idempotency_key_digest, p_request_id, v_provider.max_input_tokens,
      v_provider.max_output_tokens, 0, 'rejected',
      case when v_daily_count >= 10 then 'daily_profile_quota'
           else 'monthly_budget' end
    ) returning * into v_event;

    return jsonb_build_object(
      'eventId', v_event.id,
      'reason', v_event.rejection_code,
      'status', v_event.status
    );
  end if;

  insert into private.ai_usage_events (
    actor_id, profile_id, plan_version_id, provider_revision_id,
    pricing_fx_revision_id, budget_month, profile_local_date,
    idempotency_key_digest, request_id, max_input_tokens,
    max_output_tokens, reserved_upper_bound_eur, status
  ) values (
    v_actor_id, p_profile_id, p_plan_version_id, v_provider.id,
    v_pricing.id, v_budget_month, v_profile_date,
    p_idempotency_key_digest, p_request_id, v_provider.max_input_tokens,
    v_provider.max_output_tokens, v_reserved, 'reserved'
  ) returning * into v_event;

  update private.ai_budget_months
  set reserved_upper_bound_eur = reserved_upper_bound_eur + v_reserved,
      alerted_percentages = array(
        select distinct threshold
        from unnest(
          alerted_percentages || case
            when (settled_eur + reserved_upper_bound_eur + v_reserved) / cap_eur >= 0.90
              then array[50,75,90]
            when (settled_eur + reserved_upper_bound_eur + v_reserved) / cap_eur >= 0.75
              then array[50,75]
            when (settled_eur + reserved_upper_bound_eur + v_reserved) / cap_eur >= 0.50
              then array[50]
            else array[]::integer[]
          end
        ) threshold
        order by threshold
      ),
      version = version + 1,
      updated_at = clock_timestamp()
  where month = v_budget_month;

  return jsonb_build_object(
    'eventId', v_event.id,
    'maxInputTokens', v_provider.max_input_tokens,
    'maxOutputTokens', v_provider.max_output_tokens,
    'model', v_provider.model,
    'pricingRevisionId', v_pricing.id,
    'providerRevisionId', v_provider.id,
    'reasoningEffort', v_provider.reasoning_effort,
    'reservedUpperBoundEur', v_reserved,
    'status', 'reserved',
    'timeoutMs', v_provider.timeout_ms
  );
end;
$$;

create function public.internal_ai_settle_usage(
  p_event_id uuid,
  p_request_id uuid,
  p_input_tokens integer,
  p_output_tokens integer
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_event private.ai_usage_events%rowtype;
  v_pricing private.pricing_fx_revisions%rowtype;
  v_actual numeric(18,8);
  v_status text;
begin
  if p_input_tokens < 0 or p_output_tokens < 0 then
    raise exception using errcode = '22023', message = 'invalid_token_usage';
  end if;

  select usage.* into v_event
  from private.ai_usage_events usage
  where usage.id = p_event_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'usage_event_not_found';
  end if;
  if v_event.request_id <> p_request_id then
    raise exception using errcode = '42501', message = 'request_identity_mismatch';
  end if;
  if v_event.status in ('settled', 'provider_cost_anomaly') then
    return jsonb_build_object(
      'actualEur', v_event.actual_eur,
      'eventId', v_event.id,
      'status', v_event.status
    );
  end if;
  if v_event.status not in ('reserved', 'pending_reconciliation') then
    raise exception using errcode = '55000', message = 'usage_not_settleable';
  end if;

  perform 1 from private.ai_budget_months
  where month = v_event.budget_month for update;
  select pricing.* into v_pricing
  from private.pricing_fx_revisions pricing
  where pricing.id = v_event.pricing_fx_revision_id;

  v_actual := ceiling((
    (p_input_tokens * v_pricing.input_per_million
      + p_output_tokens * v_pricing.output_per_million)
    / 1000000 * v_pricing.fx_to_eur
  ) * 100000000) / 100000000;
  v_status := case
    when p_input_tokens > v_event.max_input_tokens
      or p_output_tokens > v_event.max_output_tokens
      or v_actual > v_event.reserved_upper_bound_eur
    then 'provider_cost_anomaly'
    else 'settled'
  end;

  update private.ai_usage_events
  set input_tokens = p_input_tokens,
      output_tokens = p_output_tokens,
      actual_eur = v_actual,
      status = v_status,
      settled_at = clock_timestamp()
  where id = v_event.id;

  update private.ai_budget_months
  set reserved_upper_bound_eur = greatest(
        0, reserved_upper_bound_eur - v_event.reserved_upper_bound_eur
      ),
      settled_eur = settled_eur + v_actual,
      blocked = blocked or v_status = 'provider_cost_anomaly'
        or settled_eur + v_actual >= cap_eur,
      blocked_reason = case
        when v_status = 'provider_cost_anomaly' then 'provider_cost_anomaly'
        when settled_eur + v_actual >= cap_eur then 'monthly_budget'
        else blocked_reason
      end,
      version = version + 1,
      updated_at = clock_timestamp()
  where month = v_event.budget_month;

  return jsonb_build_object(
    'actualEur', v_actual,
    'eventId', v_event.id,
    'status', v_status
  );
end;
$$;

create function public.internal_ai_mark_pending(
  p_event_id uuid,
  p_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_event private.ai_usage_events%rowtype;
begin
  select usage.* into v_event
  from private.ai_usage_events usage
  where usage.id = p_event_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'usage_event_not_found';
  end if;
  if v_event.request_id <> p_request_id then
    raise exception using errcode = '42501', message = 'request_identity_mismatch';
  end if;
  if v_event.status = 'reserved' then
    update private.ai_usage_events
    set status = 'pending_reconciliation'
    where id = v_event.id;
    v_event.status := 'pending_reconciliation';
  end if;
  return jsonb_build_object('eventId', v_event.id, 'status', v_event.status);
end;
$$;

create function public.internal_ai_store_explanation(
  p_event_id uuid,
  p_request_id uuid,
  p_input_manifest_hash bytea,
  p_output_segments jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_event private.ai_usage_events%rowtype;
  v_explanation private.ai_explanations%rowtype;
begin
  if octet_length(p_input_manifest_hash) <> 32
    or jsonb_typeof(p_output_segments) <> 'array'
  then
    raise exception using errcode = '22023', message = 'invalid_explanation_record';
  end if;
  select usage.* into v_event
  from private.ai_usage_events usage
  where usage.id = p_event_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'usage_event_not_found';
  end if;
  if v_event.request_id <> p_request_id then
    raise exception using errcode = '42501', message = 'request_identity_mismatch';
  end if;
  if v_event.status <> 'settled' then
    raise exception using errcode = '55000', message = 'usage_not_settled';
  end if;

  insert into private.ai_explanations (
    usage_event_id, plan_version_id, provider_revision_id, prompt_version,
    schema_version, policy_version, input_manifest_hash, output_segments
  ) values (
    v_event.id, v_event.plan_version_id, v_event.provider_revision_id,
    'ai-explanation-v1', 1, 'ai-minimization-v1', p_input_manifest_hash,
    p_output_segments
  )
  on conflict (usage_event_id) do nothing;

  select explanation.* into v_explanation
  from private.ai_explanations explanation
  where explanation.usage_event_id = v_event.id;
  return jsonb_build_object('explanationId', v_explanation.id, 'status', 'stored');
end;
$$;

create function public.internal_ai_get_explanation_context(
  p_auth_subject uuid,
  p_auth_session_id uuid,
  p_plan_version_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_profile_id uuid;
  v_version public.plan_versions%rowtype;
  v_modules jsonb;
begin
  select version.*
  into v_version
  from public.plan_versions version
  where version.id = p_plan_version_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'plan_version_not_found';
  end if;
  select plan.profile_id into v_profile_id
  from public.plans plan
  where plan.id = v_version.plan_id;
  perform private.require_questionnaire_access(
    p_auth_subject,
    p_auth_session_id,
    v_profile_id
  );
  if v_version.validation_status <> 'valid' then
    raise exception using errcode = '23514', message = 'plan_validation_failed';
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'confidence', result.confidence,
        'module', result.module,
        'status', result.status,
        'uncertaintyCount', jsonb_array_length(result.uncertainties)
      ) order by result.module
    ),
    '[]'::jsonb
  ) into v_modules
  from public.module_results result
  where result.plan_version_id = p_plan_version_id;

  return jsonb_build_object(
    'completeness', v_version.completeness,
    'modules', v_modules,
    'outputHash', encode(v_version.output_hash, 'hex'),
    'planVersionId', v_version.id,
    'profileId', v_profile_id
  );
end;
$$;

create function public.internal_ai_release_usage(
  p_event_id uuid,
  p_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_event private.ai_usage_events%rowtype;
begin
  select usage.* into v_event
  from private.ai_usage_events usage
  where usage.id = p_event_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'usage_event_not_found';
  end if;
  if v_event.request_id <> p_request_id then
    raise exception using errcode = '42501', message = 'request_identity_mismatch';
  end if;
  if v_event.status = 'released' then
    return jsonb_build_object('eventId', v_event.id, 'status', 'released');
  end if;
  if v_event.status <> 'reserved' then
    raise exception using errcode = '55000', message = 'usage_not_releasable';
  end if;

  perform 1 from private.ai_budget_months
  where month = v_event.budget_month for update;
  update private.ai_usage_events
  set status = 'released'
  where id = v_event.id;
  update private.ai_budget_months
  set reserved_upper_bound_eur = greatest(
        0, reserved_upper_bound_eur - v_event.reserved_upper_bound_eur
      ),
      version = version + 1,
      updated_at = clock_timestamp()
  where month = v_event.budget_month;
  return jsonb_build_object('eventId', v_event.id, 'status', 'released');
end;
$$;

revoke all on function public.internal_admin_activate_ai_provider_revision(uuid, uuid, uuid)
from public, anon, authenticated;
revoke all on function public.internal_admin_activate_ai_provider_revision_requested(uuid, uuid, uuid, uuid)
from public, anon, authenticated;
revoke all on function public.internal_ai_reserve_explanation(uuid, uuid, uuid, uuid, bytea, uuid)
from public, anon, authenticated;
revoke all on function public.internal_ai_settle_usage(uuid, uuid, integer, integer)
from public, anon, authenticated;
revoke all on function public.internal_ai_mark_pending(uuid, uuid)
from public, anon, authenticated;
revoke all on function public.internal_ai_store_explanation(uuid, uuid, bytea, jsonb)
from public, anon, authenticated;
revoke all on function public.internal_ai_get_explanation_context(uuid, uuid, uuid)
from public, anon, authenticated;
revoke all on function public.internal_ai_release_usage(uuid, uuid)
from public, anon, authenticated;

grant execute on function public.internal_admin_activate_ai_provider_revision(uuid, uuid, uuid)
to service_role;
grant execute on function public.internal_admin_activate_ai_provider_revision_requested(uuid, uuid, uuid, uuid)
to service_role;
grant execute on function public.internal_ai_reserve_explanation(uuid, uuid, uuid, uuid, bytea, uuid)
to service_role;
grant execute on function public.internal_ai_settle_usage(uuid, uuid, integer, integer)
to service_role;
grant execute on function public.internal_ai_mark_pending(uuid, uuid)
to service_role;
grant execute on function public.internal_ai_store_explanation(uuid, uuid, bytea, jsonb)
to service_role;
grant execute on function public.internal_ai_get_explanation_context(uuid, uuid, uuid)
to service_role;
grant execute on function public.internal_ai_release_usage(uuid, uuid)
to service_role;
