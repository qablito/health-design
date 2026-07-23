begin;

select plan(21);

select ok(
  to_regprocedure(
    'public.internal_admin_prepare_audit_deletion_job(uuid,uuid,uuid,bigint,bigint,bytea,bytea,bytea)'
  ) is not null,
  'existe preparación AAL2 del rango'
);
select ok(
  to_regprocedure(
    'public.internal_admin_list_auth_cleanup_candidates(uuid,uuid,uuid,integer)'
  ) is not null,
  'existe selección paginada de candidatos Auth'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.internal_admin_disable_auth_cleanup_actor(uuid,uuid,uuid)',
    'EXECUTE'
  ),
  'authenticated no deshabilita actores'
);
select ok(
  not has_table_privilege(
    'authenticated',
    'private.audit_range_tombstones',
    'SELECT,INSERT,UPDATE,DELETE'
  ),
  'clientes no leen recibos de rangos'
);

insert into auth.users (
  instance_id, id, aud, role, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at, is_anonymous, last_sign_in_at
) values
  (
    '00000000-0000-0000-0000-000000000000',
    '00000000-0000-4000-8000-000000018499',
    'authenticated', 'authenticated',
    '{"provider":"email","providers":["email"]}', '{}',
    now() - interval '90 days', now(), false, now()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '00000000-0000-4000-8000-000000018401',
    'authenticated', 'authenticated',
    '{}', '{}',
    now() - interval '2 days', now(), true, null
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '00000000-0000-4000-8000-000000018402',
    'authenticated', 'authenticated',
    '{}', '{}',
    now() - interval '2 days', now(), true, null
  );
insert into auth.sessions (id, user_id, created_at, updated_at, aal) values (
  '21000000-0000-4000-8000-000000018499',
  '00000000-0000-4000-8000-000000018499',
  now(), now(), 'aal2'
);
insert into public.actors (id, auth_subject, role) values
  (
    '31000000-0000-4000-8000-000000018499',
    '00000000-0000-4000-8000-000000018499',
    'superadmin'
  ),
  (
    '31000000-0000-4000-8000-000000018401',
    '00000000-0000-4000-8000-000000018401',
    'device'
  ),
  (
    '31000000-0000-4000-8000-000000018402',
    '00000000-0000-4000-8000-000000018402',
    'device'
  );
insert into public.profiles (
  id, alias, timezone, adult_attested_at
) values (
  '51000000-0000-4000-8000-000000018402',
  'Perfil activo cleanup T18', 'Europe/Madrid', now()
);
insert into public.profile_access (id, profile_id, actor_id) values (
  '61000000-0000-4000-8000-000000018402',
  '51000000-0000-4000-8000-000000018402',
  '31000000-0000-4000-8000-000000018402'
);

select is(
  jsonb_array_length(
    public.internal_admin_list_auth_cleanup_candidates(
      '00000000-0000-4000-8000-000000018499',
      '21000000-0000-4000-8000-000000018499',
      null, 100
    )
  ),
  1,
  'solo la identidad anónima huérfana es elegible'
);
select is(
  (
    public.internal_admin_list_auth_cleanup_candidates(
      '00000000-0000-4000-8000-000000018499',
      '21000000-0000-4000-8000-000000018499',
      null, 100
    ) -> 0 ->> 'authSubject'
  )::uuid,
  '00000000-0000-4000-8000-000000018401'::uuid,
  'la paginación devuelve el sujeto huérfano exacto'
);
select lives_ok(
  $$
    select public.internal_admin_disable_auth_cleanup_actor(
      '00000000-0000-4000-8000-000000018499',
      '21000000-0000-4000-8000-000000018499',
      '00000000-0000-4000-8000-000000018401'
    )
  $$,
  'el actor técnico elegible se deshabilita'
);
select ok(
  (
    select disabled_at is not null
    from public.actors
    where auth_subject = '00000000-0000-4000-8000-000000018401'
  ),
  'el actor se conserva deshabilitado para auditoría'
);
select lives_ok(
  $$
    delete from auth.users
    where id = '00000000-0000-4000-8000-000000018401'
  $$,
  'la identidad Auth huérfana puede eliminarse después de deshabilitar el actor'
);
select ok(
  exists (
    select 1 from public.actors
    where id = '31000000-0000-4000-8000-000000018401'
      and auth_subject is null
      and disabled_at is not null
  ),
  'el actor técnico sobrevive sin identidad Auth'
);
select throws_ok(
  $$
    select public.internal_admin_disable_auth_cleanup_actor(
      '00000000-0000-4000-8000-000000018499',
      '21000000-0000-4000-8000-000000018499',
      '00000000-0000-4000-8000-000000018499'
    )
  $$,
  '42501', 'superadmin_protected',
  'el superadministrador nunca es elegible'
);

select is(
  public.internal_admin_prepare_audit_deletion_job(
    '00000000-0000-4000-8000-000000018499',
    '21000000-0000-4000-8000-000000018499',
    '71000000-0000-4000-8000-000000018401',
    10, 12, digest('before', 'sha256'),
    digest('terminal', 'sha256'), digest('manifest', 'sha256')
  ) ->> 'status',
  'prepared',
  'el rango comienza preparado'
);
select throws_ok(
  $$
    select public.internal_admin_prepare_audit_deletion_job(
      '00000000-0000-4000-8000-000000018499',
      '21000000-0000-4000-8000-000000018499',
      '71000000-0000-4000-8000-000000018402',
      20, 21, digest('before2', 'sha256'),
      digest('terminal2', 'sha256'), digest('manifest2', 'sha256')
    )
  $$,
  '55000', 'audit_deletion_incomplete',
  'un rango abierto bloquea el siguiente'
);
select is(
  public.internal_admin_record_audit_deletion_intent(
    '00000000-0000-4000-8000-000000018499',
    '21000000-0000-4000-8000-000000018499',
    '71000000-0000-4000-8000-000000018401',
    1, digest('intent', 'sha256')
  ) ->> 'status',
  'intent_recorded',
  'el intent verificado precede al borrado'
);
select is(
  public.internal_admin_complete_audit_deletion(
    '00000000-0000-4000-8000-000000018499',
    '21000000-0000-4000-8000-000000018499',
    '71000000-0000-4000-8000-000000018401',
    2, digest('complete', 'sha256')
  ) ->> 'status',
  'verified',
  'el complete exacto cierra el rango'
);
select ok(
  (
    select complete_record_hash is not null and completed_at is not null
    from private.audit_range_tombstones
    where audit_deletion_job_id =
      '71000000-0000-4000-8000-000000018401'
  ),
  'el par intent/complete queda persistido'
);
select lives_ok(
  $$
    select public.internal_admin_prepare_audit_deletion_job(
      '00000000-0000-4000-8000-000000018499',
      '21000000-0000-4000-8000-000000018499',
      '71000000-0000-4000-8000-000000018402',
      20, 21, digest('before2', 'sha256'),
      digest('terminal2', 'sha256'), digest('manifest2', 'sha256')
    )
  $$,
  'cerrar el rango permite preparar el siguiente'
);
select ok(
  (
    select relrowsecurity
    from pg_class
    where oid = 'private.audit_deletion_jobs'::regclass
  ),
  'AuditDeletionJob conserva RLS'
);
select ok(
  (
    select proconfig @> array['search_path=pg_catalog']
    from pg_proc
    where oid =
      'private.admin_list_auth_cleanup_candidates(uuid,uuid,uuid,integer)'::regprocedure
  ),
  'la selección Auth fija search_path'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.internal_admin_complete_audit_deletion(uuid,uuid,uuid,integer,bytea)',
    'EXECUTE'
  ),
  'service_role puede cerrar el rango'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.internal_admin_list_auth_cleanup_candidates(uuid,uuid,uuid,integer)',
    'EXECUTE'
  ),
  'service_role puede leer candidatos elegibles'
);

select * from finish();
rollback;
