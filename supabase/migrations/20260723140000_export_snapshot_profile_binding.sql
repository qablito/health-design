create or replace function private.get_plan_export_source(
  p_auth_subject uuid,
  p_auth_session_id uuid,
  p_plan_version_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_profile_id uuid;
  v_plan_id uuid;
  v_output_hash bytea;
  v_nutrition jsonb;
begin
  select plan.profile_id, plan.id, version.output_hash
  into v_profile_id, v_plan_id, v_output_hash
  from public.plan_versions version
  join public.plans plan on plan.id = version.plan_id
  where version.id = p_plan_version_id
    and version.validation_status = 'valid';

  if not found then
    raise exception using errcode = 'P0002', message = 'plan_version_not_found';
  end if;

  perform private.require_export_access(
    p_auth_subject, p_auth_session_id, v_profile_id
  );

  select result.payload into v_nutrition
  from public.module_results result
  where result.plan_version_id = p_plan_version_id
    and result.module = 'nutrition'
    and result.status in ('valid', 'provisional');

  if v_nutrition is null then
    raise exception using errcode = 'P0002', message = 'nutrition_result_not_found';
  end if;

  return jsonb_build_object(
    'profileId', v_profile_id,
    'planId', v_plan_id,
    'planVersionId', p_plan_version_id,
    'outputHash', encode(v_output_hash, 'hex'),
    'nutrition', v_nutrition
  );
end;
$$;
