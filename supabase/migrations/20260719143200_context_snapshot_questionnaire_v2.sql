alter table public.context_snapshots
drop constraint context_snapshots_schema_version_check;

alter table public.context_snapshots
add constraint context_snapshots_schema_version_check
check (schema_version in (1, 2));

comment on constraint context_snapshots_schema_version_check
on public.context_snapshots is
'T10: conserva snapshots históricos V1 y permite nuevos snapshots del cuestionario V2.';
