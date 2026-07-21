-- Synchronize concurrency guards for databases that applied the first local T16 draft.
-- Additive replacement preserves data and keeps fresh installations deterministic.

create or replace function public.internal_commercial_product_resolve(
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

create or replace function public.internal_commercial_product_confirm(
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
