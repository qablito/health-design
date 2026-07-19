alter table public.questionnaire_drafts
drop constraint questionnaire_drafts_schema_version_check;

delete from private.questionnaire_idempotency;

update public.questionnaire_drafts
set schema_version = 2,
    version = version + 1,
    status = 'editing',
    completeness = 'provisional',
    confirmed_block_ids = array_remove(
      array_remove(confirmed_block_ids, 'nutrition'),
      'summary'
    ),
    current_block_id = case
      when current_block_id = 'summary' then 'nutrition'
      else current_block_id
    end,
    updated_at = clock_timestamp();

alter table public.questionnaire_drafts
alter column schema_version set default 2;

alter table public.questionnaire_drafts
add constraint questionnaire_drafts_schema_version_check
check (schema_version = 2);

create or replace function private.put_questionnaire_draft(
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
declare
  v_actor_id uuid;
  v_draft public.questionnaire_drafts%rowtype;
  v_existing private.questionnaire_idempotency%rowtype;
  v_response jsonb;
begin
  if p_schema_version <> 2
    or p_expected_version < 0
    or p_completeness not in ('complete', 'provisional')
    or jsonb_typeof(p_answers) <> 'object'
    or octet_length(p_answers::text) > 262144
    or cardinality(p_confirmed_block_ids) > 12
    or jsonb_typeof(p_uncertainties) <> 'array'
    or jsonb_typeof(p_hard_errors) <> 'array'
    or octet_length(p_idempotency_key_digest) <> 32
    or octet_length(p_request_digest) <> 32
  then
    raise exception using errcode = '22023', message = 'invalid_input';
  end if;

  v_actor_id := private.require_questionnaire_access(
    p_auth_subject,
    p_auth_session_id,
    p_profile_id
  );
  perform pg_advisory_xact_lock(hashtextextended(
    p_profile_id::text || ':questionnaire-draft',
    0
  ));
  delete from private.questionnaire_idempotency
  where expires_at <= now();
  select entry.* into v_existing
  from private.questionnaire_idempotency entry
  where entry.actor_id = v_actor_id
    and entry.profile_id = p_profile_id
    and entry.operation = 'draft-put'
    and entry.key_digest = p_idempotency_key_digest;
  if found then
    if v_existing.request_digest <> p_request_digest then
      raise exception using errcode = '23505', message = 'idempotency_key_reused';
    end if;
    return v_existing.response;
  end if;

  select draft.* into v_draft
  from public.questionnaire_drafts draft
  where draft.profile_id = p_profile_id
  for update;

  if not found then
    if p_expected_version <> 0 then
      raise exception using errcode = '40001', message = 'version_conflict';
    end if;
    insert into public.questionnaire_drafts (
      profile_id, schema_version, version, status, completeness, answers,
      confirmed_block_ids, current_block_id, uncertainties, hard_errors
    ) values (
      p_profile_id, p_schema_version, 1, 'editing', p_completeness, p_answers,
      p_confirmed_block_ids, p_current_block_id, p_uncertainties, p_hard_errors
    ) returning * into v_draft;
  else
    if v_draft.version <> p_expected_version then
      raise exception using errcode = '40001', message = 'version_conflict';
    end if;
    update public.questionnaire_drafts
    set schema_version = p_schema_version,
        version = version + 1,
        status = 'editing',
        completeness = p_completeness,
        answers = p_answers,
        confirmed_block_ids = p_confirmed_block_ids,
        current_block_id = p_current_block_id,
        uncertainties = p_uncertainties,
        hard_errors = p_hard_errors,
        updated_at = clock_timestamp()
    where profile_id = p_profile_id
    returning * into v_draft;
  end if;

  v_response := private.questionnaire_ack(v_draft);
  insert into private.questionnaire_idempotency (
    actor_id, profile_id, operation, key_digest, request_digest, response
  ) values (
    v_actor_id, p_profile_id, 'draft-put', p_idempotency_key_digest,
    p_request_digest, v_response
  );
  return v_response;
end;
$$;

create or replace function private.submit_questionnaire_draft(
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
declare
  v_actor_id uuid;
  v_draft public.questionnaire_drafts%rowtype;
  v_existing private.questionnaire_idempotency%rowtype;
  v_response jsonb;
begin
  if p_schema_version <> 2
    or p_expected_version < 1
    or p_completeness not in ('complete', 'provisional')
    or jsonb_typeof(p_uncertainties) <> 'array'
    or jsonb_typeof(p_hard_errors) <> 'array'
    or jsonb_array_length(p_hard_errors) <> 0
    or octet_length(p_idempotency_key_digest) <> 32
    or octet_length(p_request_digest) <> 32
  then
    raise exception using errcode = '22023', message = 'invalid_input';
  end if;

  v_actor_id := private.require_questionnaire_access(
    p_auth_subject,
    p_auth_session_id,
    p_profile_id
  );
  perform pg_advisory_xact_lock(hashtextextended(
    p_profile_id::text || ':questionnaire-draft',
    0
  ));
  delete from private.questionnaire_idempotency
  where expires_at <= now();
  select entry.* into v_existing
  from private.questionnaire_idempotency entry
  where entry.actor_id = v_actor_id
    and entry.profile_id = p_profile_id
    and entry.operation = 'draft-submit'
    and entry.key_digest = p_idempotency_key_digest;
  if found then
    if v_existing.request_digest <> p_request_digest then
      raise exception using errcode = '23505', message = 'idempotency_key_reused';
    end if;
    return v_existing.response;
  end if;

  select draft.* into v_draft
  from public.questionnaire_drafts draft
  where draft.profile_id = p_profile_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'draft_not_found';
  end if;
  if v_draft.version <> p_expected_version
    or v_draft.schema_version <> p_schema_version
  then
    raise exception using errcode = '40001', message = 'version_conflict';
  end if;

  update public.questionnaire_drafts
  set version = version + 1,
      status = 'submitted',
      completeness = p_completeness,
      uncertainties = p_uncertainties,
      hard_errors = p_hard_errors,
      updated_at = clock_timestamp()
  where profile_id = p_profile_id
  returning * into v_draft;

  v_response := private.questionnaire_ack(v_draft);
  insert into private.questionnaire_idempotency (
    actor_id, profile_id, operation, key_digest, request_digest, response
  ) values (
    v_actor_id, p_profile_id, 'draft-submit', p_idempotency_key_digest,
    p_request_digest, v_response
  );
  return v_response;
end;
$$;

comment on constraint questionnaire_drafts_schema_version_check
on public.questionnaire_drafts is
'T10: el cuestionario activo es V2; borradores V1 se reabren sin perder respuestas.';
