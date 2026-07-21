begin;

select no_plan();

select ok(
  to_regclass('private.commercial_product_admin_idempotency') is not null
  and to_regprocedure(
    'public.internal_admin_correct_barcode_correction(uuid,uuid,uuid,integer,jsonb,text,jsonb,uuid,bigint,timestamptz,bytea,bytea,integer,bytea)'
  ) is not null
  and to_regprocedure(
    'public.internal_admin_approve_barcode_correction(uuid,uuid,uuid,integer,text,text,jsonb,uuid,bigint,timestamptz,bytea,bytea,integer,bytea)'
  ) is not null
  and to_regprocedure(
    'public.internal_admin_reject_barcode_correction(uuid,uuid,uuid,integer,text,uuid,bigint,timestamptz,bytea,bytea,integer,bytea)'
  ) is not null
  and to_regprocedure(
    'public.internal_admin_activate_product_matching_rule(uuid,uuid,uuid,integer,uuid,bigint,timestamptz,bytea,bytea,integer,bytea)'
  ) is not null,
  'T16D instala mutaciones cerradas e idempotencia privada'
);

select ok(
  not has_table_privilege(
    'service_role',
    'private.commercial_product_admin_idempotency',
    'SELECT,INSERT,UPDATE,DELETE'
  )
  and has_function_privilege(
    'service_role',
    'public.internal_admin_list_barcode_corrections(uuid,uuid,text,uuid,integer)',
    'EXECUTE'
  ),
  'la cola y la idempotencia solo son accesibles mediante RPC cerrada'
);

insert into auth.users (
  instance_id, id, aud, role, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at, is_anonymous
) values (
  '00000000-0000-0000-0000-000000000000',
  '00000000-0000-4000-8000-000000016301',
  'authenticated', 'authenticated',
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{}'::jsonb, now(), now(), false
);

insert into auth.sessions (id, user_id, created_at, updated_at, aal)
values
  (
    '21000000-0000-4000-8000-000000016301',
    '00000000-0000-4000-8000-000000016301', now(), now(), 'aal2'
  ),
  (
    '21000000-0000-4000-8000-000000016302',
    '00000000-0000-4000-8000-000000016301', now(), now(), 'aal1'
  );

insert into public.actors (id, auth_subject, role)
values (
  '31000000-0000-4000-8000-000000016301',
  '00000000-0000-4000-8000-000000016301',
  'superadmin'
);

insert into public.profiles (id, alias, timezone, adult_attested_at)
values (
  '51000000-0000-4000-8000-000000016301',
  'Admin productos T16', 'Europe/Madrid', now()
);

insert into public.canonical_foods (
  id, food_key, name, category, food_state, edible_part, active
) values (
  '71000000-0000-4000-8000-000000016301',
  'food:t16.admin', 'Alimento T16 admin', 'protein', 'raw', 'whole', true
);

insert into public.commercial_products (id, gtin14)
values
  ('81000000-0000-4000-8000-000000016301', '08412345678905'),
  ('81000000-0000-4000-8000-000000016302', '08412345678912');

insert into public.commercial_product_manifests (
  id, source_kind, normalized_content_hash
) values
  (
    '82000000-0000-4000-8000-000000016301',
    'profile_correction', decode(repeat('31', 32), 'hex')
  ),
  (
    '82000000-0000-4000-8000-000000016302',
    'profile_correction', decode(repeat('32', 32), 'hex')
  );

create temporary table admin_product_snapshot as
select jsonb_build_object(
  'schemaVersion', 1,
  'basis', 'per_100_g',
  'density', jsonb_build_object('state', 'unknown'),
  'gtin', jsonb_build_object(
    'displayGtin', '8412345678905',
    'gtin14', '08412345678905',
    'symbology', 'ean_13'
  ),
  'name', 'Producto administrativo',
  'nutrients', jsonb_build_object(
    'energyKcal', jsonb_build_object('state', 'known', 'unit', 'kcal', 'value', '100'),
    'fatG', jsonb_build_object('state', 'known', 'unit', 'g', 'value', '2'),
    'saturatedFatG', jsonb_build_object('state', 'known', 'unit', 'g', 'value', '1'),
    'carbohydratesG', jsonb_build_object('state', 'known', 'unit', 'g', 'value', '10'),
    'sugarsG', jsonb_build_object('state', 'known', 'unit', 'g', 'value', '1'),
    'proteinG', jsonb_build_object('state', 'known', 'unit', 'g', 'value', '20'),
    'saltG', jsonb_build_object('state', 'known', 'unit', 'g', 'value', '0.2'),
    'fiberG', jsonb_build_object('state', 'known', 'unit', 'g', 'value', '3'),
    'clinical', '{}'::jsonb
  ),
  'safety', jsonb_build_object(
    'ingredients', jsonb_build_object('state', 'known', 'values', jsonb_build_array('Ingrediente')),
    'allergens', jsonb_build_object('state', 'known', 'values', '[]'::jsonb),
    'crossContactAllergens', jsonb_build_object('state', 'known', 'values', '[]'::jsonb)
  )
) as snapshot;

insert into public.commercial_product_revisions (
  id, product_id, manifest_id, owner_profile_id, source_kind, snapshot,
  completeness, uncertainties, content_hash, status
) values
  (
    '83000000-0000-4000-8000-000000016301',
    '81000000-0000-4000-8000-000000016301',
    '82000000-0000-4000-8000-000000016301',
    '51000000-0000-4000-8000-000000016301',
    'profile_correction', (select snapshot from admin_product_snapshot),
    'complete', '[]'::jsonb, decode(repeat('31', 32), 'hex'), 'profile_confirmed'
  ),
  (
    '83000000-0000-4000-8000-000000016302',
    '81000000-0000-4000-8000-000000016302',
    '82000000-0000-4000-8000-000000016302',
    '51000000-0000-4000-8000-000000016301',
    'profile_correction',
    jsonb_set(
      jsonb_set(
        (select snapshot from admin_product_snapshot),
        '{gtin,gtin14}', '"08412345678912"'::jsonb
      ),
      '{gtin,displayGtin}', '"8412345678912"'::jsonb
    ),
    'complete', '[]'::jsonb, decode(repeat('32', 32), 'hex'), 'profile_confirmed'
  );

insert into public.barcode_corrections (
  id, profile_id, product_id, revision_id, proposed_by, snapshot_hash
) values
  (
    '84000000-0000-4000-8000-000000016301',
    '51000000-0000-4000-8000-000000016301',
    '81000000-0000-4000-8000-000000016301',
    '83000000-0000-4000-8000-000000016301',
    '31000000-0000-4000-8000-000000016301', decode(repeat('31', 32), 'hex')
  ),
  (
    '84000000-0000-4000-8000-000000016302',
    '51000000-0000-4000-8000-000000016301',
    '81000000-0000-4000-8000-000000016302',
    '83000000-0000-4000-8000-000000016302',
    '31000000-0000-4000-8000-000000016301', decode(repeat('32', 32), 'hex')
  );

select throws_ok(
  $$
    select * from public.internal_admin_list_barcode_corrections(
      '00000000-0000-4000-8000-000000016301',
      '21000000-0000-4000-8000-000000016302',
      'pending', null, 10
    )
  $$,
  '42501',
  'aal2_required',
  'AAL1 no puede leer la cola administrativa'
);

select is(
  (
    select count(*)::integer
    from public.internal_admin_list_barcode_corrections(
      '00000000-0000-4000-8000-000000016301',
      '21000000-0000-4000-8000-000000016301',
      'pending', null, 10
    )
  ),
  2,
  'AAL2 puede listar correcciones pendientes'
);

create temporary table corrected as
select public.internal_admin_correct_barcode_correction(
  '00000000-0000-4000-8000-000000016301',
  '21000000-0000-4000-8000-000000016301',
  '84000000-0000-4000-8000-000000016301',
  1,
  jsonb_set(
    (select snapshot from admin_product_snapshot),
    '{nutrients,proteinG,value}', '"21"'::jsonb
  ),
  'complete', '[]'::jsonb,
  '85000000-0000-4000-8000-000000016301',
  16301, clock_timestamp(), decode(repeat('41', 32), 'hex'),
  decode(repeat('42', 64), 'hex'), 1, decode(repeat('43', 32), 'hex')
) as response;

select is(
  (select response ->> 'version' from corrected),
  '2',
  'corregir crea una revisión global candidata y avanza versión'
);

select is(
  public.internal_admin_correct_barcode_correction(
    '00000000-0000-4000-8000-000000016301',
    '21000000-0000-4000-8000-000000016301',
    '84000000-0000-4000-8000-000000016301',
    1,
    jsonb_set(
      (select snapshot from admin_product_snapshot),
      '{nutrients,proteinG,value}', '"21"'::jsonb
    ),
    'complete', '[]'::jsonb,
    '85000000-0000-4000-8000-000000016301',
    16301, clock_timestamp(), decode(repeat('41', 32), 'hex'),
    decode(repeat('42', 64), 'hex'), 1, decode(repeat('43', 32), 'hex')
  ),
  (select response from corrected),
  'la repetición exacta devuelve el mismo resultado sin duplicar'
);

create temporary table approved as
select public.internal_admin_approve_barcode_correction(
  '00000000-0000-4000-8000-000000016301',
  '21000000-0000-4000-8000-000000016301',
  '84000000-0000-4000-8000-000000016301',
  2, 'food:t16.admin', 'exact', '["revisión_etiqueta_v1"]'::jsonb,
  '85000000-0000-4000-8000-000000016302',
  16302, clock_timestamp(), decode(repeat('44', 32), 'hex'),
  decode(repeat('45', 64), 'hex'), 1, decode(repeat('46', 32), 'hex')
) as response;

select ok(
  (select response ->> 'status' from approved) = 'approved'
  and (select response ->> 'matchingRuleId' from approved) is not null
  and exists (
    select 1 from public.commercial_product_revisions revision
    where revision.id = (
      select (response ->> 'globalRevisionId')::uuid from approved
    ) and revision.status = 'global_approved'
  ),
  'aprobar publica una revisión global y deja matching en borrador'
);

create temporary table activated as
select public.internal_admin_activate_product_matching_rule(
  '00000000-0000-4000-8000-000000016301',
  '21000000-0000-4000-8000-000000016301',
  (select (response ->> 'matchingRuleId')::uuid from approved),
  1,
  '85000000-0000-4000-8000-000000016303',
  16303, clock_timestamp(), decode(repeat('47', 32), 'hex'),
  decode(repeat('48', 64), 'hex'), 1, decode(repeat('49', 32), 'hex')
) as response;

select is(
  (select response ->> 'status' from activated),
  'active',
  'el matching solo se activa mediante una segunda acción manual'
);

select is(
  public.internal_admin_reject_barcode_correction(
    '00000000-0000-4000-8000-000000016301',
    '21000000-0000-4000-8000-000000016301',
    '84000000-0000-4000-8000-000000016302',
    1, 'invalid_data',
    '85000000-0000-4000-8000-000000016304',
    16304, clock_timestamp(), decode(repeat('4a', 32), 'hex'),
    decode(repeat('4b', 64), 'hex'), 1, decode(repeat('4c', 32), 'hex')
  ) ->> 'status',
  'rejected',
  'rechazar usa un motivo técnico cerrado'
);

select ok(
  (
    select array_agg(distinct event.action order by event.action)
    from private.technical_audit_events event
    where event.request_id in (
      '85000000-0000-4000-8000-000000016301',
      '85000000-0000-4000-8000-000000016302',
      '85000000-0000-4000-8000-000000016303',
      '85000000-0000-4000-8000-000000016304'
    ) and event.phase = 'intent'
  ) = array[
    'barcode_correction_approve',
    'barcode_correction_correct',
    'barcode_correction_reject',
    'matching_rule_activate'
  ]::text[]
  and (
    select bool_and(
      event.previous_state_hash is not null and event.new_state_hash is not null
    )
    from private.technical_audit_events event
    where event.request_id in (
      '85000000-0000-4000-8000-000000016301',
      '85000000-0000-4000-8000-000000016302',
      '85000000-0000-4000-8000-000000016303',
      '85000000-0000-4000-8000-000000016304'
    ) and event.phase = 'intent'
  ),
  'las cuatro mutaciones conservan intent y hashes anterior/nuevo sin snapshot clínico'
);

select * from finish();

rollback;
