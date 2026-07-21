create table public.commercial_products (
  id uuid primary key default gen_random_uuid(),
  gtin14 text not null unique check (gtin14 ~ '^[0-9]{14}$'),
  created_at timestamptz not null default clock_timestamp()
);

create table public.commercial_product_manifests (
  id uuid primary key default gen_random_uuid(),
  source_kind text not null check (
    source_kind in ('confirmed_label', 'profile_correction', 'global_approval')
  ),
  normalized_content_hash bytea not null
    check (octet_length(normalized_content_hash) = 32),
  hash_algorithm text not null default 'sha256' check (hash_algorithm = 'sha256'),
  canonicalization_version text not null default 'canonical-json-v1'
    check (canonicalization_version = 'canonical-json-v1'),
  metadata jsonb not null default '{}'::jsonb check (
    jsonb_typeof(metadata) = 'object'
    and octet_length(metadata::text) <= 4096
  ),
  created_at timestamptz not null default clock_timestamp()
);

create table public.commercial_product_revisions (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null
    references public.commercial_products (id) on delete restrict,
  manifest_id uuid not null
    references public.commercial_product_manifests (id) on delete restrict,
  owner_profile_id uuid
    references public.profiles (id) on delete set null,
  supersedes_id uuid
    references public.commercial_product_revisions (id) on delete set null,
  source_kind text not null check (
    source_kind in ('confirmed_label', 'profile_correction', 'global_approval')
  ),
  snapshot jsonb not null check (
    jsonb_typeof(snapshot) = 'object'
    and octet_length(snapshot::text) <= 65536
  ),
  completeness text not null check (
    completeness in ('complete', 'provisional', 'insufficient')
  ),
  uncertainties jsonb not null default '[]'::jsonb check (
    jsonb_typeof(uncertainties) = 'array'
    and jsonb_array_length(uncertainties) <= 50
    and octet_length(uncertainties::text) <= 8192
  ),
  content_hash bytea not null check (octet_length(content_hash) = 32),
  status text not null check (
    status in (
      'profile_confirmed', 'global_candidate', 'global_approved',
      'superseded', 'withdrawn', 'rejected'
    )
  ),
  created_at timestamptz not null default clock_timestamp(),
  approved_at timestamptz,
  check (
    (status = 'global_approved' and owner_profile_id is null and approved_at is not null)
    or (status <> 'global_approved' and approved_at is null)
  ),
  check (
    (source_kind = 'global_approval' and owner_profile_id is null)
    or source_kind <> 'global_approval'
  )
);

create unique index commercial_product_revisions_private_content_idx
on public.commercial_product_revisions (product_id, owner_profile_id, content_hash)
where owner_profile_id is not null
  and status in ('profile_confirmed', 'global_candidate');

create unique index commercial_product_revisions_global_content_idx
on public.commercial_product_revisions (product_id, content_hash)
where owner_profile_id is null and status = 'global_approved';

create index commercial_product_revisions_product_created_idx
on public.commercial_product_revisions (product_id, created_at desc);

create table public.product_confirmations (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  product_id uuid not null
    references public.commercial_products (id) on delete restrict,
  revision_id uuid not null
    references public.commercial_product_revisions (id) on delete cascade,
  confirmed_by uuid references public.actors (id) on delete set null,
  supersedes_id uuid references public.product_confirmations (id) on delete set null,
  status text not null default 'active' check (status in ('active', 'superseded')),
  confirmed_at timestamptz not null default clock_timestamp(),
  superseded_at timestamptz,
  check (
    (status = 'active' and superseded_at is null)
    or (status = 'superseded' and superseded_at is not null)
  )
);

create unique index product_confirmations_one_active_idx
on public.product_confirmations (profile_id, product_id)
where status = 'active';

create index product_confirmations_profile_created_idx
on public.product_confirmations (profile_id, confirmed_at desc);

create table public.barcode_corrections (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  product_id uuid not null
    references public.commercial_products (id) on delete restrict,
  revision_id uuid not null unique
    references public.commercial_product_revisions (id) on delete cascade,
  base_revision_id uuid
    references public.commercial_product_revisions (id) on delete set null,
  proposed_by uuid references public.actors (id) on delete set null,
  snapshot_hash bytea not null check (octet_length(snapshot_hash) = 32),
  status text not null default 'pending' check (
    status in ('pending', 'approved', 'rejected', 'superseded')
  ),
  created_at timestamptz not null default clock_timestamp(),
  reviewed_at timestamptz,
  reviewed_by uuid references public.actors (id) on delete set null,
  check (
    (status = 'pending' and reviewed_at is null and reviewed_by is null)
    or (status <> 'pending' and reviewed_at is not null)
  )
);

create index barcode_corrections_status_created_idx
on public.barcode_corrections (status, created_at, id);

create table public.product_matching_rule_revisions (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null
    references public.commercial_products (id) on delete cascade,
  canonical_food_id uuid not null
    references public.canonical_foods (id) on delete restrict,
  match_state text not null check (
    match_state in ('exact', 'allowed', 'review', 'excluded', 'insufficient')
  ),
  criteria jsonb not null default '{}'::jsonb check (
    jsonb_typeof(criteria) = 'object'
    and octet_length(criteria::text) <= 32768
  ),
  exclusions jsonb not null default '[]'::jsonb check (
    jsonb_typeof(exclusions) = 'array'
    and octet_length(exclusions::text) <= 32768
  ),
  evidence jsonb not null default '[]'::jsonb check (
    jsonb_typeof(evidence) = 'array'
    and octet_length(evidence::text) <= 32768
  ),
  supersedes_id uuid
    references public.product_matching_rule_revisions (id) on delete set null,
  status text not null default 'draft' check (
    status in ('draft', 'active', 'superseded', 'withdrawn')
  ),
  created_at timestamptz not null default clock_timestamp(),
  activated_at timestamptz
);

create unique index product_matching_rule_one_active_idx
on public.product_matching_rule_revisions (product_id)
where status = 'active';

create table private.commercial_product_idempotency (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null references public.actors (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  operation text not null check (operation = 'product-confirm'),
  request_id uuid not null,
  request_digest bytea not null check (octet_length(request_digest) = 32),
  response jsonb not null check (
    jsonb_typeof(response) = 'object'
    and octet_length(response::text) <= 32768
  ),
  created_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null default (clock_timestamp() + interval '24 hours'),
  unique (actor_id, profile_id, operation, request_id),
  check (expires_at > created_at)
);

create index commercial_product_idempotency_expiry_idx
on private.commercial_product_idempotency (expires_at);

create table private.commercial_product_lookup_events (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  actor_id uuid not null references public.actors (id) on delete cascade,
  gtin14 text not null check (gtin14 ~ '^[0-9]{14}$'),
  attempted_at timestamptz not null default clock_timestamp()
);

create index commercial_product_lookup_profile_window_idx
on private.commercial_product_lookup_events (profile_id, attempted_at desc);

create table private.commercial_product_lookup_state (
  gtin14 text primary key check (gtin14 ~ '^[0-9]{14}$'),
  lease_token uuid,
  lease_expires_at timestamptz,
  negative_until timestamptz,
  updated_at timestamptz not null default clock_timestamp(),
  check (
    (lease_token is null and lease_expires_at is null)
    or (lease_token is not null and lease_expires_at is not null)
  )
);

alter table public.commercial_products enable row level security;
alter table public.commercial_product_manifests enable row level security;
alter table public.commercial_product_revisions enable row level security;
alter table public.product_confirmations enable row level security;
alter table public.barcode_corrections enable row level security;
alter table public.product_matching_rule_revisions enable row level security;
alter table private.commercial_product_idempotency enable row level security;
alter table private.commercial_product_lookup_events enable row level security;
alter table private.commercial_product_lookup_state enable row level security;

revoke all on table public.commercial_products
from public, anon, authenticated, service_role;
revoke all on table public.commercial_product_manifests
from public, anon, authenticated, service_role;
revoke all on table public.commercial_product_revisions
from public, anon, authenticated, service_role;
revoke all on table public.product_confirmations
from public, anon, authenticated, service_role;
revoke all on table public.barcode_corrections
from public, anon, authenticated, service_role;
revoke all on table public.product_matching_rule_revisions
from public, anon, authenticated, service_role;
revoke all on table private.commercial_product_idempotency
from public, anon, authenticated, service_role;
revoke all on table private.commercial_product_lookup_events
from public, anon, authenticated, service_role;
revoke all on table private.commercial_product_lookup_state
from public, anon, authenticated, service_role;

create function private.require_commercial_product_access(
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
  select context.actor_id, context.device_session_id
  into v_actor_id, v_device_session_id
  from private.require_internal_device_session(
    p_auth_subject, p_auth_session_id
  ) context;

  if not private.actor_has_profile_access(
    v_actor_id, v_device_session_id, p_profile_id
  ) then
    raise exception using errcode = '42501', message = 'profile_access_denied';
  end if;
  return v_actor_id;
end;
$$;

create function private.commercial_product_resolution_json(
  p_profile_id uuid,
  p_product_id uuid,
  p_revision_id uuid,
  p_source text,
  p_confirmed_for_profile boolean
)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog
as $$
  select jsonb_build_object(
    'schemaVersion', 1,
    'gtin', revision.snapshot -> 'gtin',
    'snapshot', revision.snapshot,
    'source', p_source,
    'revisionId', revision.id,
    'contentHash', encode(revision.content_hash, 'hex'),
    'completeness', revision.completeness,
    'uncertainties', revision.uncertainties,
    'confirmedForProfile', p_confirmed_for_profile,
    'sourceAvailability', 'available',
    'matching', case
      when matching.id is null then null
      else jsonb_build_object(
        'canonicalFoodKey', food.food_key,
        'messageKey', 'commercial_products.matching.' || matching.match_state,
        'state', matching.match_state
      )
    end
  )
  from public.commercial_product_revisions revision
  left join public.product_matching_rule_revisions matching
    on matching.product_id = p_product_id and matching.status = 'active'
  left join public.canonical_foods food on food.id = matching.canonical_food_id
  where revision.id = p_revision_id
$$;

create function public.internal_commercial_product_resolve(
  p_auth_subject uuid,
  p_auth_session_id uuid,
  p_profile_id uuid,
  p_gtin14 text,
  p_canonical_food_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_actor_id uuid;
  v_product_id uuid;
  v_revision_id uuid;
  v_source text;
  v_confirmed boolean;
  v_now timestamptz := clock_timestamp();
begin
  if p_gtin14 !~ '^[0-9]{14}$'
    or (
      p_canonical_food_key is not null
      and p_canonical_food_key !~ '^food:[a-z0-9][a-z0-9._:-]{0,127}$'
    ) then
    raise exception using errcode = '22023', message = 'invalid_product_resolution';
  end if;

  v_actor_id := private.require_commercial_product_access(
    p_auth_subject, p_auth_session_id, p_profile_id
  );

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('product-rate:' || p_profile_id::text, 0)
  );

  if (
    select count(*) >= 30
    from private.commercial_product_lookup_events event
    where event.profile_id = p_profile_id
      and event.attempted_at > v_now - interval '1 hour'
  ) or (
    select count(*) >= 500
    from private.commercial_product_lookup_events event
    where event.profile_id = p_profile_id
      and event.attempted_at > v_now - interval '30 days'
  ) then
    raise exception using errcode = 'PT429', message = 'product_rate_limited';
  end if;

  insert into private.commercial_product_lookup_events (
    profile_id, actor_id, gtin14, attempted_at
  ) values (p_profile_id, v_actor_id, p_gtin14, v_now);

  select product.id into v_product_id
  from public.commercial_products product
  where product.gtin14 = p_gtin14;
  if v_product_id is null then return null; end if;

  select exists (
    select 1 from public.product_confirmations confirmation
    where confirmation.profile_id = p_profile_id
      and confirmation.product_id = v_product_id
      and confirmation.status = 'active'
  ) into v_confirmed;

  select candidate.revision_id, candidate.source
  into v_revision_id, v_source
  from (
    select revision.id as revision_id, 'profile'::text as source, 1 as precedence
    from public.product_confirmations confirmation
    join public.commercial_product_revisions revision
      on revision.id = confirmation.revision_id
    where confirmation.profile_id = p_profile_id
      and confirmation.product_id = v_product_id
      and confirmation.status = 'active'
      and revision.owner_profile_id = p_profile_id
      and revision.source_kind = 'profile_correction'
      and revision.status = 'profile_confirmed'
    union all
    select revision.id, 'global'::text, 2
    from public.commercial_product_revisions revision
    where revision.product_id = v_product_id
      and revision.status = 'global_approved'
    union all
    select revision.id, 'confirmed_label'::text, 3
    from public.product_confirmations confirmation
    join public.commercial_product_revisions revision
      on revision.id = confirmation.revision_id
    where confirmation.profile_id = p_profile_id
      and confirmation.product_id = v_product_id
      and confirmation.status = 'active'
      and revision.owner_profile_id = p_profile_id
      and revision.source_kind = 'confirmed_label'
      and revision.status = 'profile_confirmed'
  ) candidate
  order by candidate.precedence, candidate.revision_id
  limit 1;

  if v_revision_id is null then return null; end if;
  return private.commercial_product_resolution_json(
    p_profile_id, v_product_id, v_revision_id, v_source, v_confirmed
  );
end;
$$;

create function public.internal_commercial_product_confirm(
  p_auth_subject uuid,
  p_auth_session_id uuid,
  p_profile_id uuid,
  p_gtin14 text,
  p_base_revision_id uuid,
  p_expected_content_hash bytea,
  p_snapshot jsonb,
  p_snapshot_content_hash bytea,
  p_completeness text,
  p_uncertainties jsonb,
  p_request_id uuid,
  p_request_digest bytea
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_actor_id uuid;
  v_product_id uuid;
  v_revision_id uuid;
  v_manifest_id uuid;
  v_confirmation_id uuid;
  v_correction_id uuid;
  v_base_hash bytea;
  v_base_accessible boolean := false;
  v_reused boolean := true;
  v_is_edit boolean := false;
  v_existing private.commercial_product_idempotency%rowtype;
  v_response jsonb;
  v_now timestamptz := clock_timestamp();
begin
  if p_gtin14 !~ '^[0-9]{14}$'
    or octet_length(p_snapshot_content_hash) <> 32
    or octet_length(p_request_digest) <> 32
    or jsonb_typeof(p_snapshot) <> 'object'
    or octet_length(p_snapshot::text) > 65536
    or p_snapshot #>> '{gtin,gtin14}' <> p_gtin14
    or p_completeness not in ('complete', 'provisional', 'insufficient')
    or jsonb_typeof(p_uncertainties) <> 'array'
    or jsonb_array_length(p_uncertainties) > 50 then
    raise exception using errcode = '22023', message = 'invalid_product_confirmation';
  end if;

  v_actor_id := private.require_commercial_product_access(
    p_auth_subject, p_auth_session_id, p_profile_id
  );

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'product-confirm:' || v_actor_id::text || ':' ||
      p_profile_id::text || ':' || p_request_id::text,
      0
    )
  );

  delete from private.commercial_product_idempotency
  where expires_at <= v_now;

  select entry.* into v_existing
  from private.commercial_product_idempotency entry
  where entry.actor_id = v_actor_id
    and entry.profile_id = p_profile_id
    and entry.operation = 'product-confirm'
    and entry.request_id = p_request_id;
  if found then
    if v_existing.request_digest <> p_request_digest then
      raise exception using errcode = '23505', message = 'idempotency_key_reused';
    end if;
    return v_existing.response;
  end if;

  insert into public.commercial_products (gtin14)
  values (p_gtin14)
  on conflict (gtin14) do update set gtin14 = excluded.gtin14
  returning id into v_product_id;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'product-revision:' || v_product_id::text || ':' || p_profile_id::text,
      0
    )
  );

  if p_base_revision_id is not null then
    select revision.content_hash,
      (
        revision.product_id = v_product_id
        and (
          revision.owner_profile_id = p_profile_id
          or revision.status = 'global_approved'
        )
      )
    into v_base_hash, v_base_accessible
    from public.commercial_product_revisions revision
    where revision.id = p_base_revision_id;
    if not found or not v_base_accessible then
      raise exception using errcode = 'P0002', message = 'base_product_revision_not_found';
    end if;
    if p_expected_content_hash is not null
      and p_expected_content_hash <> v_base_hash then
      raise exception using errcode = 'PT409', message = 'product_content_conflict';
    end if;
    v_is_edit := v_base_hash <> p_snapshot_content_hash;
  end if;

  if p_base_revision_id is not null and not v_is_edit then
    v_revision_id := p_base_revision_id;
  else
    select revision.id into v_revision_id
    from public.commercial_product_revisions revision
    where revision.product_id = v_product_id
      and revision.content_hash = p_snapshot_content_hash
      and (
        revision.status = 'global_approved'
        or (
          revision.owner_profile_id = p_profile_id
          and revision.status = 'profile_confirmed'
        )
      )
    order by case when revision.status = 'global_approved' then 1 else 2 end
    limit 1;
  end if;

  if v_revision_id is null then
    v_reused := false;
    insert into public.commercial_product_manifests (
      source_kind, normalized_content_hash, metadata
    ) values (
      case when v_is_edit then 'profile_correction' else 'confirmed_label' end,
      p_snapshot_content_hash,
      jsonb_build_object('schemaVersion', 1)
    ) returning id into v_manifest_id;

    insert into public.commercial_product_revisions (
      product_id, manifest_id, owner_profile_id, supersedes_id, source_kind,
      snapshot, completeness, uncertainties, content_hash, status
    ) values (
      v_product_id, v_manifest_id, p_profile_id, p_base_revision_id,
      case when v_is_edit then 'profile_correction' else 'confirmed_label' end,
      p_snapshot, p_completeness, p_uncertainties, p_snapshot_content_hash,
      'profile_confirmed'
    ) returning id into v_revision_id;

    if v_is_edit then
      insert into public.barcode_corrections (
        profile_id, product_id, revision_id, base_revision_id, proposed_by,
        snapshot_hash
      ) values (
        p_profile_id, v_product_id, v_revision_id, p_base_revision_id,
        v_actor_id, p_snapshot_content_hash
      ) returning id into v_correction_id;
    end if;
  else
    select correction.id into v_correction_id
    from public.barcode_corrections correction
    where correction.revision_id = v_revision_id;
  end if;

  select confirmation.id into v_confirmation_id
  from public.product_confirmations confirmation
  where confirmation.profile_id = p_profile_id
    and confirmation.product_id = v_product_id
    and confirmation.revision_id = v_revision_id
    and confirmation.status = 'active';

  if v_confirmation_id is null then
    update public.product_confirmations
    set status = 'superseded', superseded_at = v_now
    where profile_id = p_profile_id
      and product_id = v_product_id
      and status = 'active';

    insert into public.product_confirmations (
      profile_id, product_id, revision_id, confirmed_by, supersedes_id,
      confirmed_at
    ) values (
      p_profile_id, v_product_id, v_revision_id, v_actor_id,
      (
        select confirmation.id
        from public.product_confirmations confirmation
        where confirmation.profile_id = p_profile_id
          and confirmation.product_id = v_product_id
          and confirmation.status = 'superseded'
        order by confirmation.superseded_at desc
        limit 1
      ),
      v_now
    ) returning id into v_confirmation_id;
  end if;

  select jsonb_build_object(
    'schemaVersion', 1,
    'confirmationId', v_confirmation_id,
    'productId', v_product_id,
    'revisionId', revision.id,
    'correctionId', v_correction_id,
    'scope', 'profile',
    'completeness', revision.completeness,
    'reusedRevision', v_reused,
    'confirmedAt', confirmation.confirmed_at
  ) into v_response
  from public.commercial_product_revisions revision
  join public.product_confirmations confirmation
    on confirmation.id = v_confirmation_id
  where revision.id = v_revision_id;

  insert into private.commercial_product_idempotency (
    actor_id, profile_id, operation, request_id, request_digest, response
  ) values (
    v_actor_id, p_profile_id, 'product-confirm', p_request_id,
    p_request_digest, v_response
  );

  return v_response;
end;
$$;

create function private.purge_private_commercial_products_before_profile_delete()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  delete from public.commercial_product_revisions revision
  where revision.owner_profile_id = old.id
    and revision.status <> 'global_approved';
  update public.commercial_product_revisions revision
  set owner_profile_id = null
  where revision.owner_profile_id = old.id
    and revision.status = 'global_approved';
  return old;
end;
$$;

create trigger profiles_purge_private_commercial_products
before delete on public.profiles
for each row execute function private.purge_private_commercial_products_before_profile_delete();

revoke all on function private.require_commercial_product_access(uuid, uuid, uuid)
from public, anon, authenticated, service_role;
revoke all on function private.commercial_product_resolution_json(uuid, uuid, uuid, text, boolean)
from public, anon, authenticated, service_role;
revoke all on function private.purge_private_commercial_products_before_profile_delete()
from public, anon, authenticated, service_role;
revoke all on function public.internal_commercial_product_resolve(uuid, uuid, uuid, text, text)
from public, anon, authenticated;
revoke all on function public.internal_commercial_product_confirm(
  uuid, uuid, uuid, text, uuid, bytea, jsonb, bytea, text, jsonb, uuid, bytea
) from public, anon, authenticated;

grant execute on function public.internal_commercial_product_resolve(uuid, uuid, uuid, text, text)
to service_role;
grant execute on function public.internal_commercial_product_confirm(
  uuid, uuid, uuid, text, uuid, bytea, jsonb, bytea, text, jsonb, uuid, bytea
) to service_role;
