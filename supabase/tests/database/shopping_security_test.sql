begin;

select no_plan();

select ok(
  (
    select bool_and(c.relrowsecurity)
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname in (
        'shopping_preference_revisions',
        'shopping_snapshots',
        'shopping_snapshot_publications',
        'shopping_leftover_confirmations',
        'shopping_product_selection_confirmations'
      )
  ),
  'RLS está activo en todas las tablas T17D vinculadas a perfiles'
);

select ok(
  not has_table_privilege(
    'authenticated', 'public.shopping_snapshots', 'INSERT,UPDATE,DELETE'
  )
  and not has_table_privilege(
    'authenticated', 'public.shopping_preference_revisions', 'INSERT,UPDATE,DELETE'
  )
  and has_function_privilege(
    'service_role',
    'public.internal_get_shopping_snapshot(uuid,uuid,uuid)',
    'EXECUTE'
  ),
  'los usuarios no escriben compra directamente y el servicio usa RPC autorizadas'
);

select ok(
  to_regclass('private.shopping_rate_limit_events') is not null
  and not has_table_privilege(
    'authenticated', 'private.shopping_rate_limit_events',
    'SELECT,INSERT,UPDATE,DELETE'
  ),
  'las cuotas de compra viven en almacenamiento privado'
);

insert into auth.users (
  instance_id, id, aud, role, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at, is_anonymous
) values
  ('00000000-0000-0000-0000-000000000000','00000000-0000-4000-8000-000000017501','authenticated','authenticated','{"provider":"anonymous","providers":["anonymous"]}','{}',now(),now(),true),
  ('00000000-0000-0000-0000-000000000000','00000000-0000-4000-8000-000000017502','authenticated','authenticated','{"provider":"anonymous","providers":["anonymous"]}','{}',now(),now(),true),
  ('00000000-0000-0000-0000-000000000000','00000000-0000-4000-8000-000000017503','authenticated','authenticated','{"provider":"anonymous","providers":["anonymous"]}','{}',now(),now(),true);
insert into auth.sessions (id,user_id,created_at,updated_at,aal) values
  ('21000000-0000-4000-8000-000000017501','00000000-0000-4000-8000-000000017501',now(),now(),'aal1'),
  ('21000000-0000-4000-8000-000000017502','00000000-0000-4000-8000-000000017502',now(),now(),'aal1');
insert into public.actors (id,auth_subject) values
  ('31000000-0000-4000-8000-000000017501','00000000-0000-4000-8000-000000017501'),
  ('31000000-0000-4000-8000-000000017502','00000000-0000-4000-8000-000000017502'),
  ('31000000-0000-4000-8000-000000017503','00000000-0000-4000-8000-000000017503');
insert into public.profiles (id,alias,timezone,adult_attested_at) values
  ('51000000-0000-4000-8000-000000017501','Compra A','Europe/Madrid',now()),
  ('51000000-0000-4000-8000-000000017502','Compra B','Europe/Madrid',now()),
  ('51000000-0000-4000-8000-000000017503','Compra C','Europe/Madrid',now()),
  ('51000000-0000-4000-8000-000000017504','Compra D','Europe/Madrid',now());
insert into public.profile_access (id,profile_id,actor_id) values
  ('61000000-0000-4000-8000-000000017501','51000000-0000-4000-8000-000000017501','31000000-0000-4000-8000-000000017501'),
  ('61000000-0000-4000-8000-000000017502','51000000-0000-4000-8000-000000017502','31000000-0000-4000-8000-000000017502'),
  ('61000000-0000-4000-8000-000000017503','51000000-0000-4000-8000-000000017503','31000000-0000-4000-8000-000000017501'),
  ('61000000-0000-4000-8000-000000017504','51000000-0000-4000-8000-000000017504','31000000-0000-4000-8000-000000017501');
insert into public.device_sessions (
  id,actor_id,auth_session_id,label,created_at,last_seen_at,
  idle_expires_at,absolute_expires_at
) values
  ('41000000-0000-4000-8000-000000017501','31000000-0000-4000-8000-000000017501','21000000-0000-4000-8000-000000017501','A',now(),now(),now()+interval '30 days',now()+interval '180 days'),
  ('41000000-0000-4000-8000-000000017502','31000000-0000-4000-8000-000000017502','21000000-0000-4000-8000-000000017502','B',now(),now(),now()+interval '30 days',now()+interval '180 days');

insert into public.shopping_preference_revisions (
  id,profile_id,version,preferred_chain,mode,compared_chains,sorting,created_by
) values
  ('71000000-0000-4000-8000-000000017501','51000000-0000-4000-8000-000000017501',1,'mercadona','single','{}','normalized_price_asc','31000000-0000-4000-8000-000000017501'),
  ('71000000-0000-4000-8000-000000017502','51000000-0000-4000-8000-000000017502',1,'dia','single','{}','normalized_price_asc','31000000-0000-4000-8000-000000017502'),
  ('71000000-0000-4000-8000-000000017503','51000000-0000-4000-8000-000000017503',1,'aldi','single','{}','normalized_price_asc','31000000-0000-4000-8000-000000017501'),
  ('71000000-0000-4000-8000-000000017504','51000000-0000-4000-8000-000000017504',1,'mercadona','single','{}','normalized_price_asc','31000000-0000-4000-8000-000000017501');

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-000000017501","role":"authenticated","session_id":"21000000-0000-4000-8000-000000017501"}',
  true
);
select is(
  (select count(*) from public.shopping_preference_revisions),
  3::bigint,
  'RLS permite a A únicamente sus perfiles activos'
);
select is(
  (select count(*) from public.shopping_preference_revisions
   where profile_id = '51000000-0000-4000-8000-000000017502'),
  0::bigint,
  'RLS oculta por completo el perfil B a A'
);
reset role;

update public.profiles set status='deletion_requested', deletion_requested_at=now()
where id='51000000-0000-4000-8000-000000017504';
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-000000017501","role":"authenticated","session_id":"21000000-0000-4000-8000-000000017501"}',
  true
);
select is(
  (select count(*) from public.shopping_preference_revisions
   where profile_id='51000000-0000-4000-8000-000000017504'),
  0::bigint,
  'deletion_requested corta inmediatamente la lectura T17D'
);
reset role;
select throws_ok(
  $$select public.internal_get_shopping_preference(
    '00000000-0000-4000-8000-000000017501',
    '21000000-0000-4000-8000-000000017501',
    '51000000-0000-4000-8000-000000017504'
  )$$,
  '42501', 'access_not_granted',
  'las RPC también bloquean perfiles deletion_requested'
);

insert into private.shopping_rate_limit_events (
  actor_id,profile_id,operation,key_digest,ip_digest
) select
  '31000000-0000-4000-8000-000000017501',
  '51000000-0000-4000-8000-000000017501', 'snapshot-create',
  digest(format('profile-limit-%s', value),'sha256'),
  digest(format('profile-ip-%s', value),'sha256')
from generate_series(1,30) value;
select throws_ok(
  $$select private.consume_shopping_rate_limit(
    '31000000-0000-4000-8000-000000017501',
    '51000000-0000-4000-8000-000000017501','snapshot-create',
    digest('profile-limit-next','sha256'),digest('profile-ip-next','sha256')
  )$$,
  '54000','shopping_profile_rate_limited',
  'la resolución limita 30 creaciones por perfil y hora'
);
delete from private.shopping_rate_limit_events;

insert into private.shopping_rate_limit_events (
  actor_id,profile_id,operation,key_digest,ip_digest
) select
  '31000000-0000-4000-8000-000000017501',
  case (value-1)%3
    when 0 then '51000000-0000-4000-8000-000000017501'::uuid
    when 1 then '51000000-0000-4000-8000-000000017503'::uuid
    else '51000000-0000-4000-8000-000000017504'::uuid end,
  'snapshot-create', digest(format('actor-limit-%s',value),'sha256'),
  digest(format('actor-ip-%s',value),'sha256')
from generate_series(1,60) value;
select throws_ok(
  $$select private.consume_shopping_rate_limit(
    '31000000-0000-4000-8000-000000017501',
    '51000000-0000-4000-8000-000000017503','snapshot-create',
    digest('actor-limit-next','sha256'),digest('actor-ip-next','sha256')
  )$$,
  '54000','shopping_actor_rate_limited',
  'la resolución limita 60 creaciones por actor y hora'
);
delete from private.shopping_rate_limit_events;

insert into private.shopping_rate_limit_events (
  actor_id,profile_id,operation,key_digest,ip_digest
) select
  case when value <= 50
    then '31000000-0000-4000-8000-000000017501'::uuid
    else '31000000-0000-4000-8000-000000017502'::uuid end,
  case (value-1)%4
    when 0 then '51000000-0000-4000-8000-000000017501'::uuid
    when 1 then '51000000-0000-4000-8000-000000017502'::uuid
    when 2 then '51000000-0000-4000-8000-000000017503'::uuid
    else '51000000-0000-4000-8000-000000017504'::uuid end,
  'snapshot-create', digest(format('ip-limit-%s',value),'sha256'),
  digest('same-resolution-ip','sha256')
from generate_series(1,100) value;
select throws_ok(
  $$select private.consume_shopping_rate_limit(
    '31000000-0000-4000-8000-000000017501',
    '51000000-0000-4000-8000-000000017501','snapshot-create',
    digest('ip-limit-next','sha256'),digest('same-resolution-ip','sha256')
  )$$,
  '54000','shopping_ip_rate_limited',
  'la resolución limita 100 creaciones por IP hasheada y hora'
);
delete from private.shopping_rate_limit_events;

insert into private.shopping_rate_limit_events (
  actor_id,profile_id,operation,key_digest,ip_digest
) select '31000000-0000-4000-8000-000000017501',null,'catalog-read',null,
  digest(format('catalog-actor-ip-%s',value),'sha256')
from generate_series(1,120) value;
select throws_ok(
  $$select private.consume_shopping_rate_limit(
    '31000000-0000-4000-8000-000000017501',null,'catalog-read',null,
    digest('catalog-actor-next','sha256')
  )$$,
  '54000','shopping_actor_rate_limited',
  'el catálogo limita 120 lecturas por actor y hora'
);
delete from private.shopping_rate_limit_events;

insert into private.shopping_rate_limit_events (
  actor_id,profile_id,operation,key_digest,ip_digest
) select
  case (value-1)%3
    when 0 then '31000000-0000-4000-8000-000000017501'::uuid
    when 1 then '31000000-0000-4000-8000-000000017502'::uuid
    else '31000000-0000-4000-8000-000000017503'::uuid end,
  null,'catalog-read',null,digest('same-catalog-ip','sha256')
from generate_series(1,240) value;
select throws_ok(
  $$select private.consume_shopping_rate_limit(
    '31000000-0000-4000-8000-000000017503',null,'catalog-read',null,
    digest('same-catalog-ip','sha256')
  )$$,
  '54000','shopping_ip_rate_limited',
  'el catálogo limita 240 lecturas por IP hasheada y hora'
);
delete from private.shopping_rate_limit_events;

insert into private.shopping_rate_limit_events (
  actor_id,profile_id,operation,key_digest,ip_digest
) values (
  '31000000-0000-4000-8000-000000017501',
  '51000000-0000-4000-8000-000000017504','snapshot-create',
  digest('purge-key','sha256'),digest('purge-ip','sha256')
);
insert into private.plan_idempotency (
  actor_id,profile_id,operation,key_digest,request_digest,response,expires_at
) values (
  '31000000-0000-4000-8000-000000017501',
  '51000000-0000-4000-8000-000000017504','shopping-preference-put',
  digest('purge-idempotency','sha256'),digest('purge-request','sha256'),
  '{"schemaVersion":1,"preferenceRevisionId":"71000000-0000-4000-8000-000000017504","version":1}',
  now()+interval '24 hours'
);
insert into private.supermarket_skus (id,market,chain,external_sku) values (
  '8b000000-0000-4000-8000-000000017599','ES','mercadona','shared-purge-proof'
);
insert into private.deletion_jobs (
  id,profile_id,profile_marker,request_handle_hash,status,confirmed_by
) values (
  '91000000-0000-4000-8000-000000017504',
  '51000000-0000-4000-8000-000000017504',decode('01','hex'),
  digest('purge-handle','sha256'),'purging',
  '31000000-0000-4000-8000-000000017501'
);
delete from public.profile_access
where profile_id='51000000-0000-4000-8000-000000017504';
update private.deletion_jobs set status='purged',completed_at=now()
where id='91000000-0000-4000-8000-000000017504';

select ok(
  not exists(select 1 from public.profiles where id='51000000-0000-4000-8000-000000017504')
  and not exists(select 1 from public.shopping_preference_revisions where profile_id='51000000-0000-4000-8000-000000017504')
  and not exists(select 1 from private.shopping_rate_limit_events where profile_id='51000000-0000-4000-8000-000000017504')
  and not exists(select 1 from private.plan_idempotency where profile_id='51000000-0000-4000-8000-000000017504'),
  'la purga elimina únicamente el estado T17 identificable del perfil'
);
select ok(
  exists(select 1 from private.supermarket_skus where id='8b000000-0000-4000-8000-000000017599')
  and exists(select 1 from public.shopping_preference_revisions where profile_id='51000000-0000-4000-8000-000000017501'),
  'la purga compositiva conserva catálogos compartidos y otros perfiles'
);

select * from finish();
rollback;
