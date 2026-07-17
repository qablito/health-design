begin;

select no_plan();

select ok(
  to_regclass('private.impersonation_sessions') is not null,
  'existe la sesión privada de impersonación'
);
select ok(
  to_regclass('private.audit_outbox') is not null,
  'existe el outbox privado de auditoría'
);
select has_column(
  'private',
  'technical_audit_events',
  'event_sequence',
  'TechnicalAuditEvent tiene secuencia total'
);
select has_column(
  'private',
  'technical_audit_events',
  'original_actor_id',
  'TechnicalAuditEvent conserva el actor original'
);
select has_column(
  'private',
  'technical_audit_events',
  'effective_profile_id',
  'TechnicalAuditEvent conserva el perfil efectivo'
);
select has_column(
  'private',
  'technical_audit_events',
  'impersonation_session_id',
  'TechnicalAuditEvent conserva la sesión de impersonación'
);
select ok(
  not exists (
    select 1
    from information_schema.columns
    where table_schema = 'private'
      and table_name = 'audit_outbox'
      and column_name = 'payload'
  ),
  'AuditOutbox no admite payload libre'
);
select ok(
  not has_table_privilege(
    'authenticated',
    'private.impersonation_sessions',
    'SELECT,INSERT,UPDATE,DELETE'
  ),
  'el navegador no accede a sesiones de impersonación'
);
select ok(
  not has_table_privilege(
    'authenticated',
    'private.audit_outbox',
    'SELECT,INSERT,UPDATE,DELETE'
  ),
  'el navegador no accede al outbox'
);
select ok(
  not has_table_privilege(
    'service_role',
    'private.technical_audit_events',
    'INSERT'
  ),
  'la ruta de servicio no inserta auditoría directamente'
);
select ok(
  to_regprocedure(
    'public.internal_admin_start_impersonation(uuid,uuid,uuid,uuid,bigint,timestamptz,bytea,bytea,integer,bytea)'
  ) is not null,
  'existe el inicio interno de impersonación'
);
select ok(
  to_regprocedure(
    'public.internal_admin_current_context(uuid,uuid)'
  ) is not null,
  'existe la consulta interna del contexto administrativo'
);
select ok(
  to_regprocedure(
    'public.internal_admin_authorize(uuid,uuid)'
  ) is not null,
  'existe la autorización interna del superadministrador'
);
select ok(
  to_regprocedure(
    'public.internal_admin_list_profiles(uuid,uuid)'
  ) is not null,
  'existe el listado interno de perfiles administrativos'
);
select ok(
  to_regprocedure(
    'public.internal_admin_end_impersonation(uuid,uuid,uuid,uuid,bigint,timestamptz,bytea,bytea,integer,bytea)'
  ) is not null,
  'existe el cierre interno de impersonación'
);
select ok(
  to_regprocedure(
    'public.internal_admin_list_pending_audit_outbox(integer)'
  ) is not null,
  'existe el claim cerrado del outbox pendiente'
);
select ok(
  to_regprocedure(
    'public.internal_admin_finalize_audit_outbox(uuid,bigint,timestamptz,bytea,bytea,integer,bytea)'
  ) is not null,
  'existe el cierre idempotente del outbox'
);
select ok(
  to_regprocedure(
    'public.internal_admin_audit_request_state(uuid)'
  ) is not null,
  'existe el journal de estado para reconciliación'
);
select ok(
  to_regprocedure(
    'public.internal_admin_record_reconciliation(uuid,uuid,uuid,uuid,text,text,uuid,bigint,timestamptz,bytea,bytea,integer,bytea)'
  ) is not null,
  'existe el espejo local de una reconciliación externa'
);

insert into auth.users (
  instance_id,
  id,
  aud,
  role,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at,
  is_anonymous
)
values
  (
    '00000000-0000-0000-0000-000000000000',
    '00000000-0000-4000-8000-000000005101',
    'authenticated',
    'authenticated',
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb,
    now(),
    now(),
    false
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '00000000-0000-4000-8000-000000005102',
    'authenticated',
    'authenticated',
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb,
    now(),
    now(),
    false
  );

insert into auth.sessions (id, user_id, created_at, updated_at, aal)
values
  (
    '21000000-0000-4000-8000-000000005101',
    '00000000-0000-4000-8000-000000005101',
    now(),
    now(),
    'aal1'
  ),
  (
    '21000000-0000-4000-8000-000000005102',
    '00000000-0000-4000-8000-000000005101',
    now(),
    now(),
    'aal2'
  ),
  (
    '21000000-0000-4000-8000-000000005103',
    '00000000-0000-4000-8000-000000005102',
    now(),
    now(),
    'aal2'
  );

insert into public.actors (id, auth_subject, role)
values
  (
    '31000000-0000-4000-8000-000000005101',
    '00000000-0000-4000-8000-000000005101',
    'superadmin'
  ),
  (
    '31000000-0000-4000-8000-000000005102',
    '00000000-0000-4000-8000-000000005102',
    'device'
  );

insert into public.profiles (id, alias, timezone, adult_attested_at)
values (
  '51000000-0000-4000-8000-000000005101',
  'Perfil Admin Test',
  'Europe/Madrid',
  now()
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-000000005102","role":"authenticated","aal":"aal2","session_id":"21000000-0000-4000-8000-000000005103"}',
  true
);
select throws_ok(
  $$
    update public.actors
    set role = 'superadmin'
    where id = '31000000-0000-4000-8000-000000005102'
  $$,
  '42501',
  null,
  'un usuario no puede autoasignarse superadministrador'
);
reset role;

select throws_ok(
  $$
    select * from public.internal_admin_start_impersonation(
      '00000000-0000-4000-8000-000000005101',
      '21000000-0000-4000-8000-000000005101',
      '51000000-0000-4000-8000-000000005101',
      '61000000-0000-4000-8000-000000005101',
      1,
      '2026-07-17T16:00:00Z',
      decode(repeat('11', 32), 'hex'),
      decode(repeat('12', 64), 'hex'),
      1,
      decode(repeat('13', 32), 'hex')
    )
  $$,
  '42501',
  'aal2_required',
  'AAL1 no puede iniciar impersonación'
);

select throws_ok(
  $$
    select * from public.internal_admin_current_context(
      '00000000-0000-4000-8000-000000005101',
      '21000000-0000-4000-8000-000000005101'
    )
  $$,
  '42501',
  'aal2_required',
  'AAL1 tampoco puede consultar el contexto administrativo'
);

select throws_ok(
  $$
    select * from public.internal_admin_start_impersonation(
      '00000000-0000-4000-8000-000000005102',
      '21000000-0000-4000-8000-000000005103',
      '51000000-0000-4000-8000-000000005101',
      '61000000-0000-4000-8000-000000005102',
      1,
      '2026-07-17T16:00:01Z',
      decode(repeat('21', 32), 'hex'),
      decode(repeat('22', 64), 'hex'),
      1,
      decode(repeat('23', 32), 'hex')
    )
  $$,
  '42501',
  'superadmin_required',
  'un actor ordinario con AAL2 no puede impersonar'
);

select throws_ok(
  $$
    select * from public.internal_admin_start_impersonation(
      '00000000-0000-4000-8000-000000005101',
      '21000000-0000-4000-8000-000000005102',
      '51000000-0000-4000-8000-000000005101',
      '61000000-0000-4000-8000-000000005103',
      null,
      null,
      null,
      null,
      null,
      null
    )
  $$,
  '22023',
  'intent_receipt_required',
  'la mutación no comienza sin un intent externo'
);

select lives_ok(
  $$
    select * from public.internal_admin_start_impersonation(
      '00000000-0000-4000-8000-000000005101',
      '21000000-0000-4000-8000-000000005102',
      '51000000-0000-4000-8000-000000005101',
      '61000000-0000-4000-8000-000000005104',
      1,
      '2026-07-17T16:00:02Z',
      decode(repeat('31', 32), 'hex'),
      decode(repeat('32', 64), 'hex'),
      1,
      decode(repeat('33', 32), 'hex')
    )
  $$,
  'AAL2 con intent confirmado inicia la impersonación'
);

select is(
  public.internal_admin_authorize(
    '00000000-0000-4000-8000-000000005101',
    '21000000-0000-4000-8000-000000005102'
  ),
  '31000000-0000-4000-8000-000000005101'::uuid,
  'la autorización devuelve el actor original opaco'
);
select is(
  (
    select count(*)
    from public.internal_admin_list_profiles(
      '00000000-0000-4000-8000-000000005101',
      '21000000-0000-4000-8000-000000005102'
    ) listed_profile
    where listed_profile.profile_id = '51000000-0000-4000-8000-000000005101'
  ),
  1::bigint,
  'el superadministrador AAL2 puede listar perfiles'
);

select is(
  (
    select original_actor_id
    from private.impersonation_sessions
    where auth_session_id = '21000000-0000-4000-8000-000000005102'
      and ended_at is null
  ),
  '31000000-0000-4000-8000-000000005101'::uuid,
  'la sesión conserva el actor original'
);
select is(
  (
    select effective_profile_id
    from private.impersonation_sessions
    where auth_session_id = '21000000-0000-4000-8000-000000005102'
      and ended_at is null
  ),
  '51000000-0000-4000-8000-000000005101'::uuid,
  'la sesión conserva el perfil efectivo'
);
select ok(
  exists (
    select 1
    from private.technical_audit_events event
    join private.impersonation_sessions impersonation
      on impersonation.id = event.impersonation_session_id
    where event.original_actor_id = '31000000-0000-4000-8000-000000005101'
      and event.effective_profile_id = '51000000-0000-4000-8000-000000005101'
      and event.request_id = '61000000-0000-4000-8000-000000005104'
      and event.phase = 'intent'
      and event.external_sequence = 1
      and impersonation.ended_at is null
  ),
  'el espejo local conserva actor, perfil, request, intent y sesión'
);
select ok(
  exists (
    select 1
    from private.audit_outbox outbox
    where outbox.request_id = '61000000-0000-4000-8000-000000005104'
      and outbox.outcome_status = 'pending'
  ),
  'el resultado queda pendiente en el outbox cerrado'
);
select is(
  (
    select count(*)
    from public.internal_admin_list_pending_audit_outbox(10) pending
    where pending.request_id = '61000000-0000-4000-8000-000000005104'
      and pending.action = 'impersonation_start'
      and pending.intent_record_hash = decode(repeat('31', 32), 'hex')
  ),
  1::bigint,
  'el dispatcher solo obtiene metadatos allowlisted e intent hash del outbox'
);
select lives_ok(
  $$
    select public.internal_admin_finalize_audit_outbox(
      '61000000-0000-4000-8000-000000005104',
      2,
      '2026-07-17T16:00:02.500Z',
      decode(repeat('34', 32), 'hex'),
      decode(repeat('35', 64), 'hex'),
      1,
      decode(repeat('36', 32), 'hex')
    )
  $$,
  'el recibo outcome cierra el outbox'
);
select is(
  (
    select state
    from public.internal_admin_audit_request_state(
      '61000000-0000-4000-8000-000000005104'
    )
  ),
  'success'::text,
  'el journal refleja el outcome confirmado'
);
select ok(
  exists (
    select 1
    from private.technical_audit_events event
    where event.request_id = '61000000-0000-4000-8000-000000005104'
      and event.phase = 'outcome'
      and event.result = 'success'
      and event.external_sequence = 2
  ),
  'el outcome externo queda espejado como evento inmutable'
);
select lives_ok(
  $$
    select public.internal_admin_finalize_audit_outbox(
      '61000000-0000-4000-8000-000000005104',
      2,
      '2026-07-17T16:00:02.500Z',
      decode(repeat('34', 32), 'hex'),
      decode(repeat('35', 64), 'hex'),
      1,
      decode(repeat('36', 32), 'hex')
    )
  $$,
  'repetir el mismo cierre no duplica eventos'
);
select is(
  (
    select count(*)
    from private.technical_audit_events event
    where event.request_id = '61000000-0000-4000-8000-000000005104'
      and event.phase = 'outcome'
  ),
  1::bigint,
  'el cierre del outbox es idempotente'
);
select lives_ok(
  $$
    select public.internal_admin_record_reconciliation(
      '61000000-0000-4000-8000-000000005106',
      '31000000-0000-4000-8000-000000005101',
      '51000000-0000-4000-8000-000000005101',
      null,
      'impersonation_start',
      'profile',
      '51000000-0000-4000-8000-000000005101',
      3,
      '2026-07-17T16:00:02.750Z',
      decode(repeat('37', 32), 'hex'),
      decode(repeat('38', 64), 'hex'),
      1,
      decode(repeat('39', 32), 'hex')
    )
  $$,
  'un intent externo sin mutación local se cierra por reconciliación'
);
select ok(
  exists (
    select 1
    from private.technical_audit_events event
    where event.request_id = '61000000-0000-4000-8000-000000005106'
      and event.phase = 'reconciliation'
      and event.result = 'failure'
  ),
  'la reconciliación deja un espejo técnico mínimo'
);
select is(
  (
    select effective_profile_id
    from public.internal_admin_current_context(
      '00000000-0000-4000-8000-000000005101',
      '21000000-0000-4000-8000-000000005102'
    )
  ),
  '51000000-0000-4000-8000-000000005101'::uuid,
  'el contexto activo se recupera después de navegar o refrescar'
);

select throws_ok(
  $$
    update private.technical_audit_events
    set result = 'altered'
    where request_id = '61000000-0000-4000-8000-000000005104'
  $$,
  '55000',
  'immutable_audit_event',
  'TechnicalAuditEvent rechaza UPDATE'
);
select throws_ok(
  $$
    delete from private.technical_audit_events
    where request_id = '61000000-0000-4000-8000-000000005104'
  $$,
  '55000',
  'immutable_audit_event',
  'TechnicalAuditEvent rechaza DELETE'
);

select lives_ok(
  $$
    select * from public.internal_admin_end_impersonation(
      '00000000-0000-4000-8000-000000005101',
      '21000000-0000-4000-8000-000000005102',
      (
        select id
        from private.impersonation_sessions
        where auth_session_id = '21000000-0000-4000-8000-000000005102'
          and ended_at is null
      ),
      '61000000-0000-4000-8000-000000005105',
      4,
      '2026-07-17T16:00:03Z',
      decode(repeat('41', 32), 'hex'),
      decode(repeat('42', 64), 'hex'),
      1,
      decode(repeat('43', 32), 'hex')
    )
  $$,
  'el superadministrador puede terminar su impersonación'
);
select is(
  (
    select count(*)
    from public.internal_admin_current_context(
      '00000000-0000-4000-8000-000000005101',
      '21000000-0000-4000-8000-000000005102'
    )
  ),
  0::bigint,
  'salir devuelve inequívocamente al contexto administrativo'
);
select is(
  (
    select count(distinct event_sequence)
    from private.technical_audit_events
    where request_id in (
      '61000000-0000-4000-8000-000000005104',
      '61000000-0000-4000-8000-000000005105'
    )
  ),
  3::bigint,
  'intents y outcomes administrativos obtienen una secuencia local total sin bifurcar'
);

select * from finish();
rollback;
