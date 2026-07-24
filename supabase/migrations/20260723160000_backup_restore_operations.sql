create extension if not exists pgsodium;

create table private.restore_validation_keys (
  key_version integer primary key check (key_version > 0),
  public_key bytea not null check (octet_length(public_key) = 32),
  activated_at timestamptz not null default clock_timestamp(),
  retired_at timestamptz,
  check (retired_at is null or retired_at >= activated_at)
);

alter table private.restore_validation_keys enable row level security;
revoke all on table private.restore_validation_keys
from public, anon, authenticated, service_role;

alter table private.restore_jobs
  add column validation_digest bytea
    check (validation_digest is null or octet_length(validation_digest) = 32),
  add column validation_manifest_digest bytea
    check (
      validation_manifest_digest is null
      or octet_length(validation_manifest_digest) = 32
    ),
  add column validation_deletions_head bytea
    check (
      validation_deletions_head is null
      or octet_length(validation_deletions_head) = 32
    ),
  add column validation_admin_audit_head bytea
    check (
      validation_admin_audit_head is null
      or octet_length(validation_admin_audit_head) = 32
    ),
  add column validation_target_fingerprint bytea
    check (
      validation_target_fingerprint is null
      or octet_length(validation_target_fingerprint) = 32
    ),
  add column validation_signature bytea
    check (
      validation_signature is null
      or octet_length(validation_signature) = 64
    ),
  add column validation_key_version integer
    check (validation_key_version is null or validation_key_version > 0),
  add column validation_payload bytea
    check (
      validation_payload is null
      or octet_length(validation_payload) between 2 and 4096
    ),
  add column validation_pending_intents integer
    check (validation_pending_intents is null or validation_pending_intents >= 0),
  add column validation_incomplete_ranges integer
    check (
      validation_incomplete_ranges is null
      or validation_incomplete_ranges >= 0
    ),
  add column validation_sessions_revoked boolean,
  add column validation_deleted_profiles_absent boolean,
  add column validation_storage_complete boolean,
  add column validation_rls_verified boolean;

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
  p_error_code text default null,
  p_manifest_digest bytea default null,
  p_deletions_head bytea default null,
  p_admin_audit_head bytea default null,
  p_target_fingerprint bytea default null,
  p_validation_payload bytea default null,
  p_validation_signature bytea default null,
  p_validation_key_version integer default null,
  p_pending_intents integer default null,
  p_incomplete_ranges integer default null,
  p_sessions_revoked boolean default null,
  p_deleted_profiles_absent boolean default null,
  p_storage_complete boolean default null,
  p_rls_verified boolean default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_job private.restore_jobs%rowtype;
  v_payload jsonb;
  v_public_key bytea;
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
  if p_next_status = 'ready_for_promotion' then
    begin
      v_payload := convert_from(p_validation_payload, 'UTF8')::jsonb;
    exception when others then
      raise exception using
        errcode = '22023', message = 'restore_verification_required';
    end;
    select key.public_key into v_public_key
    from private.restore_validation_keys key
    where key.key_version = p_validation_key_version
      and key.activated_at <= clock_timestamp()
      and key.retired_at is null;
    if p_validation_digest is null
      or octet_length(p_validation_digest) <> 32
      or p_manifest_digest is null
      or octet_length(p_manifest_digest) <> 32
      or p_deletions_head is null
      or octet_length(p_deletions_head) <> 32
      or p_admin_audit_head is null
      or octet_length(p_admin_audit_head) <> 32
      or p_target_fingerprint is null
      or p_target_fingerprint <> v_job.target_fingerprint
      or p_validation_payload is null
      or p_validation_signature is null
      or octet_length(p_validation_signature) <> 64
      or p_validation_key_version is null
      or p_validation_key_version < 1
      or p_pending_intents <> 0
      or p_incomplete_ranges <> 0
      or p_sessions_revoked is not true
      or p_deleted_profiles_absent is not true
      or p_storage_complete is not true
      or p_rls_verified is not true
      or v_public_key is null
      or jsonb_typeof(v_payload) <> 'object'
      or (
        select count(*) from jsonb_object_keys(v_payload)
      ) <> 17
      or v_payload ->> 'aal2Required' <> 'true'
      or v_payload ->> 'schemaVersion' <> '1'
      or v_payload ->> 'backupJobId' <> v_job.backup_job_id::text
      or v_payload ->> 'restoreJobId' <> v_job.id::text
      or v_payload ->> 'manifestDigest' <> encode(p_manifest_digest, 'hex')
      or v_payload ->> 'deletionsHead' <> encode(p_deletions_head, 'hex')
      or v_payload ->> 'adminAuditHead' <> encode(p_admin_audit_head, 'hex')
      or v_payload ->> 'targetFingerprint' <> encode(
        p_target_fingerprint, 'hex'
      )
      or v_payload ->> 'pendingIntents' <> '0'
      or v_payload ->> 'incompleteRanges' <> '0'
      or v_payload ->> 'sessionsRevoked' <> 'true'
      or v_payload ->> 'deletedProfilesAbsent' <> 'true'
      or v_payload ->> 'storageComplete' <> 'true'
      or v_payload ->> 'rlsVerified' <> 'true'
      or v_payload ->> 'securityPolicyDigest' <>
        'de41957f4b5b5fbf2f19ddf15f3909be9e45a42fdba1083fbe5716108a2cfe16'
      or v_payload ->> 'targetIsolated' <> 'true'
      or v_payload ->> 'trafficEnabled' <> 'false'
      or not exists (
        select 1
        from private.backup_jobs backup
        where backup.id = v_job.backup_job_id
          and backup.status = 'ready'
          and backup.manifest_digest = p_manifest_digest
      )
      or p_validation_digest <> extensions.digest(p_validation_payload, 'sha256')
      or not pgsodium.crypto_sign_verify_detached(
        p_validation_signature, p_validation_payload, v_public_key
      )
    then
      raise exception using
        errcode = '22023', message = 'restore_verification_required';
    end if;
  end if;
  update private.restore_jobs
  set status = p_next_status,
      version = version + 1,
      validation_digest = coalesce(p_validation_digest, validation_digest),
      validation_manifest_digest =
        coalesce(p_manifest_digest, validation_manifest_digest),
      validation_deletions_head =
        coalesce(p_deletions_head, validation_deletions_head),
      validation_admin_audit_head =
        coalesce(p_admin_audit_head, validation_admin_audit_head),
      validation_target_fingerprint =
        coalesce(p_target_fingerprint, validation_target_fingerprint),
      validation_signature =
        coalesce(p_validation_signature, validation_signature),
      validation_payload =
        coalesce(p_validation_payload, validation_payload),
      validation_key_version =
        coalesce(p_validation_key_version, validation_key_version),
      validation_pending_intents =
        coalesce(p_pending_intents, validation_pending_intents),
      validation_incomplete_ranges =
        coalesce(p_incomplete_ranges, validation_incomplete_ranges),
      validation_sessions_revoked =
        coalesce(p_sessions_revoked, validation_sessions_revoked),
      validation_deleted_profiles_absent =
        coalesce(
          p_deleted_profiles_absent, validation_deleted_profiles_absent
        ),
      validation_storage_complete =
        coalesce(p_storage_complete, validation_storage_complete),
      validation_rls_verified =
        coalesce(p_rls_verified, validation_rls_verified),
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

create function private.admin_register_restore_validation_key(
  p_auth_subject uuid,
  p_auth_session_id uuid,
  p_key_version integer,
  p_public_key bytea
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_existing bytea;
begin
  perform private.require_superadmin_aal2(
    p_auth_subject, p_auth_session_id
  );
  if p_key_version < 1 or octet_length(p_public_key) <> 32 then
    raise exception using
      errcode = '22023', message = 'invalid_restore_validation_key';
  end if;
  select key.public_key into v_existing
  from private.restore_validation_keys key
  where key.key_version = p_key_version
  for update;
  if found then
    if v_existing <> p_public_key then
      raise exception using
        errcode = '23505', message = 'restore_validation_key_conflict';
    end if;
    return true;
  end if;
  insert into private.restore_validation_keys (key_version, public_key)
  values (p_key_version, p_public_key);
  return true;
end;
$$;

create function private.restore_apply_profile_tombstone(p_profile_id uuid)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  if not exists (
    select 1 from public.profiles profile where profile.id = p_profile_id
  ) then
    return true;
  end if;
  delete from private.export_artifacts where profile_id = p_profile_id;
  delete from private.ai_usage_events where profile_id = p_profile_id;
  delete from private.private_access_codes where profile_id = p_profile_id;
  delete from private.qr_grants where profile_id = p_profile_id;
  delete from public.profile_access where profile_id = p_profile_id;
  update public.commercial_product_revisions
  set owner_profile_id = null
  where owner_profile_id = p_profile_id;
  delete from public.profiles where id = p_profile_id;
  if found then return true; end if;
  raise exception using
    errcode = '55000', message = 'restore_tombstone_apply_failed';
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
  v_public_key bytea;
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
  select key.public_key into v_public_key
  from private.restore_validation_keys key
  where key.key_version = v_job.validation_key_version
    and key.activated_at <= clock_timestamp()
    and key.retired_at is null;
  if v_job.status <> 'ready_for_promotion'
    or v_job.verified_at is null
    or v_job.validation_digest is null
    or v_job.validation_manifest_digest is null
    or v_job.validation_deletions_head is null
    or v_job.validation_admin_audit_head is null
    or v_job.validation_target_fingerprint <> v_job.target_fingerprint
    or v_job.validation_signature is null
    or v_job.validation_payload is null
    or v_job.validation_key_version is null
    or v_public_key is null
    or v_job.validation_digest <> extensions.digest(
      v_job.validation_payload, 'sha256'
    )
    or not pgsodium.crypto_sign_verify_detached(
      v_job.validation_signature,
      v_job.validation_payload,
      v_public_key
    )
    or v_job.validation_pending_intents <> 0
    or v_job.validation_incomplete_ranges <> 0
    or v_job.validation_sessions_revoked is not true
    or v_job.validation_deleted_profiles_absent is not true
    or v_job.validation_storage_complete is not true
    or v_job.validation_rls_verified is not true
    or not exists (
      select 1
      from private.backup_jobs backup
      where backup.id = v_job.backup_job_id
        and backup.status = 'ready'
        and backup.manifest_digest = v_job.validation_manifest_digest
    )
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
  p_error_code text default null,
  p_manifest_digest bytea default null,
  p_deletions_head bytea default null,
  p_admin_audit_head bytea default null,
  p_target_fingerprint bytea default null,
  p_validation_payload bytea default null,
  p_validation_signature bytea default null,
  p_validation_key_version integer default null,
  p_pending_intents integer default null,
  p_incomplete_ranges integer default null,
  p_sessions_revoked boolean default null,
  p_deleted_profiles_absent boolean default null,
  p_storage_complete boolean default null,
  p_rls_verified boolean default null
)
returns jsonb
language sql
security definer
set search_path = pg_catalog
as $$
  select private.admin_transition_restore_job(
    p_auth_subject, p_auth_session_id, p_job_id, p_expected_version,
    p_next_status, p_validation_digest, p_error_code,
    p_manifest_digest, p_deletions_head, p_admin_audit_head,
    p_target_fingerprint, p_validation_payload, p_validation_signature,
    p_validation_key_version,
    p_pending_intents, p_incomplete_ranges, p_sessions_revoked,
    p_deleted_profiles_absent, p_storage_complete, p_rls_verified
  )
$$;

create function public.internal_admin_register_restore_validation_key(
  p_auth_subject uuid,
  p_auth_session_id uuid,
  p_key_version integer,
  p_public_key bytea
)
returns boolean
language sql
security definer
set search_path = pg_catalog
as $$
  select private.admin_register_restore_validation_key(
    p_auth_subject, p_auth_session_id, p_key_version, p_public_key
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
  uuid, uuid, uuid, integer, text, bytea, text, bytea, bytea, bytea,
  bytea, bytea, bytea, integer, integer, integer, boolean, boolean, boolean,
  boolean
) from public, anon, authenticated, service_role;
revoke execute on function private.admin_register_restore_validation_key(
  uuid, uuid, integer, bytea
) from public, anon, authenticated, service_role;
revoke execute on function private.restore_apply_profile_tombstone(uuid)
from public, anon, authenticated, service_role;

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
  uuid, uuid, uuid, integer, text, bytea, text, bytea, bytea, bytea,
  bytea, bytea, bytea, integer, integer, integer, boolean, boolean, boolean,
  boolean
) from public, anon, authenticated;
revoke execute on function public.internal_admin_register_restore_validation_key(
  uuid, uuid, integer, bytea
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
  uuid, uuid, uuid, integer, text, bytea, text, bytea, bytea, bytea,
  bytea, bytea, bytea, integer, integer, integer, boolean, boolean, boolean,
  boolean
) to service_role;
grant execute on function public.internal_admin_register_restore_validation_key(
  uuid, uuid, integer, bytea
) to service_role;
