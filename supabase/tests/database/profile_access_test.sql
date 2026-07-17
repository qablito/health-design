create extension if not exists dblink with schema extensions;

select no_plan();

-- Carrera real: dos conexiones intentan materializar el mismo Actor a la vez.
delete from public.actors
where auth_subject = '00000000-0000-4000-8000-000000000009';
delete from auth.users
where id = '00000000-0000-4000-8000-000000000009';

drop function if exists private.test_concurrent_ensure_actor(uuid);

insert into auth.users (
  instance_id,
  id,
  aud,
  role,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at,
  is_anonymous
)
values (
  '00000000-0000-0000-0000-000000000000',
  '00000000-0000-4000-8000-000000000009',
  'authenticated',
  'authenticated',
  '{"provider":"anonymous","providers":["anonymous"]}'::jsonb,
  '{}'::jsonb,
  now(),
  now(),
  true
);

create function private.test_concurrent_ensure_actor(subject uuid)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', subject, 'role', 'authenticated')::text,
    true
  );
  return private.ensure_actor();
end;
$$;

create temporary table concurrent_actor_results (actor_id uuid not null);

do $$
declare
  connection_string text := format(
    'hostaddr=%s port=%s dbname=%s user=postgres password=postgres',
    inet_server_addr(),
    inet_server_port(),
    current_database()
  );
begin
  perform extensions.dblink_connect(
    'ensure_actor_one',
    connection_string
  );
  perform extensions.dblink_connect(
    'ensure_actor_two',
    connection_string
  );
  perform extensions.dblink_send_query(
    'ensure_actor_one',
    $query$
      with barrier as materialized (select pg_sleep(0.25))
      select private.test_concurrent_ensure_actor(
        '00000000-0000-4000-8000-000000000009'
      ) from barrier
    $query$
  );
  perform extensions.dblink_send_query(
    'ensure_actor_two',
    $query$
      with barrier as materialized (select pg_sleep(0.25))
      select private.test_concurrent_ensure_actor(
        '00000000-0000-4000-8000-000000000009'
      ) from barrier
    $query$
  );
end;
$$;

insert into concurrent_actor_results
select actor_id
from extensions.dblink_get_result('ensure_actor_one') as result(actor_id uuid);
insert into concurrent_actor_results
select actor_id
from extensions.dblink_get_result('ensure_actor_two') as result(actor_id uuid);

select is(
  (
    select count(*)
    from public.actors
    where auth_subject = '00000000-0000-4000-8000-000000000009'
  ),
  1::bigint,
  'dos llamadas concurrentes crean un solo Actor'
);
select is(
  (select count(distinct actor_id) from concurrent_actor_results),
  1::bigint,
  'ambas llamadas concurrentes reciben el mismo Actor'
);

do $$
begin
  perform extensions.dblink_disconnect('ensure_actor_one');
  perform extensions.dblink_disconnect('ensure_actor_two');
end;
$$;
drop table concurrent_actor_results;
drop function private.test_concurrent_ensure_actor(uuid);
delete from public.actors
where auth_subject = '00000000-0000-4000-8000-000000000009';
delete from auth.users
where id = '00000000-0000-4000-8000-000000000009';

begin;

select ok(to_regclass('public.actors') is not null, 'existe Actor');
select ok(to_regclass('public.profiles') is not null, 'existe Profile');
select ok(to_regclass('public.profile_access') is not null, 'existe ProfileAccess');
select ok(to_regclass('public.device_sessions') is not null, 'existe DeviceSession');
select ok(to_regclass('private.invitations') is not null, 'existe Invitation interna');
select ok(
  to_regclass('private.private_access_codes') is not null,
  'existe PrivateAccessCode interno'
);
select ok(
  to_regclass('private.technical_audit_events') is not null,
  'existe TechnicalAuditEvent interno'
);
select ok(to_regclass('private.deletion_jobs') is not null, 'existe DeletionJob');
select ok(
  to_regprocedure('private.ensure_actor()') is not null,
  'existe ensure_actor sin argumentos'
);
select ok(
  to_regprocedure('private.ensure_actor(uuid)') is null
    and to_regprocedure('private.ensure_actor(uuid, text)') is null,
  'ensure_actor no acepta sujeto ni rol del cliente'
);
select is(
  private.normalize_alias('  JOSE   PENA  '),
  'jose pena',
  'Postgres normaliza espacios y mayúsculas de alias ASCII'
);

select ok(
  (
    select bool_and(c.relrowsecurity)
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname in ('actors', 'profiles', 'profile_access', 'device_sessions')
  ),
  'RLS está activo en todas las tablas públicas de identidad'
);
select ok(
  has_table_privilege('authenticated', 'public.profiles', 'SELECT'),
  'authenticated solo recibe lectura explícita de perfiles'
);
select ok(
  not has_table_privilege('anon', 'public.profiles', 'SELECT'),
  'anon no puede leer perfiles'
);
select ok(
  not has_table_privilege('authenticated', 'public.actors', 'UPDATE')
    and not has_table_privilege('authenticated', 'public.profile_access', 'INSERT')
    and not has_table_privilege(
      'authenticated',
      'private.technical_audit_events',
      'INSERT'
    ),
  'el cliente no puede editar roles, membresías ni auditoría'
);
select ok(
  not has_table_privilege('service_role', 'public.profiles', 'DELETE')
    and not has_table_privilege(
      'service_role',
      'private.technical_audit_events',
      'UPDATE'
    )
    and not has_table_privilege(
      'service_role',
      'private.technical_audit_events',
      'DELETE'
    ),
  'el servicio no puede saltarse la purga ni reescribir auditoría'
);
select ok(
  has_function_privilege('authenticated', 'private.ensure_actor()', 'EXECUTE')
    and not has_function_privilege('anon', 'private.ensure_actor()', 'EXECUTE'),
  'ensure_actor solo es ejecutable por authenticated'
);
select ok(
  not exists (
    select 1
    from pg_proc p
    cross join lateral aclexplode(
      coalesce(p.proacl, acldefault('f', p.proowner))
    ) acl
    where p.oid = 'private.ensure_actor()'::regprocedure
      and acl.grantee = 0
      and acl.privilege_type = 'EXECUTE'
  ),
  'PUBLIC no conserva EXECUTE sobre ensure_actor'
);

insert into auth.users (
  instance_id,
  id,
  aud,
  role,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at,
  is_anonymous
)
values
  (
    '00000000-0000-0000-0000-000000000000',
    '00000000-0000-4000-8000-000000000001',
    'authenticated',
    'authenticated',
    '{"provider":"anonymous","providers":["anonymous"]}'::jsonb,
    '{}'::jsonb,
    now(),
    now(),
    true
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '00000000-0000-4000-8000-000000000002',
    'authenticated',
    'authenticated',
    '{"provider":"anonymous","providers":["anonymous"]}'::jsonb,
    '{}'::jsonb,
    now(),
    now(),
    true
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '00000000-0000-4000-8000-000000000003',
    'authenticated',
    'authenticated',
    '{"provider":"anonymous","providers":["anonymous"]}'::jsonb,
    '{}'::jsonb,
    now(),
    now(),
    true
  );

set local role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated"}', true);
select throws_ok(
  $$ select private.ensure_actor() $$,
  '22023',
  'auth_uid_required',
  'ensure_actor rechaza UID nulo'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"21000000-0000-4000-8000-000000000001"}',
  true
);
select lives_ok($$ select private.ensure_actor() $$, 'ensure_actor crea el Actor A');
select is(
  private.ensure_actor(),
  private.ensure_actor(),
  'ensure_actor es idempotente'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-000000000002","role":"authenticated","session_id":"21000000-0000-4000-8000-000000000002"}',
  true
);
select lives_ok($$ select private.ensure_actor() $$, 'ensure_actor crea el Actor B');

select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-000000000003","role":"authenticated","session_id":"21000000-0000-4000-8000-000000000003"}',
  true
);
select lives_ok($$ select private.ensure_actor() $$, 'ensure_actor crea el Actor C');
reset role;

select is(
  (
    select role
    from public.actors
    where auth_subject = '00000000-0000-4000-8000-000000000001'
  ),
  'device',
  'ensure_actor nunca autoasigna superadministrador'
);

update public.actors
set disabled_at = now()
where auth_subject = '00000000-0000-4000-8000-000000000003';
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-000000000003","role":"authenticated","session_id":"21000000-0000-4000-8000-000000000003"}',
  true
);
select throws_ok(
  $$ select private.ensure_actor() $$,
  '55000',
  'actor_disabled',
  'ensure_actor rechaza un Actor deshabilitado'
);
reset role;

select throws_ok(
  $$
    insert into public.actors (auth_subject)
    values ('00000000-0000-4000-8000-000000000001')
  $$,
  '23505',
  null,
  'auth_subject es único'
);
select throws_ok(
  $$ insert into public.actors (auth_subject) values (null) $$,
  '23502',
  null,
  'auth_subject es obligatorio'
);
select throws_ok(
  $$
    insert into public.actors (auth_subject)
    values ('00000000-0000-4000-8000-000000000099')
  $$,
  '23503',
  null,
  'Actor exige un usuario Auth real'
);

select throws_ok(
  $$
    insert into public.profiles (alias, timezone, adult_attested_at)
    values ('José Pena', 'Europe/Madrid', '2026-01-01T00:00:00Z')
  $$,
  '23514',
  null,
  'Profile rechaza alias con tilde'
);
select throws_ok(
  $$
    insert into public.profiles (alias, timezone, adult_attested_at)
    values ('Jose Peña', 'Europe/Madrid', '2026-01-01T00:00:00Z')
  $$,
  '23514',
  null,
  'Profile rechaza alias con eñe'
);
select throws_ok(
  $$
    insert into public.profiles (alias, timezone, adult_attested_at)
    values ('Pablo!', 'Europe/Madrid', '2026-01-01T00:00:00Z')
  $$,
  '23514',
  null,
  'Profile rechaza caracteres fuera de la lista permitida'
);

insert into public.profiles (
  id,
  alias,
  timezone,
  adult_attested_at
)
values
  (
    '10000000-0000-4000-8000-000000000001',
    'Perfil_A-1',
    'Europe/Madrid',
    '2026-01-01T00:00:00Z'
  ),
  (
    '10000000-0000-4000-8000-000000000002',
    'Perfil secundario',
    'Europe/Madrid',
    '2026-01-01T00:00:00Z'
  ),
  (
    '10000000-0000-4000-8000-000000000004',
    'Perfil B',
    'Europe/Madrid',
    '2026-01-01T00:00:00Z'
  );

insert into public.device_sessions (
  id,
  actor_id,
  auth_session_id,
  label,
  created_at,
  last_seen_at,
  idle_expires_at,
  absolute_expires_at
)
values
  (
    '20000000-0000-4000-8000-000000000001',
    (
      select id from public.actors
      where auth_subject = '00000000-0000-4000-8000-000000000001'
    ),
    '21000000-0000-4000-8000-000000000001',
    'Dispositivo A',
    '2026-01-01T00:00:00Z',
    '2026-01-01T00:00:00Z',
    '2098-01-01T00:00:00Z',
    '2099-01-01T00:00:00Z'
  ),
  (
    '20000000-0000-4000-8000-000000000002',
    (
      select id from public.actors
      where auth_subject = '00000000-0000-4000-8000-000000000002'
    ),
    '21000000-0000-4000-8000-000000000002',
    'Dispositivo B',
    '2026-01-01T00:00:00Z',
    '2026-01-01T00:00:00Z',
    '2098-01-01T00:00:00Z',
    '2099-01-01T00:00:00Z'
  );

insert into public.profile_access (id, profile_id, actor_id)
values
  (
    '30000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000001',
    (
      select id from public.actors
      where auth_subject = '00000000-0000-4000-8000-000000000001'
    )
  ),
  (
    '30000000-0000-4000-8000-000000000002',
    '10000000-0000-4000-8000-000000000002',
    (
      select id from public.actors
      where auth_subject = '00000000-0000-4000-8000-000000000001'
    )
  );

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"21000000-0000-4000-8000-000000000001"}',
  true
);
select is(
  (select count(*) from public.profiles),
  2::bigint,
  'A lee únicamente sus dos perfiles con membresía activa'
);
reset role;

update public.device_sessions
set idle_expires_at = '2026-01-02T00:00:00Z'
where id = '20000000-0000-4000-8000-000000000001';
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"21000000-0000-4000-8000-000000000001"}',
  true
);
select is(
  (select count(*) from public.profiles),
  0::bigint,
  'una DeviceSession expirada corta el acceso aunque el JWT siga vigente'
);
reset role;

update public.device_sessions
set idle_expires_at = '2098-01-01T00:00:00Z',
    revoked_at = now()
where id = '20000000-0000-4000-8000-000000000001';
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"21000000-0000-4000-8000-000000000001"}',
  true
);
select is(
  (select count(*) from public.profiles),
  0::bigint,
  'una DeviceSession revocada corta el acceso aunque el JWT siga vigente'
);
reset role;

update public.device_sessions
set revoked_at = null
where id = '20000000-0000-4000-8000-000000000001';

update public.actors
set disabled_at = now()
where auth_subject = '00000000-0000-4000-8000-000000000001';
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"21000000-0000-4000-8000-000000000001"}',
  true
);
select is(
  (select count(*) from public.profiles),
  0::bigint,
  'un Actor deshabilitado pierde todos sus accesos'
);
reset role;

update public.actors
set disabled_at = null
where auth_subject = '00000000-0000-4000-8000-000000000001';

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-000000000002","role":"authenticated","session_id":"21000000-0000-4000-8000-000000000002"}',
  true
);
select is(
  (
    select count(*)
    from public.profiles
    where id = '10000000-0000-4000-8000-000000000001'
  ),
  0::bigint,
  'B no lee el perfil de A aunque conozca su UUID'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"21000000-0000-4000-8000-000000000099"}',
  true
);
select is(
  (select count(*) from public.profiles),
  0::bigint,
  'un JWT de otra sesión no reutiliza la membresía del Actor'
);
reset role;

update public.profile_access
set revoked_at = now(),
    revoked_by = (
      select id from public.actors
      where auth_subject = '00000000-0000-4000-8000-000000000001'
    )
where id = '30000000-0000-4000-8000-000000000001';

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"21000000-0000-4000-8000-000000000001"}',
  true
);
select is(
  (select count(*) from public.profiles),
  1::bigint,
  'revocar una membresía corta ese perfil y conserva la segunda'
);
reset role;

update public.profiles
set status = 'deletion_requested',
    deletion_requested_at = now()
where id = '10000000-0000-4000-8000-000000000002';

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"21000000-0000-4000-8000-000000000001"}',
  true
);
select is(
  (select count(*) from public.profiles),
  0::bigint,
  'deletion_requested bloquea el acceso ordinario'
);
reset role;

insert into public.profile_access (id, profile_id, actor_id)
values (
  '30000000-0000-4000-8000-000000000004',
  '10000000-0000-4000-8000-000000000004',
  (
    select id from public.actors
    where auth_subject = '00000000-0000-4000-8000-000000000002'
  )
);
select throws_ok(
  $$
    insert into public.profile_access (profile_id, actor_id)
    values (
      '10000000-0000-4000-8000-000000000004',
      (
        select id from public.actors
        where auth_subject = '00000000-0000-4000-8000-000000000002'
      )
    )
  $$,
  '23505',
  null,
  'no admite dos membresías activas para el mismo actor y perfil'
);
update public.profile_access
set revoked_at = now()
where id = '30000000-0000-4000-8000-000000000004';
select lives_ok(
  $$
    insert into public.profile_access (profile_id, actor_id)
    values (
      '10000000-0000-4000-8000-000000000004',
      (
        select id from public.actors
        where auth_subject = '00000000-0000-4000-8000-000000000002'
      )
    )
  $$,
  'permite una nueva membresía después de revocar la anterior'
);
select throws_ok(
  $$
    insert into public.profile_access (
      profile_id,
      actor_id,
      created_at,
      revoked_at
    )
    values (
      '10000000-0000-4000-8000-000000000001',
      (
        select id from public.actors
        where auth_subject = '00000000-0000-4000-8000-000000000002'
      ),
      '2026-01-02T00:00:00Z',
      '2026-01-01T00:00:00Z'
    )
  $$,
  '23514',
  null,
  'rechaza una revocación anterior a la membresía'
);
select throws_ok(
  $$
    insert into public.profile_access (profile_id, actor_id)
    values (
      '10000000-0000-4000-8000-000000000099',
      (
        select id from public.actors
        where auth_subject = '00000000-0000-4000-8000-000000000002'
      )
    )
  $$,
  '23503',
  null,
  'ProfileAccess exige un Profile real'
);
select throws_ok(
  $$
    insert into public.profile_access (profile_id, actor_id)
    values ('10000000-0000-4000-8000-000000000001', null)
  $$,
  '23502',
  null,
  'ProfileAccess exige Actor'
);

select throws_ok(
  $$
    insert into public.device_sessions (
      actor_id,
      auth_session_id,
      label,
      created_at,
      last_seen_at,
      idle_expires_at,
      absolute_expires_at
    )
    values (
      (
        select id from public.actors
        where auth_subject = '00000000-0000-4000-8000-000000000002'
      ),
      '21000000-0000-4000-8000-000000000022',
      'Duplicada',
      '2026-01-01T00:00:00Z',
      '2026-01-01T00:00:00Z',
      '2098-01-01T00:00:00Z',
      '2099-01-01T00:00:00Z'
    )
  $$,
  '23505',
  null,
  'solo existe una DeviceSession activa por Actor'
);
select throws_ok(
  $$
    insert into public.device_sessions (
      actor_id,
      auth_session_id,
      label,
      created_at,
      last_seen_at,
      idle_expires_at,
      absolute_expires_at,
      revoked_at
    )
    values (
      (
        select id from public.actors
        where auth_subject = '00000000-0000-4000-8000-000000000003'
      ),
      '21000000-0000-4000-8000-000000000033',
      'Fechas inversas',
      '2026-01-01T00:00:00Z',
      '2098-06-01T00:00:00Z',
      '2098-01-01T00:00:00Z',
      '2099-01-01T00:00:00Z',
      '2098-07-01T00:00:00Z'
    )
  $$,
  '23514',
  null,
  'DeviceSession rechaza timestamps inversos'
);

select throws_ok(
  $$
    insert into private.invitations (
      token_hash,
      created_at,
      expires_at,
      created_by
    )
    values (
      decode(repeat('aa', 32), 'hex'),
      '2026-01-02T00:00:00Z',
      '2026-01-01T00:00:00Z',
      (
        select id from public.actors
        where auth_subject = '00000000-0000-4000-8000-000000000001'
      )
    )
  $$,
  '23514',
  null,
  'Invitation rechaza expiración anterior a creación'
);

insert into public.profiles (
  id,
  alias,
  timezone,
  adult_attested_at
)
values (
  '10000000-0000-4000-8000-000000000003',
  'Jose Pena',
  'Europe/Madrid',
  '2026-01-01T00:00:00Z'
);
select throws_ok(
  $$
    insert into public.profiles (alias, timezone, adult_attested_at)
    values (' JOSE   PENA ', 'Europe/Madrid', '2026-01-01T00:00:00Z')
  $$,
  '23505',
  null,
  'mayúsculas y espacios no crean un alias distinto'
);
update public.profiles
set status = 'deletion_requested',
    deletion_requested_at = now()
where id = '10000000-0000-4000-8000-000000000003';
select throws_ok(
  $$
    insert into public.profiles (alias, timezone, adult_attested_at)
    values ('JOSE PENA', 'Europe/Madrid', '2026-01-01T00:00:00Z')
  $$,
  '23505',
  null,
  'deletion_requested conserva reservado el alias'
);

insert into public.profiles (
  id,
  alias,
  timezone,
  adult_attested_at
)
values (
  '10000000-0000-4000-8000-000000000005',
  'Perfil todavia activo',
  'Europe/Madrid',
  '2026-01-01T00:00:00Z'
);
insert into private.deletion_jobs (
  id,
  profile_id,
  profile_marker,
  request_handle_hash,
  requester_actor_id,
  confirmed_by
)
values (
  '40000000-0000-4000-8000-000000000005',
  '10000000-0000-4000-8000-000000000005',
  decode(repeat('dd', 32), 'hex'),
  decode(repeat('ee', 32), 'hex'),
  (
    select id from public.actors
    where auth_subject = '00000000-0000-4000-8000-000000000001'
  ),
  (
    select id from public.actors
    where auth_subject = '00000000-0000-4000-8000-000000000001'
  )
);
select throws_ok(
  $$
    update private.deletion_jobs
    set status = 'purged', completed_at = now()
    where id = '40000000-0000-4000-8000-000000000005'
  $$,
  '55000',
  'profile_not_deletion_requested',
  'DeletionJob no puede purgar un Profile todavía activo'
);
select ok(
  exists (
    select 1 from public.profiles
    where id = '10000000-0000-4000-8000-000000000005'
  ),
  'una purga rechazada conserva el Profile activo'
);

insert into private.deletion_jobs (
  id,
  profile_id,
  profile_marker,
  request_handle_hash,
  requester_actor_id,
  confirmed_by
)
values (
  '40000000-0000-4000-8000-000000000003',
  '10000000-0000-4000-8000-000000000003',
  decode(repeat('bb', 32), 'hex'),
  decode(repeat('cc', 32), 'hex'),
  (
    select id from public.actors
    where auth_subject = '00000000-0000-4000-8000-000000000001'
  ),
  (
    select id from public.actors
    where auth_subject = '00000000-0000-4000-8000-000000000001'
  )
);
update private.deletion_jobs
set status = 'purged',
    completed_at = now()
where id = '40000000-0000-4000-8000-000000000003';
select ok(
  not exists (
    select 1 from public.profiles
    where id = '10000000-0000-4000-8000-000000000003'
  ),
  'DeletionJob purged elimina el Profile'
);
select ok(
  (
    select profile_id is null
    from private.deletion_jobs
    where id = '40000000-0000-4000-8000-000000000003'
  ),
  'DeletionJob terminal sobrevive con profile_id nulo'
);
select lives_ok(
  $$
    insert into public.profiles (alias, timezone, adult_attested_at)
    values ('JOSE PENA', 'Europe/Madrid', '2026-01-01T00:00:00Z')
  $$,
  'el alias vuelve a estar disponible únicamente después de purged'
);

select * from finish();
rollback;
