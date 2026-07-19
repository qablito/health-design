select plan(20);

begin;

insert into auth.users (
  instance_id, id, aud, role, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at, is_anonymous
) values (
  '00000000-0000-0000-0000-000000000000',
  '00000000-0000-4000-8000-000000009301',
  'authenticated', 'authenticated',
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{}'::jsonb, now(), now(), false
);

insert into auth.sessions (id, user_id, created_at, updated_at, aal)
values
  (
    '21000000-0000-4000-8000-000000009301',
    '00000000-0000-4000-8000-000000009301', now(), now(), 'aal1'
  ),
  (
    '21000000-0000-4000-8000-000000009302',
    '00000000-0000-4000-8000-000000009301', now(), now(), 'aal2'
  );

insert into public.actors (id, auth_subject, role)
values (
  '31000000-0000-4000-8000-000000009301',
  '00000000-0000-4000-8000-000000009301',
  'superadmin'
);

select ok(
  to_regclass('public.clinical_rule_catalog_revisions') is not null
  and to_regclass('public.clinical_rule_catalog_activations') is not null,
  'T12 persiste revisiones descriptor y su historial de activación'
);

select is(
  (
    select count(*)::integer
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'clinical_rule_catalog_revisions'
      and data_type in ('json', 'jsonb')
  ),
  0,
  'el catálogo clínico no persiste expresiones ni reglas ejecutables'
);

select is(
  public.internal_clinical_rule_catalog_active(),
  jsonb_build_object(
    'canonicalizationVersion', 'canonical-json-v1',
    'clinicalCatalogVersion', 'clinical-selective-v2',
    'descriptorHash', 'af2fb4b04376b25e6054e0c12bc9df144a5ee8a0df585813c871f9505530752e',
    'hashAlgorithm', 'sha256',
    'ruleSetRevisionId', '9cf98aae-0f9f-452f-9577-72283eeff4d5',
    'schemaVersion', 1,
    'sourceManifestId', 'd46591cd-ae2a-4330-a037-c39436cae923'
  ),
  'el seed activo coincide exactamente con las constantes compiladas T12'
);

select is(
  (
    select encode(descriptor_hash, 'hex')
    from public.clinical_rule_catalog_revisions
    where origin = 'bootstrap'
  ),
  'af2fb4b04376b25e6054e0c12bc9df144a5ee8a0df585813c871f9505530752e',
  'el hash del descriptor bootstrap es reproducible'
);

select ok(
  not has_table_privilege(
    'authenticated', 'public.clinical_rule_catalog_revisions', 'SELECT'
  )
  and not has_table_privilege(
    'service_role', 'public.clinical_rule_catalog_revisions', 'SELECT'
  )
  and not has_function_privilege(
    'authenticated', 'public.internal_clinical_rule_catalog_active()', 'EXECUTE'
  )
  and has_function_privilege(
    'service_role', 'public.internal_clinical_rule_catalog_active()', 'EXECUTE'
  ),
  'RLS niega tablas y solo service_role puede usar el lector activo'
);

select throws_ok(
  $$
    select public.internal_clinical_rule_catalog_stage(
      '00000000-0000-4000-8000-000000009301',
      '21000000-0000-4000-8000-000000009301',
      'd46591cd-ae2a-4330-a037-c39436cae924',
      '9cf98aae-0f9f-452f-9577-72283eeff4d6',
      'clinical-selective-v3',
      '91000000-0000-4000-8000-000000009301'
    )
  $$,
  '42501',
  'aal2_required',
  'AAL1 no puede preparar una revisión clínica'
);

create temporary table staged_clinical_catalog as
select public.internal_clinical_rule_catalog_stage(
  '00000000-0000-4000-8000-000000009301',
  '21000000-0000-4000-8000-000000009302',
  'd46591cd-ae2a-4330-a037-c39436cae924',
  '9cf98aae-0f9f-452f-9577-72283eeff4d6',
  'clinical-selective-v3',
  '91000000-0000-4000-8000-000000009302'
) as response;

select is(
  (select response ->> 'status' from staged_clinical_catalog),
  'staged',
  'AAL2 prepara un descriptor futuro sin activarlo'
);

select is(
  (
    select public.internal_clinical_rule_catalog_stage(
      '00000000-0000-4000-8000-000000009301',
      '21000000-0000-4000-8000-000000009302',
      'd46591cd-ae2a-4330-a037-c39436cae924',
      '9cf98aae-0f9f-452f-9577-72283eeff4d6',
      'clinical-selective-v3',
      '91000000-0000-4000-8000-000000009302'
    ) ->> 'status'
  ),
  'staged',
  'preparar con la misma clave idempotente devuelve la misma revisión'
);

select throws_ok(
  $$
    select public.internal_clinical_rule_catalog_stage(
      '00000000-0000-4000-8000-000000009301',
      '21000000-0000-4000-8000-000000009302',
      'd46591cd-ae2a-4330-a037-c39436cae925',
      '9cf98aae-0f9f-452f-9577-72283eeff4d6',
      'clinical-selective-v3',
      '91000000-0000-4000-8000-000000009302'
    )
  $$,
  '23505',
  'idempotency_key_reused',
  'una clave idempotente no puede representar otro descriptor'
);

select is(
  public.internal_clinical_rule_catalog_active() ->> 'clinicalCatalogVersion',
  'clinical-selective-v2',
  'preparar una revisión no reemplaza el catálogo activo'
);

create temporary table validated_clinical_catalog as
select public.internal_clinical_rule_catalog_validate(
  '00000000-0000-4000-8000-000000009301',
  '21000000-0000-4000-8000-000000009302',
  (
    select (response ->> 'revision_id')::uuid
    from staged_clinical_catalog
  ),
  'Descriptor cotejado con fuentes, reglas y hash canónico compilable',
  '91000000-0000-4000-8000-000000009303'
) as response;

select is(
  (select response ->> 'status' from validated_clinical_catalog),
  'validated',
  'la revisión manual separa validación de activación'
);

select is(
  (
    select public.internal_clinical_rule_catalog_validate(
      '00000000-0000-4000-8000-000000009301',
      '21000000-0000-4000-8000-000000009302',
      (select (response ->> 'revision_id')::uuid from staged_clinical_catalog),
      'Descriptor cotejado con fuentes, reglas y hash canónico compilable',
      '91000000-0000-4000-8000-000000009303'
    ) ->> 'status'
  ),
  'validated',
  'repetir la validación con su clave idempotente no crea otro resultado'
);

select throws_ok(
  format(
    'update public.clinical_rule_catalog_revisions set clinical_catalog_version = %L where id = %L::uuid',
    'clinical-selective-tampered',
    (select response ->> 'revision_id' from staged_clinical_catalog)
  ),
  '55000',
  'immutable_clinical_catalog_revision',
  'una revisión validada es inmutable'
);

select throws_ok(
  format(
    $$select public.internal_clinical_rule_catalog_activate(
      '00000000-0000-4000-8000-000000009301',
      '21000000-0000-4000-8000-000000009301',
      %L::uuid,
      '91000000-0000-4000-8000-000000009304'
    )$$,
    (select response ->> 'revision_id' from staged_clinical_catalog)
  ),
  '42501',
  'aal2_required',
  'AAL1 no puede activar una revisión clínica'
);

create temporary table activated_clinical_catalog as
select public.internal_clinical_rule_catalog_activate(
  '00000000-0000-4000-8000-000000009301',
  '21000000-0000-4000-8000-000000009302',
  (
    select (response ->> 'revision_id')::uuid
    from staged_clinical_catalog
  ),
  '91000000-0000-4000-8000-000000009305'
) as response;

select is(
  (select response ->> 'status' from activated_clinical_catalog),
  'active',
  'solo una activación AAL2 explícita publica el descriptor'
);

select is(
  (
    select public.internal_clinical_rule_catalog_activate(
      '00000000-0000-4000-8000-000000009301',
      '21000000-0000-4000-8000-000000009302',
      (select (response ->> 'revision_id')::uuid from staged_clinical_catalog),
      '91000000-0000-4000-8000-000000009305'
    ) ->> 'activation_id'
  ),
  (select response ->> 'activation_id' from activated_clinical_catalog),
  'repetir la activación con su clave idempotente conserva la misma activación'
);

select is(
  (
    select count(*)::integer
    from public.clinical_rule_catalog_activations
    where superseded_at is null
  ),
  1,
  'solo existe una revisión clínica activa'
);

select is(
  (select count(*)::integer from public.clinical_rule_catalog_activations),
  2,
  'la activación nueva conserva el historial bootstrap'
);

select is(
  public.internal_clinical_rule_catalog_active() ->> 'clinicalCatalogVersion',
  'clinical-selective-v3',
  'el lector service_role refleja únicamente el descriptor activo'
);

select is(
  (
    select count(*)::integer
    from private.technical_audit_events
    where action in (
      'clinical_catalog_stage',
      'clinical_catalog_validate',
      'clinical_catalog_activate'
    )
      and request_id in (
        '91000000-0000-4000-8000-000000009302',
        '91000000-0000-4000-8000-000000009303',
        '91000000-0000-4000-8000-000000009305'
      )
  ),
  3,
  'preparación, validación y activación dejan auditoría técnica privada'
);

rollback;
