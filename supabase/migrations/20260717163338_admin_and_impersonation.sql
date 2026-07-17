create table private.impersonation_sessions (
  id uuid primary key default gen_random_uuid(),
  original_actor_id uuid not null
    references public.actors (id) on delete restrict,
  auth_session_id uuid not null,
  effective_profile_id uuid not null,
  request_id uuid not null unique,
  started_at timestamptz not null default clock_timestamp(),
  ended_at timestamptz,
  constraint impersonation_sessions_time_order_check check (
    ended_at is null or ended_at >= started_at
  )
);

create unique index impersonation_sessions_one_active_auth_session_idx
on private.impersonation_sessions (auth_session_id)
where ended_at is null;

create index impersonation_sessions_original_actor_idx
on private.impersonation_sessions (original_actor_id, started_at desc);

alter table private.technical_audit_events
  drop constraint if exists technical_audit_events_request_id_key;

alter table private.technical_audit_events
  add column event_sequence bigint generated always as identity,
  add column phase text not null default 'outcome'
    check (phase in ('intent', 'outcome', 'reconciliation')),
  add column original_actor_id uuid
    references public.actors (id) on delete restrict,
  add column effective_profile_id uuid,
  add column impersonation_session_id uuid
    references private.impersonation_sessions (id) on delete restrict,
  add column external_sequence bigint,
  add column external_timestamp timestamptz,
  add column external_record_hash bytea,
  add column external_receipt_signature bytea,
  add column external_key_version integer,
  add column external_idempotency_hash bytea,
  add constraint technical_audit_events_external_receipt_check check (
    (
      external_sequence is null
      and external_timestamp is null
      and external_record_hash is null
      and external_receipt_signature is null
      and external_key_version is null
      and external_idempotency_hash is null
    )
    or (
      external_sequence > 0
      and external_timestamp is not null
      and octet_length(external_record_hash) = 32
      and octet_length(external_receipt_signature) = 64
      and external_key_version > 0
      and octet_length(external_idempotency_hash) = 32
    )
  );

update private.technical_audit_events
set original_actor_id = actor_id
where actor_id is not null;

create unique index technical_audit_events_request_phase_idx
on private.technical_audit_events (request_id, phase);

create unique index technical_audit_events_event_sequence_idx
on private.technical_audit_events (event_sequence);

create unique index technical_audit_events_external_sequence_idx
on private.technical_audit_events (external_sequence)
where external_sequence is not null;

create unique index technical_audit_events_external_idempotency_idx
on private.technical_audit_events (external_idempotency_hash)
where external_idempotency_hash is not null;

create table private.audit_outbox (
  id uuid primary key default gen_random_uuid(),
  technical_audit_event_id uuid not null unique
    references private.technical_audit_events (id) on delete restrict,
  request_id uuid not null unique,
  original_actor_id uuid not null
    references public.actors (id) on delete restrict,
  effective_profile_id uuid,
  impersonation_session_id uuid
    references private.impersonation_sessions (id) on delete restrict,
  action text not null check (
    action in (
      'access_reset',
      'ai_provider_revision_activate',
      'audit_range_delete',
      'backup_create',
      'barcode_correction_approve',
      'catalog_publication_hide',
      'catalog_revision_publish',
      'impersonation_end',
      'impersonation_start',
      'invitation_create',
      'invitation_revoke',
      'matching_rule_activate',
      'profile_delete_permanent',
      'profile_update',
      'restore_create',
      'restore_promote',
      'rule_set_activate'
    )
  ),
  target_type text not null check (
    target_type in (
      'audit_range',
      'backup',
      'catalog_publication',
      'catalog_revision',
      'impersonation_session',
      'invitation',
      'profile',
      'restore',
      'rule_revision'
    )
  ),
  target_id uuid,
  outcome_status text not null default 'pending'
    check (outcome_status in ('pending', 'success', 'failure')),
  error_code text check (
    error_code is null
    or error_code in (
      'domain_constraint',
      'ledger_unavailable',
      'mutation_failed',
      'reconciliation_required'
    )
  ),
  attempts integer not null default 0 check (attempts >= 0),
  created_at timestamptz not null default clock_timestamp(),
  last_attempt_at timestamptz,
  dispatched_at timestamptz,
  constraint audit_outbox_status_check check (
    (
      outcome_status = 'pending'
      and error_code is null
      and dispatched_at is null
    )
    or (
      outcome_status = 'success'
      and error_code is null
      and dispatched_at is not null
    )
    or (
      outcome_status = 'failure'
      and error_code is not null
      and dispatched_at is not null
    )
  ),
  constraint audit_outbox_attempt_time_check check (
    last_attempt_at is null or last_attempt_at >= created_at
  )
);

create index audit_outbox_pending_idx
on private.audit_outbox (created_at, id)
where outcome_status = 'pending';

alter table private.impersonation_sessions enable row level security;
alter table private.audit_outbox enable row level security;

revoke all on table private.impersonation_sessions
from public, anon, authenticated, service_role;
revoke all on table private.audit_outbox
from public, anon, authenticated, service_role;
revoke insert, update, delete on table private.technical_audit_events
from service_role;

create function private.reject_technical_audit_event_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  raise exception using
    errcode = '55000',
    message = 'immutable_audit_event';
end;
$$;

create trigger technical_audit_events_are_immutable
before update or delete on private.technical_audit_events
for each row execute function private.reject_technical_audit_event_mutation();

create function private.require_superadmin(p_auth_subject uuid)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_actor_id uuid;
begin
  select actor.id into v_actor_id
  from public.actors actor
  join auth.users auth_user on auth_user.id = actor.auth_subject
  where actor.auth_subject = p_auth_subject
    and actor.role = 'superadmin'
    and actor.disabled_at is null
    and auth_user.is_anonymous is false;

  if v_actor_id is null then
    raise exception using
      errcode = '42501',
      message = 'superadmin_required';
  end if;

  return v_actor_id;
end;
$$;

create function private.require_superadmin_aal2(
  p_auth_subject uuid,
  p_auth_session_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_actor_id uuid;
begin
  v_actor_id := private.require_superadmin(p_auth_subject);

  if not exists (
    select 1
    from auth.sessions auth_session
    where auth_session.id = p_auth_session_id
      and auth_session.user_id = p_auth_subject
      and auth_session.aal::text = 'aal2'
  ) then
    raise exception using
      errcode = '42501',
      message = 'aal2_required';
  end if;

  return v_actor_id;
end;
$$;

create function private.validate_admin_intent(
  p_external_sequence bigint,
  p_external_timestamp timestamptz,
  p_external_record_hash bytea,
  p_external_receipt_signature bytea,
  p_external_key_version integer,
  p_external_idempotency_hash bytea
)
returns void
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  if p_external_sequence is null
    or p_external_sequence <= 0
    or p_external_timestamp is null
    or octet_length(p_external_record_hash) <> 32
    or octet_length(p_external_receipt_signature) <> 64
    or p_external_key_version is null
    or p_external_key_version <= 0
    or octet_length(p_external_idempotency_hash) <> 32
  then
    raise exception using
      errcode = '22023',
      message = 'intent_receipt_required';
  end if;
end;
$$;

create function private.start_admin_impersonation(
  p_auth_subject uuid,
  p_auth_session_id uuid,
  p_profile_id uuid,
  p_request_id uuid,
  p_external_sequence bigint,
  p_external_timestamp timestamptz,
  p_external_record_hash bytea,
  p_external_receipt_signature bytea,
  p_external_key_version integer,
  p_external_idempotency_hash bytea
)
returns table (
  impersonation_session_id uuid,
  effective_profile_id uuid,
  started_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_actor_id uuid;
  v_audit_event_id uuid;
  v_impersonation private.impersonation_sessions%rowtype;
begin
  perform private.validate_admin_intent(
    p_external_sequence,
    p_external_timestamp,
    p_external_record_hash,
    p_external_receipt_signature,
    p_external_key_version,
    p_external_idempotency_hash
  );
  v_actor_id := private.require_superadmin_aal2(
    p_auth_subject,
    p_auth_session_id
  );

  if not exists (
    select 1
    from public.profiles profile
    where profile.id = p_profile_id
      and profile.status = 'active'
  ) then
    raise exception using
      errcode = '22023',
      message = 'profile_not_impersonable';
  end if;

  if exists (
    select 1
    from private.impersonation_sessions active_impersonation
    where active_impersonation.auth_session_id = p_auth_session_id
      and active_impersonation.ended_at is null
  ) then
    raise exception using
      errcode = '55000',
      message = 'impersonation_already_active';
  end if;

  insert into private.impersonation_sessions (
    original_actor_id,
    auth_session_id,
    effective_profile_id,
    request_id
  )
  values (
    v_actor_id,
    p_auth_session_id,
    p_profile_id,
    p_request_id
  )
  returning * into v_impersonation;

  insert into private.technical_audit_events (
    actor_id,
    action,
    target_type,
    target_id,
    result,
    request_id,
    phase,
    original_actor_id,
    effective_profile_id,
    impersonation_session_id,
    external_sequence,
    external_timestamp,
    external_record_hash,
    external_receipt_signature,
    external_key_version,
    external_idempotency_hash
  )
  values (
    v_actor_id,
    'impersonation_start',
    'profile',
    p_profile_id,
    'accepted',
    p_request_id,
    'intent',
    v_actor_id,
    p_profile_id,
    v_impersonation.id,
    p_external_sequence,
    p_external_timestamp,
    p_external_record_hash,
    p_external_receipt_signature,
    p_external_key_version,
    p_external_idempotency_hash
  )
  returning id into v_audit_event_id;

  insert into private.audit_outbox (
    technical_audit_event_id,
    request_id,
    original_actor_id,
    effective_profile_id,
    impersonation_session_id,
    action,
    target_type,
    target_id
  )
  values (
    v_audit_event_id,
    p_request_id,
    v_actor_id,
    p_profile_id,
    v_impersonation.id,
    'impersonation_start',
    'profile',
    p_profile_id
  );

  return query
  select
    v_impersonation.id,
    v_impersonation.effective_profile_id,
    v_impersonation.started_at;
end;
$$;

create function private.current_admin_context(
  p_auth_subject uuid,
  p_auth_session_id uuid
)
returns table (
  impersonation_session_id uuid,
  effective_profile_id uuid,
  started_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_actor_id uuid;
begin
  v_actor_id := private.require_superadmin_aal2(
    p_auth_subject,
    p_auth_session_id
  );

  return query
  select
    impersonation.id,
    impersonation.effective_profile_id,
    impersonation.started_at
  from private.impersonation_sessions impersonation
  where impersonation.original_actor_id = v_actor_id
    and impersonation.auth_session_id = p_auth_session_id
    and impersonation.ended_at is null;
end;
$$;

create function private.end_admin_impersonation(
  p_auth_subject uuid,
  p_auth_session_id uuid,
  p_impersonation_session_id uuid,
  p_request_id uuid,
  p_external_sequence bigint,
  p_external_timestamp timestamptz,
  p_external_record_hash bytea,
  p_external_receipt_signature bytea,
  p_external_key_version integer,
  p_external_idempotency_hash bytea
)
returns table (
  impersonation_session_id uuid,
  effective_profile_id uuid,
  ended_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_actor_id uuid;
  v_audit_event_id uuid;
  v_impersonation private.impersonation_sessions%rowtype;
begin
  perform private.validate_admin_intent(
    p_external_sequence,
    p_external_timestamp,
    p_external_record_hash,
    p_external_receipt_signature,
    p_external_key_version,
    p_external_idempotency_hash
  );
  v_actor_id := private.require_superadmin_aal2(
    p_auth_subject,
    p_auth_session_id
  );

  select * into v_impersonation
  from private.impersonation_sessions impersonation
  where impersonation.id = p_impersonation_session_id
    and impersonation.original_actor_id = v_actor_id
    and impersonation.auth_session_id = p_auth_session_id
    and impersonation.ended_at is null
  for update;

  if v_impersonation.id is null then
    raise exception using
      errcode = '55000',
      message = 'impersonation_not_active';
  end if;

  update private.impersonation_sessions impersonation
  set ended_at = clock_timestamp()
  where impersonation.id = v_impersonation.id
  returning * into v_impersonation;

  insert into private.technical_audit_events (
    actor_id,
    action,
    target_type,
    target_id,
    result,
    request_id,
    phase,
    original_actor_id,
    effective_profile_id,
    impersonation_session_id,
    external_sequence,
    external_timestamp,
    external_record_hash,
    external_receipt_signature,
    external_key_version,
    external_idempotency_hash
  )
  values (
    v_actor_id,
    'impersonation_end',
    'impersonation_session',
    v_impersonation.id,
    'accepted',
    p_request_id,
    'intent',
    v_actor_id,
    v_impersonation.effective_profile_id,
    v_impersonation.id,
    p_external_sequence,
    p_external_timestamp,
    p_external_record_hash,
    p_external_receipt_signature,
    p_external_key_version,
    p_external_idempotency_hash
  )
  returning id into v_audit_event_id;

  insert into private.audit_outbox (
    technical_audit_event_id,
    request_id,
    original_actor_id,
    effective_profile_id,
    impersonation_session_id,
    action,
    target_type,
    target_id
  )
  values (
    v_audit_event_id,
    p_request_id,
    v_actor_id,
    v_impersonation.effective_profile_id,
    v_impersonation.id,
    'impersonation_end',
    'impersonation_session',
    v_impersonation.id
  );

  return query
  select
    v_impersonation.id,
    v_impersonation.effective_profile_id,
    v_impersonation.ended_at;
end;
$$;

create function public.internal_admin_start_impersonation(
  p_auth_subject uuid,
  p_auth_session_id uuid,
  p_profile_id uuid,
  p_request_id uuid,
  p_external_sequence bigint,
  p_external_timestamp timestamptz,
  p_external_record_hash bytea,
  p_external_receipt_signature bytea,
  p_external_key_version integer,
  p_external_idempotency_hash bytea
)
returns table (
  impersonation_session_id uuid,
  effective_profile_id uuid,
  started_at timestamptz
)
language sql
security definer
set search_path = pg_catalog
as $$
  select *
  from private.start_admin_impersonation(
    p_auth_subject,
    p_auth_session_id,
    p_profile_id,
    p_request_id,
    p_external_sequence,
    p_external_timestamp,
    p_external_record_hash,
    p_external_receipt_signature,
    p_external_key_version,
    p_external_idempotency_hash
  )
$$;

create function public.internal_admin_current_context(
  p_auth_subject uuid,
  p_auth_session_id uuid
)
returns table (
  impersonation_session_id uuid,
  effective_profile_id uuid,
  started_at timestamptz
)
language sql
security definer
set search_path = pg_catalog
as $$
  select *
  from private.current_admin_context(p_auth_subject, p_auth_session_id)
$$;

create function public.internal_admin_end_impersonation(
  p_auth_subject uuid,
  p_auth_session_id uuid,
  p_impersonation_session_id uuid,
  p_request_id uuid,
  p_external_sequence bigint,
  p_external_timestamp timestamptz,
  p_external_record_hash bytea,
  p_external_receipt_signature bytea,
  p_external_key_version integer,
  p_external_idempotency_hash bytea
)
returns table (
  impersonation_session_id uuid,
  effective_profile_id uuid,
  ended_at timestamptz
)
language sql
security definer
set search_path = pg_catalog
as $$
  select *
  from private.end_admin_impersonation(
    p_auth_subject,
    p_auth_session_id,
    p_impersonation_session_id,
    p_request_id,
    p_external_sequence,
    p_external_timestamp,
    p_external_record_hash,
    p_external_receipt_signature,
    p_external_key_version,
    p_external_idempotency_hash
  )
$$;

revoke all on function private.reject_technical_audit_event_mutation()
from public, anon, authenticated, service_role;
revoke all on function private.require_superadmin(uuid)
from public, anon, authenticated, service_role;
revoke all on function private.require_superadmin_aal2(uuid, uuid)
from public, anon, authenticated, service_role;
revoke all on function private.validate_admin_intent(
  bigint, timestamptz, bytea, bytea, integer, bytea
) from public, anon, authenticated, service_role;
revoke all on function private.start_admin_impersonation(
  uuid, uuid, uuid, uuid, bigint, timestamptz, bytea, bytea, integer, bytea
) from public, anon, authenticated, service_role;
revoke all on function private.current_admin_context(uuid, uuid)
from public, anon, authenticated, service_role;
revoke all on function private.end_admin_impersonation(
  uuid, uuid, uuid, uuid, bigint, timestamptz, bytea, bytea, integer, bytea
) from public, anon, authenticated, service_role;

revoke all on function public.internal_admin_start_impersonation(
  uuid, uuid, uuid, uuid, bigint, timestamptz, bytea, bytea, integer, bytea
) from public, anon, authenticated;
revoke all on function public.internal_admin_current_context(uuid, uuid)
from public, anon, authenticated;
revoke all on function public.internal_admin_end_impersonation(
  uuid, uuid, uuid, uuid, bigint, timestamptz, bytea, bytea, integer, bytea
) from public, anon, authenticated;

grant execute on function public.internal_admin_start_impersonation(
  uuid, uuid, uuid, uuid, bigint, timestamptz, bytea, bytea, integer, bytea
) to service_role;
grant execute on function public.internal_admin_current_context(uuid, uuid)
to service_role;
grant execute on function public.internal_admin_end_impersonation(
  uuid, uuid, uuid, uuid, bigint, timestamptz, bytea, bytea, integer, bytea
) to service_role;

create function private.list_admin_profiles(
  p_auth_subject uuid,
  p_auth_session_id uuid
)
returns table (
  profile_id uuid,
  alias text,
  status text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  perform private.require_superadmin_aal2(
    p_auth_subject,
    p_auth_session_id
  );

  return query
  select profile.id, profile.alias, profile.status, profile.created_at
  from public.profiles profile
  order by profile.created_at, profile.id;
end;
$$;

create function public.internal_admin_authorize(
  p_auth_subject uuid,
  p_auth_session_id uuid
)
returns uuid
language sql
security definer
set search_path = pg_catalog
as $$
  select private.require_superadmin_aal2(
    p_auth_subject,
    p_auth_session_id
  )
$$;

create function public.internal_admin_list_profiles(
  p_auth_subject uuid,
  p_auth_session_id uuid
)
returns table (
  profile_id uuid,
  alias text,
  status text,
  created_at timestamptz
)
language sql
security definer
set search_path = pg_catalog
as $$
  select *
  from private.list_admin_profiles(p_auth_subject, p_auth_session_id)
$$;

revoke all on function private.list_admin_profiles(uuid, uuid)
from public, anon, authenticated, service_role;
revoke all on function public.internal_admin_authorize(uuid, uuid)
from public, anon, authenticated;
revoke all on function public.internal_admin_list_profiles(uuid, uuid)
from public, anon, authenticated;

grant execute on function public.internal_admin_authorize(uuid, uuid)
to service_role;
grant execute on function public.internal_admin_list_profiles(uuid, uuid)
to service_role;

create function private.list_pending_audit_outbox(p_limit integer)
returns table (
  request_id uuid,
  original_actor_id uuid,
  effective_profile_id uuid,
  impersonation_session_id uuid,
  action text,
  target_type text,
  target_id uuid,
  intent_record_hash bytea
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  if p_limit is null or p_limit < 1 or p_limit > 100 then
    raise exception using errcode = '22023', message = 'invalid_outbox_limit';
  end if;

  return query
  with selected as (
    select outbox.id
    from private.audit_outbox outbox
    where outbox.outcome_status = 'pending'
      and (
        outbox.last_attempt_at is null
        or outbox.last_attempt_at <= clock_timestamp() - interval '30 seconds'
      )
    order by outbox.created_at, outbox.id
    limit p_limit
    for update skip locked
  ),
  touched as (
    update private.audit_outbox outbox
    set attempts = outbox.attempts + 1,
        last_attempt_at = clock_timestamp()
    from selected
    where outbox.id = selected.id
    returning outbox.*
  )
  select
    touched.request_id,
    touched.original_actor_id,
    touched.effective_profile_id,
    touched.impersonation_session_id,
    touched.action,
    touched.target_type,
    touched.target_id,
    intent.external_record_hash
  from touched
  join private.technical_audit_events intent
    on intent.id = touched.technical_audit_event_id
  order by touched.created_at, touched.id;
end;
$$;

create function private.audit_request_state(p_request_id uuid)
returns table (
  state text,
  original_actor_id uuid,
  effective_profile_id uuid,
  impersonation_session_id uuid,
  action text,
  target_type text,
  target_id uuid,
  intent_record_hash bytea
)
language sql
security definer
set search_path = pg_catalog
as $$
  select
    outbox.outcome_status,
    outbox.original_actor_id,
    outbox.effective_profile_id,
    outbox.impersonation_session_id,
    outbox.action,
    outbox.target_type,
    outbox.target_id,
    intent.external_record_hash
  from private.audit_outbox outbox
  join private.technical_audit_events intent
    on intent.id = outbox.technical_audit_event_id
  where outbox.request_id = p_request_id
$$;

create function private.finalize_audit_outbox(
  p_request_id uuid,
  p_external_sequence bigint,
  p_external_timestamp timestamptz,
  p_external_record_hash bytea,
  p_external_receipt_signature bytea,
  p_external_key_version integer,
  p_external_idempotency_hash bytea
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_outbox private.audit_outbox%rowtype;
  v_existing private.technical_audit_events%rowtype;
begin
  perform private.validate_admin_intent(
    p_external_sequence,
    p_external_timestamp,
    p_external_record_hash,
    p_external_receipt_signature,
    p_external_key_version,
    p_external_idempotency_hash
  );

  select * into v_outbox
  from private.audit_outbox outbox
  where outbox.request_id = p_request_id
  for update;

  if v_outbox.id is null then
    raise exception using errcode = '22023', message = 'audit_outbox_not_found';
  end if;

  if v_outbox.outcome_status = 'success' then
    select * into v_existing
    from private.technical_audit_events event
    where event.request_id = p_request_id
      and event.phase = 'outcome';

    if v_existing.external_sequence <> p_external_sequence
      or v_existing.external_record_hash <> p_external_record_hash
      or v_existing.external_receipt_signature <> p_external_receipt_signature
      or v_existing.external_key_version <> p_external_key_version
      or v_existing.external_idempotency_hash <> p_external_idempotency_hash
    then
      raise exception using errcode = '23505', message = 'audit_outcome_conflict';
    end if;
    return true;
  end if;

  if v_outbox.outcome_status <> 'pending' then
    raise exception using errcode = '55000', message = 'audit_outbox_not_pending';
  end if;

  insert into private.technical_audit_events (
    actor_id,
    action,
    target_type,
    target_id,
    result,
    request_id,
    phase,
    original_actor_id,
    effective_profile_id,
    impersonation_session_id,
    external_sequence,
    external_timestamp,
    external_record_hash,
    external_receipt_signature,
    external_key_version,
    external_idempotency_hash
  )
  values (
    v_outbox.original_actor_id,
    v_outbox.action,
    v_outbox.target_type,
    v_outbox.target_id,
    'success',
    v_outbox.request_id,
    'outcome',
    v_outbox.original_actor_id,
    v_outbox.effective_profile_id,
    v_outbox.impersonation_session_id,
    p_external_sequence,
    p_external_timestamp,
    p_external_record_hash,
    p_external_receipt_signature,
    p_external_key_version,
    p_external_idempotency_hash
  );

  update private.audit_outbox outbox
  set outcome_status = 'success',
      error_code = null,
      dispatched_at = clock_timestamp()
  where outbox.id = v_outbox.id;

  return true;
end;
$$;

create function private.record_admin_reconciliation(
  p_request_id uuid,
  p_original_actor_id uuid,
  p_effective_profile_id uuid,
  p_impersonation_session_id uuid,
  p_action text,
  p_target_type text,
  p_target_id uuid,
  p_external_sequence bigint,
  p_external_timestamp timestamptz,
  p_external_record_hash bytea,
  p_external_receipt_signature bytea,
  p_external_key_version integer,
  p_external_idempotency_hash bytea
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_existing private.technical_audit_events%rowtype;
begin
  perform private.validate_admin_intent(
    p_external_sequence,
    p_external_timestamp,
    p_external_record_hash,
    p_external_receipt_signature,
    p_external_key_version,
    p_external_idempotency_hash
  );

  if not (
    (p_action = 'impersonation_start' and p_target_type = 'profile')
    or (
      p_action = 'impersonation_end'
      and p_target_type = 'impersonation_session'
      and p_impersonation_session_id = p_target_id
    )
  ) then
    raise exception using errcode = '22023', message = 'invalid_reconciliation_action';
  end if;

  if not exists (
    select 1
    from public.actors actor
    where actor.id = p_original_actor_id
      and actor.role = 'superadmin'
      and actor.disabled_at is null
  ) then
    raise exception using errcode = '42501', message = 'superadmin_required';
  end if;

  if exists (
    select 1
    from private.audit_outbox outbox
    where outbox.request_id = p_request_id
  ) then
    raise exception using errcode = '55000', message = 'audit_outbox_exists';
  end if;

  select * into v_existing
  from private.technical_audit_events event
  where event.request_id = p_request_id
    and event.phase = 'reconciliation';

  if v_existing.id is not null then
    if v_existing.external_sequence <> p_external_sequence
      or v_existing.external_record_hash <> p_external_record_hash
      or v_existing.external_receipt_signature <> p_external_receipt_signature
      or v_existing.external_key_version <> p_external_key_version
      or v_existing.external_idempotency_hash <> p_external_idempotency_hash
    then
      raise exception using errcode = '23505', message = 'audit_reconciliation_conflict';
    end if;
    return true;
  end if;

  insert into private.technical_audit_events (
    actor_id,
    action,
    target_type,
    target_id,
    result,
    request_id,
    phase,
    original_actor_id,
    effective_profile_id,
    impersonation_session_id,
    external_sequence,
    external_timestamp,
    external_record_hash,
    external_receipt_signature,
    external_key_version,
    external_idempotency_hash
  )
  values (
    p_original_actor_id,
    p_action,
    p_target_type,
    p_target_id,
    'failure',
    p_request_id,
    'reconciliation',
    p_original_actor_id,
    p_effective_profile_id,
    p_impersonation_session_id,
    p_external_sequence,
    p_external_timestamp,
    p_external_record_hash,
    p_external_receipt_signature,
    p_external_key_version,
    p_external_idempotency_hash
  );

  return true;
end;
$$;

create function public.internal_admin_list_pending_audit_outbox(p_limit integer)
returns table (
  request_id uuid,
  original_actor_id uuid,
  effective_profile_id uuid,
  impersonation_session_id uuid,
  action text,
  target_type text,
  target_id uuid,
  intent_record_hash bytea
)
language sql
security definer
set search_path = pg_catalog
as $$
  select * from private.list_pending_audit_outbox(p_limit)
$$;

create function public.internal_admin_audit_request_state(p_request_id uuid)
returns table (
  state text,
  original_actor_id uuid,
  effective_profile_id uuid,
  impersonation_session_id uuid,
  action text,
  target_type text,
  target_id uuid,
  intent_record_hash bytea
)
language sql
security definer
set search_path = pg_catalog
as $$
  select * from private.audit_request_state(p_request_id)
$$;

create function public.internal_admin_finalize_audit_outbox(
  p_request_id uuid,
  p_external_sequence bigint,
  p_external_timestamp timestamptz,
  p_external_record_hash bytea,
  p_external_receipt_signature bytea,
  p_external_key_version integer,
  p_external_idempotency_hash bytea
)
returns boolean
language sql
security definer
set search_path = pg_catalog
as $$
  select private.finalize_audit_outbox(
    p_request_id,
    p_external_sequence,
    p_external_timestamp,
    p_external_record_hash,
    p_external_receipt_signature,
    p_external_key_version,
    p_external_idempotency_hash
  )
$$;

create function public.internal_admin_record_reconciliation(
  p_request_id uuid,
  p_original_actor_id uuid,
  p_effective_profile_id uuid,
  p_impersonation_session_id uuid,
  p_action text,
  p_target_type text,
  p_target_id uuid,
  p_external_sequence bigint,
  p_external_timestamp timestamptz,
  p_external_record_hash bytea,
  p_external_receipt_signature bytea,
  p_external_key_version integer,
  p_external_idempotency_hash bytea
)
returns boolean
language sql
security definer
set search_path = pg_catalog
as $$
  select private.record_admin_reconciliation(
    p_request_id,
    p_original_actor_id,
    p_effective_profile_id,
    p_impersonation_session_id,
    p_action,
    p_target_type,
    p_target_id,
    p_external_sequence,
    p_external_timestamp,
    p_external_record_hash,
    p_external_receipt_signature,
    p_external_key_version,
    p_external_idempotency_hash
  )
$$;

revoke all on function private.list_pending_audit_outbox(integer)
from public, anon, authenticated, service_role;
revoke all on function private.audit_request_state(uuid)
from public, anon, authenticated, service_role;
revoke all on function private.finalize_audit_outbox(
  uuid, bigint, timestamptz, bytea, bytea, integer, bytea
) from public, anon, authenticated, service_role;
revoke all on function private.record_admin_reconciliation(
  uuid, uuid, uuid, uuid, text, text, uuid,
  bigint, timestamptz, bytea, bytea, integer, bytea
) from public, anon, authenticated, service_role;

revoke all on function public.internal_admin_list_pending_audit_outbox(integer)
from public, anon, authenticated;
revoke all on function public.internal_admin_audit_request_state(uuid)
from public, anon, authenticated;
revoke all on function public.internal_admin_finalize_audit_outbox(
  uuid, bigint, timestamptz, bytea, bytea, integer, bytea
) from public, anon, authenticated;
revoke all on function public.internal_admin_record_reconciliation(
  uuid, uuid, uuid, uuid, text, text, uuid,
  bigint, timestamptz, bytea, bytea, integer, bytea
) from public, anon, authenticated;

grant execute on function public.internal_admin_list_pending_audit_outbox(integer)
to service_role;
grant execute on function public.internal_admin_audit_request_state(uuid)
to service_role;
grant execute on function public.internal_admin_finalize_audit_outbox(
  uuid, bigint, timestamptz, bytea, bytea, integer, bytea
) to service_role;
grant execute on function public.internal_admin_record_reconciliation(
  uuid, uuid, uuid, uuid, text, text, uuid,
  bigint, timestamptz, bytea, bytea, integer, bytea
) to service_role;
