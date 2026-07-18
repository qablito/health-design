select no_plan();

create extension if not exists dblink with schema extensions;

-- Carrera real: dos primeras escrituras con claves distintas se serializan por perfil.
delete from public.profile_access
where profile_id = '51000000-0000-4000-8000-000000006199';
delete from public.device_sessions
where actor_id = '31000000-0000-4000-8000-000000006199';
delete from public.profiles
where id = '51000000-0000-4000-8000-000000006199';
delete from public.actors
where id = '31000000-0000-4000-8000-000000006199';
delete from auth.users
where id = '00000000-0000-4000-8000-000000006199';
drop function if exists private.test_concurrent_questionnaire_put(bytea, bytea);

insert into auth.users (
  instance_id, id, aud, role, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at, is_anonymous
) values (
  '00000000-0000-0000-0000-000000000000',
  '00000000-0000-4000-8000-000000006199',
  'authenticated', 'authenticated',
  '{"provider":"anonymous","providers":["anonymous"]}'::jsonb,
  '{}'::jsonb, now(), now(), true
);
insert into auth.sessions (id, user_id, created_at, updated_at, aal)
values (
  '21000000-0000-4000-8000-000000006199',
  '00000000-0000-4000-8000-000000006199', now(), now(), 'aal1'
);
insert into public.actors (id, auth_subject)
values (
  '31000000-0000-4000-8000-000000006199',
  '00000000-0000-4000-8000-000000006199'
);
insert into public.profiles (id, alias, timezone, adult_attested_at)
values (
  '51000000-0000-4000-8000-000000006199',
  'Cuestionario Carrera', 'Europe/Madrid', now()
);
insert into public.profile_access (id, profile_id, actor_id)
values (
  '61000000-0000-4000-8000-000000006199',
  '51000000-0000-4000-8000-000000006199',
  '31000000-0000-4000-8000-000000006199'
);
insert into public.device_sessions (
  id, actor_id, auth_session_id, label, created_at, last_seen_at,
  idle_expires_at, absolute_expires_at
) values (
  '41000000-0000-4000-8000-000000006199',
  '31000000-0000-4000-8000-000000006199',
  '21000000-0000-4000-8000-000000006199',
  'Carrera', now(), now(), now() + interval '30 days', now() + interval '180 days'
);

create function private.test_concurrent_questionnaire_put(
  p_key_digest bytea,
  p_request_digest bytea
)
returns text
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  perform public.internal_put_questionnaire_draft(
    '00000000-0000-4000-8000-000000006199',
    '21000000-0000-4000-8000-000000006199',
    '51000000-0000-4000-8000-000000006199',
    1, 0, '{"activeModules":["nutrition"]}'::jsonb,
    array['modules'], 'nutrition', 'provisional', '[]'::jsonb, '[]'::jsonb,
    p_key_digest, p_request_digest
  );
  return 'ok';
exception
  when sqlstate 'PT409' then return 'PT409';
  when serialization_failure then return '40001';
  when unique_violation then return '23505';
  when others then return sqlstate || ':' || sqlerrm;
end;
$$;

create temporary table concurrent_questionnaire_results (result text not null);

do $$
declare
  connection_string text := format(
    'hostaddr=%s port=%s dbname=%s user=postgres password=postgres',
    inet_server_addr(), inet_server_port(), current_database()
  );
begin
  perform extensions.dblink_connect('questionnaire_put_one', connection_string);
  perform extensions.dblink_connect('questionnaire_put_two', connection_string);
  perform extensions.dblink_send_query(
    'questionnaire_put_one',
    $query$
      with barrier as materialized (select pg_sleep(0.25))
      select private.test_concurrent_questionnaire_put(
        decode(repeat('41', 32), 'hex'), decode(repeat('42', 32), 'hex')
      ) from barrier
    $query$
  );
  perform extensions.dblink_send_query(
    'questionnaire_put_two',
    $query$
      with barrier as materialized (select pg_sleep(0.25))
      select private.test_concurrent_questionnaire_put(
        decode(repeat('43', 32), 'hex'), decode(repeat('44', 32), 'hex')
      ) from barrier
    $query$
  );
end;
$$;

insert into concurrent_questionnaire_results
select result
from extensions.dblink_get_result('questionnaire_put_one') as response(result text);
insert into concurrent_questionnaire_results
select result
from extensions.dblink_get_result('questionnaire_put_two') as response(result text);

select is(
  (select count(*) from concurrent_questionnaire_results where result = 'ok'),
  1::bigint,
  'una única primera escritura concurrente crea el borrador'
);
select is(
  (select count(*) from concurrent_questionnaire_results where result = 'PT409'),
  1::bigint,
  'la otra primera escritura recibe un conflicto HTTP explícito, no violación única'
);

do $$
begin
  perform extensions.dblink_disconnect('questionnaire_put_one');
  perform extensions.dblink_disconnect('questionnaire_put_two');
end;
$$;
drop table concurrent_questionnaire_results;
drop function private.test_concurrent_questionnaire_put(bytea, bytea);
delete from public.profile_access
where profile_id = '51000000-0000-4000-8000-000000006199';
delete from public.device_sessions
where actor_id = '31000000-0000-4000-8000-000000006199';
delete from public.profiles
where id = '51000000-0000-4000-8000-000000006199';
delete from public.actors
where id = '31000000-0000-4000-8000-000000006199';
delete from auth.sessions
where id = '21000000-0000-4000-8000-000000006199';
delete from auth.users
where id = '00000000-0000-4000-8000-000000006199';

begin;

select ok(
  to_regclass('public.questionnaire_drafts') is not null,
  'existe la tabla de borradores'
);
select ok(
  to_regclass('private.questionnaire_idempotency') is not null,
  'existe la idempotencia privada del cuestionario'
);
select ok(
  (
    select relrowsecurity
    from pg_class
    where oid = 'public.questionnaire_drafts'::regclass
  ),
  'RLS está activo en borradores'
);
select ok(
  not has_table_privilege('anon', 'public.questionnaire_drafts', 'SELECT')
    and not has_table_privilege('authenticated', 'public.questionnaire_drafts', 'SELECT')
    and not has_table_privilege('authenticated', 'public.questionnaire_drafts', 'UPDATE'),
  'el navegador no accede directamente a respuestas'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.internal_get_questionnaire_draft(uuid,uuid,uuid)',
    'EXECUTE'
  ) and not has_function_privilege(
    'authenticated',
    'public.internal_get_questionnaire_draft(uuid,uuid,uuid)',
    'EXECUTE'
  ),
  'solo service_role ejecuta el RPC de lectura'
);

insert into auth.users (
  instance_id, id, aud, role, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at, is_anonymous
)
values
  (
    '00000000-0000-0000-0000-000000000000',
    '00000000-0000-4000-8000-000000006101',
    'authenticated', 'authenticated',
    '{"provider":"anonymous","providers":["anonymous"]}'::jsonb,
    '{}'::jsonb, now(), now(), true
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '00000000-0000-4000-8000-000000006102',
    'authenticated', 'authenticated',
    '{"provider":"anonymous","providers":["anonymous"]}'::jsonb,
    '{}'::jsonb, now(), now(), true
  );

insert into auth.sessions (id, user_id, created_at, updated_at, aal)
values
  (
    '21000000-0000-4000-8000-000000006101',
    '00000000-0000-4000-8000-000000006101', now(), now(), 'aal1'
  ),
  (
    '21000000-0000-4000-8000-000000006102',
    '00000000-0000-4000-8000-000000006102', now(), now(), 'aal1'
  );

insert into public.actors (id, auth_subject)
values
  (
    '31000000-0000-4000-8000-000000006101',
    '00000000-0000-4000-8000-000000006101'
  ),
  (
    '31000000-0000-4000-8000-000000006102',
    '00000000-0000-4000-8000-000000006102'
  );

insert into public.profiles (id, alias, timezone, adult_attested_at)
values (
  '51000000-0000-4000-8000-000000006101',
  'Cuestionario Test', 'Europe/Madrid', now()
);
insert into public.profile_access (id, profile_id, actor_id)
values (
  '61000000-0000-4000-8000-000000006101',
  '51000000-0000-4000-8000-000000006101',
  '31000000-0000-4000-8000-000000006101'
);
insert into public.device_sessions (
  id, actor_id, auth_session_id, label, created_at, last_seen_at,
  idle_expires_at, absolute_expires_at
)
values
  (
    '41000000-0000-4000-8000-000000006101',
    '31000000-0000-4000-8000-000000006101',
    '21000000-0000-4000-8000-000000006101',
    'Propietario', now(), now(), now() + interval '30 days', now() + interval '180 days'
  ),
  (
    '41000000-0000-4000-8000-000000006102',
    '31000000-0000-4000-8000-000000006102',
    '21000000-0000-4000-8000-000000006102',
    'Ajeno', now(), now(), now() + interval '30 days', now() + interval '180 days'
  );

select is(
  (
    public.internal_put_questionnaire_draft(
      '00000000-0000-4000-8000-000000006101',
      '21000000-0000-4000-8000-000000006101',
      '51000000-0000-4000-8000-000000006101',
      1,
      0,
      '{"activeModules":["nutrition"]}'::jsonb,
      array['modules'],
      'nutrition',
      'provisional',
      '[]'::jsonb,
      '[]'::jsonb,
      decode(repeat('11', 32), 'hex'),
      decode(repeat('12', 32), 'hex')
    ) ->> 'version'
  )::integer,
  1,
  'el primer guardado crea versión 1'
);

select is(
  (
    public.internal_put_questionnaire_draft(
      '00000000-0000-4000-8000-000000006101',
      '21000000-0000-4000-8000-000000006101',
      '51000000-0000-4000-8000-000000006101',
      1,
      0,
      '{"activeModules":["nutrition"]}'::jsonb,
      array['modules'],
      'nutrition',
      'provisional',
      '[]'::jsonb,
      '[]'::jsonb,
      decode(repeat('11', 32), 'hex'),
      decode(repeat('12', 32), 'hex')
    ) ->> 'version'
  )::integer,
  1,
  'reintentar la misma mutación devuelve la misma confirmación'
);

select throws_ok(
  $$
    select public.internal_put_questionnaire_draft(
      '00000000-0000-4000-8000-000000006101',
      '21000000-0000-4000-8000-000000006101',
      '51000000-0000-4000-8000-000000006101',
      1, 0, '{"activeModules":["sleep"]}'::jsonb,
      array['modules'], 'sleep', 'provisional', '[]'::jsonb, '[]'::jsonb,
      decode(repeat('11', 32), 'hex'), decode(repeat('13', 32), 'hex')
    )
  $$,
  '23505',
  'idempotency_key_reused',
  'una clave idempotente no puede representar otra petición'
);

select throws_ok(
  $$
    select public.internal_put_questionnaire_draft(
      '00000000-0000-4000-8000-000000006101',
      '21000000-0000-4000-8000-000000006101',
      '51000000-0000-4000-8000-000000006101',
      1, 0, '{"activeModules":["nutrition"]}'::jsonb,
      array['modules'], 'nutrition', 'provisional', '[]'::jsonb, '[]'::jsonb,
      decode(repeat('21', 32), 'hex'), decode(repeat('22', 32), 'hex')
    )
  $$,
  'PT409',
  'version_conflict',
  'una versión obsoleta no sobrescribe respuestas'
);

select throws_ok(
  $$
    select public.internal_get_questionnaire_draft(
      '00000000-0000-4000-8000-000000006102',
      '21000000-0000-4000-8000-000000006102',
      '51000000-0000-4000-8000-000000006101'
    )
  $$,
  '42501',
  'access_not_granted',
  'otro perfil no puede leer el borrador'
);

select is(
  (
    public.internal_submit_questionnaire_draft(
      '00000000-0000-4000-8000-000000006101',
      '21000000-0000-4000-8000-000000006101',
      '51000000-0000-4000-8000-000000006101',
      1, 1, 'provisional', '[]'::jsonb, '[]'::jsonb,
      decode(repeat('31', 32), 'hex'), decode(repeat('32', 32), 'hex')
    ) ->> 'status'
  ),
  'submitted',
  'el envío cambia el estado sin exigir completitud total'
);

select is(
  (select count(*) from public.questionnaire_drafts where profile_id = '51000000-0000-4000-8000-000000006101'),
  1::bigint,
  'solo existe un borrador por perfil'
);

select * from finish();
rollback;
