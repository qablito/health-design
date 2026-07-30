begin;

select plan(15);

insert into auth.users (
  instance_id, id, aud, role, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at, is_anonymous
) values (
  '00000000-0000-0000-0000-000000000000',
  '00000000-0000-4000-8000-000000018399',
  'authenticated', 'authenticated',
  '{"provider":"email","providers":["email"]}', '{}',
  now(), now(), false
);
insert into auth.sessions (id, user_id, created_at, updated_at, aal) values
  (
    '21000000-0000-4000-8000-000000018398',
    '00000000-0000-4000-8000-000000018399',
    now(), now(), 'aal1'
  ),
  (
    '21000000-0000-4000-8000-000000018399',
    '00000000-0000-4000-8000-000000018399',
    now(), now(), 'aal2'
  );
insert into public.actors (id, auth_subject, role) values (
  '31000000-0000-4000-8000-000000018399',
  '00000000-0000-4000-8000-000000018399',
  'superadmin'
);

select throws_ok(
  $$
    select public.internal_admin_create_backup_job(
      '00000000-0000-4000-8000-000000018399',
      '21000000-0000-4000-8000-000000018398',
      '71000000-0000-4000-8000-000000018301',
      'weekly', 'development', 1
    )
  $$,
  '42501', 'aal2_required',
  'AAL1 no crea copias'
);
select is(
  public.internal_admin_create_backup_job(
    '00000000-0000-4000-8000-000000018399',
    '21000000-0000-4000-8000-000000018399',
    '71000000-0000-4000-8000-000000018301',
    'weekly', 'development', 1
  ) ->> 'status',
  'queued',
  'AAL2 crea un BackupJob encolado'
);
select is(
  public.internal_admin_transition_backup_job(
    '00000000-0000-4000-8000-000000018399',
    '21000000-0000-4000-8000-000000018399',
    '71000000-0000-4000-8000-000000018301',
    1, 'capturing'
  ) ->> 'status',
  'capturing',
  'el operador inicia captura con CAS'
);
select lives_ok(
  $$
    select public.internal_admin_transition_backup_job(
      '00000000-0000-4000-8000-000000018399',
      '21000000-0000-4000-8000-000000018399',
      '71000000-0000-4000-8000-000000018301',
      2, 'verifying'
    )
  $$,
  'la copia pasa a verificación'
);
select is(
  public.internal_admin_transition_backup_job(
    '00000000-0000-4000-8000-000000018399',
    '21000000-0000-4000-8000-000000018399',
    '71000000-0000-4000-8000-000000018301',
    3, 'ready', digest('manifest', 'sha256'), 1
  ) ->> 'status',
  'ready',
  'solo la copia verificada queda ready'
);
select is(
  public.internal_admin_create_restore_job(
    '00000000-0000-4000-8000-000000018399',
    '21000000-0000-4000-8000-000000018399',
    '81000000-0000-4000-8000-000000018301',
    '71000000-0000-4000-8000-000000018301',
    digest('isolated-target', 'sha256')
  ) ->> 'status',
  'queued',
  'restore solo se crea desde una copia ready'
);
select lives_ok(
  $$
    select public.internal_admin_transition_restore_job(
      '00000000-0000-4000-8000-000000018399',
      '21000000-0000-4000-8000-000000018399',
      '81000000-0000-4000-8000-000000018301',
      1, 'verifying'
    );
    select public.internal_admin_transition_restore_job(
      '00000000-0000-4000-8000-000000018399',
      '21000000-0000-4000-8000-000000018399',
      '81000000-0000-4000-8000-000000018301',
      2, 'restoring'
    );
    select public.internal_admin_transition_restore_job(
      '00000000-0000-4000-8000-000000018399',
      '21000000-0000-4000-8000-000000018399',
      '81000000-0000-4000-8000-000000018301',
      3, 'validating'
    )
  $$,
  'el restore progresa con transiciones cerradas'
);
select throws_ok(
  $$
    select public.internal_admin_promote_restore_job(
      '00000000-0000-4000-8000-000000018399',
      '21000000-0000-4000-8000-000000018399',
      '81000000-0000-4000-8000-000000018301',
      4
    )
  $$,
  '55000', 'restore_not_verified',
  'un restore no verificado no se promueve'
);
select throws_ok(
  $$
    select public.internal_admin_transition_restore_job(
      '00000000-0000-4000-8000-000000018399',
      '21000000-0000-4000-8000-000000018399',
      '81000000-0000-4000-8000-000000018301',
      4, 'ready_for_promotion', digest('validation', 'sha256')
    )
  $$,
  '22023', 'restore_verification_required',
  'un digest aislado no sustituye la atestación completa'
);

create temporary table t18_restore_signing_key (
  public bytea not null,
  secret bytea not null
);
insert into t18_restore_signing_key (public, secret) values (
  decode(
    'd75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a',
    'hex'
  ),
  decode(
    '9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60'
    || 'd75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a',
    'hex'
  )
);

select lives_ok(
  $$
    select public.internal_admin_register_restore_validation_key(
      '00000000-0000-4000-8000-000000018399',
      '21000000-0000-4000-8000-000000018399',
      1,
      (select public from t18_restore_signing_key)
    )
  $$,
  'el operador AAL2 registra la clave pública de validación'
);

create temporary table t18_restore_attestation as
select convert_to(
  '{"aal2Required":true'
  || ',"adminAuditHead":"' || encode(digest('admin-audit-head', 'sha256'), 'hex')
  || '","backupJobId":"71000000-0000-4000-8000-000000018301"'
  || ',"deletedProfilesAbsent":true'
  || ',"deletionsHead":"' || encode(digest('deletions-head', 'sha256'), 'hex')
  || '","incompleteRanges":0'
  || ',"manifestDigest":"' || encode(digest('manifest', 'sha256'), 'hex')
  || '","pendingIntents":0'
  || ',"restoreJobId":"81000000-0000-4000-8000-000000018301"'
  || ',"rlsVerified":true,"schemaVersion":1'
  || ',"securityPolicyDigest":"949f93950219470fe325bb427912bcf274ba594c60f94a5623add2517de73bf5"'
  || ',"sessionsRevoked":true,"storageComplete":true'
  || ',"targetFingerprint":"' || encode(digest('isolated-target', 'sha256'), 'hex')
  || '","targetIsolated":true,"trafficEnabled":false}',
  'UTF8'
) as payload;

select throws_ok(
  $$
    select public.internal_admin_transition_restore_job(
      p_auth_subject => '00000000-0000-4000-8000-000000018399',
      p_auth_session_id => '21000000-0000-4000-8000-000000018399',
      p_job_id => '81000000-0000-4000-8000-000000018301',
      p_expected_version => 4,
      p_next_status => 'ready_for_promotion',
      p_validation_digest => digest(
        (select payload from t18_restore_attestation), 'sha256'
      ),
      p_manifest_digest => digest('manifest', 'sha256'),
      p_deletions_head => digest('deletions-head', 'sha256'),
      p_admin_audit_head => digest('admin-audit-head', 'sha256'),
      p_target_fingerprint => digest('isolated-target', 'sha256'),
      p_validation_payload => (select payload from t18_restore_attestation),
      p_validation_signature =>
        digest('signature-a', 'sha256') || digest('signature-b', 'sha256'),
      p_validation_key_version => 1,
      p_pending_intents => 0,
      p_incomplete_ranges => 0,
      p_sessions_revoked => true,
      p_deleted_profiles_absent => true,
      p_storage_complete => true,
      p_rls_verified => true
    )
  $$,
  '22023', 'restore_verification_required',
  'una firma Ed25519 sintética no habilita promoción'
);

select is(
  public.internal_admin_transition_restore_job(
    p_auth_subject => '00000000-0000-4000-8000-000000018399',
    p_auth_session_id => '21000000-0000-4000-8000-000000018399',
    p_job_id => '81000000-0000-4000-8000-000000018301',
    p_expected_version => 4,
    p_next_status => 'ready_for_promotion',
    p_validation_digest => digest(
      (select payload from t18_restore_attestation), 'sha256'
    ),
    p_manifest_digest => digest('manifest', 'sha256'),
    p_deletions_head => digest('deletions-head', 'sha256'),
    p_admin_audit_head => digest('admin-audit-head', 'sha256'),
    p_target_fingerprint => digest('isolated-target', 'sha256'),
    p_validation_payload => (select payload from t18_restore_attestation),
    p_validation_signature => (
      select pgsodium.crypto_sign_detached(
        attestation.payload, signing.secret
      )
      from t18_restore_attestation attestation
      cross join t18_restore_signing_key signing
    ),
    p_validation_key_version => 1,
    p_pending_intents => 0,
    p_incomplete_ranges => 0,
    p_sessions_revoked => true,
    p_deleted_profiles_absent => true,
    p_storage_complete => true,
    p_rls_verified => true
  ) ->> 'status',
  'ready_for_promotion',
  'la validación aislada habilita autorización'
);
select is(
  public.internal_admin_promote_restore_job(
    '00000000-0000-4000-8000-000000018399',
    '21000000-0000-4000-8000-000000018399',
    '81000000-0000-4000-8000-000000018301',
    5
  ) ->> 'status',
  'promoted',
  'la promoción es una transición independiente'
);

insert into public.profiles (
  id, alias, timezone, adult_attested_at
) values (
  '51000000-0000-4000-8000-000000018399',
  'Restore Tombstone', 'Europe/Madrid', clock_timestamp()
);
select is(
  private.restore_apply_profile_tombstone(
    '51000000-0000-4000-8000-000000018399'
  ),
  true,
  'el adaptador aislado aplica un tombstone al perfil restaurado'
);
select is(
  (
    select count(*)::integer from public.profiles
    where id = '51000000-0000-4000-8000-000000018399'
  ),
  0,
  'el perfil tombstoned no sobrevive al restore'
);

select * from finish();
rollback;
