create table public.context_snapshots (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null
    references public.profiles (id) on delete cascade,
  source_draft_id uuid not null
    references public.questionnaire_drafts (id) on delete restrict,
  source_draft_version integer not null check (source_draft_version > 0),
  schema_version integer not null default 1 check (schema_version = 1),
  effective_at timestamptz not null,
  answers jsonb not null
    check (
      jsonb_typeof(answers) = 'object'
      and octet_length(answers::text) <= 262144
    ),
  completeness text not null
    check (completeness in ('complete', 'provisional')),
  normalization_version text not null
    check (normalization_version ~ '^[a-z0-9][a-z0-9._-]{0,63}$'),
  input_hash bytea not null check (octet_length(input_hash) = 32),
  hash_algorithm text not null default 'sha256'
    check (hash_algorithm = 'sha256'),
  canonicalization_version text not null
    check (canonicalization_version ~ '^[a-z0-9][a-z0-9._-]{0,63}$'),
  created_at timestamptz not null default clock_timestamp(),
  unique (
    profile_id,
    source_draft_id,
    source_draft_version,
    normalization_version,
    input_hash
  )
);

create index context_snapshots_profile_created_idx
on public.context_snapshots (profile_id, created_at desc);

alter table public.context_snapshots enable row level security;

revoke all on table public.context_snapshots
from public, anon, authenticated;
grant select on table public.context_snapshots to service_role;

create table public.plans (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null unique
    references public.profiles (id) on delete cascade,
  active_version_id uuid,
  aggregate_version integer not null default 1 check (aggregate_version > 0),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  check (updated_at >= created_at)
);

create table public.change_events (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null
    references public.profiles (id) on delete cascade,
  kind text not null check (kind ~ '^[a-z][a-z0-9_]{0,63}$'),
  payload jsonb not null
    check (
      jsonb_typeof(payload) = 'object'
      and octet_length(payload::text) <= 65536
    ),
  effective_at timestamptz not null,
  impact_status text not null check (
    impact_status in (
      'unaffected', 'module_only', 'dependent_modules', 'structural'
    )
  ),
  created_at timestamptz not null default clock_timestamp()
);

create table public.plan_versions (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.plans (id) on delete cascade,
  ordinal integer not null check (ordinal > 0),
  status text not null default 'draft'
    check (status in ('draft', 'active', 'archived')),
  completeness text not null
    check (completeness in ('complete', 'provisional')),
  validation_status text not null
    check (validation_status in ('valid', 'invalid')),
  validation jsonb not null
    check (
      jsonb_typeof(validation) = 'object'
      and octet_length(validation::text) <= 65536
    ),
  context_snapshot_id uuid not null
    references public.context_snapshots (id) on delete restrict,
  engine_version text not null
    check (engine_version ~ '^[a-z0-9][a-z0-9._-]{0,63}$'),
  rule_set_revision_id uuid not null,
  source_manifest_id uuid not null,
  input_hash bytea not null check (octet_length(input_hash) = 32),
  output_hash bytea not null check (octet_length(output_hash) = 32),
  hash_algorithm text not null default 'sha256'
    check (hash_algorithm = 'sha256'),
  canonicalization_version text not null
    check (canonicalization_version ~ '^[a-z0-9][a-z0-9._-]{0,63}$'),
  created_at timestamptz not null default clock_timestamp(),
  validated_at timestamptz not null default clock_timestamp(),
  activated_at timestamptz,
  activated_by uuid references public.actors (id) on delete restrict,
  archived_at timestamptz,
  unique (plan_id, ordinal),
  check (validated_at >= created_at),
  check (activated_at is null or activated_at >= created_at),
  check (archived_at is null or archived_at >= created_at),
  check (
    (status = 'draft' and activated_at is null and archived_at is null)
    or (status = 'active' and activated_at is not null and archived_at is null)
    or (status = 'archived' and archived_at is not null)
  )
);

create unique index plan_versions_one_active_idx
on public.plan_versions (plan_id)
where status = 'active';

create index plan_versions_history_idx
on public.plan_versions (plan_id, ordinal desc);

alter table public.plans
  add constraint plans_active_version_fk
  foreign key (active_version_id)
  references public.plan_versions (id)
  on delete set null;

create table public.module_results (
  id uuid primary key default gen_random_uuid(),
  plan_version_id uuid not null
    references public.plan_versions (id) on delete cascade,
  module text not null check (
    module in (
      'nutrition', 'training', 'hydration', 'sleep', 'mobility', 'supplements'
    )
  ),
  status text not null
    check (status in ('valid', 'provisional', 'invalid', 'not_requested')),
  confidence text not null
    check (confidence in ('high', 'medium', 'low', 'unknown')),
  payload jsonb not null
    check (
      jsonb_typeof(payload) = 'object'
      and octet_length(payload::text) <= 524288
    ),
  uncertainties jsonb not null default '[]'::jsonb
    check (
      jsonb_typeof(uncertainties) = 'array'
      and octet_length(uncertainties::text) <= 65536
    ),
  created_at timestamptz not null default clock_timestamp(),
  unique (plan_version_id, module)
);

create table public.safety_findings (
  id uuid primary key default gen_random_uuid(),
  plan_version_id uuid not null
    references public.plan_versions (id) on delete cascade,
  module text not null check (
    module in (
      'nutrition', 'training', 'hydration', 'sleep', 'mobility', 'supplements'
    )
  ),
  action_level text not null check (
    action_level in (
      'information', 'adjustment', 'priority_review', 'immediate_conservative'
    )
  ),
  code text not null check (code ~ '^[A-Z][A-Z0-9_]{0,79}$'),
  message_key text not null check (length(message_key) between 1 and 160),
  evidence_ref text not null check (length(evidence_ref) between 1 and 256),
  created_at timestamptz not null default clock_timestamp()
);

create index safety_findings_version_idx
on public.safety_findings (plan_version_id, action_level, id);

create table public.plan_candidates (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.plans (id) on delete cascade,
  change_event_id uuid not null unique
    references public.change_events (id) on delete restrict,
  base_version_id uuid not null
    references public.plan_versions (id) on delete restrict,
  candidate_version_id uuid not null unique
    references public.plan_versions (id) on delete restrict,
  impact text not null check (
    impact in ('unaffected', 'module_only', 'dependent_modules', 'structural')
  ),
  diff jsonb not null
    check (
      jsonb_typeof(diff) = 'object'
      and octet_length(diff::text) <= 65536
    ),
  validation jsonb not null
    check (
      jsonb_typeof(validation) = 'object'
      and octet_length(validation::text) <= 65536
    ),
  status text not null
    check (status in ('pending', 'activated', 'discarded', 'invalid')),
  created_at timestamptz not null default clock_timestamp(),
  resolved_at timestamptz,
  check (resolved_at is null or resolved_at >= created_at),
  check (
    (status = 'pending' and resolved_at is null)
    or (status in ('activated', 'discarded') and resolved_at is not null)
    or status = 'invalid'
  )
);

create index plan_candidates_plan_created_idx
on public.plan_candidates (plan_id, created_at desc);

create table private.plan_idempotency (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null references public.actors (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  operation text not null check (
    operation in (
      'context-snapshot', 'plan-generate', 'version-activate',
      'candidate-create', 'candidate-activate', 'candidate-discard'
    )
  ),
  key_digest bytea not null check (octet_length(key_digest) = 32),
  request_digest bytea not null check (octet_length(request_digest) = 32),
  response jsonb not null check (jsonb_typeof(response) = 'object'),
  created_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz,
  check (expires_at is null or expires_at > created_at),
  unique (actor_id, profile_id, operation, key_digest)
);

create index plan_idempotency_expiry_idx
on private.plan_idempotency (expires_at)
where expires_at is not null;

alter table public.plans enable row level security;
alter table public.change_events enable row level security;
alter table public.plan_versions enable row level security;
alter table public.module_results enable row level security;
alter table public.safety_findings enable row level security;
alter table public.plan_candidates enable row level security;
alter table private.plan_idempotency enable row level security;

revoke all on table public.plans from public, anon, authenticated;
revoke all on table public.change_events from public, anon, authenticated;
revoke all on table public.plan_versions from public, anon, authenticated;
revoke all on table public.module_results from public, anon, authenticated;
revoke all on table public.safety_findings from public, anon, authenticated;
revoke all on table public.plan_candidates from public, anon, authenticated;
revoke all on table private.plan_idempotency
from public, anon, authenticated, service_role;

grant select on table public.plans to service_role;
grant select on table public.change_events to service_role;
grant select on table public.plan_versions to service_role;
grant select on table public.module_results to service_role;
grant select on table public.safety_findings to service_role;
grant select on table public.plan_candidates to service_role;

create function private.reject_context_snapshot_update()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  raise exception using
    errcode = '55000',
    message = 'immutable_context_snapshot';
end;
$$;

create trigger context_snapshots_are_immutable
before update on public.context_snapshots
for each row execute function private.reject_context_snapshot_update();

create function private.guard_plan_version_update()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  if new.plan_id is distinct from old.plan_id
    or new.ordinal is distinct from old.ordinal
    or new.completeness is distinct from old.completeness
    or new.validation_status is distinct from old.validation_status
    or new.validation is distinct from old.validation
    or new.context_snapshot_id is distinct from old.context_snapshot_id
    or new.engine_version is distinct from old.engine_version
    or new.rule_set_revision_id is distinct from old.rule_set_revision_id
    or new.source_manifest_id is distinct from old.source_manifest_id
    or new.input_hash is distinct from old.input_hash
    or new.output_hash is distinct from old.output_hash
    or new.hash_algorithm is distinct from old.hash_algorithm
    or new.canonicalization_version is distinct from old.canonicalization_version
    or new.created_at is distinct from old.created_at
    or new.validated_at is distinct from old.validated_at
  then
    raise exception using errcode = '55000', message = 'immutable_plan_version';
  end if;

  if new.status = old.status then
    return new;
  end if;
  if old.status = 'draft' and new.status in ('active', 'archived') then
    return new;
  end if;
  if old.status = 'active' and new.status = 'archived' then
    return new;
  end if;
  raise exception using errcode = '55000', message = 'invalid_plan_transition';
end;
$$;

create trigger plan_versions_guard_update
before update on public.plan_versions
for each row execute function private.guard_plan_version_update();

create function private.reject_plan_artifact_update()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  raise exception using errcode = '55000', message = 'immutable_plan_artifact';
end;
$$;

create trigger module_results_are_immutable
before update on public.module_results
for each row execute function private.reject_plan_artifact_update();

create trigger safety_findings_are_immutable
before update on public.safety_findings
for each row execute function private.reject_plan_artifact_update();

create function private.guard_plan_candidate_update()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  if new.plan_id is distinct from old.plan_id
    or new.change_event_id is distinct from old.change_event_id
    or new.base_version_id is distinct from old.base_version_id
    or new.candidate_version_id is distinct from old.candidate_version_id
    or new.impact is distinct from old.impact
    or new.diff is distinct from old.diff
    or new.validation is distinct from old.validation
    or new.created_at is distinct from old.created_at
  then
    raise exception using errcode = '55000', message = 'immutable_plan_candidate';
  end if;
  if old.status = 'pending' and new.status in ('activated', 'discarded') then
    return new;
  end if;
  if new.status = old.status then
    return new;
  end if;
  raise exception using errcode = '55000', message = 'invalid_candidate_transition';
end;
$$;

create trigger plan_candidates_guard_update
before update on public.plan_candidates
for each row execute function private.guard_plan_candidate_update();

create function private.get_plan_idempotency(
  p_actor_id uuid,
  p_profile_id uuid,
  p_operation text,
  p_key_digest bytea,
  p_request_digest bytea
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_entry private.plan_idempotency%rowtype;
begin
  delete from private.plan_idempotency
  where expires_at is not null and expires_at <= clock_timestamp();

  select entry.* into v_entry
  from private.plan_idempotency entry
  where entry.actor_id = p_actor_id
    and entry.profile_id = p_profile_id
    and entry.operation = p_operation
    and entry.key_digest = p_key_digest;

  if not found then
    return null;
  end if;
  if v_entry.request_digest <> p_request_digest then
    raise exception using errcode = '23505', message = 'idempotency_key_reused';
  end if;
  return v_entry.response;
end;
$$;

create function private.store_plan_idempotency(
  p_actor_id uuid,
  p_profile_id uuid,
  p_operation text,
  p_key_digest bytea,
  p_request_digest bytea,
  p_response jsonb,
  p_permanent boolean default false
)
returns void
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  insert into private.plan_idempotency (
    actor_id, profile_id, operation, key_digest, request_digest, response,
    expires_at
  ) values (
    p_actor_id, p_profile_id, p_operation, p_key_digest, p_request_digest,
    p_response,
    case when p_permanent then null else clock_timestamp() + interval '24 hours' end
  );
end;
$$;

create function private.context_snapshot_json(p_snapshot_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog
as $$
  select jsonb_build_object(
    'id', snapshot.id,
    'profileId', snapshot.profile_id,
    'sourceDraftId', snapshot.source_draft_id,
    'sourceDraftVersion', snapshot.source_draft_version,
    'schemaVersion', snapshot.schema_version,
    'effectiveAt', snapshot.effective_at,
    'completeness', snapshot.completeness,
    'normalizationVersion', snapshot.normalization_version,
    'canonicalizationVersion', snapshot.canonicalization_version,
    'inputHash', encode(snapshot.input_hash, 'hex'),
    'createdAt', snapshot.created_at
  )
  from public.context_snapshots snapshot
  where snapshot.id = p_snapshot_id
$$;

create function private.plan_version_json(p_plan_version_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog
as $$
  select jsonb_build_object(
    'id', version.id,
    'planId', version.plan_id,
    'ordinal', version.ordinal,
    'status', version.status,
    'completeness', version.completeness,
    'validationStatus', version.validation_status,
    'validation', version.validation,
    'contextSnapshotId', version.context_snapshot_id,
    'engineVersion', version.engine_version,
    'ruleSetRevisionId', version.rule_set_revision_id,
    'sourceManifestId', version.source_manifest_id,
    'inputHash', encode(version.input_hash, 'hex'),
    'outputHash', encode(version.output_hash, 'hex'),
    'hashAlgorithm', version.hash_algorithm,
    'canonicalizationVersion', version.canonicalization_version,
    'createdAt', version.created_at,
    'validatedAt', version.validated_at,
    'activatedAt', version.activated_at,
    'archivedAt', version.archived_at
  )
  from public.plan_versions version
  where version.id = p_plan_version_id
$$;

create function private.plan_ack(
  p_plan_id uuid,
  p_plan_version_id uuid,
  p_candidate_id uuid default null
)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog
as $$
  select jsonb_build_object(
    'planId', plan.id,
    'planVersionId', version.id,
    'aggregateVersion', plan.aggregate_version,
    'activeVersionId', plan.active_version_id,
    'ordinal', version.ordinal,
    'status', version.status,
    'completeness', version.completeness,
    'validationStatus', version.validation_status,
    'contextSnapshotId', version.context_snapshot_id,
    'createdAt', version.created_at,
    'activatedAt', version.activated_at,
    'archivedAt', version.archived_at
  ) || case
    when candidate.id is null then '{}'::jsonb
    else jsonb_build_object(
      'candidateId', candidate.id,
      'candidateStatus', candidate.status,
      'changeEventId', candidate.change_event_id,
      'baseVersionId', candidate.base_version_id,
      'impact', candidate.impact,
      'diff', candidate.diff,
      'validation', candidate.validation,
      'resolvedAt', candidate.resolved_at
    )
  end
  from public.plans plan
  join public.plan_versions version on version.id = p_plan_version_id
  left join public.plan_candidates candidate on candidate.id = p_candidate_id
  where plan.id = p_plan_id and version.plan_id = plan.id
$$;

create function private.insert_plan_artifacts(
  p_plan_version_id uuid,
  p_module_results jsonb,
  p_safety_findings jsonb
)
returns void
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_item jsonb;
begin
  if jsonb_typeof(p_module_results) <> 'array'
    or jsonb_array_length(p_module_results) > 6
    or octet_length(p_module_results::text) > 2097152
    or jsonb_typeof(p_safety_findings) <> 'array'
    or jsonb_array_length(p_safety_findings) > 100
    or octet_length(p_safety_findings::text) > 262144
  then
    raise exception using errcode = '22023', message = 'invalid_plan_artifacts';
  end if;

  for v_item in select value from jsonb_array_elements(p_module_results)
  loop
    if jsonb_typeof(v_item) <> 'object'
      or v_item - array[
        'module', 'status', 'confidence', 'payload', 'uncertainties'
      ]::text[] <> '{}'::jsonb
      or jsonb_typeof(v_item -> 'payload') <> 'object'
      or jsonb_typeof(v_item -> 'uncertainties') <> 'array'
    then
      raise exception using errcode = '22023', message = 'invalid_module_result';
    end if;
    insert into public.module_results (
      plan_version_id, module, status, confidence, payload, uncertainties
    ) values (
      p_plan_version_id,
      v_item ->> 'module',
      v_item ->> 'status',
      v_item ->> 'confidence',
      v_item -> 'payload',
      v_item -> 'uncertainties'
    );
  end loop;

  for v_item in select value from jsonb_array_elements(p_safety_findings)
  loop
    if jsonb_typeof(v_item) <> 'object'
      or v_item - array[
        'module', 'actionLevel', 'code', 'messageKey', 'evidenceRef'
      ]::text[] <> '{}'::jsonb
    then
      raise exception using errcode = '22023', message = 'invalid_safety_finding';
    end if;
    insert into public.safety_findings (
      plan_version_id, module, action_level, code, message_key, evidence_ref
    ) values (
      p_plan_version_id,
      v_item ->> 'module',
      v_item ->> 'actionLevel',
      v_item ->> 'code',
      v_item ->> 'messageKey',
      v_item ->> 'evidenceRef'
    );
  end loop;
end;
$$;

create function private.create_context_snapshot(
  p_auth_subject uuid,
  p_auth_session_id uuid,
  p_profile_id uuid,
  p_expected_draft_version integer,
  p_normalization_version text,
  p_canonicalization_version text,
  p_input_hash bytea,
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
  v_draft public.questionnaire_drafts%rowtype;
  v_snapshot_id uuid;
  v_response jsonb;
begin
  if p_expected_draft_version < 1
    or p_normalization_version !~ '^[a-z0-9][a-z0-9._-]{0,63}$'
    or p_canonicalization_version !~ '^[a-z0-9][a-z0-9._-]{0,63}$'
    or octet_length(p_input_hash) <> 32
    or octet_length(p_idempotency_key_digest) <> 32
    or octet_length(p_request_digest) <> 32
  then
    raise exception using errcode = '22023', message = 'invalid_input';
  end if;

  v_actor_id := private.require_questionnaire_access(
    p_auth_subject, p_auth_session_id, p_profile_id
  );
  v_response := private.get_plan_idempotency(
    v_actor_id, p_profile_id, 'context-snapshot',
    p_idempotency_key_digest, p_request_digest
  );
  if v_response is not null then
    return v_response;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    p_profile_id::text || ':context-snapshot', 0
  ));
  select draft.* into v_draft
  from public.questionnaire_drafts draft
  where draft.profile_id = p_profile_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'draft_not_found';
  end if;
  if v_draft.version <> p_expected_draft_version then
    raise exception using errcode = '40001', message = 'version_conflict';
  end if;
  if v_draft.status <> 'submitted' or jsonb_array_length(v_draft.hard_errors) <> 0 then
    raise exception using errcode = 'P0001', message = 'draft_not_submitted';
  end if;

  select snapshot.id into v_snapshot_id
  from public.context_snapshots snapshot
  where snapshot.profile_id = p_profile_id
    and snapshot.source_draft_id = v_draft.id
    and snapshot.source_draft_version = v_draft.version
    and snapshot.normalization_version = p_normalization_version
    and snapshot.input_hash = p_input_hash;

  if v_snapshot_id is null then
    insert into public.context_snapshots (
      profile_id, source_draft_id, source_draft_version, schema_version,
      effective_at, answers, completeness, normalization_version,
      input_hash, canonicalization_version
    ) values (
      p_profile_id, v_draft.id, v_draft.version, v_draft.schema_version,
      v_draft.updated_at, v_draft.answers, v_draft.completeness,
      p_normalization_version, p_input_hash, p_canonicalization_version
    ) returning id into v_snapshot_id;
  end if;

  v_response := private.context_snapshot_json(v_snapshot_id);
  perform private.store_plan_idempotency(
    v_actor_id, p_profile_id, 'context-snapshot',
    p_idempotency_key_digest, p_request_digest, v_response, false
  );
  return v_response;
end;
$$;

create function private.create_plan_draft(
  p_auth_subject uuid,
  p_auth_session_id uuid,
  p_profile_id uuid,
  p_context_snapshot_id uuid,
  p_engine_version text,
  p_canonicalization_version text,
  p_rule_set_revision_id uuid,
  p_source_manifest_id uuid,
  p_input_hash bytea,
  p_output_hash bytea,
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
  v_snapshot public.context_snapshots%rowtype;
  v_plan_id uuid;
  v_plan_version_id uuid;
  v_response jsonb;
begin
  if p_engine_version !~ '^[a-z0-9][a-z0-9._-]{0,63}$'
    or p_canonicalization_version !~ '^[a-z0-9][a-z0-9._-]{0,63}$'
    or p_validation_status <> 'valid'
    or jsonb_typeof(p_validation) <> 'object'
    or octet_length(p_validation::text) > 65536
    or octet_length(p_input_hash) <> 32
    or octet_length(p_output_hash) <> 32
    or octet_length(p_idempotency_key_digest) <> 32
    or octet_length(p_request_digest) <> 32
  then
    raise exception using errcode = '22023', message = 'invalid_input';
  end if;

  v_actor_id := private.require_questionnaire_access(
    p_auth_subject, p_auth_session_id, p_profile_id
  );
  v_response := private.get_plan_idempotency(
    v_actor_id, p_profile_id, 'plan-generate',
    p_idempotency_key_digest, p_request_digest
  );
  if v_response is not null then
    return v_response;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    p_profile_id::text || ':plan', 0
  ));
  select snapshot.* into v_snapshot
  from public.context_snapshots snapshot
  where snapshot.id = p_context_snapshot_id
    and snapshot.profile_id = p_profile_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'context_snapshot_not_found';
  end if;
  if exists (select 1 from public.plans plan where plan.profile_id = p_profile_id) then
    raise exception using errcode = 'P0001', message = 'plan_already_exists';
  end if;

  insert into public.plans (profile_id, aggregate_version)
  values (p_profile_id, 1)
  returning id into v_plan_id;

  insert into public.plan_versions (
    plan_id, ordinal, status, completeness, validation_status, validation,
    context_snapshot_id, engine_version, rule_set_revision_id,
    source_manifest_id, input_hash, output_hash, canonicalization_version
  ) values (
    v_plan_id, 1, 'draft', v_snapshot.completeness, p_validation_status,
    p_validation, p_context_snapshot_id, p_engine_version,
    p_rule_set_revision_id, p_source_manifest_id, p_input_hash, p_output_hash,
    p_canonicalization_version
  ) returning id into v_plan_version_id;

  perform private.insert_plan_artifacts(
    v_plan_version_id, p_module_results, p_safety_findings
  );
  v_response := private.plan_ack(v_plan_id, v_plan_version_id);
  perform private.store_plan_idempotency(
    v_actor_id, p_profile_id, 'plan-generate',
    p_idempotency_key_digest, p_request_digest, v_response, false
  );
  return v_response;
end;
$$;

create function private.activate_plan_version(
  p_auth_subject uuid,
  p_auth_session_id uuid,
  p_plan_id uuid,
  p_plan_version_id uuid,
  p_expected_version integer,
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
  v_plan public.plans%rowtype;
  v_version public.plan_versions%rowtype;
  v_response jsonb;
begin
  if p_expected_version < 1
    or octet_length(p_idempotency_key_digest) <> 32
    or octet_length(p_request_digest) <> 32
  then
    raise exception using errcode = '22023', message = 'invalid_input';
  end if;
  select plan.* into v_plan from public.plans plan where plan.id = p_plan_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'plan_not_found';
  end if;
  v_actor_id := private.require_questionnaire_access(
    p_auth_subject, p_auth_session_id, v_plan.profile_id
  );
  v_response := private.get_plan_idempotency(
    v_actor_id, v_plan.profile_id, 'version-activate',
    p_idempotency_key_digest, p_request_digest
  );
  if v_response is not null then
    return v_response;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_plan_id::text || ':plan', 0));
  select plan.* into v_plan
  from public.plans plan
  where plan.id = p_plan_id
  for update;
  if v_plan.aggregate_version <> p_expected_version then
    raise exception using errcode = '40001', message = 'version_conflict';
  end if;
  if v_plan.active_version_id is not null then
    raise exception using errcode = 'P0001', message = 'initial_plan_already_active';
  end if;
  select version.* into v_version
  from public.plan_versions version
  where version.id = p_plan_version_id and version.plan_id = p_plan_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'plan_version_not_found';
  end if;
  if v_version.status <> 'draft' or v_version.validation_status <> 'valid' then
    raise exception using errcode = 'P0001', message = 'plan_version_invalid';
  end if;

  update public.plan_versions
  set status = 'active', activated_at = clock_timestamp(), activated_by = v_actor_id
  where id = p_plan_version_id;
  update public.plans
  set active_version_id = p_plan_version_id,
      aggregate_version = aggregate_version + 1,
      updated_at = clock_timestamp()
  where id = p_plan_id;

  v_response := private.plan_ack(p_plan_id, p_plan_version_id);
  perform private.store_plan_idempotency(
    v_actor_id, v_plan.profile_id, 'version-activate',
    p_idempotency_key_digest, p_request_digest, v_response, true
  );
  return v_response;
end;
$$;

create function private.create_plan_candidate(
  p_auth_subject uuid,
  p_auth_session_id uuid,
  p_plan_id uuid,
  p_expected_version integer,
  p_base_version_id uuid,
  p_context_snapshot_id uuid,
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
  v_plan public.plans%rowtype;
  v_snapshot public.context_snapshots%rowtype;
  v_change_event_id uuid;
  v_plan_version_id uuid;
  v_candidate_id uuid;
  v_ordinal integer;
  v_response jsonb;
begin
  if p_expected_version < 1
    or p_change_kind !~ '^[a-z][a-z0-9_]{0,63}$'
    or jsonb_typeof(p_change_payload) <> 'object'
    or octet_length(p_change_payload::text) > 65536
    or p_impact not in (
      'unaffected', 'module_only', 'dependent_modules', 'structural'
    )
    or jsonb_typeof(p_diff) <> 'object'
    or octet_length(p_diff::text) > 65536
    or p_engine_version !~ '^[a-z0-9][a-z0-9._-]{0,63}$'
    or p_canonicalization_version !~ '^[a-z0-9][a-z0-9._-]{0,63}$'
    or p_validation_status not in ('valid', 'invalid')
    or jsonb_typeof(p_validation) <> 'object'
    or octet_length(p_validation::text) > 65536
    or octet_length(p_input_hash) <> 32
    or octet_length(p_output_hash) <> 32
    or octet_length(p_idempotency_key_digest) <> 32
    or octet_length(p_request_digest) <> 32
  then
    raise exception using errcode = '22023', message = 'invalid_input';
  end if;

  select plan.* into v_plan from public.plans plan where plan.id = p_plan_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'plan_not_found';
  end if;
  v_actor_id := private.require_questionnaire_access(
    p_auth_subject, p_auth_session_id, v_plan.profile_id
  );
  v_response := private.get_plan_idempotency(
    v_actor_id, v_plan.profile_id, 'candidate-create',
    p_idempotency_key_digest, p_request_digest
  );
  if v_response is not null then
    return v_response;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_plan_id::text || ':plan', 0));
  select plan.* into v_plan
  from public.plans plan
  where plan.id = p_plan_id
  for update;
  if v_plan.aggregate_version <> p_expected_version then
    raise exception using errcode = '40001', message = 'version_conflict';
  end if;
  if v_plan.active_version_id is distinct from p_base_version_id then
    raise exception using errcode = '40001', message = 'version_conflict';
  end if;
  if not exists (
    select 1 from public.plan_versions version
    where version.id = p_base_version_id
      and version.plan_id = p_plan_id
      and version.status = 'active'
  ) then
    raise exception using errcode = 'P0001', message = 'base_plan_not_active';
  end if;
  select snapshot.* into v_snapshot
  from public.context_snapshots snapshot
  where snapshot.id = p_context_snapshot_id
    and snapshot.profile_id = v_plan.profile_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'context_snapshot_not_found';
  end if;

  insert into public.change_events (
    profile_id, kind, payload, effective_at, impact_status
  ) values (
    v_plan.profile_id, p_change_kind, p_change_payload,
    v_snapshot.effective_at, p_impact
  ) returning id into v_change_event_id;

  select coalesce(max(version.ordinal), 0) + 1 into v_ordinal
  from public.plan_versions version
  where version.plan_id = p_plan_id;

  insert into public.plan_versions (
    plan_id, ordinal, status, completeness, validation_status, validation,
    context_snapshot_id, engine_version, rule_set_revision_id,
    source_manifest_id, input_hash, output_hash, canonicalization_version
  ) values (
    p_plan_id, v_ordinal, 'draft', v_snapshot.completeness,
    p_validation_status, p_validation, p_context_snapshot_id,
    p_engine_version, p_rule_set_revision_id, p_source_manifest_id,
    p_input_hash, p_output_hash, p_canonicalization_version
  ) returning id into v_plan_version_id;

  perform private.insert_plan_artifacts(
    v_plan_version_id, p_module_results, p_safety_findings
  );
  insert into public.plan_candidates (
    plan_id, change_event_id, base_version_id, candidate_version_id,
    impact, diff, validation, status
  ) values (
    p_plan_id, v_change_event_id, p_base_version_id, v_plan_version_id,
    p_impact, p_diff, p_validation,
    case when p_validation_status = 'valid' then 'pending' else 'invalid' end
  ) returning id into v_candidate_id;

  update public.plans
  set aggregate_version = aggregate_version + 1,
      updated_at = clock_timestamp()
  where id = p_plan_id;

  v_response := private.plan_ack(p_plan_id, v_plan_version_id, v_candidate_id);
  perform private.store_plan_idempotency(
    v_actor_id, v_plan.profile_id, 'candidate-create',
    p_idempotency_key_digest, p_request_digest, v_response, false
  );
  return v_response;
end;
$$;

create function private.activate_plan_candidate(
  p_auth_subject uuid,
  p_auth_session_id uuid,
  p_candidate_id uuid,
  p_expected_version integer,
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
  v_plan public.plans%rowtype;
  v_candidate public.plan_candidates%rowtype;
  v_candidate_version public.plan_versions%rowtype;
  v_response jsonb;
begin
  if p_expected_version < 1
    or octet_length(p_idempotency_key_digest) <> 32
    or octet_length(p_request_digest) <> 32
  then
    raise exception using errcode = '22023', message = 'invalid_input';
  end if;
  select candidate.* into v_candidate
  from public.plan_candidates candidate
  where candidate.id = p_candidate_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'plan_candidate_not_found';
  end if;
  select plan.* into v_plan from public.plans plan where plan.id = v_candidate.plan_id;
  v_actor_id := private.require_questionnaire_access(
    p_auth_subject, p_auth_session_id, v_plan.profile_id
  );
  v_response := private.get_plan_idempotency(
    v_actor_id, v_plan.profile_id, 'candidate-activate',
    p_idempotency_key_digest, p_request_digest
  );
  if v_response is not null then
    return v_response;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_plan.id::text || ':plan', 0));
  select plan.* into v_plan
  from public.plans plan
  where plan.id = v_candidate.plan_id
  for update;
  if v_plan.aggregate_version <> p_expected_version then
    raise exception using errcode = '40001', message = 'version_conflict';
  end if;
  select candidate.* into v_candidate
  from public.plan_candidates candidate
  where candidate.id = p_candidate_id
  for update;
  if v_candidate.status = 'invalid' then
    raise exception using errcode = 'P0001', message = 'plan_candidate_invalid';
  end if;
  if v_candidate.status <> 'pending'
    or v_plan.active_version_id is distinct from v_candidate.base_version_id
  then
    raise exception using errcode = '40001', message = 'version_conflict';
  end if;
  select version.* into v_candidate_version
  from public.plan_versions version
  where version.id = v_candidate.candidate_version_id
    and version.plan_id = v_plan.id
  for update;
  if v_candidate_version.status <> 'draft'
    or v_candidate_version.validation_status <> 'valid'
  then
    raise exception using errcode = 'P0001', message = 'plan_candidate_invalid';
  end if;

  update public.plan_versions
  set status = 'archived', archived_at = clock_timestamp()
  where id = v_candidate.base_version_id;
  update public.plan_versions
  set status = 'active', activated_at = clock_timestamp(), activated_by = v_actor_id
  where id = v_candidate.candidate_version_id;
  update public.plan_candidates
  set status = 'activated', resolved_at = clock_timestamp()
  where id = p_candidate_id;
  update public.plans
  set active_version_id = v_candidate.candidate_version_id,
      aggregate_version = aggregate_version + 1,
      updated_at = clock_timestamp()
  where id = v_plan.id;

  v_response := private.plan_ack(
    v_plan.id, v_candidate.candidate_version_id, p_candidate_id
  );
  perform private.store_plan_idempotency(
    v_actor_id, v_plan.profile_id, 'candidate-activate',
    p_idempotency_key_digest, p_request_digest, v_response, true
  );
  return v_response;
end;
$$;

create function private.discard_plan_candidate(
  p_auth_subject uuid,
  p_auth_session_id uuid,
  p_candidate_id uuid,
  p_expected_version integer,
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
  v_plan public.plans%rowtype;
  v_candidate public.plan_candidates%rowtype;
  v_response jsonb;
begin
  if p_expected_version < 1
    or octet_length(p_idempotency_key_digest) <> 32
    or octet_length(p_request_digest) <> 32
  then
    raise exception using errcode = '22023', message = 'invalid_input';
  end if;
  select candidate.* into v_candidate
  from public.plan_candidates candidate
  where candidate.id = p_candidate_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'plan_candidate_not_found';
  end if;
  select plan.* into v_plan from public.plans plan where plan.id = v_candidate.plan_id;
  v_actor_id := private.require_questionnaire_access(
    p_auth_subject, p_auth_session_id, v_plan.profile_id
  );
  v_response := private.get_plan_idempotency(
    v_actor_id, v_plan.profile_id, 'candidate-discard',
    p_idempotency_key_digest, p_request_digest
  );
  if v_response is not null then
    return v_response;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_plan.id::text || ':plan', 0));
  select plan.* into v_plan
  from public.plans plan where plan.id = v_candidate.plan_id for update;
  if v_plan.aggregate_version <> p_expected_version then
    raise exception using errcode = '40001', message = 'version_conflict';
  end if;
  select candidate.* into v_candidate
  from public.plan_candidates candidate
  where candidate.id = p_candidate_id for update;
  if v_candidate.status <> 'pending' then
    raise exception using errcode = 'P0001', message = 'plan_candidate_not_pending';
  end if;

  update public.plan_versions
  set status = 'archived', archived_at = clock_timestamp()
  where id = v_candidate.candidate_version_id and status = 'draft';
  update public.plan_candidates
  set status = 'discarded', resolved_at = clock_timestamp()
  where id = p_candidate_id;
  update public.plans
  set aggregate_version = aggregate_version + 1,
      updated_at = clock_timestamp()
  where id = v_plan.id;
  v_response := private.plan_ack(
    v_plan.id, v_candidate.candidate_version_id, p_candidate_id
  );
  perform private.store_plan_idempotency(
    v_actor_id, v_plan.profile_id, 'candidate-discard',
    p_idempotency_key_digest, p_request_digest, v_response, false
  );
  return v_response;
end;
$$;

create function private.list_plan_versions(
  p_auth_subject uuid,
  p_auth_session_id uuid,
  p_plan_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_plan public.plans%rowtype;
  v_versions jsonb;
begin
  select plan.* into v_plan from public.plans plan where plan.id = p_plan_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'plan_not_found';
  end if;
  perform private.require_questionnaire_access(
    p_auth_subject, p_auth_session_id, v_plan.profile_id
  );
  select coalesce(
    jsonb_agg(private.plan_version_json(version.id) order by version.ordinal desc),
    '[]'::jsonb
  ) into v_versions
  from public.plan_versions version
  where version.plan_id = p_plan_id;
  return jsonb_build_object(
    'planId', v_plan.id,
    'profileId', v_plan.profile_id,
    'activeVersionId', v_plan.active_version_id,
    'aggregateVersion', v_plan.aggregate_version,
    'versions', v_versions
  );
end;
$$;

create function private.get_context_snapshot(
  p_auth_subject uuid,
  p_auth_session_id uuid,
  p_profile_id uuid,
  p_context_snapshot_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_snapshot public.context_snapshots%rowtype;
begin
  perform private.require_questionnaire_access(
    p_auth_subject, p_auth_session_id, p_profile_id
  );
  select snapshot.* into v_snapshot
  from public.context_snapshots snapshot
  where snapshot.id = p_context_snapshot_id
    and snapshot.profile_id = p_profile_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'context_snapshot_not_found';
  end if;
  return private.context_snapshot_json(v_snapshot.id) || jsonb_build_object(
    'answers', v_snapshot.answers
  );
end;
$$;

create function private.get_plan_version(
  p_auth_subject uuid,
  p_auth_session_id uuid,
  p_plan_id uuid,
  p_plan_version_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_plan public.plans%rowtype;
  v_version jsonb;
  v_modules jsonb;
  v_findings jsonb;
begin
  select plan.* into v_plan from public.plans plan where plan.id = p_plan_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'plan_not_found';
  end if;
  perform private.require_questionnaire_access(
    p_auth_subject, p_auth_session_id, v_plan.profile_id
  );
  v_version := private.plan_version_json(p_plan_version_id);
  if v_version is null or (v_version ->> 'planId')::uuid <> p_plan_id then
    raise exception using errcode = 'P0002', message = 'plan_version_not_found';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', result.id,
    'module', result.module,
    'status', result.status,
    'confidence', result.confidence,
    'payload', result.payload,
    'uncertainties', result.uncertainties,
    'createdAt', result.created_at
  ) order by result.module), '[]'::jsonb) into v_modules
  from public.module_results result
  where result.plan_version_id = p_plan_version_id;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', finding.id,
    'module', finding.module,
    'actionLevel', finding.action_level,
    'code', finding.code,
    'messageKey', finding.message_key,
    'evidenceRef', finding.evidence_ref,
    'createdAt', finding.created_at
  ) order by finding.id), '[]'::jsonb) into v_findings
  from public.safety_findings finding
  where finding.plan_version_id = p_plan_version_id;
  return v_version || jsonb_build_object(
    'moduleResults', v_modules,
    'safetyFindings', v_findings
  );
end;
$$;

create function public.internal_create_context_snapshot(
  p_auth_subject uuid,
  p_auth_session_id uuid,
  p_profile_id uuid,
  p_expected_draft_version integer,
  p_normalization_version text,
  p_canonicalization_version text,
  p_input_hash bytea,
  p_idempotency_key_digest bytea,
  p_request_digest bytea
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  return private.create_context_snapshot(
    p_auth_subject, p_auth_session_id, p_profile_id, p_expected_draft_version,
    p_normalization_version, p_canonicalization_version, p_input_hash,
    p_idempotency_key_digest, p_request_digest
  );
exception
  when serialization_failure then
    raise exception using errcode = 'PT409', message = 'version_conflict';
end;
$$;

create function public.internal_create_plan_draft(
  p_auth_subject uuid,
  p_auth_session_id uuid,
  p_profile_id uuid,
  p_context_snapshot_id uuid,
  p_engine_version text,
  p_canonicalization_version text,
  p_rule_set_revision_id uuid,
  p_source_manifest_id uuid,
  p_input_hash bytea,
  p_output_hash bytea,
  p_validation_status text,
  p_validation jsonb,
  p_module_results jsonb,
  p_safety_findings jsonb,
  p_idempotency_key_digest bytea,
  p_request_digest bytea
)
returns jsonb
language sql
security definer
set search_path = pg_catalog
as $$
  select private.create_plan_draft(
    p_auth_subject, p_auth_session_id, p_profile_id, p_context_snapshot_id,
    p_engine_version, p_canonicalization_version, p_rule_set_revision_id,
    p_source_manifest_id,
    p_input_hash, p_output_hash, p_validation_status, p_validation,
    p_module_results, p_safety_findings, p_idempotency_key_digest,
    p_request_digest
  )
$$;

create function public.internal_activate_plan_version(
  p_auth_subject uuid,
  p_auth_session_id uuid,
  p_plan_id uuid,
  p_plan_version_id uuid,
  p_expected_version integer,
  p_idempotency_key_digest bytea,
  p_request_digest bytea
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  return private.activate_plan_version(
    p_auth_subject, p_auth_session_id, p_plan_id, p_plan_version_id,
    p_expected_version, p_idempotency_key_digest, p_request_digest
  );
exception
  when serialization_failure then
    raise exception using errcode = 'PT409', message = 'version_conflict';
  when raise_exception then
    if sqlerrm = 'plan_version_invalid' then
      raise exception using errcode = 'PT422', message = 'plan_version_invalid';
    end if;
    raise;
end;
$$;

create function public.internal_create_plan_candidate(
  p_auth_subject uuid,
  p_auth_session_id uuid,
  p_plan_id uuid,
  p_expected_version integer,
  p_base_version_id uuid,
  p_context_snapshot_id uuid,
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
begin
  return private.create_plan_candidate(
    p_auth_subject, p_auth_session_id, p_plan_id, p_expected_version,
    p_base_version_id, p_context_snapshot_id, p_change_kind, p_change_payload,
    p_impact, p_diff, p_engine_version, p_canonicalization_version,
    p_rule_set_revision_id,
    p_source_manifest_id, p_input_hash, p_output_hash, p_validation_status,
    p_validation, p_module_results, p_safety_findings,
    p_idempotency_key_digest, p_request_digest
  );
exception
  when serialization_failure then
    raise exception using errcode = 'PT409', message = 'version_conflict';
end;
$$;

create function public.internal_activate_plan_candidate(
  p_auth_subject uuid,
  p_auth_session_id uuid,
  p_candidate_id uuid,
  p_expected_version integer,
  p_idempotency_key_digest bytea,
  p_request_digest bytea
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  return private.activate_plan_candidate(
    p_auth_subject, p_auth_session_id, p_candidate_id, p_expected_version,
    p_idempotency_key_digest, p_request_digest
  );
exception
  when serialization_failure then
    raise exception using errcode = 'PT409', message = 'version_conflict';
  when raise_exception then
    if sqlerrm = 'plan_candidate_invalid' then
      raise exception using errcode = 'PT422', message = 'plan_candidate_invalid';
    end if;
    raise;
end;
$$;

create function public.internal_discard_plan_candidate(
  p_auth_subject uuid,
  p_auth_session_id uuid,
  p_candidate_id uuid,
  p_expected_version integer,
  p_idempotency_key_digest bytea,
  p_request_digest bytea
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  return private.discard_plan_candidate(
    p_auth_subject, p_auth_session_id, p_candidate_id, p_expected_version,
    p_idempotency_key_digest, p_request_digest
  );
exception
  when serialization_failure then
    raise exception using errcode = 'PT409', message = 'version_conflict';
end;
$$;

create function public.internal_list_plan_versions(
  p_auth_subject uuid,
  p_auth_session_id uuid,
  p_plan_id uuid
)
returns jsonb
language sql
security definer
set search_path = pg_catalog
as $$
  select private.list_plan_versions(
    p_auth_subject, p_auth_session_id, p_plan_id
  )
$$;

create function public.internal_get_context_snapshot(
  p_auth_subject uuid,
  p_auth_session_id uuid,
  p_profile_id uuid,
  p_context_snapshot_id uuid
)
returns jsonb
language sql
security definer
set search_path = pg_catalog
as $$
  select private.get_context_snapshot(
    p_auth_subject, p_auth_session_id, p_profile_id, p_context_snapshot_id
  )
$$;

create function public.internal_get_plan_version(
  p_auth_subject uuid,
  p_auth_session_id uuid,
  p_plan_id uuid,
  p_plan_version_id uuid
)
returns jsonb
language sql
security definer
set search_path = pg_catalog
as $$
  select private.get_plan_version(
    p_auth_subject, p_auth_session_id, p_plan_id, p_plan_version_id
  )
$$;

revoke all on function private.reject_context_snapshot_update()
from public, anon, authenticated, service_role;
revoke all on function private.guard_plan_version_update()
from public, anon, authenticated, service_role;
revoke all on function private.reject_plan_artifact_update()
from public, anon, authenticated, service_role;
revoke all on function private.guard_plan_candidate_update()
from public, anon, authenticated, service_role;
revoke all on function private.get_plan_idempotency(uuid, uuid, text, bytea, bytea)
from public, anon, authenticated, service_role;
revoke all on function private.store_plan_idempotency(
  uuid, uuid, text, bytea, bytea, jsonb, boolean
) from public, anon, authenticated, service_role;
revoke all on function private.context_snapshot_json(uuid)
from public, anon, authenticated, service_role;
revoke all on function private.plan_version_json(uuid)
from public, anon, authenticated, service_role;
revoke all on function private.plan_ack(uuid, uuid, uuid)
from public, anon, authenticated, service_role;
revoke all on function private.insert_plan_artifacts(uuid, jsonb, jsonb)
from public, anon, authenticated, service_role;
revoke all on function private.create_context_snapshot(
  uuid, uuid, uuid, integer, text, text, bytea, bytea, bytea
) from public, anon, authenticated, service_role;
revoke all on function private.create_plan_draft(
  uuid, uuid, uuid, uuid, text, text, uuid, uuid, bytea, bytea, text, jsonb,
  jsonb, jsonb, bytea, bytea
) from public, anon, authenticated, service_role;
revoke all on function private.activate_plan_version(
  uuid, uuid, uuid, uuid, integer, bytea, bytea
) from public, anon, authenticated, service_role;
revoke all on function private.create_plan_candidate(
  uuid, uuid, uuid, integer, uuid, uuid, text, jsonb, text, jsonb, text, text,
  uuid, uuid, bytea, bytea, text, jsonb, jsonb, jsonb, bytea, bytea
) from public, anon, authenticated, service_role;
revoke all on function private.activate_plan_candidate(
  uuid, uuid, uuid, integer, bytea, bytea
) from public, anon, authenticated, service_role;
revoke all on function private.discard_plan_candidate(
  uuid, uuid, uuid, integer, bytea, bytea
) from public, anon, authenticated, service_role;
revoke all on function private.list_plan_versions(uuid, uuid, uuid)
from public, anon, authenticated, service_role;
revoke all on function private.get_context_snapshot(uuid, uuid, uuid, uuid)
from public, anon, authenticated, service_role;
revoke all on function private.get_plan_version(uuid, uuid, uuid, uuid)
from public, anon, authenticated, service_role;

revoke all on function public.internal_create_context_snapshot(
  uuid, uuid, uuid, integer, text, text, bytea, bytea, bytea
) from public, anon, authenticated;
revoke all on function public.internal_create_plan_draft(
  uuid, uuid, uuid, uuid, text, text, uuid, uuid, bytea, bytea, text, jsonb,
  jsonb, jsonb, bytea, bytea
) from public, anon, authenticated;
revoke all on function public.internal_activate_plan_version(
  uuid, uuid, uuid, uuid, integer, bytea, bytea
) from public, anon, authenticated;
revoke all on function public.internal_create_plan_candidate(
  uuid, uuid, uuid, integer, uuid, uuid, text, jsonb, text, jsonb, text, text,
  uuid, uuid, bytea, bytea, text, jsonb, jsonb, jsonb, bytea, bytea
) from public, anon, authenticated;
revoke all on function public.internal_activate_plan_candidate(
  uuid, uuid, uuid, integer, bytea, bytea
) from public, anon, authenticated;
revoke all on function public.internal_discard_plan_candidate(
  uuid, uuid, uuid, integer, bytea, bytea
) from public, anon, authenticated;
revoke all on function public.internal_list_plan_versions(uuid, uuid, uuid)
from public, anon, authenticated;
revoke all on function public.internal_get_context_snapshot(uuid, uuid, uuid, uuid)
from public, anon, authenticated;
revoke all on function public.internal_get_plan_version(uuid, uuid, uuid, uuid)
from public, anon, authenticated;

grant execute on function public.internal_create_context_snapshot(
  uuid, uuid, uuid, integer, text, text, bytea, bytea, bytea
) to service_role;
grant execute on function public.internal_create_plan_draft(
  uuid, uuid, uuid, uuid, text, text, uuid, uuid, bytea, bytea, text, jsonb,
  jsonb, jsonb, bytea, bytea
) to service_role;
grant execute on function public.internal_activate_plan_version(
  uuid, uuid, uuid, uuid, integer, bytea, bytea
) to service_role;
grant execute on function public.internal_create_plan_candidate(
  uuid, uuid, uuid, integer, uuid, uuid, text, jsonb, text, jsonb, text, text,
  uuid, uuid, bytea, bytea, text, jsonb, jsonb, jsonb, bytea, bytea
) to service_role;
grant execute on function public.internal_activate_plan_candidate(
  uuid, uuid, uuid, integer, bytea, bytea
) to service_role;
grant execute on function public.internal_discard_plan_candidate(
  uuid, uuid, uuid, integer, bytea, bytea
) to service_role;
grant execute on function public.internal_list_plan_versions(uuid, uuid, uuid)
to service_role;
grant execute on function public.internal_get_context_snapshot(uuid, uuid, uuid, uuid)
to service_role;
grant execute on function public.internal_get_plan_version(uuid, uuid, uuid, uuid)
to service_role;
