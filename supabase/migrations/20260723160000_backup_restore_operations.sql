alter table private.restore_jobs
  add column validation_digest bytea
    check (validation_digest is null or octet_length(validation_digest) = 32);

create function private.backup_job_json(p_job_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog
as $$
  select jsonb_build_object(
    'backupId', job.id,
    'createdAt', job.created_at,
    'kind', job.kind,
    'schemaVersion', 1,
    'status', job.status,
    'verifiedAt', job.verified_at,
    'version', job.version
  )
  from private.backup_jobs job
  where job.id = p_job_id
$$;

create function private.restore_job_json(p_job_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog
as $$
  select jsonb_build_object(
    'backupId', job.backup_job_id,
    'createdAt', job.created_at,
    'restoreId', job.id,
    'schemaVersion', 1,
    'status', job.status,
    'verifiedAt', job.verified_at,
    'version', job.version
  )
  from private.restore_jobs job
  where job.id = p_job_id
$$;

create function private.admin_create_backup_job(
  p_auth_subject uuid,
  p_auth_session_id uuid,
  p_job_id uuid,
  p_kind text,
  p_source_environment text,
  p_schema_version integer
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_actor_id uuid;
  v_existing private.backup_jobs%rowtype;
begin
  v_actor_id := private.require_superadmin_aal2(
    p_auth_subject, p_auth_session_id
  );
  if p_kind not in ('weekly', 'precritical')
    or p_source_environment not in ('local', 'development')
    or p_schema_version <> 1
  then
    raise exception using errcode = '22023', message = 'invalid_backup_job';
  end if;
  select job.* into v_existing
  from private.backup_jobs job
  where job.id = p_job_id;
  if found then
    if v_existing.kind <> p_kind
      or v_existing.source_environment <> p_source_environment
      or v_existing.schema_version <> p_schema_version
      or v_existing.requested_by <> v_actor_id
    then
      raise exception using errcode = '23505', message = 'idempotency_conflict';
    end if;
    return private.backup_job_json(v_existing.id);
  end if;
  insert into private.backup_jobs (
    id, kind, requested_by, source_environment, schema_version, tool_version
  ) values (
    p_job_id, p_kind, v_actor_id, p_source_environment,
    p_schema_version, 't18-operator'
  );
  return private.backup_job_json(p_job_id);
end;
$$;

create function private.admin_list_backup_jobs(
  p_auth_subject uuid,
  p_auth_session_id uuid
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
  return (
    select coalesce(
      jsonb_agg(private.backup_job_json(job.id) order by job.created_at desc, job.id),
      '[]'::jsonb
    )
    from (
      select id, created_at
      from private.backup_jobs
      order by created_at desc, id
      limit 50
    ) job
  );
end;
$$;

create function private.admin_create_restore_job(
  p_auth_subject uuid,
  p_auth_session_id uuid,
  p_job_id uuid,
  p_backup_job_id uuid,
  p_target_fingerprint bytea
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_actor_id uuid;
  v_existing private.restore_jobs%rowtype;
begin
  v_actor_id := private.require_superadmin_aal2(
    p_auth_subject, p_auth_session_id
  );
  if octet_length(p_target_fingerprint) <> 32 then
    raise exception using errcode = '22023', message = 'invalid_target_fingerprint';
  end if;
  if not exists (
    select 1 from private.backup_jobs
    where id = p_backup_job_id and status = 'ready'
  ) then
    raise exception using errcode = '55000', message = 'backup_not_ready';
  end if;
  select job.* into v_existing
  from private.restore_jobs job
  where job.id = p_job_id;
  if found then
    if v_existing.backup_job_id <> p_backup_job_id
      or v_existing.target_fingerprint <> p_target_fingerprint
      or v_existing.requested_by <> v_actor_id
    then
      raise exception using errcode = '23505', message = 'idempotency_conflict';
    end if;
    return private.restore_job_json(v_existing.id);
  end if;
  insert into private.restore_jobs (
    id, backup_job_id, requested_by, target_environment, target_fingerprint
  ) values (
    p_job_id, p_backup_job_id, v_actor_id,
    'local-isolated', p_target_fingerprint
  );
  return private.restore_job_json(p_job_id);
end;
$$;

create function private.admin_list_restore_jobs(
  p_auth_subject uuid,
  p_auth_session_id uuid
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
  return (
    select coalesce(
      jsonb_agg(private.restore_job_json(job.id) order by job.created_at desc, job.id),
      '[]'::jsonb
    )
    from (
      select id, created_at
      from private.restore_jobs
      order by created_at desc, id
      limit 50
    ) job
  );
end;
$$;

create function private.admin_transition_backup_job(
  p_auth_subject uuid,
  p_auth_session_id uuid,
  p_job_id uuid,
  p_expected_version integer,
  p_next_status text,
  p_manifest_digest bytea default null,
  p_key_version integer default null,
  p_error_code text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_job private.backup_jobs%rowtype;
begin
  perform private.require_superadmin_aal2(
    p_auth_subject, p_auth_session_id
  );
  select job.* into v_job
  from private.backup_jobs job
  where job.id = p_job_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'backup_job_not_found';
  end if;
  if v_job.version <> p_expected_version then
    raise exception using errcode = '40001', message = 'version_conflict';
  end if;
  if not (
    (v_job.status = 'queued' and p_next_status = 'capturing')
    or (v_job.status = 'capturing' and p_next_status in ('verifying', 'failed'))
    or (v_job.status = 'verifying' and p_next_status in ('ready', 'failed'))
    or (v_job.status = 'failed' and p_next_status = 'capturing')
    or (v_job.status = 'ready' and p_next_status = 'pruned')
  ) then
    raise exception using errcode = '23514', message = 'invalid_job_transition';
  end if;
  if p_next_status = 'ready' and (
    p_manifest_digest is null
    or octet_length(p_manifest_digest) <> 32
    or p_key_version is null
    or p_key_version < 1
  ) then
    raise exception using errcode = '22023', message = 'backup_verification_required';
  end if;
  update private.backup_jobs
  set status = p_next_status,
      version = version + 1,
      manifest_digest = coalesce(p_manifest_digest, manifest_digest),
      key_version = coalesce(p_key_version, key_version),
      verified_at = case
        when p_next_status = 'ready' then clock_timestamp()
        else verified_at
      end,
      failed_at = case
        when p_next_status = 'failed' then clock_timestamp()
        else failed_at
      end,
      pruned_at = case
        when p_next_status = 'pruned' then clock_timestamp()
        else pruned_at
      end,
      last_error_code = p_error_code,
      updated_at = clock_timestamp()
  where id = p_job_id;
  return private.backup_job_json(p_job_id);
end;
$$;

create function private.admin_transition_restore_job(
  p_auth_subject uuid,
  p_auth_session_id uuid,
  p_job_id uuid,
  p_expected_version integer,
  p_next_status text,
  p_validation_digest bytea default null,
  p_error_code text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_job private.restore_jobs%rowtype;
begin
  perform private.require_superadmin_aal2(
    p_auth_subject, p_auth_session_id
  );
  select job.* into v_job
  from private.restore_jobs job
  where job.id = p_job_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'restore_job_not_found';
  end if;
  if v_job.version <> p_expected_version then
    raise exception using errcode = '40001', message = 'version_conflict';
  end if;
  if not (
    (v_job.status = 'queued' and p_next_status = 'verifying')
    or (v_job.status = 'verifying'
      and p_next_status in ('restoring', 'blocked', 'failed'))
    or (v_job.status = 'restoring'
      and p_next_status in ('validating', 'blocked', 'failed'))
    or (v_job.status = 'validating'
      and p_next_status in ('ready_for_promotion', 'blocked', 'failed'))
    or (v_job.status in ('blocked', 'failed') and p_next_status = 'verifying')
  ) then
    raise exception using errcode = '23514', message = 'invalid_job_transition';
  end if;
  if p_next_status = 'ready_for_promotion' and (
    p_validation_digest is null or octet_length(p_validation_digest) <> 32
  ) then
    raise exception using errcode = '22023', message = 'restore_verification_required';
  end if;
  update private.restore_jobs
  set status = p_next_status,
      version = version + 1,
      validation_digest = coalesce(p_validation_digest, validation_digest),
      verified_at = case
        when p_next_status = 'ready_for_promotion' then clock_timestamp()
        else verified_at
      end,
      last_error_code = p_error_code,
      updated_at = clock_timestamp()
  where id = p_job_id;
  return private.restore_job_json(p_job_id);
end;
$$;

create function private.admin_promote_restore_job(
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
  v_job private.restore_jobs%rowtype;
begin
  perform private.require_superadmin_aal2(
    p_auth_subject, p_auth_session_id
  );
  select job.* into v_job
  from private.restore_jobs job
  where job.id = p_job_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'restore_job_not_found';
  end if;
  if v_job.version <> p_expected_version then
    raise exception using errcode = '40001', message = 'version_conflict';
  end if;
  if v_job.status <> 'ready_for_promotion'
    or v_job.verified_at is null
    or v_job.validation_digest is null
  then
    raise exception using errcode = '55000', message = 'restore_not_verified';
  end if;
  update private.restore_jobs
  set status = 'promoted',
      version = version + 1,
      promoted_at = clock_timestamp(),
      updated_at = clock_timestamp()
  where id = p_job_id;
  return private.restore_job_json(p_job_id);
end;
$$;

create function public.internal_admin_create_backup_job(
  p_auth_subject uuid,
  p_auth_session_id uuid,
  p_job_id uuid,
  p_kind text,
  p_source_environment text,
  p_schema_version integer
)
returns jsonb
language sql
security definer
set search_path = pg_catalog
as $$
  select private.admin_create_backup_job(
    p_auth_subject, p_auth_session_id, p_job_id, p_kind,
    p_source_environment, p_schema_version
  )
$$;

create function public.internal_admin_list_backup_jobs(
  p_auth_subject uuid,
  p_auth_session_id uuid
)
returns jsonb
language sql
security definer
set search_path = pg_catalog
as $$
  select private.admin_list_backup_jobs(p_auth_subject, p_auth_session_id)
$$;

create function public.internal_admin_create_restore_job(
  p_auth_subject uuid,
  p_auth_session_id uuid,
  p_job_id uuid,
  p_backup_job_id uuid,
  p_target_fingerprint bytea
)
returns jsonb
language sql
security definer
set search_path = pg_catalog
as $$
  select private.admin_create_restore_job(
    p_auth_subject, p_auth_session_id, p_job_id,
    p_backup_job_id, p_target_fingerprint
  )
$$;

create function public.internal_admin_list_restore_jobs(
  p_auth_subject uuid,
  p_auth_session_id uuid
)
returns jsonb
language sql
security definer
set search_path = pg_catalog
as $$
  select private.admin_list_restore_jobs(p_auth_subject, p_auth_session_id)
$$;

create function public.internal_admin_transition_backup_job(
  p_auth_subject uuid,
  p_auth_session_id uuid,
  p_job_id uuid,
  p_expected_version integer,
  p_next_status text,
  p_manifest_digest bytea default null,
  p_key_version integer default null,
  p_error_code text default null
)
returns jsonb
language sql
security definer
set search_path = pg_catalog
as $$
  select private.admin_transition_backup_job(
    p_auth_subject, p_auth_session_id, p_job_id, p_expected_version,
    p_next_status, p_manifest_digest, p_key_version, p_error_code
  )
$$;

create function public.internal_admin_transition_restore_job(
  p_auth_subject uuid,
  p_auth_session_id uuid,
  p_job_id uuid,
  p_expected_version integer,
  p_next_status text,
  p_validation_digest bytea default null,
  p_error_code text default null
)
returns jsonb
language sql
security definer
set search_path = pg_catalog
as $$
  select private.admin_transition_restore_job(
    p_auth_subject, p_auth_session_id, p_job_id, p_expected_version,
    p_next_status, p_validation_digest, p_error_code
  )
$$;

create function public.internal_admin_promote_restore_job(
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
  select private.admin_promote_restore_job(
    p_auth_subject, p_auth_session_id, p_job_id, p_expected_version
  )
$$;

revoke execute on function private.backup_job_json(uuid)
from public, anon, authenticated, service_role;
revoke execute on function private.restore_job_json(uuid)
from public, anon, authenticated, service_role;
revoke execute on function private.admin_create_backup_job(
  uuid, uuid, uuid, text, text, integer
) from public, anon, authenticated, service_role;
revoke execute on function private.admin_list_backup_jobs(uuid, uuid)
from public, anon, authenticated, service_role;
revoke execute on function private.admin_create_restore_job(
  uuid, uuid, uuid, uuid, bytea
) from public, anon, authenticated, service_role;
revoke execute on function private.admin_list_restore_jobs(uuid, uuid)
from public, anon, authenticated, service_role;
revoke execute on function private.admin_promote_restore_job(
  uuid, uuid, uuid, integer
) from public, anon, authenticated, service_role;
revoke execute on function private.admin_transition_backup_job(
  uuid, uuid, uuid, integer, text, bytea, integer, text
) from public, anon, authenticated, service_role;
revoke execute on function private.admin_transition_restore_job(
  uuid, uuid, uuid, integer, text, bytea, text
) from public, anon, authenticated, service_role;

revoke execute on function public.internal_admin_create_backup_job(
  uuid, uuid, uuid, text, text, integer
) from public, anon, authenticated;
revoke execute on function public.internal_admin_list_backup_jobs(uuid, uuid)
from public, anon, authenticated;
revoke execute on function public.internal_admin_create_restore_job(
  uuid, uuid, uuid, uuid, bytea
) from public, anon, authenticated;
revoke execute on function public.internal_admin_list_restore_jobs(uuid, uuid)
from public, anon, authenticated;
revoke execute on function public.internal_admin_promote_restore_job(
  uuid, uuid, uuid, integer
) from public, anon, authenticated;
revoke execute on function public.internal_admin_transition_backup_job(
  uuid, uuid, uuid, integer, text, bytea, integer, text
) from public, anon, authenticated;
revoke execute on function public.internal_admin_transition_restore_job(
  uuid, uuid, uuid, integer, text, bytea, text
) from public, anon, authenticated;

grant execute on function public.internal_admin_create_backup_job(
  uuid, uuid, uuid, text, text, integer
) to service_role;
grant execute on function public.internal_admin_list_backup_jobs(uuid, uuid)
to service_role;
grant execute on function public.internal_admin_create_restore_job(
  uuid, uuid, uuid, uuid, bytea
) to service_role;
grant execute on function public.internal_admin_list_restore_jobs(uuid, uuid)
to service_role;
grant execute on function public.internal_admin_promote_restore_job(
  uuid, uuid, uuid, integer
) to service_role;
grant execute on function public.internal_admin_transition_backup_job(
  uuid, uuid, uuid, integer, text, bytea, integer, text
) to service_role;
grant execute on function public.internal_admin_transition_restore_job(
  uuid, uuid, uuid, integer, text, bytea, text
) to service_role;
