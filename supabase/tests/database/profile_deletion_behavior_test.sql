begin;

select plan(15);

insert into auth.users (
  instance_id, id, aud, role, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at, is_anonymous
) values
  (
    '00000000-0000-0000-0000-000000000000',
    '00000000-0000-4000-8000-000000018201',
    'authenticated', 'authenticated',
    '{"provider":"email","providers":["email"]}', '{}',
    now(), now(), false
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '00000000-0000-4000-8000-000000018202',
    'authenticated', 'authenticated',
    '{"provider":"email","providers":["email"]}', '{}',
    now(), now(), false
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '00000000-0000-4000-8000-000000018299',
    'authenticated', 'authenticated',
    '{"provider":"email","providers":["email"]}', '{}',
    now(), now(), false
  );

insert into auth.sessions (id, user_id, created_at, updated_at, aal) values
  (
    '21000000-0000-4000-8000-000000018201',
    '00000000-0000-4000-8000-000000018201',
    now(), now(), 'aal1'
  ),
  (
    '21000000-0000-4000-8000-000000018202',
    '00000000-0000-4000-8000-000000018202',
    now(), now(), 'aal1'
  ),
  (
    '21000000-0000-4000-8000-000000018299',
    '00000000-0000-4000-8000-000000018299',
    now(), now(), 'aal2'
  );

insert into public.actors (id, auth_subject, role) values
  (
    '31000000-0000-4000-8000-000000018201',
    '00000000-0000-4000-8000-000000018201',
    'device'
  ),
  (
    '31000000-0000-4000-8000-000000018202',
    '00000000-0000-4000-8000-000000018202',
    'device'
  ),
  (
    '31000000-0000-4000-8000-000000018299',
    '00000000-0000-4000-8000-000000018299',
    'superadmin'
  );

insert into public.device_sessions (
  id, actor_id, auth_session_id, label, created_at, last_seen_at,
  idle_expires_at, absolute_expires_at
) values
  (
    '41000000-0000-4000-8000-000000018201',
    '31000000-0000-4000-8000-000000018201',
    '21000000-0000-4000-8000-000000018201',
    'Compartida T18', now(), now(),
    now() + interval '30 days', now() + interval '180 days'
  ),
  (
    '41000000-0000-4000-8000-000000018202',
    '31000000-0000-4000-8000-000000018202',
    '21000000-0000-4000-8000-000000018202',
    'Exclusiva T18', now(), now(),
    now() + interval '30 days', now() + interval '180 days'
  );

insert into public.profiles (
  id, alias, timezone, adult_attested_at, status, deletion_requested_at
) values
  (
    '51000000-0000-4000-8000-000000018201',
    'Borrado compartido T18', 'Europe/Madrid', now(),
    'deletion_requested', now()
  ),
  (
    '51000000-0000-4000-8000-000000018202',
    'Perfil conservado T18', 'Europe/Madrid', now(),
    'active', null
  ),
  (
    '51000000-0000-4000-8000-000000018203',
    'Borrado exclusivo T18', 'Europe/Madrid', now(),
    'deletion_requested', now()
  );

insert into public.profile_access (id, profile_id, actor_id) values
  (
    '61000000-0000-4000-8000-000000018201',
    '51000000-0000-4000-8000-000000018201',
    '31000000-0000-4000-8000-000000018201'
  ),
  (
    '61000000-0000-4000-8000-000000018202',
    '51000000-0000-4000-8000-000000018202',
    '31000000-0000-4000-8000-000000018201'
  ),
  (
    '61000000-0000-4000-8000-000000018203',
    '51000000-0000-4000-8000-000000018203',
    '31000000-0000-4000-8000-000000018202'
  );

insert into private.deletion_jobs (
  id, profile_id, profile_marker, request_handle_hash,
  requester_actor_id, confirmed_by, status
) values
  (
    '71000000-0000-4000-8000-000000018201',
    '51000000-0000-4000-8000-000000018201',
    digest('shared-marker', 'sha256'), digest('shared-handle', 'sha256'),
    '31000000-0000-4000-8000-000000018201',
    '31000000-0000-4000-8000-000000018299',
    'purging'
  ),
  (
    '71000000-0000-4000-8000-000000018202',
    '51000000-0000-4000-8000-000000018203',
    digest('exclusive-marker', 'sha256'), digest('exclusive-handle', 'sha256'),
    '31000000-0000-4000-8000-000000018202',
    '31000000-0000-4000-8000-000000018299',
    'purging'
  );

insert into private.deletion_job_steps (
  deletion_job_id, step_name, completed_at, receipt_digest
)
select job_id, step_name, now(), digest(job_id::text || step_name, 'sha256')
from unnest(array[
  '71000000-0000-4000-8000-000000018201'::uuid,
  '71000000-0000-4000-8000-000000018202'::uuid
]) job_id
cross join unnest(array['ledger', 'access', 'exports', 'storage']) step_name;

select lives_ok(
  $$
    select public.internal_admin_revoke_profile_access(
      '00000000-0000-4000-8000-000000018299',
      '21000000-0000-4000-8000-000000018299',
      '71000000-0000-4000-8000-000000018201',
      1
    )
  $$,
  'la revocación del perfil compartido se ejecuta'
);
select is(
  (
    select revoked_at is null
    from public.device_sessions
    where id = '41000000-0000-4000-8000-000000018201'
  ),
  true,
  'la sesión compartida continúa activa por el segundo perfil'
);
select lives_ok(
  $$
    select public.internal_admin_purge_profile_data(
      '00000000-0000-4000-8000-000000018299',
      '21000000-0000-4000-8000-000000018299',
      '71000000-0000-4000-8000-000000018201',
      1
    )
  $$,
  'la purga del perfil compartido se ejecuta'
);
select ok(
  not exists (
    select 1 from public.profiles
    where id = '51000000-0000-4000-8000-000000018201'
  ),
  'el perfil solicitado desaparece'
);
select ok(
  exists (
    select 1 from public.profiles
    where id = '51000000-0000-4000-8000-000000018202'
  ),
  'el segundo perfil de la identidad permanece intacto'
);
select is(
  public.internal_admin_get_profile_deletion_secret(
    '00000000-0000-4000-8000-000000018299',
    '21000000-0000-4000-8000-000000018299',
    '71000000-0000-4000-8000-000000018201',
    null
  ) -> 'job' ->> 'jobId',
  '71000000-0000-4000-8000-000000018201',
  'el job sigue resolviendo su material mínimo después de borrar el perfil'
);
select is(
  public.internal_admin_list_orphan_auth_subjects(
    '00000000-0000-4000-8000-000000018299',
    '21000000-0000-4000-8000-000000018299',
    '71000000-0000-4000-8000-000000018201'
  ),
  '[]'::jsonb,
  'la identidad compartida no se considera huérfana'
);

select lives_ok(
  $$
    select public.internal_admin_revoke_profile_access(
      '00000000-0000-4000-8000-000000018299',
      '21000000-0000-4000-8000-000000018299',
      '71000000-0000-4000-8000-000000018202',
      1
    )
  $$,
  'la revocación del perfil exclusivo se ejecuta'
);
select is(
  (
    select revoked_at is not null
    from public.device_sessions
    where id = '41000000-0000-4000-8000-000000018202'
  ),
  true,
  'la sesión exclusiva queda revocada'
);
select lives_ok(
  $$
    select public.internal_admin_purge_profile_data(
      '00000000-0000-4000-8000-000000018299',
      '21000000-0000-4000-8000-000000018299',
      '71000000-0000-4000-8000-000000018202',
      1
    )
  $$,
  'la purga del perfil exclusivo se ejecuta'
);
select is(
  public.internal_admin_list_orphan_auth_subjects(
    '00000000-0000-4000-8000-000000018299',
    '21000000-0000-4000-8000-000000018299',
    '71000000-0000-4000-8000-000000018202'
  ),
  '["00000000-0000-4000-8000-000000018202"]'::jsonb,
  'la identidad exclusiva queda marcada para limpieza Auth'
);
select ok(
  (
    select disabled_at is not null
    from public.actors
    where id = '31000000-0000-4000-8000-000000018202'
  ),
  'el actor huérfano queda deshabilitado atómicamente antes de borrar Auth'
);
select is(
  public.internal_admin_list_orphan_auth_subjects(
    '00000000-0000-4000-8000-000000018299',
    '21000000-0000-4000-8000-000000018299',
    '71000000-0000-4000-8000-000000018202'
  ),
  '["00000000-0000-4000-8000-000000018202"]'::jsonb,
  'un reintento mantiene el mismo sujeto deshabilitado hasta borrar Auth'
);
select ok(
  (
    select profile_id is null
    from private.deletion_jobs
    where id = '71000000-0000-4000-8000-000000018202'
  ),
  'el job sobrevive sin FK al perfil'
);
select lives_ok(
  $$
    select public.internal_admin_verify_profile_purge(
      '00000000-0000-4000-8000-000000018299',
      '21000000-0000-4000-8000-000000018299',
      '71000000-0000-4000-8000-000000018202'
    )
  $$,
  'la verificación confirma ausencia y marcador persistente'
);

select * from finish();
rollback;
