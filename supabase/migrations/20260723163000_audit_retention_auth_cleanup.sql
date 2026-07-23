alter table public.actors
  drop constraint actors_auth_subject_fkey,
  alter column auth_subject drop not null,
  add constraint actors_auth_subject_fkey
    foreign key (auth_subject) references auth.users (id) on delete set null,
  add constraint actors_active_auth_subject_check check (
    disabled_at is not null or auth_subject is not null
  );

create function private.audit_deletion_job_json(p_job_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog
as $$
  select jsonb_build_object(
    'fromSequence', job.from_sequence,
    'jobId', job.id,
    'schemaVersion', 1,
    'status', job.status,
    'toSequence', job.to_sequence,
    'version', job.version,
    'verifiedAt', job.verified_at
  )
  from private.audit_deletion_jobs job
  where job.id = p_job_id
$$;

create function private.admin_prepare_audit_deletion_job(
  p_auth_subject uuid,
  p_auth_session_id uuid,
  p_job_id uuid,
  p_from_sequence bigint,
  p_to_sequence bigint,
  p_hash_before_range bytea,
  p_terminal_record_hash bytea,
  p_manifest_digest bytea
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_actor_id uuid;
  v_existing private.audit_deletion_jobs%rowtype;
begin
  v_actor_id := private.require_superadmin_aal2(
    p_auth_subject, p_auth_session_id
  );
  if p_from_sequence < 1
    or p_to_sequence < p_from_sequence
    or octet_length(p_hash_before_range) <> 32
    or octet_length(p_terminal_record_hash) <> 32
    or octet_length(p_manifest_digest) <> 32
  then
    raise exception using errcode = '22023', message = 'invalid_audit_range';
  end if;
  select job.* into v_existing
  from private.audit_deletion_jobs job
  where job.id = p_job_id;
  if found then
    if v_existing.requested_by <> v_actor_id
      or v_existing.from_sequence <> p_from_sequence
      or v_existing.to_sequence <> p_to_sequence
      or v_existing.hash_before_range <> p_hash_before_range
      or v_existing.terminal_record_hash <> p_terminal_record_hash
      or v_existing.manifest_digest <> p_manifest_digest
    then
      raise exception using errcode = '23505', message = 'idempotency_conflict';
    end if;
    return private.audit_deletion_job_json(v_existing.id);
  end if;
  if exists (
    select 1 from private.audit_deletion_jobs
    where status in ('prepared', 'intent_recorded', 'deleting', 'failed')
  ) then
    raise exception using errcode = '55000', message = 'audit_deletion_incomplete';
  end if;
  insert into private.audit_deletion_jobs (
    id, requested_by, from_sequence, to_sequence, hash_before_range,
    terminal_record_hash, manifest_digest
  ) values (
    p_job_id, v_actor_id, p_from_sequence, p_to_sequence,
    p_hash_before_range, p_terminal_record_hash, p_manifest_digest
  );
  return private.audit_deletion_job_json(p_job_id);
end;
$$;

create function private.admin_record_audit_deletion_intent(
  p_auth_subject uuid,
  p_auth_session_id uuid,
  p_job_id uuid,
  p_expected_version integer,
  p_intent_record_hash bytea
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_job private.audit_deletion_jobs%rowtype;
begin
  perform private.require_superadmin_aal2(
    p_auth_subject, p_auth_session_id
  );
  select job.* into v_job
  from private.audit_deletion_jobs job
  where job.id = p_job_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'audit_job_not_found';
  end if;
  if v_job.version <> p_expected_version then
    raise exception using errcode = '40001', message = 'version_conflict';
  end if;
  if v_job.status <> 'prepared' or octet_length(p_intent_record_hash) <> 32 then
    raise exception using errcode = '23514', message = 'invalid_job_transition';
  end if;
  insert into private.audit_range_tombstones (
    audit_deletion_job_id, from_sequence, to_sequence,
    intent_record_hash, manifest_digest
  ) values (
    v_job.id, v_job.from_sequence, v_job.to_sequence,
    p_intent_record_hash, v_job.manifest_digest
  );
  update private.audit_deletion_jobs
  set status = 'intent_recorded',
      version = version + 1,
      updated_at = clock_timestamp()
  where id = p_job_id;
  return private.audit_deletion_job_json(p_job_id);
end;
$$;

create function private.admin_complete_audit_deletion(
  p_auth_subject uuid,
  p_auth_session_id uuid,
  p_job_id uuid,
  p_expected_version integer,
  p_complete_record_hash bytea
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_job private.audit_deletion_jobs%rowtype;
begin
  perform private.require_superadmin_aal2(
    p_auth_subject, p_auth_session_id
  );
  select job.* into v_job
  from private.audit_deletion_jobs job
  where job.id = p_job_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'audit_job_not_found';
  end if;
  if v_job.version <> p_expected_version then
    raise exception using errcode = '40001', message = 'version_conflict';
  end if;
  if v_job.status not in ('intent_recorded', 'deleting')
    or octet_length(p_complete_record_hash) <> 32
  then
    raise exception using errcode = '23514', message = 'invalid_job_transition';
  end if;
  update private.audit_range_tombstones
  set complete_record_hash = p_complete_record_hash,
      completed_at = clock_timestamp()
  where audit_deletion_job_id = p_job_id
    and complete_record_hash is null;
  if not found then
    raise exception using errcode = '55000', message = 'audit_intent_missing';
  end if;
  update private.audit_deletion_jobs
  set status = 'verified',
      version = version + 1,
      verified_at = clock_timestamp(),
      updated_at = clock_timestamp()
  where id = p_job_id;
  return private.audit_deletion_job_json(p_job_id);
end;
$$;

create function private.admin_list_auth_cleanup_candidates(
  p_auth_subject uuid,
  p_auth_session_id uuid,
  p_cursor uuid default null,
  p_limit integer default 100
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog
as $$
begin
  perform private.require_superadmin_aal2(
    p_auth_subject, p_auth_session_id
  );
  if p_limit < 1 or p_limit > 100 then
    raise exception using errcode = '22023', message = 'invalid_cleanup_limit';
  end if;
  return (
    select coalesce(jsonb_agg(candidate.payload order by candidate.auth_subject), '[]'::jsonb)
    from (
      select actor.auth_subject, jsonb_build_object(
        'actorDisabled', actor.disabled_at is not null,
        'actorRole', actor.role,
        'anonymous', coalesce(auth_user.is_anonymous, false),
        'authPresent', true,
        'authSubject', actor.auth_subject,
        'createdAt', auth_user.created_at,
        'hasActiveInvitation', false,
        'hasActiveMembership', false,
        'hasPendingOperation', false,
        'lastActiveAt', auth_user.last_sign_in_at
      ) payload
      from public.actors actor
      join auth.users auth_user on auth_user.id = actor.auth_subject
      where actor.role = 'device'
        and (p_cursor is null or actor.auth_subject > p_cursor)
        and not exists (
          select 1 from public.profile_access access
          where access.actor_id = actor.id and access.revoked_at is null
        )
        and not exists (
          select 1 from private.invitations invitation
          where invitation.created_by = actor.id
            and invitation.consumed_at is null
            and invitation.revoked_at is null
            and invitation.expires_at > clock_timestamp()
        )
        and not exists (
          select 1 from private.deletion_jobs job
          where (job.requester_actor_id = actor.id or job.confirmed_by = actor.id)
            and job.status <> 'purged'
        )
        and not exists (
          select 1 from private.backup_jobs job
          where job.requested_by = actor.id
            and job.status not in ('ready', 'pruned')
        )
        and not exists (
          select 1 from private.restore_jobs job
          where job.requested_by = actor.id
            and job.status not in ('promoted', 'failed')
        )
        and not exists (
          select 1 from private.audit_deletion_jobs job
          where job.requested_by = actor.id and job.status <> 'verified'
        )
        and (
          (
            coalesce(auth_user.is_anonymous, false)
            and auth_user.created_at < clock_timestamp() - interval '24 hours'
          )
          or (
            not coalesce(auth_user.is_anonymous, false)
            and coalesce(auth_user.last_sign_in_at, auth_user.created_at)
              < clock_timestamp() - interval '30 days'
          )
        )
      order by actor.auth_subject
      limit p_limit
    ) candidate
  );
end;
$$;

create function private.admin_disable_auth_cleanup_actor(
  p_auth_subject uuid,
  p_auth_session_id uuid,
  p_candidate_auth_subject uuid
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_actor public.actors%rowtype;
begin
  perform private.require_superadmin_aal2(
    p_auth_subject, p_auth_session_id
  );
  select actor.* into v_actor
  from public.actors actor
  where actor.auth_subject = p_candidate_auth_subject
  for update;
  if not found then return true; end if;
  if v_actor.role = 'superadmin' then
    raise exception using errcode = '42501', message = 'superadmin_protected';
  end if;
  if exists (
    select 1 from public.profile_access access
    where access.actor_id = v_actor.id and access.revoked_at is null
  ) then
    raise exception using errcode = '55000', message = 'active_membership_exists';
  end if;
  update public.actors
  set disabled_at = coalesce(disabled_at, clock_timestamp())
  where id = v_actor.id;
  return true;
end;
$$;

create function public.internal_admin_prepare_audit_deletion_job(
  p_auth_subject uuid, p_auth_session_id uuid, p_job_id uuid,
  p_from_sequence bigint, p_to_sequence bigint,
  p_hash_before_range bytea, p_terminal_record_hash bytea,
  p_manifest_digest bytea
)
returns jsonb language sql security definer set search_path = pg_catalog
as $$
  select private.admin_prepare_audit_deletion_job(
    p_auth_subject, p_auth_session_id, p_job_id, p_from_sequence,
    p_to_sequence, p_hash_before_range, p_terminal_record_hash,
    p_manifest_digest
  )
$$;

create function public.internal_admin_record_audit_deletion_intent(
  p_auth_subject uuid, p_auth_session_id uuid, p_job_id uuid,
  p_expected_version integer, p_intent_record_hash bytea
)
returns jsonb language sql security definer set search_path = pg_catalog
as $$
  select private.admin_record_audit_deletion_intent(
    p_auth_subject, p_auth_session_id, p_job_id,
    p_expected_version, p_intent_record_hash
  )
$$;

create function public.internal_admin_complete_audit_deletion(
  p_auth_subject uuid, p_auth_session_id uuid, p_job_id uuid,
  p_expected_version integer, p_complete_record_hash bytea
)
returns jsonb language sql security definer set search_path = pg_catalog
as $$
  select private.admin_complete_audit_deletion(
    p_auth_subject, p_auth_session_id, p_job_id,
    p_expected_version, p_complete_record_hash
  )
$$;

create function public.internal_admin_list_auth_cleanup_candidates(
  p_auth_subject uuid, p_auth_session_id uuid,
  p_cursor uuid default null, p_limit integer default 100
)
returns jsonb language sql security definer set search_path = pg_catalog
as $$
  select private.admin_list_auth_cleanup_candidates(
    p_auth_subject, p_auth_session_id, p_cursor, p_limit
  )
$$;

create function public.internal_admin_disable_auth_cleanup_actor(
  p_auth_subject uuid, p_auth_session_id uuid, p_candidate_auth_subject uuid
)
returns boolean language sql security definer set search_path = pg_catalog
as $$
  select private.admin_disable_auth_cleanup_actor(
    p_auth_subject, p_auth_session_id, p_candidate_auth_subject
  )
$$;

revoke execute on function private.audit_deletion_job_json(uuid)
from public, anon, authenticated, service_role;
revoke execute on function private.admin_prepare_audit_deletion_job(
  uuid, uuid, uuid, bigint, bigint, bytea, bytea, bytea
) from public, anon, authenticated, service_role;
revoke execute on function private.admin_record_audit_deletion_intent(
  uuid, uuid, uuid, integer, bytea
) from public, anon, authenticated, service_role;
revoke execute on function private.admin_complete_audit_deletion(
  uuid, uuid, uuid, integer, bytea
) from public, anon, authenticated, service_role;
revoke execute on function private.admin_list_auth_cleanup_candidates(
  uuid, uuid, uuid, integer
) from public, anon, authenticated, service_role;
revoke execute on function private.admin_disable_auth_cleanup_actor(
  uuid, uuid, uuid
) from public, anon, authenticated, service_role;

revoke execute on function public.internal_admin_prepare_audit_deletion_job(
  uuid, uuid, uuid, bigint, bigint, bytea, bytea, bytea
) from public, anon, authenticated;
revoke execute on function public.internal_admin_record_audit_deletion_intent(
  uuid, uuid, uuid, integer, bytea
) from public, anon, authenticated;
revoke execute on function public.internal_admin_complete_audit_deletion(
  uuid, uuid, uuid, integer, bytea
) from public, anon, authenticated;
revoke execute on function public.internal_admin_list_auth_cleanup_candidates(
  uuid, uuid, uuid, integer
) from public, anon, authenticated;
revoke execute on function public.internal_admin_disable_auth_cleanup_actor(
  uuid, uuid, uuid
) from public, anon, authenticated;

grant execute on function public.internal_admin_prepare_audit_deletion_job(
  uuid, uuid, uuid, bigint, bigint, bytea, bytea, bytea
) to service_role;
grant execute on function public.internal_admin_record_audit_deletion_intent(
  uuid, uuid, uuid, integer, bytea
) to service_role;
grant execute on function public.internal_admin_complete_audit_deletion(
  uuid, uuid, uuid, integer, bytea
) to service_role;
grant execute on function public.internal_admin_list_auth_cleanup_candidates(
  uuid, uuid, uuid, integer
) to service_role;
grant execute on function public.internal_admin_disable_auth_cleanup_actor(
  uuid, uuid, uuid
) to service_role;
