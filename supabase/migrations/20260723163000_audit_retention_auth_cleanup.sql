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
        and coalesce(auth_user.is_anonymous, false)
        and coalesce(auth_user.last_sign_in_at, auth_user.created_at)
          < clock_timestamp() - interval '24 hours'
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
  if v_actor.role <> 'device'
    or not exists (
      select 1
      from auth.users auth_user
      where auth_user.id = p_candidate_auth_subject
        and coalesce(auth_user.is_anonymous, false)
        and coalesce(auth_user.last_sign_in_at, auth_user.created_at)
          < clock_timestamp() - interval '24 hours'
    )
    or exists (
      select 1 from public.profile_access access
      where access.actor_id = v_actor.id and access.revoked_at is null
    )
    or exists (
      select 1 from private.invitations invitation
      where invitation.created_by = v_actor.id
        and invitation.consumed_at is null
        and invitation.revoked_at is null
        and invitation.expires_at > clock_timestamp()
    )
    or exists (
      select 1 from private.deletion_jobs job
      where (
        job.requester_actor_id = v_actor.id
        or job.confirmed_by = v_actor.id
      )
      and job.status <> 'purged'
    )
    or exists (
      select 1 from private.backup_jobs job
      where job.requested_by = v_actor.id
        and job.status not in ('ready', 'failed', 'pruned')
    )
    or exists (
      select 1 from private.restore_jobs job
      where job.requested_by = v_actor.id
        and job.status not in ('promoted', 'failed')
    )
    or exists (
      select 1 from private.audit_deletion_jobs job
      where job.requested_by = v_actor.id and job.status <> 'verified'
    )
  then
    raise exception using errcode = '55000', message = 'auth_cleanup_ineligible';
  end if;
  update public.actors
  set disabled_at = coalesce(disabled_at, clock_timestamp())
  where id = v_actor.id;
  return true;
end;
$$;

alter table private.audit_outbox
  add column desired_result text not null default 'success',
  add column desired_error_code text,
  add constraint audit_outbox_desired_result_value_check
    check (desired_result in ('pending', 'success', 'failure')),
  add constraint audit_outbox_desired_error_code_value_check check (
      desired_error_code is null
      or desired_error_code in (
        'domain_constraint',
        'mutation_failed',
        'reconciliation_required'
      )
    ),
  add constraint audit_outbox_desired_result_check check (
    (desired_result in ('pending', 'success') and desired_error_code is null)
    or (desired_result = 'failure' and desired_error_code is not null)
  );

update private.audit_outbox
set desired_result = 'pending'
where outcome_status = 'pending'
  and action in (
    'anonymous_auth_cleanup',
    'audit_range_delete_execute',
    'audit_range_delete_prepare',
    'backup_create',
    'profile_deletion_permanent',
    'profile_deletion_resume',
    'restore_create',
    'restore_promote'
  );

create function private.classify_t18_audit_outbox()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  if new.action in (
    'anonymous_auth_cleanup',
    'audit_range_delete_execute',
    'audit_range_delete_prepare',
    'backup_create',
    'profile_deletion_permanent',
    'profile_deletion_resume',
    'restore_create',
    'restore_promote'
  ) then
    new.desired_result := 'pending';
    new.desired_error_code := null;
  end if;
  return new;
end;
$$;

create trigger audit_outbox_classify_t18
before insert on private.audit_outbox
for each row execute function private.classify_t18_audit_outbox();

revoke all on function private.classify_t18_audit_outbox()
from public, anon, authenticated, service_role;

create function private.mark_t18_audit_outbox_outcome(
  p_request_id uuid,
  p_result text,
  p_error_code text
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  if p_result not in ('success', 'failure')
    or (p_result = 'success' and p_error_code is not null)
    or (
      p_result = 'failure'
      and p_error_code not in ('domain_constraint', 'mutation_failed')
    )
  then
    raise exception using errcode = '22023', message = 'invalid_audit_error_code';
  end if;
  if not exists (
    select 1 from private.audit_outbox outbox
    where outbox.request_id = p_request_id
  ) then
    return false;
  end if;
  update private.audit_outbox outbox
  set desired_result = p_result,
      desired_error_code = p_error_code
  where outbox.request_id = p_request_id
    and outbox.outcome_status = 'pending'
    and outbox.desired_result = 'pending';
  if not found then
    if exists (
      select 1 from private.audit_outbox outbox
      where outbox.request_id = p_request_id
        and outbox.outcome_status = 'pending'
        and outbox.desired_result = p_result
        and outbox.desired_error_code is not distinct from p_error_code
    ) then
      return true;
    end if;
    raise exception using errcode = '55000', message = 'audit_outbox_not_pending';
  end if;
  return true;
end;
$$;

create function private.finalize_t18_audit_outbox(
  p_request_id uuid,
  p_result text,
  p_error_code text,
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
    p_external_sequence, p_external_timestamp, p_external_record_hash,
    p_external_receipt_signature, p_external_key_version,
    p_external_idempotency_hash
  );
  select outbox.* into v_outbox
  from private.audit_outbox outbox
  where outbox.request_id = p_request_id
  for update;
  if not found then
    raise exception using errcode = '22023', message = 'audit_outbox_not_found';
  end if;
  if p_result <> v_outbox.desired_result
    or p_error_code is distinct from v_outbox.desired_error_code
  then
    raise exception using errcode = '22023', message = 'audit_outcome_mismatch';
  end if;
  if v_outbox.outcome_status <> 'pending' then
    select event.* into v_existing
    from private.technical_audit_events event
    where event.request_id = p_request_id and event.phase = 'outcome';
    if v_existing.result <> p_result
      or v_existing.error_code is distinct from p_error_code
      or v_existing.external_record_hash <> p_external_record_hash
      or v_existing.external_receipt_signature <> p_external_receipt_signature
      or v_existing.external_idempotency_hash <> p_external_idempotency_hash
    then
      raise exception using errcode = '23505', message = 'audit_outcome_conflict';
    end if;
    return true;
  end if;
  insert into private.technical_audit_events (
    actor_id, action, target_type, target_id, result,
    request_id, phase, original_actor_id, effective_profile_id,
    impersonation_session_id, external_sequence, external_timestamp,
    external_record_hash, external_receipt_signature, external_key_version,
    external_idempotency_hash
  ) values (
    v_outbox.original_actor_id, v_outbox.action, v_outbox.target_type,
    v_outbox.target_id, p_result, v_outbox.request_id, 'outcome',
    v_outbox.original_actor_id, v_outbox.effective_profile_id,
    v_outbox.impersonation_session_id, p_external_sequence,
    p_external_timestamp, p_external_record_hash,
    p_external_receipt_signature, p_external_key_version,
    p_external_idempotency_hash
  );
  update private.audit_outbox outbox
  set outcome_status = p_result,
      error_code = p_error_code,
      dispatched_at = clock_timestamp()
  where outbox.id = v_outbox.id;
  return true;
end;
$$;

create function private.list_pending_t18_audit_outbox(p_limit integer)
returns table (
  request_id uuid,
  original_actor_id uuid,
  effective_profile_id uuid,
  impersonation_session_id uuid,
  action text,
  target_type text,
  target_id uuid,
  intent_record_hash bytea,
  desired_result text,
  desired_error_code text
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
    touched.request_id, touched.original_actor_id,
    touched.effective_profile_id, touched.impersonation_session_id,
    touched.action, touched.target_type, touched.target_id,
    intent.external_record_hash, touched.desired_result,
    touched.desired_error_code
  from touched
  join private.technical_audit_events intent
    on intent.id = touched.technical_audit_event_id
  order by touched.created_at, touched.id;
end;
$$;

create function private.record_t18_admin_reconciliation(
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
    p_external_sequence, p_external_timestamp, p_external_record_hash,
    p_external_receipt_signature, p_external_key_version,
    p_external_idempotency_hash
  );
  if not (
    (p_action in ('profile_deletion_permanent', 'profile_deletion_resume')
      and p_target_type = 'deletion_job')
    or (p_action = 'backup_create' and p_target_type = 'backup_job')
    or (p_action in ('restore_create', 'restore_promote')
      and p_target_type = 'restore_job')
    or (p_action in ('audit_range_delete_prepare', 'audit_range_delete_execute')
      and p_target_type = 'audit_deletion_job')
    or (p_action = 'anonymous_auth_cleanup' and p_target_type = 'auth_user')
  ) then
    raise exception using errcode = '22023',
      message = 'invalid_t18_reconciliation_action';
  end if;
  if not exists (
    select 1 from public.actors actor
    where actor.id = p_original_actor_id
      and actor.role = 'superadmin'
      and actor.disabled_at is null
  ) then
    raise exception using errcode = '42501', message = 'superadmin_required';
  end if;
  if exists (
    select 1 from private.audit_outbox outbox
    where outbox.request_id = p_request_id
  ) then
    raise exception using errcode = '55000', message = 'audit_outbox_exists';
  end if;
  select event.* into v_existing
  from private.technical_audit_events event
  where event.request_id = p_request_id and event.phase = 'reconciliation';
  if found then
    if v_existing.external_sequence <> p_external_sequence
      or v_existing.external_record_hash <> p_external_record_hash
      or v_existing.external_receipt_signature <> p_external_receipt_signature
      or v_existing.external_key_version <> p_external_key_version
      or v_existing.external_idempotency_hash <> p_external_idempotency_hash
    then
      raise exception using errcode = '23505',
        message = 'audit_reconciliation_conflict';
    end if;
    return true;
  end if;
  insert into private.technical_audit_events (
    actor_id, action, target_type, target_id, result,
    request_id, phase, original_actor_id, effective_profile_id,
    impersonation_session_id, external_sequence, external_timestamp,
    external_record_hash, external_receipt_signature, external_key_version,
    external_idempotency_hash
  ) values (
    p_original_actor_id, p_action, p_target_type, p_target_id, 'failure',
    p_request_id, 'reconciliation',
    p_original_actor_id, p_effective_profile_id, p_impersonation_session_id,
    p_external_sequence, p_external_timestamp, p_external_record_hash,
    p_external_receipt_signature, p_external_key_version,
    p_external_idempotency_hash
  );
  return true;
end;
$$;

create function public.internal_admin_mark_t18_audit_outcome(
  p_request_id uuid,
  p_result text,
  p_error_code text
)
returns boolean
language sql
security definer
set search_path = pg_catalog
as $$
  select private.mark_t18_audit_outbox_outcome(
    p_request_id, p_result, p_error_code
  )
$$;

create function public.internal_admin_finalize_t18_audit_outbox(
  p_request_id uuid,
  p_result text,
  p_error_code text,
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
  select private.finalize_t18_audit_outbox(
    p_request_id, p_result, p_error_code, p_external_sequence,
    p_external_timestamp, p_external_record_hash,
    p_external_receipt_signature, p_external_key_version,
    p_external_idempotency_hash
  )
$$;

create function public.internal_admin_list_pending_t18_audit_outbox(
  p_limit integer
)
returns table (
  request_id uuid,
  original_actor_id uuid,
  effective_profile_id uuid,
  impersonation_session_id uuid,
  action text,
  target_type text,
  target_id uuid,
  intent_record_hash bytea,
  desired_result text,
  desired_error_code text
)
language sql
security definer
set search_path = pg_catalog
as $$
  select * from private.list_pending_t18_audit_outbox(p_limit)
$$;

create function public.internal_admin_record_t18_reconciliation(
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
  select private.record_t18_admin_reconciliation(
    p_request_id, p_original_actor_id, p_effective_profile_id,
    p_impersonation_session_id, p_action, p_target_type, p_target_id,
    p_external_sequence, p_external_timestamp, p_external_record_hash,
    p_external_receipt_signature, p_external_key_version,
    p_external_idempotency_hash
  )
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
revoke execute on function private.mark_t18_audit_outbox_outcome(
  uuid, text, text
) from public, anon, authenticated, service_role;
revoke execute on function private.finalize_t18_audit_outbox(
  uuid, text, text, bigint, timestamptz, bytea, bytea, integer, bytea
) from public, anon, authenticated, service_role;
revoke execute on function private.list_pending_t18_audit_outbox(integer)
from public, anon, authenticated, service_role;
revoke execute on function private.record_t18_admin_reconciliation(
  uuid, uuid, uuid, uuid, text, text, uuid, bigint, timestamptz,
  bytea, bytea, integer, bytea
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
revoke execute on function public.internal_admin_mark_t18_audit_outcome(
  uuid, text, text
) from public, anon, authenticated;
revoke execute on function public.internal_admin_finalize_t18_audit_outbox(
  uuid, text, text, bigint, timestamptz, bytea, bytea, integer, bytea
) from public, anon, authenticated;
revoke execute on function public.internal_admin_list_pending_t18_audit_outbox(
  integer
) from public, anon, authenticated;
revoke execute on function public.internal_admin_record_t18_reconciliation(
  uuid, uuid, uuid, uuid, text, text, uuid, bigint, timestamptz,
  bytea, bytea, integer, bytea
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
grant execute on function public.internal_admin_mark_t18_audit_outcome(
  uuid, text, text
) to service_role;
grant execute on function public.internal_admin_finalize_t18_audit_outbox(
  uuid, text, text, bigint, timestamptz, bytea, bytea, integer, bytea
) to service_role;
grant execute on function public.internal_admin_list_pending_t18_audit_outbox(
  integer
) to service_role;
grant execute on function public.internal_admin_record_t18_reconciliation(
  uuid, uuid, uuid, uuid, text, text, uuid, bigint, timestamptz,
  bytea, bytea, integer, bytea
) to service_role;
