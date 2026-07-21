create table private.supermarket_sku_matching_rule_revisions (
  id uuid primary key default gen_random_uuid(),
  sku_id uuid not null references private.supermarket_skus (id) on delete restrict,
  canonical_food_id uuid not null
    references public.canonical_foods (id) on delete restrict,
  match_state text not null check (
    match_state in ('exact', 'allowed', 'review', 'excluded', 'insufficient')
  ),
  food_state text not null check (food_state in ('raw', 'cooked', 'unspecified')),
  purchase_form text not null check (
    purchase_form in (
      'dry', 'fresh', 'drained', 'canned', 'natural', 'prepared', 'marinated'
    )
  ),
  edible_part text not null check (edible_part ~ '^[a-z][a-z0-9_]{0,95}$'),
  criteria jsonb not null default '{}'::jsonb check (
    jsonb_typeof(criteria) = 'object' and octet_length(criteria::text) <= 32768
  ),
  evidence jsonb not null default '[]'::jsonb check (
    jsonb_typeof(evidence) = 'array' and octet_length(evidence::text) <= 32768
  ),
  exclusions jsonb not null default '[]'::jsonb check (
    jsonb_typeof(exclusions) = 'array' and octet_length(exclusions::text) <= 32768
  ),
  gtin_consistency text not null check (
    gtin_consistency in ('consistent', 'conflict', 'not_available')
  ),
  critical_issue_open boolean not null default false,
  version integer not null check (version >= 1),
  status text not null default 'draft' check (
    status in ('draft', 'active', 'superseded', 'withdrawn')
  ),
  supersedes_id uuid
    references private.supermarket_sku_matching_rule_revisions (id) on delete restrict,
  reviewed_by uuid not null references public.actors (id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  activated_at timestamptz,
  unique (sku_id, version),
  check (
    (status = 'active' and activated_at is not null)
    or (status = 'superseded' and activated_at is not null)
    or (status in ('draft', 'withdrawn') and activated_at is null)
  ),
  check (
    status <> 'active'
    or (
      match_state in ('exact', 'allowed')
      and gtin_consistency <> 'conflict'
      and critical_issue_open is false
    )
  )
);

create unique index supermarket_sku_matching_one_active_idx
on private.supermarket_sku_matching_rule_revisions (sku_id)
where status = 'active';

create index supermarket_sku_matching_food_status_idx
on private.supermarket_sku_matching_rule_revisions (
  canonical_food_id, status, sku_id
);

create table private.basket_seed_revisions (
  id uuid primary key default gen_random_uuid(),
  version text not null unique check (version ~ '^[a-z0-9][a-z0-9._-]{0,95}$'),
  fixed_keys jsonb not null check (
    jsonb_typeof(fixed_keys) = 'array' and jsonb_array_length(fixed_keys) = 60
  ),
  dynamic_keys jsonb not null check (
    jsonb_typeof(dynamic_keys) = 'array' and jsonb_array_length(dynamic_keys) = 20
  ),
  usage_window jsonb not null check (
    jsonb_typeof(usage_window) = 'object'
    and usage_window ? 'from'
    and usage_window ? 'to'
    and octet_length(usage_window::text) <= 1024
  ),
  calculation_hash bytea not null unique check (octet_length(calculation_hash) = 32),
  status text not null default 'draft' check (
    status in ('draft', 'active', 'superseded')
  ),
  supersedes_id uuid references private.basket_seed_revisions (id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  activated_at timestamptz,
  check (
    (status = 'active' and activated_at is not null)
    or (status = 'superseded' and activated_at is not null)
    or (status = 'draft' and activated_at is null)
  )
);

create unique index basket_seed_one_active_idx
on private.basket_seed_revisions ((true))
where status = 'active';

create table private.basket_seed_items (
  id uuid primary key default gen_random_uuid(),
  basket_seed_revision_id uuid not null
    references private.basket_seed_revisions (id) on delete restrict,
  canonical_food_id uuid not null
    references public.canonical_foods (id) on delete restrict,
  seed_kind text not null check (seed_kind in ('fixed', 'dynamic')),
  group_key text not null check (
    group_key in (
      'protein', 'vegetable', 'fruit', 'carbohydrate',
      'dairy_alternative', 'fat'
    )
  ),
  food_state text not null check (food_state in ('raw', 'cooked', 'unspecified')),
  purchase_form text not null check (
    purchase_form in (
      'dry', 'fresh', 'drained', 'canned', 'natural', 'prepared', 'marinated'
    )
  ),
  edible_part text not null check (edible_part ~ '^[a-z][a-z0-9_]{0,95}$'),
  usage_from date,
  usage_to date,
  created_at timestamptz not null default clock_timestamp(),
  unique (basket_seed_revision_id, canonical_food_id),
  check (
    (seed_kind = 'fixed' and usage_from is null and usage_to is null)
    or (
      seed_kind = 'dynamic'
      and usage_from is not null
      and usage_to is not null
      and usage_from <= usage_to
    )
  )
);

create index basket_seed_items_seed_group_idx
on private.basket_seed_items (basket_seed_revision_id, group_key, seed_kind);

create table private.catalog_publications (
  id uuid primary key default gen_random_uuid(),
  market text not null check (market = 'ES'),
  chain text not null check (chain in ('mercadona', 'dia', 'aldi')),
  catalog_revision_id uuid not null
    references private.supermarket_catalog_revisions (id) on delete restrict,
  basket_seed_revision_id uuid not null
    references private.basket_seed_revisions (id) on delete restrict,
  coverage jsonb not null check (
    jsonb_typeof(coverage) = 'object' and octet_length(coverage::text) <= 32768
  ),
  coverage_hash bytea not null check (octet_length(coverage_hash) = 32),
  source_use_decision text not null check (
    source_use_decision in ('development_approved', 'development_restricted_approved')
  ),
  published_by uuid not null references public.actors (id) on delete restrict,
  published_at timestamptz not null default clock_timestamp(),
  hidden_by uuid references public.actors (id) on delete restrict,
  hidden_at timestamptz,
  check ((hidden_by is null) = (hidden_at is null)),
  unique (catalog_revision_id, basket_seed_revision_id)
);

create unique index catalog_publications_one_active_chain_idx
on private.catalog_publications (market, chain)
where hidden_at is null;

create index catalog_publications_chain_history_idx
on private.catalog_publications (market, chain, published_at desc);

alter table private.supermarket_sku_matching_rule_revisions enable row level security;
alter table private.basket_seed_revisions enable row level security;
alter table private.basket_seed_items enable row level security;
alter table private.catalog_publications enable row level security;

revoke all on table private.supermarket_sku_matching_rule_revisions
from public, anon, authenticated, service_role;
revoke all on table private.basket_seed_revisions
from public, anon, authenticated, service_role;
revoke all on table private.basket_seed_items
from public, anon, authenticated, service_role;
revoke all on table private.catalog_publications
from public, anon, authenticated, service_role;

create function private.create_basket_seed_revision(
  p_version text,
  p_fixed_items jsonb,
  p_dynamic_items jsonb,
  p_usage_window jsonb,
  p_calculation_hash bytea
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_all_keys jsonb;
  v_food_id uuid;
  v_from date;
  v_item jsonb;
  v_seed_id uuid;
  v_to date;
begin
  if jsonb_typeof(p_fixed_items) <> 'array'
    or jsonb_array_length(p_fixed_items) <> 60
    or jsonb_typeof(p_dynamic_items) <> 'array'
    or jsonb_array_length(p_dynamic_items) <> 20
    or jsonb_typeof(p_usage_window) <> 'object'
    or octet_length(p_calculation_hash) <> 32
  then
    raise exception using errcode = '22023', message = 'invalid_basket_seed';
  end if;

  begin
    v_from := (p_usage_window ->> 'from')::date;
    v_to := (p_usage_window ->> 'to')::date;
  exception when others then
    raise exception using errcode = '22023', message = 'invalid_dynamic_usage_window';
  end;
  if v_from is null or v_to is null or v_from > v_to then
    raise exception using errcode = '22023', message = 'invalid_dynamic_usage_window';
  end if;

  v_all_keys := (
    select jsonb_agg(item ->> 'canonicalFoodKey')
    from jsonb_array_elements(p_fixed_items || p_dynamic_items) item
  );
  if jsonb_array_length(v_all_keys) <> (
    select count(distinct value)::integer
    from jsonb_array_elements_text(v_all_keys)
  ) then
    raise exception using errcode = '22023', message = 'basket_seed_keys_not_unique';
  end if;

  insert into private.basket_seed_revisions (
    version, fixed_keys, dynamic_keys, usage_window, calculation_hash
  ) values (
    p_version,
    (select jsonb_agg(item ->> 'canonicalFoodKey' order by item ->> 'canonicalFoodKey')
      from jsonb_array_elements(p_fixed_items) item),
    (select jsonb_agg(item ->> 'canonicalFoodKey' order by item ->> 'canonicalFoodKey')
      from jsonb_array_elements(p_dynamic_items) item),
    p_usage_window,
    p_calculation_hash
  ) returning id into v_seed_id;

  for v_item in
    select item || jsonb_build_object('seedKind', 'fixed')
    from jsonb_array_elements(p_fixed_items) item
    union all
    select item || jsonb_build_object('seedKind', 'dynamic')
    from jsonb_array_elements(p_dynamic_items) item
  loop
    select food.id into v_food_id
    from public.canonical_foods food
    where food.food_key = v_item ->> 'canonicalFoodKey'
      and food.active is true;
    if v_food_id is null then
      raise exception using errcode = '22023', message = 'basket_food_not_active';
    end if;
    if not exists (
      select 1 from public.canonical_foods food
      where food.id = v_food_id
        and food.food_state = v_item ->> 'foodState'
        and food.edible_part = v_item ->> 'ediblePart'
    ) then
      raise exception using errcode = '22023', message = 'basket_food_identity_mismatch';
    end if;

    insert into private.basket_seed_items (
      basket_seed_revision_id, canonical_food_id, seed_kind, group_key,
      food_state, purchase_form, edible_part, usage_from, usage_to
    ) values (
      v_seed_id, v_food_id, v_item ->> 'seedKind', v_item ->> 'group',
      v_item ->> 'foodState', v_item ->> 'purchaseForm', v_item ->> 'ediblePart',
      case when v_item ->> 'seedKind' = 'dynamic' then v_from end,
      case when v_item ->> 'seedKind' = 'dynamic' then v_to end
    );
  end loop;

  return v_seed_id;
end;
$$;

create function private.activate_basket_seed_revision(p_seed_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_current_id uuid;
  v_seed private.basket_seed_revisions%rowtype;
begin
  select * into v_seed from private.basket_seed_revisions seed
  where seed.id = p_seed_id for update;
  if v_seed.id is null then
    raise exception using errcode = 'P0002', message = 'basket_seed_not_found';
  end if;
  if v_seed.status = 'active' then
    return jsonb_build_object('basketSeedRevisionId', v_seed.id, 'status', 'active');
  end if;
  if v_seed.status <> 'draft'
    or (select count(*) from private.basket_seed_items item
        where item.basket_seed_revision_id = v_seed.id and item.seed_kind = 'fixed') <> 60
    or (select count(*) from private.basket_seed_items item
        where item.basket_seed_revision_id = v_seed.id and item.seed_kind = 'dynamic') <> 20
  then
    raise exception using errcode = '55000', message = 'basket_seed_not_activatable';
  end if;

  select seed.id into v_current_id from private.basket_seed_revisions seed
  where seed.status = 'active' for update;
  if v_current_id is not null then
    update private.basket_seed_revisions
    set status = 'superseded'
    where id = v_current_id;
  end if;
  update private.basket_seed_revisions
  set status = 'active', activated_at = clock_timestamp(), supersedes_id = v_current_id
  where id = v_seed.id;
  return jsonb_build_object('basketSeedRevisionId', v_seed.id, 'status', 'active');
end;
$$;

create function private.create_supermarket_matching_rule(
  p_sku_id uuid,
  p_canonical_food_key text,
  p_match_state text,
  p_food_state text,
  p_purchase_form text,
  p_edible_part text,
  p_criteria jsonb,
  p_evidence jsonb,
  p_exclusions jsonb,
  p_reviewed_by uuid
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_canonical_food_id uuid;
  v_consistency text := 'not_available';
  v_gtin14 text;
  v_match_state text := p_match_state;
  v_previous_id uuid;
  v_rule_id uuid;
  v_version integer;
begin
  select food.id into v_canonical_food_id
  from public.canonical_foods food
  where food.food_key = p_canonical_food_key
    and food.active is true
    and food.food_state = p_food_state
    and food.edible_part = p_edible_part;
  if v_canonical_food_id is null then
    raise exception using errcode = '22023', message = 'matching_food_identity_mismatch';
  end if;

  select sku.gtin14 into v_gtin14
  from private.supermarket_skus sku where sku.id = p_sku_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'supermarket_sku_not_found';
  end if;

  if v_gtin14 is not null then
    select case
      when rule.canonical_food_id = v_canonical_food_id then 'consistent'
      else 'conflict'
    end into v_consistency
    from public.commercial_products product
    join public.product_matching_rule_revisions rule
      on rule.product_id = product.id and rule.status = 'active'
    where product.gtin14 = v_gtin14
    limit 1;
    v_consistency := coalesce(v_consistency, 'not_available');
  end if;
  if v_consistency = 'conflict' then v_match_state := 'review'; end if;

  select rule.id, rule.version into v_previous_id, v_version
  from private.supermarket_sku_matching_rule_revisions rule
  where rule.sku_id = p_sku_id
  order by rule.version desc limit 1;
  v_version := coalesce(v_version, 0) + 1;

  insert into private.supermarket_sku_matching_rule_revisions (
    sku_id, canonical_food_id, match_state, food_state, purchase_form,
    edible_part, criteria, evidence, exclusions, gtin_consistency, version,
    supersedes_id, reviewed_by
  ) values (
    p_sku_id, v_canonical_food_id, v_match_state, p_food_state, p_purchase_form,
    p_edible_part, p_criteria, p_evidence, p_exclusions, v_consistency, v_version,
    v_previous_id, p_reviewed_by
  ) returning id into v_rule_id;
  return v_rule_id;
end;
$$;

create function private.activate_supermarket_matching_rule(
  p_rule_id uuid,
  p_actor_id uuid,
  p_expected_version integer
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_rule private.supermarket_sku_matching_rule_revisions%rowtype;
begin
  select * into v_rule
  from private.supermarket_sku_matching_rule_revisions rule
  where rule.id = p_rule_id for update;
  if v_rule.id is null then
    raise exception using errcode = 'P0002', message = 'matching_rule_not_found';
  end if;
  if v_rule.version <> p_expected_version then
    raise exception using errcode = '40001', message = 'stale_matching_rule_version';
  end if;
  if v_rule.status = 'active' then
    return jsonb_build_object(
      'matchingRuleId', v_rule.id, 'status', 'active', 'version', v_rule.version
    );
  end if;
  if v_rule.status <> 'draft'
    or v_rule.match_state not in ('exact', 'allowed')
    or v_rule.gtin_consistency = 'conflict'
    or v_rule.critical_issue_open
  then
    raise exception using errcode = '55000', message = 'matching_rule_not_activatable';
  end if;

  update private.supermarket_sku_matching_rule_revisions
  set status = 'superseded'
  where sku_id = v_rule.sku_id and status = 'active';
  update private.supermarket_sku_matching_rule_revisions
  set status = 'active', activated_at = clock_timestamp(), reviewed_by = p_actor_id
  where id = v_rule.id;
  return jsonb_build_object(
    'matchingRuleId', v_rule.id, 'status', 'active', 'version', v_rule.version
  );
end;
$$;

create function private.supermarket_catalog_publication_context(
  p_catalog_revision_id uuid,
  p_basket_seed_revision_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog
as $$
declare
  v_catalog_hash bytea;
  v_coverage jsonb;
  v_coverage_hash bytea;
  v_groups jsonb;
  v_license_status text;
  v_seed_hash bytea;
  v_source_terms_status text;
  v_total_usable integer;
begin
  select manifest.normalized_sha256, manifest.license_status,
    manifest.source_terms_status
  into v_catalog_hash, v_license_status, v_source_terms_status
  from private.supermarket_catalog_revisions revision
  join private.supermarket_source_manifests manifest on manifest.id = revision.manifest_id
  where revision.id = p_catalog_revision_id;
  if v_catalog_hash is null then
    raise exception using errcode = 'P0002', message = 'catalog_revision_not_found';
  end if;

  select seed.calculation_hash into v_seed_hash
  from private.basket_seed_revisions seed
  where seed.id = p_basket_seed_revision_id;
  if v_seed_hash is null then
    raise exception using errcode = 'P0002', message = 'basket_seed_not_found';
  end if;

  with coverage_rows as (
    select item.group_key, item.seed_kind, item.canonical_food_id,
      exists (
        select 1
        from private.supermarket_sku_matching_rule_revisions rule
        join private.supermarket_sku_revisions sku_revision
          on sku_revision.sku_id = rule.sku_id
          and sku_revision.catalog_revision_id = p_catalog_revision_id
        where rule.canonical_food_id = item.canonical_food_id
          and rule.status = 'active'
          and rule.match_state in ('exact', 'allowed')
          and rule.food_state = item.food_state
          and rule.purchase_form = item.purchase_form
          and rule.edible_part = item.edible_part
          and rule.gtin_consistency <> 'conflict'
          and rule.critical_issue_open is false
          and sku_revision.package is not null
          and sku_revision.base_price_eur is not null
          and sku_revision.usability = 'calculable'
      ) as covered
    from private.basket_seed_items item
    where item.basket_seed_revision_id = p_basket_seed_revision_id
  ), groups as (
    select group_key, count(*)::integer required,
      count(*) filter (where covered)::integer usable
    from coverage_rows group by group_key
  )
  select
    coalesce(sum(usable), 0)::integer,
    coalesce(jsonb_agg(jsonb_build_object(
      'groupKey', group_key, 'required', required, 'usable', usable
    ) order by group_key), '[]'::jsonb)
  into v_total_usable, v_groups
  from groups;

  v_coverage := jsonb_build_object(
    'dynamicRequired', 20,
    'dynamicUsable', (
      select count(*) from private.basket_seed_items item
      where item.basket_seed_revision_id = p_basket_seed_revision_id
        and item.seed_kind = 'dynamic'
        and exists (
          select 1 from private.supermarket_sku_matching_rule_revisions rule
          join private.supermarket_sku_revisions sku_revision
            on sku_revision.sku_id = rule.sku_id
            and sku_revision.catalog_revision_id = p_catalog_revision_id
          where rule.canonical_food_id = item.canonical_food_id
            and rule.status = 'active' and rule.match_state in ('exact', 'allowed')
            and rule.food_state = item.food_state
            and rule.purchase_form = item.purchase_form
            and rule.edible_part = item.edible_part
            and rule.gtin_consistency <> 'conflict'
            and rule.critical_issue_open is false
            and sku_revision.package is not null
            and sku_revision.base_price_eur is not null
            and sku_revision.usability = 'calculable'
        )
    ),
    'fixedRequired', 60,
    'fixedUsable', (
      select count(*) from private.basket_seed_items item
      where item.basket_seed_revision_id = p_basket_seed_revision_id
        and item.seed_kind = 'fixed'
        and exists (
          select 1 from private.supermarket_sku_matching_rule_revisions rule
          join private.supermarket_sku_revisions sku_revision
            on sku_revision.sku_id = rule.sku_id
            and sku_revision.catalog_revision_id = p_catalog_revision_id
          where rule.canonical_food_id = item.canonical_food_id
            and rule.status = 'active' and rule.match_state in ('exact', 'allowed')
            and rule.food_state = item.food_state
            and rule.purchase_form = item.purchase_form
            and rule.edible_part = item.edible_part
            and rule.gtin_consistency <> 'conflict'
            and rule.critical_issue_open is false
            and sku_revision.package is not null
            and sku_revision.base_price_eur is not null
            and sku_revision.usability = 'calculable'
        )
    ),
    'groups', v_groups,
    'publishable', (
      v_total_usable >= 72
      and not exists (
        select 1 from jsonb_array_elements(v_groups) group_row
        where (group_row ->> 'usable')::integer * 4
          < (group_row ->> 'required')::integer * 3
      )
    ),
    'totalRequired', 80,
    'totalUsable', v_total_usable
  );
  v_coverage_hash := extensions.digest(convert_to(v_coverage::text, 'utf8'), 'sha256');

  return jsonb_build_object(
    'catalogHash', encode(v_catalog_hash, 'hex'),
    'coverage', v_coverage,
    'coverageHash', encode(v_coverage_hash, 'hex'),
    'licenseStatus', v_license_status,
    'seedHash', encode(v_seed_hash, 'hex'),
    'sourceTermsStatus', v_source_terms_status
  );
end;
$$;

create function private.publish_supermarket_catalog(
  p_catalog_revision_id uuid,
  p_basket_seed_revision_id uuid,
  p_actor_id uuid,
  p_source_use_decision text,
  p_expected_catalog_hash bytea,
  p_expected_seed_hash bytea,
  p_expected_coverage_hash bytea
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_chain text;
  v_context jsonb;
  v_coverage jsonb;
  v_existing_id uuid;
  v_market text;
  v_publication_id uuid;
  v_quality_status text;
  v_seed_status text;
begin
  perform pg_advisory_xact_lock(hashtextextended('supermarket-publication', 0));
  v_context := private.supermarket_catalog_publication_context(
    p_catalog_revision_id, p_basket_seed_revision_id
  );
  v_coverage := v_context -> 'coverage';
  if decode(v_context ->> 'catalogHash', 'hex') <> p_expected_catalog_hash
    or decode(v_context ->> 'seedHash', 'hex') <> p_expected_seed_hash
    or decode(v_context ->> 'coverageHash', 'hex') <> p_expected_coverage_hash
  then
    raise exception using errcode = '40001', message = 'stale_catalog_publication_context';
  end if;
  if (v_coverage ->> 'publishable')::boolean is not true then
    raise exception using errcode = '55000', message = 'catalog_publication_gate_failed';
  end if;
  if v_context ->> 'licenseStatus' = 'unknown'
    or v_context ->> 'sourceTermsStatus' = 'unknown'
  then
    raise exception using errcode = '55000', message = 'catalog_source_decision_required';
  end if;
  if (
    (v_context ->> 'licenseStatus' = 'restricted'
      or v_context ->> 'sourceTermsStatus' = 'restricted')
    and p_source_use_decision <> 'development_restricted_approved'
  ) or (
    v_context ->> 'licenseStatus' = 'approved'
    and v_context ->> 'sourceTermsStatus' = 'approved'
    and p_source_use_decision <> 'development_approved'
  ) then
    raise exception using errcode = '55000', message = 'catalog_source_use_not_permitted';
  end if;

  select revision.market, revision.chain, revision.quality_status
  into v_market, v_chain, v_quality_status
  from private.supermarket_catalog_revisions revision
  where revision.id = p_catalog_revision_id for share;
  select seed.status into v_seed_status
  from private.basket_seed_revisions seed
  where seed.id = p_basket_seed_revision_id for share;
  if v_quality_status = 'degraded' or v_seed_status <> 'active' then
    raise exception using errcode = '55000', message = 'catalog_publication_state_invalid';
  end if;

  select publication.id into v_existing_id
  from private.catalog_publications publication
  where publication.market = v_market and publication.chain = v_chain
    and publication.hidden_at is null
  for update;
  if v_existing_id is not null then
    update private.catalog_publications
    set hidden_by = p_actor_id, hidden_at = clock_timestamp()
    where id = v_existing_id;
  end if;

  insert into private.catalog_publications (
    market, chain, catalog_revision_id, basket_seed_revision_id, coverage,
    coverage_hash, source_use_decision, published_by
  ) values (
    v_market, v_chain, p_catalog_revision_id, p_basket_seed_revision_id,
    v_coverage, p_expected_coverage_hash, p_source_use_decision, p_actor_id
  ) returning id into v_publication_id;

  return jsonb_build_object(
    'catalogPublicationId', v_publication_id,
    'chain', v_chain,
    'status', 'active'
  );
end;
$$;

create function private.hide_supermarket_catalog_publication(
  p_publication_id uuid,
  p_actor_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_publication private.catalog_publications%rowtype;
begin
  select * into v_publication from private.catalog_publications publication
  where publication.id = p_publication_id for update;
  if v_publication.id is null then
    raise exception using errcode = 'P0002', message = 'catalog_publication_not_found';
  end if;
  if v_publication.hidden_at is null then
    update private.catalog_publications
    set hidden_by = p_actor_id, hidden_at = clock_timestamp()
    where id = p_publication_id;
  end if;
  return jsonb_build_object(
    'catalogPublicationId', p_publication_id,
    'chain', v_publication.chain,
    'status', 'hidden'
  );
end;
$$;

create function public.internal_create_basket_seed_revision(
  p_version text,
  p_fixed_items jsonb,
  p_dynamic_items jsonb,
  p_usage_window jsonb,
  p_calculation_hash bytea
)
returns uuid
language sql
security definer
set search_path = pg_catalog
as $$
  select private.create_basket_seed_revision(
    p_version, p_fixed_items, p_dynamic_items, p_usage_window, p_calculation_hash
  )
$$;

create function public.internal_activate_basket_seed_revision(p_seed_id uuid)
returns jsonb
language sql
security definer
set search_path = pg_catalog
as $$
  select private.activate_basket_seed_revision(p_seed_id)
$$;

create function public.internal_create_supermarket_matching_rule(
  p_sku_id uuid,
  p_canonical_food_key text,
  p_match_state text,
  p_food_state text,
  p_purchase_form text,
  p_edible_part text,
  p_criteria jsonb,
  p_evidence jsonb,
  p_exclusions jsonb,
  p_reviewed_by uuid
)
returns uuid
language sql
security definer
set search_path = pg_catalog
as $$
  select private.create_supermarket_matching_rule(
    p_sku_id, p_canonical_food_key, p_match_state, p_food_state, p_purchase_form,
    p_edible_part, p_criteria, p_evidence, p_exclusions, p_reviewed_by
  )
$$;

create or replace function public.internal_list_published_supermarket_catalog(
  p_chain text,
  p_cursor text,
  p_limit integer
)
returns table (
  sku_id uuid,
  external_sku text,
  name text,
  category_path jsonb,
  format_text text,
  purchase_form text,
  package jsonb,
  base_price_eur numeric,
  normalized_price jsonb,
  usability text
)
language plpgsql
stable
security definer
set search_path = pg_catalog
as $$
begin
  if p_chain is null
    or p_chain not in ('mercadona', 'dia', 'aldi')
    or p_limit is null
    or p_limit not between 1 and 100
    or (p_cursor is not null and length(p_cursor) > 240)
  then
    raise exception using errcode = '22023', message = 'invalid_catalog_query';
  end if;
  return query
  select sku.id, sku.external_sku, row.name, row.category_path, row.format_text,
    row.purchase_form, row.package, row.base_price_eur, row.normalized_price,
    row.usability
  from private.catalog_publications publication
  join private.supermarket_sku_revisions row
    on row.catalog_revision_id = publication.catalog_revision_id
  join private.supermarket_skus sku on sku.id = row.sku_id
  where publication.market = 'ES'
    and publication.chain = p_chain
    and publication.hidden_at is null
    and (p_cursor is null or sku.external_sku > p_cursor)
  order by sku.external_sku, sku.id
  limit p_limit;
end;
$$;

revoke all on function private.create_basket_seed_revision(
  text, jsonb, jsonb, jsonb, bytea
) from public, anon, authenticated, service_role;
revoke all on function private.activate_basket_seed_revision(uuid)
from public, anon, authenticated, service_role;
revoke all on function private.create_supermarket_matching_rule(
  uuid, text, text, text, text, text, jsonb, jsonb, jsonb, uuid
) from public, anon, authenticated, service_role;
revoke all on function private.activate_supermarket_matching_rule(uuid, uuid, integer)
from public, anon, authenticated, service_role;
revoke all on function private.supermarket_catalog_publication_context(uuid, uuid)
from public, anon, authenticated, service_role;
revoke all on function private.publish_supermarket_catalog(
  uuid, uuid, uuid, text, bytea, bytea, bytea
) from public, anon, authenticated, service_role;
revoke all on function private.hide_supermarket_catalog_publication(uuid, uuid)
from public, anon, authenticated, service_role;

revoke all on function public.internal_create_basket_seed_revision(
  text, jsonb, jsonb, jsonb, bytea
) from public, anon, authenticated;
revoke all on function public.internal_activate_basket_seed_revision(uuid)
from public, anon, authenticated;
revoke all on function public.internal_create_supermarket_matching_rule(
  uuid, text, text, text, text, text, jsonb, jsonb, jsonb, uuid
) from public, anon, authenticated;

grant execute on function public.internal_create_basket_seed_revision(
  text, jsonb, jsonb, jsonb, bytea
) to service_role;
grant execute on function public.internal_activate_basket_seed_revision(uuid)
to service_role;
grant execute on function public.internal_create_supermarket_matching_rule(
  uuid, text, text, text, text, text, jsonb, jsonb, jsonb, uuid
) to service_role;
