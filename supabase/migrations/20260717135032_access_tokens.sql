create table private.qr_grants (
  id uuid primary key,
  profile_id uuid not null
    references public.profiles (id) on delete restrict,
  token_hash bytea not null unique check (octet_length(token_hash) = 32),
  issued_by_actor uuid not null
    references public.actors (id) on delete restrict,
  audience text not null default 'device' check (audience = 'device'),
  issued_at timestamptz not null default now(),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  consumed_by_actor uuid references public.actors (id) on delete restrict,
  revoked_at timestamptz,
  constraint qr_grants_time_order_check check (
    expires_at > issued_at
    and expires_at <= issued_at + interval '5 minutes'
    and (consumed_at is null or consumed_at >= issued_at)
    and (revoked_at is null or revoked_at >= issued_at)
  ),
  constraint qr_grants_consumption_check check (
    (consumed_at is null and consumed_by_actor is null)
    or (consumed_at is not null and consumed_by_actor is not null)
  )
);

create index qr_grants_profile_id_idx
on private.qr_grants (profile_id);

create index qr_grants_expires_at_idx
on private.qr_grants (expires_at)
where consumed_at is null and revoked_at is null;

create table private.access_rate_limit_events (
  id uuid primary key default gen_random_uuid(),
  attempt_kind text not null
    check (attempt_kind in ('code', 'invitation', 'qr')),
  ip_digest bytea not null check (octet_length(ip_digest) = 32),
  subject_digest bytea not null check (octet_length(subject_digest) = 32),
  candidate_digest bytea not null check (octet_length(candidate_digest) = 32),
  outcome text not null default 'pending'
    check (outcome in ('pending', 'success', 'failure')),
  attempted_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint access_rate_limit_completion_check check (
    (outcome = 'pending' and completed_at is null)
    or (outcome <> 'pending' and completed_at is not null)
  )
);

create index access_rate_limit_ip_window_idx
on private.access_rate_limit_events (ip_digest, attempted_at desc);

create index access_rate_limit_subject_window_idx
on private.access_rate_limit_events (subject_digest, attempted_at desc)
where outcome = 'failure';

create index access_rate_limit_candidate_window_idx
on private.access_rate_limit_events (candidate_digest, attempted_at desc)
where outcome = 'failure';

create table private.access_idempotency (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null
    references public.actors (id) on delete restrict,
  operation text not null check (
    operation in (
      'code-consume',
      'invitation-redeem',
      'private-code-rotate',
      'qr-consume',
      'qr-create',
      'session-revoke'
    )
  ),
  key_digest bytea not null check (octet_length(key_digest) = 32),
  request_digest bytea not null check (octet_length(request_digest) = 32),
  response_ciphertext text not null check (
    length(response_ciphertext) between 22 and 8192
    and response_ciphertext collate "C" ~ '^[A-Za-z0-9_-]+$'
  ),
  response_nonce text not null check (
    length(response_nonce) = 16
    and response_nonce collate "C" ~ '^[A-Za-z0-9_-]+$'
  ),
  response_status integer not null check (response_status between 200 and 299),
  result_code text not null default 'completed'
    check (result_code in ('completed', 'global_closed', 'profile_revoked')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '24 hours',
  constraint access_idempotency_time_order_check check (expires_at > created_at),
  constraint access_idempotency_scope_key unique (actor_id, operation, key_digest)
);

create index access_idempotency_expiry_idx
on private.access_idempotency (expires_at);

alter table private.qr_grants enable row level security;
alter table private.access_rate_limit_events enable row level security;
alter table private.access_idempotency enable row level security;

revoke all on table private.qr_grants from public, anon, authenticated;
revoke all on table private.access_rate_limit_events from public, anon, authenticated;
revoke all on table private.access_idempotency from public, anon, authenticated;

grant all on table private.qr_grants to service_role;
grant all on table private.access_rate_limit_events to service_role;
grant all on table private.access_idempotency to service_role;

create function private.ensure_internal_actor(p_auth_subject uuid)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_actor_id uuid;
begin
  if p_auth_subject is null or not exists (
    select 1 from auth.users where id = p_auth_subject
  ) then
    raise exception using errcode = '28000', message = 'unauthenticated';
  end if;

  insert into public.actors as actor (auth_subject, role)
  values (p_auth_subject, 'device')
  on conflict (auth_subject) do update
    set auth_subject = excluded.auth_subject
    where actor.disabled_at is null
  returning actor.id into v_actor_id;

  if v_actor_id is null then
    raise exception using errcode = '55000', message = 'actor_disabled';
  end if;
  return v_actor_id;
end;
$$;

create function private.ensure_internal_device_session(
  p_auth_subject uuid,
  p_auth_session_id uuid,
  p_device_session_id uuid,
  p_label text
)
returns table (actor_id uuid, device_session_id uuid)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_actor_id uuid;
  v_existing public.device_sessions%rowtype;
  v_now timestamptz := clock_timestamp();
begin
  if p_auth_session_id is null or p_device_session_id is null
    or btrim(coalesce(p_label, '')) = ''
    or not exists (
      select 1
      from auth.sessions
      where id = p_auth_session_id and user_id = p_auth_subject
    )
  then
    raise exception using errcode = '28000', message = 'unauthenticated';
  end if;

  v_actor_id := private.ensure_internal_actor(p_auth_subject);

  select session.* into v_existing
  from public.device_sessions session
  where session.actor_id = v_actor_id and session.revoked_at is null
  for update;

  if found then
    if v_existing.auth_session_id <> p_auth_session_id
      or v_existing.idle_expires_at <= v_now
      or v_existing.absolute_expires_at <= v_now
    then
      raise exception using errcode = '28000', message = 'unauthenticated';
    end if;
    return query select v_actor_id, v_existing.id;
    return;
  end if;

  insert into public.device_sessions (
    id,
    actor_id,
    auth_session_id,
    label,
    created_at,
    last_seen_at,
    idle_expires_at,
    absolute_expires_at
  )
  values (
    p_device_session_id,
    v_actor_id,
    p_auth_session_id,
    btrim(p_label),
    v_now,
    v_now,
    v_now + interval '30 days',
    v_now + interval '180 days'
  );

  return query select v_actor_id, p_device_session_id;
end;
$$;

create function private.require_internal_device_session(
  p_auth_subject uuid,
  p_auth_session_id uuid
)
returns table (actor_id uuid, device_session_id uuid)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_now timestamptz := clock_timestamp();
begin
  return query
  select actor.id, session.id
  from public.actors actor
  join public.device_sessions session on session.actor_id = actor.id
  join auth.sessions auth_session
    on auth_session.id = session.auth_session_id
    and auth_session.user_id = actor.auth_subject
  where actor.auth_subject = p_auth_subject
    and actor.disabled_at is null
    and session.auth_session_id = p_auth_session_id
    and session.revoked_at is null
    and session.idle_expires_at > v_now
    and session.absolute_expires_at > v_now;

  if not found then
    raise exception using errcode = '28000', message = 'unauthenticated';
  end if;
end;
$$;

create function private.actor_has_profile_access(
  p_actor_id uuid,
  p_device_session_id uuid,
  p_profile_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog
as $$
  select exists (
    select 1
    from public.profile_access access
    join public.profiles profile on profile.id = access.profile_id
    join public.device_sessions session on session.actor_id = access.actor_id
    join public.actors actor on actor.id = access.actor_id
    where access.actor_id = p_actor_id
      and access.profile_id = p_profile_id
      and access.revoked_at is null
      and profile.status = 'active'
      and actor.disabled_at is null
      and session.id = p_device_session_id
      and session.revoked_at is null
      and session.idle_expires_at > now()
      and session.absolute_expires_at > now()
  )
$$;

create function private.begin_access_mutation(
  p_actor_id uuid,
  p_operation text,
  p_key_digest bytea,
  p_request_digest bytea,
  p_response_ciphertext text,
  p_response_nonce text,
  p_response_status integer
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_existing private.access_idempotency%rowtype;
  v_inserted_id uuid;
begin
  if octet_length(p_key_digest) <> 32 or octet_length(p_request_digest) <> 32 then
    raise exception using errcode = '22023', message = 'invalid_input';
  end if;

  delete from private.access_idempotency
  where actor_id = p_actor_id
    and operation = p_operation
    and key_digest = p_key_digest
    and expires_at <= now();

  insert into private.access_idempotency (
    actor_id,
    operation,
    key_digest,
    request_digest,
    response_ciphertext,
    response_nonce,
    response_status
  )
  values (
    p_actor_id,
    p_operation,
    p_key_digest,
    p_request_digest,
    p_response_ciphertext,
    p_response_nonce,
    p_response_status
  )
  on conflict (actor_id, operation, key_digest) do nothing
  returning id into v_inserted_id;

  if v_inserted_id is not null then
    return jsonb_build_object(
      'replayed', false,
      'response_ciphertext', p_response_ciphertext,
      'response_nonce', p_response_nonce,
      'response_status', p_response_status,
      'result_code', 'completed'
    );
  end if;

  select entry.* into v_existing
  from private.access_idempotency entry
  where entry.actor_id = p_actor_id
    and entry.operation = p_operation
    and entry.key_digest = p_key_digest
  for update;

  if v_existing.request_digest <> p_request_digest then
    raise exception using errcode = '23505', message = 'idempotency_key_reused';
  end if;

  return jsonb_build_object(
    'replayed', true,
    'response_ciphertext', v_existing.response_ciphertext,
    'response_nonce', v_existing.response_nonce,
    'response_status', v_existing.response_status,
    'result_code', v_existing.result_code
  );
end;
$$;

create function private.redeem_invitation(
  p_auth_subject uuid,
  p_auth_session_id uuid,
  p_device_session_id uuid,
  p_profile_id uuid,
  p_profile_access_id uuid,
  p_invitation_hash bytea,
  p_alias text,
  p_timezone text,
  p_adult_attested_at timestamptz,
  p_device_label text,
  p_code_digest bytea,
  p_code_key_version integer,
  p_idempotency_key_digest bytea,
  p_request_digest bytea,
  p_response_ciphertext text,
  p_response_nonce text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_actor_id uuid;
  v_invitation_id uuid;
  v_result jsonb;
begin
  select context.actor_id
  into v_actor_id
  from private.ensure_internal_device_session(
    p_auth_subject,
    p_auth_session_id,
    p_device_session_id,
    p_device_label
  ) context;

  v_result := private.begin_access_mutation(
    v_actor_id,
    'invitation-redeem',
    p_idempotency_key_digest,
    p_request_digest,
    p_response_ciphertext,
    p_response_nonce,
    201
  );
  if (v_result ->> 'replayed')::boolean then return v_result; end if;

  if octet_length(p_invitation_hash) <> 32
    or octet_length(p_code_digest) <> 32
    or p_code_key_version < 1
    or p_adult_attested_at > clock_timestamp() + interval '1 minute'
  then
    raise exception using errcode = '22023', message = 'invalid_input';
  end if;

  select invitation.id into v_invitation_id
  from private.invitations invitation
  where invitation.token_hash = p_invitation_hash
    and invitation.consumed_at is null
    and invitation.revoked_at is null
    and invitation.expires_at > clock_timestamp()
  for update;

  if v_invitation_id is null then
    raise exception using errcode = '28000', message = 'access_not_granted';
  end if;

  insert into public.profiles (
    id,
    alias,
    timezone,
    adult_attested_at
  )
  values (p_profile_id, p_alias, p_timezone, p_adult_attested_at);

  insert into public.profile_access (id, profile_id, actor_id, access_scope)
  values (p_profile_access_id, p_profile_id, v_actor_id, 'owner');

  insert into private.private_access_codes (
    profile_id,
    key_version,
    secret_digest
  )
  values (p_profile_id, p_code_key_version, p_code_digest);

  update private.invitations
  set consumed_at = clock_timestamp()
  where id = v_invitation_id;

  return v_result;
end;
$$;

create function private.get_private_code_candidate(p_alias text)
returns table (profile_id uuid, profile_alias text, secret_digest_hex text)
language sql
stable
security definer
set search_path = pg_catalog
as $$
  select candidate.profile_id,
    candidate.profile_alias,
    coalesce(candidate.secret_digest_hex, repeat('0', 64))
  from (values (1)) seed(value)
  left join lateral (
    select profile.id as profile_id,
      profile.alias as profile_alias,
      encode(code.secret_digest, 'hex') as secret_digest_hex
    from public.profiles profile
    join private.private_access_codes code on code.profile_id = profile.id
    where profile.alias_normalized = private.normalize_alias(p_alias)
      and profile.status = 'active'
      and code.revoked_at is null
    limit 1
  ) candidate on true
$$;

create function private.get_qr_candidate(p_token_hash bytea)
returns table (profile_id uuid, profile_alias text)
language sql
stable
security definer
set search_path = pg_catalog
as $$
  select grant_row.profile_id, profile.alias
  from private.qr_grants grant_row
  join public.profiles profile on profile.id = grant_row.profile_id
  join public.profile_access issuer_access
    on issuer_access.profile_id = grant_row.profile_id
    and issuer_access.actor_id = grant_row.issued_by_actor
  join public.actors issuer on issuer.id = grant_row.issued_by_actor
  where grant_row.token_hash = p_token_hash
    and grant_row.consumed_at is null
    and grant_row.revoked_at is null
    and grant_row.expires_at > now()
    and issuer_access.revoked_at is null
    and issuer.disabled_at is null
    and profile.status = 'active'
  limit 1
$$;

create function private.consume_private_code(
  p_auth_subject uuid,
  p_auth_session_id uuid,
  p_device_session_id uuid,
  p_profile_id uuid,
  p_profile_access_id uuid,
  p_expected_digest bytea,
  p_idempotency_key_digest bytea,
  p_request_digest bytea,
  p_device_label text,
  p_response_ciphertext text,
  p_response_nonce text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_actor_id uuid;
  v_result jsonb;
begin
  select context.actor_id
  into v_actor_id
  from private.ensure_internal_device_session(
    p_auth_subject,
    p_auth_session_id,
    p_device_session_id,
    p_device_label
  ) context;

  v_result := private.begin_access_mutation(
    v_actor_id,
    'code-consume',
    p_idempotency_key_digest,
    p_request_digest,
    p_response_ciphertext,
    p_response_nonce,
    201
  );
  if (v_result ->> 'replayed')::boolean then return v_result; end if;

  perform 1
  from private.private_access_codes code
  join public.profiles profile on profile.id = code.profile_id
  where code.profile_id = p_profile_id
    and code.revoked_at is null
    and code.secret_digest = p_expected_digest
    and profile.status = 'active'
  for update of code;

  if not found then
    raise exception using errcode = '28000', message = 'access_not_granted';
  end if;

  insert into public.profile_access (id, profile_id, actor_id, access_scope)
  values (p_profile_access_id, p_profile_id, v_actor_id, 'owner');

  return v_result;
end;
$$;

create function private.create_qr_grant(
  p_auth_subject uuid,
  p_auth_session_id uuid,
  p_profile_id uuid,
  p_grant_id uuid,
  p_token_hash bytea,
  p_expires_at timestamptz,
  p_idempotency_key_digest bytea,
  p_request_digest bytea,
  p_response_ciphertext text,
  p_response_nonce text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_actor_id uuid;
  v_session_id uuid;
  v_result jsonb;
  v_now timestamptz := clock_timestamp();
begin
  select context.actor_id, context.device_session_id
  into v_actor_id, v_session_id
  from private.require_internal_device_session(
    p_auth_subject,
    p_auth_session_id
  ) context;

  if not private.actor_has_profile_access(v_actor_id, v_session_id, p_profile_id) then
    raise exception using errcode = '42501', message = 'forbidden';
  end if;

  v_result := private.begin_access_mutation(
    v_actor_id,
    'qr-create',
    p_idempotency_key_digest,
    p_request_digest,
    p_response_ciphertext,
    p_response_nonce,
    201
  );
  if (v_result ->> 'replayed')::boolean then return v_result; end if;

  if octet_length(p_token_hash) <> 32
    or p_expires_at <= v_now
    or p_expires_at > v_now + interval '5 minutes'
  then
    raise exception using errcode = '22023', message = 'invalid_input';
  end if;

  insert into private.qr_grants (
    id,
    profile_id,
    token_hash,
    issued_by_actor,
    issued_at,
    expires_at
  )
  values (
    p_grant_id,
    p_profile_id,
    p_token_hash,
    v_actor_id,
    v_now,
    p_expires_at
  );

  return v_result;
end;
$$;

create function private.consume_qr_grant(
  p_auth_subject uuid,
  p_auth_session_id uuid,
  p_device_session_id uuid,
  p_profile_access_id uuid,
  p_token_hash bytea,
  p_idempotency_key_digest bytea,
  p_request_digest bytea,
  p_device_label text,
  p_response_ciphertext text,
  p_response_nonce text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_actor_id uuid;
  v_grant private.qr_grants%rowtype;
  v_result jsonb;
begin
  select context.actor_id
  into v_actor_id
  from private.ensure_internal_device_session(
    p_auth_subject,
    p_auth_session_id,
    p_device_session_id,
    p_device_label
  ) context;

  v_result := private.begin_access_mutation(
    v_actor_id,
    'qr-consume',
    p_idempotency_key_digest,
    p_request_digest,
    p_response_ciphertext,
    p_response_nonce,
    201
  );
  if (v_result ->> 'replayed')::boolean then return v_result; end if;

  select grant_row.* into v_grant
  from private.qr_grants grant_row
  where grant_row.token_hash = p_token_hash
    and grant_row.consumed_at is null
    and grant_row.revoked_at is null
    and grant_row.expires_at > clock_timestamp()
  for update;

  if v_grant.id is null or not exists (
    select 1
    from public.profile_access issuer_access
    join public.actors issuer on issuer.id = issuer_access.actor_id
    join public.profiles profile on profile.id = issuer_access.profile_id
    where issuer_access.profile_id = v_grant.profile_id
      and issuer_access.actor_id = v_grant.issued_by_actor
      and issuer_access.revoked_at is null
      and issuer.disabled_at is null
      and profile.status = 'active'
  ) then
    raise exception using errcode = '28000', message = 'access_not_granted';
  end if;

  insert into public.profile_access (id, profile_id, actor_id, access_scope)
  values (p_profile_access_id, v_grant.profile_id, v_actor_id, 'owner');

  update private.qr_grants
  set consumed_at = clock_timestamp(), consumed_by_actor = v_actor_id
  where id = v_grant.id;

  return v_result;
end;
$$;

create function private.rotate_private_access_code(
  p_auth_subject uuid,
  p_auth_session_id uuid,
  p_profile_id uuid,
  p_new_code_id uuid,
  p_new_digest bytea,
  p_revoke_other_access boolean,
  p_idempotency_key_digest bytea,
  p_request_digest bytea,
  p_response_ciphertext text,
  p_response_nonce text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_actor_id uuid;
  v_session_id uuid;
  v_next_version integer;
  v_result jsonb;
  v_other_actor_id uuid;
  v_other_subject uuid;
begin
  select context.actor_id, context.device_session_id
  into v_actor_id, v_session_id
  from private.require_internal_device_session(
    p_auth_subject,
    p_auth_session_id
  ) context;

  if not private.actor_has_profile_access(v_actor_id, v_session_id, p_profile_id) then
    raise exception using errcode = '42501', message = 'forbidden';
  end if;

  v_result := private.begin_access_mutation(
    v_actor_id,
    'private-code-rotate',
    p_idempotency_key_digest,
    p_request_digest,
    p_response_ciphertext,
    p_response_nonce,
    200
  );
  if (v_result ->> 'replayed')::boolean then return v_result; end if;

  if octet_length(p_new_digest) <> 32 then
    raise exception using errcode = '22023', message = 'invalid_input';
  end if;

  perform 1 from public.profiles where id = p_profile_id for update;
  select coalesce(max(key_version), 0) + 1 into v_next_version
  from private.private_access_codes
  where profile_id = p_profile_id;

  update private.private_access_codes
  set rotated_at = clock_timestamp(), revoked_at = clock_timestamp()
  where profile_id = p_profile_id and revoked_at is null;

  insert into private.private_access_codes (
    id,
    profile_id,
    key_version,
    secret_digest
  )
  values (p_new_code_id, p_profile_id, v_next_version, p_new_digest);

  if p_revoke_other_access then
    for v_other_actor_id, v_other_subject in
      select distinct access.actor_id, actor.auth_subject
      from public.profile_access access
      join public.actors actor on actor.id = access.actor_id
      where access.profile_id = p_profile_id
        and access.actor_id <> v_actor_id
        and access.revoked_at is null
    loop
      update public.profile_access
      set revoked_at = clock_timestamp(), revoked_by = v_actor_id
      where profile_id = p_profile_id
        and actor_id = v_other_actor_id
        and revoked_at is null;

      if not exists (
        select 1 from public.profile_access remaining
        where remaining.actor_id = v_other_actor_id and remaining.revoked_at is null
      ) then
        update public.device_sessions
        set revoked_at = clock_timestamp()
        where actor_id = v_other_actor_id and revoked_at is null;
        update public.actors
        set disabled_at = clock_timestamp()
        where id = v_other_actor_id and role = 'device' and disabled_at is null;
        update auth.refresh_tokens set revoked = true
        where user_id = v_other_subject::text;
        delete from auth.sessions where user_id = v_other_subject;
      end if;
    end loop;
  end if;

  return v_result;
end;
$$;

create function private.list_actor_profiles(
  p_auth_subject uuid,
  p_auth_session_id uuid
)
returns table (
  profile_id uuid,
  alias text,
  status text,
  access_scope text
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_actor_id uuid;
begin
  select context.actor_id
  into v_actor_id
  from private.require_internal_device_session(
    p_auth_subject,
    p_auth_session_id
  ) context;

  return query
  select profile.id, profile.alias, profile.status, access.access_scope
  from public.profile_access access
  join public.profiles profile on profile.id = access.profile_id
  where access.actor_id = v_actor_id
    and access.revoked_at is null
    and profile.status = 'active'
  order by profile.alias_normalized, profile.id;
end;
$$;

create function private.list_profile_sessions(
  p_auth_subject uuid,
  p_auth_session_id uuid,
  p_profile_id uuid
)
returns table (
  device_session_id uuid,
  label text,
  created_at timestamptz,
  last_seen_at timestamptz,
  is_current boolean
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_actor_id uuid;
  v_session_id uuid;
begin
  select context.actor_id, context.device_session_id
  into v_actor_id, v_session_id
  from private.require_internal_device_session(
    p_auth_subject,
    p_auth_session_id
  ) context;

  if not private.actor_has_profile_access(v_actor_id, v_session_id, p_profile_id) then
    raise exception using errcode = '42501', message = 'forbidden';
  end if;

  return query
  select session.id,
    session.label,
    session.created_at,
    session.last_seen_at,
    session.id = v_session_id
  from public.profile_access access
  join public.device_sessions session on session.actor_id = access.actor_id
  join public.actors actor on actor.id = access.actor_id
  where access.profile_id = p_profile_id
    and access.revoked_at is null
    and actor.disabled_at is null
    and session.revoked_at is null
    and session.idle_expires_at > now()
    and session.absolute_expires_at > now()
  order by session.created_at, session.id;
end;
$$;

create function private.revoke_profile_session(
  p_auth_subject uuid,
  p_auth_session_id uuid,
  p_profile_id uuid,
  p_target_device_session_id uuid,
  p_idempotency_key_digest bytea,
  p_request_digest bytea,
  p_response_ciphertext text,
  p_response_nonce text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_actor_id uuid;
  v_session_id uuid;
  v_target_actor_id uuid;
  v_target_subject uuid;
  v_result jsonb;
  v_global_closed boolean := false;
begin
  select context.actor_id, context.device_session_id
  into v_actor_id, v_session_id
  from private.require_internal_device_session(
    p_auth_subject,
    p_auth_session_id
  ) context;

  if not private.actor_has_profile_access(v_actor_id, v_session_id, p_profile_id) then
    raise exception using errcode = '42501', message = 'forbidden';
  end if;

  v_result := private.begin_access_mutation(
    v_actor_id,
    'session-revoke',
    p_idempotency_key_digest,
    p_request_digest,
    p_response_ciphertext,
    p_response_nonce,
    200
  );
  if (v_result ->> 'replayed')::boolean then return v_result; end if;

  select target_actor.id, target_actor.auth_subject
  into v_target_actor_id, v_target_subject
  from public.device_sessions target_session
  join public.actors target_actor on target_actor.id = target_session.actor_id
  join public.profile_access target_access
    on target_access.actor_id = target_actor.id
    and target_access.profile_id = p_profile_id
    and target_access.revoked_at is null
  where target_session.id = p_target_device_session_id
    and target_session.revoked_at is null
  for update of target_session, target_access;

  if v_target_actor_id is null then
    raise exception using errcode = '28000', message = 'access_not_granted';
  end if;

  update public.profile_access
  set revoked_at = clock_timestamp(), revoked_by = v_actor_id
  where profile_id = p_profile_id
    and actor_id = v_target_actor_id
    and revoked_at is null;

  if not exists (
    select 1 from public.profile_access remaining
    where remaining.actor_id = v_target_actor_id and remaining.revoked_at is null
  ) and exists (
    select 1 from public.actors actor
    where actor.id = v_target_actor_id and actor.role = 'device'
  ) then
    v_global_closed := true;
    update public.device_sessions
    set revoked_at = clock_timestamp()
    where actor_id = v_target_actor_id and revoked_at is null;
    update public.actors
    set disabled_at = clock_timestamp()
    where id = v_target_actor_id and disabled_at is null;
    update auth.refresh_tokens set revoked = true
    where user_id = v_target_subject::text;
    delete from auth.sessions where user_id = v_target_subject;
  end if;

  update private.access_idempotency
  set result_code = case
    when v_global_closed then 'global_closed'
    else 'profile_revoked'
  end
  where actor_id = v_actor_id
    and operation = 'session-revoke'
    and key_digest = p_idempotency_key_digest;

  return v_result || jsonb_build_object(
    'result_code', case
      when v_global_closed then 'global_closed'
      else 'profile_revoked'
    end
  );
end;
$$;

create function private.touch_device_session(
  p_auth_subject uuid,
  p_auth_session_id uuid
)
returns table (
  device_session_id uuid,
  idle_expires_at timestamptz,
  absolute_expires_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_session_id uuid;
  v_now timestamptz := clock_timestamp();
begin
  select context.device_session_id
  into v_session_id
  from private.require_internal_device_session(
    p_auth_subject,
    p_auth_session_id
  ) context;

  update public.device_sessions session
  set last_seen_at = v_now,
      idle_expires_at = least(v_now + interval '30 days', session.absolute_expires_at)
  where session.id = v_session_id
    and session.last_seen_at::date < v_now::date;

  return query
  select session.id, session.idle_expires_at, session.absolute_expires_at
  from public.device_sessions session
  where session.id = v_session_id;
end;
$$;

create function private.expire_device_sessions(p_as_of timestamptz default now())
returns integer
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_expired_count integer := 0;
  v_actor_id uuid;
  v_auth_subject uuid;
begin
  for v_actor_id, v_auth_subject in
    select session.actor_id, actor.auth_subject
    from public.device_sessions session
    join public.actors actor on actor.id = session.actor_id
    where session.revoked_at is null
      and (
        session.idle_expires_at <= p_as_of
        or session.absolute_expires_at <= p_as_of
      )
    for update of session, actor
  loop
    update public.device_sessions
    set revoked_at = p_as_of
    where actor_id = v_actor_id and revoked_at is null;
    update public.profile_access
    set revoked_at = p_as_of, revoked_by = v_actor_id
    where actor_id = v_actor_id and revoked_at is null;
    update public.actors
    set disabled_at = p_as_of
    where id = v_actor_id and role = 'device' and disabled_at is null;
    update auth.refresh_tokens set revoked = true
    where user_id = v_auth_subject::text;
    delete from auth.sessions where user_id = v_auth_subject;
    v_expired_count := v_expired_count + 1;
  end loop;
  return v_expired_count;
end;
$$;

create function private.orphan_anonymous_candidates(
  p_as_of timestamptz default now(),
  p_limit integer default 100
)
returns table (auth_subject uuid, reason text)
language sql
stable
security definer
set search_path = pg_catalog
as $$
  select auth_user.id,
    case
      when auth_user.created_at <= p_as_of - interval '30 days'
        then 'inactive_30_days'
      else 'abandoned_24_hours'
    end
  from auth.users auth_user
  left join public.actors actor on actor.auth_subject = auth_user.id
  where auth_user.is_anonymous is true
    and auth_user.created_at <= p_as_of - interval '24 hours'
    and coalesce(actor.role, 'device') = 'device'
    and not exists (
      select 1
      from public.profile_access access
      where access.actor_id = actor.id and access.revoked_at is null
    )
    and not exists (
      select 1 from private.invitations invitation
      where invitation.created_by = actor.id
        and invitation.consumed_at is null
        and invitation.revoked_at is null
        and invitation.expires_at > p_as_of
    )
    and not exists (
      select 1 from private.deletion_jobs job
      where job.requester_actor_id = actor.id
        and job.status not in ('purged', 'failed')
    )
    and (
      actor.id is null
      or (
        auth_user.created_at <= p_as_of - interval '30 days'
        and not exists (
          select 1 from private.technical_audit_events event
          where event.actor_id = actor.id
        )
      )
    )
  order by auth_user.created_at, auth_user.id
  limit greatest(0, least(p_limit, 100))
$$;

create function private.start_access_attempt(
  p_attempt_kind text,
  p_ip_digest bytea,
  p_subject_digest bytea,
  p_candidate_digest bytea,
  p_challenge_passed boolean default false
)
returns table (event_id uuid, decision text, retry_after_seconds integer)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_global_attempts integer;
  v_ip_failures integer;
  v_subject_failures integer;
  v_candidate_failures integer;
  v_failures integer;
  v_event_id uuid;
begin
  if p_attempt_kind not in ('code', 'invitation', 'qr')
    or octet_length(p_ip_digest) <> 32
    or octet_length(p_subject_digest) <> 32
    or octet_length(p_candidate_digest) <> 32
  then
    raise exception using errcode = '22023', message = 'invalid_input';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(encode(p_ip_digest, 'hex'), 0));

  select count(*) into v_global_attempts
  from private.access_rate_limit_events event
  where event.ip_digest = p_ip_digest
    and event.attempted_at > clock_timestamp() - interval '1 hour';

  select count(*) into v_ip_failures
  from private.access_rate_limit_events event
  where event.ip_digest = p_ip_digest
    and event.outcome = 'failure'
    and event.attempted_at > clock_timestamp() - interval '15 minutes';

  select count(*) into v_subject_failures
  from private.access_rate_limit_events event
  where event.subject_digest = p_subject_digest
    and event.outcome = 'failure'
    and event.attempted_at > clock_timestamp() - interval '15 minutes';

  select count(*) into v_candidate_failures
  from private.access_rate_limit_events event
  where event.candidate_digest = p_candidate_digest
    and event.outcome = 'failure'
    and event.attempted_at > clock_timestamp() - interval '15 minutes';

  v_failures := greatest(v_ip_failures, v_subject_failures, v_candidate_failures);
  if v_global_attempts >= 30 then
    return query select null::uuid, 'rate-limited'::text, 3600;
    return;
  end if;
  if v_failures >= 5 then
    return query select null::uuid, 'rate-limited'::text, 900;
    return;
  end if;
  if v_failures >= 3 and not p_challenge_passed then
    return query select null::uuid, 'challenge'::text, null::integer;
    return;
  end if;

  insert into private.access_rate_limit_events (
    attempt_kind,
    ip_digest,
    subject_digest,
    candidate_digest
  )
  values (
    p_attempt_kind,
    p_ip_digest,
    p_subject_digest,
    p_candidate_digest
  )
  returning id into v_event_id;

  return query select v_event_id, 'allow'::text, null::integer;
end;
$$;

create function private.finish_access_attempt(p_event_id uuid, p_succeeded boolean)
returns void
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  update private.access_rate_limit_events
  set outcome = case when p_succeeded then 'success' else 'failure' end,
      completed_at = clock_timestamp()
  where id = p_event_id and outcome = 'pending';
  if not found then
    raise exception using errcode = '22023', message = 'invalid_attempt';
  end if;
end;
$$;

create function private.record_access_audit(
  p_auth_subject uuid,
  p_action text,
  p_target_type text,
  p_target_id uuid,
  p_result text,
  p_request_id uuid
)
returns void
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_actor_id uuid;
begin
  if p_action not in (
    'code_consume',
    'invitation_redeem',
    'private_code_rotate',
    'qr_consume',
    'qr_create',
    'session_revoke',
    'session_touch'
  ) or p_target_type not in ('profile', 'profile_access', 'session')
    or p_result not in ('denied', 'success')
  then
    raise exception using errcode = '22023', message = 'invalid_audit_event';
  end if;

  select actor.id into v_actor_id
  from public.actors actor
  where actor.auth_subject = p_auth_subject;

  insert into private.technical_audit_events (
    actor_id,
    action,
    target_type,
    target_id,
    result,
    request_id
  )
  values (
    v_actor_id,
    p_action,
    p_target_type,
    p_target_id,
    p_result,
    p_request_id
  );
end;
$$;

create function public.internal_redeem_invitation(
  p_auth_subject uuid,
  p_auth_session_id uuid,
  p_device_session_id uuid,
  p_profile_id uuid,
  p_profile_access_id uuid,
  p_invitation_hash bytea,
  p_alias text,
  p_timezone text,
  p_adult_attested_at timestamptz,
  p_device_label text,
  p_code_digest bytea,
  p_code_key_version integer,
  p_idempotency_key_digest bytea,
  p_request_digest bytea,
  p_response_ciphertext text,
  p_response_nonce text
)
returns jsonb
language sql
security definer
set search_path = pg_catalog
as $$
  select private.redeem_invitation(
    p_auth_subject,
    p_auth_session_id,
    p_device_session_id,
    p_profile_id,
    p_profile_access_id,
    p_invitation_hash,
    p_alias,
    p_timezone,
    p_adult_attested_at,
    p_device_label,
    p_code_digest,
    p_code_key_version,
    p_idempotency_key_digest,
    p_request_digest,
    p_response_ciphertext,
    p_response_nonce
  )
$$;

create function public.internal_private_code_candidate(p_alias text)
returns table (profile_id uuid, profile_alias text, secret_digest_hex text)
language sql
stable
security definer
set search_path = pg_catalog
as $$
  select * from private.get_private_code_candidate(p_alias)
$$;

create function public.internal_qr_candidate(p_token_hash bytea)
returns table (profile_id uuid, profile_alias text)
language sql
stable
security definer
set search_path = pg_catalog
as $$
  select * from private.get_qr_candidate(p_token_hash)
$$;

create function public.internal_consume_private_code(
  p_auth_subject uuid,
  p_auth_session_id uuid,
  p_device_session_id uuid,
  p_profile_id uuid,
  p_profile_access_id uuid,
  p_expected_digest bytea,
  p_idempotency_key_digest bytea,
  p_request_digest bytea,
  p_device_label text,
  p_response_ciphertext text,
  p_response_nonce text
)
returns jsonb
language sql
security definer
set search_path = pg_catalog
as $$
  select private.consume_private_code(
    p_auth_subject,
    p_auth_session_id,
    p_device_session_id,
    p_profile_id,
    p_profile_access_id,
    p_expected_digest,
    p_idempotency_key_digest,
    p_request_digest,
    p_device_label,
    p_response_ciphertext,
    p_response_nonce
  )
$$;

create function public.internal_create_qr_grant(
  p_auth_subject uuid,
  p_auth_session_id uuid,
  p_profile_id uuid,
  p_grant_id uuid,
  p_token_hash bytea,
  p_expires_at timestamptz,
  p_idempotency_key_digest bytea,
  p_request_digest bytea,
  p_response_ciphertext text,
  p_response_nonce text
)
returns jsonb
language sql
security definer
set search_path = pg_catalog
as $$
  select private.create_qr_grant(
    p_auth_subject,
    p_auth_session_id,
    p_profile_id,
    p_grant_id,
    p_token_hash,
    p_expires_at,
    p_idempotency_key_digest,
    p_request_digest,
    p_response_ciphertext,
    p_response_nonce
  )
$$;

create function public.internal_consume_qr_grant(
  p_auth_subject uuid,
  p_auth_session_id uuid,
  p_device_session_id uuid,
  p_profile_access_id uuid,
  p_token_hash bytea,
  p_idempotency_key_digest bytea,
  p_request_digest bytea,
  p_device_label text,
  p_response_ciphertext text,
  p_response_nonce text
)
returns jsonb
language sql
security definer
set search_path = pg_catalog
as $$
  select private.consume_qr_grant(
    p_auth_subject,
    p_auth_session_id,
    p_device_session_id,
    p_profile_access_id,
    p_token_hash,
    p_idempotency_key_digest,
    p_request_digest,
    p_device_label,
    p_response_ciphertext,
    p_response_nonce
  )
$$;

create function public.internal_rotate_private_access_code(
  p_auth_subject uuid,
  p_auth_session_id uuid,
  p_profile_id uuid,
  p_new_code_id uuid,
  p_new_digest bytea,
  p_revoke_other_access boolean,
  p_idempotency_key_digest bytea,
  p_request_digest bytea,
  p_response_ciphertext text,
  p_response_nonce text
)
returns jsonb
language sql
security definer
set search_path = pg_catalog
as $$
  select private.rotate_private_access_code(
    p_auth_subject,
    p_auth_session_id,
    p_profile_id,
    p_new_code_id,
    p_new_digest,
    p_revoke_other_access,
    p_idempotency_key_digest,
    p_request_digest,
    p_response_ciphertext,
    p_response_nonce
  )
$$;

create function public.internal_list_actor_profiles(
  p_auth_subject uuid,
  p_auth_session_id uuid
)
returns table (
  profile_id uuid,
  alias text,
  status text,
  access_scope text
)
language sql
security definer
set search_path = pg_catalog
as $$
  select * from private.list_actor_profiles(p_auth_subject, p_auth_session_id)
$$;

create function public.internal_list_profile_sessions(
  p_auth_subject uuid,
  p_auth_session_id uuid,
  p_profile_id uuid
)
returns table (
  device_session_id uuid,
  label text,
  created_at timestamptz,
  last_seen_at timestamptz,
  is_current boolean
)
language sql
security definer
set search_path = pg_catalog
as $$
  select * from private.list_profile_sessions(
    p_auth_subject,
    p_auth_session_id,
    p_profile_id
  )
$$;

create function public.internal_revoke_profile_session(
  p_auth_subject uuid,
  p_auth_session_id uuid,
  p_profile_id uuid,
  p_target_device_session_id uuid,
  p_idempotency_key_digest bytea,
  p_request_digest bytea,
  p_response_ciphertext text,
  p_response_nonce text
)
returns jsonb
language sql
security definer
set search_path = pg_catalog
as $$
  select private.revoke_profile_session(
    p_auth_subject,
    p_auth_session_id,
    p_profile_id,
    p_target_device_session_id,
    p_idempotency_key_digest,
    p_request_digest,
    p_response_ciphertext,
    p_response_nonce
  )
$$;

create function public.internal_touch_device_session(
  p_auth_subject uuid,
  p_auth_session_id uuid
)
returns table (
  device_session_id uuid,
  idle_expires_at timestamptz,
  absolute_expires_at timestamptz
)
language sql
security definer
set search_path = pg_catalog
as $$
  select * from private.touch_device_session(p_auth_subject, p_auth_session_id)
$$;

create function public.internal_expire_device_sessions(p_as_of timestamptz default now())
returns integer
language sql
security definer
set search_path = pg_catalog
as $$
  select private.expire_device_sessions(p_as_of)
$$;

create function public.internal_orphan_anonymous_candidates(
  p_as_of timestamptz default now(),
  p_limit integer default 100
)
returns table (auth_subject uuid, reason text)
language sql
stable
security definer
set search_path = pg_catalog
as $$
  select * from private.orphan_anonymous_candidates(p_as_of, p_limit)
$$;

create function public.internal_start_access_attempt(
  p_attempt_kind text,
  p_ip_digest bytea,
  p_subject_digest bytea,
  p_candidate_digest bytea,
  p_challenge_passed boolean default false
)
returns table (event_id uuid, decision text, retry_after_seconds integer)
language sql
security definer
set search_path = pg_catalog
as $$
  select * from private.start_access_attempt(
    p_attempt_kind,
    p_ip_digest,
    p_subject_digest,
    p_candidate_digest,
    p_challenge_passed
  )
$$;

create function public.internal_finish_access_attempt(
  p_event_id uuid,
  p_succeeded boolean
)
returns void
language sql
security definer
set search_path = pg_catalog
as $$
  select private.finish_access_attempt(p_event_id, p_succeeded)
$$;

create function public.internal_record_access_audit(
  p_auth_subject uuid,
  p_action text,
  p_target_type text,
  p_target_id uuid,
  p_result text,
  p_request_id uuid
)
returns void
language sql
security definer
set search_path = pg_catalog
as $$
  select private.record_access_audit(
    p_auth_subject,
    p_action,
    p_target_type,
    p_target_id,
    p_result,
    p_request_id
  )
$$;

revoke all on function private.ensure_internal_actor(uuid)
from public, anon, authenticated, service_role;
revoke all on function private.ensure_internal_device_session(uuid, uuid, uuid, text)
from public, anon, authenticated, service_role;
revoke all on function private.require_internal_device_session(uuid, uuid)
from public, anon, authenticated, service_role;
revoke all on function private.actor_has_profile_access(uuid, uuid, uuid)
from public, anon, authenticated, service_role;
revoke all on function private.begin_access_mutation(
  uuid, text, bytea, bytea, text, text, integer
) from public, anon, authenticated, service_role;
revoke all on function private.redeem_invitation(
  uuid, uuid, uuid, uuid, uuid, bytea, text, text, timestamptz, text,
  bytea, integer, bytea, bytea, text, text
) from public, anon, authenticated, service_role;
revoke all on function private.get_private_code_candidate(text)
from public, anon, authenticated, service_role;
revoke all on function private.get_qr_candidate(bytea)
from public, anon, authenticated, service_role;
revoke all on function private.consume_private_code(
  uuid, uuid, uuid, uuid, uuid, bytea, bytea, bytea, text, text, text
) from public, anon, authenticated, service_role;
revoke all on function private.create_qr_grant(
  uuid, uuid, uuid, uuid, bytea, timestamptz, bytea, bytea, text, text
) from public, anon, authenticated, service_role;
revoke all on function private.consume_qr_grant(
  uuid, uuid, uuid, uuid, bytea, bytea, bytea, text, text, text
) from public, anon, authenticated, service_role;
revoke all on function private.rotate_private_access_code(
  uuid, uuid, uuid, uuid, bytea, boolean, bytea, bytea, text, text
) from public, anon, authenticated, service_role;
revoke all on function private.list_actor_profiles(uuid, uuid)
from public, anon, authenticated, service_role;
revoke all on function private.list_profile_sessions(uuid, uuid, uuid)
from public, anon, authenticated, service_role;
revoke all on function private.revoke_profile_session(
  uuid, uuid, uuid, uuid, bytea, bytea, text, text
) from public, anon, authenticated, service_role;
revoke all on function private.touch_device_session(uuid, uuid)
from public, anon, authenticated, service_role;
revoke all on function private.expire_device_sessions(timestamptz)
from public, anon, authenticated, service_role;
revoke all on function private.orphan_anonymous_candidates(timestamptz, integer)
from public, anon, authenticated, service_role;
revoke all on function private.start_access_attempt(
  text, bytea, bytea, bytea, boolean
) from public, anon, authenticated, service_role;
revoke all on function private.finish_access_attempt(uuid, boolean)
from public, anon, authenticated, service_role;
revoke all on function private.record_access_audit(
  uuid, text, text, uuid, text, uuid
) from public, anon, authenticated, service_role;

revoke all on function public.internal_redeem_invitation(
  uuid, uuid, uuid, uuid, uuid, bytea, text, text, timestamptz, text,
  bytea, integer, bytea, bytea, text, text
) from public, anon, authenticated;
revoke all on function public.internal_private_code_candidate(text)
from public, anon, authenticated;
revoke all on function public.internal_qr_candidate(bytea)
from public, anon, authenticated;
revoke all on function public.internal_consume_private_code(
  uuid, uuid, uuid, uuid, uuid, bytea, bytea, bytea, text, text, text
) from public, anon, authenticated;
revoke all on function public.internal_create_qr_grant(
  uuid, uuid, uuid, uuid, bytea, timestamptz, bytea, bytea, text, text
) from public, anon, authenticated;
revoke all on function public.internal_consume_qr_grant(
  uuid, uuid, uuid, uuid, bytea, bytea, bytea, text, text, text
) from public, anon, authenticated;
revoke all on function public.internal_rotate_private_access_code(
  uuid, uuid, uuid, uuid, bytea, boolean, bytea, bytea, text, text
) from public, anon, authenticated;
revoke all on function public.internal_list_actor_profiles(uuid, uuid)
from public, anon, authenticated;
revoke all on function public.internal_list_profile_sessions(uuid, uuid, uuid)
from public, anon, authenticated;
revoke all on function public.internal_revoke_profile_session(
  uuid, uuid, uuid, uuid, bytea, bytea, text, text
) from public, anon, authenticated;
revoke all on function public.internal_touch_device_session(uuid, uuid)
from public, anon, authenticated;
revoke all on function public.internal_expire_device_sessions(timestamptz)
from public, anon, authenticated;
revoke all on function public.internal_orphan_anonymous_candidates(timestamptz, integer)
from public, anon, authenticated;
revoke all on function public.internal_start_access_attempt(
  text, bytea, bytea, bytea, boolean
) from public, anon, authenticated;
revoke all on function public.internal_finish_access_attempt(uuid, boolean)
from public, anon, authenticated;
revoke all on function public.internal_record_access_audit(
  uuid, text, text, uuid, text, uuid
) from public, anon, authenticated;

grant execute on function public.internal_redeem_invitation(
  uuid, uuid, uuid, uuid, uuid, bytea, text, text, timestamptz, text,
  bytea, integer, bytea, bytea, text, text
) to service_role;
grant execute on function public.internal_private_code_candidate(text)
to service_role;
grant execute on function public.internal_qr_candidate(bytea)
to service_role;
grant execute on function public.internal_consume_private_code(
  uuid, uuid, uuid, uuid, uuid, bytea, bytea, bytea, text, text, text
) to service_role;
grant execute on function public.internal_create_qr_grant(
  uuid, uuid, uuid, uuid, bytea, timestamptz, bytea, bytea, text, text
) to service_role;
grant execute on function public.internal_consume_qr_grant(
  uuid, uuid, uuid, uuid, bytea, bytea, bytea, text, text, text
) to service_role;
grant execute on function public.internal_rotate_private_access_code(
  uuid, uuid, uuid, uuid, bytea, boolean, bytea, bytea, text, text
) to service_role;
grant execute on function public.internal_list_actor_profiles(uuid, uuid)
to service_role;
grant execute on function public.internal_list_profile_sessions(uuid, uuid, uuid)
to service_role;
grant execute on function public.internal_revoke_profile_session(
  uuid, uuid, uuid, uuid, bytea, bytea, text, text
) to service_role;
grant execute on function public.internal_touch_device_session(uuid, uuid)
to service_role;
grant execute on function public.internal_expire_device_sessions(timestamptz)
to service_role;
grant execute on function public.internal_orphan_anonymous_candidates(timestamptz, integer)
to service_role;
grant execute on function public.internal_start_access_attempt(
  text, bytea, bytea, bytea, boolean
) to service_role;
grant execute on function public.internal_finish_access_attempt(uuid, boolean)
to service_role;
grant execute on function public.internal_record_access_audit(
  uuid, text, text, uuid, text, uuid
) to service_role;
