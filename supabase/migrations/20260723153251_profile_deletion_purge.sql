create table private.deletion_job_actors (
  job_id uuid not null
    constraint deletion_job_actors_job_id_fkey
    references private.deletion_jobs (id) on delete cascade,
  actor_id uuid not null
    constraint deletion_job_actors_actor_id_fkey
    references public.actors (id) on delete restrict,
  primary key (job_id, actor_id)
);

alter table private.deletion_job_actors enable row level security;
revoke all on table private.deletion_job_actors
from public, anon, authenticated, service_role;

alter table private.audit_outbox
  drop constraint if exists audit_outbox_action_check,
  drop constraint if exists audit_outbox_target_type_check;
alter table private.audit_outbox
  add constraint audit_outbox_action_check check (
    action in (
      'access_reset',
      'ai_provider_revision_activate',
      'anonymous_auth_cleanup',
      'audit_range_delete',
      'audit_range_delete_execute',
      'audit_range_delete_prepare',
      'backup_create',
      'barcode_correction_approve',
      'barcode_correction_correct',
      'barcode_correction_reject',
      'catalog_match_candidates_generate',
      'catalog_publication_hide',
      'catalog_revision_publish',
      'impersonation_end',
      'impersonation_start',
      'invitation_create',
      'invitation_revoke',
      'matching_rule_activate',
      'matching_rule_review',
      'profile_delete_permanent',
      'profile_deletion_permanent',
      'profile_deletion_resume',
      'profile_update',
      'restore_create',
      'restore_promote',
      'rule_set_activate'
    )
  ),
  add constraint audit_outbox_target_type_check check (
    target_type in (
      'audit_deletion_job',
      'audit_range',
      'auth_user',
      'backup',
      'backup_job',
      'barcode_correction',
      'catalog_publication',
      'catalog_revision',
      'commercial_product_revision',
      'deletion_job',
      'impersonation_session',
      'invitation',
      'product_matching_rule',
      'profile',
      'restore',
      'restore_job',
      'rule_revision'
    )
  );

create function private.record_t18_admin_intent(
  p_auth_subject uuid,
  p_auth_session_id uuid,
  p_request_id uuid,
  p_effective_profile_id uuid,
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
  v_actor_id uuid;
  v_event_id uuid;
  v_existing private.technical_audit_events%rowtype;
begin
  v_actor_id := private.require_superadmin_aal2(
    p_auth_subject, p_auth_session_id
  );
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
    raise exception using errcode = '22023', message = 'invalid_t18_audit_action';
  end if;

  select event.* into v_existing
  from private.technical_audit_events event
  where event.request_id = p_request_id and event.phase = 'intent';
  if found then
    if v_existing.actor_id <> v_actor_id
      or v_existing.action <> p_action
      or v_existing.target_type <> p_target_type
      or v_existing.target_id <> p_target_id
      or v_existing.external_record_hash <> p_external_record_hash
      or v_existing.external_idempotency_hash <> p_external_idempotency_hash
    then
      raise exception using errcode = '23505', message = 'idempotency_conflict';
    end if;
    return true;
  end if;

  insert into private.technical_audit_events (
    actor_id, action, target_type, target_id, result, request_id, phase,
    original_actor_id, effective_profile_id, external_sequence,
    external_timestamp, external_record_hash, external_receipt_signature,
    external_key_version, external_idempotency_hash
  ) values (
    v_actor_id, p_action, p_target_type, p_target_id, 'accepted',
    p_request_id, 'intent', v_actor_id, p_effective_profile_id,
    p_external_sequence, p_external_timestamp, p_external_record_hash,
    p_external_receipt_signature, p_external_key_version,
    p_external_idempotency_hash
  )
  returning id into v_event_id;

  insert into private.audit_outbox (
    technical_audit_event_id, request_id, original_actor_id,
    effective_profile_id, action, target_type, target_id
  ) values (
    v_event_id, p_request_id, v_actor_id, p_effective_profile_id,
    p_action, p_target_type, p_target_id
  );
  return true;
end;
$$;

create function private.admin_get_deletion_job(
  p_auth_subject uuid,
  p_auth_session_id uuid,
  p_job_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  perform private.require_superadmin_aal2(
    p_auth_subject, p_auth_session_id
  );
  if not exists (
    select 1 from private.deletion_jobs where id = p_job_id
  ) then
    raise exception using errcode = 'P0002', message = 'deletion_job_not_found';
  end if;
  return private.deletion_job_json(p_job_id);
end;
$$;

create function private.admin_get_profile_deletion_secret(
  p_auth_subject uuid,
  p_auth_session_id uuid,
  p_job_id uuid,
  p_profile_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog
as $$
declare
  v_job private.deletion_jobs%rowtype;
begin
  perform private.require_superadmin_aal2(
    p_auth_subject, p_auth_session_id
  );
  if (p_job_id is null) = (p_profile_id is null) then
    raise exception using errcode = '22023', message = 'invalid_input';
  end if;
  select job.* into v_job
  from private.deletion_jobs job
  where (
    p_job_id is not null
    and job.id = p_job_id
  ) or (
    p_profile_id is not null
    and job.profile_id = p_profile_id
    and exists (
      select 1
      from public.profiles profile
      where profile.id = p_profile_id
        and profile.status = 'deletion_requested'
    )
  );
  if not found then
    raise exception using errcode = 'P0002', message = 'deletion_job_not_found';
  end if;
  return jsonb_build_object(
    'job', private.deletion_job_json(v_job.id),
    'profileMarker', encode(v_job.profile_marker, 'hex'),
    'profileMarkerKeyVersion', v_job.profile_marker_key_version
  );
end;
$$;

create function private.admin_revoke_profile_access(
  p_auth_subject uuid,
  p_auth_session_id uuid,
  p_job_id uuid,
  p_expected_version integer
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_admin_actor_id uuid;
  v_job private.deletion_jobs%rowtype;
begin
  v_admin_actor_id := private.require_superadmin_aal2(
    p_auth_subject, p_auth_session_id
  );
  select job.* into v_job
  from private.deletion_jobs job
  where job.id = p_job_id
  for update;
  if not found or v_job.profile_id is null then
    raise exception using errcode = 'P0002', message = 'deletion_job_not_found';
  end if;
  if v_job.version <> p_expected_version then
    raise exception using errcode = '40001', message = 'version_conflict';
  end if;
  if v_job.status not in ('ledger_recorded', 'purging', 'failed') then
    raise exception using errcode = '23514', message = 'invalid_job_transition';
  end if;

  insert into private.deletion_job_actors (job_id, actor_id)
  select v_job.id, access.actor_id
  from public.profile_access access
  where access.profile_id = v_job.profile_id
  on conflict do nothing;

  update public.profile_access
  set revoked_at = coalesce(revoked_at, clock_timestamp()),
      revoked_by = coalesce(revoked_by, v_admin_actor_id)
  where profile_id = v_job.profile_id;

  update private.private_access_codes
  set revoked_at = coalesce(revoked_at, clock_timestamp())
  where profile_id = v_job.profile_id;

  update private.qr_grants
  set revoked_at = coalesce(revoked_at, clock_timestamp())
  where profile_id = v_job.profile_id;

  update public.device_sessions session
  set revoked_at = coalesce(session.revoked_at, clock_timestamp())
  where session.actor_id in (
    select actor_id
    from private.deletion_job_actors
    where job_id = v_job.id
  )
  and not exists (
    select 1
    from public.profile_access other_access
    where other_access.actor_id = session.actor_id
      and other_access.revoked_at is null
  );

  update private.invitations invitation
  set revoked_at = coalesce(invitation.revoked_at, clock_timestamp())
  where invitation.created_by in (
    select actor_id
    from private.deletion_job_actors
    where job_id = v_job.id
  )
  and invitation.consumed_at is null
  and not exists (
    select 1
    from public.profile_access other_access
    where other_access.actor_id = invitation.created_by
      and other_access.revoked_at is null
  );

  return private.deletion_job_json(v_job.id);
end;
$$;

create function private.admin_purge_profile_data(
  p_auth_subject uuid,
  p_auth_session_id uuid,
  p_job_id uuid,
  p_expected_version integer
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_job private.deletion_jobs%rowtype;
  v_profile_id uuid;
begin
  perform private.require_superadmin_aal2(
    p_auth_subject, p_auth_session_id
  );
  select job.* into v_job
  from private.deletion_jobs job
  where job.id = p_job_id
  for update;
  if not found or v_job.profile_id is null then
    raise exception using errcode = 'P0002', message = 'deletion_job_not_found';
  end if;
  if v_job.version <> p_expected_version then
    raise exception using errcode = '40001', message = 'version_conflict';
  end if;
  if v_job.status <> 'purging' then
    raise exception using errcode = '23514', message = 'deletion_job_not_purging';
  end if;
  if exists (
    select 1 from private.export_artifacts
    where profile_id = v_job.profile_id
  ) then
    raise exception using errcode = '55000', message = 'export_purge_incomplete';
  end if;
  if not exists (
    select 1
    from private.deletion_job_steps
    where deletion_job_id = v_job.id
      and step_name in ('ledger', 'access', 'exports', 'storage')
      and completed_at is not null
    group by deletion_job_id
    having count(*) = 4
  ) then
    raise exception using errcode = '55000', message = 'deletion_steps_incomplete';
  end if;

  v_profile_id := v_job.profile_id;
  delete from private.ai_usage_events where profile_id = v_profile_id;
  delete from private.private_access_codes where profile_id = v_profile_id;
  delete from private.qr_grants where profile_id = v_profile_id;
  delete from public.profile_access where profile_id = v_profile_id;
  update public.commercial_product_revisions
  set owner_profile_id = null
  where owner_profile_id = v_profile_id;

  delete from public.profiles
  where id = v_profile_id and status = 'deletion_requested';
  if not found then
    raise exception using errcode = '55000', message = 'profile_not_deletion_requested';
  end if;

  return private.deletion_job_json(v_job.id);
end;
$$;

create function private.admin_list_orphan_auth_subjects(
  p_auth_subject uuid,
  p_auth_session_id uuid,
  p_job_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_result jsonb;
begin
  perform private.require_superadmin_aal2(
    p_auth_subject, p_auth_session_id
  );
  if not exists (
    select 1 from private.deletion_jobs where id = p_job_id
  ) then
    raise exception using errcode = 'P0002', message = 'deletion_job_not_found';
  end if;
  with eligible as (
      select actor.id, actor.auth_subject
      from private.deletion_job_actors job_actor
      join public.actors actor on actor.id = job_actor.actor_id
      where job_actor.job_id = p_job_id
        and actor.role = 'device'
        and actor.auth_subject is not null
      and not exists (
        select 1
        from public.profile_access access
        where access.actor_id = actor.id
          and access.revoked_at is null
      )
      and not exists (
        select 1
        from private.invitations invitation
        where invitation.created_by = actor.id
          and invitation.consumed_at is null
          and invitation.revoked_at is null
          and invitation.expires_at > clock_timestamp()
      )
      and not exists (
        select 1
        from private.deletion_jobs job
        where (
          job.requester_actor_id = actor.id
          or job.confirmed_by = actor.id
        )
        and job.id <> p_job_id
        and job.status <> 'purged'
      )
      and not exists (
        select 1
        from private.backup_jobs job
        where job.requested_by = actor.id
          and job.status not in ('ready', 'failed', 'pruned')
      )
      and not exists (
        select 1
        from private.restore_jobs job
        where job.requested_by = actor.id
          and job.status not in ('promoted', 'failed')
      )
      and not exists (
        select 1
        from private.audit_deletion_jobs job
        where job.requested_by = actor.id
          and job.status <> 'verified'
      )
      for update of actor
    ),
    disabled as (
      update public.actors actor
      set disabled_at = coalesce(actor.disabled_at, clock_timestamp())
      from eligible
      where actor.id = eligible.id
      returning eligible.auth_subject
    )
    select coalesce(
      jsonb_agg(disabled.auth_subject order by disabled.auth_subject),
      '[]'::jsonb
    )
    from disabled
  into v_result;
  return v_result;
end;
$$;

create function private.admin_verify_profile_purge(
  p_auth_subject uuid,
  p_auth_session_id uuid,
  p_job_id uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path = pg_catalog
as $$
begin
  perform private.require_superadmin_aal2(
    p_auth_subject, p_auth_session_id
  );
  if not exists (
    select 1
    from private.deletion_jobs job
    where job.id = p_job_id
      and job.profile_id is null
      and job.profile_marker is not null
      and job.request_handle_hash is not null
  ) then
    raise exception using errcode = '55000', message = 'profile_purge_incomplete';
  end if;
  return true;
end;
$$;

create function public.internal_admin_get_deletion_job(
  p_auth_subject uuid,
  p_auth_session_id uuid,
  p_job_id uuid
)
returns jsonb
language sql
security definer
set search_path = pg_catalog
as $$
  select private.admin_get_deletion_job(
    p_auth_subject, p_auth_session_id, p_job_id
  )
$$;

create function public.internal_record_t18_admin_intent(
  p_auth_subject uuid,
  p_auth_session_id uuid,
  p_request_id uuid,
  p_effective_profile_id uuid,
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
  select private.record_t18_admin_intent(
    p_auth_subject, p_auth_session_id, p_request_id,
    p_effective_profile_id, p_action, p_target_type, p_target_id,
    p_external_sequence, p_external_timestamp, p_external_record_hash,
    p_external_receipt_signature, p_external_key_version,
    p_external_idempotency_hash
  )
$$;

create function public.internal_admin_get_profile_deletion_secret(
  p_auth_subject uuid,
  p_auth_session_id uuid,
  p_job_id uuid,
  p_profile_id uuid
)
returns jsonb
language sql
security definer
set search_path = pg_catalog
as $$
  select private.admin_get_profile_deletion_secret(
    p_auth_subject, p_auth_session_id, p_job_id, p_profile_id
  )
$$;

create function public.internal_admin_revoke_profile_access(
  p_auth_subject uuid,
  p_auth_session_id uuid,
  p_job_id uuid,
  p_expected_version integer
)
returns jsonb
language sql
security definer
set search_path = pg_catalog
as $$
  select private.admin_revoke_profile_access(
    p_auth_subject, p_auth_session_id, p_job_id, p_expected_version
  )
$$;

create function public.internal_admin_purge_profile_data(
  p_auth_subject uuid,
  p_auth_session_id uuid,
  p_job_id uuid,
  p_expected_version integer
)
returns jsonb
language sql
security definer
set search_path = pg_catalog
as $$
  select private.admin_purge_profile_data(
    p_auth_subject, p_auth_session_id, p_job_id, p_expected_version
  )
$$;

create function public.internal_admin_list_orphan_auth_subjects(
  p_auth_subject uuid,
  p_auth_session_id uuid,
  p_job_id uuid
)
returns jsonb
language sql
security definer
set search_path = pg_catalog
as $$
  select private.admin_list_orphan_auth_subjects(
    p_auth_subject, p_auth_session_id, p_job_id
  )
$$;

create function public.internal_admin_verify_profile_purge(
  p_auth_subject uuid,
  p_auth_session_id uuid,
  p_job_id uuid
)
returns boolean
language sql
security definer
set search_path = pg_catalog
as $$
  select private.admin_verify_profile_purge(
    p_auth_subject, p_auth_session_id, p_job_id
  )
$$;

revoke execute on function private.admin_get_deletion_job(uuid, uuid, uuid)
from public, anon, authenticated, service_role;
revoke execute on function private.record_t18_admin_intent(
  uuid, uuid, uuid, uuid, text, text, uuid, bigint, timestamptz,
  bytea, bytea, integer, bytea
) from public, anon, authenticated, service_role;
revoke execute on function private.admin_get_profile_deletion_secret(
  uuid, uuid, uuid, uuid
)
from public, anon, authenticated, service_role;
revoke execute on function private.admin_revoke_profile_access(uuid, uuid, uuid, integer)
from public, anon, authenticated, service_role;
revoke execute on function private.admin_purge_profile_data(uuid, uuid, uuid, integer)
from public, anon, authenticated, service_role;
revoke execute on function private.admin_list_orphan_auth_subjects(uuid, uuid, uuid)
from public, anon, authenticated, service_role;
revoke execute on function private.admin_verify_profile_purge(uuid, uuid, uuid)
from public, anon, authenticated, service_role;

revoke execute on function public.internal_admin_get_deletion_job(uuid, uuid, uuid)
from public, anon, authenticated;
revoke execute on function public.internal_record_t18_admin_intent(
  uuid, uuid, uuid, uuid, text, text, uuid, bigint, timestamptz,
  bytea, bytea, integer, bytea
) from public, anon, authenticated;
revoke execute on function public.internal_admin_get_profile_deletion_secret(
  uuid, uuid, uuid, uuid
)
from public, anon, authenticated;
revoke execute on function public.internal_admin_revoke_profile_access(
  uuid, uuid, uuid, integer
) from public, anon, authenticated;
revoke execute on function public.internal_admin_purge_profile_data(
  uuid, uuid, uuid, integer
) from public, anon, authenticated;
revoke execute on function public.internal_admin_list_orphan_auth_subjects(
  uuid, uuid, uuid
) from public, anon, authenticated;
revoke execute on function public.internal_admin_verify_profile_purge(uuid, uuid, uuid)
from public, anon, authenticated;

grant execute on function public.internal_admin_get_deletion_job(uuid, uuid, uuid)
to service_role;
grant execute on function public.internal_record_t18_admin_intent(
  uuid, uuid, uuid, uuid, text, text, uuid, bigint, timestamptz,
  bytea, bytea, integer, bytea
) to service_role;
grant execute on function public.internal_admin_get_profile_deletion_secret(
  uuid, uuid, uuid, uuid
)
to service_role;
grant execute on function public.internal_admin_revoke_profile_access(
  uuid, uuid, uuid, integer
) to service_role;
grant execute on function public.internal_admin_purge_profile_data(
  uuid, uuid, uuid, integer
) to service_role;
grant execute on function public.internal_admin_list_orphan_auth_subjects(
  uuid, uuid, uuid
) to service_role;
grant execute on function public.internal_admin_verify_profile_purge(uuid, uuid, uuid)
to service_role;
