create extension if not exists dblink with schema extensions;

select no_plan();

-- Carrera real en dos conexiones: el QR solo puede producir una membresía.
drop function if exists private.test_try_consume_qr(
  uuid, uuid, uuid, uuid, bytea, bytea
);

delete from private.access_idempotency
where actor_id in (
  select id from public.actors
  where auth_subject in (
    '00000000-0000-4000-8000-000000009101',
    '00000000-0000-4000-8000-000000009102',
    '00000000-0000-4000-8000-000000009103'
  )
);
delete from private.qr_grants
where id = '71000000-0000-4000-8000-000000009101';
delete from public.profile_access
where profile_id = '51000000-0000-4000-8000-000000009101';
delete from public.device_sessions
where actor_id in (
  select id from public.actors
  where auth_subject in (
    '00000000-0000-4000-8000-000000009101',
    '00000000-0000-4000-8000-000000009102',
    '00000000-0000-4000-8000-000000009103'
  )
);
delete from public.actors
where auth_subject in (
  '00000000-0000-4000-8000-000000009101',
  '00000000-0000-4000-8000-000000009102',
  '00000000-0000-4000-8000-000000009103'
);
delete from public.profiles
where id = '51000000-0000-4000-8000-000000009101';
delete from auth.users
where id in (
  '00000000-0000-4000-8000-000000009101',
  '00000000-0000-4000-8000-000000009102',
  '00000000-0000-4000-8000-000000009103'
);

insert into auth.users (
  instance_id, id, aud, role, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at, is_anonymous
)
values
  (
    '00000000-0000-0000-0000-000000000000',
    '00000000-0000-4000-8000-000000009101',
    'authenticated', 'authenticated',
    '{"provider":"anonymous","providers":["anonymous"]}'::jsonb,
    '{}'::jsonb, now(), now(), true
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '00000000-0000-4000-8000-000000009102',
    'authenticated', 'authenticated',
    '{"provider":"anonymous","providers":["anonymous"]}'::jsonb,
    '{}'::jsonb, now(), now(), true
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '00000000-0000-4000-8000-000000009103',
    'authenticated', 'authenticated',
    '{"provider":"anonymous","providers":["anonymous"]}'::jsonb,
    '{}'::jsonb, now(), now(), true
  );

insert into auth.sessions (id, user_id, created_at, updated_at, aal)
values
  (
    '21000000-0000-4000-8000-000000009101',
    '00000000-0000-4000-8000-000000009101', now(), now(), 'aal1'
  ),
  (
    '21000000-0000-4000-8000-000000009102',
    '00000000-0000-4000-8000-000000009102', now(), now(), 'aal1'
  ),
  (
    '21000000-0000-4000-8000-000000009103',
    '00000000-0000-4000-8000-000000009103', now(), now(), 'aal1'
  );

insert into public.actors (id, auth_subject)
values (
  '31000000-0000-4000-8000-000000009101',
  '00000000-0000-4000-8000-000000009101'
);
insert into public.profiles (id, alias, timezone, adult_attested_at)
values (
  '51000000-0000-4000-8000-000000009101',
  'Carrera QR', 'Europe/Madrid', now()
);
insert into public.profile_access (id, profile_id, actor_id)
values (
  '61000000-0000-4000-8000-000000009101',
  '51000000-0000-4000-8000-000000009101',
  '31000000-0000-4000-8000-000000009101'
);
insert into public.device_sessions (
  id, actor_id, auth_session_id, label, created_at, last_seen_at,
  idle_expires_at, absolute_expires_at
)
values (
  '41000000-0000-4000-8000-000000009101',
  '31000000-0000-4000-8000-000000009101',
  '21000000-0000-4000-8000-000000009101',
  'Emisor', now(), now(), now() + interval '30 days', now() + interval '180 days'
);
insert into private.qr_grants (
  id, profile_id, token_hash, issued_by_actor, expires_at
)
values (
  '71000000-0000-4000-8000-000000009101',
  '51000000-0000-4000-8000-000000009101',
  decode(repeat('a1', 32), 'hex'),
  '31000000-0000-4000-8000-000000009101',
  now() + interval '5 minutes'
);

create function private.test_try_consume_qr(
  p_auth_subject uuid,
  p_auth_session_id uuid,
  p_device_session_id uuid,
  p_profile_access_id uuid,
  p_idempotency_key_digest bytea,
  p_request_digest bytea
)
returns text
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  perform private.consume_qr_grant(
    p_auth_subject,
    p_auth_session_id,
    p_device_session_id,
    p_profile_access_id,
    decode(repeat('a1', 32), 'hex'),
    p_idempotency_key_digest,
    p_request_digest,
    'Consumidor QR',
    repeat('A', 22),
    repeat('B', 16)
  );
  return 'ok';
exception when others then
  return sqlstate;
end;
$$;

create temporary table concurrent_qr_results (result text not null);

do $$
declare
  connection_string text := format(
    'hostaddr=%s port=%s dbname=%s user=postgres password=postgres',
    inet_server_addr(), inet_server_port(), current_database()
  );
begin
  perform extensions.dblink_connect('qr_consumer_one', connection_string);
  perform extensions.dblink_connect('qr_consumer_two', connection_string);
  perform extensions.dblink_send_query(
    'qr_consumer_one',
    $query$
      with barrier as materialized (select pg_sleep(0.25))
      select private.test_try_consume_qr(
        '00000000-0000-4000-8000-000000009102',
        '21000000-0000-4000-8000-000000009102',
        '41000000-0000-4000-8000-000000009102',
        '61000000-0000-4000-8000-000000009102',
        decode(repeat('b1', 32), 'hex'),
        decode(repeat('c1', 32), 'hex')
      ) from barrier
    $query$
  );
  perform extensions.dblink_send_query(
    'qr_consumer_two',
    $query$
      with barrier as materialized (select pg_sleep(0.25))
      select private.test_try_consume_qr(
        '00000000-0000-4000-8000-000000009103',
        '21000000-0000-4000-8000-000000009103',
        '41000000-0000-4000-8000-000000009103',
        '61000000-0000-4000-8000-000000009103',
        decode(repeat('b2', 32), 'hex'),
        decode(repeat('c2', 32), 'hex')
      ) from barrier
    $query$
  );
end;
$$;

insert into concurrent_qr_results
select result
from extensions.dblink_get_result('qr_consumer_one') as response(result text);
insert into concurrent_qr_results
select result
from extensions.dblink_get_result('qr_consumer_two') as response(result text);

select is(
  (select count(*) from concurrent_qr_results where result = 'ok'),
  1::bigint,
  'dos consumos concurrentes del QR producen un único éxito'
);
select is(
  (select count(*) from concurrent_qr_results where result = '28000'),
  1::bigint,
  'el segundo consumo concurrente recibe una denegación genérica'
);
select is(
  (
    select count(*) from public.profile_access
    where profile_id = '51000000-0000-4000-8000-000000009101'
      and actor_id <> '31000000-0000-4000-8000-000000009101'
      and revoked_at is null
  ),
  1::bigint,
  'la carrera QR crea exactamente una membresía adicional'
);
select is(
  (
    select count(*) from private.qr_grants
    where id = '71000000-0000-4000-8000-000000009101'
      and consumed_at is not null and consumed_by_actor is not null
  ),
  1::bigint,
  'el QR queda consumido de forma atómica'
);

do $$
begin
  perform extensions.dblink_disconnect('qr_consumer_one');
  perform extensions.dblink_disconnect('qr_consumer_two');
end;
$$;
drop table concurrent_qr_results;
drop function private.test_try_consume_qr(uuid, uuid, uuid, uuid, bytea, bytea);

delete from private.access_idempotency
where actor_id in (
  select id from public.actors
  where auth_subject in (
    '00000000-0000-4000-8000-000000009101',
    '00000000-0000-4000-8000-000000009102',
    '00000000-0000-4000-8000-000000009103'
  )
);
delete from private.qr_grants
where id = '71000000-0000-4000-8000-000000009101';
delete from public.profile_access
where profile_id = '51000000-0000-4000-8000-000000009101';
delete from public.device_sessions
where actor_id in (
  select id from public.actors
  where auth_subject in (
    '00000000-0000-4000-8000-000000009101',
    '00000000-0000-4000-8000-000000009102',
    '00000000-0000-4000-8000-000000009103'
  )
);
delete from public.actors
where auth_subject in (
  '00000000-0000-4000-8000-000000009101',
  '00000000-0000-4000-8000-000000009102',
  '00000000-0000-4000-8000-000000009103'
);
delete from public.profiles
where id = '51000000-0000-4000-8000-000000009101';
delete from auth.users
where id in (
  '00000000-0000-4000-8000-000000009101',
  '00000000-0000-4000-8000-000000009102',
  '00000000-0000-4000-8000-000000009103'
);

begin;

select ok(to_regclass('private.qr_grants') is not null, 'existe QrGrant privado');
select ok(
  to_regclass('private.access_rate_limit_events') is not null,
  'existen contadores privados de abuso'
);
select ok(
  to_regclass('private.access_idempotency') is not null,
  'existe journal privado de idempotencia'
);
select ok(
  to_regprocedure(
    'private.redeem_invitation(uuid,uuid,uuid,uuid,uuid,bytea,text,text,timestamptz,text,bytea,integer,bytea,bytea,text,text)'
  ) is not null,
  'el canje transaccional existe y solo es interno'
);
select ok(
  to_regprocedure(
    'private.consume_qr_grant(uuid,uuid,uuid,uuid,bytea,bytea,bytea,text,text,text)'
  ) is not null,
  'el consumo QR transaccional existe'
);
select ok(
  to_regprocedure(
    'private.rotate_private_access_code(uuid,uuid,uuid,uuid,bytea,boolean,bytea,bytea,text,text)'
  ) is not null,
  'la rotación transaccional existe'
);
select ok(
  not has_table_privilege('authenticated', 'private.qr_grants', 'SELECT')
    and not has_table_privilege(
      'authenticated', 'private.private_access_codes', 'SELECT'
    ),
  'el cliente no puede leer hashes de QR o códigos'
);
select ok(
  not exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    cross join lateral aclexplode(
      coalesce(p.proacl, acldefault('f', p.proowner))
    ) acl
    where n.nspname = 'private'
      and p.proname in (
        'redeem_invitation', 'consume_qr_grant', 'rotate_private_access_code'
      )
      and (
        acl.grantee = 0
        or acl.grantee in (
          (select oid from pg_roles where rolname = 'anon'),
          (select oid from pg_roles where rolname = 'authenticated')
        )
      )
      and acl.privilege_type = 'EXECUTE'
  ),
  'las mutaciones internas no son invocables por navegador'
);

insert into auth.users (
  instance_id, id, aud, role, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at, is_anonymous
)
values
  (
    '00000000-0000-0000-0000-000000000000',
    '00000000-0000-4000-8000-000000001101',
    'authenticated', 'authenticated',
    '{"provider":"anonymous","providers":["anonymous"]}'::jsonb,
    '{}'::jsonb, now(), now(), true
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '00000000-0000-4000-8000-000000001102',
    'authenticated', 'authenticated',
    '{"provider":"anonymous","providers":["anonymous"]}'::jsonb,
    '{}'::jsonb, now(), now(), true
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '00000000-0000-4000-8000-000000001103',
    'authenticated', 'authenticated',
    '{"provider":"anonymous","providers":["anonymous"]}'::jsonb,
    '{}'::jsonb, now() - interval '2 days', now(), true
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '00000000-0000-4000-8000-000000001104',
    'authenticated', 'authenticated',
    '{"provider":"anonymous","providers":["anonymous"]}'::jsonb,
    '{}'::jsonb, now() - interval '200 days', now(), true
  );

insert into auth.sessions (id, user_id, created_at, updated_at, aal)
values
  (
    '21000000-0000-4000-8000-000000001101',
    '00000000-0000-4000-8000-000000001101', now(), now(), 'aal1'
  ),
  (
    '21000000-0000-4000-8000-000000001102',
    '00000000-0000-4000-8000-000000001102', now(), now(), 'aal1'
  ),
  (
    '21000000-0000-4000-8000-000000001104',
    '00000000-0000-4000-8000-000000001104',
    now() - interval '200 days', now(), 'aal1'
  );

insert into public.actors (id, auth_subject, role)
values (
  '31000000-0000-4000-8000-000000001101',
  '00000000-0000-4000-8000-000000001101',
  'superadmin'
);
insert into private.invitations (
  id, token_hash, created_at, expires_at, created_by
)
values
  (
    '71000000-0000-4000-8000-000000001101',
    decode(repeat('11', 32), 'hex'), now(), now() + interval '1 day',
    '31000000-0000-4000-8000-000000001101'
  ),
  (
    '71000000-0000-4000-8000-000000001102',
    decode(repeat('12', 32), 'hex'),
    now() - interval '1 day', now() - interval '1 second',
    '31000000-0000-4000-8000-000000001101'
  ),
  (
    '71000000-0000-4000-8000-000000001103',
    decode(repeat('13', 32), 'hex'), now(), now() + interval '1 day',
    '31000000-0000-4000-8000-000000001101'
  );
update private.invitations
set revoked_at = now()
where id = '71000000-0000-4000-8000-000000001103';

select lives_ok(
  $$
    select private.redeem_invitation(
      '00000000-0000-4000-8000-000000001102',
      '21000000-0000-4000-8000-000000001102',
      '41000000-0000-4000-8000-000000001102',
      '51000000-0000-4000-8000-000000001101',
      '61000000-0000-4000-8000-000000001101',
      decode(repeat('11', 32), 'hex'),
      'Pablo Salud', 'Europe/Madrid', now(), 'Portatil',
      decode(repeat('21', 32), 'hex'), 1,
      decode(repeat('31', 32), 'hex'),
      decode(repeat('41', 32), 'hex'),
      repeat('A', 22), repeat('B', 16)
    )
  $$,
  'una invitación válida crea perfil, membresía, sesión y código'
);
select is(
  (
    select count(*) from public.profiles
    where id = '51000000-0000-4000-8000-000000001101'
  ),
  1::bigint,
  'el canje crea un solo perfil'
);
select is(
  (
    select count(*) from private.invitations
    where id = '71000000-0000-4000-8000-000000001101'
      and consumed_at is not null
  ),
  1::bigint,
  'la invitación queda consumida'
);
select is(
  (
    select count(*) from private.private_access_codes
    where profile_id = '51000000-0000-4000-8000-000000001101'
      and revoked_at is null
  ),
  1::bigint,
  'el código privado se almacena solo como digest activo'
);

select lives_ok(
  $$
    select private.redeem_invitation(
      '00000000-0000-4000-8000-000000001102',
      '21000000-0000-4000-8000-000000001102',
      '41000000-0000-4000-8000-000000001102',
      '51000000-0000-4000-8000-000000001101',
      '61000000-0000-4000-8000-000000001101',
      decode(repeat('11', 32), 'hex'),
      'Pablo Salud', 'Europe/Madrid', now(), 'Portatil',
      decode(repeat('21', 32), 'hex'), 1,
      decode(repeat('31', 32), 'hex'),
      decode(repeat('41', 32), 'hex'),
      repeat('A', 22), repeat('B', 16)
    )
  $$,
  'repetir la misma petición idempotente devuelve el resultado previo'
);
select is(
  (
    select count(*) from public.profile_access
    where profile_id = '51000000-0000-4000-8000-000000001101'
  ),
  1::bigint,
  'el replay idempotente no duplica la membresía'
);
select throws_ok(
  $$
    select private.redeem_invitation(
      '00000000-0000-4000-8000-000000001102',
      '21000000-0000-4000-8000-000000001102',
      '41000000-0000-4000-8000-000000001102',
      '51000000-0000-4000-8000-000000001109',
      '61000000-0000-4000-8000-000000001109',
      decode(repeat('11', 32), 'hex'),
      'Otro Perfil', 'Europe/Madrid', now(), 'Portatil',
      decode(repeat('22', 32), 'hex'), 1,
      decode(repeat('32', 32), 'hex'),
      decode(repeat('42', 32), 'hex'),
      repeat('C', 22), repeat('D', 16)
    )
  $$,
  '28000', 'access_not_granted',
  'una invitación consumida no puede reutilizarse con otra petición'
);
select throws_ok(
  $$
    select private.redeem_invitation(
      '00000000-0000-4000-8000-000000001102',
      '21000000-0000-4000-8000-000000001102',
      '41000000-0000-4000-8000-000000001102',
      '51000000-0000-4000-8000-000000001108',
      '61000000-0000-4000-8000-000000001108',
      decode(repeat('12', 32), 'hex'),
      'Expirada', 'Europe/Madrid', now(), 'Portatil',
      decode(repeat('23', 32), 'hex'), 1,
      decode(repeat('33', 32), 'hex'),
      decode(repeat('43', 32), 'hex'),
      repeat('E', 22), repeat('F', 16)
    )
  $$,
  '28000', 'access_not_granted',
  'una invitación expirada falla de forma genérica'
);
select throws_ok(
  $$
    select private.redeem_invitation(
      '00000000-0000-4000-8000-000000001102',
      '21000000-0000-4000-8000-000000001102',
      '41000000-0000-4000-8000-000000001102',
      '51000000-0000-4000-8000-000000001107',
      '61000000-0000-4000-8000-000000001107',
      decode(repeat('13', 32), 'hex'),
      'Revocada', 'Europe/Madrid', now(), 'Portatil',
      decode(repeat('24', 32), 'hex'), 1,
      decode(repeat('34', 32), 'hex'),
      decode(repeat('44', 32), 'hex'),
      repeat('G', 22), repeat('H', 16)
    )
  $$,
  '28000', 'access_not_granted',
  'una invitación revocada falla de forma genérica'
);

select lives_ok(
  $$
    select private.rotate_private_access_code(
      '00000000-0000-4000-8000-000000001102',
      '21000000-0000-4000-8000-000000001102',
      '51000000-0000-4000-8000-000000001101',
      '81000000-0000-4000-8000-000000001102',
      decode(repeat('25', 32), 'hex'), false,
      decode(repeat('35', 32), 'hex'),
      decode(repeat('45', 32), 'hex'),
      repeat('I', 22), repeat('J', 16)
    )
  $$,
  'la rotación conserva sesiones por defecto'
);
select is(
  (
    select count(*) from private.private_access_codes
    where profile_id = '51000000-0000-4000-8000-000000001101'
      and revoked_at is null
  ),
  1::bigint,
  'la rotación deja exactamente un código activo'
);
select is(
  (
    select count(*) from private.private_access_codes
    where profile_id = '51000000-0000-4000-8000-000000001101'
      and revoked_at is not null and rotated_at is not null
  ),
  1::bigint,
  'la rotación revoca atómicamente el código anterior'
);
select is(
  (
    select count(*) from public.device_sessions
    where id = '41000000-0000-4000-8000-000000001102'
      and revoked_at is null
  ),
  1::bigint,
  'rotar sin elección explícita mantiene la sesión'
);

-- Una segunda membresía demuestra que revocar un perfil no cierra el actor.
insert into public.profiles (id, alias, timezone, adult_attested_at)
values (
  '51000000-0000-4000-8000-000000001102',
  'Perfil Secundario', 'Europe/Madrid', now()
);
insert into public.profile_access (id, profile_id, actor_id)
select
  '61000000-0000-4000-8000-000000001102',
  '51000000-0000-4000-8000-000000001102',
  actor.id
from public.actors actor
where actor.auth_subject = '00000000-0000-4000-8000-000000001102';

select is(
  (
    select count(*) from private.list_actor_profiles(
      '00000000-0000-4000-8000-000000001102',
      '21000000-0000-4000-8000-000000001102'
    )
  ),
  2::bigint,
  'GET de perfiles solo materializa las dos membresías del actor'
);
select is(
  (
    select device_session_id from private.touch_device_session(
      '00000000-0000-4000-8000-000000001102',
      '21000000-0000-4000-8000-000000001102'
    )
  ),
  '41000000-0000-4000-8000-000000001102'::uuid,
  'el touch diario devuelve la única DeviceSession del actor'
);
select is(
  (
    select device_session_id from private.touch_device_session(
      '00000000-0000-4000-8000-000000001102',
      '21000000-0000-4000-8000-000000001102'
    )
  ),
  '41000000-0000-4000-8000-000000001102'::uuid,
  'repetir el touch el mismo día es idempotente'
);

-- El propio dispositivo revoca una de sus membresías y conserva la otra.
select lives_ok(
  $$
    select private.revoke_profile_session(
      '00000000-0000-4000-8000-000000001102',
      '21000000-0000-4000-8000-000000001102',
      '51000000-0000-4000-8000-000000001101',
      '41000000-0000-4000-8000-000000001102',
      decode(repeat('36', 32), 'hex'),
      decode(repeat('46', 32), 'hex'),
      repeat('K', 22), repeat('L', 16)
    )
  $$,
  'revocar un perfil no corta las otras membresías del dispositivo'
);
select is(
  (
    select count(*) from public.profile_access access
    join public.actors actor on actor.id = access.actor_id
    where actor.auth_subject = '00000000-0000-4000-8000-000000001102'
      and access.revoked_at is null
  ),
  1::bigint,
  'la otra membresía permanece activa'
);
select is(
  (
    select count(*) from public.device_sessions
    where id = '41000000-0000-4000-8000-000000001102'
      and revoked_at is null
  ),
  1::bigint,
  'la sesión global permanece activa mientras exista otra membresía'
);
select is(
  (
    select count(*) from auth.sessions
    where id = '21000000-0000-4000-8000-000000001102'
  ),
  1::bigint,
  'Auth conserva la sesión cuando queda otro perfil'
);

-- Cinco fallos en 15 minutos bloquean; treinta intentos por IP bloquean una hora.
do $$
declare
  v_event_id uuid;
  v_index integer;
begin
  for v_index in 1..5 loop
    select event_id into v_event_id
    from private.start_access_attempt(
      'code',
      decode(repeat('51', 32), 'hex'),
      decode(repeat('52', 32), 'hex'),
      decode(repeat('53', 32), 'hex'),
      true
    );
    perform private.finish_access_attempt(v_event_id, false);
  end loop;
end;
$$;
select is(
  (
    select decision from private.start_access_attempt(
      'code',
      decode(repeat('51', 32), 'hex'),
      decode(repeat('52', 32), 'hex'),
      decode(repeat('53', 32), 'hex'),
      true
    )
  ),
  'rate-limited',
  'cinco fallos en 15 minutos activan el límite'
);
select is(
  (
    select retry_after_seconds from private.start_access_attempt(
      'code',
      decode(repeat('51', 32), 'hex'),
      decode(repeat('52', 32), 'hex'),
      decode(repeat('53', 32), 'hex'),
      true
    )
  ),
  900,
  'el límite por fallos informa una ventana de 15 minutos'
);

do $$
declare
  v_event_id uuid;
  v_index integer;
begin
  for v_index in 1..30 loop
    select event_id into v_event_id
    from private.start_access_attempt(
      'qr',
      decode(repeat('61', 32), 'hex'),
      digest('subject-' || v_index::text, 'sha256'),
      digest('candidate-' || v_index::text, 'sha256'),
      true
    );
    perform private.finish_access_attempt(v_event_id, true);
  end loop;
end;
$$;
select is(
  (
    select decision from private.start_access_attempt(
      'qr',
      decode(repeat('61', 32), 'hex'),
      decode(repeat('62', 32), 'hex'),
      decode(repeat('63', 32), 'hex'),
      true
    )
  ),
  'rate-limited',
  'treinta intentos por IP en una hora activan el límite global'
);

-- El dry-run propone huérfanos, nunca actores con membresía o rol.
select is(
  (
    select count(*) from private.orphan_anonymous_candidates(now(), 100)
    where auth_subject = '00000000-0000-4000-8000-000000001103'
      and reason = 'abandoned_24_hours'
  ),
  1::bigint,
  'el dry-run incluye una identidad anónima huérfana elegible'
);
select is(
  (
    select count(*) from private.orphan_anonymous_candidates(now(), 100)
    where auth_subject in (
      '00000000-0000-4000-8000-000000001101',
      '00000000-0000-4000-8000-000000001102'
    )
  ),
  0::bigint,
  'el dry-run excluye superadministrador y actor con membresía'
);
select is(
  (
    select count(*) from private.orphan_anonymous_candidates(now(), 500)
  ) <= 100,
  true,
  'el lote de limpieza nunca supera cien identidades'
);

-- Expiración 30/180: cierre global y eliminación de la sesión Auth residual.
insert into public.actors (id, auth_subject)
values (
  '31000000-0000-4000-8000-000000001104',
  '00000000-0000-4000-8000-000000001104'
);
insert into public.profile_access (id, profile_id, actor_id)
values (
  '61000000-0000-4000-8000-000000001104',
  '51000000-0000-4000-8000-000000001102',
  '31000000-0000-4000-8000-000000001104'
);
insert into public.device_sessions (
  id, actor_id, auth_session_id, label, created_at, last_seen_at,
  idle_expires_at, absolute_expires_at
)
values (
  '41000000-0000-4000-8000-000000001104',
  '31000000-0000-4000-8000-000000001104',
  '21000000-0000-4000-8000-000000001104',
  'Antiguo', now() - interval '200 days', now() - interval '40 days',
  now() - interval '30 days', now() - interval '20 days'
);
select is(
  private.expire_device_sessions(now()),
  1,
  'el job de expiración cierra el actor vencido'
);
select is(
  (
    select count(*) from public.profile_access
    where actor_id = '31000000-0000-4000-8000-000000001104'
      and revoked_at is null
  ),
  0::bigint,
  'la expiración revoca todas sus membresías'
);
select is(
  (
    select count(*) from auth.sessions
    where user_id = '00000000-0000-4000-8000-000000001104'
  ),
  0::bigint,
  'la expiración elimina la sesión Auth y deja inútil el JWT residual por RLS'
);
select ok(
  (
    select disabled_at is not null from public.actors
    where id = '31000000-0000-4000-8000-000000001104'
  ),
  'la expiración deshabilita el actor de dispositivo'
);

select * from finish();
rollback;
