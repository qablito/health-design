begin;

create or replace function public.internal_prepare_shopping_resolution(
  p_auth_subject uuid,
  p_auth_session_id uuid,
  p_plan_version_id uuid,
  p_base_snapshot_id uuid,
  p_operation text,
  p_mutation jsonb,
  p_key_digest bytea,
  p_request_digest bytea,
  p_ip_digest bytea
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_mutation jsonb := p_mutation;
begin
  if p_operation = 'shopping-snapshot-create' then
    if jsonb_typeof(p_mutation) is distinct from 'object'
      or (p_mutation ->> 'schemaVersion') is distinct from '1'
      or not p_mutation ? 'preferenceRevisionId'
      or p_mutation
        - array['schemaVersion', 'preferenceRevisionId']::text[]
        <> '{}'::jsonb
    then
      raise exception using errcode = '22023', message = 'invalid_shopping_create';
    end if;

    v_mutation := p_mutation - 'schemaVersion';
  end if;

  return private.prepare_shopping_resolution(
    p_auth_subject,
    p_auth_session_id,
    p_plan_version_id,
    p_base_snapshot_id,
    p_operation,
    v_mutation,
    p_key_digest,
    p_request_digest,
    p_ip_digest
  );
end
$$;

revoke all on function public.internal_prepare_shopping_resolution(
  uuid,uuid,uuid,uuid,text,jsonb,bytea,bytea,bytea
) from public, anon, authenticated;

grant execute on function public.internal_prepare_shopping_resolution(
  uuid,uuid,uuid,uuid,text,jsonb,bytea,bytea,bytea
) to service_role;

commit;
