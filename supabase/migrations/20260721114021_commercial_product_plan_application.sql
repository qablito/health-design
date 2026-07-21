alter table private.plan_idempotency
drop constraint plan_idempotency_operation_check;

alter table private.plan_idempotency
add constraint plan_idempotency_operation_check check (
  operation in (
    'context-snapshot', 'plan-generate', 'version-activate',
    'candidate-create', 'candidate-activate', 'candidate-discard',
    'follow-up-create', 'lab-create', 'export-create', 'product-application'
  )
);

create table public.product_application_events (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.plans (id) on delete cascade,
  base_version_id uuid not null
    references public.plan_versions (id) on delete cascade,
  confirmation_id uuid not null
    references public.product_confirmations (id) on delete cascade,
  product_revision_id uuid not null
    references public.commercial_product_revisions (id) on delete cascade,
  candidate_id uuid not null
    references public.plan_candidates (id) on delete cascade,
  selection jsonb not null check (
    jsonb_typeof(selection) = 'object'
    and octet_length(selection::text) <= 2048
  ),
  idempotency_key_digest bytea not null
    check (octet_length(idempotency_key_digest) = 32),
  request_digest bytea not null check (octet_length(request_digest) = 32),
  created_at timestamptz not null default clock_timestamp(),
  unique (plan_id, idempotency_key_digest)
);

alter table public.product_application_events enable row level security;

revoke all on table public.product_application_events
from public, anon, authenticated, service_role;

create function private.guard_product_application_event()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  raise exception using errcode = '55000', message = 'immutable_product_application';
end;
$$;

create trigger product_application_events_guard_update
before update on public.product_application_events
for each row execute function private.guard_product_application_event();

create function public.internal_commercial_product_for_application(
  p_auth_subject uuid,
  p_auth_session_id uuid,
  p_profile_id uuid,
  p_confirmation_id uuid,
  p_canonical_food_key text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_actor_id uuid;
  v_response jsonb;
begin
  if p_canonical_food_key !~ '^food:[a-z0-9][a-z0-9._:-]{0,127}$' then
    raise exception using errcode = '22023', message = 'invalid_product_application';
  end if;

  v_actor_id := private.require_commercial_product_access(
    p_auth_subject, p_auth_session_id, p_profile_id
  );

  select jsonb_build_object(
    'schemaVersion', 1,
    'confirmationId', confirmation.id,
    'productId', product.id,
    'revisionId', revision.id,
    'manifestId', revision.manifest_id,
    'contentHash', encode(revision.content_hash, 'hex'),
    'completeness', revision.completeness,
    'snapshot', revision.snapshot,
    'matching', jsonb_build_object(
      'canonicalFoodKey', p_canonical_food_key,
      'messageKey', 'commercial_products.matching.' || case
        when matching.id is null then 'exact'
        when food.food_key = p_canonical_food_key then matching.match_state
        else 'review'
      end,
      'state', case
        when matching.id is null then 'exact'
        when food.food_key = p_canonical_food_key then matching.match_state
        else 'review'
      end
    )
  ) into v_response
  from public.product_confirmations confirmation
  join public.commercial_product_revisions revision
    on revision.id = confirmation.revision_id
  join public.commercial_products product
    on product.id = confirmation.product_id
    and product.id = revision.product_id
  left join public.product_matching_rule_revisions matching
    on matching.product_id = product.id and matching.status = 'active'
  left join public.canonical_foods food on food.id = matching.canonical_food_id
  where confirmation.id = p_confirmation_id
    and confirmation.profile_id = p_profile_id
    and confirmation.status = 'active'
    and revision.status in ('profile_confirmed', 'global_approved')
    and (
      revision.owner_profile_id = p_profile_id
      or revision.status = 'global_approved'
    );

  if v_response is null then
    raise exception using
      errcode = 'P0002', message = 'product_confirmation_not_found';
  end if;
  return v_response;
end;
$$;

create function public.internal_create_commercial_product_candidate(
  p_auth_subject uuid,
  p_auth_session_id uuid,
  p_plan_id uuid,
  p_expected_version integer,
  p_base_version_id uuid,
  p_context_snapshot_id uuid,
  p_confirmation_id uuid,
  p_product_revision_id uuid,
  p_selection jsonb,
  p_change_kind text,
  p_change_payload jsonb,
  p_impact text,
  p_diff jsonb,
  p_engine_version text,
  p_canonicalization_version text,
  p_rule_set_revision_id uuid,
  p_source_manifest_id uuid,
  p_input_hash bytea,
  p_output_hash bytea,
  p_engine_completeness text,
  p_validation_status text,
  p_validation jsonb,
  p_module_results jsonb,
  p_safety_findings jsonb,
  p_idempotency_key_digest bytea,
  p_request_digest bytea
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_actor_id uuid;
  v_profile_id uuid;
  v_response jsonb;
begin
  if p_change_kind <> 'commercial_product_applied'
    or jsonb_typeof(p_selection) <> 'object'
    or octet_length(p_selection::text) > 2048
    or (select count(*) from jsonb_object_keys(p_selection)) <> 4
    or jsonb_typeof(p_selection -> 'dayIndex') <> 'number'
    or jsonb_typeof(p_selection -> 'mealIndex') <> 'number'
    or jsonb_typeof(p_selection -> 'foodIndex') <> 'number'
    or (p_selection ->> 'dayIndex')::numeric not between 0 and 6
    or (p_selection ->> 'dayIndex')::numeric <>
      trunc((p_selection ->> 'dayIndex')::numeric)
    or (p_selection ->> 'mealIndex')::numeric not between 0 and 5
    or (p_selection ->> 'mealIndex')::numeric <>
      trunc((p_selection ->> 'mealIndex')::numeric)
    or (p_selection ->> 'foodIndex')::numeric not between 0 and 11
    or (p_selection ->> 'foodIndex')::numeric <>
      trunc((p_selection ->> 'foodIndex')::numeric)
    or p_selection ->> 'expectedCanonicalFoodKey'
      !~ '^food:[a-z0-9][a-z0-9._:-]{0,127}$'
    or not (p_selection ?& array[
      'dayIndex', 'mealIndex', 'foodIndex', 'expectedCanonicalFoodKey'
    ])
    or octet_length(p_idempotency_key_digest) <> 32
    or octet_length(p_request_digest) <> 32 then
    raise exception using errcode = '22023', message = 'invalid_product_application';
  end if;

  select plan.profile_id into v_profile_id
  from public.plans plan where plan.id = p_plan_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'plan_not_found';
  end if;
  v_actor_id := private.require_questionnaire_access(
    p_auth_subject, p_auth_session_id, v_profile_id
  );

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'product-application:' || v_actor_id::text || ':' ||
      v_profile_id::text || ':' || encode(p_idempotency_key_digest, 'hex'),
      0
    )
  );
  v_response := private.get_plan_idempotency(
    v_actor_id, v_profile_id, 'product-application',
    p_idempotency_key_digest, p_request_digest
  );
  if v_response is not null then return v_response; end if;

  if not exists (
    select 1
    from public.product_confirmations confirmation
    join public.commercial_product_revisions revision
      on revision.id = confirmation.revision_id
    where confirmation.id = p_confirmation_id
      and confirmation.profile_id = v_profile_id
      and confirmation.revision_id = p_product_revision_id
      and confirmation.status = 'active'
      and revision.product_id = confirmation.product_id
      and revision.status in ('profile_confirmed', 'global_approved')
      and (
        revision.owner_profile_id = v_profile_id
        or revision.status = 'global_approved'
      )
  ) then
    raise exception using
      errcode = 'P0002', message = 'product_confirmation_not_found';
  end if;

  v_response := public.internal_create_plan_candidate(
    p_auth_subject, p_auth_session_id, p_plan_id, p_expected_version,
    p_base_version_id, p_context_snapshot_id, p_change_kind,
    p_change_payload, p_impact, p_diff, p_engine_version,
    p_canonicalization_version, p_rule_set_revision_id,
    p_source_manifest_id, p_input_hash, p_output_hash,
    p_engine_completeness, p_validation_status, p_validation,
    p_module_results, p_safety_findings, p_idempotency_key_digest,
    p_request_digest
  );

  insert into public.product_application_events (
    plan_id, base_version_id, confirmation_id, product_revision_id,
    candidate_id, selection, idempotency_key_digest, request_digest
  ) values (
    p_plan_id, p_base_version_id, p_confirmation_id, p_product_revision_id,
    (v_response ->> 'candidateId')::uuid, p_selection,
    p_idempotency_key_digest, p_request_digest
  );

  perform private.store_plan_idempotency(
    v_actor_id, v_profile_id, 'product-application',
    p_idempotency_key_digest, p_request_digest, v_response, false
  );
  return v_response;
exception
  when serialization_failure then
    raise exception using errcode = 'PT409', message = 'stale_plan_version';
end;
$$;

revoke all on function private.guard_product_application_event()
from public, anon, authenticated, service_role;
revoke all on function public.internal_commercial_product_for_application(
  uuid, uuid, uuid, uuid, text
) from public, anon, authenticated;
revoke all on function public.internal_create_commercial_product_candidate(
  uuid, uuid, uuid, integer, uuid, uuid, uuid, uuid, jsonb, text, jsonb,
  text, jsonb, text, text, uuid, uuid, bytea, bytea, text, text, jsonb,
  jsonb, jsonb, bytea, bytea
) from public, anon, authenticated;

grant execute on function public.internal_commercial_product_for_application(
  uuid, uuid, uuid, uuid, text
) to service_role;
grant execute on function public.internal_create_commercial_product_candidate(
  uuid, uuid, uuid, integer, uuid, uuid, uuid, uuid, jsonb, text, jsonb,
  text, jsonb, text, text, uuid, uuid, bytea, bytea, text, text, jsonb,
  jsonb, jsonb, bytea, bytea
) to service_role;
