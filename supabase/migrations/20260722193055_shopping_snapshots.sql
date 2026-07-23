create function private.shopping_preference_is_valid(
  p_preferred_chain text,
  p_mode text,
  p_compared_chains text[]
)
returns boolean
language sql
immutable
parallel safe
set search_path = pg_catalog
as $$
  select p_preferred_chain in ('mercadona', 'dia', 'aldi')
    and p_mode in ('single', 'multistore')
    and p_compared_chains <@ array['mercadona', 'dia', 'aldi']::text[]
    and cardinality(p_compared_chains) = (
      select count(distinct chain)::integer from unnest(p_compared_chains) chain
    )
    and (
      (p_mode = 'single' and cardinality(p_compared_chains) = 0)
      or (
        p_mode = 'multistore'
        and cardinality(p_compared_chains) between 2 and 3
        and p_preferred_chain = any(p_compared_chains)
      )
    )
$$;

create table public.shopping_preference_revisions (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  version integer not null check (version >= 1),
  preferred_chain text not null,
  mode text not null,
  compared_chains text[] not null default '{}',
  sorting text not null check (
    sorting in (
      'normalized_price_asc', 'price_asc', 'price_desc', 'name_asc', 'name_desc'
    )
  ),
  created_by uuid not null references public.actors (id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  supersedes_id uuid references public.shopping_preference_revisions (id)
    on delete no action,
  lifecycle text not null default 'active'
    check (lifecycle in ('active', 'archived')),
  archived_at timestamptz,
  unique (profile_id, version),
  check (
    private.shopping_preference_is_valid(
      preferred_chain, mode, compared_chains
    )
  ),
  check (
    (lifecycle = 'active' and archived_at is null)
    or (lifecycle = 'archived' and archived_at is not null)
  )
);

create unique index shopping_preference_one_active_idx
on public.shopping_preference_revisions (profile_id)
where lifecycle = 'active';

create index shopping_preference_profile_history_idx
on public.shopping_preference_revisions (profile_id, version desc);

create table public.shopping_snapshots (
  id uuid primary key,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  plan_version_id uuid not null
    references public.plan_versions (id) on delete cascade,
  preference_revision_id uuid not null
    references public.shopping_preference_revisions (id) on delete restrict,
  basket_seed_revision_id uuid not null
    references private.basket_seed_revisions (id) on delete restrict,
  revision integer not null check (revision >= 1),
  supersedes_id uuid references public.shopping_snapshots (id) on delete no action,
  input_digest bytea not null check (octet_length(input_digest) = 32),
  snapshot_hash bytea not null check (octet_length(snapshot_hash) = 32),
  resolver_version text not null check (
    resolver_version ~ '^[a-z0-9][a-z0-9._-]{0,95}$'
  ),
  snapshot jsonb not null check (
    jsonb_typeof(snapshot) = 'object'
    and octet_length(snapshot::text) <= 4194304
  ),
  created_by uuid not null references public.actors (id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  lifecycle text not null default 'active'
    check (lifecycle in ('active', 'archived')),
  archived_at timestamptz,
  unique (profile_id, plan_version_id, revision),
  check (
    (lifecycle = 'active' and archived_at is null)
    or (lifecycle = 'archived' and archived_at is not null)
  ),
  check (
    snapshot ->> 'id' = id::text
    and snapshot ->> 'profileId' = profile_id::text
    and snapshot ->> 'planVersionId' = plan_version_id::text
    and snapshot ->> 'preferenceRevisionId' = preference_revision_id::text
    and snapshot ->> 'basketSeedRevisionId' = basket_seed_revision_id::text
    and (snapshot ->> 'revision')::integer = revision
    and snapshot ->> 'resolverVersion' = resolver_version
    and snapshot ->> 'inputDigest' = encode(input_digest, 'hex')
    and snapshot ->> 'schemaVersion' = '1'
    and not snapshot ? 'status'
  )
);

create unique index shopping_snapshot_one_active_idx
on public.shopping_snapshots (profile_id, plan_version_id)
where lifecycle = 'active';

create index shopping_snapshot_profile_history_idx
on public.shopping_snapshots (profile_id, plan_version_id, revision desc);

create table public.shopping_snapshot_publications (
  snapshot_id uuid not null references public.shopping_snapshots (id)
    on delete cascade,
  catalog_publication_id uuid not null references private.catalog_publications (id)
    on delete restrict,
  primary key (snapshot_id, catalog_publication_id)
);

create index shopping_snapshot_publication_reverse_idx
on public.shopping_snapshot_publications (catalog_publication_id, snapshot_id);

create table public.shopping_leftover_confirmations (
  id uuid primary key default gen_random_uuid(),
  snapshot_id uuid not null references public.shopping_snapshots (id)
    on delete cascade,
  canonical_food_key text not null
    check (canonical_food_key ~ '^food:[a-z0-9][a-z0-9._:-]{0,127}$'),
  declared_measure jsonb not null check (
    jsonb_typeof(declared_measure) = 'object'
    and octet_length(declared_measure::text) <= 1024
  ),
  confirmed_equivalent_g numeric(18, 6) not null
    check (confirmed_equivalent_g > 0),
  sku_id uuid references private.supermarket_skus (id) on delete restrict,
  evidence_ref text check (evidence_ref is null or length(evidence_ref) <= 240),
  confirmed_by uuid not null references public.actors (id) on delete restrict,
  confirmed_at timestamptz not null default clock_timestamp(),
  carried_from_id uuid references public.shopping_leftover_confirmations (id)
    on delete no action,
  unique (snapshot_id, canonical_food_key),
  check (
    (declared_measure ->> 'dimension' = 'mass' and sku_id is null)
    or (declared_measure ->> 'dimension' in ('volume', 'count') and sku_id is not null)
  )
);

create table public.shopping_product_selection_confirmations (
  id uuid primary key default gen_random_uuid(),
  snapshot_id uuid not null references public.shopping_snapshots (id)
    on delete cascade,
  canonical_food_key text not null
    check (canonical_food_key ~ '^food:[a-z0-9][a-z0-9._:-]{0,127}$'),
  sku_id uuid not null references private.supermarket_skus (id) on delete restrict,
  confirmed_by uuid not null references public.actors (id) on delete restrict,
  confirmed_at timestamptz not null default clock_timestamp(),
  carried_from_id uuid references public.shopping_product_selection_confirmations (id)
    on delete no action,
  unique (snapshot_id, canonical_food_key)
);

alter table public.shopping_preference_revisions enable row level security;
alter table public.shopping_snapshots enable row level security;
alter table public.shopping_snapshot_publications enable row level security;
alter table public.shopping_leftover_confirmations enable row level security;
alter table public.shopping_product_selection_confirmations enable row level security;

revoke all on table public.shopping_preference_revisions
from public, anon, authenticated;
revoke all on table public.shopping_snapshots from public, anon, authenticated;
revoke all on table public.shopping_snapshot_publications
from public, anon, authenticated;
revoke all on table public.shopping_leftover_confirmations
from public, anon, authenticated;
revoke all on table public.shopping_product_selection_confirmations
from public, anon, authenticated;

grant select on table public.shopping_preference_revisions to authenticated;
grant select on table public.shopping_snapshots to authenticated;
grant select on table public.shopping_snapshot_publications to authenticated;
grant select on table public.shopping_leftover_confirmations to authenticated;
grant select on table public.shopping_product_selection_confirmations to authenticated;
grant select on table public.shopping_preference_revisions to service_role;
grant select on table public.shopping_snapshots to service_role;
grant select on table public.shopping_snapshot_publications to service_role;
grant select on table public.shopping_leftover_confirmations to service_role;
grant select on table public.shopping_product_selection_confirmations to service_role;

create policy shopping_preference_select_own
on public.shopping_preference_revisions for select to authenticated
using (private.has_active_profile_access(profile_id));

create policy shopping_snapshot_select_own
on public.shopping_snapshots for select to authenticated
using (private.has_active_profile_access(profile_id));

create policy shopping_snapshot_publication_select_own
on public.shopping_snapshot_publications for select to authenticated
using (
  exists (
    select 1 from public.shopping_snapshots snapshot
    where snapshot.id = snapshot_id
      and private.has_active_profile_access(snapshot.profile_id)
  )
);

create policy shopping_leftover_select_own
on public.shopping_leftover_confirmations for select to authenticated
using (
  exists (
    select 1 from public.shopping_snapshots snapshot
    where snapshot.id = snapshot_id
      and private.has_active_profile_access(snapshot.profile_id)
  )
);

create policy shopping_selection_select_own
on public.shopping_product_selection_confirmations for select to authenticated
using (
  exists (
    select 1 from public.shopping_snapshots snapshot
    where snapshot.id = snapshot_id
      and private.has_active_profile_access(snapshot.profile_id)
  )
);

create function private.guard_shopping_preference_update()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  if new.id is distinct from old.id
    or new.profile_id is distinct from old.profile_id
    or new.version is distinct from old.version
    or new.preferred_chain is distinct from old.preferred_chain
    or new.mode is distinct from old.mode
    or new.compared_chains is distinct from old.compared_chains
    or new.sorting is distinct from old.sorting
    or new.created_by is distinct from old.created_by
    or new.created_at is distinct from old.created_at
    or new.supersedes_id is distinct from old.supersedes_id
  then
    raise exception using errcode = '55000', message = 'immutable_shopping_preference';
  end if;
  if old.lifecycle = 'active' and new.lifecycle = 'archived'
    and old.archived_at is null and new.archived_at is not null
  then
    return new;
  end if;
  if new.lifecycle = old.lifecycle and new.archived_at is not distinct from old.archived_at
  then
    return new;
  end if;
  raise exception using errcode = '55000', message = 'invalid_shopping_preference_transition';
end;
$$;

create trigger shopping_preference_guard_update
before update on public.shopping_preference_revisions
for each row execute function private.guard_shopping_preference_update();

create function private.guard_shopping_snapshot_update()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  if new.id is distinct from old.id
    or new.profile_id is distinct from old.profile_id
    or new.plan_version_id is distinct from old.plan_version_id
    or new.preference_revision_id is distinct from old.preference_revision_id
    or new.basket_seed_revision_id is distinct from old.basket_seed_revision_id
    or new.revision is distinct from old.revision
    or new.supersedes_id is distinct from old.supersedes_id
    or new.input_digest is distinct from old.input_digest
    or new.snapshot_hash is distinct from old.snapshot_hash
    or new.resolver_version is distinct from old.resolver_version
    or new.snapshot is distinct from old.snapshot
    or new.created_by is distinct from old.created_by
    or new.created_at is distinct from old.created_at
  then
    raise exception using errcode = '55000', message = 'immutable_shopping_snapshot';
  end if;
  if old.lifecycle = 'active' and new.lifecycle = 'archived'
    and old.archived_at is null and new.archived_at is not null
  then
    return new;
  end if;
  if new.lifecycle = old.lifecycle and new.archived_at is not distinct from old.archived_at
  then
    return new;
  end if;
  raise exception using errcode = '55000', message = 'invalid_shopping_snapshot_transition';
end;
$$;

create trigger shopping_snapshot_guard_update
before update on public.shopping_snapshots
for each row execute function private.guard_shopping_snapshot_update();

create function private.reject_shopping_child_update()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  raise exception using errcode = '55000', message = 'immutable_shopping_confirmation';
end;
$$;

create trigger shopping_snapshot_publications_are_immutable
before update on public.shopping_snapshot_publications
for each row execute function private.reject_shopping_child_update();
create trigger shopping_leftovers_are_immutable
before update on public.shopping_leftover_confirmations
for each row execute function private.reject_shopping_child_update();
create trigger shopping_selections_are_immutable
before update on public.shopping_product_selection_confirmations
for each row execute function private.reject_shopping_child_update();

create function private.validate_shopping_snapshot_publication()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  if not exists (
    select 1
    from public.shopping_snapshots snapshot
    join private.catalog_publications publication
      on publication.id = new.catalog_publication_id
    where snapshot.id = new.snapshot_id
      and publication.basket_seed_revision_id = snapshot.basket_seed_revision_id
  ) then
    raise exception using errcode = '22023', message = 'shopping_publication_seed_mismatch';
  end if;
  return new;
end;
$$;

create trigger shopping_snapshot_publication_validate
before insert on public.shopping_snapshot_publications
for each row execute function private.validate_shopping_snapshot_publication();

create function private.shopping_preference_json(
  p_preference public.shopping_preference_revisions
)
returns jsonb
language sql
stable
set search_path = pg_catalog
as $$
  select jsonb_build_object(
    'comparedChains', to_jsonb(p_preference.compared_chains),
    'createdAt', p_preference.created_at,
    'createdBy', p_preference.created_by,
    'id', p_preference.id,
    'mode', p_preference.mode,
    'preferredChain', p_preference.preferred_chain,
    'profileId', p_preference.profile_id,
    'schemaVersion', 1,
    'sorting', p_preference.sorting,
    'supersedesId', p_preference.supersedes_id,
    'version', p_preference.version
  )
$$;

create function private.shopping_snapshot_envelope(
  p_snapshot public.shopping_snapshots
)
returns jsonb
language sql
stable
set search_path = pg_catalog
as $$
  select jsonb_build_object(
    'schemaVersion', 1,
    'snapshot', p_snapshot.snapshot,
    'lifecycle', jsonb_build_object(
      'status', p_snapshot.lifecycle,
      'archivedAt', p_snapshot.archived_at
    )
  )
$$;

revoke all on function private.shopping_preference_is_valid(text,text,text[])
from public, anon, authenticated, service_role;
revoke all on function private.guard_shopping_preference_update()
from public, anon, authenticated, service_role;
revoke all on function private.guard_shopping_snapshot_update()
from public, anon, authenticated, service_role;
revoke all on function private.reject_shopping_child_update()
from public, anon, authenticated, service_role;
revoke all on function private.validate_shopping_snapshot_publication()
from public, anon, authenticated, service_role;
revoke all on function private.shopping_preference_json(
  public.shopping_preference_revisions
) from public, anon, authenticated, service_role;
revoke all on function private.shopping_snapshot_envelope(public.shopping_snapshots)
from public, anon, authenticated, service_role;
