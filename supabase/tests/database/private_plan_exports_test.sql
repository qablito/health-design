select no_plan();

begin;

select ok(
  exists (
    select 1
    from storage.buckets bucket
    where bucket.id = 'plan-exports'
      and bucket.public is false
      and bucket.file_size_limit = 26214400
      and bucket.allowed_mime_types = array[
        'application/pdf',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      ]::text[]
  ),
  'el bucket privado limita formato y tamaño'
);

select ok(
  to_regclass('private.export_artifacts') is not null
  and to_regclass('private.export_rate_limit_events') is not null,
  'los metadatos y límites permanecen privados'
);

select ok(
  not has_table_privilege(
    'authenticated', 'private.export_artifacts', 'SELECT,INSERT,UPDATE,DELETE'
  )
  and not has_table_privilege(
    'anon', 'private.export_artifacts', 'SELECT,INSERT,UPDATE,DELETE'
  ),
  'ningún cliente accede directamente a artefactos privados'
);

select ok(
  to_regprocedure(
    'public.internal_reserve_plan_export(uuid,uuid,uuid,text,jsonb,bytea,bytea,bytea,bytea)'
  ) is not null
  and to_regprocedure(
    'public.internal_complete_plan_export(uuid,uuid,uuid,bigint,bytea)'
  ) is not null
  and to_regprocedure(
    'public.internal_get_plan_export(uuid,uuid,uuid)'
  ) is not null,
  'los wrappers estrechos de reserva, cierre y lectura existen'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'public.internal_reserve_plan_export(uuid,uuid,uuid,text,jsonb,bytea,bytea,bytea,bytea)',
    'EXECUTE'
  )
  and has_function_privilege(
    'service_role',
    'public.internal_reserve_plan_export(uuid,uuid,uuid,text,jsonb,bytea,bytea,bytea,bytea)',
    'EXECUTE'
  ),
  'solo el servicio puede invocar la reserva'
);

insert into auth.users (
  instance_id, id, aud, role, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at, is_anonymous
) values (
  '00000000-0000-0000-0000-000000000000',
  '00000000-0000-4000-8000-000000015101',
  'authenticated', 'authenticated',
  '{"provider":"anonymous","providers":["anonymous"]}'::jsonb,
  '{}'::jsonb, now(), now(), true
);

insert into auth.sessions (id, user_id, created_at, updated_at, aal)
values (
  '21000000-0000-4000-8000-000000015101',
  '00000000-0000-4000-8000-000000015101', now(), now(), 'aal1'
);

insert into public.actors (id, auth_subject)
values (
  '31000000-0000-4000-8000-000000015101',
  '00000000-0000-4000-8000-000000015101'
);

insert into public.profiles (id, alias, timezone, adult_attested_at)
values (
  '51000000-0000-4000-8000-000000015101',
  'Export Test', 'Europe/Madrid', now()
);

insert into public.profile_access (id, profile_id, actor_id)
values (
  '61000000-0000-4000-8000-000000015101',
  '51000000-0000-4000-8000-000000015101',
  '31000000-0000-4000-8000-000000015101'
);

insert into public.device_sessions (
  id, actor_id, auth_session_id, label, created_at, last_seen_at,
  idle_expires_at, absolute_expires_at
) values (
  '41000000-0000-4000-8000-000000015101',
  '31000000-0000-4000-8000-000000015101',
  '21000000-0000-4000-8000-000000015101',
  'Export test', now(), now(), now() + interval '30 days',
  now() + interval '180 days'
);

insert into public.questionnaire_drafts (
  id, profile_id, schema_version, version, status, completeness, answers,
  confirmed_block_ids, current_block_id, uncertainties, hard_errors
) values (
  '71000000-0000-4000-8000-000000015101',
  '51000000-0000-4000-8000-000000015101',
  2, 1, 'submitted', 'complete',
  '{"activeModules":["nutrition"],"age":35,"weightKg":82}'::jsonb,
  array['core', 'modules', 'summary'], 'summary', '[]'::jsonb, '[]'::jsonb
);

create temporary table export_snapshot as
select public.internal_create_context_snapshot(
  '00000000-0000-4000-8000-000000015101',
  '21000000-0000-4000-8000-000000015101',
  '51000000-0000-4000-8000-000000015101',
  1, 'normalization-v1', 'canonical-json-v1',
  decode(repeat('11', 32), 'hex'),
  decode(repeat('12', 32), 'hex'),
  decode(repeat('13', 32), 'hex')
) as response;

create temporary table export_plan as
select public.internal_create_plan_draft(
  '00000000-0000-4000-8000-000000015101',
  '21000000-0000-4000-8000-000000015101',
  '51000000-0000-4000-8000-000000015101',
  (select (response ->> 'id')::uuid from export_snapshot),
  'engine-contract-v1', 'plan-canonical-v1',
  '81000000-0000-4000-8000-000000015101',
  '82000000-0000-4000-8000-000000015101',
  decode(repeat('21', 32), 'hex'),
  decode(repeat('22', 32), 'hex'),
  'complete', 'valid',
  '{"checks":["nutrition"],"completeness":"complete"}'::jsonb,
  '[{"module":"nutrition","status":"valid","confidence":"high","payload":{"nutritionSchemaVersion":2,"days":[]},"uncertainties":[]}]'::jsonb,
  '[]'::jsonb,
  decode(repeat('23', 32), 'hex'),
  decode(repeat('24', 32), 'hex')
) as response;

create temporary table export_source as
select public.internal_get_plan_export_source(
  '00000000-0000-4000-8000-000000015101',
  '21000000-0000-4000-8000-000000015101',
  (select (response ->> 'planVersionId')::uuid from export_plan)
) as response;

select is(
  (select response ->> 'profileId' from export_source),
  '51000000-0000-4000-8000-000000015101',
  'la fuente autorizada expone internamente el perfil para vincular snapshots'
);

select throws_ok(
  format(
    $$select public.internal_reserve_plan_export(
      '00000000-0000-4000-8000-000000015101',
      '21000000-0000-4000-8000-000000015199',
      %L::uuid, 'export-v1',
      '{"schemaVersion":1,"format":"pdf","detail":"compact","presentation":"ingredients","range":{"kind":"week"},"includeShopping":true,"includeWeeklyPreparation":false,"choices":[]}'::jsonb,
      decode(repeat('31', 32), 'hex'), decode(repeat('32', 32), 'hex'),
      decode(repeat('33', 32), 'hex'), decode(repeat('34', 32), 'hex')
    )$$,
    (select response ->> 'planVersionId' from export_plan)
  ),
  '28000',
  'unauthenticated',
  'la reserva exige una sesión Auth y DeviceSession activas'
);

create temporary table first_export as
select public.internal_reserve_plan_export(
  '00000000-0000-4000-8000-000000015101',
  '21000000-0000-4000-8000-000000015101',
  (select (response ->> 'planVersionId')::uuid from export_plan),
  'export-v1',
  '{"schemaVersion":1,"format":"pdf","detail":"compact","presentation":"ingredients","range":{"kind":"week"},"includeShopping":true,"includeWeeklyPreparation":false,"choices":[]}'::jsonb,
  decode(repeat('31', 32), 'hex'), decode(repeat('32', 32), 'hex'),
  decode(repeat('33', 32), 'hex'), decode(repeat('34', 32), 'hex')
) as response;

select is(
  (select response ->> 'outcome' from first_export),
  'reserved',
  'la primera solicitud reserva un artefacto pendiente'
);

select is(
  public.internal_reserve_plan_export(
    '00000000-0000-4000-8000-000000015101',
    '21000000-0000-4000-8000-000000015101',
    (select (response ->> 'planVersionId')::uuid from export_plan),
    'export-v1',
    '{"schemaVersion":1,"format":"pdf","detail":"compact","presentation":"ingredients","range":{"kind":"week"},"includeShopping":true,"includeWeeklyPreparation":false,"choices":[]}'::jsonb,
    decode(repeat('31', 32), 'hex'), decode(repeat('32', 32), 'hex'),
    decode(repeat('33', 32), 'hex'), decode(repeat('34', 32), 'hex')
  ) ->> 'artifactId',
  (select response ->> 'artifactId' from first_export),
  'la misma clave y solicitud reutiliza la reserva'
);

select is(
  (
    select count(*)
    from private.export_rate_limit_events
    where profile_id = '51000000-0000-4000-8000-000000015101'
  ),
  1::bigint,
  'la repetición idempotente no consume otro cupo'
);

select throws_ok(
  format(
    $$select public.internal_reserve_plan_export(
      '00000000-0000-4000-8000-000000015101',
      '21000000-0000-4000-8000-000000015101',
      %L::uuid, 'export-v1',
      '{"schemaVersion":1,"format":"pdf","detail":"compact","presentation":"ingredients","range":{"kind":"week"},"includeShopping":true,"includeWeeklyPreparation":false,"choices":[]}'::jsonb,
      decode(repeat('31', 32), 'hex'), decode(repeat('32', 32), 'hex'),
      decode(repeat('35', 32), 'hex'), decode(repeat('34', 32), 'hex')
    )$$,
    (select response ->> 'planVersionId' from export_plan)
  ),
  '23505',
  'idempotency_key_reused',
  'una clave idempotente no puede representar otra solicitud'
);

select is(
  public.internal_complete_plan_export(
    '00000000-0000-4000-8000-000000015101',
    '21000000-0000-4000-8000-000000015101',
    (select (response ->> 'artifactId')::uuid from first_export),
    2048,
    decode(repeat('41', 32), 'hex')
  ) ->> 'status',
  'ready',
  'el cierre registra tamaño y hash del contenido'
);

select is(
  public.internal_reserve_plan_export(
    '00000000-0000-4000-8000-000000015101',
    '21000000-0000-4000-8000-000000015101',
    (select (response ->> 'planVersionId')::uuid from export_plan),
    'export-v1',
    '{"schemaVersion":1,"format":"pdf","detail":"compact","presentation":"ingredients","range":{"kind":"week"},"includeShopping":true,"includeWeeklyPreparation":false,"choices":[]}'::jsonb,
    decode(repeat('31', 32), 'hex'), decode(repeat('36', 32), 'hex'),
    decode(repeat('37', 32), 'hex'), decode(repeat('34', 32), 'hex')
  ) ->> 'artifactId',
  (select response ->> 'artifactId' from first_export),
  'otra clave con la misma versión y configuración reutiliza el artefacto listo'
);

create temporary table second_export as
select public.internal_reserve_plan_export(
  '00000000-0000-4000-8000-000000015101',
  '21000000-0000-4000-8000-000000015101',
  (select (response ->> 'planVersionId')::uuid from export_plan),
  'export-v1',
  '{"schemaVersion":1,"format":"xlsx","detail":"complete","presentation":"preparation","range":{"kind":"week"},"includeShopping":false,"includeWeeklyPreparation":true,"choices":[]}'::jsonb,
  decode(repeat('51', 32), 'hex'), decode(repeat('52', 32), 'hex'),
  decode(repeat('53', 32), 'hex'), decode(repeat('54', 32), 'hex')
) as response;

select is(
  public.internal_reserve_plan_export(
    '00000000-0000-4000-8000-000000015101',
    '21000000-0000-4000-8000-000000015101',
    (select (response ->> 'planVersionId')::uuid from export_plan),
    'export-v1',
    '{"schemaVersion":1,"format":"pdf","detail":"complete","presentation":"ingredients","range":{"kind":"week"},"includeShopping":false,"includeWeeklyPreparation":false,"choices":[]}'::jsonb,
    decode(repeat('61', 32), 'hex'), decode(repeat('62', 32), 'hex'),
    decode(repeat('63', 32), 'hex'), decode(repeat('64', 32), 'hex')
  ) ->> 'outcome',
  'pending',
  'un pendiente por perfil bloquea otra generación concurrente'
);

select public.internal_fail_plan_export(
  '00000000-0000-4000-8000-000000015101',
  '21000000-0000-4000-8000-000000015101',
  (select (response ->> 'artifactId')::uuid from second_export)
);

insert into private.export_rate_limit_events (profile_id, actor_id, ip_digest)
select
  '51000000-0000-4000-8000-000000015101',
  '31000000-0000-4000-8000-000000015101',
  decode(repeat('34', 32), 'hex')
from generate_series(1, 18);

select throws_ok(
  format(
    $$select public.internal_reserve_plan_export(
      '00000000-0000-4000-8000-000000015101',
      '21000000-0000-4000-8000-000000015101',
      %L::uuid, 'export-v1',
      '{"schemaVersion":1,"format":"pdf","detail":"complete","presentation":"ingredients","range":{"kind":"day","day":1},"includeShopping":false,"includeWeeklyPreparation":false,"choices":[]}'::jsonb,
      decode(repeat('71', 32), 'hex'), decode(repeat('72', 32), 'hex'),
      decode(repeat('73', 32), 'hex'), decode(repeat('34', 32), 'hex')
    )$$,
    (select response ->> 'planVersionId' from export_plan)
  ),
  'PT429',
  'export_rate_limited',
  'el límite móvil de veinte intentos por perfil se aplica'
);

delete from private.export_rate_limit_events;

insert into public.profiles (id, alias, timezone, adult_attested_at)
values (
  '51000000-0000-4000-8000-000000015102',
  'Export Actor Limit', 'Europe/Madrid', now()
);

insert into private.export_rate_limit_events (profile_id, actor_id, ip_digest)
select
  '51000000-0000-4000-8000-000000015102',
  '31000000-0000-4000-8000-000000015101',
  decode(repeat('82', 32), 'hex')
from generate_series(1, 30);

select throws_ok(
  format(
    $$select public.internal_reserve_plan_export(
      '00000000-0000-4000-8000-000000015101',
      '21000000-0000-4000-8000-000000015101',
      %L::uuid, 'export-v1',
      '{"schemaVersion":1,"format":"pdf","detail":"complete","presentation":"ingredients","range":{"kind":"day","day":2},"includeShopping":false,"includeWeeklyPreparation":false,"choices":[]}'::jsonb,
      decode(repeat('83', 32), 'hex'), decode(repeat('84', 32), 'hex'),
      decode(repeat('85', 32), 'hex'), decode(repeat('86', 32), 'hex')
    )$$,
    (select response ->> 'planVersionId' from export_plan)
  ),
  'PT429',
  'export_rate_limited',
  'el límite móvil de treinta intentos por actor se aplica entre perfiles'
);

delete from private.export_rate_limit_events;
delete from public.profiles
where id = '51000000-0000-4000-8000-000000015102';

insert into auth.users (
  instance_id, id, aud, role, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at, is_anonymous
) values
  (
    '00000000-0000-0000-0000-000000000000',
    '00000000-0000-4000-8000-000000015102',
    'authenticated', 'authenticated', '{}', '{}', now(), now(), true
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '00000000-0000-4000-8000-000000015103',
    'authenticated', 'authenticated', '{}', '{}', now(), now(), true
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '00000000-0000-4000-8000-000000015104',
    'authenticated', 'authenticated', '{}', '{}', now(), now(), true
  );

insert into public.actors (id, auth_subject)
values
  (
    '31000000-0000-4000-8000-000000015102',
    '00000000-0000-4000-8000-000000015102'
  ),
  (
    '31000000-0000-4000-8000-000000015103',
    '00000000-0000-4000-8000-000000015103'
  ),
  (
    '31000000-0000-4000-8000-000000015104',
    '00000000-0000-4000-8000-000000015104'
  );

insert into public.profiles (id, alias, timezone, adult_attested_at)
values
  (
    '51000000-0000-4000-8000-000000015102',
    'Export Ip Limit A', 'Europe/Madrid', now()
  ),
  (
    '51000000-0000-4000-8000-000000015103',
    'Export Ip Limit B', 'Europe/Madrid', now()
  ),
  (
    '51000000-0000-4000-8000-000000015104',
    'Export Ip Limit C', 'Europe/Madrid', now()
  );

insert into private.export_rate_limit_events (profile_id, actor_id, ip_digest)
select ids.profile_id, ids.actor_id, decode(repeat('91', 32), 'hex')
from (
  values
    (
      '51000000-0000-4000-8000-000000015101'::uuid,
      '31000000-0000-4000-8000-000000015101'::uuid
    ),
    (
      '51000000-0000-4000-8000-000000015102'::uuid,
      '31000000-0000-4000-8000-000000015102'::uuid
    ),
    (
      '51000000-0000-4000-8000-000000015103'::uuid,
      '31000000-0000-4000-8000-000000015103'::uuid
    ),
    (
      '51000000-0000-4000-8000-000000015104'::uuid,
      '31000000-0000-4000-8000-000000015104'::uuid
    )
) ids(profile_id, actor_id)
cross join generate_series(1, 15);

select throws_ok(
  format(
    $$select public.internal_reserve_plan_export(
      '00000000-0000-4000-8000-000000015101',
      '21000000-0000-4000-8000-000000015101',
      %L::uuid, 'export-v1',
      '{"schemaVersion":1,"format":"pdf","detail":"complete","presentation":"ingredients","range":{"kind":"day","day":3},"includeShopping":false,"includeWeeklyPreparation":false,"choices":[]}'::jsonb,
      decode(repeat('92', 32), 'hex'), decode(repeat('93', 32), 'hex'),
      decode(repeat('94', 32), 'hex'), decode(repeat('91', 32), 'hex')
    )$$,
    (select response ->> 'planVersionId' from export_plan)
  ),
  'PT429',
  'export_rate_limited',
  'el límite móvil de sesenta intentos por digest de IP se aplica globalmente'
);

delete from private.export_rate_limit_events;
delete from public.profiles
where id in (
  '51000000-0000-4000-8000-000000015102',
  '51000000-0000-4000-8000-000000015103',
  '51000000-0000-4000-8000-000000015104'
);
delete from public.actors
where id in (
  '31000000-0000-4000-8000-000000015102',
  '31000000-0000-4000-8000-000000015103',
  '31000000-0000-4000-8000-000000015104'
);
delete from auth.users
where id in (
  '00000000-0000-4000-8000-000000015102',
  '00000000-0000-4000-8000-000000015103',
  '00000000-0000-4000-8000-000000015104'
);

update public.profiles
set status = 'deletion_requested', deletion_requested_at = clock_timestamp()
where id = '51000000-0000-4000-8000-000000015101';

insert into private.deletion_jobs (
  id, profile_id, profile_marker, request_handle_hash,
  requester_actor_id, status, confirmed_by
) values (
  '91000000-0000-4000-8000-000000015101',
  '51000000-0000-4000-8000-000000015101',
  decode('aa', 'hex'), decode(repeat('81', 32), 'hex'),
  '31000000-0000-4000-8000-000000015101', 'purging',
  '31000000-0000-4000-8000-000000015101'
);

select throws_ok(
  $$
    update private.deletion_jobs
    set status = 'purged', completed_at = clock_timestamp()
    where id = '91000000-0000-4000-8000-000000015101'
  $$,
  '55000',
  'export_purge_incomplete',
  'la purga del perfil falla cerrada mientras existan exportaciones'
);

select is(
  jsonb_array_length(
    public.internal_list_profile_export_purge_paths(
      '91000000-0000-4000-8000-000000015101'
    )
  ),
  2,
  'la primera fase enumera solo las rutas del perfil'
);

select is(
  public.internal_confirm_profile_export_purge(
    '91000000-0000-4000-8000-000000015101',
    (
      select jsonb_agg(item ->> 'storagePath' order by item ->> 'storagePath')
      from jsonb_array_elements(
        public.internal_list_profile_export_purge_paths(
          '91000000-0000-4000-8000-000000015101'
        )
      ) item
    )
  ),
  2,
  'la segunda fase confirma Storage antes de retirar metadatos'
);

select is(
  (
    select count(*)
    from private.export_artifacts
    where profile_id = '51000000-0000-4000-8000-000000015101'
  ),
  0::bigint,
  'la confirmación no deja metadatos de exportación'
);

delete from public.profile_access
where profile_id = '51000000-0000-4000-8000-000000015101';

delete from public.plans
where profile_id = '51000000-0000-4000-8000-000000015101';

update private.deletion_jobs
set status = 'purged', completed_at = clock_timestamp()
where id = '91000000-0000-4000-8000-000000015101';

select is(
  (
    select count(*)
    from public.profiles
    where id = '51000000-0000-4000-8000-000000015101'
  ),
  0::bigint,
  'la eliminación permanente concluye después de retirar Storage y metadatos'
);

select * from finish();

rollback;
