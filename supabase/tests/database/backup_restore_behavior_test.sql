begin;

select plan(10);

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
select is(
  public.internal_admin_transition_restore_job(
    '00000000-0000-4000-8000-000000018399',
    '21000000-0000-4000-8000-000000018399',
    '81000000-0000-4000-8000-000000018301',
    4, 'ready_for_promotion', digest('validation', 'sha256')
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

select * from finish();
rollback;
