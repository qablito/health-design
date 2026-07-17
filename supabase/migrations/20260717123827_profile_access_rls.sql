create function private.has_active_profile_access(target_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog
as $$
  select target_profile_id is not null
    and exists (
      select 1
      from public.profile_access access
      join public.actors actor on actor.id = access.actor_id
      join public.device_sessions session on session.actor_id = actor.id
      join public.profiles profile on profile.id = access.profile_id
      where access.profile_id = target_profile_id
        and access.revoked_at is null
        and actor.auth_subject = (select auth.uid())
        and actor.disabled_at is null
        and session.auth_session_id = nullif(
          (select auth.jwt() ->> 'session_id'),
          ''
        )::uuid
        and session.revoked_at is null
        and session.idle_expires_at > now()
        and session.absolute_expires_at > now()
        and profile.status = 'active'
    )
$$;

revoke all on function private.has_active_profile_access(uuid)
from public, anon, service_role;
grant execute on function private.has_active_profile_access(uuid)
to authenticated;

create policy profiles_select_active_membership
on public.profiles
for select
to authenticated
using (private.has_active_profile_access(id));

grant select on table public.profiles to authenticated;
