create function private.get_profile_current_plan(
  p_auth_subject uuid,
  p_auth_session_id uuid,
  p_profile_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_plan public.plans%rowtype;
begin
  perform private.require_questionnaire_access(
    p_auth_subject, p_auth_session_id, p_profile_id
  );

  select plan.* into v_plan
  from public.plans plan
  where plan.profile_id = p_profile_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'plan_not_found';
  end if;

  return private.list_plan_versions(
    p_auth_subject, p_auth_session_id, v_plan.id
  );
end;
$$;

create function public.internal_get_profile_current_plan(
  p_auth_subject uuid,
  p_auth_session_id uuid,
  p_profile_id uuid
)
returns jsonb
language sql
security definer
set search_path = pg_catalog
as $$
  select private.get_profile_current_plan(
    p_auth_subject, p_auth_session_id, p_profile_id
  )
$$;

revoke all on function private.get_profile_current_plan(uuid, uuid, uuid)
from public, anon, authenticated, service_role;

revoke all on function public.internal_get_profile_current_plan(uuid, uuid, uuid)
from public, anon, authenticated;

grant execute on function public.internal_get_profile_current_plan(uuid, uuid, uuid)
to service_role;
