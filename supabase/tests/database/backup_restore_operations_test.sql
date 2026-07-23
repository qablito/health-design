begin;

select plan(14);

select ok(
  to_regprocedure(
    'public.internal_admin_create_backup_job(uuid,uuid,uuid,text,text,integer)'
  ) is not null,
  'existe creación AAL2 de BackupJob'
);
select ok(
  to_regprocedure(
    'public.internal_admin_list_backup_jobs(uuid,uuid)'
  ) is not null,
  'existe listado privado de backups'
);
select ok(
  to_regprocedure(
    'public.internal_admin_create_restore_job(uuid,uuid,uuid,uuid,bytea)'
  ) is not null,
  'existe creación AAL2 de RestoreJob'
);
select ok(
  to_regprocedure(
    'public.internal_admin_list_restore_jobs(uuid,uuid)'
  ) is not null,
  'existe listado privado de restores'
);
select ok(
  to_regprocedure(
    'public.internal_admin_promote_restore_job(uuid,uuid,uuid,integer)'
  ) is not null,
  'existe autorización independiente de promoción'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.internal_admin_create_backup_job(uuid,uuid,uuid,text,text,integer)',
    'EXECUTE'
  ),
  'service_role puede crear BackupJob'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.internal_admin_create_backup_job(uuid,uuid,uuid,text,text,integer)',
    'EXECUTE'
  ),
  'authenticated no crea BackupJob directamente'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.internal_admin_promote_restore_job(uuid,uuid,uuid,integer)',
    'EXECUTE'
  ),
  'authenticated no promueve restores directamente'
);
select ok(
  not has_table_privilege(
    'authenticated',
    'private.backup_jobs',
    'SELECT,INSERT,UPDATE,DELETE'
  ),
  'clientes no acceden a BackupJob'
);
select ok(
  not has_table_privilege(
    'authenticated',
    'private.restore_jobs',
    'SELECT,INSERT,UPDATE,DELETE'
  ),
  'clientes no acceden a RestoreJob'
);
select ok(
  (
    select proconfig @> array['search_path=pg_catalog']
    from pg_proc
    where oid = 'private.admin_create_backup_job(uuid,uuid,uuid,text,text,integer)'::regprocedure
  ),
  'creación de backup fija search_path'
);
select ok(
  (
    select proconfig @> array['search_path=pg_catalog']
    from pg_proc
    where oid = 'private.admin_create_restore_job(uuid,uuid,uuid,uuid,bytea)'::regprocedure
  ),
  'creación de restore fija search_path'
);
select ok(
  (
    select proconfig @> array['search_path=pg_catalog']
    from pg_proc
    where oid = 'private.admin_promote_restore_job(uuid,uuid,uuid,integer)'::regprocedure
  ),
  'promoción fija search_path'
);
select ok(
  (
    select pg_get_functiondef(
      'private.admin_promote_restore_job(uuid,uuid,uuid,integer)'::regprocedure
    ) like '%ready_for_promotion%'
  ),
  'solo un restore verificado puede autorizarse'
);

select * from finish();
rollback;
