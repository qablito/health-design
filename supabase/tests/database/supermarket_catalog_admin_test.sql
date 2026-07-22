begin;

select no_plan();

select ok(
  to_regclass('private.supermarket_catalog_admin_idempotency') is not null
  and to_regclass('private.supermarket_match_generation_marks') is not null
  and to_regprocedure(
    'public.internal_admin_list_supermarket_catalog_revisions(uuid,uuid,text,text,uuid,integer)'
  ) is not null
  and to_regprocedure(
    'public.internal_admin_publish_supermarket_catalog(uuid,uuid,uuid,integer,text,bytea,bytea,bytea,uuid,bigint,timestamptz,bytea,bytea,integer,bytea)'
  ) is not null,
  'T17B instala administración cerrada, concurrencia e idempotencia privada'
);

select ok(
  not has_table_privilege(
    'service_role', 'private.supermarket_catalog_admin_idempotency',
    'SELECT,INSERT,UPDATE,DELETE'
  )
  and not has_table_privilege(
    'service_role', 'private.supermarket_match_generation_marks',
    'SELECT,INSERT,UPDATE,DELETE'
  )
  and has_function_privilege(
    'service_role',
    'public.internal_admin_list_supermarket_catalog_revisions(uuid,uuid,text,text,uuid,integer)',
    'EXECUTE'
  ),
  'el servicio usa RPC y no accede directamente a la idempotencia'
);

insert into auth.users (
  instance_id, id, aud, role, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at, is_anonymous
) values (
  '00000000-0000-0000-0000-000000000000',
  '00000000-0000-4000-8000-000000017301',
  'authenticated', 'authenticated',
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{}'::jsonb, now(), now(), false
);

insert into auth.sessions (id, user_id, created_at, updated_at, aal)
values
  (
    '21000000-0000-4000-8000-000000017301',
    '00000000-0000-4000-8000-000000017301', now(), now(), 'aal2'
  ),
  (
    '21000000-0000-4000-8000-000000017302',
    '00000000-0000-4000-8000-000000017301', now(), now(), 'aal1'
  );

insert into public.actors (id, auth_subject, role)
values (
  '31000000-0000-4000-8000-000000017301',
  '00000000-0000-4000-8000-000000017301', 'superadmin'
);

create temporary table admin_seed_source as
select item_number,
  case
    when item_number <= 22 then 'protein'
    when item_number <= 39 then 'vegetable'
    when item_number <= 52 then 'fruit'
    when item_number <= 66 then 'carbohydrate'
    when item_number <= 74 then 'dairy_alternative'
    else 'fat'
  end group_key,
  format('food:test-t17-admin-%s', lpad(item_number::text, 3, '0')) food_key,
  format('Alimento admin %s', lpad(item_number::text, 3, '0')) food_name
from generate_series(1, 80) item_number;

insert into public.canonical_foods (
  food_key, name, category, food_state, edible_part, active
)
select food_key, food_name, group_key, 'raw', 'whole', true
from admin_seed_source;

create temporary table admin_seed_payload as
select
  jsonb_agg(jsonb_build_object(
    'canonicalFoodKey', food_key, 'ediblePart', 'whole', 'foodState', 'raw',
    'group', group_key, 'purchaseForm', 'fresh'
  ) order by item_number) filter (where item_number <= 60) fixed_items,
  jsonb_agg(jsonb_build_object(
    'canonicalFoodKey', food_key, 'ediblePart', 'whole', 'foodState', 'raw',
    'group', group_key, 'purchaseForm', 'fresh'
  ) order by item_number) filter (where item_number > 60) dynamic_items
from admin_seed_source;

create temporary table admin_active_seed as
select public.internal_create_basket_seed_revision(
  't17-admin-seed-v1', fixed_items, dynamic_items,
  '{"from":"2026-06-01","to":"2026-06-30"}'::jsonb,
  decode(repeat('71', 32), 'hex')
) seed_id
from admin_seed_payload;

select public.internal_activate_basket_seed_revision(seed_id)
from admin_active_seed;

create temporary table admin_catalog_records as
select jsonb_agg(jsonb_build_object(
  'externalSku', format('admin-sku-%s', lpad(item_number::text, 3, '0')),
  'gtin14', null,
  'name', food_name || ' envase',
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
    extensions.digest(convert_to('admin-content-' || item_number, 'utf8'), 'sha256'),
    'hex'
  )
) order by item_number) records
from admin_seed_source;

create temporary table admin_catalog as
select public.internal_import_supermarket_catalog(
  jsonb_build_object(
    'market', 'ES', 'chain', 'mercadona', 'sourceKind', 'json_capture',
    'sourceLocationInternal', 'postal-code:41006',
    'collectedAt', '2026-07-21T20:00:00+00:00',
    'importerVersion', 'supermarket-import-v1',
    'canonicalizationVersion', 'supermarket-canonical-v1',
    'rawObjectRef', 'opaque/raw/admin',
    'normalizedObjectRef', 'opaque/normalized/admin',
    'captureEvidenceRef', 'opaque/evidence/admin',
    'errorEvidenceRef', 'opaque/errors/admin',
    'rawSha256', repeat('72', 32),
    'normalizedSha256', repeat('73', 32),
    'importKey', repeat('74', 32),
    'recordCount', 80, 'priceCount', 80, 'errorCount', 2,
    'coverage', '{}'::jsonb,
    'licenseStatus', 'approved', 'sourceTermsStatus', 'approved'
  ),
  jsonb_build_object(
    'revisionNumber', 1, 'recordCount', 80, 'usableCount', 80,
    'observedAt', '2026-07-21T20:00:00+00:00'
  ),
  records
) response
from admin_catalog_records;

create temporary table admin_active_rules as
select source.item_number, public.internal_create_supermarket_matching_rule(
  sku.id, source.food_key, 'exact', 'raw', 'fresh', 'whole',
  jsonb_build_object(
    'fixture', true,
    'catalogRevisionId', (select response ->> 'catalogRevisionId' from admin_catalog),
    'skuContentHash', encode(sku_revision.content_hash, 'hex')
  ), jsonb_build_array('manual-review'),
  '[]'::jsonb, '31000000-0000-4000-8000-000000017301'
) rule_id
from admin_seed_source source
join private.supermarket_skus sku
  on sku.market = 'ES' and sku.chain = 'mercadona'
  and sku.external_sku = format('admin-sku-%s', lpad(source.item_number::text, 3, '0'))
join private.supermarket_sku_revisions sku_revision
  on sku_revision.sku_id = sku.id
  and sku_revision.catalog_revision_id =
    (select (response ->> 'catalogRevisionId')::uuid from admin_catalog);

select private.activate_supermarket_matching_rule(
  rule_id, '31000000-0000-4000-8000-000000017301', 1
)
from admin_active_rules;

select throws_ok(
  $$
    select * from public.internal_admin_list_supermarket_catalog_revisions(
      '00000000-0000-4000-8000-000000017301',
      '21000000-0000-4000-8000-000000017302',
      'mercadona', null, null, 10
    )
  $$,
  '42501', 'aal2_required',
  'AAL1 no puede consultar revisiones administrativas'
);

select ok(
  (
    select coverage ->> 'totalRequired'
    from public.internal_admin_list_supermarket_catalog_revisions(
      '00000000-0000-4000-8000-000000017301',
      '21000000-0000-4000-8000-000000017301',
      'mercadona', 'publishable', null, 10
    )
  ) = '80'
  and (
    select error_count
    from public.internal_admin_list_supermarket_catalog_revisions(
      '00000000-0000-4000-8000-000000017301',
      '21000000-0000-4000-8000-000000017301',
      'mercadona', 'publishable', null, 10
    )
  ) = 2,
  'el panel recibe cobertura 80, grupos, errores y manifest sin referencias privadas'
);

create temporary table admin_candidate_payload as
select jsonb_agg(jsonb_build_object(
  'skuId', sku.id,
  'skuContentHash', encode(sku_revision.content_hash, 'hex'),
  'canonicalFoodKey', source.food_key,
  'matchState', 'review',
  'foodState', 'raw',
  'purchaseForm', 'fresh',
  'ediblePart', 'whole',
  'criteria', jsonb_build_array('name_words'),
  'evidence', jsonb_build_array('deterministic-candidate'),
  'exclusions', '[]'::jsonb
) order by source.item_number) candidates
from admin_seed_source source
join private.supermarket_skus sku
  on sku.market = 'ES' and sku.chain = 'mercadona'
  and sku.external_sku = format('admin-sku-%s', lpad(source.item_number::text, 3, '0'))
join private.supermarket_sku_revisions sku_revision
  on sku_revision.sku_id = sku.id
  and sku_revision.catalog_revision_id =
    (select (response ->> 'catalogRevisionId')::uuid from admin_catalog)
where source.item_number <= 10;

create temporary table admin_processed_skus as
select jsonb_agg(jsonb_build_object(
  'skuId', sku.id,
  'skuContentHash', encode(sku_revision.content_hash, 'hex')
) order by source.item_number) processed_skus
from admin_seed_source source
join private.supermarket_skus sku
  on sku.market = 'ES' and sku.chain = 'mercadona'
  and sku.external_sku = format('admin-sku-%s', lpad(source.item_number::text, 3, '0'))
join private.supermarket_sku_revisions sku_revision
  on sku_revision.sku_id = sku.id
  and sku_revision.catalog_revision_id =
    (select (response ->> 'catalogRevisionId')::uuid from admin_catalog)
where source.item_number <= 10;

create temporary table admin_candidates as
select public.internal_admin_generate_supermarket_match_candidates(
  '00000000-0000-4000-8000-000000017301',
  '21000000-0000-4000-8000-000000017301',
  (select (response ->> 'catalogRevisionId')::uuid from admin_catalog),
  1, (select seed_id from admin_active_seed),
  (select candidates from admin_candidate_payload),
  (select processed_skus from admin_processed_skus),
  '85000000-0000-4000-8000-000000017301',
  17301, clock_timestamp(), decode(repeat('74', 32), 'hex'),
  decode(repeat('75', 64), 'hex'), 1, decode(repeat('76', 32), 'hex')
) response;

select is(
  (select (response ->> 'candidatesCreated')::integer from admin_candidates),
  10,
  'los candidatos deterministas permanecen en revisión manual'
);

select is(
  public.internal_admin_generate_supermarket_match_candidates(
    '00000000-0000-4000-8000-000000017301',
    '21000000-0000-4000-8000-000000017301',
    (select (response ->> 'catalogRevisionId')::uuid from admin_catalog),
    1, (select seed_id from admin_active_seed), '[]'::jsonb, '[]'::jsonb,
    '85000000-0000-4000-8000-000000017301',
    17301, clock_timestamp(), decode(repeat('74', 32), 'hex'),
    decode(repeat('75', 64), 'hex'), 1, decode(repeat('76', 32), 'hex')
  ),
  (select response from admin_candidates),
  'el replay concurrente o posterior conserva el ACK aunque el siguiente lote cambie'
);

select throws_ok(
  format(
    $$select public.internal_admin_generate_supermarket_match_candidates(
      '00000000-0000-4000-8000-000000017301',
      '21000000-0000-4000-8000-000000017301', '%s', 1, '%s',
      %L::jsonb, %L::jsonb,
      '85000000-0000-4000-8000-000000017306', 17306, clock_timestamp(),
      decode(repeat('83',32),'hex'), decode(repeat('84',64),'hex'), 1,
      decode(repeat('85',32),'hex'))$$,
    (select response ->> 'catalogRevisionId' from admin_catalog),
    (select seed_id from admin_active_seed),
    (select candidates::text from admin_candidate_payload),
    (select processed_skus::text from admin_processed_skus)
  ),
  '40001', 'stale_match_candidate_batch',
  'dos solicitudes distintas no duplican candidatos del mismo lote'
);

select is(
  (select jsonb_array_length(
    public.internal_admin_supermarket_match_inputs(
      '00000000-0000-4000-8000-000000017301',
      '21000000-0000-4000-8000-000000017301',
      (select (response ->> 'catalogRevisionId')::uuid from admin_catalog), 1
    ) -> 'skus'
  )),
  70,
  'las marcas hacen avanzar el siguiente lote sin atascar SKU sin candidato'
);

create temporary table admin_candidate_rule as
select matching_rule_id rule_id, version
from public.internal_admin_list_supermarket_matching_rules(
  '00000000-0000-4000-8000-000000017301',
  '21000000-0000-4000-8000-000000017301',
  (select (response ->> 'catalogRevisionId')::uuid from admin_catalog),
  null, 51
)
order by matching_rule_id
limit 1;

create temporary table admin_reviewed_rule as
select public.internal_admin_review_supermarket_matching_rule(
  '00000000-0000-4000-8000-000000017301',
  '21000000-0000-4000-8000-000000017301',
  (select rule_id from admin_candidate_rule),
  (select version from admin_candidate_rule), 'exact',
  '85000000-0000-4000-8000-000000017302',
  17302, clock_timestamp(), decode(repeat('77', 32), 'hex'),
  decode(repeat('78', 64), 'hex'), 1, decode(repeat('79', 32), 'hex')
) response;

create temporary table admin_matching_ack as
select public.internal_admin_activate_supermarket_matching_rule(
  '00000000-0000-4000-8000-000000017301',
  '21000000-0000-4000-8000-000000017301',
  (select (response ->> 'matchingRuleId')::uuid from admin_reviewed_rule),
  (select (response ->> 'version')::integer from admin_reviewed_rule),
  '85000000-0000-4000-8000-000000017303',
  17303, clock_timestamp(), decode(repeat('7a', 32), 'hex'),
  decode(repeat('7b', 64), 'hex'), 1, decode(repeat('7c', 32), 'hex')
) response;

select is(
  (select response ->> 'status' from admin_matching_ack), 'active',
  'activar matching es una acción AAL2 distinta de publicar'
);

create temporary table admin_publication_context as
select private.supermarket_catalog_publication_context(
  (select (response ->> 'catalogRevisionId')::uuid from admin_catalog),
  (select seed_id from admin_active_seed)
) context;

create temporary table admin_publication_ack as
select public.internal_admin_publish_supermarket_catalog(
  '00000000-0000-4000-8000-000000017301',
  '21000000-0000-4000-8000-000000017301',
  (select (response ->> 'catalogRevisionId')::uuid from admin_catalog),
  1, 'development_approved',
  decode((select context ->> 'catalogHash' from admin_publication_context), 'hex'),
  decode((select context ->> 'seedHash' from admin_publication_context), 'hex'),
  decode((select context ->> 'coverageHash' from admin_publication_context), 'hex'),
  '85000000-0000-4000-8000-000000017304',
  17304, clock_timestamp(), decode(repeat('7d', 32), 'hex'),
  decode(repeat('7e', 64), 'hex'), 1, decode(repeat('7f', 32), 'hex')
) response;

select is(
  (select response ->> 'status' from admin_publication_ack), 'active',
  'publicar exige cobertura y decisión documental confirmadas'
);

select is(
  public.internal_admin_publish_supermarket_catalog(
    '00000000-0000-4000-8000-000000017301',
    '21000000-0000-4000-8000-000000017301',
    (select (response ->> 'catalogRevisionId')::uuid from admin_catalog),
    1, 'development_approved',
    decode((select context ->> 'catalogHash' from admin_publication_context), 'hex'),
    decode((select context ->> 'seedHash' from admin_publication_context), 'hex'),
    decode((select context ->> 'coverageHash' from admin_publication_context), 'hex'),
    '85000000-0000-4000-8000-000000017304',
    17304, clock_timestamp(), decode(repeat('7d', 32), 'hex'),
    decode(repeat('7e', 64), 'hex'), 1, decode(repeat('7f', 32), 'hex')
  ),
  (select response from admin_publication_ack),
  'el replay exacto devuelve el mismo ACK'
);

select throws_ok(
  format(
    $$select public.internal_admin_publish_supermarket_catalog(
      '00000000-0000-4000-8000-000000017301',
      '21000000-0000-4000-8000-000000017301', '%s', 2,
      'development_approved', decode(repeat('73',32),'hex'),
      decode(repeat('71',32),'hex'), decode(repeat('7b',32),'hex'),
      '85000000-0000-4000-8000-000000017304', 17304, clock_timestamp(),
      decode(repeat('7d',32),'hex'), decode(repeat('7e',64),'hex'), 1,
      decode(repeat('7f',32),'hex'))$$,
    (select response ->> 'catalogRevisionId' from admin_catalog)
  ),
  '23505', 'idempotency_conflict',
  'la misma clave con otro cuerpo se rechaza'
);

create temporary table admin_hidden_ack as
select public.internal_admin_hide_supermarket_catalog_publication(
  '00000000-0000-4000-8000-000000017301',
  '21000000-0000-4000-8000-000000017301',
  (select (response ->> 'catalogPublicationId')::uuid from admin_publication_ack),
  1, '85000000-0000-4000-8000-000000017305',
  17305, clock_timestamp(), decode(repeat('80', 32), 'hex'),
  decode(repeat('81', 64), 'hex'), 1, decode(repeat('82', 32), 'hex')
) response;

select is(
  (select response ->> 'version' from admin_hidden_ack), '2',
  'ocultar conserva historia y avanza expectedVersion'
);

select ok(
  (
    select array_agg(event.action order by event.action)
    from private.technical_audit_events event
    where event.request_id in (
      '85000000-0000-4000-8000-000000017301',
      '85000000-0000-4000-8000-000000017302',
      '85000000-0000-4000-8000-000000017303',
      '85000000-0000-4000-8000-000000017304',
      '85000000-0000-4000-8000-000000017305'
    ) and event.phase = 'intent'
  ) = array[
    'catalog_match_candidates_generate',
    'catalog_publication_hide',
    'catalog_revision_publish',
    'matching_rule_activate',
    'matching_rule_review'
  ]::text[]
  and not exists (
    select 1 from private.technical_audit_events event
    where event.request_id in (
      '85000000-0000-4000-8000-000000017301',
      '85000000-0000-4000-8000-000000017302',
      '85000000-0000-4000-8000-000000017303',
      '85000000-0000-4000-8000-000000017304',
      '85000000-0000-4000-8000-000000017305'
    ) and to_jsonb(event)::text ~* '(externalSku|basePrice|payload|Alimento admin)'
  ),
  'intent/outbox solo registran IDs, acciones y hashes sin nombres, SKU, precios o payload'
);

create temporary table admin_second_seed as
select public.internal_create_basket_seed_revision(
  't17-admin-seed-v2', fixed_items, dynamic_items,
  '{"from":"2026-07-01","to":"2026-07-31"}'::jsonb,
  decode(repeat('86', 32), 'hex')
) seed_id
from admin_seed_payload;

select public.internal_activate_basket_seed_revision(seed_id)
from admin_second_seed;

select ok(
  (
    select jsonb_array_length(inputs -> 'skus') = 80
      and inputs ->> 'basketSeedRevisionId' =
        (select seed_id::text from admin_second_seed)
    from (
      select public.internal_admin_supermarket_match_inputs(
        '00000000-0000-4000-8000-000000017301',
        '21000000-0000-4000-8000-000000017301',
        (select (response ->> 'catalogRevisionId')::uuid from admin_catalog), 1
      ) inputs
    ) current_inputs
  ),
  'una nueva semilla vuelve a habilitar todos los SKU para sus propios candidatos'
);

select * from finish();

rollback;
