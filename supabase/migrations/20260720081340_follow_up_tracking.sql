alter table private.plan_idempotency
drop constraint plan_idempotency_operation_check;

alter table private.plan_idempotency
add constraint plan_idempotency_operation_check
check (
  operation in (
    'context-snapshot', 'plan-generate', 'version-activate',
    'candidate-create', 'candidate-activate', 'candidate-discard',
    'follow-up-create', 'lab-create'
  )
);

create table public.follow_up_entries (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  plan_id uuid not null references public.plans (id) on delete cascade,
  base_plan_version_id uuid not null
    references public.plan_versions (id) on delete restrict,
  schema_version integer not null default 1 check (schema_version = 1),
  scope text not null check (scope in ('daily', 'weekly', 'four_week')),
  observed_at timestamptz not null,
  values jsonb not null check (
    jsonb_typeof(values) = 'object'
    and values <> '{}'::jsonb
    and octet_length(values::text) <= 131072
  ),
  completeness text not null
    check (completeness in ('complete', 'provisional')),
  request_recalculation boolean not null default false,
  created_at timestamptz not null default clock_timestamp()
);

create index follow_up_entries_profile_observed_idx
on public.follow_up_entries (profile_id, observed_at desc, id desc);

create table public.lab_batches (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  plan_id uuid not null references public.plans (id) on delete cascade,
  base_plan_version_id uuid not null
    references public.plan_versions (id) on delete restrict,
  schema_version integer not null default 1 check (schema_version = 1),
  created_at timestamptz not null default clock_timestamp()
);

create table public.lab_observations (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.lab_batches (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  analyte text not null
    check (analyte in ('b12', 'folate', 'magnesium', 'creatinine', 'egfr', 'other')),
  name text not null check (length(btrim(name)) between 1 and 80),
  value numeric not null,
  unit text check (unit is null or length(btrim(unit)) between 1 and 32),
  reference_minimum numeric,
  reference_maximum numeric,
  reference_unit text check (
    reference_unit is null or length(btrim(reference_unit)) between 1 and 32
  ),
  measurement_kind text not null
    check (measurement_kind in ('exact', 'range', 'unknown')),
  measured_from date,
  measured_to date,
  source text not null
    check (source in ('laboratory', 'device', 'self_reported')),
  confidence text not null
    check (confidence in ('high', 'medium', 'low', 'unknown')),
  created_at timestamptz not null default clock_timestamp(),
  check (
    reference_minimum is null
    or reference_maximum is null
    or reference_minimum <= reference_maximum
  ),
  check (
    (measurement_kind = 'exact'
      and measured_from is not null
      and measured_to = measured_from)
    or (measurement_kind = 'range'
      and measured_from is not null
      and measured_to is not null
      and measured_from <= measured_to)
    or (measurement_kind = 'unknown'
      and measured_from is null
      and measured_to is null)
  )
);

create index lab_observations_profile_analyte_measured_idx
on public.lab_observations (
  profile_id,
  analyte,
  measured_to desc nulls last,
  created_at desc,
  id desc
);

create table public.context_snapshot_origins (
  id uuid primary key default gen_random_uuid(),
  context_snapshot_id uuid not null
    references public.context_snapshots (id) on delete cascade,
  base_context_snapshot_id uuid not null
    references public.context_snapshots (id) on delete restrict,
  source_follow_up_id uuid
    references public.follow_up_entries (id) on delete restrict,
  source_lab_batch_id uuid
    references public.lab_batches (id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  check (num_nonnulls(source_follow_up_id, source_lab_batch_id) = 1)
);

create unique index context_snapshot_origins_follow_up_idx
on public.context_snapshot_origins (source_follow_up_id)
where source_follow_up_id is not null;

create unique index context_snapshot_origins_lab_batch_idx
on public.context_snapshot_origins (source_lab_batch_id)
where source_lab_batch_id is not null;

alter table public.follow_up_entries enable row level security;
alter table public.lab_batches enable row level security;
alter table public.lab_observations enable row level security;
alter table public.context_snapshot_origins enable row level security;

revoke all on table public.follow_up_entries from public, anon, authenticated;
revoke all on table public.lab_batches from public, anon, authenticated;
revoke all on table public.lab_observations from public, anon, authenticated;
revoke all on table public.context_snapshot_origins from public, anon, authenticated;

grant select on table public.follow_up_entries to service_role;
grant select on table public.lab_batches to service_role;
grant select on table public.lab_observations to service_role;
grant select on table public.context_snapshot_origins to service_role;

create function private.reject_follow_up_artifact_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  raise exception using errcode = '55000', message = 'immutable_follow_up_artifact';
end;
$$;

create trigger follow_up_entries_are_immutable
before update on public.follow_up_entries
for each row execute function private.reject_follow_up_artifact_mutation();

create trigger lab_batches_are_immutable
before update on public.lab_batches
for each row execute function private.reject_follow_up_artifact_mutation();

create trigger lab_observations_are_immutable
before update on public.lab_observations
for each row execute function private.reject_follow_up_artifact_mutation();

create trigger context_snapshot_origins_are_immutable
before update on public.context_snapshot_origins
for each row execute function private.reject_follow_up_artifact_mutation();

create function private.require_active_plan_version(
  p_profile_id uuid,
  p_base_plan_version_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_plan_id uuid;
begin
  select plan.id into v_plan_id
  from public.plans plan
  join public.plan_versions version
    on version.id = p_base_plan_version_id
   and version.plan_id = plan.id
  where plan.profile_id = p_profile_id
    and plan.active_version_id = version.id
    and version.status = 'active';
  if not found then
    raise exception using errcode = 'PT409', message = 'base_plan_not_active';
  end if;
  return v_plan_id;
end;
$$;

create function private.follow_up_entry_json(p_entry_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog
as $$
  select jsonb_build_object(
    'id', entry.id,
    'profileId', entry.profile_id,
    'planId', entry.plan_id,
    'basePlanVersionId', entry.base_plan_version_id,
    'scope', entry.scope,
    'observedAt', entry.observed_at,
    'values', entry.values,
    'completeness', entry.completeness,
    'requestRecalculation', entry.request_recalculation,
    'createdAt', entry.created_at
  )
  from public.follow_up_entries entry
  where entry.id = p_entry_id
$$;

create function private.lab_observation_json(p_observation_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog
as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'id', observation.id,
    'profileId', observation.profile_id,
    'analyte', observation.analyte,
    'name', observation.name,
    'value', observation.value::text,
    'unit', observation.unit,
    'measurement', case observation.measurement_kind
      when 'exact' then jsonb_build_object(
        'kind', 'exact', 'date', observation.measured_from
      )
      when 'range' then jsonb_build_object(
        'kind', 'range', 'from', observation.measured_from,
        'to', observation.measured_to
      )
      else jsonb_build_object('kind', 'unknown')
    end,
    'measuredFrom', observation.measured_from,
    'measuredTo', observation.measured_to,
    'source', observation.source,
    'confidence', observation.confidence,
    'referenceRange', case
      when observation.reference_minimum is not null
        or observation.reference_maximum is not null
        or observation.reference_unit is not null
      then jsonb_strip_nulls(jsonb_build_object(
        'minimum', observation.reference_minimum::text,
        'maximum', observation.reference_maximum::text,
        'unit', observation.reference_unit
      ))
      else null
    end,
    'createdAt', observation.created_at
  ))
  from public.lab_observations observation
  where observation.id = p_observation_id
$$;

create function private.record_follow_up(
  p_auth_subject uuid,
  p_auth_session_id uuid,
  p_profile_id uuid,
  p_base_plan_version_id uuid,
  p_scope text,
  p_observed_at timestamptz,
  p_values jsonb,
  p_completeness text,
  p_request_recalculation boolean,
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
  v_entry_id uuid;
  v_plan_id uuid;
  v_response jsonb;
begin
  if p_scope not in ('daily', 'weekly', 'four_week')
    or p_observed_at > clock_timestamp() + interval '1 day'
    or jsonb_typeof(p_values) <> 'object'
    or p_values = '{}'::jsonb
    or octet_length(p_values::text) > 131072
    or p_completeness not in ('complete', 'provisional')
    or octet_length(p_idempotency_key_digest) <> 32
    or octet_length(p_request_digest) <> 32
  then
    raise exception using errcode = '22023', message = 'invalid_input';
  end if;

  v_actor_id := private.require_questionnaire_access(
    p_auth_subject, p_auth_session_id, p_profile_id
  );
  v_response := private.get_plan_idempotency(
    v_actor_id, p_profile_id, 'follow-up-create',
    p_idempotency_key_digest, p_request_digest
  );
  if v_response is not null then return v_response; end if;

  perform pg_advisory_xact_lock(hashtextextended(
    p_profile_id::text || ':follow-up-create', 0
  ));
  v_plan_id := private.require_active_plan_version(
    p_profile_id, p_base_plan_version_id
  );

  insert into public.follow_up_entries (
    profile_id, plan_id, base_plan_version_id, scope, observed_at, values,
    completeness, request_recalculation
  ) values (
    p_profile_id, v_plan_id, p_base_plan_version_id, p_scope, p_observed_at,
    p_values, p_completeness, p_request_recalculation
  ) returning id into v_entry_id;

  v_response := private.follow_up_entry_json(v_entry_id);
  perform private.store_plan_idempotency(
    v_actor_id, p_profile_id, 'follow-up-create',
    p_idempotency_key_digest, p_request_digest, v_response, false
  );
  return v_response;
end;
$$;

create function private.list_follow_ups(
  p_auth_subject uuid,
  p_auth_session_id uuid,
  p_profile_id uuid,
  p_limit integer default 100
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_entries jsonb;
begin
  if p_limit not between 1 and 500 then
    raise exception using errcode = '22023', message = 'invalid_input';
  end if;
  perform private.require_questionnaire_access(
    p_auth_subject, p_auth_session_id, p_profile_id
  );
  select coalesce(jsonb_agg(private.follow_up_entry_json(entry.id)
    order by entry.observed_at desc, entry.id desc), '[]'::jsonb)
  into v_entries
  from (
    select item.id, item.observed_at
    from public.follow_up_entries item
    where item.profile_id = p_profile_id
    order by item.observed_at desc, item.id desc
    limit p_limit
  ) entry;
  return jsonb_build_object('profileId', p_profile_id, 'entries', v_entries);
end;
$$;

create function private.record_lab_batch(
  p_auth_subject uuid,
  p_auth_session_id uuid,
  p_profile_id uuid,
  p_base_plan_version_id uuid,
  p_observations jsonb,
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
  v_batch_id uuid;
  v_item jsonb;
  v_measurement_kind text;
  v_measured_from date;
  v_measured_to date;
  v_observation_id uuid;
  v_observation_ids uuid[] := array[]::uuid[];
  v_plan_id uuid;
  v_response jsonb;
begin
  if jsonb_typeof(p_observations) <> 'array'
    or jsonb_array_length(p_observations) not between 1 and 4
    or octet_length(p_observations::text) > 65536
    or octet_length(p_idempotency_key_digest) <> 32
    or octet_length(p_request_digest) <> 32
  then
    raise exception using errcode = '22023', message = 'invalid_input';
  end if;

  v_actor_id := private.require_questionnaire_access(
    p_auth_subject, p_auth_session_id, p_profile_id
  );
  v_response := private.get_plan_idempotency(
    v_actor_id, p_profile_id, 'lab-create',
    p_idempotency_key_digest, p_request_digest
  );
  if v_response is not null then return v_response; end if;

  perform pg_advisory_xact_lock(hashtextextended(
    p_profile_id::text || ':lab-create', 0
  ));
  v_plan_id := private.require_active_plan_version(
    p_profile_id, p_base_plan_version_id
  );
  insert into public.lab_batches (profile_id, plan_id, base_plan_version_id)
  values (p_profile_id, v_plan_id, p_base_plan_version_id)
  returning id into v_batch_id;

  for v_item in select value from jsonb_array_elements(p_observations)
  loop
    if jsonb_typeof(v_item) <> 'object'
      or (v_item ->> 'analyte') not in (
        'b12', 'folate', 'magnesium', 'creatinine', 'egfr', 'other'
      )
      or length(btrim(coalesce(v_item ->> 'name', ''))) not between 1 and 80
      or (v_item ->> 'source') not in ('laboratory', 'device', 'self_reported')
      or (v_item ->> 'confidence') not in ('high', 'medium', 'low', 'unknown')
      or coalesce(v_item ->> 'value', '') !~ '^-?(0|[1-9][0-9]*)(\.[0-9]+)?$'
    then
      raise exception using errcode = '22023', message = 'invalid_input';
    end if;

    v_measurement_kind := v_item #>> '{measurement,kind}';
    if v_measurement_kind = 'exact' then
      v_measured_from := (v_item #>> '{measurement,date}')::date;
      v_measured_to := v_measured_from;
    elsif v_measurement_kind = 'range' then
      v_measured_from := (v_item #>> '{measurement,from}')::date;
      v_measured_to := (v_item #>> '{measurement,to}')::date;
    elsif v_measurement_kind = 'unknown' then
      v_measured_from := null;
      v_measured_to := null;
    else
      raise exception using errcode = '22023', message = 'invalid_input';
    end if;
    if v_measured_from is not null and v_measured_to < v_measured_from then
      raise exception using errcode = '22023', message = 'invalid_input';
    end if;

    insert into public.lab_observations (
      batch_id, profile_id, analyte, name, value, unit,
      reference_minimum, reference_maximum, reference_unit,
      measurement_kind, measured_from, measured_to, source, confidence
    ) values (
      v_batch_id, p_profile_id, v_item ->> 'analyte', btrim(v_item ->> 'name'),
      (v_item ->> 'value')::numeric, nullif(btrim(v_item ->> 'unit'), ''),
      nullif(v_item #>> '{referenceRange,minimum}', '')::numeric,
      nullif(v_item #>> '{referenceRange,maximum}', '')::numeric,
      nullif(btrim(v_item #>> '{referenceRange,unit}'), ''),
      v_measurement_kind, v_measured_from, v_measured_to,
      v_item ->> 'source', v_item ->> 'confidence'
    ) returning id into v_observation_id;
    v_observation_ids := array_append(v_observation_ids, v_observation_id);
  end loop;

  select jsonb_build_object(
    'batchId', v_batch_id,
    'observations', jsonb_agg(private.lab_observation_json(id) order by ordinal)
  ) into v_response
  from unnest(v_observation_ids) with ordinality as inserted(id, ordinal);
  perform private.store_plan_idempotency(
    v_actor_id, p_profile_id, 'lab-create',
    p_idempotency_key_digest, p_request_digest, v_response, false
  );
  return v_response;
exception
  when invalid_text_representation or numeric_value_out_of_range then
    raise exception using errcode = '22023', message = 'invalid_input';
end;
$$;

create function private.list_lab_observations(
  p_auth_subject uuid,
  p_auth_session_id uuid,
  p_profile_id uuid,
  p_limit integer default 500
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_observations jsonb;
begin
  if p_limit not between 1 and 500 then
    raise exception using errcode = '22023', message = 'invalid_input';
  end if;
  perform private.require_questionnaire_access(
    p_auth_subject, p_auth_session_id, p_profile_id
  );
  select coalesce(jsonb_agg(private.lab_observation_json(item.id)
    order by item.measured_to desc nulls last, item.created_at desc, item.id desc),
    '[]'::jsonb)
  into v_observations
  from (
    select observation.id, observation.measured_to,
      observation.created_at
    from public.lab_observations observation
    where observation.profile_id = p_profile_id
    order by observation.measured_to desc nulls last,
      observation.created_at desc, observation.id desc
    limit p_limit
  ) item;
  return jsonb_build_object(
    'profileId', p_profile_id,
    'observations', v_observations
  );
end;
$$;

create function private.create_derived_context_snapshot(
  p_auth_subject uuid,
  p_auth_session_id uuid,
  p_profile_id uuid,
  p_base_plan_version_id uuid,
  p_source_kind text,
  p_source_id uuid,
  p_effective_at timestamptz,
  p_answers jsonb,
  p_completeness text,
  p_input_hash bytea
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_base public.context_snapshots%rowtype;
  v_existing_origin public.context_snapshot_origins%rowtype;
  v_existing_hash bytea;
  v_snapshot_id uuid;
begin
  perform private.require_questionnaire_access(
    p_auth_subject, p_auth_session_id, p_profile_id
  );
  perform private.require_active_plan_version(
    p_profile_id, p_base_plan_version_id
  );
  if p_source_kind not in ('follow_up', 'lab_batch')
    or jsonb_typeof(p_answers) <> 'object'
    or octet_length(p_answers::text) > 262144
    or p_completeness not in ('complete', 'provisional')
    or octet_length(p_input_hash) <> 32
  then
    raise exception using errcode = '22023', message = 'invalid_input';
  end if;

  select snapshot.* into v_base
  from public.plan_versions version
  join public.context_snapshots snapshot on snapshot.id = version.context_snapshot_id
  where version.id = p_base_plan_version_id
    and snapshot.profile_id = p_profile_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'context_not_found';
  end if;

  if p_source_kind = 'follow_up' then
    select origin.* into v_existing_origin
    from public.context_snapshot_origins origin
    join public.follow_up_entries entry on entry.id = origin.source_follow_up_id
    where origin.source_follow_up_id = p_source_id
      and entry.profile_id = p_profile_id;
    if not found and not exists (
      select 1 from public.follow_up_entries entry
      where entry.id = p_source_id
        and entry.profile_id = p_profile_id
        and entry.base_plan_version_id = p_base_plan_version_id
    ) then
      raise exception using errcode = 'P0002', message = 'follow_up_not_found';
    end if;
  else
    select origin.* into v_existing_origin
    from public.context_snapshot_origins origin
    join public.lab_batches batch on batch.id = origin.source_lab_batch_id
    where origin.source_lab_batch_id = p_source_id
      and batch.profile_id = p_profile_id;
    if not found and not exists (
      select 1 from public.lab_batches batch
      where batch.id = p_source_id
        and batch.profile_id = p_profile_id
        and batch.base_plan_version_id = p_base_plan_version_id
    ) then
      raise exception using errcode = 'P0002', message = 'lab_batch_not_found';
    end if;
  end if;

  if v_existing_origin.id is not null then
    select snapshot.input_hash into v_existing_hash
    from public.context_snapshots snapshot
    where snapshot.id = v_existing_origin.context_snapshot_id;
    if v_existing_hash <> p_input_hash then
      raise exception using errcode = '23505', message = 'idempotency_key_reused';
    end if;
    return private.context_snapshot_json(v_existing_origin.context_snapshot_id);
  end if;

  insert into public.context_snapshots (
    profile_id, source_draft_id, source_draft_version, schema_version,
    effective_at, answers, completeness, normalization_version,
    input_hash, canonicalization_version
  ) values (
    p_profile_id, v_base.source_draft_id, v_base.source_draft_version,
    v_base.schema_version, p_effective_at, p_answers, p_completeness,
    v_base.normalization_version, p_input_hash, v_base.canonicalization_version
  ) on conflict do nothing
  returning id into v_snapshot_id;

  if v_snapshot_id is null then
    select snapshot.id into v_snapshot_id
    from public.context_snapshots snapshot
    where snapshot.profile_id = p_profile_id
      and snapshot.source_draft_id = v_base.source_draft_id
      and snapshot.source_draft_version = v_base.source_draft_version
      and snapshot.normalization_version = v_base.normalization_version
      and snapshot.input_hash = p_input_hash;
  end if;

  insert into public.context_snapshot_origins (
    context_snapshot_id, base_context_snapshot_id,
    source_follow_up_id, source_lab_batch_id
  ) values (
    v_snapshot_id, v_base.id,
    case when p_source_kind = 'follow_up' then p_source_id else null end,
    case when p_source_kind = 'lab_batch' then p_source_id else null end
  );
  return private.context_snapshot_json(v_snapshot_id);
end;
$$;

create function public.internal_record_follow_up(
  p_auth_subject uuid,
  p_auth_session_id uuid,
  p_profile_id uuid,
  p_base_plan_version_id uuid,
  p_scope text,
  p_observed_at timestamptz,
  p_values jsonb,
  p_completeness text,
  p_request_recalculation boolean,
  p_idempotency_key_digest bytea,
  p_request_digest bytea
)
returns jsonb
language sql
security definer
set search_path = pg_catalog
as $$
  select private.record_follow_up(
    p_auth_subject, p_auth_session_id, p_profile_id, p_base_plan_version_id,
    p_scope, p_observed_at, p_values, p_completeness,
    p_request_recalculation, p_idempotency_key_digest, p_request_digest
  )
$$;

create function public.internal_list_follow_ups(
  p_auth_subject uuid,
  p_auth_session_id uuid,
  p_profile_id uuid,
  p_limit integer default 100
)
returns jsonb
language sql
security definer
set search_path = pg_catalog
as $$
  select private.list_follow_ups(
    p_auth_subject, p_auth_session_id, p_profile_id, p_limit
  )
$$;

create function public.internal_record_lab_batch(
  p_auth_subject uuid,
  p_auth_session_id uuid,
  p_profile_id uuid,
  p_base_plan_version_id uuid,
  p_observations jsonb,
  p_idempotency_key_digest bytea,
  p_request_digest bytea
)
returns jsonb
language sql
security definer
set search_path = pg_catalog
as $$
  select private.record_lab_batch(
    p_auth_subject, p_auth_session_id, p_profile_id, p_base_plan_version_id,
    p_observations, p_idempotency_key_digest, p_request_digest
  )
$$;

create function public.internal_list_lab_observations(
  p_auth_subject uuid,
  p_auth_session_id uuid,
  p_profile_id uuid,
  p_limit integer default 500
)
returns jsonb
language sql
security definer
set search_path = pg_catalog
as $$
  select private.list_lab_observations(
    p_auth_subject, p_auth_session_id, p_profile_id, p_limit
  )
$$;

create function public.internal_create_derived_context_snapshot(
  p_auth_subject uuid,
  p_auth_session_id uuid,
  p_profile_id uuid,
  p_base_plan_version_id uuid,
  p_source_kind text,
  p_source_id uuid,
  p_effective_at timestamptz,
  p_answers jsonb,
  p_completeness text,
  p_input_hash bytea
)
returns jsonb
language sql
security definer
set search_path = pg_catalog
as $$
  select private.create_derived_context_snapshot(
    p_auth_subject, p_auth_session_id, p_profile_id, p_base_plan_version_id,
    p_source_kind, p_source_id, p_effective_at, p_answers, p_completeness,
    p_input_hash
  )
$$;

revoke all on function private.reject_follow_up_artifact_mutation()
from public, anon, authenticated, service_role;
revoke all on function private.require_active_plan_version(uuid, uuid)
from public, anon, authenticated, service_role;
revoke all on function private.follow_up_entry_json(uuid)
from public, anon, authenticated, service_role;
revoke all on function private.lab_observation_json(uuid)
from public, anon, authenticated, service_role;
revoke all on function private.record_follow_up(
  uuid, uuid, uuid, uuid, text, timestamptz, jsonb, text, boolean, bytea, bytea
) from public, anon, authenticated, service_role;
revoke all on function private.list_follow_ups(uuid, uuid, uuid, integer)
from public, anon, authenticated, service_role;
revoke all on function private.record_lab_batch(
  uuid, uuid, uuid, uuid, jsonb, bytea, bytea
) from public, anon, authenticated, service_role;
revoke all on function private.list_lab_observations(uuid, uuid, uuid, integer)
from public, anon, authenticated, service_role;
revoke all on function private.create_derived_context_snapshot(
  uuid, uuid, uuid, uuid, text, uuid, timestamptz, jsonb, text, bytea
) from public, anon, authenticated, service_role;

revoke all on function public.internal_record_follow_up(
  uuid, uuid, uuid, uuid, text, timestamptz, jsonb, text, boolean, bytea, bytea
) from public, anon, authenticated;
revoke all on function public.internal_list_follow_ups(uuid, uuid, uuid, integer)
from public, anon, authenticated;
revoke all on function public.internal_record_lab_batch(
  uuid, uuid, uuid, uuid, jsonb, bytea, bytea
) from public, anon, authenticated;
revoke all on function public.internal_list_lab_observations(
  uuid, uuid, uuid, integer
) from public, anon, authenticated;
revoke all on function public.internal_create_derived_context_snapshot(
  uuid, uuid, uuid, uuid, text, uuid, timestamptz, jsonb, text, bytea
) from public, anon, authenticated;

grant execute on function public.internal_record_follow_up(
  uuid, uuid, uuid, uuid, text, timestamptz, jsonb, text, boolean, bytea, bytea
) to service_role;
grant execute on function public.internal_list_follow_ups(uuid, uuid, uuid, integer)
to service_role;
grant execute on function public.internal_record_lab_batch(
  uuid, uuid, uuid, uuid, jsonb, bytea, bytea
) to service_role;
grant execute on function public.internal_list_lab_observations(
  uuid, uuid, uuid, integer
) to service_role;
grant execute on function public.internal_create_derived_context_snapshot(
  uuid, uuid, uuid, uuid, text, uuid, timestamptz, jsonb, text, bytea
) to service_role;
