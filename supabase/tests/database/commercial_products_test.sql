select no_plan();

begin;

insert into auth.users (
  instance_id, id, aud, role, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at, is_anonymous
) values
  (
    '00000000-0000-0000-0000-000000000000',
    '00000000-0000-4000-8000-000000016101',
    'authenticated', 'authenticated',
    '{"provider":"anonymous","providers":["anonymous"]}'::jsonb,
    '{}'::jsonb, now(), now(), true
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '00000000-0000-4000-8000-000000016102',
    'authenticated', 'authenticated',
    '{"provider":"anonymous","providers":["anonymous"]}'::jsonb,
    '{}'::jsonb, now(), now(), true
  );

insert into auth.sessions (id, user_id, created_at, updated_at, aal)
values
  (
    '21000000-0000-4000-8000-000000016101',
    '00000000-0000-4000-8000-000000016101', now(), now(), 'aal1'
  ),
  (
    '21000000-0000-4000-8000-000000016102',
    '00000000-0000-4000-8000-000000016102', now(), now(), 'aal1'
  );

insert into public.actors (id, auth_subject)
values
  (
    '31000000-0000-4000-8000-000000016101',
    '00000000-0000-4000-8000-000000016101'
  ),
  (
    '31000000-0000-4000-8000-000000016102',
    '00000000-0000-4000-8000-000000016102'
  );

insert into public.profiles (id, alias, timezone, adult_attested_at)
values (
  '51000000-0000-4000-8000-000000016101',
  'Productos T16', 'Europe/Madrid', now()
);

insert into public.profile_access (id, profile_id, actor_id)
values (
  '61000000-0000-4000-8000-000000016101',
  '51000000-0000-4000-8000-000000016101',
  '31000000-0000-4000-8000-000000016101'
);

insert into public.device_sessions (
  id, actor_id, auth_session_id, label, created_at, last_seen_at,
  idle_expires_at, absolute_expires_at
) values
  (
    '41000000-0000-4000-8000-000000016101',
    '31000000-0000-4000-8000-000000016101',
    '21000000-0000-4000-8000-000000016101',
    'Productos propietario', now(), now(), now() + interval '30 days',
    now() + interval '180 days'
  ),
  (
    '41000000-0000-4000-8000-000000016102',
    '31000000-0000-4000-8000-000000016102',
    '21000000-0000-4000-8000-000000016102',
    'Productos ajeno', now(), now(), now() + interval '30 days',
    now() + interval '180 days'
  );

select ok(
  to_regclass('public.commercial_products') is not null
  and to_regclass('public.commercial_product_revisions') is not null
  and to_regclass('public.product_confirmations') is not null
  and to_regclass('public.barcode_corrections') is not null
  and to_regclass('public.product_matching_rule_revisions') is not null
  and to_regclass('private.commercial_product_lookup_state') is not null,
  'T16 persiste producto, revisiones, confirmaciones, correcciones, matching y lookup'
);

select ok(
  not has_table_privilege('authenticated', 'public.commercial_products', 'SELECT')
  and not has_table_privilege(
    'service_role', 'public.commercial_product_revisions', 'SELECT'
  )
  and has_function_privilege(
    'service_role',
    'public.internal_commercial_product_resolve(uuid,uuid,uuid,text,text)',
    'EXECUTE'
  ),
  'los productos solo salen por RPC cerrada y no por grants directos'
);

create temporary table product_fixture as
select jsonb_build_object(
  'schemaVersion', 1,
  'basis', 'per_100_g',
  'gtin', jsonb_build_object(
    'displayGtin', '8412345678905',
    'gtin14', '08412345678905',
    'symbology', 'ean_13'
  ),
  'name', 'Yogur natural',
  'nutrients', jsonb_build_object(
    'energyKcal', jsonb_build_object('state', 'known', 'unit', 'kcal', 'value', '63'),
    'fatG', jsonb_build_object('state', 'known', 'unit', 'g', 'value', '3.5'),
    'saturatedFatG', jsonb_build_object('state', 'known', 'unit', 'g', 'value', '2.3'),
    'carbohydratesG', jsonb_build_object('state', 'known', 'unit', 'g', 'value', '4.7'),
    'sugarsG', jsonb_build_object('state', 'known', 'unit', 'g', 'value', '4.7'),
    'proteinG', jsonb_build_object('state', 'known', 'unit', 'g', 'value', '3.4'),
    'saltG', jsonb_build_object('state', 'known', 'unit', 'g', 'value', '0.1'),
    'fiberG', jsonb_build_object('state', 'unknown'),
    'clinical', '{}'::jsonb
  ),
  'safety', jsonb_build_object(
    'ingredients', jsonb_build_object('state', 'known', 'values', jsonb_build_array('Leche')),
    'allergens', jsonb_build_object('state', 'known', 'values', jsonb_build_array('milk')),
    'crossContactAllergens', jsonb_build_object('state', 'known', 'values', '[]'::jsonb)
  )
) as snapshot;

create temporary table first_confirmation as
select public.internal_commercial_product_confirm(
  '00000000-0000-4000-8000-000000016101',
  '21000000-0000-4000-8000-000000016101',
  '51000000-0000-4000-8000-000000016101',
  '08412345678905', null, null,
  (select snapshot from product_fixture),
  decode(repeat('a1', 32), 'hex'),
  'complete', '["fiberG_unknown"]'::jsonb,
  '91000000-0000-4000-8000-000000016101',
  decode(repeat('b1', 32), 'hex')
) as response;

select is(
  (select response ->> 'scope' from first_confirmation),
  'profile',
  'confirmar crea una revisión privada explícita'
);

select is(
  (
    select public.internal_commercial_product_confirm(
      '00000000-0000-4000-8000-000000016101',
      '21000000-0000-4000-8000-000000016101',
      '51000000-0000-4000-8000-000000016101',
      '08412345678905', null, null,
      (select snapshot from product_fixture),
      decode(repeat('a1', 32), 'hex'),
      'complete', '["fiberG_unknown"]'::jsonb,
      '91000000-0000-4000-8000-000000016101',
      decode(repeat('b1', 32), 'hex')
    )
  ),
  (select response from first_confirmation),
  'la repetición exacta devuelve la misma confirmación'
);

select throws_ok(
  $$
    select public.internal_commercial_product_confirm(
      '00000000-0000-4000-8000-000000016101',
      '21000000-0000-4000-8000-000000016101',
      '51000000-0000-4000-8000-000000016101',
      '08412345678905', null, null,
      (select snapshot from product_fixture),
      decode(repeat('a1', 32), 'hex'),
      'complete', '["fiberG_unknown"]'::jsonb,
      '91000000-0000-4000-8000-000000016101',
      decode(repeat('ff', 32), 'hex')
    )
  $$,
  '23505',
  'idempotency_key_reused',
  'una clave idempotente no admite otro cuerpo'
);

select is(
  public.internal_commercial_product_resolve(
    '00000000-0000-4000-8000-000000016101',
    '21000000-0000-4000-8000-000000016101',
    '51000000-0000-4000-8000-000000016101',
    '08412345678905', null
  ) ->> 'source',
  'confirmed_label',
  'el perfil resuelve su etiqueta confirmada'
);

select throws_ok(
  $$
    select public.internal_commercial_product_resolve(
      '00000000-0000-4000-8000-000000016102',
      '21000000-0000-4000-8000-000000016102',
      '51000000-0000-4000-8000-000000016101',
      '08412345678905', null
    )
  $$,
  '42501',
  'profile_access_denied',
  'otro actor no resuelve la revisión privada'
);

create temporary table edited_confirmation as
select public.internal_commercial_product_confirm(
  '00000000-0000-4000-8000-000000016101',
  '21000000-0000-4000-8000-000000016101',
  '51000000-0000-4000-8000-000000016101',
  '08412345678905',
  ((select response ->> 'revisionId' from first_confirmation)::uuid),
  decode(repeat('a1', 32), 'hex'),
  jsonb_set(
    (select snapshot from product_fixture),
    '{nutrients,proteinG,value}', '"3.6"'::jsonb
  ),
  decode(repeat('a2', 32), 'hex'),
  'complete', '["fiberG_unknown"]'::jsonb,
  '91000000-0000-4000-8000-000000016102',
  decode(repeat('b2', 32), 'hex')
) as response;

select ok(
  (select response ->> 'correctionId' from edited_confirmation) is not null
  and exists (
    select 1 from public.barcode_corrections correction
    where correction.id = (
      select (response ->> 'correctionId')::uuid from edited_confirmation
    ) and correction.status = 'pending'
  ),
  'editar crea revisión inmutable y corrección privada pendiente'
);

select is(
  public.internal_commercial_product_resolve(
    '00000000-0000-4000-8000-000000016101',
    '21000000-0000-4000-8000-000000016101',
    '51000000-0000-4000-8000-000000016101',
    '08412345678905', null
  ) ->> 'source',
  'profile',
  'la corrección privada precede a la etiqueta confirmada'
);

insert into private.commercial_product_lookup_events (
  profile_id, actor_id, gtin14, attempted_at
)
select
  '51000000-0000-4000-8000-000000016101',
  '31000000-0000-4000-8000-000000016101',
  '08412345678905', now()
from generate_series(1, 28);

select throws_ok(
  $$
    select public.internal_commercial_product_resolve(
      '00000000-0000-4000-8000-000000016101',
      '21000000-0000-4000-8000-000000016101',
      '51000000-0000-4000-8000-000000016101',
      '08412345678905', null
    )
  $$,
  'PT429',
  'product_rate_limited',
  'la resolución aplica el límite horario de treinta intentos'
);

insert into public.commercial_product_manifests (
  id, source_kind, normalized_content_hash
) values (
  '14000000-0000-4000-8000-000000016101',
  'global_approval', decode(repeat('c1', 32), 'hex')
);

insert into public.commercial_product_revisions (
  id, product_id, manifest_id, owner_profile_id, source_kind, snapshot,
  completeness, uncertainties, content_hash, status, approved_at
) values (
  '15000000-0000-4000-8000-000000016101',
  (select id from public.commercial_products where gtin14 = '08412345678905'),
  '14000000-0000-4000-8000-000000016101', null, 'global_approval',
  (select snapshot from product_fixture), 'complete',
  '["fiberG_unknown"]'::jsonb, decode(repeat('c1', 32), 'hex'),
  'global_approved', now()
);

update public.profiles
set status = 'deletion_requested', deletion_requested_at = now()
where id = '51000000-0000-4000-8000-000000016101';

delete from public.profile_access
where profile_id = '51000000-0000-4000-8000-000000016101';

insert into private.deletion_jobs (
  id, profile_id, profile_marker, request_handle_hash,
  requester_actor_id, confirmed_by
) values (
  '16000000-0000-4000-8000-000000016101',
  '51000000-0000-4000-8000-000000016101',
  decode(repeat('d1', 32), 'hex'), decode(repeat('d2', 32), 'hex'),
  '31000000-0000-4000-8000-000000016101',
  '31000000-0000-4000-8000-000000016101'
);

update private.deletion_jobs
set status = 'purged', completed_at = now()
where id = '16000000-0000-4000-8000-000000016101';

select ok(
  not exists (
    select 1 from public.commercial_product_revisions revision
    where revision.owner_profile_id = '51000000-0000-4000-8000-000000016101'
  )
  and exists (
    select 1 from public.commercial_product_revisions revision
    where revision.id = '15000000-0000-4000-8000-000000016101'
      and revision.owner_profile_id is null
      and revision.status = 'global_approved'
  ),
  'DeletionJob purga lo privado y conserva la revisión global sin perfil'
);

select * from finish();

rollback;
