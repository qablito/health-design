begin;

select no_plan();

select ok(
  to_regclass('public.shopping_preference_revisions') is not null
  and to_regclass('public.shopping_snapshots') is not null
  and to_regclass('public.shopping_snapshot_publications') is not null
  and to_regclass('public.shopping_leftover_confirmations') is not null
  and to_regclass('public.shopping_product_selection_confirmations') is not null,
  'T17D persiste preferencias, snapshots y contexto confirmado por revisión'
);

select ok(
  to_regprocedure('public.internal_get_shopping_preference(uuid,uuid,uuid)')
    is not null
  and to_regprocedure(
    'public.internal_put_shopping_preference(uuid,uuid,uuid,text,text,text[],text,integer,bytea,bytea)'
  ) is not null
  and to_regprocedure(
    'public.internal_prepare_shopping_resolution(uuid,uuid,uuid,uuid,text,jsonb,bytea,bytea,bytea)'
  ) is not null
  and to_regprocedure(
    'public.internal_persist_shopping_resolution(uuid,uuid,uuid,uuid,uuid,uuid,integer,bytea,bytea,text,jsonb,uuid[],jsonb,text,bytea,bytea)'
  ) is not null
  and to_regprocedure('public.internal_get_shopping_snapshot(uuid,uuid,uuid)')
    is not null,
  'T17D expone RPC estrechas para lectura, preparación y persistencia'
);

insert into auth.users (
  instance_id, id, aud, role, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at, is_anonymous
) values (
  '00000000-0000-0000-0000-000000000000',
  '00000000-0000-4000-8000-000000017401',
  'authenticated', 'authenticated',
  '{"provider":"anonymous","providers":["anonymous"]}'::jsonb,
  '{}'::jsonb, now(), now(), true
);

insert into auth.sessions (id, user_id, created_at, updated_at, aal) values (
  '21000000-0000-4000-8000-000000017401',
  '00000000-0000-4000-8000-000000017401', now(), now(), 'aal1'
);
insert into public.actors (id, auth_subject) values (
  '31000000-0000-4000-8000-000000017401',
  '00000000-0000-4000-8000-000000017401'
);
insert into public.profiles (id, alias, timezone, adult_attested_at) values (
  '51000000-0000-4000-8000-000000017401',
  'Compra Test', 'Europe/Madrid', now()
);
insert into public.profile_access (id, profile_id, actor_id) values (
  '61000000-0000-4000-8000-000000017401',
  '51000000-0000-4000-8000-000000017401',
  '31000000-0000-4000-8000-000000017401'
);
insert into public.device_sessions (
  id, actor_id, auth_session_id, label, created_at, last_seen_at,
  idle_expires_at, absolute_expires_at
) values (
  '41000000-0000-4000-8000-000000017401',
  '31000000-0000-4000-8000-000000017401',
  '21000000-0000-4000-8000-000000017401',
  'Compra test', now(), now(), now() + interval '30 days',
  now() + interval '180 days'
);
insert into public.questionnaire_drafts (
  id, profile_id, schema_version, version, status, completeness, answers,
  confirmed_block_ids, current_block_id, uncertainties, hard_errors
) values (
  '71000000-0000-4000-8000-000000017401',
  '51000000-0000-4000-8000-000000017401', 2, 1, 'submitted', 'complete',
  '{"activeModules":["nutrition"],"nutritionAllergiesStatus":"none"}'::jsonb,
  array['core','modules','summary'], 'summary', '[]'::jsonb, '[]'::jsonb
);
insert into public.context_snapshots (
  id, profile_id, source_draft_id, source_draft_version, effective_at, answers,
  completeness, normalization_version, input_hash, canonicalization_version
) values (
  '72000000-0000-4000-8000-000000017401',
  '51000000-0000-4000-8000-000000017401',
  '71000000-0000-4000-8000-000000017401', 1, now(),
  '{"nutritionAllergiesStatus":"none"}'::jsonb, 'complete',
  'normalization-v1', decode(repeat('01', 32), 'hex'), 'canonical-json-v1'
);
insert into public.plans (id, profile_id) values (
  '81000000-0000-4000-8000-000000017401',
  '51000000-0000-4000-8000-000000017401'
);
insert into public.plan_versions (
  id, plan_id, ordinal, status, completeness, validation_status, validation,
  context_snapshot_id, engine_version, rule_set_revision_id, source_manifest_id,
  input_hash, output_hash, canonicalization_version, created_at, validated_at,
  activated_at, activated_by
) values (
  '82000000-0000-4000-8000-000000017401',
  '81000000-0000-4000-8000-000000017401', 1, 'active', 'complete', 'valid',
  '{"checks":["nutrition"],"completeness":"complete"}'::jsonb,
  '72000000-0000-4000-8000-000000017401', 'engine-contract-v1',
  '83000000-0000-4000-8000-000000017401',
  '84000000-0000-4000-8000-000000017401',
  decode(repeat('02', 32), 'hex'), decode(repeat('03', 32), 'hex'),
  'plan-canonical-v1', now() - interval '1 second', now(), now(),
  '31000000-0000-4000-8000-000000017401'
);
update public.plans set active_version_id =
  '82000000-0000-4000-8000-000000017401'
where id = '81000000-0000-4000-8000-000000017401';
insert into public.module_results (
  id, plan_version_id, module, status, confidence, payload, uncertainties
) values (
  '85000000-0000-4000-8000-000000017401',
  '82000000-0000-4000-8000-000000017401', 'nutrition', 'valid', 'high',
  '{"shoppingList":[{"amountG":"1000","canonicalFoodKey":"food:test.chicken","name":"Pollo"}]}'::jsonb,
  '[]'::jsonb
);

insert into public.canonical_foods (
  id, food_key, name, category, food_state, edible_part, active
) values (
  '86000000-0000-4000-8000-000000017401', 'food:test.chicken', 'Pollo',
  'protein', 'raw', 'edible', true
);
insert into private.basket_seed_revisions (
  id, version, fixed_keys, dynamic_keys, usage_window, calculation_hash,
  status, activated_at
) select
  '87000000-0000-4000-8000-000000017401', 'shopping-test-seed-v1',
  (select jsonb_agg(format('fixed-%s', value) order by value)
   from generate_series(1, 60) value),
  (select jsonb_agg(format('dynamic-%s', value) order by value)
   from generate_series(1, 20) value),
  '{"from":"2026-01-01","to":"2026-12-31"}'::jsonb,
  decode(repeat('04', 32), 'hex'), 'active', now();
insert into private.basket_seed_items (
  id, basket_seed_revision_id, canonical_food_id, seed_kind, group_key,
  food_state, purchase_form, edible_part
) values (
  '88000000-0000-4000-8000-000000017401',
  '87000000-0000-4000-8000-000000017401',
  '86000000-0000-4000-8000-000000017401', 'fixed', 'protein',
  'raw', 'fresh', 'edible'
);
insert into private.supermarket_source_manifests (
  id, market, chain, source_kind, source_location_internal, collected_at,
  importer_version, canonicalization_version, raw_object_ref,
  normalized_object_ref, capture_evidence_ref, raw_sha256, normalized_sha256,
  import_key, record_count, price_count, error_count, coverage,
  license_status, source_terms_status
) values (
  '89000000-0000-4000-8000-000000017401', 'ES', 'mercadona',
  'manual_export', 'test-only', now(), 'test-v1', 'catalog-v1',
  'private/test/raw', 'private/test/normalized', 'private/test/evidence',
  decode(repeat('05', 32), 'hex'), decode(repeat('06', 32), 'hex'),
  decode(repeat('07', 32), 'hex'), 1, 1, 0, '{}'::jsonb,
  'approved', 'approved'
);
insert into private.supermarket_catalog_revisions (
  id, market, chain, manifest_id, revision_number, state, quality_status,
  record_count, usable_count, observed_at
) values (
  '8a000000-0000-4000-8000-000000017401', 'ES', 'mercadona',
  '89000000-0000-4000-8000-000000017401', 1, 'published', 'current',
  1, 1, now()
);
insert into private.supermarket_skus (
  id, market, chain, external_sku, gtin14
) values (
  '8b000000-0000-4000-8000-000000017401', 'ES', 'mercadona',
  'test-chicken', '08400000000001'
);
insert into private.supermarket_sku_revisions (
  id, catalog_revision_id, sku_id, name, category_path, format_text,
  purchase_form, package, base_price_eur, normalized_price, source_fields,
  usability, exclusion_reasons, content_hash
) values (
  '8c000000-0000-4000-8000-000000017401',
  '8a000000-0000-4000-8000-000000017401',
  '8b000000-0000-4000-8000-000000017401', 'Pechuga de pollo',
  '["Carne","Pollo"]'::jsonb, '500 g', 'fresh',
  '{"equivalenceEvidenceRef":null,"equivalentEdibleMassG":null,"saleMeasure":{"dimension":"mass","quantity":"500","unit":"g"}}'::jsonb,
  3.2500, '{"dimension":"mass","unit":"EUR/kg","value":"6.5"}'::jsonb,
  '{}'::jsonb, 'calculable', '[]'::jsonb, decode(repeat('08', 32), 'hex')
);
insert into private.supermarket_sku_matching_rule_revisions (
  id, sku_id, canonical_food_id, match_state, food_state, purchase_form,
  edible_part, criteria, evidence, exclusions, gtin_consistency,
  critical_issue_open, version, status, reviewed_by, activated_at
) values (
  '8d000000-0000-4000-8000-000000017401',
  '8b000000-0000-4000-8000-000000017401',
  '86000000-0000-4000-8000-000000017401', 'exact', 'raw', 'fresh',
  'edible',
  '{"catalogRevisionId":"8a000000-0000-4000-8000-000000017401","skuContentHash":"0808080808080808080808080808080808080808080808080808080808080808"}'::jsonb,
  '[]'::jsonb, '[]'::jsonb, 'consistent', false, 1, 'active',
  '31000000-0000-4000-8000-000000017401', now()
);
insert into private.catalog_publications (
  id, market, chain, catalog_revision_id, basket_seed_revision_id, coverage,
  coverage_hash, source_use_decision, published_by
) values (
  '8e000000-0000-4000-8000-000000017401', 'ES', 'mercadona',
  '8a000000-0000-4000-8000-000000017401',
  '87000000-0000-4000-8000-000000017401', '{}',
  decode(repeat('09', 32), 'hex'), 'development_approved',
  '31000000-0000-4000-8000-000000017401'
);

insert into private.supermarket_skus (
  id, market, chain, external_sku, gtin14
)
select
  format('8b00000%s-0000-4000-8000-00000001741%s', value, value)::uuid,
  'ES', 'mercadona', format('test-chicken-%s', value), null
from generate_series(1, 5) value;
insert into private.supermarket_sku_revisions (
  id, catalog_revision_id, sku_id, name, category_path, format_text,
  purchase_form, package, base_price_eur, normalized_price, source_fields,
  usability, exclusion_reasons, content_hash
)
select
  format('8c00000%s-0000-4000-8000-00000001741%s', value, value)::uuid,
  '8a000000-0000-4000-8000-000000017401',
  format('8b00000%s-0000-4000-8000-00000001741%s', value, value)::uuid,
  format('Pechuga de pollo %s', value),
  '["Carne","Pollo"]'::jsonb, '500 g', 'fresh',
  '{"equivalenceEvidenceRef":null,"equivalentEdibleMassG":null,"saleMeasure":{"dimension":"mass","quantity":"500","unit":"g"}}'::jsonb,
  3.2500, '{"dimension":"mass","unit":"EUR/kg","value":"6.5"}'::jsonb,
  '{}'::jsonb, 'calculable', '[]'::jsonb, decode(repeat('08', 32), 'hex')
from generate_series(1, 5) value;
insert into private.supermarket_sku_matching_rule_revisions (
  id, sku_id, canonical_food_id, match_state, food_state, purchase_form,
  edible_part, criteria, evidence, exclusions, gtin_consistency,
  critical_issue_open, version, status, reviewed_by, activated_at
)
select
  format('8d00000%s-0000-4000-8000-00000001741%s', value, value)::uuid,
  format('8b00000%s-0000-4000-8000-00000001741%s', value, value)::uuid,
  '86000000-0000-4000-8000-000000017401', 'exact', 'raw', 'fresh',
  'edible',
  '{"catalogRevisionId":"8a000000-0000-4000-8000-000000017401","skuContentHash":"0808080808080808080808080808080808080808080808080808080808080808"}'::jsonb,
  '[]'::jsonb, '[]'::jsonb, 'consistent', false, 1, 'active',
  '31000000-0000-4000-8000-000000017401', now()
from generate_series(1, 5) value;

insert into private.supermarket_source_manifests (
  id, market, chain, source_kind, source_location_internal, collected_at,
  importer_version, canonicalization_version, raw_object_ref,
  normalized_object_ref, capture_evidence_ref, raw_sha256, normalized_sha256,
  import_key, record_count, price_count, error_count, coverage,
  license_status, source_terms_status
) values (
  '89000000-0000-4000-8000-000000017402', 'ES', 'dia',
  'manual_export', 'test-only', now(), 'test-v1', 'catalog-v1',
  'private/test/dia/raw', 'private/test/dia/normalized', 'private/test/dia/evidence',
  decode(repeat('71', 32), 'hex'), decode(repeat('72', 32), 'hex'),
  decode(repeat('73', 32), 'hex'), 1, 1, 0, '{}'::jsonb,
  'approved', 'approved'
);
insert into private.supermarket_catalog_revisions (
  id, market, chain, manifest_id, revision_number, state, quality_status,
  record_count, usable_count, observed_at
) values (
  '8a000000-0000-4000-8000-000000017402', 'ES', 'dia',
  '89000000-0000-4000-8000-000000017402', 1, 'published', 'current',
  1, 1, now()
);
insert into private.supermarket_skus (
  id, market, chain, external_sku, gtin14
) values (
  '8b000000-0000-4000-8000-000000017402', 'ES', 'dia',
  'test-chicken-dia', null
);
insert into private.supermarket_sku_revisions (
  id, catalog_revision_id, sku_id, name, category_path, format_text,
  purchase_form, package, base_price_eur, normalized_price, source_fields,
  usability, exclusion_reasons, content_hash
) values (
  '8c000000-0000-4000-8000-000000017402',
  '8a000000-0000-4000-8000-000000017402',
  '8b000000-0000-4000-8000-000000017402', 'Pechuga DIA',
  '["Carne","Pollo"]'::jsonb, '500 g', 'fresh',
  '{"equivalenceEvidenceRef":null,"equivalentEdibleMassG":null,"saleMeasure":{"dimension":"mass","quantity":"500","unit":"g"}}'::jsonb,
  3.2500, '{"dimension":"mass","unit":"EUR/kg","value":"6.5"}'::jsonb,
  '{}'::jsonb, 'calculable', '[]'::jsonb, decode(repeat('74', 32), 'hex')
);
insert into private.supermarket_sku_matching_rule_revisions (
  id, sku_id, canonical_food_id, match_state, food_state, purchase_form,
  edible_part, criteria, evidence, exclusions, gtin_consistency,
  critical_issue_open, version, status, reviewed_by, activated_at
) values (
  '8d000000-0000-4000-8000-000000017402',
  '8b000000-0000-4000-8000-000000017402',
  '86000000-0000-4000-8000-000000017401', 'exact', 'raw', 'fresh',
  'edible',
  '{"catalogRevisionId":"8a000000-0000-4000-8000-000000017402","skuContentHash":"7474747474747474747474747474747474747474747474747474747474747474"}'::jsonb,
  '[]'::jsonb, '[]'::jsonb, 'consistent', false, 1, 'active',
  '31000000-0000-4000-8000-000000017401', now()
);
insert into private.catalog_publications (
  id, market, chain, catalog_revision_id, basket_seed_revision_id, coverage,
  coverage_hash, source_use_decision, published_by
) values (
  '8e000000-0000-4000-8000-000000017402', 'ES', 'dia',
  '8a000000-0000-4000-8000-000000017402',
  '87000000-0000-4000-8000-000000017401', '{}',
  decode(repeat('75', 32), 'hex'), 'development_approved',
  '31000000-0000-4000-8000-000000017401'
);

create temporary table shopping_preference_one as
select public.internal_put_shopping_preference(
  '00000000-0000-4000-8000-000000017401',
  '21000000-0000-4000-8000-000000017401',
  '51000000-0000-4000-8000-000000017401',
  'mercadona', 'single', '{}'::text[], 'normalized_price_asc', null,
  decode(repeat('11', 32), 'hex'), decode(repeat('12', 32), 'hex')
) response;

select is((select (response ->> 'version')::integer from shopping_preference_one), 1,
  'la primera preferencia exige elección explícita y crea la revisión 1');
select is(
  public.internal_get_shopping_preference(
    '00000000-0000-4000-8000-000000017401',
    '21000000-0000-4000-8000-000000017401',
    '51000000-0000-4000-8000-000000017401'
  ) #>> '{preference,preferredChain}',
  'mercadona',
  'la cadena habitual persistida no se deriva de precios'
);

create temporary table shopping_preference_two as
select public.internal_put_shopping_preference(
  '00000000-0000-4000-8000-000000017401',
  '21000000-0000-4000-8000-000000017401',
  '51000000-0000-4000-8000-000000017401',
  'mercadona', 'multistore', array['mercadona','dia'], 'price_asc', 1,
  decode(repeat('13', 32), 'hex'), decode(repeat('14', 32), 'hex')
) response;

select is((select (response ->> 'version')::integer from shopping_preference_two), 2,
  'la revisión multitienda explícita es monotónica');
select ok(
  (select lifecycle = 'archived' and archived_at is not null
   from public.shopping_preference_revisions where version = 1
     and profile_id = '51000000-0000-4000-8000-000000017401')
  and
  (select supersedes_id = (select id from public.shopping_preference_revisions
                           where version = 1 and profile_id = '51000000-0000-4000-8000-000000017401')
   from public.shopping_preference_revisions where version = 2
     and profile_id = '51000000-0000-4000-8000-000000017401'),
  'actualizar archiva la anterior y enlaza supersedes_id sin mutar contenido'
);

select throws_ok(
  $$select public.internal_put_shopping_preference(
    '00000000-0000-4000-8000-000000017401',
    '21000000-0000-4000-8000-000000017401',
    '51000000-0000-4000-8000-000000017401',
    'mercadona', 'multistore', array['dia','aldi'], 'price_asc', 2,
    decode(repeat('15', 32), 'hex'), decode(repeat('16', 32), 'hex')
  )$$,
  '22023', 'invalid_shopping_preference',
  'multitienda exige incluir la cadena habitual'
);

create temporary table shopping_preference_three as
select public.internal_put_shopping_preference(
  '00000000-0000-4000-8000-000000017401',
  '21000000-0000-4000-8000-000000017401',
  '51000000-0000-4000-8000-000000017401',
  'mercadona', 'single', '{}'::text[], 'normalized_price_asc', 2,
  decode(repeat('17', 32), 'hex'), decode(repeat('18', 32), 'hex')
) response;

create temporary table shopping_source_one as
select public.internal_prepare_shopping_resolution(
  '00000000-0000-4000-8000-000000017401',
  '21000000-0000-4000-8000-000000017401',
  '82000000-0000-4000-8000-000000017401', null,
  'shopping-snapshot-create',
  jsonb_build_object(
    'preferenceRevisionId',
    (select response ->> 'preferenceRevisionId' from shopping_preference_three)
  ),
  decode(repeat('21', 32), 'hex'), decode(repeat('22', 32), 'hex'),
  decode(repeat('23', 32), 'hex')
) response;

select ok(
  (select response #>> '{source,shoppingList,0,amountG}' = '1000'
     and response #>> '{source,shoppingList,0,name}' = 'Pollo'
     and response #>> '{source,shoppingList,0,purchaseContext,purchaseForm}' = 'fresh'
     and response #>> '{source,catalogItems,0,projection,basePriceEur}' = '3.25'
     and jsonb_array_length(response #> '{source,catalogItems}') = 7
   from shopping_source_one),
  'el servidor conserva nutrición y no trunca silenciosamente candidatos del resolver'
);

create temporary table shopping_ack_one as
select public.internal_persist_shopping_resolution(
  '00000000-0000-4000-8000-000000017401',
  '21000000-0000-4000-8000-000000017401',
  '82000000-0000-4000-8000-000000017401',
  '91000000-0000-4000-8000-000000017401',
  (select (response #>> '{source,preferenceRevision,id}')::uuid from shopping_source_one),
  '87000000-0000-4000-8000-000000017401', 0,
  decode(repeat('24', 32), 'hex'), decode(repeat('25', 32), 'hex'),
  'shopping-resolver-v2',
  jsonb_build_object(
    'id','91000000-0000-4000-8000-000000017401',
    'profileId','51000000-0000-4000-8000-000000017401',
    'planVersionId','82000000-0000-4000-8000-000000017401',
    'preferenceRevisionId',(select response #>> '{source,preferenceRevision,id}' from shopping_source_one),
    'basketSeedRevisionId','87000000-0000-4000-8000-000000017401',
    'revision',1,'supersedesId',null,'inputDigest',repeat('24',32),
    'resolverVersion','shopping-resolver-v2','schemaVersion',1,
    'createdAt','2026-07-22T12:00:00.000Z',
    'catalogPublicationIds',(select response #> '{source,catalogPublicationIds}' from shopping_source_one),
    'items',jsonb_build_array(jsonb_build_object('canonicalFoodKey','food:test.chicken'))
  ),
  (select array(select jsonb_array_elements_text(response #> '{source,catalogPublicationIds}'))::uuid[]
   from shopping_source_one),
  jsonb_build_object(
    'leftovers',(select response #> '{source,leftoversForPersistence}' from shopping_source_one),
    'selections',(select response #> '{source,selectionsForPersistence}' from shopping_source_one)
  ),
  'shopping-snapshot-create', decode(repeat('21', 32), 'hex'),
  decode(repeat('22', 32), 'hex')
) response;

select is((select response ->> 'version' from shopping_ack_one), '1',
  'la primera resolución persiste la revisión 1');
select throws_ok(
  $$select public.internal_persist_shopping_resolution(
    '00000000-0000-4000-8000-000000017401',
    '21000000-0000-4000-8000-000000017401',
    '82000000-0000-4000-8000-000000017401',
    '96000000-0000-4000-8000-000000017401',
    (select (response #>> '{source,preferenceRevision,id}')::uuid
     from shopping_source_one),
    '87000000-0000-4000-8000-000000017401', 1,
    decode(repeat('e1', 32), 'hex'), decode(repeat('e2', 32), 'hex'),
    'shopping-resolver-v2',
    jsonb_build_object(
      'id','96000000-0000-4000-8000-000000017401',
      'profileId','51000000-0000-4000-8000-000000017401',
      'planVersionId','82000000-0000-4000-8000-000000017401',
      'preferenceRevisionId',
        (select response #>> '{source,preferenceRevision,id}'
         from shopping_source_one),
      'basketSeedRevisionId','87000000-0000-4000-8000-000000017401',
      'revision',2,
      'supersedesId','91000000-0000-4000-8000-000000017401',
      'inputDigest',repeat('e1',32),
      'resolverVersion','shopping-resolver-v2',
      'schemaVersion',1,
      'createdAt','2026-07-22T12:00:30.000Z',
      'catalogPublicationIds',
        (select response #> '{source,catalogPublicationIds}'
         from shopping_source_one),
      'items',jsonb_build_array(
        jsonb_build_object('canonicalFoodKey','food:test.chicken')
      )
    ),
    (select array(
       select jsonb_array_elements_text(
         response #> '{source,catalogPublicationIds}'
       )
     )::uuid[] from shopping_source_one),
    jsonb_build_object(
      'leftovers','[]'::jsonb,
      'selections',jsonb_build_array(jsonb_build_object(
        'canonicalFoodKey','food:test.chicken',
        'skuId','8b000000-0000-4000-8000-000000017402',
        'carriedFromId',null
      ))
    ),
    'shopping-product-select',decode(repeat('e3',32),'hex'),
    decode(repeat('e4',32),'hex')
  )$$,
  '22023', 'shopping_selection_not_eligible',
  'persistencia rechaza una selección nueva fuera de la cadena autorizada'
);
select is(
  public.internal_prepare_shopping_resolution(
    '00000000-0000-4000-8000-000000017401',
    '21000000-0000-4000-8000-000000017401',
    '82000000-0000-4000-8000-000000017401', null,
    'shopping-snapshot-create',
    jsonb_build_object('preferenceRevisionId',
      (select response ->> 'preferenceRevisionId' from shopping_preference_three)),
    decode(repeat('21', 32), 'hex'), decode(repeat('22', 32), 'hex'),
    decode(repeat('23', 32), 'hex')
  ) #>> '{response,snapshotId}',
  '91000000-0000-4000-8000-000000017401',
  'el replay idempotente se devuelve antes de volver a resolver o consumir cuota'
);
select is(
  (select count(*) from private.shopping_rate_limit_events
   where profile_id = '51000000-0000-4000-8000-000000017401'),
  1::bigint,
  'el replay no consume una segunda cuota'
);
select throws_ok(
  $$select public.internal_prepare_shopping_resolution(
    '00000000-0000-4000-8000-000000017401',
    '21000000-0000-4000-8000-000000017401',
    '82000000-0000-4000-8000-000000017401', null,
    'shopping-snapshot-create',
    '{"preferenceRevisionId":"91000000-0000-4000-8000-000000017499"}'::jsonb,
    decode(repeat('21', 32), 'hex'), decode(repeat('26', 32), 'hex'),
    decode(repeat('23', 32), 'hex')
  )$$,
  '23505', 'idempotency_key_reused',
  'la misma clave con otro digest se rechaza antes de validar el cuerpo'
);

create temporary table shopping_source_two as
select public.internal_prepare_shopping_resolution(
  '00000000-0000-4000-8000-000000017401',
  '21000000-0000-4000-8000-000000017401',
  '82000000-0000-4000-8000-000000017401',
  '91000000-0000-4000-8000-000000017401', 'shopping-leftover-set',
  '{"schemaVersion":1,"action":"set","canonicalFoodKey":"food:test.chicken","declaredMeasure":{"dimension":"mass","quantity":"100","unit":"g"},"expectedVersion":1}'::jsonb,
  decode(repeat('31', 32), 'hex'), decode(repeat('32', 32), 'hex'),
  decode(repeat('33', 32), 'hex')
) response;

create temporary table shopping_ack_two as
select public.internal_persist_shopping_resolution(
  '00000000-0000-4000-8000-000000017401',
  '21000000-0000-4000-8000-000000017401',
  '82000000-0000-4000-8000-000000017401',
  '92000000-0000-4000-8000-000000017401',
  (select (response #>> '{source,preferenceRevision,id}')::uuid from shopping_source_two),
  '87000000-0000-4000-8000-000000017401', 1,
  decode(repeat('34', 32), 'hex'), decode(repeat('35', 32), 'hex'),
  'shopping-resolver-v2',
  jsonb_build_object(
    'id','92000000-0000-4000-8000-000000017401',
    'profileId','51000000-0000-4000-8000-000000017401',
    'planVersionId','82000000-0000-4000-8000-000000017401',
    'preferenceRevisionId',(select response #>> '{source,preferenceRevision,id}' from shopping_source_two),
    'basketSeedRevisionId','87000000-0000-4000-8000-000000017401',
    'revision',2,'supersedesId','91000000-0000-4000-8000-000000017401',
    'inputDigest',repeat('34',32),'resolverVersion','shopping-resolver-v2',
    'schemaVersion',1,'createdAt','2026-07-22T12:01:00.000Z',
    'catalogPublicationIds',(select response #> '{source,catalogPublicationIds}' from shopping_source_two),
    'items',jsonb_build_array(jsonb_build_object('canonicalFoodKey','food:test.chicken'))
  ),
  (select array(select jsonb_array_elements_text(response #> '{source,catalogPublicationIds}'))::uuid[]
   from shopping_source_two),
  jsonb_build_object(
    'leftovers',(select response #> '{source,leftoversForPersistence}' from shopping_source_two),
    'selections',(select response #> '{source,selectionsForPersistence}' from shopping_source_two)
  ),
  'shopping-leftover-set', decode(repeat('31', 32), 'hex'),
  decode(repeat('32', 32), 'hex')
) response;

select ok(
  (select lifecycle = 'archived' and snapshot_hash = decode(repeat('25',32),'hex')
   from public.shopping_snapshots
   where id = '91000000-0000-4000-8000-000000017401')
  and
  (select lifecycle = 'active' and revision = 2
     and supersedes_id = '91000000-0000-4000-8000-000000017401'
   from public.shopping_snapshots
   where id = '92000000-0000-4000-8000-000000017401'),
  'archivar separa lifecycle y conserva JSON/hash históricos inmutables'
);
select is(
  (select confirmed_equivalent_g::text from public.shopping_leftover_confirmations
   where snapshot_id = '92000000-0000-4000-8000-000000017401'),
  '100.000000',
  'el snapshot conserva el conjunto completo de sobrantes confirmados'
);
select is(
  public.internal_prepare_shopping_resolution(
    '00000000-0000-4000-8000-000000017401',
    '21000000-0000-4000-8000-000000017401',
    '82000000-0000-4000-8000-000000017401', null,
    'shopping-snapshot-create',
    jsonb_build_object(
      'preferenceRevisionId',
      (select response ->> 'preferenceRevisionId' from shopping_preference_three)
    ),
    decode(repeat('36', 32), 'hex'), decode(repeat('37', 32), 'hex'),
    decode(repeat('38', 32), 'hex')
  ) #>> '{source,leftovers,0,confirmedEquivalentG}',
  '100',
  'una apertura nueva hereda el contexto confirmado del snapshot activo'
);

create temporary table shopping_source_three as
select public.internal_prepare_shopping_resolution(
  '00000000-0000-4000-8000-000000017401',
  '21000000-0000-4000-8000-000000017401',
  '82000000-0000-4000-8000-000000017401',
  '92000000-0000-4000-8000-000000017401', 'shopping-leftover-set',
  '{"schemaVersion":1,"action":"clear","canonicalFoodKey":"food:test.chicken","expectedVersion":2}'::jsonb,
  decode(repeat('41', 32), 'hex'), decode(repeat('42', 32), 'hex'),
  decode(repeat('43', 32), 'hex')
) response;

select is(
  (select jsonb_array_length(response #> '{source,leftoversForPersistence}')
   from shopping_source_three),
  0,
  'clear elimina el sobrante del conjunto derivado sin inventar remanentes'
);

create temporary table shopping_ack_three as
select public.internal_persist_shopping_resolution(
  '00000000-0000-4000-8000-000000017401',
  '21000000-0000-4000-8000-000000017401',
  '82000000-0000-4000-8000-000000017401',
  '93000000-0000-4000-8000-000000017401',
  (select (response #>> '{source,preferenceRevision,id}')::uuid from shopping_source_three),
  '87000000-0000-4000-8000-000000017401', 2,
  decode(repeat('44', 32), 'hex'), decode(repeat('45', 32), 'hex'),
  'shopping-resolver-v2',
  jsonb_build_object(
    'id','93000000-0000-4000-8000-000000017401',
    'profileId','51000000-0000-4000-8000-000000017401',
    'planVersionId','82000000-0000-4000-8000-000000017401',
    'preferenceRevisionId',(select response #>> '{source,preferenceRevision,id}' from shopping_source_three),
    'basketSeedRevisionId','87000000-0000-4000-8000-000000017401',
    'revision',3,'supersedesId','92000000-0000-4000-8000-000000017401',
    'inputDigest',repeat('44',32),'resolverVersion','shopping-resolver-v2',
    'schemaVersion',1,'createdAt','2026-07-22T12:02:00.000Z',
    'catalogPublicationIds',(select response #> '{source,catalogPublicationIds}' from shopping_source_three),
    'items',jsonb_build_array(jsonb_build_object('canonicalFoodKey','food:test.chicken'))
  ),
  (select array(select jsonb_array_elements_text(response #> '{source,catalogPublicationIds}'))::uuid[]
   from shopping_source_three),
  jsonb_build_object(
    'leftovers',(select response #> '{source,leftoversForPersistence}' from shopping_source_three),
    'selections',(select response #> '{source,selectionsForPersistence}' from shopping_source_three)
  ),
  'shopping-leftover-set', decode(repeat('41', 32), 'hex'),
  decode(repeat('42', 32), 'hex')
) response;

select is(
  (select count(*) from public.shopping_leftover_confirmations
   where snapshot_id='93000000-0000-4000-8000-000000017401'),
  0::bigint,
  'clear persiste el nuevo conjunto completo sin la línea eliminada'
);

create temporary table shopping_source_four as
select public.internal_prepare_shopping_resolution(
  '00000000-0000-4000-8000-000000017401',
  '21000000-0000-4000-8000-000000017401',
  '82000000-0000-4000-8000-000000017401',
  '93000000-0000-4000-8000-000000017401', 'shopping-product-select',
  '{"schemaVersion":1,"canonicalFoodKey":"food:test.chicken","expectedVersion":3,"skuId":"8b000000-0000-4000-8000-000000017401"}'::jsonb,
  decode(repeat('51', 32), 'hex'), decode(repeat('52', 32), 'hex'),
  decode(repeat('53', 32), 'hex')
) response;

create temporary table shopping_ack_four as
select public.internal_persist_shopping_resolution(
  '00000000-0000-4000-8000-000000017401',
  '21000000-0000-4000-8000-000000017401',
  '82000000-0000-4000-8000-000000017401',
  '94000000-0000-4000-8000-000000017401',
  (select (response #>> '{source,preferenceRevision,id}')::uuid from shopping_source_four),
  '87000000-0000-4000-8000-000000017401', 3,
  decode(repeat('54', 32), 'hex'), decode(repeat('55', 32), 'hex'),
  'shopping-resolver-v2',
  jsonb_build_object(
    'id','94000000-0000-4000-8000-000000017401',
    'profileId','51000000-0000-4000-8000-000000017401',
    'planVersionId','82000000-0000-4000-8000-000000017401',
    'preferenceRevisionId',(select response #>> '{source,preferenceRevision,id}' from shopping_source_four),
    'basketSeedRevisionId','87000000-0000-4000-8000-000000017401',
    'revision',4,'supersedesId','93000000-0000-4000-8000-000000017401',
    'inputDigest',repeat('54',32),'resolverVersion','shopping-resolver-v2',
    'schemaVersion',1,'createdAt','2026-07-22T12:03:00.000Z',
    'catalogPublicationIds',(select response #> '{source,catalogPublicationIds}' from shopping_source_four),
    'items',jsonb_build_array(jsonb_build_object('canonicalFoodKey','food:test.chicken'))
  ),
  (select array(select jsonb_array_elements_text(response #> '{source,catalogPublicationIds}'))::uuid[]
   from shopping_source_four),
  jsonb_build_object(
    'leftovers',(select response #> '{source,leftoversForPersistence}' from shopping_source_four),
    'selections',(select response #> '{source,selectionsForPersistence}' from shopping_source_four)
  ),
  'shopping-product-select', decode(repeat('51', 32), 'hex'),
  decode(repeat('52', 32), 'hex')
) response;

select is(
  (select sku_id::text from public.shopping_product_selection_confirmations
   where snapshot_id='94000000-0000-4000-8000-000000017401'),
  '8b000000-0000-4000-8000-000000017401',
  'la selección manual nueva se valida y persiste como intención explícita'
);

create temporary table shopping_source_five as
select public.internal_prepare_shopping_resolution(
  '00000000-0000-4000-8000-000000017401',
  '21000000-0000-4000-8000-000000017401',
  '82000000-0000-4000-8000-000000017401',
  '94000000-0000-4000-8000-000000017401', 'shopping-leftover-set',
  '{"schemaVersion":1,"action":"set","canonicalFoodKey":"food:test.chicken","declaredMeasure":{"dimension":"mass","quantity":"50","unit":"g"},"expectedVersion":4}'::jsonb,
  decode(repeat('61', 32), 'hex'), decode(repeat('62', 32), 'hex'),
  decode(repeat('63', 32), 'hex')
) response;

select ok(
  (select response #>> '{source,selectionsForPersistence,0,carriedFromId}' is not null
   from shopping_source_five),
  'una mutación distinta conserva la selección manual con carried_from_id'
);

select throws_ok(
  $$select public.internal_prepare_shopping_resolution(
    '00000000-0000-4000-8000-000000017401',
    '21000000-0000-4000-8000-000000017401',
    '82000000-0000-4000-8000-000000017401',
    '94000000-0000-4000-8000-000000017401', 'shopping-product-select',
    '{"schemaVersion":1,"canonicalFoodKey":"food:test.chicken","expectedVersion":4,"skuId":"8b000000-0000-4000-8000-000000017402"}'::jsonb,
    decode(repeat('76', 32), 'hex'), decode(repeat('77', 32), 'hex'),
    decode(repeat('78', 32), 'hex')
  )$$,
  '22023', 'shopping_selection_not_eligible',
  'tienda única rechaza selecciones de cadenas usadas solo para comparar'
);

select is(
  public.internal_persist_shopping_resolution(
    '00000000-0000-4000-8000-000000017401',
    '21000000-0000-4000-8000-000000017401',
    '82000000-0000-4000-8000-000000017401',
    '95000000-0000-4000-8000-000000017401',
    (select (response #>> '{source,preferenceRevision,id}')::uuid from shopping_source_five),
    '87000000-0000-4000-8000-000000017401', 3,
    decode(repeat('54', 32), 'hex'), decode(repeat('65', 32), 'hex'),
    'shopping-resolver-v2','{}'::jsonb,
    array['8e000000-0000-4000-8000-000000017401']::uuid[],
    '{"leftovers":[],"selections":[]}'::jsonb,
    'shopping-leftover-set',decode(repeat('66',32),'hex'),decode(repeat('67',32),'hex')
  ) ->> 'snapshotId',
  '94000000-0000-4000-8000-000000017401',
  'dos procesos con la misma entrada convergen en el snapshot activo existente'
);

select throws_ok(
  $$select public.internal_persist_shopping_resolution(
    '00000000-0000-4000-8000-000000017401',
    '21000000-0000-4000-8000-000000017401',
    '82000000-0000-4000-8000-000000017401',
    '95000000-0000-4000-8000-000000017401',
    (select (response #>> '{source,preferenceRevision,id}')::uuid from shopping_source_five),
    '87000000-0000-4000-8000-000000017401', 3,
    decode(repeat('68',32),'hex'),decode(repeat('69',32),'hex'),
    'shopping-resolver-v2','{}'::jsonb,
    array['8e000000-0000-4000-8000-000000017401']::uuid[],
    '{"leftovers":[],"selections":[]}'::jsonb,
    'shopping-leftover-set',decode(repeat('6a',32),'hex'),decode(repeat('6b',32),'hex')
  )$$,
  '40001','stale_shopping_snapshot',
  'una entrada distinta con revisión CAS obsoleta no crea otra revisión'
);

select throws_ok(
  $$update public.shopping_snapshots
    set snapshot = snapshot || '{"tampered":true}'::jsonb
    where id = '91000000-0000-4000-8000-000000017401'$$,
  '55000', 'immutable_shopping_snapshot',
  'un snapshot histórico no permite mutar su JSON'
);
select is(
  (select count(*) from public.shopping_snapshots
   where profile_id = '51000000-0000-4000-8000-000000017401'
     and plan_version_id = '82000000-0000-4000-8000-000000017401'
     and lifecycle = 'active'),
  1::bigint,
  'solo existe un snapshot activo por perfil y versión de plan'
);
select ok(
  (select count(*) = count(distinct revision)
   from public.shopping_snapshots
   where profile_id = '51000000-0000-4000-8000-000000017401'),
  'las revisiones son únicas y monotónicas dentro de la línea de plan'
);

select * from finish();
rollback;
