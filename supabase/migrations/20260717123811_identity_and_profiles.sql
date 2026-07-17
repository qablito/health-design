create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create function private.normalize_alias(alias text)
returns text
language sql
immutable
strict
parallel safe
set search_path = pg_catalog
as $$
  select lower(
    regexp_replace(btrim(alias), ' +', ' ', 'g')
  )
$$;

create table public.actors (
  id uuid primary key default gen_random_uuid(),
  auth_subject uuid not null unique
    references auth.users (id) on delete restrict,
  role text not null default 'device'
    check (role in ('device', 'superadmin')),
  created_at timestamptz not null default now(),
  disabled_at timestamptz,
  check (disabled_at is null or disabled_at >= created_at)
);

create table public.profiles (
  id uuid primary key default gen_random_uuid(),
  alias text not null,
  alias_normalized text generated always as (
    private.normalize_alias(alias)
  ) stored,
  country text not null default 'ES' check (country = 'ES'),
  timezone text not null check (btrim(timezone) <> ''),
  adult_attested_at timestamptz not null,
  status text not null default 'active'
    check (status in ('active', 'deletion_requested')),
  created_at timestamptz not null default now(),
  deletion_requested_at timestamptz,
  constraint profiles_alias_not_blank
    check (private.normalize_alias(alias) <> ''),
  constraint profiles_alias_allowed_characters
    check ((alias collate "C") ~ '^[A-Za-z0-9 _-]+$'),
  constraint profiles_alias_normalized_key unique (alias_normalized),
  constraint profiles_deletion_state_check check (
    (
      status = 'active'
      and deletion_requested_at is null
    )
    or (
      status = 'deletion_requested'
      and deletion_requested_at is not null
      and deletion_requested_at >= created_at
    )
  )
);

create table public.profile_access (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null
    references public.profiles (id) on delete restrict,
  actor_id uuid not null
    references public.actors (id) on delete restrict,
  access_scope text not null default 'owner'
    check (access_scope = 'owner'),
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoked_by uuid references public.actors (id) on delete restrict,
  check (revoked_at is null or revoked_at >= created_at)
);

create unique index profile_access_one_active_idx
on public.profile_access (profile_id, actor_id)
where revoked_at is null;

create index profile_access_actor_id_idx
on public.profile_access (actor_id);

create index profile_access_revoked_by_idx
on public.profile_access (revoked_by)
where revoked_by is not null;

create table public.device_sessions (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null
    references public.actors (id) on delete restrict,
  auth_session_id uuid not null unique,
  label text not null check (btrim(label) <> ''),
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null,
  idle_expires_at timestamptz not null,
  absolute_expires_at timestamptz not null,
  revoked_at timestamptz,
  constraint device_sessions_time_order_check check (
    last_seen_at >= created_at
    and last_seen_at <= idle_expires_at
    and idle_expires_at > created_at
    and absolute_expires_at > created_at
    and idle_expires_at <= absolute_expires_at
    and (revoked_at is null or revoked_at >= created_at)
  )
);

create unique index device_sessions_one_active_actor_idx
on public.device_sessions (actor_id)
where revoked_at is null;

create index device_sessions_actor_id_idx
on public.device_sessions (actor_id);

create table private.invitations (
  id uuid primary key default gen_random_uuid(),
  token_hash bytea not null unique check (octet_length(token_hash) = 32),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  revoked_at timestamptz,
  created_by uuid not null
    references public.actors (id) on delete restrict,
  constraint invitations_time_order_check check (
    expires_at > created_at
    and (consumed_at is null or consumed_at >= created_at)
    and (revoked_at is null or revoked_at >= created_at)
  )
);

create index invitations_created_by_idx
on private.invitations (created_by);

create table private.private_access_codes (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null
    references public.profiles (id) on delete restrict,
  key_version integer not null check (key_version > 0),
  secret_digest bytea not null check (octet_length(secret_digest) > 0),
  created_at timestamptz not null default now(),
  rotated_at timestamptz,
  revoked_at timestamptz,
  constraint private_access_codes_time_order_check check (
    (rotated_at is null or rotated_at >= created_at)
    and (revoked_at is null or revoked_at >= created_at)
  )
);

create unique index private_access_codes_one_active_profile_idx
on private.private_access_codes (profile_id)
where revoked_at is null;

create table private.technical_audit_events (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.actors (id) on delete restrict,
  action text not null check (btrim(action) <> ''),
  target_type text not null check (btrim(target_type) <> ''),
  target_id uuid,
  result text not null check (btrim(result) <> ''),
  request_id uuid not null unique,
  created_at timestamptz not null default now()
);

create index technical_audit_events_actor_id_idx
on private.technical_audit_events (actor_id)
where actor_id is not null;

create table private.deletion_jobs (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid
    references public.profiles (id) on delete set null,
  profile_marker bytea not null check (octet_length(profile_marker) > 0),
  request_handle_hash bytea not null
    check (octet_length(request_handle_hash) = 32),
  requester_actor_id uuid
    references public.actors (id) on delete restrict,
  status text not null default 'queued'
    check (status in ('queued', 'ledger_recorded', 'purging', 'purged', 'failed')),
  requested_at timestamptz not null default now(),
  confirmed_by uuid not null
    references public.actors (id) on delete restrict,
  ledger_record_id uuid,
  attempts integer not null default 0 check (attempts >= 0),
  last_error_code text,
  completed_at timestamptz,
  constraint deletion_jobs_completion_check check (
    (status <> 'purged' and completed_at is null)
    or (
      status = 'purged'
      and completed_at is not null
      and completed_at >= requested_at
    )
  )
);

create index deletion_jobs_profile_id_idx
on private.deletion_jobs (profile_id)
where profile_id is not null;

create index deletion_jobs_requester_actor_id_idx
on private.deletion_jobs (requester_actor_id)
where requester_actor_id is not null;

create index deletion_jobs_confirmed_by_idx
on private.deletion_jobs (confirmed_by);

create function private.prevent_profile_reactivation()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  if old.status = 'deletion_requested' and new.status <> old.status then
    raise exception using
      errcode = '23514',
      message = 'profile_deletion_is_terminal';
  end if;
  return new;
end;
$$;

create trigger profiles_prevent_reactivation
before update of status on public.profiles
for each row
execute function private.prevent_profile_reactivation();

create function private.purge_profile_after_deletion_job()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  if new.status = 'purged' and new.profile_id is not null then
    delete from public.profiles
    where id = new.profile_id
      and status = 'deletion_requested';

    if not found then
      raise exception using
        errcode = '55000',
        message = 'profile_not_deletion_requested';
    end if;
  end if;
  return new;
end;
$$;

create trigger deletion_jobs_purge_profile
after insert or update of status, profile_id on private.deletion_jobs
for each row
execute function private.purge_profile_after_deletion_job();

create function private.ensure_actor()
returns uuid
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  subject uuid := auth.uid();
  ensured_actor_id uuid;
begin
  if subject is null then
    raise exception using errcode = '22023', message = 'auth_uid_required';
  end if;

  insert into public.actors as actor (auth_subject, role)
  values (subject, 'device')
  on conflict (auth_subject) do update
    set auth_subject = excluded.auth_subject
    where actor.disabled_at is null
  returning actor.id into ensured_actor_id;

  if ensured_actor_id is null then
    raise exception using errcode = '55000', message = 'actor_disabled';
  end if;

  return ensured_actor_id;
end;
$$;

alter table public.actors enable row level security;
alter table public.profiles enable row level security;
alter table public.profile_access enable row level security;
alter table public.device_sessions enable row level security;
alter table private.invitations enable row level security;
alter table private.private_access_codes enable row level security;
alter table private.technical_audit_events enable row level security;
alter table private.deletion_jobs enable row level security;

revoke all on table public.actors from anon, authenticated;
revoke all on table public.profiles from anon, authenticated;
revoke all on table public.profile_access from anon, authenticated;
revoke all on table public.device_sessions from anon, authenticated;
revoke all on table private.invitations from anon, authenticated;
revoke all on table private.private_access_codes from anon, authenticated;
revoke all on table private.technical_audit_events from anon, authenticated;
revoke all on table private.deletion_jobs from anon, authenticated;

grant all on table public.actors to service_role;
grant select, insert, update on table public.profiles to service_role;
grant all on table public.profile_access to service_role;
grant all on table public.device_sessions to service_role;
grant all on table private.invitations to service_role;
grant all on table private.private_access_codes to service_role;
grant select, insert on table private.technical_audit_events to service_role;
grant all on table private.deletion_jobs to service_role;

grant usage on schema private to authenticated, service_role;

revoke all on function private.normalize_alias(text)
from public, anon, authenticated;
grant execute on function private.normalize_alias(text) to service_role;

revoke all on function private.prevent_profile_reactivation()
from public, anon, authenticated, service_role;
revoke all on function private.purge_profile_after_deletion_job()
from public, anon, authenticated, service_role;

revoke all on function private.ensure_actor()
from public, anon, service_role;
grant execute on function private.ensure_actor() to authenticated;
