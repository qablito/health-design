create or replace function private.admin_transition_restore_job(
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
        '949f93950219470fe325bb427912bcf274ba594c60f94a5623add2517de73bf5'
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
