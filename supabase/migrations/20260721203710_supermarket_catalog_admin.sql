alter table private.catalog_publications
  add column version integer not null default 1 check (version >= 1);

alter table private.audit_outbox drop constraint if exists audit_outbox_action_check;
alter table private.audit_outbox add constraint audit_outbox_action_check check (
  action in (
    'access_reset',
    'ai_provider_revision_activate',
    'audit_range_delete',
    'backup_create',
    'barcode_correction_approve',
    'barcode_correction_correct',
    'barcode_correction_reject',
    'catalog_match_candidates_generate',
    'catalog_publication_hide',
    'catalog_revision_publish',
    'impersonation_end',
    'impersonation_start',
    'invitation_create',
    'invitation_revoke',
    'matching_rule_activate',
    'matching_rule_review',
    'profile_delete_permanent',
    'profile_update',
    'restore_create',
    'restore_promote',
    'rule_set_activate'
  )
);

create table private.supermarket_catalog_admin_idempotency (
  request_id uuid primary key,
  actor_id uuid not null references public.actors (id) on delete restrict,
  operation text not null check (
    operation in (
      'catalog-match-candidates',
      'matching-rule-review',
      'matching-rule-activate',
      'catalog-revision-publish',
      'catalog-publication-hide'
    )
  ),
  target_id uuid not null,
  request_digest bytea not null check (octet_length(request_digest) = 32),
  response jsonb not null check (
    jsonb_typeof(response) = 'object' and octet_length(response::text) <= 16384
  ),
  created_at timestamptz not null default clock_timestamp()
);

alter table private.supermarket_catalog_admin_idempotency enable row level security;
revoke all on table private.supermarket_catalog_admin_idempotency
from public, anon, authenticated, service_role;

create table private.supermarket_match_generation_marks (
  catalog_revision_id uuid not null
    references private.supermarket_catalog_revisions (id) on delete restrict,
  basket_seed_revision_id uuid not null
    references private.basket_seed_revisions (id) on delete restrict,
  sku_id uuid not null references private.supermarket_skus (id) on delete restrict,
  sku_content_hash bytea not null check (octet_length(sku_content_hash) = 32),
  processed_by uuid not null references public.actors (id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  primary key (catalog_revision_id, basket_seed_revision_id, sku_id)
);

alter table private.supermarket_match_generation_marks enable row level security;
revoke all on table private.supermarket_match_generation_marks
from public, anon, authenticated, service_role;

create function private.admin_supermarket_replay(
  p_request_id uuid,
  p_actor_id uuid,
  p_operation text,
  p_target_id uuid,
  p_request_digest bytea
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_existing private.supermarket_catalog_admin_idempotency%rowtype;
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_actor_id::text || ':' || p_request_id::text, 0)
  );
  select * into v_existing
  from private.supermarket_catalog_admin_idempotency existing
  where existing.request_id = p_request_id;
  if v_existing.request_id is null then return null; end if;
  if v_existing.actor_id <> p_actor_id
    or v_existing.operation <> p_operation
    or v_existing.target_id <> p_target_id
    or v_existing.request_digest <> p_request_digest
  then
    raise exception using errcode = '23505', message = 'idempotency_conflict';
  end if;
  return v_existing.response;
end;
$$;

create function private.admin_supermarket_store_idempotency(
  p_request_id uuid,
  p_actor_id uuid,
  p_operation text,
  p_target_id uuid,
  p_request_digest bytea,
  p_response jsonb
)
returns void
language sql
security definer
set search_path = pg_catalog
as $$
  insert into private.supermarket_catalog_admin_idempotency (
    request_id, actor_id, operation, target_id, request_digest, response
  ) values (
    p_request_id, p_actor_id, p_operation, p_target_id, p_request_digest, p_response
  )
$$;

create function private.admin_supermarket_effective_profile(
  p_auth_session_id uuid,
  p_actor_id uuid
)
returns uuid
language sql
security definer
set search_path = pg_catalog
as $$
  select coalesce(
    (
      select impersonation.effective_profile_id
      from private.impersonation_sessions impersonation
      where impersonation.auth_session_id = p_auth_session_id
        and impersonation.ended_at is null
      order by impersonation.started_at desc
      limit 1
    ),
    p_actor_id
  )
$$;

create function private.record_supermarket_admin_intent(
  p_actor_id uuid,
  p_effective_profile_id uuid,
  p_action text,
  p_target_type text,
  p_target_id uuid,
  p_request_id uuid,
  p_previous_state_hash bytea,
  p_new_state_hash bytea,
  p_external_sequence bigint,
  p_external_timestamp timestamptz,
  p_external_record_hash bytea,
  p_external_receipt_signature bytea,
  p_external_key_version integer,
  p_external_idempotency_hash bytea
)
returns void
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_event_id uuid;
begin
  perform private.validate_admin_intent(
    p_external_sequence, p_external_timestamp, p_external_record_hash,
    p_external_receipt_signature, p_external_key_version,
    p_external_idempotency_hash
  );
  if not (
    (p_action = 'catalog_match_candidates_generate' and p_target_type = 'catalog_revision')
    or (p_action = 'matching_rule_review' and p_target_type = 'product_matching_rule')
    or (p_action = 'matching_rule_activate' and p_target_type = 'product_matching_rule')
    or (p_action = 'catalog_revision_publish' and p_target_type = 'catalog_revision')
    or (p_action = 'catalog_publication_hide' and p_target_type = 'catalog_publication')
  ) then
    raise exception using errcode = '22023', message = 'invalid_supermarket_admin_action';
  end if;
  insert into private.technical_audit_events (
    actor_id, action, target_type, target_id, result, request_id, phase,
    original_actor_id, effective_profile_id, external_sequence,
    external_timestamp, external_record_hash, external_receipt_signature,
    external_key_version, external_idempotency_hash, previous_state_hash,
    new_state_hash
  ) values (
    p_actor_id, p_action, p_target_type, p_target_id, 'pending', p_request_id,
    'intent', p_actor_id, p_effective_profile_id, p_external_sequence,
    p_external_timestamp, p_external_record_hash, p_external_receipt_signature,
    p_external_key_version, p_external_idempotency_hash, p_previous_state_hash,
    p_new_state_hash
  ) returning id into v_event_id;
  insert into private.audit_outbox (
    technical_audit_event_id, request_id, original_actor_id,
    effective_profile_id, action, target_type, target_id
  ) values (
    v_event_id, p_request_id, p_actor_id, p_effective_profile_id,
    p_action, p_target_type, p_target_id
  );
end;
$$;

create function private.admin_supermarket_audit_context(
  p_auth_subject uuid,
  p_auth_session_id uuid,
  p_action text,
  p_target_id uuid
)
returns table (
  original_actor_id uuid,
  effective_profile_id uuid,
  audit_target_id uuid,
  audit_target_type text,
  mutation_scope text
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_actor_id uuid;
begin
  v_actor_id := private.require_superadmin_aal2(p_auth_subject, p_auth_session_id);
  if p_action in ('matching_rule_review', 'matching_rule_activate') then
    if not exists (
      select 1 from private.supermarket_sku_matching_rule_revisions rule
      where rule.id = p_target_id
    ) then
      raise exception using errcode = '22023', message = 'matching_rule_not_found';
    end if;
    return query select v_actor_id,
      private.admin_supermarket_effective_profile(p_auth_session_id, v_actor_id),
      p_target_id, 'product_matching_rule'::text, 'supermarket'::text;
    return;
  end if;
  if p_action = 'catalog_match_candidates_generate' then
    if not exists (
      select 1 from private.supermarket_catalog_revisions revision
      where revision.id = p_target_id
    ) then
      raise exception using errcode = '22023', message = 'catalog_revision_not_found';
    end if;
    return query select v_actor_id,
      private.admin_supermarket_effective_profile(p_auth_session_id, v_actor_id),
      p_target_id, 'catalog_revision'::text, 'supermarket'::text;
    return;
  end if;
  if p_action = 'catalog_revision_publish' then
    if not exists (
      select 1 from private.supermarket_catalog_revisions revision
      where revision.id = p_target_id
    ) then
      raise exception using errcode = '22023', message = 'catalog_revision_not_found';
    end if;
    return query select v_actor_id,
      private.admin_supermarket_effective_profile(p_auth_session_id, v_actor_id),
      p_target_id, 'catalog_revision'::text, 'supermarket'::text;
    return;
  end if;
  if p_action = 'catalog_publication_hide' then
    if not exists (
      select 1 from private.catalog_publications publication
      where publication.id = p_target_id
    ) then
      raise exception using errcode = '22023', message = 'catalog_publication_not_found';
    end if;
    return query select v_actor_id,
      private.admin_supermarket_effective_profile(p_auth_session_id, v_actor_id),
      p_target_id, 'catalog_publication'::text, 'supermarket'::text;
    return;
  end if;
  raise exception using errcode = '22023', message = 'invalid_supermarket_admin_action';
end;
$$;

create function private.list_admin_supermarket_catalog_revisions(
  p_auth_subject uuid,
  p_auth_session_id uuid,
  p_chain text,
  p_state text,
  p_cursor uuid,
  p_limit integer
)
returns table (
  catalog_revision_id uuid,
  chain text,
  revision_number integer,
  state text,
  quality_status text,
  record_count integer,
  usable_count integer,
  error_count integer,
  license_status text,
  source_terms_status text,
  catalog_hash bytea,
  basket_seed_revision_id uuid,
  basket_seed_hash bytea,
  coverage jsonb,
  coverage_hash bytea,
  active_publication_id uuid,
  publication_version integer
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  perform private.require_superadmin_aal2(p_auth_subject, p_auth_session_id);
  if (p_chain is not null and p_chain not in ('mercadona', 'dia', 'aldi'))
    or (p_state is not null and p_state not in (
      'quarantine', 'review', 'publishable', 'published', 'hidden'
    ))
    or p_limit is null or p_limit < 1 or p_limit > 51
  then
    raise exception using errcode = '22023', message = 'invalid_catalog_admin_query';
  end if;

  return query
  with active_seed as (
    select seed.id, seed.calculation_hash
    from private.basket_seed_revisions seed
    where seed.status = 'active'
    limit 1
  ), source_rows as (
    select revision.id catalog_revision_id, revision.chain,
      revision.revision_number, revision.quality_status, revision.usable_count,
      revision.created_at, manifest.record_count, manifest.error_count,
      manifest.license_status, manifest.source_terms_status,
      manifest.normalized_sha256 catalog_hash, seed.id basket_seed_revision_id,
      seed.calculation_hash basket_seed_hash,
      case when seed.id is null then null else
        private.supermarket_catalog_publication_context(revision.id, seed.id)
      end publication_context,
      active_publication.id active_publication_id,
      active_publication.version publication_version,
      exists (
        select 1 from private.catalog_publications historical
        where historical.catalog_revision_id = revision.id
          and historical.hidden_at is not null
      ) was_hidden
    from private.supermarket_catalog_revisions revision
    join private.supermarket_source_manifests manifest
      on manifest.id = revision.manifest_id
    left join active_seed seed on true
    left join private.catalog_publications active_publication
      on active_publication.catalog_revision_id = revision.id
      and active_publication.hidden_at is null
    where (p_chain is null or revision.chain = p_chain)
      and (
        p_cursor is null
        or (revision.created_at, revision.id) < (
          select cursor_revision.created_at, cursor_revision.id
          from private.supermarket_catalog_revisions cursor_revision
          where cursor_revision.id = p_cursor
        )
      )
  ), derived as (
    select source_rows.*,
      case
        when source_rows.active_publication_id is not null then 'published'
        when source_rows.was_hidden then 'hidden'
        when source_rows.quality_status = 'degraded' then 'review'
        when source_rows.publication_context is null then 'quarantine'
        when source_rows.publication_context ->> 'licenseStatus' = 'unknown'
          or source_rows.publication_context ->> 'sourceTermsStatus' = 'unknown'
          then 'review'
        when (source_rows.publication_context #>> '{coverage,publishable}')::boolean
          then 'publishable'
        else 'review'
      end derived_state
    from source_rows
  )
  select derived.catalog_revision_id, derived.chain, derived.revision_number,
    derived.derived_state, derived.quality_status, derived.record_count,
    derived.usable_count, derived.error_count, derived.license_status,
    derived.source_terms_status, derived.catalog_hash,
    derived.basket_seed_revision_id, derived.basket_seed_hash,
    derived.publication_context -> 'coverage',
    case when derived.publication_context is null then null else
      decode(derived.publication_context ->> 'coverageHash', 'hex') end,
    derived.active_publication_id, derived.publication_version
  from derived
  where p_state is null or derived.derived_state = p_state
  order by derived.created_at desc, derived.catalog_revision_id desc
  limit p_limit;
end;
$$;

create function private.admin_supermarket_match_inputs(
  p_auth_subject uuid,
  p_auth_session_id uuid,
  p_catalog_revision_id uuid,
  p_expected_version integer
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_revision private.supermarket_catalog_revisions%rowtype;
  v_seed_id uuid;
begin
  perform private.require_superadmin_aal2(p_auth_subject, p_auth_session_id);
  select * into v_revision
  from private.supermarket_catalog_revisions revision
  where revision.id = p_catalog_revision_id
  for share;
  if v_revision.id is null then
    raise exception using errcode = '22023', message = 'catalog_revision_not_found';
  end if;
  if v_revision.revision_number <> p_expected_version then
    raise exception using errcode = '40001', message = 'stale_catalog_revision';
  end if;
  select seed.id into v_seed_id
  from private.basket_seed_revisions seed
  where seed.status = 'active'
  for share;
  if v_seed_id is null then
    raise exception using errcode = '55000', message = 'active_basket_seed_required';
  end if;
  return jsonb_build_object(
    'basketSeedRevisionId', v_seed_id,
    'skus', coalesce((
      select jsonb_agg(jsonb_build_object(
        'skuId', source.sku_id,
        'skuContentHash', encode(source.content_hash, 'hex'),
        'externalSku', source.external_sku,
        'name', source.name,
        'categoryPath', source.category_path,
        'formatText', source.format_text,
        'purchaseForm', source.purchase_form,
        'foodState', case
          when source.source_fields ->> 'foodState' in ('raw', 'cooked', 'unspecified')
            then source.source_fields ->> 'foodState'
          else 'unspecified'
        end,
        'ingredients', '[]'::jsonb,
        'excludedTerms', '[]'::jsonb,
        'allergenData', 'unknown',
        'crossContactData', 'unknown',
        'gtinFoodKey', source.gtin_food_key
      ) order by source.sku_id)
      from (
        select sku_revision.sku_id, sku_revision.content_hash,
          sku.external_sku, sku_revision.name,
          sku_revision.category_path, sku_revision.format_text,
          sku_revision.purchase_form, sku_revision.source_fields,
          (
            select canonical.food_key
            from public.commercial_products product
            join public.product_matching_rule_revisions product_rule
              on product_rule.product_id = product.id and product_rule.status = 'active'
            join public.canonical_foods canonical
              on canonical.id = product_rule.canonical_food_id
            where product.gtin14 = sku.gtin14
            limit 1
          ) gtin_food_key
        from private.supermarket_sku_revisions sku_revision
        join private.supermarket_skus sku on sku.id = sku_revision.sku_id
        where sku_revision.catalog_revision_id = p_catalog_revision_id
          and not exists (
            select 1 from private.supermarket_match_generation_marks mark
            where mark.catalog_revision_id = sku_revision.catalog_revision_id
              and mark.basket_seed_revision_id = v_seed_id
              and mark.sku_id = sku_revision.sku_id
          )
        order by sku_revision.sku_id
        limit 250
      ) source
    ), '[]'::jsonb),
    'targets', coalesce((
      select jsonb_agg(jsonb_build_object(
        'canonicalFoodKey', food.food_key,
        'categoryTerms', jsonb_build_array(food.category),
        'ediblePart', item.edible_part,
        'foodState', item.food_state,
        'name', food.name,
        'purchaseForm', item.purchase_form
      ) order by food.food_key)
      from private.basket_seed_revisions seed
      join private.basket_seed_items item on item.basket_seed_revision_id = seed.id
      join public.canonical_foods food on food.id = item.canonical_food_id
      where seed.id = v_seed_id and food.active is true
    ), '[]'::jsonb)
  );
end;
$$;

create function private.generate_admin_supermarket_match_candidates(
  p_auth_subject uuid,
  p_auth_session_id uuid,
  p_catalog_revision_id uuid,
  p_expected_version integer,
  p_basket_seed_revision_id uuid,
  p_candidates jsonb,
  p_processed_skus jsonb,
  p_request_id uuid,
  p_external_sequence bigint,
  p_external_timestamp timestamptz,
  p_external_record_hash bytea,
  p_external_receipt_signature bytea,
  p_external_key_version integer,
  p_external_idempotency_hash bytea
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_actor_id uuid;
  v_batch_hash bytea;
  v_candidate jsonb;
  v_count integer := 0;
  v_digest bytea;
  v_new_hash bytea;
  v_previous_hash bytea;
  v_response jsonb;
  v_revision private.supermarket_catalog_revisions%rowtype;
  v_seed private.basket_seed_revisions%rowtype;
begin
  v_actor_id := private.require_superadmin_aal2(p_auth_subject, p_auth_session_id);
  if jsonb_typeof(p_candidates) <> 'array'
    or jsonb_array_length(p_candidates) > 1000
    or octet_length(p_candidates::text) > 1048576
    or jsonb_typeof(p_processed_skus) <> 'array'
    or jsonb_array_length(p_processed_skus) > 250
    or octet_length(p_processed_skus::text) > 65536
  then
    raise exception using errcode = '22023', message = 'invalid_match_candidates';
  end if;
  v_digest := extensions.digest(convert_to(jsonb_build_object(
    'basketSeedRevisionId', p_basket_seed_revision_id,
    'expectedVersion', p_expected_version
  )::text, 'utf8'), 'sha256');
  v_batch_hash := extensions.digest(convert_to(jsonb_build_object(
    'candidates', p_candidates, 'processedSkus', p_processed_skus
  )::text, 'utf8'), 'sha256');
  v_response := private.admin_supermarket_replay(
    p_request_id, v_actor_id, 'catalog-match-candidates',
    p_catalog_revision_id, v_digest
  );
  if v_response is not null then return v_response; end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'catalog-match-candidates:' || p_catalog_revision_id::text, 0
    )
  );

  select * into v_revision
  from private.supermarket_catalog_revisions revision
  where revision.id = p_catalog_revision_id
  for share;
  if v_revision.id is null then
    raise exception using errcode = '22023', message = 'catalog_revision_not_found';
  end if;
  if v_revision.revision_number <> p_expected_version then
    raise exception using errcode = '40001', message = 'stale_catalog_revision';
  end if;
  select * into v_seed
  from private.basket_seed_revisions seed
  where seed.id = p_basket_seed_revision_id
  for share;
  if v_seed.id is null or v_seed.status <> 'active' then
    raise exception using errcode = '40001', message = 'stale_basket_seed';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(p_processed_skus) processed
    join private.supermarket_match_generation_marks mark
      on mark.catalog_revision_id = p_catalog_revision_id
      and mark.basket_seed_revision_id = p_basket_seed_revision_id
      and mark.sku_id = (processed ->> 'skuId')::uuid
  ) then
    raise exception using errcode = '40001', message = 'stale_match_candidate_batch';
  end if;
  v_previous_hash := extensions.digest(convert_to(jsonb_build_object(
    'catalogRevisionId', v_revision.id, 'revisionNumber', v_revision.revision_number
  )::text, 'utf8'), 'sha256');

  for v_candidate in select value from jsonb_array_elements(p_candidates)
  loop
    if v_candidate ->> 'matchState' not in (
      'exact', 'allowed', 'review', 'excluded', 'insufficient'
    ) or v_candidate ->> 'foodState' not in ('raw', 'cooked', 'unspecified')
      or v_candidate ->> 'purchaseForm' not in (
        'dry', 'fresh', 'drained', 'canned', 'natural', 'prepared', 'marinated'
      )
      or jsonb_typeof(v_candidate -> 'criteria') <> 'array'
      or jsonb_typeof(v_candidate -> 'evidence') <> 'array'
      or jsonb_typeof(v_candidate -> 'exclusions') <> 'array'
      or not exists (
        select 1 from jsonb_array_elements(p_processed_skus) processed
        where processed ->> 'skuId' = v_candidate ->> 'skuId'
          and processed ->> 'skuContentHash' = v_candidate ->> 'skuContentHash'
      )
      or not exists (
        select 1 from private.supermarket_sku_revisions sku_revision
        where sku_revision.sku_id = (v_candidate ->> 'skuId')::uuid
          and sku_revision.catalog_revision_id = p_catalog_revision_id
      )
    then
      raise exception using errcode = '22023', message = 'invalid_match_candidate';
    end if;
    perform private.create_supermarket_matching_rule(
      (v_candidate ->> 'skuId')::uuid,
      v_candidate ->> 'canonicalFoodKey',
      v_candidate ->> 'matchState',
      v_candidate ->> 'foodState',
      v_candidate ->> 'purchaseForm',
      v_candidate ->> 'ediblePart',
      jsonb_build_object(
        'generator', 't17b-v1',
        'criteria', v_candidate -> 'criteria',
        'basketSeedRevisionId', p_basket_seed_revision_id,
        'catalogRevisionId', p_catalog_revision_id,
        'skuContentHash', v_candidate ->> 'skuContentHash'
      ),
      v_candidate -> 'evidence', v_candidate -> 'exclusions', v_actor_id
    );
    v_count := v_count + 1;
  end loop;

  insert into private.supermarket_match_generation_marks (
    catalog_revision_id, basket_seed_revision_id, sku_id,
    sku_content_hash, processed_by
  )
  select p_catalog_revision_id, p_basket_seed_revision_id,
    (processed ->> 'skuId')::uuid,
    decode(processed ->> 'skuContentHash', 'hex'), v_actor_id
  from jsonb_array_elements(p_processed_skus) processed
  join private.supermarket_sku_revisions sku_revision
    on sku_revision.sku_id = (processed ->> 'skuId')::uuid
    and sku_revision.catalog_revision_id = p_catalog_revision_id
    and sku_revision.content_hash = decode(processed ->> 'skuContentHash', 'hex')
  on conflict (catalog_revision_id, basket_seed_revision_id, sku_id) do nothing;
  if (select count(*) from jsonb_array_elements(p_processed_skus)) <> (
    select count(*) from private.supermarket_match_generation_marks mark
    where mark.catalog_revision_id = p_catalog_revision_id
      and mark.basket_seed_revision_id = p_basket_seed_revision_id
      and mark.sku_id in (
        select (processed ->> 'skuId')::uuid
        from jsonb_array_elements(p_processed_skus) processed
      )
  ) then
    raise exception using errcode = '22023', message = 'invalid_processed_skus';
  end if;

  v_response := jsonb_build_object(
    'schemaVersion', 1, 'catalogRevisionId', p_catalog_revision_id,
    'candidatesCreated', v_count,
    'hasMore', exists (
      select 1 from private.supermarket_sku_revisions sku_revision
      where sku_revision.catalog_revision_id = p_catalog_revision_id
        and not exists (
          select 1 from private.supermarket_match_generation_marks mark
          where mark.catalog_revision_id = p_catalog_revision_id
            and mark.basket_seed_revision_id = p_basket_seed_revision_id
            and mark.sku_id = sku_revision.sku_id
        )
    ),
    'skusProcessed', jsonb_array_length(p_processed_skus),
    'version', v_revision.revision_number
  );
  v_new_hash := extensions.digest(convert_to(jsonb_build_object(
    'catalogRevisionId', v_revision.id, 'candidatesCreated', v_count,
    'basketSeedRevisionId', p_basket_seed_revision_id,
    'candidatesDigest', encode(v_batch_hash, 'hex')
  )::text, 'utf8'), 'sha256');
  perform private.record_supermarket_admin_intent(
    v_actor_id,
    private.admin_supermarket_effective_profile(p_auth_session_id, v_actor_id),
    'catalog_match_candidates_generate', 'catalog_revision', v_revision.id,
    p_request_id, v_previous_hash, v_new_hash, p_external_sequence,
    p_external_timestamp, p_external_record_hash, p_external_receipt_signature,
    p_external_key_version, p_external_idempotency_hash
  );
  perform private.admin_supermarket_store_idempotency(
    p_request_id, v_actor_id, 'catalog-match-candidates',
    p_catalog_revision_id, v_digest, v_response
  );
  return v_response;
end;
$$;

create function private.list_admin_supermarket_matching_rules(
  p_auth_subject uuid,
  p_auth_session_id uuid,
  p_catalog_revision_id uuid,
  p_cursor uuid,
  p_limit integer
)
returns table (
  matching_rule_id uuid, version integer, status text, match_state text,
  chain text, external_sku text, sku_name text, canonical_food_key text,
  canonical_food_name text, food_state text, purchase_form text,
  gtin_consistency text, critical_issue_open boolean, reviewed boolean,
  reasons text[]
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  perform private.require_superadmin_aal2(p_auth_subject, p_auth_session_id);
  if p_limit < 1 or p_limit > 51 then
    raise exception using errcode = '22023', message = 'invalid_limit';
  end if;
  if not exists (
    select 1 from private.supermarket_catalog_revisions revision
    where revision.id = p_catalog_revision_id
  ) then
    raise exception using errcode = '22023', message = 'catalog_revision_not_found';
  end if;
  return query
  select rule.id, rule.version, rule.status, rule.match_state, sku.chain,
    sku.external_sku, sku_revision.name, food.food_key, food.name,
    rule.food_state, rule.purchase_form, rule.gtin_consistency,
    rule.critical_issue_open, rule.criteria ->> 'review' = 'superadmin',
    array(
      select reason
      from jsonb_array_elements_text(rule.evidence) reason
      where reason <> 'deterministic-candidate'
      limit 10
    )
  from private.supermarket_sku_matching_rule_revisions rule
  join private.supermarket_skus sku on sku.id = rule.sku_id
  join private.supermarket_sku_revisions sku_revision
    on sku_revision.sku_id = sku.id
    and sku_revision.catalog_revision_id = p_catalog_revision_id
  join public.canonical_foods food on food.id = rule.canonical_food_id
  where rule.criteria ->> 'generator' = 't17b-v1'
    and rule.status in ('draft', 'active')
    and rule.criteria ->> 'catalogRevisionId' = p_catalog_revision_id::text
    and rule.criteria ->> 'skuContentHash' = encode(sku_revision.content_hash, 'hex')
    and (p_cursor is null or rule.id > p_cursor)
  order by rule.id
  limit p_limit;
end;
$$;

create function private.review_admin_supermarket_matching_rule(
  p_auth_subject uuid,
  p_auth_session_id uuid,
  p_matching_rule_id uuid,
  p_expected_version integer,
  p_match_state text,
  p_request_id uuid,
  p_external_sequence bigint,
  p_external_timestamp timestamptz,
  p_external_record_hash bytea,
  p_external_receipt_signature bytea,
  p_external_key_version integer,
  p_external_idempotency_hash bytea
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_actor_id uuid;
  v_digest bytea;
  v_food_key text;
  v_new_hash bytea;
  v_new_rule_id uuid;
  v_new_version integer;
  v_previous_hash bytea;
  v_response jsonb;
  v_rule private.supermarket_sku_matching_rule_revisions%rowtype;
begin
  v_actor_id := private.require_superadmin_aal2(p_auth_subject, p_auth_session_id);
  if p_match_state not in ('exact', 'allowed', 'excluded') then
    raise exception using errcode = '22023', message = 'invalid_review_match_state';
  end if;
  v_digest := extensions.digest(convert_to(jsonb_build_object(
    'expectedVersion', p_expected_version, 'matchState', p_match_state
  )::text, 'utf8'), 'sha256');
  v_response := private.admin_supermarket_replay(
    p_request_id, v_actor_id, 'matching-rule-review', p_matching_rule_id, v_digest
  );
  if v_response is not null then return v_response; end if;
  select * into v_rule
  from private.supermarket_sku_matching_rule_revisions rule
  where rule.id = p_matching_rule_id for update;
  if v_rule.id is null then
    raise exception using errcode = '22023', message = 'matching_rule_not_found';
  end if;
  if v_rule.version <> p_expected_version then
    raise exception using errcode = '40001', message = 'stale_matching_rule_version';
  end if;
  if v_rule.status <> 'draft' or v_rule.criteria ->> 'generator' <> 't17b-v1' then
    raise exception using errcode = '55000', message = 'matching_rule_not_reviewable';
  end if;
  if v_rule.gtin_consistency = 'conflict' and p_match_state in ('exact', 'allowed') then
    raise exception using errcode = '55000', message = 'gtin_conflict_requires_exclusion';
  end if;
  select food.food_key into v_food_key
  from public.canonical_foods food where food.id = v_rule.canonical_food_id;
  v_previous_hash := extensions.digest(convert_to(jsonb_build_object(
    'id', v_rule.id, 'status', v_rule.status, 'matchState', v_rule.match_state,
    'version', v_rule.version
  )::text, 'utf8'), 'sha256');
  v_new_rule_id := private.create_supermarket_matching_rule(
    v_rule.sku_id, v_food_key, p_match_state, v_rule.food_state,
    v_rule.purchase_form, v_rule.edible_part,
    v_rule.criteria || jsonb_build_object('review', 'superadmin'),
    v_rule.evidence || jsonb_build_array('manual-review'), v_rule.exclusions,
    v_actor_id
  );
  if p_match_state = 'excluded' then
    update private.supermarket_sku_matching_rule_revisions
    set match_state = 'excluded'
    where id = v_new_rule_id;
  end if;
  select rule.version into v_new_version
  from private.supermarket_sku_matching_rule_revisions rule
  where rule.id = v_new_rule_id;
  update private.supermarket_sku_matching_rule_revisions
  set status = 'withdrawn'
  where id = v_rule.id;
  v_response := jsonb_build_object(
    'schemaVersion', 1, 'matchingRuleId', v_new_rule_id,
    'matchState', p_match_state, 'status', 'draft', 'version', v_new_version
  );
  v_new_hash := extensions.digest(convert_to(v_response::text, 'utf8'), 'sha256');
  perform private.record_supermarket_admin_intent(
    v_actor_id,
    private.admin_supermarket_effective_profile(p_auth_session_id, v_actor_id),
    'matching_rule_review', 'product_matching_rule', v_rule.id, p_request_id,
    v_previous_hash, v_new_hash, p_external_sequence, p_external_timestamp,
    p_external_record_hash, p_external_receipt_signature,
    p_external_key_version, p_external_idempotency_hash
  );
  perform private.admin_supermarket_store_idempotency(
    p_request_id, v_actor_id, 'matching-rule-review', p_matching_rule_id,
    v_digest, v_response
  );
  return v_response;
end;
$$;

create function private.activate_admin_supermarket_matching_rule(
  p_auth_subject uuid,
  p_auth_session_id uuid,
  p_matching_rule_id uuid,
  p_expected_version integer,
  p_request_id uuid,
  p_external_sequence bigint,
  p_external_timestamp timestamptz,
  p_external_record_hash bytea,
  p_external_receipt_signature bytea,
  p_external_key_version integer,
  p_external_idempotency_hash bytea
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_actor_id uuid;
  v_digest bytea;
  v_new_hash bytea;
  v_previous_hash bytea;
  v_response jsonb;
  v_rule private.supermarket_sku_matching_rule_revisions%rowtype;
begin
  v_actor_id := private.require_superadmin_aal2(p_auth_subject, p_auth_session_id);
  v_digest := extensions.digest(convert_to(jsonb_build_object(
    'expectedVersion', p_expected_version
  )::text, 'utf8'), 'sha256');
  v_response := private.admin_supermarket_replay(
    p_request_id, v_actor_id, 'matching-rule-activate',
    p_matching_rule_id, v_digest
  );
  if v_response is not null then return v_response; end if;
  select * into v_rule
  from private.supermarket_sku_matching_rule_revisions rule
  where rule.id = p_matching_rule_id for update;
  if v_rule.id is null then
    raise exception using errcode = '22023', message = 'matching_rule_not_found';
  end if;
  if v_rule.version <> p_expected_version then
    raise exception using errcode = '40001', message = 'stale_matching_rule_version';
  end if;
  if v_rule.criteria ->> 'generator' = 't17b-v1'
    and v_rule.criteria ->> 'review' <> 'superadmin'
  then
    raise exception using errcode = '55000', message = 'matching_rule_not_reviewed';
  end if;
  v_previous_hash := extensions.digest(convert_to(jsonb_build_object(
    'id', v_rule.id, 'status', v_rule.status, 'version', v_rule.version
  )::text, 'utf8'), 'sha256');
  v_response := private.activate_supermarket_matching_rule(
    p_matching_rule_id, v_actor_id, p_expected_version
  );
  v_response := v_response || jsonb_build_object('schemaVersion', 1);
  v_new_hash := extensions.digest(convert_to(jsonb_build_object(
    'id', v_rule.id, 'status', 'active', 'version', v_rule.version
  )::text, 'utf8'), 'sha256');
  perform private.record_supermarket_admin_intent(
    v_actor_id,
    private.admin_supermarket_effective_profile(p_auth_session_id, v_actor_id),
    'matching_rule_activate', 'product_matching_rule', v_rule.id, p_request_id,
    v_previous_hash, v_new_hash, p_external_sequence, p_external_timestamp,
    p_external_record_hash, p_external_receipt_signature,
    p_external_key_version, p_external_idempotency_hash
  );
  perform private.admin_supermarket_store_idempotency(
    p_request_id, v_actor_id, 'matching-rule-activate',
    p_matching_rule_id, v_digest, v_response
  );
  return v_response;
end;
$$;

create function private.publish_admin_supermarket_catalog(
  p_auth_subject uuid,
  p_auth_session_id uuid,
  p_catalog_revision_id uuid,
  p_expected_version integer,
  p_source_use_decision text,
  p_expected_catalog_hash bytea,
  p_expected_seed_hash bytea,
  p_expected_coverage_hash bytea,
  p_request_id uuid,
  p_external_sequence bigint,
  p_external_timestamp timestamptz,
  p_external_record_hash bytea,
  p_external_receipt_signature bytea,
  p_external_key_version integer,
  p_external_idempotency_hash bytea
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_actor_id uuid;
  v_digest bytea;
  v_new_hash bytea;
  v_previous_hash bytea;
  v_response jsonb;
  v_revision private.supermarket_catalog_revisions%rowtype;
  v_seed_id uuid;
begin
  v_actor_id := private.require_superadmin_aal2(p_auth_subject, p_auth_session_id);
  v_digest := extensions.digest(convert_to(jsonb_build_object(
    'expectedVersion', p_expected_version,
    'sourceUseDecision', p_source_use_decision,
    'catalogHash', encode(p_expected_catalog_hash, 'hex'),
    'seedHash', encode(p_expected_seed_hash, 'hex'),
    'coverageHash', encode(p_expected_coverage_hash, 'hex')
  )::text, 'utf8'), 'sha256');
  v_response := private.admin_supermarket_replay(
    p_request_id, v_actor_id, 'catalog-revision-publish',
    p_catalog_revision_id, v_digest
  );
  if v_response is not null then return v_response; end if;
  select * into v_revision
  from private.supermarket_catalog_revisions revision
  where revision.id = p_catalog_revision_id for share;
  if v_revision.id is null then
    raise exception using errcode = '22023', message = 'catalog_revision_not_found';
  end if;
  if v_revision.revision_number <> p_expected_version then
    raise exception using errcode = '40001', message = 'stale_catalog_revision';
  end if;
  select seed.id into v_seed_id
  from private.basket_seed_revisions seed where seed.status = 'active';
  if v_seed_id is null then
    raise exception using errcode = '55000', message = 'active_basket_seed_required';
  end if;
  v_previous_hash := extensions.digest(convert_to(jsonb_build_object(
    'catalogRevisionId', v_revision.id,
    'revisionNumber', v_revision.revision_number,
    'published', false
  )::text, 'utf8'), 'sha256');
  v_response := private.publish_supermarket_catalog(
    p_catalog_revision_id, v_seed_id, v_actor_id, p_source_use_decision,
    p_expected_catalog_hash, p_expected_seed_hash, p_expected_coverage_hash
  ) || jsonb_build_object('schemaVersion', 1, 'version', 1);
  v_new_hash := extensions.digest(convert_to(jsonb_build_object(
    'catalogPublicationId', v_response ->> 'catalogPublicationId',
    'coverageHash', encode(p_expected_coverage_hash, 'hex'),
    'version', 1
  )::text, 'utf8'), 'sha256');
  perform private.record_supermarket_admin_intent(
    v_actor_id,
    private.admin_supermarket_effective_profile(p_auth_session_id, v_actor_id),
    'catalog_revision_publish', 'catalog_revision', v_revision.id, p_request_id,
    v_previous_hash, v_new_hash, p_external_sequence, p_external_timestamp,
    p_external_record_hash, p_external_receipt_signature,
    p_external_key_version, p_external_idempotency_hash
  );
  perform private.admin_supermarket_store_idempotency(
    p_request_id, v_actor_id, 'catalog-revision-publish',
    p_catalog_revision_id, v_digest, v_response
  );
  return v_response;
end;
$$;

create function private.hide_admin_supermarket_catalog_publication(
  p_auth_subject uuid,
  p_auth_session_id uuid,
  p_catalog_publication_id uuid,
  p_expected_version integer,
  p_request_id uuid,
  p_external_sequence bigint,
  p_external_timestamp timestamptz,
  p_external_record_hash bytea,
  p_external_receipt_signature bytea,
  p_external_key_version integer,
  p_external_idempotency_hash bytea
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_actor_id uuid;
  v_digest bytea;
  v_new_hash bytea;
  v_previous_hash bytea;
  v_publication private.catalog_publications%rowtype;
  v_response jsonb;
begin
  v_actor_id := private.require_superadmin_aal2(p_auth_subject, p_auth_session_id);
  v_digest := extensions.digest(convert_to(jsonb_build_object(
    'expectedVersion', p_expected_version
  )::text, 'utf8'), 'sha256');
  v_response := private.admin_supermarket_replay(
    p_request_id, v_actor_id, 'catalog-publication-hide',
    p_catalog_publication_id, v_digest
  );
  if v_response is not null then return v_response; end if;
  select * into v_publication
  from private.catalog_publications publication
  where publication.id = p_catalog_publication_id for update;
  if v_publication.id is null then
    raise exception using errcode = '22023', message = 'catalog_publication_not_found';
  end if;
  if v_publication.hidden_at is not null
    or v_publication.version <> p_expected_version
  then
    raise exception using errcode = '40001', message = 'stale_catalog_publication';
  end if;
  v_previous_hash := extensions.digest(convert_to(jsonb_build_object(
    'id', v_publication.id, 'status', 'active', 'version', v_publication.version
  )::text, 'utf8'), 'sha256');
  v_response := private.hide_supermarket_catalog_publication(
    p_catalog_publication_id, v_actor_id
  );
  update private.catalog_publications publication
  set version = publication.version + 1
  where publication.id = p_catalog_publication_id;
  v_response := v_response || jsonb_build_object(
    'schemaVersion', 1, 'version', v_publication.version + 1
  );
  v_new_hash := extensions.digest(convert_to(jsonb_build_object(
    'id', v_publication.id, 'status', 'hidden',
    'version', v_publication.version + 1
  )::text, 'utf8'), 'sha256');
  perform private.record_supermarket_admin_intent(
    v_actor_id,
    private.admin_supermarket_effective_profile(p_auth_session_id, v_actor_id),
    'catalog_publication_hide', 'catalog_publication', v_publication.id,
    p_request_id, v_previous_hash, v_new_hash, p_external_sequence,
    p_external_timestamp, p_external_record_hash, p_external_receipt_signature,
    p_external_key_version, p_external_idempotency_hash
  );
  perform private.admin_supermarket_store_idempotency(
    p_request_id, v_actor_id, 'catalog-publication-hide',
    p_catalog_publication_id, v_digest, v_response
  );
  return v_response;
end;
$$;

create or replace function private.record_admin_reconciliation(
  p_request_id uuid,
  p_original_actor_id uuid,
  p_effective_profile_id uuid,
  p_impersonation_session_id uuid,
  p_action text,
  p_target_type text,
  p_target_id uuid,
  p_external_sequence bigint,
  p_external_timestamp timestamptz,
  p_external_record_hash bytea,
  p_external_receipt_signature bytea,
  p_external_key_version integer,
  p_external_idempotency_hash bytea
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_existing private.technical_audit_events%rowtype;
begin
  perform private.validate_admin_intent(
    p_external_sequence, p_external_timestamp, p_external_record_hash,
    p_external_receipt_signature, p_external_key_version,
    p_external_idempotency_hash
  );
  if not (
    (p_action = 'impersonation_start' and p_target_type = 'profile')
    or (p_action = 'impersonation_end' and p_target_type = 'impersonation_session'
      and p_impersonation_session_id = p_target_id)
    or (p_action = 'barcode_correction_correct' and p_target_type = 'barcode_correction')
    or (p_action = 'barcode_correction_approve'
      and p_target_type = 'commercial_product_revision')
    or (p_action = 'barcode_correction_reject' and p_target_type = 'barcode_correction')
    or (p_action = 'catalog_match_candidates_generate'
      and p_target_type = 'catalog_revision')
    or (p_action = 'matching_rule_review' and p_target_type = 'product_matching_rule')
    or (p_action = 'matching_rule_activate' and p_target_type = 'product_matching_rule')
    or (p_action = 'catalog_revision_publish' and p_target_type = 'catalog_revision')
    or (p_action = 'catalog_publication_hide' and p_target_type = 'catalog_publication')
  ) then
    raise exception using errcode = '22023', message = 'invalid_reconciliation_action';
  end if;
  if not exists (
    select 1 from public.actors actor
    where actor.id = p_original_actor_id and actor.role = 'superadmin'
      and actor.disabled_at is null
  ) then
    raise exception using errcode = '42501', message = 'superadmin_required';
  end if;
  if exists (
    select 1 from private.audit_outbox outbox where outbox.request_id = p_request_id
  ) then
    raise exception using errcode = '55000', message = 'audit_outbox_exists';
  end if;
  select * into v_existing from private.technical_audit_events event
  where event.request_id = p_request_id and event.phase = 'reconciliation';
  if v_existing.id is not null then
    if v_existing.external_sequence <> p_external_sequence
      or v_existing.external_record_hash <> p_external_record_hash
      or v_existing.external_receipt_signature <> p_external_receipt_signature
      or v_existing.external_key_version <> p_external_key_version
      or v_existing.external_idempotency_hash <> p_external_idempotency_hash
    then
      raise exception using errcode = '23505', message = 'audit_reconciliation_conflict';
    end if;
    return true;
  end if;
  insert into private.technical_audit_events (
    actor_id, action, target_type, target_id, result, request_id, phase,
    original_actor_id, effective_profile_id, impersonation_session_id,
    external_sequence, external_timestamp, external_record_hash,
    external_receipt_signature, external_key_version, external_idempotency_hash
  ) values (
    p_original_actor_id, p_action, p_target_type, p_target_id, 'failure',
    p_request_id, 'reconciliation', p_original_actor_id,
    p_effective_profile_id, p_impersonation_session_id, p_external_sequence,
    p_external_timestamp, p_external_record_hash, p_external_receipt_signature,
    p_external_key_version, p_external_idempotency_hash
  );
  return true;
end;
$$;

create function public.internal_admin_list_supermarket_catalog_revisions(
  p_auth_subject uuid,
  p_auth_session_id uuid,
  p_chain text,
  p_state text,
  p_cursor uuid,
  p_limit integer
)
returns table (
  catalog_revision_id uuid, chain text, revision_number integer, state text,
  quality_status text, record_count integer, usable_count integer,
  error_count integer, license_status text, source_terms_status text,
  catalog_hash bytea, basket_seed_revision_id uuid, basket_seed_hash bytea,
  coverage jsonb, coverage_hash bytea, active_publication_id uuid,
  publication_version integer
)
language sql
security definer
set search_path = pg_catalog
as $$
  select * from private.list_admin_supermarket_catalog_revisions(
    p_auth_subject, p_auth_session_id, p_chain, p_state, p_cursor, p_limit
  )
$$;

create function public.internal_admin_supermarket_audit_context(
  p_auth_subject uuid,
  p_auth_session_id uuid,
  p_action text,
  p_target_id uuid
)
returns table (
  original_actor_id uuid, effective_profile_id uuid, audit_target_id uuid,
  audit_target_type text, mutation_scope text
)
language sql
security definer
set search_path = pg_catalog
as $$
  select * from private.admin_supermarket_audit_context(
    p_auth_subject, p_auth_session_id, p_action, p_target_id
  )
$$;

create function public.internal_admin_generate_supermarket_match_candidates(
  p_auth_subject uuid,
  p_auth_session_id uuid,
  p_catalog_revision_id uuid,
  p_expected_version integer,
  p_basket_seed_revision_id uuid,
  p_candidates jsonb,
  p_processed_skus jsonb,
  p_request_id uuid,
  p_external_sequence bigint,
  p_external_timestamp timestamptz,
  p_external_record_hash bytea,
  p_external_receipt_signature bytea,
  p_external_key_version integer,
  p_external_idempotency_hash bytea
)
returns jsonb
language sql
security definer
set search_path = pg_catalog
as $$
  select private.generate_admin_supermarket_match_candidates(
    p_auth_subject, p_auth_session_id, p_catalog_revision_id,
    p_expected_version, p_basket_seed_revision_id, p_candidates,
    p_processed_skus, p_request_id,
    p_external_sequence,
    p_external_timestamp, p_external_record_hash,
    p_external_receipt_signature, p_external_key_version,
    p_external_idempotency_hash
  )
$$;

create function public.internal_admin_supermarket_match_inputs(
  p_auth_subject uuid,
  p_auth_session_id uuid,
  p_catalog_revision_id uuid,
  p_expected_version integer
)
returns jsonb
language sql
security definer
set search_path = pg_catalog
as $$
  select private.admin_supermarket_match_inputs(
    p_auth_subject, p_auth_session_id, p_catalog_revision_id, p_expected_version
  )
$$;

create function public.internal_admin_list_supermarket_matching_rules(
  p_auth_subject uuid,
  p_auth_session_id uuid,
  p_catalog_revision_id uuid,
  p_cursor uuid,
  p_limit integer
)
returns table (
  matching_rule_id uuid, version integer, status text, match_state text,
  chain text, external_sku text, sku_name text, canonical_food_key text,
  canonical_food_name text, food_state text, purchase_form text,
  gtin_consistency text, critical_issue_open boolean, reviewed boolean,
  reasons text[]
)
language sql
security definer
set search_path = pg_catalog
as $$
  select * from private.list_admin_supermarket_matching_rules(
    p_auth_subject, p_auth_session_id, p_catalog_revision_id, p_cursor, p_limit
  )
$$;

create function public.internal_admin_review_supermarket_matching_rule(
  p_auth_subject uuid,
  p_auth_session_id uuid,
  p_matching_rule_id uuid,
  p_expected_version integer,
  p_match_state text,
  p_request_id uuid,
  p_external_sequence bigint,
  p_external_timestamp timestamptz,
  p_external_record_hash bytea,
  p_external_receipt_signature bytea,
  p_external_key_version integer,
  p_external_idempotency_hash bytea
)
returns jsonb
language sql
security definer
set search_path = pg_catalog
as $$
  select private.review_admin_supermarket_matching_rule(
    p_auth_subject, p_auth_session_id, p_matching_rule_id, p_expected_version,
    p_match_state, p_request_id, p_external_sequence, p_external_timestamp,
    p_external_record_hash, p_external_receipt_signature,
    p_external_key_version, p_external_idempotency_hash
  )
$$;

create function public.internal_admin_activate_supermarket_matching_rule(
  p_auth_subject uuid,
  p_auth_session_id uuid,
  p_matching_rule_id uuid,
  p_expected_version integer,
  p_request_id uuid,
  p_external_sequence bigint,
  p_external_timestamp timestamptz,
  p_external_record_hash bytea,
  p_external_receipt_signature bytea,
  p_external_key_version integer,
  p_external_idempotency_hash bytea
)
returns jsonb
language sql
security definer
set search_path = pg_catalog
as $$
  select private.activate_admin_supermarket_matching_rule(
    p_auth_subject, p_auth_session_id, p_matching_rule_id, p_expected_version,
    p_request_id, p_external_sequence, p_external_timestamp,
    p_external_record_hash, p_external_receipt_signature,
    p_external_key_version, p_external_idempotency_hash
  )
$$;

create function public.internal_admin_publish_supermarket_catalog(
  p_auth_subject uuid,
  p_auth_session_id uuid,
  p_catalog_revision_id uuid,
  p_expected_version integer,
  p_source_use_decision text,
  p_expected_catalog_hash bytea,
  p_expected_seed_hash bytea,
  p_expected_coverage_hash bytea,
  p_request_id uuid,
  p_external_sequence bigint,
  p_external_timestamp timestamptz,
  p_external_record_hash bytea,
  p_external_receipt_signature bytea,
  p_external_key_version integer,
  p_external_idempotency_hash bytea
)
returns jsonb
language sql
security definer
set search_path = pg_catalog
as $$
  select private.publish_admin_supermarket_catalog(
    p_auth_subject, p_auth_session_id, p_catalog_revision_id,
    p_expected_version, p_source_use_decision, p_expected_catalog_hash,
    p_expected_seed_hash, p_expected_coverage_hash, p_request_id,
    p_external_sequence, p_external_timestamp, p_external_record_hash,
    p_external_receipt_signature, p_external_key_version,
    p_external_idempotency_hash
  )
$$;

create function public.internal_admin_hide_supermarket_catalog_publication(
  p_auth_subject uuid,
  p_auth_session_id uuid,
  p_catalog_publication_id uuid,
  p_expected_version integer,
  p_request_id uuid,
  p_external_sequence bigint,
  p_external_timestamp timestamptz,
  p_external_record_hash bytea,
  p_external_receipt_signature bytea,
  p_external_key_version integer,
  p_external_idempotency_hash bytea
)
returns jsonb
language sql
security definer
set search_path = pg_catalog
as $$
  select private.hide_admin_supermarket_catalog_publication(
    p_auth_subject, p_auth_session_id, p_catalog_publication_id,
    p_expected_version, p_request_id, p_external_sequence,
    p_external_timestamp, p_external_record_hash,
    p_external_receipt_signature, p_external_key_version,
    p_external_idempotency_hash
  )
$$;

revoke all on function private.admin_supermarket_replay(uuid, uuid, text, uuid, bytea)
from public, anon, authenticated, service_role;
revoke all on function private.admin_supermarket_store_idempotency(
  uuid, uuid, text, uuid, bytea, jsonb
) from public, anon, authenticated, service_role;
revoke all on function private.admin_supermarket_effective_profile(uuid, uuid)
from public, anon, authenticated, service_role;
revoke all on function private.record_supermarket_admin_intent(
  uuid, uuid, text, text, uuid, uuid, bytea, bytea, bigint, timestamptz,
  bytea, bytea, integer, bytea
) from public, anon, authenticated, service_role;
revoke all on function private.admin_supermarket_audit_context(uuid, uuid, text, uuid)
from public, anon, authenticated, service_role;
revoke all on function private.list_admin_supermarket_catalog_revisions(
  uuid, uuid, text, text, uuid, integer
) from public, anon, authenticated, service_role;
revoke all on function private.generate_admin_supermarket_match_candidates(
  uuid, uuid, uuid, integer, uuid, jsonb, jsonb, uuid, bigint, timestamptz,
  bytea, bytea, integer, bytea
) from public, anon, authenticated, service_role;
revoke all on function private.admin_supermarket_match_inputs(
  uuid, uuid, uuid, integer
) from public, anon, authenticated, service_role;
revoke all on function private.list_admin_supermarket_matching_rules(
  uuid, uuid, uuid, uuid, integer
) from public, anon, authenticated, service_role;
revoke all on function private.review_admin_supermarket_matching_rule(
  uuid, uuid, uuid, integer, text, uuid, bigint, timestamptz,
  bytea, bytea, integer, bytea
) from public, anon, authenticated, service_role;
revoke all on function private.activate_admin_supermarket_matching_rule(
  uuid, uuid, uuid, integer, uuid, bigint, timestamptz, bytea, bytea, integer, bytea
) from public, anon, authenticated, service_role;
revoke all on function private.publish_admin_supermarket_catalog(
  uuid, uuid, uuid, integer, text, bytea, bytea, bytea, uuid, bigint,
  timestamptz, bytea, bytea, integer, bytea
) from public, anon, authenticated, service_role;
revoke all on function private.hide_admin_supermarket_catalog_publication(
  uuid, uuid, uuid, integer, uuid, bigint, timestamptz, bytea, bytea, integer, bytea
) from public, anon, authenticated, service_role;

revoke all on function public.internal_admin_list_supermarket_catalog_revisions(
  uuid, uuid, text, text, uuid, integer
) from public, anon, authenticated;
revoke all on function public.internal_admin_supermarket_audit_context(
  uuid, uuid, text, uuid
) from public, anon, authenticated;
revoke all on function public.internal_admin_generate_supermarket_match_candidates(
  uuid, uuid, uuid, integer, uuid, jsonb, jsonb, uuid, bigint, timestamptz,
  bytea, bytea, integer, bytea
) from public, anon, authenticated;
revoke all on function public.internal_admin_supermarket_match_inputs(
  uuid, uuid, uuid, integer
) from public, anon, authenticated;
revoke all on function public.internal_admin_list_supermarket_matching_rules(
  uuid, uuid, uuid, uuid, integer
) from public, anon, authenticated;
revoke all on function public.internal_admin_review_supermarket_matching_rule(
  uuid, uuid, uuid, integer, text, uuid, bigint, timestamptz,
  bytea, bytea, integer, bytea
) from public, anon, authenticated;
revoke all on function public.internal_admin_activate_supermarket_matching_rule(
  uuid, uuid, uuid, integer, uuid, bigint, timestamptz, bytea, bytea, integer, bytea
) from public, anon, authenticated;
revoke all on function public.internal_admin_publish_supermarket_catalog(
  uuid, uuid, uuid, integer, text, bytea, bytea, bytea, uuid, bigint,
  timestamptz, bytea, bytea, integer, bytea
) from public, anon, authenticated;
revoke all on function public.internal_admin_hide_supermarket_catalog_publication(
  uuid, uuid, uuid, integer, uuid, bigint, timestamptz, bytea, bytea, integer, bytea
) from public, anon, authenticated;

grant execute on function public.internal_admin_list_supermarket_catalog_revisions(
  uuid, uuid, text, text, uuid, integer
) to service_role;
grant execute on function public.internal_admin_supermarket_audit_context(
  uuid, uuid, text, uuid
) to service_role;
grant execute on function public.internal_admin_generate_supermarket_match_candidates(
  uuid, uuid, uuid, integer, uuid, jsonb, jsonb, uuid, bigint, timestamptz,
  bytea, bytea, integer, bytea
) to service_role;
grant execute on function public.internal_admin_supermarket_match_inputs(
  uuid, uuid, uuid, integer
) to service_role;
grant execute on function public.internal_admin_list_supermarket_matching_rules(
  uuid, uuid, uuid, uuid, integer
) to service_role;
grant execute on function public.internal_admin_review_supermarket_matching_rule(
  uuid, uuid, uuid, integer, text, uuid, bigint, timestamptz,
  bytea, bytea, integer, bytea
) to service_role;
grant execute on function public.internal_admin_activate_supermarket_matching_rule(
  uuid, uuid, uuid, integer, uuid, bigint, timestamptz, bytea, bytea, integer, bytea
) to service_role;
grant execute on function public.internal_admin_publish_supermarket_catalog(
  uuid, uuid, uuid, integer, text, bytea, bytea, bytea, uuid, bigint,
  timestamptz, bytea, bytea, integer, bytea
) to service_role;
grant execute on function public.internal_admin_hide_supermarket_catalog_publication(
  uuid, uuid, uuid, integer, uuid, bigint, timestamptz, bytea, bytea, integer, bytea
) to service_role;
