begin;

select plan(15);

select ok(
  to_regclass('private.deletion_job_actors') is not null,
  'la purga conserva solo actores técnicos del job'
);
select ok(
  to_regprocedure(
    'public.internal_admin_get_profile_deletion_secret(uuid,uuid,uuid,uuid)'
  ) is not null,
  'existe lectura AAL2 reanudable por job del material mínimo'
);
select ok(
  to_regprocedure(
    'public.internal_admin_revoke_profile_access(uuid,uuid,uuid,integer)'
  ) is not null,
  'existe revocación idempotente'
);
select ok(
  to_regprocedure(
    'public.internal_admin_purge_profile_data(uuid,uuid,uuid,integer)'
  ) is not null,
  'existe purga interna de datos'
);
select ok(
  to_regprocedure(
    'public.internal_admin_list_orphan_auth_subjects(uuid,uuid,uuid)'
  ) is not null,
  'existe detección de identidades Auth huérfanas'
);
select ok(
  to_regprocedure(
    'public.internal_admin_verify_profile_purge(uuid,uuid,uuid)'
  ) is not null,
  'existe verificación explícita de ausencia'
);
select ok(
  to_regprocedure(
    'public.internal_record_t18_admin_intent(uuid,uuid,uuid,uuid,text,text,uuid,bigint,timestamptz,bytea,bytea,integer,bytea)'
  ) is not null,
  'existe intent/outbox T18 antes de la mutación'
);
select ok(
  (
    select pg_get_constraintdef(oid) like '%profile_deletion_permanent%'
    from pg_constraint
    where conname = 'audit_outbox_action_check'
  ),
  'la allowlist de auditoría incluye las acciones T18 cerradas'
);
select ok(
  not has_table_privilege(
    'authenticated',
    'private.deletion_job_actors',
    'SELECT,INSERT,UPDATE,DELETE'
  ),
  'clientes no acceden a los actores técnicos'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.internal_admin_purge_profile_data(uuid,uuid,uuid,integer)',
    'EXECUTE'
  ),
  'service_role puede orquestar la purga'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.internal_admin_purge_profile_data(uuid,uuid,uuid,integer)',
    'EXECUTE'
  ),
  'authenticated no puede purgar'
);
select ok(
  not exists (
    select 1
    from pg_proc p
    cross join lateral aclexplode(
      coalesce(p.proacl, acldefault('f', p.proowner))
    ) acl
    where p.pronamespace = 'private'::regnamespace
      and p.prosecdef
      and acl.grantee = 0
      and acl.privilege_type = 'EXECUTE'
  ),
  'las nuevas funciones privadas no permiten EXECUTE a PUBLIC'
);
select is(
  (
    select confdeltype
    from pg_constraint
    where conname = 'deletion_job_actors_job_id_fkey'
  ),
  'c',
  'los actores técnicos expiran con el job'
);
select is(
  (
    select confdeltype
    from pg_constraint
    where conname = 'deletion_job_actors_actor_id_fkey'
  ),
  'r',
  'el actor de auditoría no se elimina en cascada'
);
select ok(
  (
    select relrowsecurity
    from pg_class
    where oid = 'private.deletion_job_actors'::regclass
  ),
  'la tabla técnica tiene RLS'
);

select * from finish();
rollback;
