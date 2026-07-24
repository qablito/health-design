begin;

select no_plan();

select ok(
  to_regclass('private.backup_jobs') is not null,
  'existe BackupJob privado'
);
select ok(
  to_regclass('private.restore_jobs') is not null,
  'existe RestoreJob privado'
);
select ok(
  to_regclass('private.audit_deletion_jobs') is not null,
  'existe AuditDeletionJob privado'
);
select ok(
  to_regclass('private.audit_range_tombstones') is not null,
  'existe AuditRangeTombstone privado'
);
select ok(
  to_regclass('private.deletion_job_steps') is not null,
  'DeletionJob conserva pasos cerrados'
);

select ok(
  not has_table_privilege(
    'authenticated', 'private.backup_jobs', 'SELECT,INSERT,UPDATE,DELETE'
  )
  and not has_table_privilege(
    'authenticated', 'private.restore_jobs', 'SELECT,INSERT,UPDATE,DELETE'
  )
  and not has_table_privilege(
    'anon', 'private.audit_deletion_jobs', 'SELECT,INSERT,UPDATE,DELETE'
  ),
  'las tablas operativas no tienen grants de cliente'
);

select ok(
  to_regprocedure(
    'public.internal_request_profile_deletion(uuid,uuid,uuid,text,bytea,bytea,bytea,bytea,integer)'
  ) is not null,
  'existe la solicitud idempotente de borrado'
);
select ok(
  to_regprocedure(
    'public.internal_get_deletion_request(uuid,uuid,bytea)'
  ) is not null,
  'existe la consulta mínima del estado propio'
);
select ok(
  to_regprocedure(
    'public.internal_admin_transition_deletion_job(uuid,uuid,uuid,integer,text,text)'
  ) is not null,
  'existe transición administrativa CAS del borrado'
);
select ok(
  to_regprocedure(
    'public.internal_admin_complete_deletion_step(uuid,uuid,uuid,integer,text,bytea)'
  ) is not null,
  'existe confirmación cerrada de pasos'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'public.internal_admin_transition_deletion_job(uuid,uuid,uuid,integer,text,text)',
    'EXECUTE'
  )
  and has_function_privilege(
    'service_role',
    'public.internal_admin_transition_deletion_job(uuid,uuid,uuid,integer,text,text)',
    'EXECUTE'
  ),
  'solo service_role ejecuta transiciones administrativas'
);

select ok(
  exists (
    select 1
    from information_schema.columns
    where table_schema = 'private'
      and table_name = 'deletion_jobs'
      and column_name = 'profile_marker_key_version'
  )
  and exists (
    select 1
    from information_schema.columns
    where table_schema = 'private'
      and table_name = 'deletion_jobs'
      and column_name = 'version'
  ),
  'DeletionJob conserva versión CAS y versión HMAC'
);

select ok(
  (
    select confdeltype = 'n'
    from pg_constraint
    where conname = 'deletion_jobs_profile_id_fkey'
  ),
  'DeletionJob sobrevive al perfil con ON DELETE SET NULL'
);

select ok(
  not exists (
    select 1
    from pg_proc p
    cross join lateral aclexplode(
      coalesce(p.proacl, acldefault('f', p.proowner))
    ) acl
    where p.pronamespace = 'private'::regnamespace
      and p.prosecdef
      and acl.grantee = 0
      and acl.privilege_type = 'EXECUTE'
  ),
  'PUBLIC no ejecuta funciones SECURITY DEFINER privadas'
);

insert into auth.users (
  instance_id, id, aud, role, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at, is_anonymous
) values
  (
    '00000000-0000-0000-0000-000000000000',
    '00000000-0000-4000-8000-000000018001',
    'authenticated', 'authenticated',
    '{"provider":"anonymous","providers":["anonymous"]}', '{}',
    now(), now(), true
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '00000000-0000-4000-8000-000000018099',
    'authenticated', 'authenticated',
    '{"provider":"email","providers":["email"]}', '{}',
    now(), now(), false
  );

insert into auth.sessions (id, user_id, created_at, updated_at, aal) values
  (
    '21000000-0000-4000-8000-000000018001',
    '00000000-0000-4000-8000-000000018001',
    now(), now(), 'aal1'
  ),
  (
    '21000000-0000-4000-8000-000000018099',
    '00000000-0000-4000-8000-000000018099',
    now(), now(), 'aal2'
  );

insert into public.actors (id, auth_subject, role) values
  (
    '31000000-0000-4000-8000-000000018001',
    '00000000-0000-4000-8000-000000018001',
    'device'
  ),
  (
    '31000000-0000-4000-8000-000000018099',
    '00000000-0000-4000-8000-000000018099',
    'superadmin'
  );

insert into public.device_sessions (
  id, actor_id, auth_session_id, label, created_at, last_seen_at,
  idle_expires_at, absolute_expires_at
) values (
  '41000000-0000-4000-8000-000000018001',
  '31000000-0000-4000-8000-000000018001',
  '21000000-0000-4000-8000-000000018001',
  'T18', now(), now(), now() + interval '30 days', now() + interval '180 days'
);

insert into public.profiles (
  id, alias, timezone, adult_attested_at
) values (
  '51000000-0000-4000-8000-000000018001',
  'Perfil T18', 'Europe/Madrid', now()
);

insert into public.profile_access (id, profile_id, actor_id) values (
  '61000000-0000-4000-8000-000000018001',
  '51000000-0000-4000-8000-000000018001',
  '31000000-0000-4000-8000-000000018001'
);

create temporary table t18_job as
select (
  public.internal_request_profile_deletion(
    '00000000-0000-4000-8000-000000018001',
    '21000000-0000-4000-8000-000000018001',
    '51000000-0000-4000-8000-000000018001',
    'perfil t18',
    digest('marker', 'sha256'),
    digest('handle', 'sha256'),
    digest('key', 'sha256'),
    digest('request', 'sha256'),
    1
  ) ->> 'jobId'
)::uuid as job_id;

select is(
  (
    select status
    from public.profiles
    where id = '51000000-0000-4000-8000-000000018001'
  ),
  'deletion_requested',
  'solicitar borrado bloquea el perfil inmediatamente'
);

select is(
  (
    public.internal_request_profile_deletion(
      '00000000-0000-4000-8000-000000018001',
      '21000000-0000-4000-8000-000000018001',
      '51000000-0000-4000-8000-000000018001',
      'perfil t18',
      digest('marker', 'sha256'),
      digest('handle', 'sha256'),
      digest('key', 'sha256'),
      digest('request', 'sha256'),
      1
    ) ->> 'jobId'
  )::uuid,
  (select job_id from t18_job),
  'repetir la misma solicitud devuelve el mismo job'
);

select throws_ok(
  $$select public.internal_request_profile_deletion(
    '00000000-0000-4000-8000-000000018001',
    '21000000-0000-4000-8000-000000018001',
    '51000000-0000-4000-8000-000000018001',
    'perfil t18',
    digest('marker', 'sha256'),
    digest('handle', 'sha256'),
    digest('key', 'sha256'),
    digest('otro cuerpo', 'sha256'),
    1
  )$$,
  '23505', 'idempotency_conflict',
  'misma clave y otro cuerpo produce conflicto'
);

select throws_ok(
  $$update public.profiles
    set status = 'active', deletion_requested_at = null
    where id = '51000000-0000-4000-8000-000000018001'$$,
  '23514', 'profile_deletion_is_terminal',
  'deletion_requested nunca vuelve a active'
);

select is(
  (
    public.internal_admin_complete_deletion_step(
      '00000000-0000-4000-8000-000000018099',
      '21000000-0000-4000-8000-000000018099',
      (select job_id from t18_job),
      1,
      'ledger',
      digest('ledger receipt', 'sha256')
    ) ->> 'version'
  )::integer,
  2,
  'un paso completado avanza la versión CAS'
);

select is(
  (
    public.internal_admin_transition_deletion_job(
      '00000000-0000-4000-8000-000000018099',
      '21000000-0000-4000-8000-000000018099',
      (select job_id from t18_job),
      2,
      'ledger_recorded',
      null
    ) ->> 'status'
  ),
  'ledger_recorded',
  'el job avanza después de verificar el tombstone'
);

select throws_ok(
  format(
    $sql$select public.internal_admin_transition_deletion_job(
      '00000000-0000-4000-8000-000000018099',
      '21000000-0000-4000-8000-000000018099',
      %L,
      2,
      'purging',
      null
    )$sql$,
    (select job_id from t18_job)
  ),
  '40001', 'version_conflict',
  'una versión administrativa obsoleta falla antes de mutar'
);

select lives_ok(
  format(
    $sql$select public.internal_admin_transition_deletion_job(
      '00000000-0000-4000-8000-000000018099',
      '21000000-0000-4000-8000-000000018099',
      %L,
      3,
      'purging',
      null
    )$sql$,
    (select job_id from t18_job)
  ),
  'el job puede entrar en purging'
);

select throws_ok(
  format(
    $sql$select public.internal_admin_transition_deletion_job(
      '00000000-0000-4000-8000-000000018099',
      '21000000-0000-4000-8000-000000018099',
      %L,
      4,
      'purged',
      null
    )$sql$,
    (select job_id from t18_job)
  ),
  '55000', 'deletion_steps_incomplete',
  'purged exige los siete recibos completos'
);

select * from finish();

rollback;
