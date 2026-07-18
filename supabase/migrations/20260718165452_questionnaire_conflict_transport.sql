-- Keep SQLSTATE 40001 inside the transactional implementation, where it
-- represents a serialization/version conflict. Translate it at the public RPC
-- boundary so PostgREST can finish the response as an explicit HTTP 409.

create or replace function public.internal_put_questionnaire_draft(
  p_auth_subject uuid,
  p_auth_session_id uuid,
  p_profile_id uuid,
  p_schema_version integer,
  p_expected_version integer,
  p_answers jsonb,
  p_confirmed_block_ids text[],
  p_current_block_id text,
  p_completeness text,
  p_uncertainties jsonb,
  p_hard_errors jsonb,
  p_idempotency_key_digest bytea,
  p_request_digest bytea
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  return private.put_questionnaire_draft(
    p_auth_subject, p_auth_session_id, p_profile_id, p_schema_version,
    p_expected_version, p_answers, p_confirmed_block_ids, p_current_block_id,
    p_completeness, p_uncertainties, p_hard_errors,
    p_idempotency_key_digest, p_request_digest
  );
exception
  when serialization_failure then
    raise exception using errcode = 'PT409', message = 'version_conflict';
end;
$$;

create or replace function public.internal_submit_questionnaire_draft(
  p_auth_subject uuid,
  p_auth_session_id uuid,
  p_profile_id uuid,
  p_schema_version integer,
  p_expected_version integer,
  p_completeness text,
  p_uncertainties jsonb,
  p_hard_errors jsonb,
  p_idempotency_key_digest bytea,
  p_request_digest bytea
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  return private.submit_questionnaire_draft(
    p_auth_subject, p_auth_session_id, p_profile_id, p_schema_version,
    p_expected_version, p_completeness, p_uncertainties, p_hard_errors,
    p_idempotency_key_digest, p_request_digest
  );
exception
  when serialization_failure then
    raise exception using errcode = 'PT409', message = 'version_conflict';
end;
$$;
