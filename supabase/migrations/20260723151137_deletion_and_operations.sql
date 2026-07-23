alter table private.deletion_jobs
  add column profile_marker_key_version integer not null default 1
    check (profile_marker_key_version > 0),
  add column version integer not null default 1 check (version > 0),
  add column updated_at timestamptz not null default clock_timestamp(),
  add column idempotency_key_digest bytea
    check (idempotency_key_digest is null or octet_length(idempotency_key_digest) = 32),
  add column request_digest bytea
    check (request_digest is null or octet_length(request_digest) = 32),
  add column ledger_receipt_hash bytea
    check (ledger_receipt_hash is null or octet_length(ledger_receipt_hash) = 32);

alter table private.deletion_jobs
  add constraint deletion_jobs_error_code_check check (
    last_error_code is null
    or last_error_code in (
      'ledger_unavailable',
      'ledger_verification_failed',
      'access_revocation_failed',
      'export_purge_failed',
      'storage_unavailable',
      'storage_verification_failed',
      'profile_purge_failed',
      'auth_cleanup_pending',
      'verification_failed'
    )
  ),
  add constraint deletion_jobs_ledger_receipt_check check (
    idempotency_key_digest is null
    or status in ('queued', 'failed')
    or ledger_receipt_hash is not null
  );

create unique index deletion_jobs_one_profile_idx
on private.deletion_jobs (profile_id)
where profile_id is not null;

create unique index deletion_jobs_actor_idempotency_idx
on private.deletion_jobs (requester_actor_id, idempotency_key_digest)
where requester_actor_id is not null and idempotency_key_digest is not null;

create unique index deletion_jobs_handle_idx
on private.deletion_jobs (request_handle_hash);

create table private.deletion_job_steps (
  deletion_job_id uuid not null
    references private.deletion_jobs (id) on delete cascade,
  step_name text not null check (
    step_name in (
      'ledger', 'access', 'exports', 'storage',
      'profile_data', 'auth', 'verification'
    )
  ),
  completed_at timestamptz,
  receipt_digest bytea
    check (receipt_digest is null or octet_length(receipt_digest) = 32),
  primary key (deletion_job_id, step_name),
  check (
    (completed_at is null and receipt_digest is null)
    or (completed_at is not null and receipt_digest is not null)
  )
);

create table private.backup_jobs (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('weekly', 'precritical')),
  status text not null default 'queued' check (
    status in ('queued', 'capturing', 'verifying', 'ready', 'failed', 'pruned')
  ),
  version integer not null default 1 check (version > 0),
  requested_by uuid not null references public.actors (id) on delete restrict,
  source_environment text not null check (
    source_environment in ('local', 'development', 'production')
  ),
  schema_version integer not null check (schema_version > 0),
  tool_version text not null check (
    length(tool_version) between 1 and 64
    and tool_version collate "C" ~ '^[A-Za-z0-9._-]+$'
  ),
  manifest_digest bytea
    check (manifest_digest is null or octet_length(manifest_digest) = 32),
  key_version integer check (key_version is null or key_version > 0),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  verified_at timestamptz,
  failed_at timestamptz,
  pruned_at timestamptz,
  last_error_code text check (
    last_error_code is null
    or last_error_code in (
      'capture_failed', 'manifest_invalid', 'storage_incomplete',
      'crypto_verification_failed', 'ledger_copy_stale', 'prune_failed'
    )
  ),
  check (
    status <> 'ready'
    or (
      manifest_digest is not null
      and key_version is not null
      and verified_at is not null
    )
  )
);

create table private.restore_jobs (
  id uuid primary key default gen_random_uuid(),
  backup_job_id uuid not null references private.backup_jobs (id) on delete restrict,
  status text not null default 'queued' check (
    status in (
      'queued', 'verifying', 'restoring', 'validating',
      'ready_for_promotion', 'promoted', 'blocked', 'failed'
    )
  ),
  version integer not null default 1 check (version > 0),
  requested_by uuid not null references public.actors (id) on delete restrict,
  target_environment text not null check (target_environment = 'local-isolated'),
  target_fingerprint bytea not null check (octet_length(target_fingerprint) = 32),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  verified_at timestamptz,
  promoted_at timestamptz,
  last_error_code text check (
    last_error_code is null
    or last_error_code in (
      'target_not_isolated', 'target_not_empty', 'manifest_invalid',
      'crypto_verification_failed', 'ledger_invalid', 'pending_intent',
      'audit_range_incomplete', 'storage_incomplete', 'restore_verification_failed'
    )
  ),
  check (
    status not in ('ready_for_promotion', 'promoted')
    or verified_at is not null
  ),
  check (status <> 'promoted' or promoted_at is not null)
);

create table private.audit_deletion_jobs (
  id uuid primary key default gen_random_uuid(),
  status text not null default 'prepared' check (
    status in ('prepared', 'intent_recorded', 'deleting', 'verified', 'failed')
  ),
  version integer not null default 1 check (version > 0),
  requested_by uuid not null references public.actors (id) on delete restrict,
  from_sequence bigint not null check (from_sequence > 0),
  to_sequence bigint not null check (to_sequence >= from_sequence),
  hash_before_range bytea not null check (octet_length(hash_before_range) = 32),
  terminal_record_hash bytea not null
    check (octet_length(terminal_record_hash) = 32),
  manifest_digest bytea not null check (octet_length(manifest_digest) = 32),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  verified_at timestamptz,
  last_error_code text check (
    last_error_code is null
    or last_error_code in (
      'intent_failed', 'jit_credential_failed', 'delete_partial',
      'absence_verification_failed', 'complete_receipt_failed'
    )
  )
);

create unique index audit_deletion_jobs_open_idx
on private.audit_deletion_jobs ((true))
where status in ('prepared', 'intent_recorded', 'deleting', 'failed');

create table private.audit_range_tombstones (
  audit_deletion_job_id uuid primary key
    references private.audit_deletion_jobs (id) on delete restrict,
  from_sequence bigint not null,
  to_sequence bigint not null,
  intent_record_hash bytea not null check (octet_length(intent_record_hash) = 32),
  complete_record_hash bytea check (
    complete_record_hash is null or octet_length(complete_record_hash) = 32
  ),
  manifest_digest bytea not null check (octet_length(manifest_digest) = 32),
  created_at timestamptz not null default clock_timestamp(),
  completed_at timestamptz,
  check (
    (completed_at is null and complete_record_hash is null)
    or (completed_at is not null and complete_record_hash is not null)
  )
);

alter table private.deletion_job_steps enable row level security;
alter table private.backup_jobs enable row level security;
alter table private.restore_jobs enable row level security;
alter table private.audit_deletion_jobs enable row level security;
alter table private.audit_range_tombstones enable row level security;

revoke all on table private.deletion_job_steps
from public, anon, authenticated, service_role;
revoke all on table private.backup_jobs
from public, anon, authenticated, service_role;
revoke all on table private.restore_jobs
from public, anon, authenticated, service_role;
revoke all on table private.audit_deletion_jobs
from public, anon, authenticated, service_role;
revoke all on table private.audit_range_tombstones
from public, anon, authenticated, service_role;

create function private.deletion_job_json(p_job_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog
as $$
  select jsonb_build_object(
    'jobId', job.id,
    'profileId', job.profile_id,
    'status', job.status,
    'requestedAt', job.requested_at,
    'completedAt', job.completed_at,
    'attempts', job.attempts,
    'errorCode', job.last_error_code,
    'version', job.version,
    'steps', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'name', step.step_name,
          'completed', step.completed_at is not null
        )
        order by array_position(
          array[
            'ledger', 'access', 'exports', 'storage',
            'profile_data', 'auth', 'verification'
          ]::text[],
          step.step_name
        )
      )
      from private.deletion_job_steps step
      where step.deletion_job_id = job.id
    ), '[]'::jsonb)
  )
  from private.deletion_jobs job
  where job.id = p_job_id
$$;

create function private.request_profile_deletion(
  p_auth_subject uuid,
  p_auth_session_id uuid,
  p_profile_id uuid,
  p_alias_normalized text,
  p_profile_marker bytea,
  p_request_handle_hash bytea,
  p_idempotency_key_digest bytea,
  p_request_digest bytea,
  p_profile_marker_key_version integer
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_actor_id uuid;
  v_device_session_id uuid;
  v_profile public.profiles%rowtype;
  v_existing private.deletion_jobs%rowtype;
  v_job_id uuid;
begin
  if octet_length(p_profile_marker) <> 32
    or octet_length(p_request_handle_hash) <> 32
    or octet_length(p_idempotency_key_digest) <> 32
    or octet_length(p_request_digest) <> 32
    or p_profile_marker_key_version <= 0
  then
    raise exception using errcode = '22023', message = 'invalid_input';
  end if;

  select context.actor_id, context.device_session_id
  into v_actor_id, v_device_session_id
  from private.require_internal_device_session(
    p_auth_subject, p_auth_session_id
  ) context;

  perform pg_advisory_xact_lock(hashtextextended(
    'profile-deletion:' || p_profile_id::text, 0
  ));

  select job.* into v_existing
  from private.deletion_jobs job
  where job.requester_actor_id = v_actor_id
    and job.idempotency_key_digest = p_idempotency_key_digest;

  if found then
    if v_existing.request_digest <> p_request_digest
      or v_existing.profile_id is distinct from p_profile_id
    then
      raise exception using errcode = '23505', message = 'idempotency_conflict';
    end if;
    return private.deletion_job_json(v_existing.id);
  end if;

  select profile.* into v_profile
  from public.profiles profile
  where profile.id = p_profile_id
  for update;
  if not found
    or v_profile.status not in ('active', 'deletion_requested')
    or v_profile.alias_normalized <> private.normalize_alias(p_alias_normalized)
    or not private.actor_has_profile_access(
      v_actor_id, v_device_session_id, p_profile_id
    )
  then
    raise exception using errcode = '42501', message = 'profile_access_denied';
  end if;

  select job.* into v_existing
  from private.deletion_jobs job
  where job.profile_id = p_profile_id;
  if found then
    return private.deletion_job_json(v_existing.id);
  end if;

  v_job_id := gen_random_uuid();
  insert into private.deletion_jobs (
    id, profile_id, profile_marker, request_handle_hash,
    requester_actor_id, confirmed_by, profile_marker_key_version,
    idempotency_key_digest, request_digest
  ) values (
    v_job_id, p_profile_id, p_profile_marker, p_request_handle_hash,
    v_actor_id, v_actor_id, p_profile_marker_key_version,
    p_idempotency_key_digest, p_request_digest
  );

  insert into private.deletion_job_steps (deletion_job_id, step_name)
  select v_job_id, step_name
  from unnest(array[
    'ledger', 'access', 'exports', 'storage',
    'profile_data', 'auth', 'verification'
  ]::text[]) step_name;

  update public.profiles
  set status = 'deletion_requested',
      deletion_requested_at = coalesce(deletion_requested_at, clock_timestamp())
  where id = p_profile_id and status = 'active';

  return private.deletion_job_json(v_job_id);
end;
$$;

create function private.get_deletion_request(
  p_auth_subject uuid,
  p_auth_session_id uuid,
  p_request_handle_hash bytea
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_actor_id uuid;
  v_job private.deletion_jobs%rowtype;
begin
  select context.actor_id into v_actor_id
  from private.require_internal_device_session(
    p_auth_subject, p_auth_session_id
  ) context;

  select job.* into v_job
  from private.deletion_jobs job
  where job.request_handle_hash = p_request_handle_hash
    and job.requester_actor_id = v_actor_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'deletion_request_not_found';
  end if;

  return jsonb_build_object(
    'status', v_job.status,
    'requestedAt', v_job.requested_at,
    'completedAt', v_job.completed_at,
    'errorCode', case
      when v_job.last_error_code in (
        'ledger_unavailable', 'storage_unavailable',
        'auth_cleanup_pending'
      ) then v_job.last_error_code
      when v_job.last_error_code is null then null
      else 'purge_incomplete'
    end
  );
end;
$$;

create function private.admin_transition_deletion_job(
  p_auth_subject uuid,
  p_auth_session_id uuid,
  p_job_id uuid,
  p_expected_version integer,
  p_next_status text,
  p_error_code text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_actor_id uuid;
  v_job private.deletion_jobs%rowtype;
  v_allowed boolean := false;
begin
  v_actor_id := private.require_superadmin_aal2(
    p_auth_subject, p_auth_session_id
  );

  select job.* into v_job
  from private.deletion_jobs job
  where job.id = p_job_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'deletion_job_not_found';
  end if;
  if v_job.version <> p_expected_version then
    raise exception using errcode = '40001', message = 'version_conflict';
  end if;

  v_allowed :=
    (v_job.status = 'queued' and p_next_status in ('ledger_recorded', 'failed'))
    or (
      v_job.status = 'ledger_recorded'
      and p_next_status in ('purging', 'failed')
    )
    or (v_job.status = 'purging' and p_next_status in ('purged', 'failed'))
    or (
      v_job.status = 'failed'
      and p_next_status in ('queued', 'ledger_recorded', 'purging')
    );
  if not v_allowed then
    raise exception using errcode = '23514', message = 'invalid_job_transition';
  end if;
  if (p_next_status = 'failed') <> (p_error_code is not null) then
    raise exception using errcode = '22023', message = 'error_code_mismatch';
  end if;

  update private.deletion_jobs
  set status = p_next_status,
      version = version + 1,
      attempts = attempts + case when v_job.status = 'failed' then 1 else 0 end,
      last_error_code = p_error_code,
      updated_at = clock_timestamp(),
      completed_at = case
        when p_next_status = 'purged' then clock_timestamp()
        else null
      end
  where id = p_job_id;

  return private.deletion_job_json(p_job_id);
end;
$$;

create function private.admin_complete_deletion_step(
  p_auth_subject uuid,
  p_auth_session_id uuid,
  p_job_id uuid,
  p_expected_version integer,
  p_step_name text,
  p_receipt_digest bytea
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_job private.deletion_jobs%rowtype;
begin
  perform private.require_superadmin_aal2(
    p_auth_subject, p_auth_session_id
  );
  if p_step_name not in (
    'ledger', 'access', 'exports', 'storage',
    'profile_data', 'auth', 'verification'
  ) or octet_length(p_receipt_digest) <> 32 then
    raise exception using errcode = '22023', message = 'invalid_input';
  end if;

  select job.* into v_job
  from private.deletion_jobs job
  where job.id = p_job_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'deletion_job_not_found';
  end if;
  if v_job.version <> p_expected_version then
    raise exception using errcode = '40001', message = 'version_conflict';
  end if;

  update private.deletion_job_steps
  set completed_at = coalesce(completed_at, clock_timestamp()),
      receipt_digest = coalesce(receipt_digest, p_receipt_digest)
  where deletion_job_id = p_job_id and step_name = p_step_name;

  if not found then
    raise exception using errcode = 'P0002', message = 'deletion_step_not_found';
  end if;
  if exists (
    select 1
    from private.deletion_job_steps step
    where step.deletion_job_id = p_job_id
      and step.step_name = p_step_name
      and step.receipt_digest <> p_receipt_digest
  ) then
    raise exception using errcode = '23505', message = 'step_receipt_conflict';
  end if;

  update private.deletion_jobs
  set ledger_receipt_hash = case
        when p_step_name = 'ledger' then
          coalesce(ledger_receipt_hash, p_receipt_digest)
        else ledger_receipt_hash
      end,
      version = version + 1,
      updated_at = clock_timestamp()
  where id = p_job_id;

  return private.deletion_job_json(p_job_id);
end;
$$;

create function public.internal_request_profile_deletion(
  p_auth_subject uuid,
  p_auth_session_id uuid,
  p_profile_id uuid,
  p_alias_normalized text,
  p_profile_marker bytea,
  p_request_handle_hash bytea,
  p_idempotency_key_digest bytea,
  p_request_digest bytea,
  p_profile_marker_key_version integer
)
returns jsonb
language sql
security definer
set search_path = pg_catalog
as $$
  select private.request_profile_deletion(
    p_auth_subject, p_auth_session_id, p_profile_id, p_alias_normalized,
    p_profile_marker, p_request_handle_hash, p_idempotency_key_digest,
    p_request_digest, p_profile_marker_key_version
  )
$$;

create function public.internal_get_deletion_request(
  p_auth_subject uuid,
  p_auth_session_id uuid,
  p_request_handle_hash bytea
)
returns jsonb
language sql
security definer
set search_path = pg_catalog
as $$
  select private.get_deletion_request(
    p_auth_subject, p_auth_session_id, p_request_handle_hash
  )
$$;

create function public.internal_admin_transition_deletion_job(
  p_auth_subject uuid,
  p_auth_session_id uuid,
  p_job_id uuid,
  p_expected_version integer,
  p_next_status text,
  p_error_code text
)
returns jsonb
language sql
security definer
set search_path = pg_catalog
as $$
  select private.admin_transition_deletion_job(
    p_auth_subject, p_auth_session_id, p_job_id, p_expected_version,
    p_next_status, p_error_code
  )
$$;

create function public.internal_admin_complete_deletion_step(
  p_auth_subject uuid,
  p_auth_session_id uuid,
  p_job_id uuid,
  p_expected_version integer,
  p_step_name text,
  p_receipt_digest bytea
)
returns jsonb
language sql
security definer
set search_path = pg_catalog
as $$
  select private.admin_complete_deletion_step(
    p_auth_subject, p_auth_session_id, p_job_id, p_expected_version,
    p_step_name, p_receipt_digest
  )
$$;

revoke execute on function private.deletion_job_json(uuid)
from public, anon, authenticated, service_role;
revoke execute on function private.request_profile_deletion(
  uuid, uuid, uuid, text, bytea, bytea, bytea, bytea, integer
) from public, anon, authenticated, service_role;
revoke execute on function private.get_deletion_request(uuid, uuid, bytea)
from public, anon, authenticated, service_role;
revoke execute on function private.admin_transition_deletion_job(
  uuid, uuid, uuid, integer, text, text
) from public, anon, authenticated, service_role;
revoke execute on function private.admin_complete_deletion_step(
  uuid, uuid, uuid, integer, text, bytea
) from public, anon, authenticated, service_role;
revoke execute on function public.internal_request_profile_deletion(
  uuid, uuid, uuid, text, bytea, bytea, bytea, bytea, integer
) from public, anon, authenticated;
revoke execute on function public.internal_get_deletion_request(
  uuid, uuid, bytea
) from public, anon, authenticated;
revoke execute on function public.internal_admin_transition_deletion_job(
  uuid, uuid, uuid, integer, text, text
) from public, anon, authenticated;
revoke execute on function public.internal_admin_complete_deletion_step(
  uuid, uuid, uuid, integer, text, bytea
) from public, anon, authenticated;

grant execute on function public.internal_request_profile_deletion(
  uuid, uuid, uuid, text, bytea, bytea, bytea, bytea, integer
) to service_role;
grant execute on function public.internal_get_deletion_request(
  uuid, uuid, bytea
) to service_role;
grant execute on function public.internal_admin_transition_deletion_job(
  uuid, uuid, uuid, integer, text, text
) to service_role;
grant execute on function public.internal_admin_complete_deletion_step(
  uuid, uuid, uuid, integer, text, bytea
) to service_role;
