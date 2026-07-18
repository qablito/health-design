create table public.questionnaire_drafts (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null unique
    references public.profiles (id) on delete cascade,
  schema_version integer not null default 1 check (schema_version = 1),
  version integer not null default 1 check (version > 0),
  status text not null default 'editing'
    check (status in ('editing', 'submitted')),
  completeness text not null default 'provisional'
    check (completeness in ('complete', 'provisional')),
  answers jsonb not null default '{}'::jsonb
    check (
      jsonb_typeof(answers) = 'object'
      and octet_length(answers::text) <= 262144
    ),
  confirmed_block_ids text[] not null default '{}'
    check (
      cardinality(confirmed_block_ids) <= 12
      and confirmed_block_ids <@ array[
        'core', 'goals', 'modules', 'nutrition', 'training', 'hydration',
        'sleep', 'mobility', 'supplements', 'clinical', 'labs', 'summary'
      ]::text[]
    ),
  current_block_id text not null default 'core'
    check (current_block_id in (
      'core', 'goals', 'modules', 'nutrition', 'training', 'hydration',
      'sleep', 'mobility', 'supplements', 'clinical', 'labs', 'summary'
    )),
  uncertainties jsonb not null default '[]'::jsonb
    check (jsonb_typeof(uncertainties) = 'array'),
  hard_errors jsonb not null default '[]'::jsonb
    check (jsonb_typeof(hard_errors) = 'array'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (updated_at >= created_at)
);

create table private.questionnaire_idempotency (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null references public.actors (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  operation text not null check (operation in ('draft-put', 'draft-submit')),
  key_digest bytea not null check (octet_length(key_digest) = 32),
  request_digest bytea not null check (octet_length(request_digest) = 32),
  response jsonb not null check (jsonb_typeof(response) = 'object'),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '24 hours',
  check (expires_at > created_at),
  unique (actor_id, profile_id, operation, key_digest)
);

create index questionnaire_idempotency_expiry_idx
on private.questionnaire_idempotency (expires_at);

alter table public.questionnaire_drafts enable row level security;
alter table private.questionnaire_idempotency enable row level security;

revoke all on table public.questionnaire_drafts from public, anon, authenticated;
revoke all on table private.questionnaire_idempotency from public, anon, authenticated;
grant select, insert, update, delete on table public.questionnaire_drafts to service_role;
grant all on table private.questionnaire_idempotency to service_role;

create function private.questionnaire_ack(draft public.questionnaire_drafts)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog
as $$
  select jsonb_build_object(
    'completeness', draft.completeness,
    'confirmedBlockIds', to_jsonb(draft.confirmed_block_ids),
    'currentBlockId', draft.current_block_id,
    'hardErrors', draft.hard_errors,
    'profileId', draft.profile_id,
    'schemaVersion', draft.schema_version,
    'status', draft.status,
    'uncertainties', draft.uncertainties,
    'updatedAt', draft.updated_at,
    'version', draft.version
  )
$$;

create function private.require_questionnaire_access(
  p_auth_subject uuid,
  p_auth_session_id uuid,
  p_profile_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_actor_id uuid;
  v_device_session_id uuid;
begin
  select session.actor_id, session.device_session_id
  into v_actor_id, v_device_session_id
  from private.require_internal_device_session(
    p_auth_subject,
    p_auth_session_id
  ) session;

  if not private.actor_has_profile_access(
    v_actor_id,
    v_device_session_id,
    p_profile_id
  ) then
    raise exception using errcode = '42501', message = 'access_not_granted';
  end if;
  return v_actor_id;
end;
$$;

create function private.get_questionnaire_draft(
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
  v_draft public.questionnaire_drafts%rowtype;
begin
  perform private.require_questionnaire_access(
    p_auth_subject,
    p_auth_session_id,
    p_profile_id
  );
  select draft.* into v_draft
  from public.questionnaire_drafts draft
  where draft.profile_id = p_profile_id;
  if not found then
    return null;
  end if;
  return private.questionnaire_ack(v_draft) || jsonb_build_object(
    'answers', v_draft.answers,
    'id', v_draft.id
  );
end;
$$;

create function private.put_questionnaire_draft(
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
  if p_schema_version <> 1
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

create function private.submit_questionnaire_draft(
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
  if p_schema_version <> 1
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

create function public.internal_get_questionnaire_draft(
  p_auth_subject uuid,
  p_auth_session_id uuid,
  p_profile_id uuid
)
returns jsonb
language sql
security definer
set search_path = pg_catalog
as $$
  select private.get_questionnaire_draft(
    p_auth_subject,
    p_auth_session_id,
    p_profile_id
  )
$$;

create function public.internal_put_questionnaire_draft(
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
language sql
security definer
set search_path = pg_catalog
as $$
  select private.put_questionnaire_draft(
    p_auth_subject, p_auth_session_id, p_profile_id, p_schema_version,
    p_expected_version, p_answers, p_confirmed_block_ids, p_current_block_id,
    p_completeness, p_uncertainties, p_hard_errors,
    p_idempotency_key_digest, p_request_digest
  )
$$;

create function public.internal_submit_questionnaire_draft(
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
language sql
security definer
set search_path = pg_catalog
as $$
  select private.submit_questionnaire_draft(
    p_auth_subject, p_auth_session_id, p_profile_id, p_schema_version,
    p_expected_version, p_completeness, p_uncertainties, p_hard_errors,
    p_idempotency_key_digest, p_request_digest
  )
$$;

revoke all on function private.questionnaire_ack(public.questionnaire_drafts)
from public, anon, authenticated, service_role;
revoke all on function private.require_questionnaire_access(uuid, uuid, uuid)
from public, anon, authenticated, service_role;
revoke all on function private.get_questionnaire_draft(uuid, uuid, uuid)
from public, anon, authenticated, service_role;
revoke all on function private.put_questionnaire_draft(
  uuid, uuid, uuid, integer, integer, jsonb, text[], text, text, jsonb,
  jsonb, bytea, bytea
) from public, anon, authenticated, service_role;
revoke all on function private.submit_questionnaire_draft(
  uuid, uuid, uuid, integer, integer, text, jsonb, jsonb, bytea, bytea
) from public, anon, authenticated, service_role;

revoke all on function public.internal_get_questionnaire_draft(uuid, uuid, uuid)
from public, anon, authenticated;
revoke all on function public.internal_put_questionnaire_draft(
  uuid, uuid, uuid, integer, integer, jsonb, text[], text, text, jsonb,
  jsonb, bytea, bytea
) from public, anon, authenticated;
revoke all on function public.internal_submit_questionnaire_draft(
  uuid, uuid, uuid, integer, integer, text, jsonb, jsonb, bytea, bytea
) from public, anon, authenticated;

grant execute on function public.internal_get_questionnaire_draft(uuid, uuid, uuid)
to service_role;
grant execute on function public.internal_put_questionnaire_draft(
  uuid, uuid, uuid, integer, integer, jsonb, text[], text, text, jsonb,
  jsonb, bytea, bytea
) to service_role;
grant execute on function public.internal_submit_questionnaire_draft(
  uuid, uuid, uuid, integer, integer, text, jsonb, jsonb, bytea, bytea
) to service_role;
