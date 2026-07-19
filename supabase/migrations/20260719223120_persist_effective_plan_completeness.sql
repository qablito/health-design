create or replace function private.apply_engine_completeness()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
declare
  context_completeness text;
  engine_completeness text := new.validation ->> 'completeness';
begin
  if engine_completeness is null
    or engine_completeness not in ('complete', 'provisional')
  then
    raise exception using
      errcode = '23514',
      message = 'invalid_engine_completeness';
  end if;

  select snapshot.completeness into context_completeness
  from public.context_snapshots snapshot
  where snapshot.id = new.context_snapshot_id;

  if context_completeness is null
    or context_completeness not in ('complete', 'provisional')
  then
    raise exception using
      errcode = '23514',
      message = 'invalid_context_completeness';
  end if;

  new.completeness := case
    when context_completeness = 'provisional'
      or engine_completeness = 'provisional'
    then 'provisional'
    else 'complete'
  end;
  return new;
end;
$$;

comment on function private.apply_engine_completeness() is
  'Persiste la completitud efectiva: provisional en contexto o motor siempre prevalece; entradas ausentes o inválidas fallan cerradas.';

drop function public.internal_create_plan_draft(
  uuid, uuid, uuid, uuid, text, text, uuid, uuid, bytea, bytea, text, jsonb,
  jsonb, jsonb, bytea, bytea
);

create function public.internal_create_plan_draft(
  p_auth_subject uuid,
  p_auth_session_id uuid,
  p_profile_id uuid,
  p_context_snapshot_id uuid,
  p_engine_version text,
  p_canonicalization_version text,
  p_rule_set_revision_id uuid,
  p_source_manifest_id uuid,
  p_input_hash bytea,
  p_output_hash bytea,
  p_engine_completeness text,
  p_validation_status text,
  p_validation jsonb,
  p_module_results jsonb,
  p_safety_findings jsonb,
  p_idempotency_key_digest bytea,
  p_request_digest bytea
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  if p_engine_completeness is null
    or p_engine_completeness not in ('complete', 'provisional')
    or p_validation ->> 'completeness' is distinct from p_engine_completeness
  then
    raise exception using errcode = '22023', message = 'invalid_input';
  end if;

  return private.create_plan_draft(
    p_auth_subject, p_auth_session_id, p_profile_id, p_context_snapshot_id,
    p_engine_version, p_canonicalization_version, p_rule_set_revision_id,
    p_source_manifest_id, p_input_hash, p_output_hash, p_validation_status,
    p_validation, p_module_results, p_safety_findings,
    p_idempotency_key_digest, p_request_digest
  );
end;
$$;

drop function public.internal_create_plan_candidate(
  uuid, uuid, uuid, integer, uuid, uuid, text, jsonb, text, jsonb, text, text,
  uuid, uuid, bytea, bytea, text, jsonb, jsonb, jsonb, bytea, bytea
);

create function public.internal_create_plan_candidate(
  p_auth_subject uuid,
  p_auth_session_id uuid,
  p_plan_id uuid,
  p_expected_version integer,
  p_base_version_id uuid,
  p_context_snapshot_id uuid,
  p_change_kind text,
  p_change_payload jsonb,
  p_impact text,
  p_diff jsonb,
  p_engine_version text,
  p_canonicalization_version text,
  p_rule_set_revision_id uuid,
  p_source_manifest_id uuid,
  p_input_hash bytea,
  p_output_hash bytea,
  p_engine_completeness text,
  p_validation_status text,
  p_validation jsonb,
  p_module_results jsonb,
  p_safety_findings jsonb,
  p_idempotency_key_digest bytea,
  p_request_digest bytea
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  if p_engine_completeness is null
    or p_engine_completeness not in ('complete', 'provisional')
    or p_validation ->> 'completeness' is distinct from p_engine_completeness
  then
    raise exception using errcode = '22023', message = 'invalid_input';
  end if;

  return private.create_plan_candidate(
    p_auth_subject, p_auth_session_id, p_plan_id, p_expected_version,
    p_base_version_id, p_context_snapshot_id, p_change_kind, p_change_payload,
    p_impact, p_diff, p_engine_version, p_canonicalization_version,
    p_rule_set_revision_id, p_source_manifest_id, p_input_hash, p_output_hash,
    p_validation_status, p_validation, p_module_results, p_safety_findings,
    p_idempotency_key_digest, p_request_digest
  );
exception
  when serialization_failure then
    raise exception using errcode = 'PT409', message = 'version_conflict';
end;
$$;

revoke all on function public.internal_create_plan_draft(
  uuid, uuid, uuid, uuid, text, text, uuid, uuid, bytea, bytea, text, text,
  jsonb, jsonb, jsonb, bytea, bytea
) from public, anon, authenticated;
revoke all on function public.internal_create_plan_candidate(
  uuid, uuid, uuid, integer, uuid, uuid, text, jsonb, text, jsonb, text, text,
  uuid, uuid, bytea, bytea, text, text, jsonb, jsonb, jsonb, bytea, bytea
) from public, anon, authenticated;

grant execute on function public.internal_create_plan_draft(
  uuid, uuid, uuid, uuid, text, text, uuid, uuid, bytea, bytea, text, text,
  jsonb, jsonb, jsonb, bytea, bytea
) to service_role;
grant execute on function public.internal_create_plan_candidate(
  uuid, uuid, uuid, integer, uuid, uuid, text, jsonb, text, jsonb, text, text,
  uuid, uuid, bytea, bytea, text, text, jsonb, jsonb, jsonb, bytea, bytea
) to service_role;
