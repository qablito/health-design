select no_plan();

begin;

insert into auth.users (
  instance_id, id, aud, role, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at, is_anonymous
) values
  (
    '00000000-0000-0000-0000-000000000000',
    '00000000-0000-4000-8000-000000013101',
    'authenticated', 'authenticated',
    '{"provider":"anonymous","providers":["anonymous"]}'::jsonb,
    '{}'::jsonb, now(), now(), true
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '00000000-0000-4000-8000-000000013102',
    'authenticated', 'authenticated',
    '{"provider":"anonymous","providers":["anonymous"]}'::jsonb,
    '{}'::jsonb, now(), now(), true
  );

insert into auth.sessions (id, user_id, created_at, updated_at, aal)
values
  (
    '21000000-0000-4000-8000-000000013101',
    '00000000-0000-4000-8000-000000013101', now(), now(), 'aal1'
  ),
  (
    '21000000-0000-4000-8000-000000013102',
    '00000000-0000-4000-8000-000000013102', now(), now(), 'aal1'
  );

insert into public.actors (id, auth_subject)
values
  (
    '31000000-0000-4000-8000-000000013101',
    '00000000-0000-4000-8000-000000013101'
  ),
  (
    '31000000-0000-4000-8000-000000013102',
    '00000000-0000-4000-8000-000000013102'
  );

insert into public.profiles (id, alias, timezone, adult_attested_at)
values (
  '51000000-0000-4000-8000-000000013101',
  'Seguimiento T13', 'Europe/Madrid', now()
);

insert into public.profile_access (id, profile_id, actor_id)
values (
  '61000000-0000-4000-8000-000000013101',
  '51000000-0000-4000-8000-000000013101',
  '31000000-0000-4000-8000-000000013101'
);

insert into public.device_sessions (
  id, actor_id, auth_session_id, label, created_at, last_seen_at,
  idle_expires_at, absolute_expires_at
) values
  (
    '41000000-0000-4000-8000-000000013101',
    '31000000-0000-4000-8000-000000013101',
    '21000000-0000-4000-8000-000000013101',
    'Seguimiento propietario', now(), now(), now() + interval '30 days',
    now() + interval '180 days'
  ),
  (
    '41000000-0000-4000-8000-000000013102',
    '31000000-0000-4000-8000-000000013102',
    '21000000-0000-4000-8000-000000013102',
    'Seguimiento ajeno', now(), now(), now() + interval '30 days',
    now() + interval '180 days'
  );

insert into public.questionnaire_drafts (
  id, profile_id, schema_version, version, status, completeness, answers,
  confirmed_block_ids, current_block_id, uncertainties, hard_errors
) values (
  '71000000-0000-4000-8000-000000013101',
  '51000000-0000-4000-8000-000000013101',
  2, 1, 'submitted', 'complete',
  '{"activeModules":["nutrition","training","hydration","sleep","mobility","supplements"],"age":35,"weightKg":82,"trainingMode":"generated"}'::jsonb,
  array['core', 'modules', 'summary'], 'summary', '[]'::jsonb, '[]'::jsonb
);

insert into public.context_snapshots (
  id, profile_id, source_draft_id, source_draft_version, schema_version,
  effective_at, answers, completeness, normalization_version,
  input_hash, canonicalization_version
) values (
  '72000000-0000-4000-8000-000000013101',
  '51000000-0000-4000-8000-000000013101',
  '71000000-0000-4000-8000-000000013101', 1, 2, now(),
  '{"activeModules":["nutrition","training","hydration","sleep","mobility","supplements"],"age":35,"weightKg":82,"trainingMode":"generated"}'::jsonb,
  'complete', 'normalization-v1', decode(repeat('a1', 32), 'hex'),
  'canonical-json-v1'
);

insert into public.plans (id, profile_id)
values (
  '73000000-0000-4000-8000-000000013101',
  '51000000-0000-4000-8000-000000013101'
);

insert into public.plan_versions (
  id, plan_id, ordinal, status, completeness, validation_status, validation,
  context_snapshot_id, engine_version, rule_set_revision_id,
  source_manifest_id, input_hash, output_hash, canonicalization_version,
  created_at, validated_at, activated_at
) values (
  '74000000-0000-4000-8000-000000013101',
  '73000000-0000-4000-8000-000000013101',
  1, 'active', 'complete', 'valid', '{"completeness":"complete"}'::jsonb,
  '72000000-0000-4000-8000-000000013101', 'engine-contract-v1',
  '81000000-0000-4000-8000-000000013101',
  '82000000-0000-4000-8000-000000013101',
  decode(repeat('b1', 32), 'hex'), decode(repeat('b2', 32), 'hex'),
  'plan-canonical-v1', now(), now(), now()
);

update public.plans
set active_version_id = '74000000-0000-4000-8000-000000013101'
where id = '73000000-0000-4000-8000-000000013101';

select ok(
  to_regclass('public.follow_up_entries') is not null
  and to_regclass('public.lab_batches') is not null
  and to_regclass('public.lab_observations') is not null
  and to_regclass('public.context_snapshot_origins') is not null,
  'T13 crea historial, analíticas y linaje de snapshots derivados'
);

select ok(
  (
    select bool_and(relrowsecurity)
    from pg_class
    where oid in (
      'public.follow_up_entries'::regclass,
      'public.lab_batches'::regclass,
      'public.lab_observations'::regclass,
      'public.context_snapshot_origins'::regclass
    )
  ),
  'RLS está activo en todas las tablas sanitarias nuevas'
);

select ok(
  not has_table_privilege('authenticated', 'public.follow_up_entries', 'SELECT')
  and not has_table_privilege('authenticated', 'public.lab_observations', 'SELECT')
  and has_table_privilege('service_role', 'public.follow_up_entries', 'SELECT')
  and not has_table_privilege('service_role', 'public.follow_up_entries', 'INSERT')
  and not has_table_privilege('service_role', 'public.lab_observations', 'UPDATE'),
  'el navegador no lee datos clínicos y el servicio solo recibe lectura directa'
);

create temporary table first_follow_up as
select public.internal_record_follow_up(
  '00000000-0000-4000-8000-000000013101',
  '21000000-0000-4000-8000-000000013101',
  '51000000-0000-4000-8000-000000013101',
  '74000000-0000-4000-8000-000000013101',
  'weekly', '2026-07-20T08:00:00Z',
  '{"common":{"adherence":4,"importantSymptoms":[],"materialChanges":[]},"nutrition":{"hunger":3}}'::jsonb,
  'complete', false,
  decode(repeat('c1', 32), 'hex'), decode(repeat('c2', 32), 'hex')
) as response;

select is(
  (select response ->> 'scope' from first_follow_up),
  'weekly',
  'registra una revisión semanal vinculada a la versión activa'
);

select is(
  public.internal_record_follow_up(
    '00000000-0000-4000-8000-000000013101',
    '21000000-0000-4000-8000-000000013101',
    '51000000-0000-4000-8000-000000013101',
    '74000000-0000-4000-8000-000000013101',
    'weekly', '2026-07-20T08:00:00Z',
    '{"common":{"adherence":4,"importantSymptoms":[],"materialChanges":[]},"nutrition":{"hunger":3}}'::jsonb,
    'complete', false,
    decode(repeat('c1', 32), 'hex'), decode(repeat('c2', 32), 'hex')
  ),
  (select response from first_follow_up),
  'repetir la clave idempotente devuelve exactamente el mismo seguimiento'
);

select is(
  (select count(*) from public.follow_up_entries),
  1::bigint,
  'la repetición idempotente no duplica el historial'
);

select throws_ok(
  $$
    update public.follow_up_entries set completeness = 'provisional'
    where id = (
      select (response ->> 'id')::uuid from first_follow_up
    )
  $$,
  '55000', 'immutable_follow_up_artifact',
  'las revisiones guardadas son inmutables'
);

select throws_ok(
  $$
    select public.internal_list_follow_ups(
      '00000000-0000-4000-8000-000000013102',
      '21000000-0000-4000-8000-000000013102',
      '51000000-0000-4000-8000-000000013101', 100
    )
  $$,
  '42501', 'access_not_granted',
  'un actor ajeno no puede leer el seguimiento del perfil'
);

select is(
  jsonb_array_length(public.internal_list_follow_ups(
    '00000000-0000-4000-8000-000000013101',
    '21000000-0000-4000-8000-000000013101',
    '51000000-0000-4000-8000-000000013101', 100
  ) -> 'entries'),
  1,
  'el propietario recupera su historial de seguimiento'
);

create temporary table first_lab_batch as
select public.internal_record_lab_batch(
  '00000000-0000-4000-8000-000000013101',
  '21000000-0000-4000-8000-000000013101',
  '51000000-0000-4000-8000-000000013101',
  '74000000-0000-4000-8000-000000013101',
  false,
  '[
    {
      "analyte":"b12","name":"Vitamina B12","value":"180",
      "unit":"pg/mL","source":"laboratory","confidence":"high",
      "measurement":{"kind":"exact","date":"2026-07-01"},
      "referenceRange":{"minimum":"200","maximum":"900","unit":"pg/mL"}
    },
    {
      "analyte":"folate","name":"Folato","value":"4.2",
      "source":"self_reported","confidence":"unknown",
      "measurement":{"kind":"unknown"}
    }
  ]'::jsonb,
  decode(repeat('d1', 32), 'hex'), decode(repeat('d2', 32), 'hex')
) as response;

select is(
  jsonb_array_length((select response -> 'observations' from first_lab_batch)),
  2,
  'una carga manual conserva entre uno y cuatro valores analíticos'
);

select ok(
  not ((select response -> 'observations' -> 1 from first_lab_batch) ? 'unit')
  and (select response -> 'observations' -> 0 -> 'referenceRange' ->> 'minimum'
       from first_lab_batch) = '200',
  'los datos incompletos permanecen explícitos sin inventar unidad o rango'
);

select is(
  (select count(*) from public.lab_batches), 1::bigint,
  'la carga se registra como un único lote trazable'
);

select is(
  public.internal_record_lab_batch(
    '00000000-0000-4000-8000-000000013101',
    '21000000-0000-4000-8000-000000013101',
    '51000000-0000-4000-8000-000000013101',
    '74000000-0000-4000-8000-000000013101',
    false,
    '[{"analyte":"b12","name":"Vitamina B12","value":"180","unit":"pg/mL","source":"laboratory","confidence":"high","measurement":{"kind":"exact","date":"2026-07-01"},"referenceRange":{"minimum":"200","maximum":"900","unit":"pg/mL"}},{"analyte":"folate","name":"Folato","value":"4.2","source":"self_reported","confidence":"unknown","measurement":{"kind":"unknown"}}]'::jsonb,
    decode(repeat('d1', 32), 'hex'), decode(repeat('d2', 32), 'hex')
  ),
  (select response from first_lab_batch),
  'el lote manual también es idempotente'
);

create temporary table derived_snapshot as
select public.internal_create_derived_context_snapshot(
  '00000000-0000-4000-8000-000000013101',
  '21000000-0000-4000-8000-000000013101',
  '51000000-0000-4000-8000-000000013101',
  '74000000-0000-4000-8000-000000013101',
  'lab_batch', (select (response ->> 'batchId')::uuid from first_lab_batch),
  '2026-07-20T08:30:00Z',
  '{"activeModules":["nutrition","training","hydration","sleep","mobility","supplements"],"age":35,"weightKg":82,"trainingMode":"generated","hasLabValues":true,"labValues":[{"name":"Vitamina B12","value":180,"unit":"pg/mL"}]}'::jsonb,
  'complete', decode(repeat('e1', 32), 'hex')
) as response;

select ok(
  (select response ->> 'id' from derived_snapshot)
    <> '72000000-0000-4000-8000-000000013101'
  and exists (
    select 1 from public.context_snapshot_origins
    where context_snapshot_id =
      (select (response ->> 'id')::uuid from derived_snapshot)
  ),
  'el cambio analítico crea contexto derivado con linaje sin tocar el activo'
);

select is(
  (
    select active_version_id::text from public.plans
    where id = '73000000-0000-4000-8000-000000013101'
  ),
  '74000000-0000-4000-8000-000000013101',
  'crear seguimiento y contexto derivado nunca activa otra versión'
);

select throws_ok(
  $$
    select public.internal_create_derived_context_snapshot(
      '00000000-0000-4000-8000-000000013101',
      '21000000-0000-4000-8000-000000013101',
      '51000000-0000-4000-8000-000000013101',
      '74000000-0000-4000-8000-000000013101',
      'lab_batch', (select (response ->> 'batchId')::uuid from first_lab_batch),
      '2026-07-20T08:30:00Z',
      '{"activeModules":["nutrition"]}'::jsonb,
      'complete', decode(repeat('e2', 32), 'hex')
    )
  $$,
  '23505', 'idempotency_key_reused',
  'una fuente registrada no puede derivar dos contextos distintos'
);

select * from finish();
rollback;
