begin;

select no_plan();

select ok(
  to_regclass('private.supermarket_sku_matching_rule_revisions') is not null
  and to_regclass('private.basket_seed_revisions') is not null
  and to_regclass('private.basket_seed_items') is not null
  and to_regclass('private.catalog_publications') is not null,
  'T17B persiste matching, semilla 60 + 20 y publicaciones independientes'
);

select ok(
  to_regprocedure(
    'public.internal_create_basket_seed_revision(text,jsonb,jsonb,jsonb,bytea)'
  ) is not null
  and to_regprocedure(
    'public.internal_create_supermarket_matching_rule(uuid,text,text,text,text,text,jsonb,jsonb,jsonb,uuid)'
  ) is not null
  and to_regprocedure(
    'private.supermarket_catalog_publication_context(uuid,uuid)'
  ) is not null,
  'semillas, borradores y cobertura pasan por funciones cerradas'
);

select ok(
  not has_table_privilege(
    'authenticated',
    'private.supermarket_sku_matching_rule_revisions',
    'SELECT,INSERT,UPDATE,DELETE'
  )
  and not has_table_privilege(
    'service_role', 'private.catalog_publications', 'SELECT,INSERT,UPDATE,DELETE'
  )
  and has_function_privilege(
    'service_role',
    'public.internal_create_supermarket_matching_rule(uuid,text,text,text,text,text,jsonb,jsonb,jsonb,uuid)',
    'EXECUTE'
  ),
  'matching y publicación no admiten acceso directo de cliente o servicio'
);

insert into auth.users (
  instance_id, id, aud, role, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at, is_anonymous
) values (
  '00000000-0000-0000-0000-000000000000',
  '00000000-0000-4000-8000-000000017201',
  'authenticated', 'authenticated',
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{}'::jsonb, now(), now(), false
);

insert into public.actors (id, auth_subject, role)
values (
  '31000000-0000-4000-8000-000000017201',
  '00000000-0000-4000-8000-000000017201',
  'superadmin'
);

create temporary table seed_source as
select
  item_number,
  case
    when item_number <= 22 then 'protein'
    when item_number <= 39 then 'vegetable'
    when item_number <= 52 then 'fruit'
    when item_number <= 66 then 'carbohydrate'
    when item_number <= 74 then 'dairy_alternative'
    else 'fat'
  end group_key,
  format('food:test-t17b-%s', lpad(item_number::text, 3, '0')) food_key
from generate_series(1, 80) item_number;

insert into public.canonical_foods (
  food_key, name, category, food_state, edible_part, active
)
select food_key, format('Alimento T17B %s', item_number), group_key,
  'raw', 'whole', true
from seed_source;

create temporary table seed_payload as
select
  jsonb_agg(jsonb_build_object(
    'canonicalFoodKey', food_key,
    'ediblePart', 'whole',
    'foodState', 'raw',
    'group', group_key,
    'purchaseForm', 'fresh'
  ) order by item_number) filter (where item_number <= 60) fixed_items,
  jsonb_agg(jsonb_build_object(
    'canonicalFoodKey', food_key,
    'ediblePart', 'whole',
    'foodState', 'raw',
    'group', group_key,
    'purchaseForm', 'fresh'
  ) order by item_number) filter (where item_number > 60) dynamic_items
from seed_source;

select throws_ok(
  $$
    select public.internal_create_basket_seed_revision(
      'invalid-seed', '[]'::jsonb, '[]'::jsonb,
      '{"from":"2026-06-01","to":"2026-06-30"}'::jsonb,
      decode(repeat('20', 32), 'hex')
    )
  $$,
  '22023',
  'invalid_basket_seed',
  'la semilla rechaza cualquier cardinalidad distinta de 60 + 20'
);

create temporary table active_seed as
select public.internal_create_basket_seed_revision(
  't17-basket-db-v1', fixed_items, dynamic_items,
  '{"from":"2026-06-01","to":"2026-06-30"}'::jsonb,
  decode(repeat('21', 32), 'hex')
) seed_id
from seed_payload;

select public.internal_activate_basket_seed_revision(seed_id) from active_seed;

select ok(
  (select count(*) from private.basket_seed_items item
    join active_seed seed on seed.seed_id = item.basket_seed_revision_id
    where item.seed_kind = 'fixed') = 60
  and (select count(*) from private.basket_seed_items item
    join active_seed seed on seed.seed_id = item.basket_seed_revision_id
    where item.seed_kind = 'dynamic') = 20
  and (select status from private.basket_seed_revisions seed_revision
    join active_seed seed on seed.seed_id = seed_revision.id) = 'active',
  'la revisión activa conserva exactamente 60 fijos y 20 dinámicos'
);

create temporary table catalog_records as
select jsonb_agg(jsonb_build_object(
  'externalSku', format('sku-%s', lpad(item_number::text, 3, '0')),
  'gtin14', case when item_number = 1 then '08412345678905' else null end,
  'name', format('Producto T17B %s', item_number),
  'categoryPath', jsonb_build_array(group_key),
  'formatText', '500 g',
  'purchaseForm', 'fresh',
  'package', jsonb_build_object(
    'saleMeasure', jsonb_build_object(
      'dimension', 'mass', 'quantity', '500', 'unit', 'g'
    ),
    'equivalentEdibleMassG', null,
    'equivalenceEvidenceRef', null
  ),
  'equivalentEdibleMassG', null,
  'equivalenceEvidence', null,
  'basePriceEur', '2.50',
  'normalizedPrice', jsonb_build_object(
    'dimension', 'mass', 'unit', 'EUR/kg', 'value', '5'
  ),
  'sourceFields', jsonb_build_object('fixture', item_number::text),
  'usability', 'calculable',
  'exclusionReasons', '[]'::jsonb,
  'contentHash', encode(
    extensions.digest(convert_to('content-' || item_number, 'utf8'), 'sha256'),
    'hex'
  )
) order by item_number) records
from seed_source;

create temporary table unknown_catalog as
select public.internal_import_supermarket_catalog(
  jsonb_build_object(
    'market', 'ES', 'chain', 'mercadona', 'sourceKind', 'json_capture',
    'sourceLocationInternal', 'postal-code:41006',
    'collectedAt', '2026-07-21T18:00:00+00:00',
    'importerVersion', 'supermarket-import-v1',
    'canonicalizationVersion', 'supermarket-canonical-v1',
    'rawObjectRef', 'opaque/raw/unknown',
    'normalizedObjectRef', 'opaque/normalized/unknown',
    'captureEvidenceRef', 'opaque/evidence/unknown',
    'errorEvidenceRef', null,
    'rawSha256', repeat('31', 32),
    'normalizedSha256', repeat('32', 32),
    'importKey', repeat('33', 32),
    'recordCount', 80, 'priceCount', 80, 'errorCount', 0,
    'coverage', '{}'::jsonb,
    'licenseStatus', 'unknown', 'sourceTermsStatus', 'unknown'
  ),
  jsonb_build_object(
    'revisionNumber', 1, 'recordCount', 80, 'usableCount', 80,
    'observedAt', '2026-07-21T18:00:00+00:00'
  ),
  records
) response
from catalog_records;

create temporary table approved_catalog as
select public.internal_import_supermarket_catalog(
  jsonb_build_object(
    'market', 'ES', 'chain', 'mercadona', 'sourceKind', 'json_capture',
    'sourceLocationInternal', 'postal-code:41006',
    'collectedAt', '2026-07-21T19:00:00+00:00',
    'importerVersion', 'supermarket-import-v1',
    'canonicalizationVersion', 'supermarket-canonical-v1',
    'rawObjectRef', 'opaque/raw/approved',
    'normalizedObjectRef', 'opaque/normalized/approved',
    'captureEvidenceRef', 'opaque/evidence/approved',
    'errorEvidenceRef', null,
    'rawSha256', repeat('34', 32),
    'normalizedSha256', repeat('35', 32),
    'importKey', repeat('36', 32),
    'recordCount', 80, 'priceCount', 80, 'errorCount', 0,
    'coverage', '{}'::jsonb,
    'licenseStatus', 'approved', 'sourceTermsStatus', 'approved'
  ),
  jsonb_build_object(
    'revisionNumber', 2, 'recordCount', 80, 'usableCount', 80,
    'observedAt', '2026-07-21T19:00:00+00:00'
  ),
  records
) response
from catalog_records;

create temporary table draft_rules as
select source.item_number, public.internal_create_supermarket_matching_rule(
  sku.id,
  source.food_key,
  'exact', 'raw', 'fresh', 'whole',
  jsonb_build_object('fixture', true),
  jsonb_build_array('manual-review'),
  '[]'::jsonb,
  '31000000-0000-4000-8000-000000017201'
) rule_id
from seed_source source
join private.supermarket_skus sku
  on sku.market = 'ES'
  and sku.chain = 'mercadona'
  and sku.external_sku = format('sku-%s', lpad(source.item_number::text, 3, '0'));

select private.activate_supermarket_matching_rule(
  rule_id, '31000000-0000-4000-8000-000000017201', 1
)
from draft_rules
where item_number not in (1, 2, 3, 4, 5, 23, 40, 53, 75);

create temporary table coverage_71 as
select private.supermarket_catalog_publication_context(
  (select (response ->> 'catalogRevisionId')::uuid from approved_catalog),
  (select seed_id from active_seed)
) context;

select ok(
  (select (context #>> '{coverage,totalUsable}')::integer from coverage_71) = 71
  and (select (context #>> '{coverage,publishable}')::boolean from coverage_71) is false,
  '71/80 falla aunque los grupos restantes respeten su mínimo'
);

select throws_ok(
  $$
    select private.publish_supermarket_catalog(
      (select (response ->> 'catalogRevisionId')::uuid from approved_catalog),
      (select seed_id from active_seed),
      '31000000-0000-4000-8000-000000017201',
      'development_approved',
      decode((select context ->> 'catalogHash' from coverage_71), 'hex'),
      decode((select context ->> 'seedHash' from coverage_71), 'hex'),
      decode((select context ->> 'coverageHash' from coverage_71), 'hex')
    )
  $$,
  '55000',
  'catalog_publication_gate_failed',
  'la base no publica por debajo de 72/80'
);

select private.activate_supermarket_matching_rule(
  rule_id, '31000000-0000-4000-8000-000000017201', 1
)
from draft_rules where item_number = 75;

create temporary table coverage_72 as
select private.supermarket_catalog_publication_context(
  (select (response ->> 'catalogRevisionId')::uuid from approved_catalog),
  (select seed_id from active_seed)
) context;

select ok(
  (select (context #>> '{coverage,totalUsable}')::integer from coverage_72) = 72
  and (select (context #>> '{coverage,publishable}')::boolean from coverage_72) is true
  and not exists (
    select 1
    from jsonb_array_elements(
      (select context #> '{coverage,groups}' from coverage_72)
    ) group_row
    where (group_row ->> 'usable')::integer * 4
      < (group_row ->> 'required')::integer * 3
  ),
  '72/80 publica únicamente con todos los grupos en al menos 75 por ciento'
);

select throws_ok(
  $$
    select private.publish_supermarket_catalog(
      (select (response ->> 'catalogRevisionId')::uuid from unknown_catalog),
      (select seed_id from active_seed),
      '31000000-0000-4000-8000-000000017201',
      'development_approved',
      decode((select context ->> 'catalogHash' from coverage_72), 'hex'),
      decode((select context ->> 'seedHash' from coverage_72), 'hex'),
      decode((
        select private.supermarket_catalog_publication_context(
          (select (response ->> 'catalogRevisionId')::uuid from unknown_catalog),
          (select seed_id from active_seed)
        ) ->> 'coverageHash'
      ), 'hex')
    )
  $$,
  '40001',
  'stale_catalog_publication_context',
  'hashes de otra revisión no pueden autorizar una publicación'
);

create temporary table unknown_coverage as
select private.supermarket_catalog_publication_context(
  (select (response ->> 'catalogRevisionId')::uuid from unknown_catalog),
  (select seed_id from active_seed)
) context;

select throws_ok(
  $$
    select private.publish_supermarket_catalog(
      (select (response ->> 'catalogRevisionId')::uuid from unknown_catalog),
      (select seed_id from active_seed),
      '31000000-0000-4000-8000-000000017201',
      'development_approved',
      decode((select context ->> 'catalogHash' from unknown_coverage), 'hex'),
      decode((select context ->> 'seedHash' from unknown_coverage), 'hex'),
      decode((select context ->> 'coverageHash' from unknown_coverage), 'hex')
    )
  $$,
  '55000',
  'catalog_source_decision_required',
  'licencia o términos unknown bloquean publicación real'
);

create temporary table publication as
select private.publish_supermarket_catalog(
  (select (response ->> 'catalogRevisionId')::uuid from approved_catalog),
  (select seed_id from active_seed),
  '31000000-0000-4000-8000-000000017201',
  'development_approved',
  decode((select context ->> 'catalogHash' from coverage_72), 'hex'),
  decode((select context ->> 'seedHash' from coverage_72), 'hex'),
  decode((select context ->> 'coverageHash' from coverage_72), 'hex')
) response;

select ok(
  (select response ->> 'status' from publication) = 'active'
  and (select count(*) from private.catalog_publications where hidden_at is null) = 1
  and (
    select count(*) from public.internal_list_published_supermarket_catalog(
      'mercadona', null, 100
    )
  ) = 80,
  'la publicación aprobada expone la revisión completa sin metadatos internos'
);

select private.hide_supermarket_catalog_publication(
  (select (response ->> 'catalogPublicationId')::uuid from publication),
  '31000000-0000-4000-8000-000000017201'
);

select ok(
  (select count(*) from private.catalog_publications) = 1
  and (select count(*) from private.catalog_publications where hidden_at is null) = 0
  and (
    select count(*) from public.internal_list_published_supermarket_catalog(
      'mercadona', null, 100
    )
  ) = 0,
  'hide conserva el historial y retira únicamente la lectura activa'
);

insert into public.commercial_products (id, gtin14)
values ('81000000-0000-4000-8000-000000017201', '08412345678905');

insert into public.product_matching_rule_revisions (
  product_id, canonical_food_id, match_state, criteria, exclusions, evidence,
  status, activated_at
)
select
  '81000000-0000-4000-8000-000000017201', food.id, 'exact', '{}'::jsonb,
  '[]'::jsonb, '["fixture"]'::jsonb, 'active', now()
from public.canonical_foods food
where food.food_key = 'food:test-t17b-002';

create temporary table gtin_conflict as
select public.internal_create_supermarket_matching_rule(
  sku.id, 'food:test-t17b-001', 'exact', 'raw', 'fresh', 'whole',
  '{}'::jsonb, '["manual-review"]'::jsonb, '[]'::jsonb,
  '31000000-0000-4000-8000-000000017201'
) rule_id
from private.supermarket_skus sku
where sku.market = 'ES' and sku.chain = 'mercadona' and sku.external_sku = 'sku-001';

select ok(
  exists (
    select 1
    from private.supermarket_sku_matching_rule_revisions rule
    join gtin_conflict conflict on conflict.rule_id = rule.id
    where rule.match_state = 'review' and rule.gtin_consistency = 'conflict'
  ),
  'una discrepancia con el matching GTIN T16 fuerza review sin sobrescribirlo'
);

select * from finish();

rollback;
