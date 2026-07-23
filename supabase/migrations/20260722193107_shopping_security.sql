alter table private.plan_idempotency
drop constraint if exists plan_idempotency_operation_check;

alter table private.plan_idempotency
add constraint plan_idempotency_operation_check check (
  operation in (
    'context-snapshot', 'plan-generate', 'version-activate',
    'candidate-create', 'candidate-activate', 'candidate-discard',
    'follow-up-create', 'lab-create', 'export-create', 'product-application',
    'shopping-preference-put', 'shopping-snapshot-create',
    'shopping-leftover-set', 'shopping-product-select'
  )
);

create function private.shopping_decimal_text(p_value numeric)
returns text
language sql
immutable
strict
parallel safe
set search_path = pg_catalog
as $$
  select case
    when position('.' in p_value::text) = 0 then p_value::text
    else rtrim(rtrim(p_value::text, '0'), '.')
  end
$$;

create table private.shopping_rate_limit_events (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null references public.actors (id) on delete cascade,
  profile_id uuid references public.profiles (id) on delete cascade,
  operation text not null check (operation in ('catalog-read', 'snapshot-create')),
  key_digest bytea check (key_digest is null or octet_length(key_digest) = 32),
  ip_digest bytea not null check (octet_length(ip_digest) = 32),
  created_at timestamptz not null default clock_timestamp(),
  check (
    (operation = 'catalog-read' and profile_id is null and key_digest is null)
    or (operation = 'snapshot-create' and profile_id is not null and key_digest is not null)
  )
);

create unique index shopping_rate_idempotent_resolution_idx
on private.shopping_rate_limit_events (actor_id, profile_id, operation, key_digest)
where key_digest is not null;

create index shopping_rate_actor_window_idx
on private.shopping_rate_limit_events (actor_id, operation, created_at desc);
create index shopping_rate_profile_window_idx
on private.shopping_rate_limit_events (profile_id, operation, created_at desc)
where profile_id is not null;
create index shopping_rate_ip_window_idx
on private.shopping_rate_limit_events (ip_digest, operation, created_at desc);

alter table private.shopping_rate_limit_events enable row level security;
revoke all on table private.shopping_rate_limit_events
from public, anon, authenticated, service_role;

create function private.consume_shopping_rate_limit(
  p_actor_id uuid,
  p_profile_id uuid,
  p_operation text,
  p_key_digest bytea,
  p_ip_digest bytea
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_now timestamptz := clock_timestamp();
begin
  if p_operation not in ('catalog-read', 'snapshot-create')
    or octet_length(p_ip_digest) <> 32
    or (
      p_operation = 'catalog-read'
      and (p_profile_id is not null or p_key_digest is not null)
    )
    or (
      p_operation = 'snapshot-create'
      and (p_profile_id is null or octet_length(p_key_digest) <> 32)
    )
  then
    raise exception using errcode = '22023', message = 'invalid_shopping_rate_input';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('shopping-actor:' || p_actor_id::text, 0)
  );
  if p_profile_id is not null then
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('shopping-profile:' || p_profile_id::text, 0)
    );
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('shopping-ip:' || encode(p_ip_digest, 'hex'), 0)
  );

  delete from private.shopping_rate_limit_events
  where created_at <= v_now - interval '24 hours';

  if p_key_digest is not null and exists (
    select 1 from private.shopping_rate_limit_events event
    where event.actor_id = p_actor_id
      and event.profile_id = p_profile_id
      and event.operation = p_operation
      and event.key_digest = p_key_digest
  ) then
    return false;
  end if;

  if p_operation = 'snapshot-create' then
    if (select count(*) from private.shopping_rate_limit_events event
        where event.profile_id = p_profile_id
          and event.operation = p_operation
          and event.created_at > v_now - interval '1 hour') >= 30
    then
      raise exception using errcode = '54000', message = 'shopping_profile_rate_limited';
    end if;
    if (select count(*) from private.shopping_rate_limit_events event
        where event.actor_id = p_actor_id
          and event.operation = p_operation
          and event.created_at > v_now - interval '1 hour') >= 60
    then
      raise exception using errcode = '54000', message = 'shopping_actor_rate_limited';
    end if;
    if (select count(*) from private.shopping_rate_limit_events event
        where event.ip_digest = p_ip_digest
          and event.operation = p_operation
          and event.created_at > v_now - interval '1 hour') >= 100
    then
      raise exception using errcode = '54000', message = 'shopping_ip_rate_limited';
    end if;
  else
    if (select count(*) from private.shopping_rate_limit_events event
        where event.actor_id = p_actor_id
          and event.operation = p_operation
          and event.created_at > v_now - interval '1 hour') >= 120
    then
      raise exception using errcode = '54000', message = 'shopping_actor_rate_limited';
    end if;
    if (select count(*) from private.shopping_rate_limit_events event
        where event.ip_digest = p_ip_digest
          and event.operation = p_operation
          and event.created_at > v_now - interval '1 hour') >= 240
    then
      raise exception using errcode = '54000', message = 'shopping_ip_rate_limited';
    end if;
  end if;

  insert into private.shopping_rate_limit_events (
    actor_id, profile_id, operation, key_digest, ip_digest, created_at
  ) values (
    p_actor_id, p_profile_id, p_operation, p_key_digest, p_ip_digest, v_now
  );
  return true;
end;
$$;

create function private.get_shopping_preference(
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
  v_hint text;
  v_preference public.shopping_preference_revisions%rowtype;
begin
  perform private.require_questionnaire_access(
    p_auth_subject, p_auth_session_id, p_profile_id
  );
  select * into v_preference
  from public.shopping_preference_revisions preference
  where preference.profile_id = p_profile_id and preference.lifecycle = 'active';
  select nullif(btrim(draft.answers ->> 'preferredSupermarket'), '') into v_hint
  from public.questionnaire_drafts draft where draft.profile_id = p_profile_id;
  return jsonb_build_object(
    'schemaVersion', 1,
    'preference', case when v_preference.id is null then null
      else private.shopping_preference_json(v_preference) end,
    'legacyHint', case when v_hint is null then null else jsonb_build_object(
      'value', v_hint,
      'compatible', lower(v_hint) in ('mercadona', 'dia', 'aldi')
    ) end
  );
end;
$$;

create function private.put_shopping_preference(
  p_auth_subject uuid,
  p_auth_session_id uuid,
  p_profile_id uuid,
  p_preferred_chain text,
  p_mode text,
  p_compared_chains text[],
  p_sorting text,
  p_expected_version integer,
  p_key_digest bytea,
  p_request_digest bytea
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_actor_id uuid;
  v_current public.shopping_preference_revisions%rowtype;
  v_id uuid;
  v_response jsonb;
  v_version integer;
begin
  v_actor_id := private.require_questionnaire_access(
    p_auth_subject, p_auth_session_id, p_profile_id
  );
  if not private.shopping_preference_is_valid(
    p_preferred_chain, p_mode, p_compared_chains
  ) or p_sorting not in (
    'normalized_price_asc', 'price_asc', 'price_desc', 'name_asc', 'name_desc'
  ) or octet_length(p_key_digest) <> 32 or octet_length(p_request_digest) <> 32
  then
    raise exception using errcode = '22023', message = 'invalid_shopping_preference';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('shopping-actor:' || v_actor_id::text, 0)
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('shopping-profile:' || p_profile_id::text, 0)
  );
  v_response := private.get_plan_idempotency(
    v_actor_id, p_profile_id, 'shopping-preference-put',
    p_key_digest, p_request_digest
  );
  if v_response is not null then return v_response; end if;

  select * into v_current
  from public.shopping_preference_revisions preference
  where preference.profile_id = p_profile_id and preference.lifecycle = 'active'
  for update;
  if (v_current.id is null and p_expected_version is not null)
    or (v_current.id is not null and p_expected_version is distinct from v_current.version)
  then
    raise exception using errcode = '40001', message = 'stale_shopping_preference';
  end if;
  if v_current.id is not null
    and v_current.preferred_chain = p_preferred_chain
    and v_current.mode = p_mode
    and v_current.compared_chains = p_compared_chains
    and v_current.sorting = p_sorting
  then
    v_response := jsonb_build_object(
      'schemaVersion', 1,
      'preferenceRevisionId', v_current.id,
      'version', v_current.version
    );
    perform private.store_plan_idempotency(
      v_actor_id, p_profile_id, 'shopping-preference-put',
      p_key_digest, p_request_digest, v_response
    );
    return v_response;
  end if;

  v_version := coalesce(v_current.version, 0) + 1;
  if v_current.id is not null then
    update public.shopping_preference_revisions
    set lifecycle = 'archived', archived_at = clock_timestamp()
    where id = v_current.id;
  end if;
  insert into public.shopping_preference_revisions (
    profile_id, version, preferred_chain, mode, compared_chains, sorting,
    created_by, supersedes_id
  ) values (
    p_profile_id, v_version, p_preferred_chain, p_mode, p_compared_chains,
    p_sorting, v_actor_id, v_current.id
  ) returning id into v_id;
  v_response := jsonb_build_object(
    'schemaVersion', 1, 'preferenceRevisionId', v_id, 'version', v_version
  );
  perform private.store_plan_idempotency(
    v_actor_id, p_profile_id, 'shopping-preference-put',
    p_key_digest, p_request_digest, v_response
  );
  return v_response;
end;
$$;

create function private.get_shopping_snapshot(
  p_auth_subject uuid,
  p_auth_session_id uuid,
  p_snapshot_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_snapshot public.shopping_snapshots%rowtype;
begin
  select * into v_snapshot from public.shopping_snapshots snapshot
  where snapshot.id = p_snapshot_id;
  if v_snapshot.id is null then
    raise exception using errcode = 'P0002', message = 'shopping_snapshot_not_found';
  end if;
  perform private.require_questionnaire_access(
    p_auth_subject, p_auth_session_id, v_snapshot.profile_id
  );
  return private.shopping_snapshot_envelope(v_snapshot);
end;
$$;

create function private.shopping_catalog_items(
  p_basket_seed_revision_id uuid,
  p_chains text[],
  p_exclude_for_allergy boolean
)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog
as $$
  with eligible as (
    select food.food_key, rule.match_state, rule.edible_part,
      rule.food_state, rule.purchase_form matched_purchase_form,
      sku.id sku_id, sku.external_sku, sku.gtin14, sku.chain,
      sku_revision.name, sku_revision.category_path, sku_revision.format_text,
      sku_revision.purchase_form, sku_revision.package,
      sku_revision.base_price_eur, sku_revision.normalized_price,
      sku_revision.usability, sku_revision.exclusion_reasons,
      row_number() over (
        partition by food.food_key order by sku.chain, sku.id
      ) option_rank
    from private.catalog_publications publication
    join private.supermarket_sku_revisions sku_revision
      on sku_revision.catalog_revision_id = publication.catalog_revision_id
    join private.supermarket_skus sku on sku.id = sku_revision.sku_id
    join private.supermarket_sku_matching_rule_revisions rule
      on rule.sku_id = sku.id and rule.status = 'active'
      and rule.match_state in ('exact', 'allowed')
      and rule.criteria ->> 'catalogRevisionId' = publication.catalog_revision_id::text
      and rule.criteria ->> 'skuContentHash' = encode(
        sku_revision.content_hash, 'hex'
      )
    join public.canonical_foods food on food.id = rule.canonical_food_id
    where publication.hidden_at is null
      and publication.basket_seed_revision_id = p_basket_seed_revision_id
      and publication.chain = any(p_chains)
      and sku_revision.usability in ('calculable', 'visible')
      and rule.gtin_consistency <> 'conflict'
      and rule.critical_issue_open is false
      and p_exclude_for_allergy is false
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'canonicalFoodKey', eligible.food_key,
    'matchState', eligible.match_state,
    'matchedEdiblePart', eligible.edible_part,
    'matchedFoodState', eligible.food_state,
    'matchedPurchaseForm', eligible.matched_purchase_form,
    'projection', jsonb_build_object(
      'basePriceEur', private.shopping_decimal_text(eligible.base_price_eur),
      'categoryPath', eligible.category_path,
      'chain', eligible.chain,
      'exclusionReasons', eligible.exclusion_reasons,
      'externalSku', eligible.external_sku,
      'formatText', eligible.format_text,
      'gtin14', eligible.gtin14,
      'market', 'ES',
      'name', eligible.name,
      'normalizedPrice', eligible.normalized_price,
      'package', eligible.package,
      'purchaseForm', eligible.purchase_form,
      'schemaVersion', 1,
      'skuId', eligible.sku_id,
      'usability', eligible.usability
    )
  ) order by eligible.food_key, eligible.chain, eligible.sku_id), '[]'::jsonb)
  from eligible where eligible.option_rank <= 5
$$;

create function private.prepare_shopping_resolution(
  p_auth_subject uuid,
  p_auth_session_id uuid,
  p_plan_version_id uuid,
  p_base_snapshot_id uuid,
  p_operation text,
  p_mutation jsonb,
  p_key_digest bytea,
  p_request_digest bytea,
  p_ip_digest bytea
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_actor_id uuid;
  v_active_snapshot public.shopping_snapshots%rowtype;
  v_allergy_uncertain boolean;
  v_base_snapshot public.shopping_snapshots%rowtype;
  v_catalog_items jsonb;
  v_chains text[];
  v_context public.context_snapshots%rowtype;
  v_current_revision integer;
  v_expected_version integer;
  v_leftovers jsonb := '[]'::jsonb;
  v_module public.module_results%rowtype;
  v_plan public.plans%rowtype;
  v_plan_version public.plan_versions%rowtype;
  v_preference public.shopping_preference_revisions%rowtype;
  v_profile_id uuid;
  v_publication_ids uuid[];
  v_replay jsonb;
  v_seed_id uuid;
  v_selections jsonb := '[]'::jsonb;
  v_food_key text;
  v_sku_id uuid;
  v_measure jsonb;
  v_equivalent_g numeric;
  v_evidence_ref text;
begin
  if p_operation not in (
    'shopping-snapshot-create', 'shopping-leftover-set', 'shopping-product-select'
  ) or jsonb_typeof(p_mutation) <> 'object'
    or octet_length(p_mutation::text) > 16384
    or octet_length(p_key_digest) <> 32
    or octet_length(p_request_digest) <> 32
    or octet_length(p_ip_digest) <> 32
  then
    raise exception using errcode = '22023', message = 'invalid_shopping_request';
  end if;

  select version.* into v_plan_version
  from public.plan_versions version
  where version.id = p_plan_version_id;
  if v_plan_version.id is null then
    raise exception using errcode = 'P0002', message = 'plan_version_not_found';
  end if;
  select plan.* into strict v_plan
  from public.plans plan where plan.id = v_plan_version.plan_id;
  v_profile_id := v_plan.profile_id;
  v_actor_id := private.require_questionnaire_access(
    p_auth_subject, p_auth_session_id, v_profile_id
  );

  v_replay := private.get_plan_idempotency(
    v_actor_id, v_profile_id, p_operation, p_key_digest, p_request_digest
  );
  if v_replay is not null then
    return jsonb_build_object('replay', true, 'response', v_replay);
  end if;

  perform private.consume_shopping_rate_limit(
    v_actor_id, v_profile_id, 'snapshot-create', p_key_digest, p_ip_digest
  );

  if v_plan.active_version_id is distinct from p_plan_version_id
    or v_plan_version.status <> 'active'
    or v_plan_version.validation_status <> 'valid'
  then
    raise exception using errcode = '40001', message = 'stale_plan_version';
  end if;

  select * into v_module from public.module_results module
  where module.plan_version_id = p_plan_version_id and module.module = 'nutrition';
  if v_module.id is null or v_module.status not in ('valid', 'provisional')
    or jsonb_typeof(v_module.payload -> 'shoppingList') <> 'array'
    or jsonb_array_length(v_module.payload -> 'shoppingList') = 0
  then
    raise exception using errcode = '22023', message = 'nutrition_module_required';
  end if;

  select * into v_context from public.context_snapshots context
  where context.id = v_plan_version.context_snapshot_id;
  v_allergy_uncertain := coalesce(
    v_context.answers ->> 'nutritionAllergiesStatus', 'unknown'
  ) <> 'none';

  select * into v_preference
  from public.shopping_preference_revisions preference
  where preference.profile_id = v_profile_id and preference.lifecycle = 'active';
  if v_preference.id is null then
    raise exception using errcode = '55000', message = 'shopping_preference_required';
  end if;

  if p_operation = 'shopping-snapshot-create' then
    if p_base_snapshot_id is not null
      or not p_mutation ? 'preferenceRevisionId'
      or p_mutation - array['preferenceRevisionId']::text[] <> '{}'::jsonb
      or (p_mutation ->> 'preferenceRevisionId')::uuid <> v_preference.id
    then
      raise exception using errcode = '22023', message = 'invalid_shopping_create';
    end if;
  else
    select * into v_base_snapshot from public.shopping_snapshots snapshot
    where snapshot.id = p_base_snapshot_id
      and snapshot.profile_id = v_profile_id
      and snapshot.plan_version_id = p_plan_version_id
      and snapshot.lifecycle = 'active';
    if v_base_snapshot.id is null then
      raise exception using errcode = '40001', message = 'stale_shopping_snapshot';
    end if;
    v_expected_version := (p_mutation ->> 'expectedVersion')::integer;
    if v_expected_version is distinct from v_base_snapshot.revision then
      raise exception using errcode = '40001', message = 'stale_shopping_snapshot';
    end if;
  end if;

  select seed.id into v_seed_id from private.basket_seed_revisions seed
  where seed.status = 'active';
  if v_seed_id is null then
    raise exception using errcode = '55000', message = 'active_basket_seed_required';
  end if;

  v_chains := case when v_preference.mode = 'single'
    then array[v_preference.preferred_chain]
    else v_preference.compared_chains end;
  if not exists (
    select 1 from private.catalog_publications publication
    where publication.chain = v_preference.preferred_chain
      and publication.hidden_at is null
      and publication.basket_seed_revision_id = v_seed_id
  ) then
    raise exception using errcode = '55000', message = 'catalog_not_published';
  end if;
  if v_preference.mode = 'multistore' and exists (
    select 1 from unnest(v_chains) chain
    where not exists (
      select 1 from private.catalog_publications publication
      where publication.chain = chain
        and publication.hidden_at is null
        and publication.basket_seed_revision_id = v_seed_id
    )
  ) then
    raise exception using errcode = '55000', message = 'catalog_not_published';
  end if;

  if v_preference.mode = 'single' then
    select array_agg(publication.id order by publication.id),
      array_agg(publication.chain order by publication.id)
    into v_publication_ids, v_chains
    from private.catalog_publications publication
    where publication.hidden_at is null
      and publication.basket_seed_revision_id = v_seed_id;
  else
    select array_agg(publication.id order by publication.id)
    into v_publication_ids
    from private.catalog_publications publication
    where publication.hidden_at is null
      and publication.basket_seed_revision_id = v_seed_id
      and publication.chain = any(v_chains);
  end if;

  select * into v_active_snapshot from public.shopping_snapshots snapshot
  where snapshot.profile_id = v_profile_id
    and snapshot.plan_version_id = p_plan_version_id
    and snapshot.lifecycle = 'active';
  v_current_revision := coalesce(v_active_snapshot.revision, 0);

  if v_base_snapshot.id is not null then
    select coalesce(jsonb_agg(jsonb_build_object(
      'canonicalFoodKey', leftover.canonical_food_key,
      'confirmedEquivalentG', private.shopping_decimal_text(
        leftover.confirmed_equivalent_g
      ),
      'declaredMeasure', leftover.declared_measure,
      'evidenceRef', leftover.evidence_ref,
      'skuId', leftover.sku_id,
      'carriedFromId', leftover.id
    ) order by leftover.canonical_food_key), '[]'::jsonb)
    into v_leftovers
    from public.shopping_leftover_confirmations leftover
    where leftover.snapshot_id = v_base_snapshot.id;

    select coalesce(jsonb_agg(jsonb_build_object(
      'canonicalFoodKey', selection.canonical_food_key,
      'skuId', selection.sku_id,
      'carriedFromId', selection.id
    ) order by selection.canonical_food_key), '[]'::jsonb)
    into v_selections
    from public.shopping_product_selection_confirmations selection
    where selection.snapshot_id = v_base_snapshot.id;
  end if;

  if p_operation = 'shopping-leftover-set' then
    if p_mutation ->> 'action' not in ('set', 'clear')
      or p_mutation - array[
        'schemaVersion', 'action', 'canonicalFoodKey', 'declaredMeasure',
        'expectedVersion', 'skuId'
      ]::text[] <> '{}'::jsonb
    then
      raise exception using errcode = '22023', message = 'invalid_shopping_leftover';
    end if;
    v_food_key := p_mutation ->> 'canonicalFoodKey';
    if not exists (
      select 1 from jsonb_array_elements(v_module.payload -> 'shoppingList') line
      where line ->> 'canonicalFoodKey' = v_food_key
    ) then
      raise exception using errcode = '22023', message = 'shopping_food_not_in_plan';
    end if;
    v_leftovers := coalesce((
      select jsonb_agg(item order by item ->> 'canonicalFoodKey')
      from jsonb_array_elements(v_leftovers) item
      where item ->> 'canonicalFoodKey' <> v_food_key
    ), '[]'::jsonb);
    if p_mutation ->> 'action' = 'set' then
      v_measure := p_mutation -> 'declaredMeasure';
      if jsonb_typeof(v_measure) <> 'object'
        or (v_measure ->> 'quantity')::numeric <= 0
      then
        raise exception using errcode = '22023', message = 'invalid_shopping_leftover';
      end if;
      if v_measure ->> 'dimension' = 'mass'
        and v_measure ->> 'unit' = 'g'
        and not p_mutation ? 'skuId'
      then
        v_equivalent_g := (v_measure ->> 'quantity')::numeric;
        v_sku_id := null;
        v_evidence_ref := null;
      elsif v_measure ->> 'dimension' in ('volume', 'count') then
        v_sku_id := (p_mutation ->> 'skuId')::uuid;
        select (v_measure ->> 'quantity')::numeric
            * sku_revision.equivalent_edible_mass_g
            / (sku_revision.package #>> '{saleMeasure,quantity}')::numeric,
          format('catalog-sku:%s', sku_revision.id)
        into v_equivalent_g, v_evidence_ref
        from private.catalog_publications publication
        join private.supermarket_sku_revisions sku_revision
          on sku_revision.catalog_revision_id = publication.catalog_revision_id
        join private.supermarket_sku_matching_rule_revisions rule
          on rule.sku_id = sku_revision.sku_id and rule.status = 'active'
          and rule.match_state in ('exact', 'allowed')
          and rule.criteria ->> 'catalogRevisionId' = publication.catalog_revision_id::text
          and rule.criteria ->> 'skuContentHash' = encode(
            sku_revision.content_hash, 'hex'
          )
        join public.canonical_foods food on food.id = rule.canonical_food_id
        where publication.id = any(v_publication_ids)
          and sku_revision.sku_id = v_sku_id
          and food.food_key = v_food_key
          and sku_revision.usability = 'calculable'
          and sku_revision.equivalent_edible_mass_g is not null
          and sku_revision.equivalence_evidence is not null
          and sku_revision.package #>> '{saleMeasure,dimension}' =
            v_measure ->> 'dimension';
        if v_equivalent_g is null then
          raise exception using errcode = '22023', message = 'shopping_equivalence_unavailable';
        end if;
      else
        raise exception using errcode = '22023', message = 'invalid_shopping_leftover';
      end if;
      v_leftovers := v_leftovers || jsonb_build_array(jsonb_build_object(
        'canonicalFoodKey', v_food_key,
        'confirmedEquivalentG', private.shopping_decimal_text(v_equivalent_g),
        'declaredMeasure', v_measure,
        'evidenceRef', v_evidence_ref,
        'skuId', v_sku_id,
        'carriedFromId', null
      ));
    end if;
  elsif p_operation = 'shopping-product-select' then
    if p_mutation - array[
      'schemaVersion', 'canonicalFoodKey', 'expectedVersion', 'skuId'
    ]::text[] <> '{}'::jsonb
    then
      raise exception using errcode = '22023', message = 'invalid_shopping_selection';
    end if;
    v_food_key := p_mutation ->> 'canonicalFoodKey';
    v_sku_id := (p_mutation ->> 'skuId')::uuid;
    if v_allergy_uncertain or not exists (
      select 1
      from private.catalog_publications publication
      join private.supermarket_sku_revisions sku_revision
        on sku_revision.catalog_revision_id = publication.catalog_revision_id
      join private.supermarket_sku_matching_rule_revisions rule
        on rule.sku_id = sku_revision.sku_id and rule.status = 'active'
        and rule.match_state in ('exact', 'allowed')
        and rule.criteria ->> 'catalogRevisionId' = publication.catalog_revision_id::text
        and rule.criteria ->> 'skuContentHash' = encode(
          sku_revision.content_hash, 'hex'
        )
      join public.canonical_foods food on food.id = rule.canonical_food_id
      where publication.id = any(v_publication_ids)
        and sku_revision.sku_id = v_sku_id
        and food.food_key = v_food_key
        and sku_revision.usability = 'calculable'
        and sku_revision.package is not null
        and sku_revision.base_price_eur is not null
        and jsonb_array_length(sku_revision.exclusion_reasons) = 0
    ) then
      raise exception using errcode = '22023', message = 'shopping_selection_not_eligible';
    end if;
    v_selections := coalesce((
      select jsonb_agg(item order by item ->> 'canonicalFoodKey')
      from jsonb_array_elements(v_selections) item
      where item ->> 'canonicalFoodKey' <> v_food_key
    ), '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
      'canonicalFoodKey', v_food_key, 'skuId', v_sku_id, 'carriedFromId', null
    ));
  end if;

  v_catalog_items := private.shopping_catalog_items(
    v_seed_id, v_chains, v_allergy_uncertain
  );

  return jsonb_build_object(
    'replay', false,
    'source', jsonb_build_object(
      'basketSeedRevisionId', v_seed_id,
      'catalogItems', v_catalog_items,
      'catalogPublicationIds', to_jsonb(v_publication_ids),
      'createdBy', v_actor_id,
      'expectedRevision', v_current_revision,
      'leftovers', coalesce((
        select jsonb_agg(jsonb_build_object(
          'canonicalFoodKey', item ->> 'canonicalFoodKey',
          'confirmedEquivalentG', item ->> 'confirmedEquivalentG',
          'evidenceRef', item ->> 'evidenceRef'
        ) order by item ->> 'canonicalFoodKey')
        from jsonb_array_elements(v_leftovers) item
      ), '[]'::jsonb),
      'leftoversForPersistence', v_leftovers,
      'manualSelections', coalesce((
        select jsonb_agg(jsonb_build_object(
          'canonicalFoodKey', item ->> 'canonicalFoodKey',
          'skuId', item ->> 'skuId'
        ) order by item ->> 'canonicalFoodKey')
        from jsonb_array_elements(v_selections) item
      ), '[]'::jsonb),
      'planVersionId', p_plan_version_id,
      'preferenceRevision', private.shopping_preference_json(v_preference),
      'profileId', v_profile_id,
      'selectionsForPersistence', v_selections,
      'shoppingList', coalesce((
        select jsonb_agg(jsonb_build_object(
          'amountG', line ->> 'amountG',
          'canonicalFoodKey', line ->> 'canonicalFoodKey',
          'name', line ->> 'name',
          'purchaseContext', case when seed_item.id is null then null
            else jsonb_build_object(
              'ediblePart', seed_item.edible_part,
              'foodState', seed_item.food_state,
              'purchaseForm', seed_item.purchase_form
            ) end
        ) order by line ->> 'canonicalFoodKey')
        from jsonb_array_elements(v_module.payload -> 'shoppingList') line
        left join public.canonical_foods food
          on food.food_key = line ->> 'canonicalFoodKey'
        left join private.basket_seed_items seed_item
          on seed_item.basket_seed_revision_id = v_seed_id
          and seed_item.canonical_food_id = food.id
      ), '[]'::jsonb),
      'supersedesId', v_active_snapshot.id
    )
  );
end;
$$;

create function private.persist_shopping_resolution(
  p_auth_subject uuid,
  p_auth_session_id uuid,
  p_plan_version_id uuid,
  p_snapshot_id uuid,
  p_preference_revision_id uuid,
  p_basket_seed_revision_id uuid,
  p_expected_revision integer,
  p_input_digest bytea,
  p_snapshot_hash bytea,
  p_resolver_version text,
  p_snapshot jsonb,
  p_catalog_publication_ids uuid[],
  p_context jsonb,
  p_operation text,
  p_key_digest bytea,
  p_request_digest bytea
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_actor_id uuid;
  v_current public.shopping_snapshots%rowtype;
  v_item jsonb;
  v_plan public.plans%rowtype;
  v_plan_version public.plan_versions%rowtype;
  v_preference public.shopping_preference_revisions%rowtype;
  v_profile_id uuid;
  v_replay jsonb;
  v_response jsonb;
  v_expected_equivalent numeric;
begin
  if p_operation not in (
    'shopping-snapshot-create', 'shopping-leftover-set', 'shopping-product-select'
  ) or p_expected_revision < 0
    or octet_length(p_input_digest) <> 32
    or octet_length(p_snapshot_hash) <> 32
    or octet_length(p_key_digest) <> 32
    or octet_length(p_request_digest) <> 32
    or jsonb_typeof(p_snapshot) <> 'object'
    or octet_length(p_snapshot::text) > 4194304
    or jsonb_typeof(p_context) <> 'object'
    or jsonb_typeof(p_context -> 'leftovers') <> 'array'
    or jsonb_typeof(p_context -> 'selections') <> 'array'
    or cardinality(p_catalog_publication_ids) not between 1 and 3
    or cardinality(p_catalog_publication_ids) <> (
      select count(distinct publication_id)::integer
      from unnest(p_catalog_publication_ids) publication_id
    )
  then
    raise exception using errcode = '22023', message = 'invalid_shopping_snapshot';
  end if;

  select version.* into v_plan_version
  from public.plan_versions version where version.id = p_plan_version_id;
  if v_plan_version.id is null then
    raise exception using errcode = 'P0002', message = 'plan_version_not_found';
  end if;
  select plan.* into strict v_plan
  from public.plans plan where plan.id = v_plan_version.plan_id;
  v_profile_id := v_plan.profile_id;
  v_actor_id := private.require_questionnaire_access(
    p_auth_subject, p_auth_session_id, v_profile_id
  );

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('shopping-actor:' || v_actor_id::text, 0)
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('shopping-profile:' || v_profile_id::text, 0)
  );
  v_replay := private.get_plan_idempotency(
    v_actor_id, v_profile_id, p_operation, p_key_digest, p_request_digest
  );
  if v_replay is not null then return v_replay; end if;

  if v_plan.active_version_id is distinct from p_plan_version_id
    or v_plan_version.status <> 'active'
    or v_plan_version.validation_status <> 'valid'
  then
    raise exception using errcode = '40001', message = 'stale_plan_version';
  end if;

  select * into v_preference
  from public.shopping_preference_revisions preference
  where preference.id = p_preference_revision_id
    and preference.profile_id = v_profile_id
    and preference.lifecycle = 'active';
  if v_preference.id is null then
    raise exception using errcode = '40001', message = 'stale_shopping_preference';
  end if;
  if not exists (
    select 1 from private.basket_seed_revisions seed
    where seed.id = p_basket_seed_revision_id and seed.status = 'active'
  ) then
    raise exception using errcode = '40001', message = 'stale_basket_seed';
  end if;
  if exists (
    select 1 from unnest(p_catalog_publication_ids) publication_id
    where not exists (
      select 1 from private.catalog_publications publication
      where publication.id = publication_id
        and publication.hidden_at is null
        and publication.basket_seed_revision_id = p_basket_seed_revision_id
        and (
          (v_preference.mode = 'single')
          or publication.chain = any(v_preference.compared_chains)
        )
    )
  ) or not exists (
    select 1 from private.catalog_publications publication
    where publication.id = any(p_catalog_publication_ids)
      and publication.chain = v_preference.preferred_chain
  ) then
    raise exception using errcode = '40001', message = 'stale_catalog_publication';
  end if;

  select * into v_current from public.shopping_snapshots snapshot
  where snapshot.profile_id = v_profile_id
    and snapshot.plan_version_id = p_plan_version_id
    and snapshot.lifecycle = 'active'
  for update;
  if v_current.id is not null and v_current.input_digest = p_input_digest then
    v_response := jsonb_build_object(
      'schemaVersion', 1, 'snapshotId', v_current.id,
      'status', 'active', 'version', v_current.revision
    );
    perform private.store_plan_idempotency(
      v_actor_id, v_profile_id, p_operation,
      p_key_digest, p_request_digest, v_response
    );
    return v_response;
  end if;
  if coalesce(v_current.revision, 0) <> p_expected_revision then
    raise exception using errcode = '40001', message = 'stale_shopping_snapshot';
  end if;

  if p_snapshot ->> 'id' <> p_snapshot_id::text
    or p_snapshot ->> 'profileId' <> v_profile_id::text
    or p_snapshot ->> 'planVersionId' <> p_plan_version_id::text
    or p_snapshot ->> 'preferenceRevisionId' <> p_preference_revision_id::text
    or p_snapshot ->> 'basketSeedRevisionId' <> p_basket_seed_revision_id::text
    or (p_snapshot ->> 'revision')::integer <> p_expected_revision + 1
    or p_snapshot ->> 'supersedesId' is distinct from v_current.id::text
    or p_snapshot ->> 'resolverVersion' <> p_resolver_version
    or p_snapshot ->> 'inputDigest' <> encode(p_input_digest, 'hex')
    or p_snapshot ? 'status'
    or (
      select array_agg(value::uuid order by value::uuid)
      from jsonb_array_elements_text(p_snapshot -> 'catalogPublicationIds') value
    ) is distinct from (
      select array_agg(value order by value) from unnest(p_catalog_publication_ids) value
    )
  then
    raise exception using errcode = '22023', message = 'shopping_snapshot_identity_mismatch';
  end if;

  for v_item in select value from jsonb_array_elements(p_context -> 'leftovers')
  loop
    if jsonb_typeof(v_item -> 'declaredMeasure') <> 'object'
      or (v_item ->> 'confirmedEquivalentG')::numeric <= 0
      or not exists (
        select 1 from jsonb_array_elements(p_snapshot -> 'items') snapshot_item
        where snapshot_item ->> 'canonicalFoodKey' = v_item ->> 'canonicalFoodKey'
      )
    then
      raise exception using errcode = '22023', message = 'invalid_shopping_leftover';
    end if;
    if v_item ->> 'carriedFromId' is not null then
      if v_current.id is null or not exists (
        select 1 from public.shopping_leftover_confirmations leftover
        where leftover.id = (v_item ->> 'carriedFromId')::uuid
          and leftover.snapshot_id = v_current.id
          and leftover.canonical_food_key = v_item ->> 'canonicalFoodKey'
          and leftover.confirmed_equivalent_g =
            (v_item ->> 'confirmedEquivalentG')::numeric
          and leftover.declared_measure = v_item -> 'declaredMeasure'
          and leftover.sku_id is not distinct from
            nullif(v_item ->> 'skuId', '')::uuid
      ) then
        raise exception using errcode = '22023', message = 'invalid_carried_leftover';
      end if;
      continue;
    end if;
    if v_item #>> '{declaredMeasure,dimension}' = 'mass' then
      if v_item #>> '{declaredMeasure,unit}' <> 'g'
        or v_item ->> 'skuId' is not null
        or (v_item ->> 'confirmedEquivalentG')::numeric <>
          (v_item #>> '{declaredMeasure,quantity}')::numeric
      then
        raise exception using errcode = '22023', message = 'invalid_shopping_leftover';
      end if;
    else
      select (v_item #>> '{declaredMeasure,quantity}')::numeric
          * sku_revision.equivalent_edible_mass_g
          / (sku_revision.package #>> '{saleMeasure,quantity}')::numeric
      into v_expected_equivalent
      from private.catalog_publications publication
      join private.supermarket_sku_revisions sku_revision
        on sku_revision.catalog_revision_id = publication.catalog_revision_id
      join private.supermarket_sku_matching_rule_revisions rule
        on rule.sku_id = sku_revision.sku_id and rule.status = 'active'
        and rule.match_state in ('exact', 'allowed')
        and rule.criteria ->> 'catalogRevisionId' = publication.catalog_revision_id::text
        and rule.criteria ->> 'skuContentHash' = encode(
          sku_revision.content_hash, 'hex'
        )
      join public.canonical_foods food on food.id = rule.canonical_food_id
      where publication.id = any(p_catalog_publication_ids)
        and sku_revision.sku_id = (v_item ->> 'skuId')::uuid
        and food.food_key = v_item ->> 'canonicalFoodKey'
        and sku_revision.equivalent_edible_mass_g is not null
        and sku_revision.equivalence_evidence is not null
        and sku_revision.package #>> '{saleMeasure,dimension}' =
          v_item #>> '{declaredMeasure,dimension}';
      if v_expected_equivalent is null
        or v_expected_equivalent <> (v_item ->> 'confirmedEquivalentG')::numeric
      then
        raise exception using errcode = '22023', message = 'invalid_shopping_equivalence';
      end if;
    end if;
  end loop;

  for v_item in select value from jsonb_array_elements(p_context -> 'selections')
  loop
    if not exists (
      select 1 from jsonb_array_elements(p_snapshot -> 'items') snapshot_item
      where snapshot_item ->> 'canonicalFoodKey' = v_item ->> 'canonicalFoodKey'
    ) then
      raise exception using errcode = '22023', message = 'invalid_shopping_selection';
    end if;
    if v_item ->> 'carriedFromId' is not null then
      if v_current.id is null or not exists (
        select 1 from public.shopping_product_selection_confirmations selection
        where selection.id = (v_item ->> 'carriedFromId')::uuid
          and selection.snapshot_id = v_current.id
          and selection.canonical_food_key = v_item ->> 'canonicalFoodKey'
          and selection.sku_id = (v_item ->> 'skuId')::uuid
      ) then
        raise exception using errcode = '22023', message = 'invalid_carried_selection';
      end if;
    elsif not exists (
      select 1
      from private.catalog_publications publication
      join private.supermarket_sku_revisions sku_revision
        on sku_revision.catalog_revision_id = publication.catalog_revision_id
      join private.supermarket_sku_matching_rule_revisions rule
        on rule.sku_id = sku_revision.sku_id and rule.status = 'active'
        and rule.match_state in ('exact', 'allowed')
        and rule.criteria ->> 'catalogRevisionId' = publication.catalog_revision_id::text
        and rule.criteria ->> 'skuContentHash' = encode(
          sku_revision.content_hash, 'hex'
        )
      join public.canonical_foods food on food.id = rule.canonical_food_id
      where publication.id = any(p_catalog_publication_ids)
        and sku_revision.sku_id = (v_item ->> 'skuId')::uuid
        and food.food_key = v_item ->> 'canonicalFoodKey'
        and sku_revision.usability = 'calculable'
        and sku_revision.package is not null
        and sku_revision.base_price_eur is not null
        and jsonb_array_length(sku_revision.exclusion_reasons) = 0
    ) then
      raise exception using errcode = '22023', message = 'shopping_selection_not_eligible';
    end if;
  end loop;

  if v_current.id is not null then
    update public.shopping_snapshots
    set lifecycle = 'archived', archived_at = clock_timestamp()
    where id = v_current.id;
  end if;
  insert into public.shopping_snapshots (
    id, profile_id, plan_version_id, preference_revision_id,
    basket_seed_revision_id, revision, supersedes_id, input_digest,
    snapshot_hash, resolver_version, snapshot, created_by, created_at
  ) values (
    p_snapshot_id, v_profile_id, p_plan_version_id, p_preference_revision_id,
    p_basket_seed_revision_id, p_expected_revision + 1, v_current.id,
    p_input_digest, p_snapshot_hash, p_resolver_version, p_snapshot,
    v_actor_id, (p_snapshot ->> 'createdAt')::timestamptz
  );
  insert into public.shopping_snapshot_publications (
    snapshot_id, catalog_publication_id
  ) select p_snapshot_id, publication_id
    from unnest(p_catalog_publication_ids) publication_id;

  insert into public.shopping_leftover_confirmations (
    snapshot_id, canonical_food_key, declared_measure, confirmed_equivalent_g,
    sku_id, evidence_ref, confirmed_by, carried_from_id
  ) select p_snapshot_id, item ->> 'canonicalFoodKey',
    item -> 'declaredMeasure', (item ->> 'confirmedEquivalentG')::numeric,
    nullif(item ->> 'skuId', '')::uuid, item ->> 'evidenceRef', v_actor_id,
    nullif(item ->> 'carriedFromId', '')::uuid
  from jsonb_array_elements(p_context -> 'leftovers') item;

  insert into public.shopping_product_selection_confirmations (
    snapshot_id, canonical_food_key, sku_id, confirmed_by, carried_from_id
  ) select p_snapshot_id, item ->> 'canonicalFoodKey',
    (item ->> 'skuId')::uuid, v_actor_id,
    nullif(item ->> 'carriedFromId', '')::uuid
  from jsonb_array_elements(p_context -> 'selections') item;

  v_response := jsonb_build_object(
    'schemaVersion', 1, 'snapshotId', p_snapshot_id,
    'status', 'active', 'version', p_expected_revision + 1
  );
  perform private.store_plan_idempotency(
    v_actor_id, v_profile_id, p_operation,
    p_key_digest, p_request_digest, v_response
  );
  return v_response;
end;
$$;

create function private.list_shopping_catalog(
  p_auth_subject uuid,
  p_auth_session_id uuid,
  p_chain text,
  p_cursor_publication_id uuid,
  p_cursor_sku_id uuid,
  p_limit integer,
  p_ip_digest bytea
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_actor_id uuid;
  v_device_session_id uuid;
  v_has_more boolean;
  v_items jsonb;
  v_publication private.catalog_publications%rowtype;
  v_seed_id uuid;
begin
  select session.actor_id, session.device_session_id
  into v_actor_id, v_device_session_id
  from private.require_internal_device_session(
    p_auth_subject, p_auth_session_id
  ) session;
  if p_chain not in ('mercadona', 'dia', 'aldi')
    or p_limit not between 1 and 100
    or octet_length(p_ip_digest) <> 32
    or not exists (
      select 1 from public.profile_access access
      where access.actor_id = v_actor_id and access.revoked_at is null
        and private.actor_has_profile_access(
          v_actor_id, v_device_session_id, access.profile_id
        )
    )
  then
    raise exception using errcode = '42501', message = 'profile_access_denied';
  end if;
  perform private.consume_shopping_rate_limit(
    v_actor_id, null, 'catalog-read', null, p_ip_digest
  );
  select seed.id into v_seed_id from private.basket_seed_revisions seed
  where seed.status = 'active';
  if v_seed_id is null then
    raise exception using errcode = '55000', message = 'active_basket_seed_required';
  end if;
  select * into v_publication from private.catalog_publications publication
  where publication.chain = p_chain
    and publication.basket_seed_revision_id = v_seed_id
    and publication.hidden_at is null;
  if v_publication.id is null then
    raise exception using errcode = '55000', message = 'catalog_not_published';
  end if;
  if p_cursor_publication_id is not null
    and p_cursor_publication_id <> v_publication.id
  then
    raise exception using errcode = '22023', message = 'stale_catalog_cursor';
  end if;

  with rows as (
    select sku.id sku_id, sku.external_sku, sku.gtin14,
      sku_revision.name, sku_revision.category_path, sku_revision.format_text,
      sku_revision.purchase_form, sku_revision.package,
      sku_revision.base_price_eur, sku_revision.normalized_price,
      sku_revision.usability, sku_revision.exclusion_reasons
    from private.supermarket_sku_revisions sku_revision
    join private.supermarket_skus sku on sku.id = sku_revision.sku_id
    where sku_revision.catalog_revision_id = v_publication.catalog_revision_id
      and (p_cursor_sku_id is null or sku.id > p_cursor_sku_id)
    order by sku.id
    limit p_limit + 1
  ), page as (
    select * from rows order by sku_id limit p_limit
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'basePriceEur', private.shopping_decimal_text(page.base_price_eur),
    'categoryPath', page.category_path,
    'chain', p_chain,
    'exclusionReasons', page.exclusion_reasons,
    'externalSku', page.external_sku,
    'formatText', page.format_text,
    'gtin14', page.gtin14,
    'market', 'ES',
    'name', page.name,
    'normalizedPrice', page.normalized_price,
    'package', page.package,
    'purchaseForm', page.purchase_form,
    'schemaVersion', 1,
    'skuId', page.sku_id,
    'usability', page.usability
  ) order by page.sku_id), '[]'::jsonb),
    (select count(*) > p_limit from rows)
  into v_items, v_has_more
  from page;
  return jsonb_build_object(
    'publicationId', v_publication.id,
    'items', v_items,
    'hasMore', coalesce(v_has_more, false)
  );
end;
$$;

create function public.internal_get_shopping_preference(
  p_auth_subject uuid,
  p_auth_session_id uuid,
  p_profile_id uuid
)
returns jsonb
language sql
security definer
set search_path = pg_catalog
as $$
  select private.get_shopping_preference(
    p_auth_subject, p_auth_session_id, p_profile_id
  )
$$;

create function public.internal_put_shopping_preference(
  p_auth_subject uuid,
  p_auth_session_id uuid,
  p_profile_id uuid,
  p_preferred_chain text,
  p_mode text,
  p_compared_chains text[],
  p_sorting text,
  p_expected_version integer,
  p_key_digest bytea,
  p_request_digest bytea
)
returns jsonb
language sql
security definer
set search_path = pg_catalog
as $$
  select private.put_shopping_preference(
    p_auth_subject, p_auth_session_id, p_profile_id, p_preferred_chain,
    p_mode, p_compared_chains, p_sorting, p_expected_version,
    p_key_digest, p_request_digest
  )
$$;

create function public.internal_prepare_shopping_resolution(
  p_auth_subject uuid,
  p_auth_session_id uuid,
  p_plan_version_id uuid,
  p_base_snapshot_id uuid,
  p_operation text,
  p_mutation jsonb,
  p_key_digest bytea,
  p_request_digest bytea,
  p_ip_digest bytea
)
returns jsonb
language sql
security definer
set search_path = pg_catalog
as $$
  select private.prepare_shopping_resolution(
    p_auth_subject, p_auth_session_id, p_plan_version_id, p_base_snapshot_id,
    p_operation, p_mutation, p_key_digest, p_request_digest, p_ip_digest
  )
$$;

create function public.internal_persist_shopping_resolution(
  p_auth_subject uuid,
  p_auth_session_id uuid,
  p_plan_version_id uuid,
  p_snapshot_id uuid,
  p_preference_revision_id uuid,
  p_basket_seed_revision_id uuid,
  p_expected_revision integer,
  p_input_digest bytea,
  p_snapshot_hash bytea,
  p_resolver_version text,
  p_snapshot jsonb,
  p_catalog_publication_ids uuid[],
  p_context jsonb,
  p_operation text,
  p_key_digest bytea,
  p_request_digest bytea
)
returns jsonb
language sql
security definer
set search_path = pg_catalog
as $$
  select private.persist_shopping_resolution(
    p_auth_subject, p_auth_session_id, p_plan_version_id, p_snapshot_id,
    p_preference_revision_id, p_basket_seed_revision_id, p_expected_revision,
    p_input_digest, p_snapshot_hash, p_resolver_version, p_snapshot,
    p_catalog_publication_ids, p_context, p_operation,
    p_key_digest, p_request_digest
  )
$$;

create function public.internal_get_shopping_snapshot(
  p_auth_subject uuid,
  p_auth_session_id uuid,
  p_snapshot_id uuid
)
returns jsonb
language sql
security definer
set search_path = pg_catalog
as $$
  select private.get_shopping_snapshot(
    p_auth_subject, p_auth_session_id, p_snapshot_id
  )
$$;

create function public.internal_list_shopping_catalog(
  p_auth_subject uuid,
  p_auth_session_id uuid,
  p_chain text,
  p_cursor_publication_id uuid,
  p_cursor_sku_id uuid,
  p_limit integer,
  p_ip_digest bytea
)
returns jsonb
language sql
security definer
set search_path = pg_catalog
as $$
  select private.list_shopping_catalog(
    p_auth_subject, p_auth_session_id, p_chain, p_cursor_publication_id,
    p_cursor_sku_id, p_limit, p_ip_digest
  )
$$;

create or replace function private.purge_profile_after_deletion_job()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  if new.status = 'purged' and new.profile_id is not null then
    if exists (
      select 1 from private.export_artifacts artifact
      where artifact.profile_id = new.profile_id
    ) then
      raise exception using errcode = '55000', message = 'export_purge_incomplete';
    end if;

    delete from public.shopping_leftover_confirmations leftover
    where leftover.snapshot_id in (
      select snapshot.id from public.shopping_snapshots snapshot
      where snapshot.profile_id = new.profile_id
    );
    delete from public.shopping_product_selection_confirmations selection
    where selection.snapshot_id in (
      select snapshot.id from public.shopping_snapshots snapshot
      where snapshot.profile_id = new.profile_id
    );
    delete from public.shopping_snapshot_publications relation
    where relation.snapshot_id in (
      select snapshot.id from public.shopping_snapshots snapshot
      where snapshot.profile_id = new.profile_id
    );
    delete from public.shopping_snapshots snapshot
    where snapshot.profile_id = new.profile_id;
    delete from public.shopping_preference_revisions preference
    where preference.profile_id = new.profile_id;
    delete from private.shopping_rate_limit_events event
    where event.profile_id = new.profile_id;
    delete from private.plan_idempotency entry
    where entry.profile_id = new.profile_id
      and entry.operation in (
        'shopping-preference-put', 'shopping-snapshot-create',
        'shopping-leftover-set', 'shopping-product-select'
      );

    delete from public.profiles
    where id = new.profile_id and status = 'deletion_requested';
    if not found then
      raise exception using
        errcode = '55000', message = 'profile_not_deletion_requested';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function private.consume_shopping_rate_limit(
  uuid, uuid, text, bytea, bytea
) from public, anon, authenticated, service_role;
revoke all on function private.shopping_decimal_text(numeric)
from public, anon, authenticated, service_role;
revoke all on function private.get_shopping_preference(uuid,uuid,uuid)
from public, anon, authenticated, service_role;
revoke all on function private.put_shopping_preference(
  uuid,uuid,uuid,text,text,text[],text,integer,bytea,bytea
) from public, anon, authenticated, service_role;
revoke all on function private.get_shopping_snapshot(uuid,uuid,uuid)
from public, anon, authenticated, service_role;
revoke all on function private.shopping_catalog_items(uuid,text[],boolean)
from public, anon, authenticated, service_role;
revoke all on function private.prepare_shopping_resolution(
  uuid,uuid,uuid,uuid,text,jsonb,bytea,bytea,bytea
) from public, anon, authenticated, service_role;
revoke all on function private.persist_shopping_resolution(
  uuid,uuid,uuid,uuid,uuid,uuid,integer,bytea,bytea,text,jsonb,uuid[],jsonb,
  text,bytea,bytea
) from public, anon, authenticated, service_role;
revoke all on function private.list_shopping_catalog(
  uuid,uuid,text,uuid,uuid,integer,bytea
) from public, anon, authenticated, service_role;

revoke all on function public.internal_get_shopping_preference(uuid,uuid,uuid)
from public, anon, authenticated;
revoke all on function public.internal_put_shopping_preference(
  uuid,uuid,uuid,text,text,text[],text,integer,bytea,bytea
) from public, anon, authenticated;
revoke all on function public.internal_prepare_shopping_resolution(
  uuid,uuid,uuid,uuid,text,jsonb,bytea,bytea,bytea
) from public, anon, authenticated;
revoke all on function public.internal_persist_shopping_resolution(
  uuid,uuid,uuid,uuid,uuid,uuid,integer,bytea,bytea,text,jsonb,uuid[],jsonb,
  text,bytea,bytea
) from public, anon, authenticated;
revoke all on function public.internal_get_shopping_snapshot(uuid,uuid,uuid)
from public, anon, authenticated;
revoke all on function public.internal_list_shopping_catalog(
  uuid,uuid,text,uuid,uuid,integer,bytea
) from public, anon, authenticated;

grant execute on function public.internal_get_shopping_preference(uuid,uuid,uuid)
to service_role;
grant execute on function public.internal_put_shopping_preference(
  uuid,uuid,uuid,text,text,text[],text,integer,bytea,bytea
) to service_role;
grant execute on function public.internal_prepare_shopping_resolution(
  uuid,uuid,uuid,uuid,text,jsonb,bytea,bytea,bytea
) to service_role;
grant execute on function public.internal_persist_shopping_resolution(
  uuid,uuid,uuid,uuid,uuid,uuid,integer,bytea,bytea,text,jsonb,uuid[],jsonb,
  text,bytea,bytea
) to service_role;
grant execute on function public.internal_get_shopping_snapshot(uuid,uuid,uuid)
to service_role;
grant execute on function public.internal_list_shopping_catalog(
  uuid,uuid,text,uuid,uuid,integer,bytea
) to service_role;
