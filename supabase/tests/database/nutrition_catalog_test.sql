select no_plan();

begin;

insert into auth.users (
  instance_id, id, aud, role, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at, is_anonymous
) values (
  '00000000-0000-0000-0000-000000000000',
  '00000000-0000-4000-8000-000000009101',
  'authenticated', 'authenticated',
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{}'::jsonb, now(), now(), false
);

insert into auth.sessions (id, user_id, created_at, updated_at, aal)
values
  (
    '21000000-0000-4000-8000-000000009101',
    '00000000-0000-4000-8000-000000009101', now(), now(), 'aal1'
  ),
  (
    '21000000-0000-4000-8000-000000009102',
    '00000000-0000-4000-8000-000000009101', now(), now(), 'aal2'
  );

insert into public.actors (id, auth_subject, role)
values (
  '31000000-0000-4000-8000-000000009101',
  '00000000-0000-4000-8000-000000009101',
  'superadmin'
);

select ok(
  to_regclass('public.nutrition_sources') is not null
  and to_regclass('public.nutrition_source_manifests') is not null
  and to_regclass('public.canonical_foods') is not null
  and to_regclass('public.canonical_food_aliases') is not null
  and to_regclass('public.nutrition_nutrients') is not null
  and to_regclass('public.food_composition_revisions') is not null
  and to_regclass('public.nutrient_observations') is not null
  and to_regclass('public.nutrition_reviews') is not null
  and to_regclass('public.effective_food_revisions') is not null,
  'T9 persiste fuente, revisión, alimento, nutriente, observación, alias y revisión efectiva'
);

select is(
  (
    select string_agg(source_key, ',' order by precedence)
    from public.nutrition_sources
  ),
  'ciqual_2025,bls_4_0,fineli,livsmedelsverket,usda_foundation,usda_sr_legacy',
  'la precedencia federada canónica queda fijada en datos'
);

select is(
  (
    select canonical_unit
    from public.nutrition_nutrients
    where nutrient_key = 'sodium'
  ),
  'mg',
  'el sodio usa mg como unidad canónica de extremo a extremo'
);

select ok(
  not has_table_privilege('authenticated', 'public.canonical_foods', 'SELECT')
  and not has_table_privilege(
    'authenticated', 'public.food_composition_revisions', 'INSERT'
  )
  and has_table_privilege('service_role', 'public.canonical_foods', 'SELECT')
  and not has_table_privilege(
    'service_role', 'public.food_composition_revisions', 'INSERT'
  ),
  'RLS y privilegios impiden mutaciones directas desde navegador o servicio'
);

select throws_ok(
  $$
    select public.internal_nutrition_stage_batch(
      '00000000-0000-4000-8000-000000009101',
      '21000000-0000-4000-8000-000000009101',
      '91000000-0000-4000-8000-000000009101',
      jsonb_build_object()
    )
  $$,
  '42501',
  'aal2_required',
  'AAL1 no puede importar un lote nutricional'
);

create temporary table first_import as
select public.internal_nutrition_stage_batch(
  '00000000-0000-4000-8000-000000009101',
  '21000000-0000-4000-8000-000000009102',
  '91000000-0000-4000-8000-000000009102',
  jsonb_build_object(
    'status', 'quarantined',
    'publicationCount', 0,
    'violations', '[]'::jsonb,
    'manifest', jsonb_build_object(
      'id', 'manifest:' || repeat('a', 64),
      'sourceKey', 'ciqual_2025',
      'sourceVersion', '2025-test',
      'licenseStatus', 'approved',
      'retrievedAt', '2026-07-19T00:00:00.000Z',
      'transformations', jsonb_build_array('ciqual-fixture-v1'),
      'rawContentHash', repeat('a', 64),
      'normalizedContentHash', repeat('b', 64),
      'hashAlgorithm', 'sha256',
      'canonicalizationVersion', 'canonical-json-v1'
    ),
    'revisions', jsonb_build_array(
      jsonb_build_object(
        'id', 'revision:' || repeat('c', 64),
        'targetKind', 'generic_food',
        'canonicalFoodKey', 'food:oat-flakes',
        'name', 'Copos de avena',
        'category', 'cereals',
        'aliases', jsonb_build_array('avena en copos'),
        'basis', 'per_100_g',
        'foodState', 'raw',
        'ediblePart', 'whole_edible_product',
        'method', 'source_declared',
        'sourceKey', 'ciqual_2025',
        'sourceVersion', '2025-test',
        'status', 'quarantined',
        'nutrients', jsonb_build_object(
          'protein', jsonb_build_object(
            'basis', 'per_100_g', 'foodState', 'raw',
            'nutrientClass', 'protein', 'state', 'known',
            'originalValue', '13', 'originalUnit', 'g',
            'normalizedValue', '13', 'normalizedUnit', 'g'
          ),
          'fiber', jsonb_build_object(
            'basis', 'per_100_g', 'foodState', 'raw',
            'nutrientClass', 'fiber', 'state', 'missing',
            'originalValue', null, 'originalUnit', 'g',
            'normalizedValue', null, 'normalizedUnit', 'g'
          )
        )
      )
    )
  )
) as response;

select is(
  (select response ->> 'status' from first_import),
  'quarantined',
  'el lote válido entra en cuarentena'
);

select is(
  (select (response ->> 'revision_count')::integer from first_import),
  1,
  'el lote se persiste de forma completa'
);

select is(
  (select jsonb_array_length(response -> 'revisions') from first_import),
  1,
  'la respuesta devuelve el UUID necesario para revisar la revisión importada'
);

select throws_ok(
  $$
    select public.internal_nutrition_stage_batch(
      '00000000-0000-4000-8000-000000009101',
      '21000000-0000-4000-8000-000000009102',
      '91000000-0000-4000-8000-000000009102',
      '{}'::jsonb
    )
  $$,
  '23505',
  'idempotency_key_reused',
  'una clave idempotente no puede reutilizarse para otro manifiesto'
);

select is(
  (select count(*)::integer from public.effective_food_revisions),
  0,
  'importar nunca publica una revisión efectiva'
);

select ok(
  exists (
    select 1
    from public.nutrient_observations observation
    join public.nutrition_nutrients nutrient on nutrient.id = observation.nutrient_id
    where nutrient.nutrient_key = 'fiber'
      and observation.value_state = 'missing'
      and observation.original_value is null
      and observation.normalized_value is null
  ),
  'un dato ausente se conserva como ausente y no como cero'
);

select ok(
  exists (
    select 1
    from private.technical_audit_events
    where action = 'nutrition_batch_stage'
      and request_id = '91000000-0000-4000-8000-000000009102'
  ),
  'la importación administrativa deja registro técnico privado'
);

select throws_ok(
  format(
    $$select public.internal_nutrition_activate_revision(
      '00000000-0000-4000-8000-000000009101',
      '21000000-0000-4000-8000-000000009102',
      %L::uuid,
      '{"basis":"per_100_g","foodState":"raw","ediblePart":"whole_edible_product","method":"source_declared"}'::jsonb,
      decode(repeat('d', 64), 'hex'),
      'CIQUAL 2025 es la fuente prioritaria compatible',
      '91000000-0000-4000-8000-000000009103'
    )$$,
    (select id from public.food_composition_revisions limit 1)
  ),
  '55000',
  'nutrition_revision_not_validated',
  'una revisión en cuarentena no puede activarse'
);

create temporary table validated as
select public.internal_nutrition_validate_revision(
  '00000000-0000-4000-8000-000000009101',
  '21000000-0000-4000-8000-000000009102',
  (select id from public.food_composition_revisions limit 1),
  'Validación de esquema, licencia, unidad, estado y procedencia superada',
  '91000000-0000-4000-8000-000000009104'
) as response;

select is(
  (select response ->> 'status' from validated),
  'validated',
  'la validación explícita prepara la revisión para activación manual'
);

select throws_ok(
  format(
    $$select public.internal_nutrition_activate_revision(
      '00000000-0000-4000-8000-000000009101',
      '21000000-0000-4000-8000-000000009102',
      %L::uuid,
      '{"basis":"per_100_g","foodState":"cooked","ediblePart":"whole_edible_product","method":"source_declared"}'::jsonb,
      decode(repeat('d', 64), 'hex'),
      'Contexto incompatible que debe rechazarse',
      '91000000-0000-4000-8000-000000009115'
    )$$,
    (select id from public.food_composition_revisions limit 1)
  ),
  '22023',
  'resolution_context_mismatch',
  'una revisión no puede activarse bajo otro estado del alimento'
);

create temporary table activated as
select public.internal_nutrition_activate_revision(
  '00000000-0000-4000-8000-000000009101',
  '21000000-0000-4000-8000-000000009102',
  (select id from public.food_composition_revisions limit 1),
  '{"basis":"per_100_g","foodState":"raw","ediblePart":"whole_edible_product","method":"source_declared"}'::jsonb,
  decode(repeat('d', 64), 'hex'),
  'CIQUAL 2025 es la fuente prioritaria compatible',
  '91000000-0000-4000-8000-000000009105'
) as response;

select is(
  (select response ->> 'status' from activated),
  'active',
  'la activación manual publica una revisión efectiva exacta'
);

select is(
  (select count(*)::integer from public.effective_food_revisions where superseded_at is null),
  1,
  'solo existe una revisión efectiva activa por contexto'
);

create temporary table second_import as
select public.internal_nutrition_stage_batch(
  '00000000-0000-4000-8000-000000009101',
  '21000000-0000-4000-8000-000000009102',
  '91000000-0000-4000-8000-000000009109',
  jsonb_build_object(
    'status', 'quarantined',
    'publicationCount', 0,
    'violations', '[]'::jsonb,
    'manifest', jsonb_build_object(
      'id', 'manifest:' || repeat('1', 64),
      'sourceKey', 'bls_4_0',
      'sourceVersion', '4.0-test',
      'licenseStatus', 'approved',
      'retrievedAt', '2026-07-19T00:00:00.000Z',
      'transformations', jsonb_build_array('bls-fixture-v1'),
      'rawContentHash', repeat('1', 64),
      'normalizedContentHash', repeat('2', 64),
      'hashAlgorithm', 'sha256',
      'canonicalizationVersion', 'canonical-json-v1'
    ),
    'revisions', jsonb_build_array(
      jsonb_build_object(
        'id', 'revision:' || repeat('3', 64),
        'targetKind', 'generic_food',
        'canonicalFoodKey', 'food:oat-flakes',
        'name', 'Copos de avena',
        'category', 'cereals',
        'aliases', jsonb_build_array('avena en copos'),
        'basis', 'per_100_g',
        'foodState', 'raw',
        'ediblePart', 'whole_edible_product',
        'method', 'source_declared',
        'sourceKey', 'bls_4_0',
        'sourceVersion', '4.0-test',
        'status', 'quarantined',
        'nutrients', jsonb_build_object(
          'protein', jsonb_build_object(
            'basis', 'per_100_g', 'foodState', 'raw',
            'nutrientClass', 'protein', 'state', 'known',
            'originalValue', '20', 'originalUnit', 'g',
            'normalizedValue', '20', 'normalizedUnit', 'g'
          )
        )
      )
    )
  )
) as response;

create temporary table second_validated as
select public.internal_nutrition_validate_revision(
  '00000000-0000-4000-8000-000000009101',
  '21000000-0000-4000-8000-000000009102',
  (
    select id from public.food_composition_revisions
    where import_key = 'revision:' || repeat('3', 64)
  ),
  'Validación automática superada; queda pendiente la discrepancia material',
  '91000000-0000-4000-8000-000000009110'
) as response;

create temporary table opened_review as
select public.internal_nutrition_open_review(
  '00000000-0000-4000-8000-000000009101',
  '21000000-0000-4000-8000-000000009102',
  (
    select id from public.food_composition_revisions
    where import_key = 'revision:' || repeat('c', 64)
  ),
  (
    select id from public.food_composition_revisions
    where import_key = 'revision:' || repeat('3', 64)
  ),
  'protein',
  'manual_review',
  'La diferencia de proteína supera el umbral contractual',
  '{"anchor":"13","candidate":"20","unit":"g","basis":"per_100_g"}'::jsonb,
  '91000000-0000-4000-8000-000000009111'
) as response;

select throws_ok(
  format(
    $$select public.internal_nutrition_open_review(
      '00000000-0000-4000-8000-000000009101',
      '21000000-0000-4000-8000-000000009102',
      %L::uuid,
      %L::uuid,
      'protein',
      'manual_review',
      'Otra razón para reutilizar indebidamente la misma clave',
      '{"anchor":"13","candidate":"20","unit":"g","basis":"per_100_g"}'::jsonb,
      '91000000-0000-4000-8000-000000009111'
    )$$,
    (
      select id from public.food_composition_revisions
      where import_key = 'revision:' || repeat('c', 64)
    ),
    (
      select id from public.food_composition_revisions
      where import_key = 'revision:' || repeat('3', 64)
    )
  ),
  '23505',
  'idempotency_key_reused',
  'abrir una revisión no permite reutilizar la clave con otro contenido'
);

select is(
  jsonb_array_length(public.internal_nutrition_list_reviews(
    '00000000-0000-4000-8000-000000009101',
    '21000000-0000-4000-8000-000000009102',
    'open'
  )),
  1,
  'la discrepancia material queda visible como revisión abierta'
);

select throws_ok(
  format(
    $$select public.internal_nutrition_activate_revision(
      '00000000-0000-4000-8000-000000009101',
      '21000000-0000-4000-8000-000000009102',
      %L::uuid,
      '{"basis":"per_100_g","foodState":"raw","ediblePart":"whole_edible_product","method":"source_declared"}'::jsonb,
      decode(repeat('d', 64), 'hex'),
      'Candidato BLS pendiente de revisión',
      '91000000-0000-4000-8000-000000009112'
    )$$,
    (
      select id from public.food_composition_revisions
      where import_key = 'revision:' || repeat('3', 64)
    )
  ),
  '55000',
  'nutrition_review_open',
  'una discrepancia abierta bloquea solo la activación candidata'
);

create temporary table resolved_review as
select public.internal_nutrition_resolve_review(
  '00000000-0000-4000-8000-000000009101',
  '21000000-0000-4000-8000-000000009102',
  (select (response ->> 'review_id')::uuid from opened_review),
  'approved',
  'Aceptar revisión secundaria',
  'La revisión manual documentó método y procedencia compatibles',
  '91000000-0000-4000-8000-000000009113'
) as response;

create temporary table second_activated as
select public.internal_nutrition_activate_revision(
  '00000000-0000-4000-8000-000000009101',
  '21000000-0000-4000-8000-000000009102',
  (
    select id from public.food_composition_revisions
    where import_key = 'revision:' || repeat('3', 64)
  ),
  '{"basis":"per_100_g","foodState":"raw","ediblePart":"whole_edible_product","method":"source_declared"}'::jsonb,
  decode(repeat('d', 64), 'hex'),
  'Revisión secundaria aprobada manualmente con discrepancia documentada',
  '91000000-0000-4000-8000-000000009114'
) as response;

select is(
  (select count(*)::integer from public.effective_food_revisions),
  2,
  'cada activación conserva la historia efectiva anterior'
);

select ok(
  exists (
    select 1
    from public.effective_food_revisions effective
    join public.food_composition_revisions revision on revision.id = effective.revision_id
    where revision.import_key = 'revision:' || repeat('c', 64)
      and effective.superseded_at is not null
  )
  and exists (
    select 1
    from public.effective_food_revisions effective
    join public.food_composition_revisions revision on revision.id = effective.revision_id
    where revision.import_key = 'revision:' || repeat('3', 64)
      and effective.superseded_at is null
  ),
  'la revisión anterior se archiva y la nueva queda activa sin sobrescritura'
);

select throws_ok(
  $$
    update public.nutrient_observations
    set normalized_value = 0
  $$,
  '55000',
  'immutable_nutrition_observation',
  'una observación nutricional importada es inmutable'
);

select throws_ok(
  $$
    select public.internal_nutrition_stage_batch(
      '00000000-0000-4000-8000-000000009101',
      '21000000-0000-4000-8000-000000009102',
      '91000000-0000-4000-8000-000000009106',
      jsonb_build_object(
        'status', 'quarantined',
        'publicationCount', 0,
        'violations', '[]'::jsonb,
        'manifest', jsonb_build_object(
          'id', 'manifest:' || repeat('e', 64),
          'sourceKey', 'ciqual_2025',
          'sourceVersion', 'commercial-test',
          'licenseStatus', 'approved',
          'retrievedAt', '2026-07-19T00:00:00.000Z',
          'transformations', '[]'::jsonb,
          'rawContentHash', repeat('e', 64),
          'normalizedContentHash', repeat('f', 64),
          'hashAlgorithm', 'sha256',
          'canonicalizationVersion', 'canonical-json-v1'
        ),
        'revisions', jsonb_build_array(
          jsonb_build_object(
            'id', 'revision:' || repeat('f', 64),
            'targetKind', 'commercial_product',
            'canonicalFoodKey', 'food:oat-flakes',
            'name', 'Producto GTIN', 'category', 'cereals', 'aliases', '[]'::jsonb,
            'basis', 'per_100_g', 'foodState', 'raw',
            'ediblePart', 'whole_edible_product', 'method', 'label',
            'sourceKey', 'ciqual_2025', 'sourceVersion', 'commercial-test',
            'status', 'quarantined', 'nutrients', '{}'::jsonb
          )
        )
      )
    )
  $$,
  '22023',
  'commercial_product_not_allowed',
  'la base también impide que un GTIN altere un alimento genérico'
);

select is(
  (
    select count(*)::integer
    from public.nutrition_source_manifests
    where import_key = 'manifest:' || repeat('e', 64)
  ),
  0,
  'un lote inválido se revierte entero y no deja publicación parcial'
);

create temporary table negative_import as
select public.internal_nutrition_stage_batch(
  '00000000-0000-4000-8000-000000009101',
  '21000000-0000-4000-8000-000000009102',
  '91000000-0000-4000-8000-000000009116',
  jsonb_build_object(
    'status', 'quarantined',
    'publicationCount', 0,
    'violations', '[]'::jsonb,
    'manifest', jsonb_build_object(
      'id', 'manifest:' || repeat('4', 64),
      'sourceKey', 'fineli',
      'sourceVersion', 'negative-test',
      'licenseStatus', 'approved',
      'retrievedAt', '2026-07-19T00:00:00.000Z',
      'transformations', jsonb_build_array('negative-fixture-v1'),
      'rawContentHash', repeat('4', 64),
      'normalizedContentHash', repeat('5', 64),
      'hashAlgorithm', 'sha256',
      'canonicalizationVersion', 'canonical-json-v1'
    ),
    'revisions', jsonb_build_array(
      jsonb_build_object(
        'id', 'revision:' || repeat('6', 64),
        'targetKind', 'generic_food',
        'canonicalFoodKey', 'food:negative-fixture',
        'name', 'Fixture negativo',
        'category', 'test_foods',
        'aliases', '[]'::jsonb,
        'basis', 'per_100_g',
        'foodState', 'raw',
        'ediblePart', 'whole_edible_product',
        'method', 'source_declared',
        'sourceKey', 'fineli',
        'sourceVersion', 'negative-test',
        'status', 'quarantined',
        'nutrients', jsonb_build_object(
          'sodium', jsonb_build_object(
            'basis', 'per_100_g', 'foodState', 'raw',
            'nutrientClass', 'sodium', 'state', 'known',
            'originalValue', '-0.01', 'originalUnit', 'mg',
            'normalizedValue', '-0.01', 'normalizedUnit', 'mg'
          )
        )
      )
    )
  )
) as response;

select throws_ok(
  format(
    $$select public.internal_nutrition_validate_revision(
      '00000000-0000-4000-8000-000000009101',
      '21000000-0000-4000-8000-000000009102',
      %L::uuid,
      'Un valor negativo imposible debe permanecer en cuarentena',
      '91000000-0000-4000-8000-000000009117'
    )$$,
    (
      select id from public.food_composition_revisions
      where import_key = 'revision:' || repeat('6', 64)
    )
  ),
  '55000',
  'nutrition_revision_negative_value',
  'un valor negativo imposible no puede superar la validación'
);

select ok(
  not has_function_privilege(
    'anon',
    'public.internal_nutrition_effective_generator_catalog()',
    'EXECUTE'
  )
  and not has_function_privilege(
    'authenticated',
    'public.internal_nutrition_effective_generator_catalog()',
    'EXECUTE'
  )
  and has_function_privilege(
    'service_role',
    'public.internal_nutrition_effective_generator_catalog()',
    'EXECUTE'
  ),
  'el lector efectivo T10 es privado y solo está disponible para service_role'
);

select is(
  public.internal_nutrition_effective_generator_catalog(),
  '[]'::jsonb,
  'una revisión sin los cinco valores exactos requeridos no entra en el generador'
);

select * from finish();

rollback;
