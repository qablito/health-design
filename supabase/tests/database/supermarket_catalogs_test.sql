begin;

select no_plan();

select ok(
  to_regclass('private.supermarket_source_manifests') is not null
  and to_regclass('private.supermarket_catalog_revisions') is not null
  and to_regclass('private.supermarket_skus') is not null
  and to_regclass('private.supermarket_sku_revisions') is not null,
  'T17B persiste manifiestos, revisiones, SKU y contenido inmutable'
);

select ok(
  to_regprocedure(
    'public.internal_import_supermarket_catalog(jsonb,jsonb,jsonb)'
  ) is not null
  and to_regprocedure(
    'public.internal_list_published_supermarket_catalog(text,text,integer)'
  ) is not null,
  'la importación y lectura pasan por RPC cerradas'
);

select ok(
  not has_table_privilege(
    'authenticated', 'private.supermarket_source_manifests', 'SELECT,INSERT,UPDATE,DELETE'
  )
  and not has_table_privilege(
    'authenticated', 'private.supermarket_catalog_revisions', 'SELECT,INSERT,UPDATE,DELETE'
  )
  and not has_table_privilege(
    'authenticated', 'private.supermarket_skus', 'SELECT,INSERT,UPDATE,DELETE'
  )
  and not has_table_privilege(
    'authenticated', 'private.supermarket_sku_revisions', 'SELECT,INSERT,UPDATE,DELETE'
  )
  and not has_table_privilege(
    'service_role', 'private.supermarket_source_manifests', 'SELECT,INSERT,UPDATE,DELETE'
  )
  and has_function_privilege(
    'service_role',
    'public.internal_import_supermarket_catalog(jsonb,jsonb,jsonb)',
    'EXECUTE'
  ),
  'usuarios y servicio no acceden directamente a cuarentena ni manifest'
);

select is(
  (
    select count(*)::integer
    from information_schema.columns
    where table_schema = 'private'
      and table_name in (
        'supermarket_source_manifests', 'supermarket_catalog_revisions',
        'supermarket_skus', 'supermarket_sku_revisions'
      )
      and column_name ~ '(nutrition|nutrient|calorie|macro|stock)'
  ),
  0,
  'el catálogo de compra no persiste nutrición ni stock'
);

create temporary table supermarket_import_fixture as
select
  jsonb_build_object(
    'market', 'ES',
    'chain', 'mercadona',
    'sourceKind', 'api_capture',
    'sourceLocationInternal', 'postal-code:41006',
    'collectedAt', '2026-07-21T18:00:00+00:00',
    'importerVersion', 'supermarket-import-v1',
    'canonicalizationVersion', 'supermarket-catalog-v1',
    'rawObjectRef', 'opaque/raw/fixture',
    'normalizedObjectRef', 'opaque/normalized/fixture',
    'captureEvidenceRef', 'opaque/evidence/fixture',
    'errorEvidenceRef', null,
    'rawSha256', repeat('11', 32),
    'normalizedSha256', repeat('12', 32),
    'importKey', repeat('13', 32),
    'recordCount', 1,
    'priceCount', 1,
    'errorCount', 0,
    'coverage', jsonb_build_object('accepted', 1, 'rejected', 0),
    'licenseStatus', 'unknown',
    'sourceTermsStatus', 'unknown'
  ) as manifest,
  jsonb_build_object(
    'revisionNumber', 1,
    'state', 'quarantine',
    'qualityStatus', 'current',
    'recordCount', 1,
    'usableCount', 1,
    'observedAt', '2026-07-21T18:00:00+00:00',
    'supersedesId', null
  ) as revision,
  jsonb_build_array(jsonb_build_object(
    'externalSku', 'sku-fixture-1',
    'gtin14', '08412345678905',
    'name', 'Pechuga de pollo',
    'categoryPath', jsonb_build_array('Carne', 'Pollo'),
    'formatText', '500 g',
    'purchaseForm', 'fresh',
    'package', jsonb_build_object(
      'dimension', 'mass', 'measure', jsonb_build_object('unit', 'g', 'value', '500'),
      'packageCount', 1, 'status', 'confirmed'
    ),
    'equivalentEdibleMassG', '500',
    'equivalenceEvidence', jsonb_build_object('source', 'package'),
    'basePriceEur', '4.50',
    'normalizedPrice', jsonb_build_object('amount', '9', 'unit', 'EUR/kg'),
    'sourceFields', jsonb_build_object('source_name', 'Pechuga de pollo'),
    'usability', 'calculable',
    'exclusionReasons', '[]'::jsonb,
    'contentHash', repeat('14', 32)
  )) as records;

create temporary table first_supermarket_import as
select public.internal_import_supermarket_catalog(manifest, revision, records) response
from supermarket_import_fixture;

select ok(
  (select response ->> 'replayed' from first_supermarket_import) = 'false'
  and (select count(*) from private.supermarket_source_manifests) = 1
  and (select count(*) from private.supermarket_catalog_revisions) = 1
  and (select count(*) from private.supermarket_skus) = 1
  and (select count(*) from private.supermarket_sku_revisions) = 1,
  'la RPC importa una revisión completa únicamente después del manifest'
);

select is(
  (
    select public.internal_import_supermarket_catalog(manifest, revision, records)
    from supermarket_import_fixture
  ) ->> 'catalogRevisionId',
  (select response ->> 'catalogRevisionId' from first_supermarket_import),
  'reimportar la misma clave y hashes recupera la revisión existente'
);

select is(
  (select count(*)::integer from private.supermarket_catalog_revisions),
  1,
  'la idempotencia no duplica revisiones'
);

select throws_ok(
  $$
    update private.supermarket_source_manifests
    set license_status = 'approved'
  $$,
  '55000',
  'immutable_supermarket_catalog',
  'el manifest no se puede alterar después de importarlo'
);

select throws_ok(
  $$
    delete from private.supermarket_sku_revisions
  $$,
  '55000',
  'immutable_supermarket_catalog',
  'las revisiones SKU son append-only'
);

select throws_ok(
  $$
    insert into private.supermarket_catalog_revisions (
      market, chain, manifest_id, revision_number, record_count, usable_count,
      observed_at
    ) values (
      'ES', 'dia', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 1, 0, 0, now()
    )
  $$,
  '23503',
  null,
  'una revisión sin manifest válido queda rechazada'
);

select is(
  (
    select count(*)::integer
    from public.internal_list_published_supermarket_catalog('mercadona', null, 100)
  ),
  0,
  'la cuarentena unknown no expone filas como catálogo publicado'
);

select ok(
  exists (
    select 1
    from pg_constraint constraint_row
    where constraint_row.conrelid = 'private.supermarket_skus'::regclass
      and constraint_row.contype = 'u'
      and pg_get_constraintdef(constraint_row.oid) like
        'UNIQUE (market, chain, external_sku)%'
  ),
  'la identidad SKU es única por market, chain y external_sku'
);

select * from finish();

rollback;
