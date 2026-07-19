select plan(8);

begin;

select ok(
  to_regclass('public.clinical_medication_identities') is not null,
  'T12 mantiene una caché autoritativa de identidades AEMPS/CIMA'
);

select ok(
  not has_table_privilege(
    'authenticated', 'public.clinical_medication_identities', 'SELECT'
  )
  and not has_table_privilege(
    'service_role', 'public.clinical_medication_identities', 'SELECT'
  )
  and not has_function_privilege(
    'authenticated',
    'public.internal_clinical_medication_identities_resolve(text[])',
    'EXECUTE'
  )
  and has_function_privilege(
    'service_role',
    'public.internal_clinical_medication_identities_resolve(text[])',
    'EXECUTE'
  ),
  'la tabla queda cerrada y solo las RPC service_role exponen datos mínimos'
);

select throws_ok(
  $$
    select public.internal_clinical_medication_identities_upsert(
      '[{"aempsId":"bad id"}]'::jsonb
    )
  $$,
  '22023',
  'invalid_clinical_medication_identity',
  'la caché rechaza identidades incompletas o mal formadas'
);

select throws_ok(
  $$
    select public.internal_clinical_medication_identities_upsert(
      jsonb_build_array(jsonb_build_object(
        'activeIngredients', jsonb_build_array('SEMAGLUTIDA'),
        'administrationRoutes', jsonb_build_array('VÍA SUBCUTÁNEA'),
        'aempsId', '117251002',
        'canonicalName', 'OZEMPIC 0,25 MG SOLUCION INYECTABLE',
        'extra', true,
        'prescriptionRequired', true,
        'retrievedAt', '2026-07-19T19:00:00.000Z',
        'sourceHash', repeat('a', 64),
        'sourceVersion', 'CIMA_REST_API_1_23'
      ))
    )
  $$,
  '22023',
  'invalid_clinical_medication_identity',
  'la caché exige las nueve claves exactas sin sustituciones ni extras'
);

select is(
  public.internal_clinical_medication_identities_upsert(
    jsonb_build_array(jsonb_build_object(
      'activeIngredients', jsonb_build_array('SEMAGLUTIDA'),
      'administrationRoutes', jsonb_build_array('VÍA SUBCUTÁNEA'),
      'aempsId', '117251002',
      'canonicalName', 'OZEMPIC 0,25 MG SOLUCION INYECTABLE',
      'commercialized', true,
      'prescriptionRequired', true,
      'retrievedAt', '2026-07-19T19:00:00.000Z',
      'sourceHash', repeat('a', 64),
      'sourceVersion', 'CIMA_REST_API_1_23'
    ))
  ),
  1,
  'una identidad oficial validada queda almacenada'
);

select is(
  public.internal_clinical_medication_identities_resolve(array['117251002']),
  jsonb_build_array(jsonb_build_object(
    'activeIngredients', jsonb_build_array('SEMAGLUTIDA'),
    'administrationRoutes', jsonb_build_array('VÍA SUBCUTÁNEA'),
    'aempsId', '117251002',
    'canonicalName', 'OZEMPIC 0,25 MG SOLUCION INYECTABLE',
    'commercialized', true,
    'prescriptionRequired', true,
    'retrievedAt', '2026-07-19T19:00:00+00:00',
    'sourceHash', repeat('a', 64),
    'sourceVersion', 'CIMA_REST_API_1_23'
  )),
  'resolver devuelve solo la identidad canónica, procedencia y estado permitido'
);

select is(
  public.internal_clinical_medication_identities_upsert(
    jsonb_build_array(jsonb_build_object(
      'activeIngredients', jsonb_build_array('SEMAGLUTIDA'),
      'administrationRoutes', jsonb_build_array('VÍA SUBCUTÁNEA'),
      'aempsId', '117251002',
      'canonicalName', 'OZEMPIC 0,25 MG SOLUCION INYECTABLE EN PLUMA',
      'commercialized', false,
      'prescriptionRequired', true,
      'retrievedAt', '2026-07-19T20:00:00.000Z',
      'sourceHash', repeat('b', 64),
      'sourceVersion', 'CIMA_REST_API_1_23'
    ))
  ),
  1,
  'una consulta oficial posterior actualiza la misma identidad AEMPS'
);

select is(
  public.internal_clinical_medication_identities_resolve(
    array['117251002', '999999999']
  ) -> 0 ->> 'sourceHash',
  repeat('b', 64),
  'resolver omite IDs desconocidos y conserva la revisión oficial más reciente'
);

rollback;
