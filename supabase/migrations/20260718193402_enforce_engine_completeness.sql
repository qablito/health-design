create function private.apply_engine_completeness()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
declare
  engine_completeness text := new.validation ->> 'completeness';
begin
  if engine_completeness is null then
    return new;
  end if;
  if engine_completeness not in ('complete', 'provisional') then
    raise exception using
      errcode = '23514',
      message = 'invalid_engine_completeness';
  end if;
  if engine_completeness = 'provisional' then
    new.completeness := 'provisional';
  end if;
  return new;
end;
$$;

create trigger plan_versions_apply_engine_completeness
before insert on public.plan_versions
for each row execute function private.apply_engine_completeness();

revoke all on function private.apply_engine_completeness() from public;
revoke all on function private.apply_engine_completeness()
  from anon, authenticated, service_role;

comment on function private.apply_engine_completeness() is
  'Combina la completitud del snapshot y del motor; provisional siempre prevalece.';
