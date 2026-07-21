alter table public.barcode_corrections
  add column version integer not null default 1 check (version >= 1),
  add column review_revision_id uuid
    references public.commercial_product_revisions (id) on delete set null,
  add column approved_revision_id uuid
    references public.commercial_product_revisions (id) on delete set null,
  add column matching_rule_id uuid,
  add column rejection_reason text check (
    rejection_reason is null
    or rejection_reason in (
      'duplicate', 'insufficient_evidence', 'invalid_data', 'safety_risk'
    )
  );

update public.barcode_corrections
set review_revision_id = revision_id
where review_revision_id is null;

alter table public.product_matching_rule_revisions
  add column version integer not null default 1 check (version >= 1),
  add column correction_id uuid
    references public.barcode_corrections (id) on delete set null;

alter table public.barcode_corrections
  add constraint barcode_corrections_matching_rule_id_fkey
  foreign key (matching_rule_id)
  references public.product_matching_rule_revisions (id)
  on delete set null;

alter table private.technical_audit_events
  add column previous_state_hash bytea check (
    previous_state_hash is null or octet_length(previous_state_hash) = 32
  ),
  add column new_state_hash bytea check (
    new_state_hash is null or octet_length(new_state_hash) = 32
  );

alter table private.audit_outbox
  drop constraint if exists audit_outbox_action_check,
  drop constraint if exists audit_outbox_target_type_check;

alter table private.audit_outbox
  add constraint audit_outbox_action_check check (
    action in (
      'access_reset',
      'ai_provider_revision_activate',
      'audit_range_delete',
      'backup_create',
      'barcode_correction_approve',
      'barcode_correction_correct',
      'barcode_correction_reject',
      'catalog_publication_hide',
      'catalog_revision_publish',
      'impersonation_end',
      'impersonation_start',
      'invitation_create',
      'invitation_revoke',
      'matching_rule_activate',
      'profile_delete_permanent',
      'profile_update',
      'restore_create',
      'restore_promote',
      'rule_set_activate'
    )
  ),
  add constraint audit_outbox_target_type_check check (
    target_type in (
      'audit_range',
      'backup',
      'barcode_correction',
      'catalog_publication',
      'catalog_revision',
      'commercial_product_revision',
      'impersonation_session',
      'invitation',
      'product_matching_rule',
      'profile',
      'restore',
      'rule_revision'
    )
  );

create table private.commercial_product_admin_idempotency (
  request_id uuid primary key,
  actor_id uuid not null references public.actors (id) on delete restrict,
  operation text not null check (
    operation in (
      'barcode-correction-correct',
      'barcode-correction-approve',
      'barcode-correction-reject',
      'matching-rule-activate'
    )
  ),
  target_id uuid not null,
  request_digest bytea not null check (octet_length(request_digest) = 32),
  response jsonb not null check (
    jsonb_typeof(response) = 'object'
    and octet_length(response::text) <= 16384
  ),
  created_at timestamptz not null default clock_timestamp()
);

alter table private.commercial_product_admin_idempotency enable row level security;
revoke all on table private.commercial_product_admin_idempotency
from public, anon, authenticated, service_role;

create function private.record_product_admin_intent(
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
    p_external_sequence,
    p_external_timestamp,
    p_external_record_hash,
    p_external_receipt_signature,
    p_external_key_version,
    p_external_idempotency_hash
  );

  if not (
    (p_action = 'barcode_correction_correct' and p_target_type = 'barcode_correction')
    or (
      p_action = 'barcode_correction_approve'
      and p_target_type = 'commercial_product_revision'
    )
    or (p_action = 'barcode_correction_reject' and p_target_type = 'barcode_correction')
    or (p_action = 'matching_rule_activate' and p_target_type = 'product_matching_rule')
  ) then
    raise exception using errcode = '22023', message = 'invalid_product_admin_action';
  end if;

  insert into private.technical_audit_events (
    actor_id,
    action,
    target_type,
    target_id,
    result,
    request_id,
    phase,
    original_actor_id,
    effective_profile_id,
    external_sequence,
    external_timestamp,
    external_record_hash,
    external_receipt_signature,
    external_key_version,
    external_idempotency_hash,
    previous_state_hash,
    new_state_hash
  )
  values (
    p_actor_id,
    p_action,
    p_target_type,
    p_target_id,
    'pending',
    p_request_id,
    'intent',
    p_actor_id,
    p_effective_profile_id,
    p_external_sequence,
    p_external_timestamp,
    p_external_record_hash,
    p_external_receipt_signature,
    p_external_key_version,
    p_external_idempotency_hash,
    p_previous_state_hash,
    p_new_state_hash
  )
  returning id into v_event_id;

  insert into private.audit_outbox (
    technical_audit_event_id,
    request_id,
    original_actor_id,
    effective_profile_id,
    action,
    target_type,
    target_id
  )
  values (
    v_event_id,
    p_request_id,
    p_actor_id,
    p_effective_profile_id,
    p_action,
    p_target_type,
    p_target_id
  );
end;
$$;

create function private.admin_product_effective_profile(
  p_auth_session_id uuid,
  p_fallback_profile_id uuid
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
    p_fallback_profile_id
  )
$$;

create function private.admin_product_replay(
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
  v_existing private.commercial_product_admin_idempotency%rowtype;
begin
  select * into v_existing
  from private.commercial_product_admin_idempotency existing
  where existing.request_id = p_request_id;

  if v_existing.request_id is null then
    return null;
  end if;
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

create function private.admin_product_store_idempotency(
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
  insert into private.commercial_product_admin_idempotency (
    request_id, actor_id, operation, target_id, request_digest, response
  )
  values (
    p_request_id, p_actor_id, p_operation, p_target_id, p_request_digest, p_response
  )
$$;

create function private.list_admin_barcode_corrections(
  p_auth_subject uuid,
  p_auth_session_id uuid,
  p_status text,
  p_cursor uuid,
  p_limit integer
)
returns table (
  correction_id uuid,
  profile_id uuid,
  gtin14 text,
  name text,
  brand text,
  completeness text,
  status text,
  version integer,
  duplicate_count bigint,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  perform private.require_superadmin_aal2(p_auth_subject, p_auth_session_id);
  if p_status not in ('pending', 'approved', 'rejected', 'superseded')
    or p_limit is null or p_limit < 1 or p_limit > 51
  then
    raise exception using errcode = '22023', message = 'invalid_correction_query';
  end if;

  return query
  select
    correction.id,
    correction.profile_id,
    product.gtin14,
    revision.snapshot ->> 'name',
    nullif(revision.snapshot ->> 'brand', ''),
    revision.completeness,
    correction.status,
    correction.version,
    count(*) over (
      partition by correction.product_id, correction.snapshot_hash, correction.status
    ),
    correction.created_at
  from public.barcode_corrections correction
  join public.commercial_products product on product.id = correction.product_id
  join public.commercial_product_revisions revision
    on revision.id = coalesce(correction.review_revision_id, correction.revision_id)
  where correction.status = p_status
    and (
      p_cursor is null
      or (correction.created_at, correction.id) > (
        select cursor_row.created_at, cursor_row.id
        from public.barcode_corrections cursor_row
        where cursor_row.id = p_cursor
      )
    )
  order by correction.created_at, correction.id
  limit p_limit;
end;
$$;

create function private.get_admin_barcode_correction(
  p_auth_subject uuid,
  p_auth_session_id uuid,
  p_correction_id uuid
)
returns table (
  correction_id uuid,
  profile_id uuid,
  product_id uuid,
  review_revision_id uuid,
  status text,
  version integer,
  created_at timestamptz,
  proposed_snapshot jsonb,
  base_snapshot jsonb,
  global_snapshot jsonb
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  perform private.require_superadmin_aal2(p_auth_subject, p_auth_session_id);
  return query
  select
    correction.id,
    correction.profile_id,
    correction.product_id,
    coalesce(correction.review_revision_id, correction.revision_id),
    correction.status,
    correction.version,
    correction.created_at,
    proposed.snapshot,
    base.snapshot,
    global_revision.snapshot
  from public.barcode_corrections correction
  join public.commercial_product_revisions proposed
    on proposed.id = coalesce(correction.review_revision_id, correction.revision_id)
  left join public.commercial_product_revisions base
    on base.id = correction.base_revision_id
  left join lateral (
    select approved.snapshot
    from public.commercial_product_revisions approved
    where approved.product_id = correction.product_id
      and approved.owner_profile_id is null
      and approved.status = 'global_approved'
    order by approved.approved_at desc, approved.id desc
    limit 1
  ) global_revision on true
  where correction.id = p_correction_id;
end;
$$;

create function private.admin_product_audit_context(
  p_auth_subject uuid,
  p_auth_session_id uuid,
  p_action text,
  p_target_id uuid
)
returns table (
  original_actor_id uuid,
  effective_profile_id uuid,
  audit_target_id uuid,
  audit_target_type text
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_actor_id uuid;
  v_profile_id uuid;
  v_revision_id uuid;
begin
  v_actor_id := private.require_superadmin_aal2(p_auth_subject, p_auth_session_id);
  if p_action in (
    'barcode_correction_correct',
    'barcode_correction_approve',
    'barcode_correction_reject'
  ) then
    select
      correction.profile_id,
      coalesce(correction.review_revision_id, correction.revision_id)
    into v_profile_id, v_revision_id
    from public.barcode_corrections correction
    where correction.id = p_target_id;
    if v_profile_id is null then
      raise exception using errcode = '22023', message = 'barcode_correction_not_found';
    end if;
    return query select
      v_actor_id,
      private.admin_product_effective_profile(p_auth_session_id, v_profile_id),
      case when p_action = 'barcode_correction_approve' then v_revision_id else p_target_id end,
      case
        when p_action = 'barcode_correction_approve' then 'commercial_product_revision'
        else 'barcode_correction'
      end;
    return;
  end if;

  if p_action = 'matching_rule_activate' then
    select correction.profile_id
    into v_profile_id
    from public.product_matching_rule_revisions matching
    left join public.barcode_corrections correction
      on correction.id = matching.correction_id
    where matching.id = p_target_id;
    if not found then
      raise exception using errcode = '22023', message = 'matching_rule_not_found';
    end if;
    return query select
      v_actor_id,
      private.admin_product_effective_profile(p_auth_session_id, v_profile_id),
      p_target_id,
      'product_matching_rule'::text;
    return;
  end if;
  raise exception using errcode = '22023', message = 'invalid_product_admin_action';
end;
$$;

create function private.correct_admin_barcode_correction(
  p_auth_subject uuid,
  p_auth_session_id uuid,
  p_correction_id uuid,
  p_expected_version integer,
  p_snapshot jsonb,
  p_completeness text,
  p_uncertainties jsonb,
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
  v_correction public.barcode_corrections%rowtype;
  v_previous public.commercial_product_revisions%rowtype;
  v_manifest_id uuid;
  v_revision_id uuid;
  v_hash bytea;
  v_digest bytea;
  v_response jsonb;
  v_effective_profile_id uuid;
begin
  v_actor_id := private.require_superadmin_aal2(p_auth_subject, p_auth_session_id);
  if p_completeness not in ('complete', 'provisional', 'insufficient')
    or jsonb_typeof(p_snapshot) <> 'object'
    or jsonb_typeof(p_uncertainties) <> 'array'
  then
    raise exception using errcode = '22023', message = 'invalid_product_snapshot';
  end if;
  v_digest := extensions.digest(
    convert_to(jsonb_build_object(
      'expectedVersion', p_expected_version,
      'snapshot', p_snapshot,
      'completeness', p_completeness,
      'uncertainties', p_uncertainties
    )::text, 'utf8'),
    'sha256'
  );
  v_response := private.admin_product_replay(
    p_request_id, v_actor_id, 'barcode-correction-correct', p_correction_id, v_digest
  );
  if v_response is not null then return v_response; end if;

  select * into v_correction
  from public.barcode_corrections correction
  where correction.id = p_correction_id
  for update;
  if v_correction.id is null then
    raise exception using errcode = '22023', message = 'barcode_correction_not_found';
  end if;
  if v_correction.status <> 'pending' or v_correction.version <> p_expected_version then
    raise exception using errcode = '55000', message = 'stale_barcode_correction';
  end if;
  select * into v_previous
  from public.commercial_product_revisions revision
  where revision.id = coalesce(v_correction.review_revision_id, v_correction.revision_id);
  if p_snapshot #>> '{gtin,gtin14}' <> (
    select product.gtin14 from public.commercial_products product
    where product.id = v_correction.product_id
  ) then
    raise exception using errcode = '22023', message = 'product_gtin_mismatch';
  end if;

  v_hash := extensions.digest(convert_to(p_snapshot::text, 'utf8'), 'sha256');
  insert into public.commercial_product_manifests (
    source_kind, normalized_content_hash, metadata
  ) values (
    'global_approval', v_hash, jsonb_build_object('review', 'admin_corrected')
  ) returning id into v_manifest_id;

  insert into public.commercial_product_revisions (
    product_id,
    manifest_id,
    owner_profile_id,
    supersedes_id,
    source_kind,
    snapshot,
    completeness,
    uncertainties,
    content_hash,
    status
  ) values (
    v_correction.product_id,
    v_manifest_id,
    null,
    v_previous.id,
    'global_approval',
    p_snapshot,
    p_completeness,
    p_uncertainties,
    v_hash,
    'global_candidate'
  ) returning id into v_revision_id;

  update public.barcode_corrections correction
  set review_revision_id = v_revision_id,
      version = correction.version + 1
  where correction.id = v_correction.id;
  v_effective_profile_id := private.admin_product_effective_profile(
    p_auth_session_id, v_correction.profile_id
  );
  perform private.record_product_admin_intent(
    v_actor_id,
    v_effective_profile_id,
    'barcode_correction_correct',
    'barcode_correction',
    v_correction.id,
    p_request_id,
    v_previous.content_hash,
    v_hash,
    p_external_sequence,
    p_external_timestamp,
    p_external_record_hash,
    p_external_receipt_signature,
    p_external_key_version,
    p_external_idempotency_hash
  );
  v_response := jsonb_build_object(
    'schemaVersion', 1,
    'correctionId', v_correction.id,
    'status', 'pending',
    'version', v_correction.version + 1,
    'globalRevisionId', v_revision_id,
    'matchingRuleId', null
  );
  perform private.admin_product_store_idempotency(
    p_request_id, v_actor_id, 'barcode-correction-correct', p_correction_id,
    v_digest, v_response
  );
  return v_response;
end;
$$;

create function private.approve_admin_barcode_correction(
  p_auth_subject uuid,
  p_auth_session_id uuid,
  p_correction_id uuid,
  p_expected_version integer,
  p_canonical_food_key text,
  p_match_state text,
  p_evidence jsonb,
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
  v_correction public.barcode_corrections%rowtype;
  v_source public.commercial_product_revisions%rowtype;
  v_global_revision_id uuid;
  v_manifest_id uuid;
  v_matching_rule_id uuid;
  v_food_id uuid;
  v_digest bytea;
  v_response jsonb;
  v_effective_profile_id uuid;
begin
  v_actor_id := private.require_superadmin_aal2(p_auth_subject, p_auth_session_id);
  if p_match_state not in ('exact', 'allowed', 'review', 'excluded', 'insufficient')
    or jsonb_typeof(p_evidence) <> 'array'
    or jsonb_array_length(p_evidence) < 1
  then
    raise exception using errcode = '22023', message = 'invalid_matching_review';
  end if;
  v_digest := extensions.digest(convert_to(jsonb_build_object(
    'expectedVersion', p_expected_version,
    'canonicalFoodKey', p_canonical_food_key,
    'matchState', p_match_state,
    'evidence', p_evidence
  )::text, 'utf8'), 'sha256');
  v_response := private.admin_product_replay(
    p_request_id, v_actor_id, 'barcode-correction-approve', p_correction_id, v_digest
  );
  if v_response is not null then return v_response; end if;

  select * into v_correction
  from public.barcode_corrections correction
  where correction.id = p_correction_id
  for update;
  if v_correction.id is null then
    raise exception using errcode = '22023', message = 'barcode_correction_not_found';
  end if;
  if v_correction.status <> 'pending' or v_correction.version <> p_expected_version then
    raise exception using errcode = '55000', message = 'stale_barcode_correction';
  end if;
  select * into v_source
  from public.commercial_product_revisions revision
  where revision.id = coalesce(v_correction.review_revision_id, v_correction.revision_id)
  for update;
  select food.id into v_food_id
  from public.canonical_foods food
  where food.food_key = p_canonical_food_key and food.active = true;
  if v_food_id is null then
    raise exception using errcode = '22023', message = 'canonical_food_not_found';
  end if;

  select revision.id into v_global_revision_id
  from public.commercial_product_revisions revision
  where revision.product_id = v_correction.product_id
    and revision.owner_profile_id is null
    and revision.content_hash = v_source.content_hash
    and revision.status = 'global_approved'
  order by revision.approved_at desc, revision.id desc
  limit 1;

  if v_global_revision_id is null then
    insert into public.commercial_product_manifests (
      source_kind, normalized_content_hash, metadata
    ) values (
      'global_approval',
      v_source.content_hash,
      jsonb_build_object('review', 'admin_approved')
    ) returning id into v_manifest_id;
    insert into public.commercial_product_revisions (
      product_id,
      manifest_id,
      owner_profile_id,
      supersedes_id,
      source_kind,
      snapshot,
      completeness,
      uncertainties,
      content_hash,
      status,
      approved_at
    ) values (
      v_correction.product_id,
      v_manifest_id,
      null,
      v_source.id,
      'global_approval',
      v_source.snapshot,
      v_source.completeness,
      v_source.uncertainties,
      v_source.content_hash,
      'global_approved',
      clock_timestamp()
    ) returning id into v_global_revision_id;
  end if;

  insert into public.product_matching_rule_revisions (
    product_id,
    canonical_food_id,
    match_state,
    criteria,
    exclusions,
    evidence,
    status,
    correction_id
  ) values (
    v_correction.product_id,
    v_food_id,
    p_match_state,
    jsonb_build_object(
      'canonicalFoodKey', p_canonical_food_key,
      'reviewedRevisionId', v_global_revision_id
    ),
    '[]'::jsonb,
    p_evidence,
    'draft',
    v_correction.id
  ) returning id into v_matching_rule_id;

  update public.barcode_corrections correction
  set status = 'approved',
      reviewed_at = clock_timestamp(),
      reviewed_by = v_actor_id,
      approved_revision_id = v_global_revision_id,
      matching_rule_id = v_matching_rule_id,
      rejection_reason = null,
      version = correction.version + 1
  where correction.id = v_correction.id;

  update public.barcode_corrections duplicate
  set status = 'superseded',
      reviewed_at = clock_timestamp(),
      reviewed_by = v_actor_id,
      approved_revision_id = v_global_revision_id,
      matching_rule_id = v_matching_rule_id,
      version = duplicate.version + 1
  where duplicate.id <> v_correction.id
    and duplicate.product_id = v_correction.product_id
    and duplicate.snapshot_hash = v_correction.snapshot_hash
    and duplicate.status = 'pending';

  v_effective_profile_id := private.admin_product_effective_profile(
    p_auth_session_id, v_correction.profile_id
  );
  perform private.record_product_admin_intent(
    v_actor_id,
    v_effective_profile_id,
    'barcode_correction_approve',
    'commercial_product_revision',
    v_source.id,
    p_request_id,
    v_source.content_hash,
    v_source.content_hash,
    p_external_sequence,
    p_external_timestamp,
    p_external_record_hash,
    p_external_receipt_signature,
    p_external_key_version,
    p_external_idempotency_hash
  );
  v_response := jsonb_build_object(
    'schemaVersion', 1,
    'correctionId', v_correction.id,
    'status', 'approved',
    'version', v_correction.version + 1,
    'globalRevisionId', v_global_revision_id,
    'matchingRuleId', v_matching_rule_id
  );
  perform private.admin_product_store_idempotency(
    p_request_id, v_actor_id, 'barcode-correction-approve', p_correction_id,
    v_digest, v_response
  );
  return v_response;
end;
$$;

create function private.reject_admin_barcode_correction(
  p_auth_subject uuid,
  p_auth_session_id uuid,
  p_correction_id uuid,
  p_expected_version integer,
  p_reason text,
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
  v_correction public.barcode_corrections%rowtype;
  v_digest bytea;
  v_response jsonb;
  v_effective_profile_id uuid;
  v_new_hash bytea;
begin
  v_actor_id := private.require_superadmin_aal2(p_auth_subject, p_auth_session_id);
  if p_reason not in ('duplicate', 'insufficient_evidence', 'invalid_data', 'safety_risk') then
    raise exception using errcode = '22023', message = 'invalid_rejection_reason';
  end if;
  v_digest := extensions.digest(convert_to(jsonb_build_object(
    'expectedVersion', p_expected_version, 'reason', p_reason
  )::text, 'utf8'), 'sha256');
  v_response := private.admin_product_replay(
    p_request_id, v_actor_id, 'barcode-correction-reject', p_correction_id, v_digest
  );
  if v_response is not null then return v_response; end if;

  select * into v_correction
  from public.barcode_corrections correction
  where correction.id = p_correction_id
  for update;
  if v_correction.id is null then
    raise exception using errcode = '22023', message = 'barcode_correction_not_found';
  end if;
  if v_correction.status <> 'pending' or v_correction.version <> p_expected_version then
    raise exception using errcode = '55000', message = 'stale_barcode_correction';
  end if;

  update public.barcode_corrections correction
  set status = 'rejected',
      reviewed_at = clock_timestamp(),
      reviewed_by = v_actor_id,
      rejection_reason = p_reason,
      version = correction.version + 1
  where correction.id = v_correction.id;
  v_new_hash := extensions.digest(
    convert_to(jsonb_build_object('status', 'rejected', 'reason', p_reason)::text, 'utf8'),
    'sha256'
  );
  v_effective_profile_id := private.admin_product_effective_profile(
    p_auth_session_id, v_correction.profile_id
  );
  perform private.record_product_admin_intent(
    v_actor_id,
    v_effective_profile_id,
    'barcode_correction_reject',
    'barcode_correction',
    v_correction.id,
    p_request_id,
    v_correction.snapshot_hash,
    v_new_hash,
    p_external_sequence,
    p_external_timestamp,
    p_external_record_hash,
    p_external_receipt_signature,
    p_external_key_version,
    p_external_idempotency_hash
  );
  v_response := jsonb_build_object(
    'schemaVersion', 1,
    'correctionId', v_correction.id,
    'status', 'rejected',
    'version', v_correction.version + 1,
    'globalRevisionId', null,
    'matchingRuleId', null
  );
  perform private.admin_product_store_idempotency(
    p_request_id, v_actor_id, 'barcode-correction-reject', p_correction_id,
    v_digest, v_response
  );
  return v_response;
end;
$$;

create function private.activate_admin_product_matching_rule(
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
  v_rule public.product_matching_rule_revisions%rowtype;
  v_profile_id uuid;
  v_digest bytea;
  v_response jsonb;
  v_previous_hash bytea;
  v_new_hash bytea;
begin
  v_actor_id := private.require_superadmin_aal2(p_auth_subject, p_auth_session_id);
  v_digest := extensions.digest(convert_to(jsonb_build_object(
    'expectedVersion', p_expected_version
  )::text, 'utf8'), 'sha256');
  v_response := private.admin_product_replay(
    p_request_id, v_actor_id, 'matching-rule-activate', p_matching_rule_id, v_digest
  );
  if v_response is not null then return v_response; end if;

  select * into v_rule
  from public.product_matching_rule_revisions matching
  where matching.id = p_matching_rule_id
  for update;
  if v_rule.id is null then
    raise exception using errcode = '22023', message = 'matching_rule_not_found';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_rule.product_id::text, 0));
  if v_rule.status <> 'draft' or v_rule.version <> p_expected_version then
    raise exception using errcode = '55000', message = 'stale_matching_rule';
  end if;
  v_previous_hash := extensions.digest(convert_to(jsonb_build_object(
    'id', v_rule.id, 'status', v_rule.status, 'version', v_rule.version
  )::text, 'utf8'), 'sha256');

  update public.product_matching_rule_revisions matching
  set status = 'superseded',
      version = matching.version + 1
  where matching.product_id = v_rule.product_id
    and matching.id <> v_rule.id
    and matching.status = 'active';
  update public.product_matching_rule_revisions matching
  set status = 'active',
      activated_at = clock_timestamp(),
      version = matching.version + 1
  where matching.id = v_rule.id;

  select correction.profile_id into v_profile_id
  from public.barcode_corrections correction
  where correction.id = v_rule.correction_id;
  v_new_hash := extensions.digest(convert_to(jsonb_build_object(
    'id', v_rule.id, 'status', 'active', 'version', v_rule.version + 1
  )::text, 'utf8'), 'sha256');
  perform private.record_product_admin_intent(
    v_actor_id,
    private.admin_product_effective_profile(p_auth_session_id, v_profile_id),
    'matching_rule_activate',
    'product_matching_rule',
    v_rule.id,
    p_request_id,
    v_previous_hash,
    v_new_hash,
    p_external_sequence,
    p_external_timestamp,
    p_external_record_hash,
    p_external_receipt_signature,
    p_external_key_version,
    p_external_idempotency_hash
  );
  v_response := jsonb_build_object(
    'schemaVersion', 1,
    'matchingRuleId', v_rule.id,
    'status', 'active',
    'version', v_rule.version + 1
  );
  perform private.admin_product_store_idempotency(
    p_request_id, v_actor_id, 'matching-rule-activate', p_matching_rule_id,
    v_digest, v_response
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
    p_external_sequence,
    p_external_timestamp,
    p_external_record_hash,
    p_external_receipt_signature,
    p_external_key_version,
    p_external_idempotency_hash
  );
  if not (
    (p_action = 'impersonation_start' and p_target_type = 'profile')
    or (
      p_action = 'impersonation_end'
      and p_target_type = 'impersonation_session'
      and p_impersonation_session_id = p_target_id
    )
    or (p_action = 'barcode_correction_correct' and p_target_type = 'barcode_correction')
    or (
      p_action = 'barcode_correction_approve'
      and p_target_type = 'commercial_product_revision'
    )
    or (p_action = 'barcode_correction_reject' and p_target_type = 'barcode_correction')
    or (p_action = 'matching_rule_activate' and p_target_type = 'product_matching_rule')
  ) then
    raise exception using errcode = '22023', message = 'invalid_reconciliation_action';
  end if;
  if not exists (
    select 1 from public.actors actor
    where actor.id = p_original_actor_id
      and actor.role = 'superadmin'
      and actor.disabled_at is null
  ) then
    raise exception using errcode = '42501', message = 'superadmin_required';
  end if;
  if exists (
    select 1 from private.audit_outbox outbox
    where outbox.request_id = p_request_id
  ) then
    raise exception using errcode = '55000', message = 'audit_outbox_exists';
  end if;
  select * into v_existing
  from private.technical_audit_events event
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
    actor_id,
    action,
    target_type,
    target_id,
    result,
    request_id,
    phase,
    original_actor_id,
    effective_profile_id,
    impersonation_session_id,
    external_sequence,
    external_timestamp,
    external_record_hash,
    external_receipt_signature,
    external_key_version,
    external_idempotency_hash
  ) values (
    p_original_actor_id,
    p_action,
    p_target_type,
    p_target_id,
    'failure',
    p_request_id,
    'reconciliation',
    p_original_actor_id,
    p_effective_profile_id,
    p_impersonation_session_id,
    p_external_sequence,
    p_external_timestamp,
    p_external_record_hash,
    p_external_receipt_signature,
    p_external_key_version,
    p_external_idempotency_hash
  );
  return true;
end;
$$;

create function public.internal_admin_list_barcode_corrections(
  p_auth_subject uuid,
  p_auth_session_id uuid,
  p_status text,
  p_cursor uuid,
  p_limit integer
)
returns table (
  correction_id uuid,
  profile_id uuid,
  gtin14 text,
  name text,
  brand text,
  completeness text,
  status text,
  version integer,
  duplicate_count bigint,
  created_at timestamptz
)
language sql
security definer
set search_path = pg_catalog
as $$
  select * from private.list_admin_barcode_corrections(
    p_auth_subject, p_auth_session_id, p_status, p_cursor, p_limit
  )
$$;

create function public.internal_admin_get_barcode_correction(
  p_auth_subject uuid,
  p_auth_session_id uuid,
  p_correction_id uuid
)
returns table (
  correction_id uuid,
  profile_id uuid,
  product_id uuid,
  review_revision_id uuid,
  status text,
  version integer,
  created_at timestamptz,
  proposed_snapshot jsonb,
  base_snapshot jsonb,
  global_snapshot jsonb
)
language sql
security definer
set search_path = pg_catalog
as $$
  select * from private.get_admin_barcode_correction(
    p_auth_subject, p_auth_session_id, p_correction_id
  )
$$;

create function public.internal_admin_product_audit_context(
  p_auth_subject uuid,
  p_auth_session_id uuid,
  p_action text,
  p_target_id uuid
)
returns table (
  original_actor_id uuid,
  effective_profile_id uuid,
  audit_target_id uuid,
  audit_target_type text
)
language sql
security definer
set search_path = pg_catalog
as $$
  select * from private.admin_product_audit_context(
    p_auth_subject, p_auth_session_id, p_action, p_target_id
  )
$$;

create function public.internal_admin_correct_barcode_correction(
  p_auth_subject uuid,
  p_auth_session_id uuid,
  p_correction_id uuid,
  p_expected_version integer,
  p_snapshot jsonb,
  p_completeness text,
  p_uncertainties jsonb,
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
  select private.correct_admin_barcode_correction(
    p_auth_subject, p_auth_session_id, p_correction_id, p_expected_version,
    p_snapshot, p_completeness, p_uncertainties, p_request_id,
    p_external_sequence, p_external_timestamp, p_external_record_hash,
    p_external_receipt_signature, p_external_key_version,
    p_external_idempotency_hash
  )
$$;

create function public.internal_admin_approve_barcode_correction(
  p_auth_subject uuid,
  p_auth_session_id uuid,
  p_correction_id uuid,
  p_expected_version integer,
  p_canonical_food_key text,
  p_match_state text,
  p_evidence jsonb,
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
  select private.approve_admin_barcode_correction(
    p_auth_subject, p_auth_session_id, p_correction_id, p_expected_version,
    p_canonical_food_key, p_match_state, p_evidence, p_request_id,
    p_external_sequence, p_external_timestamp, p_external_record_hash,
    p_external_receipt_signature, p_external_key_version,
    p_external_idempotency_hash
  )
$$;

create function public.internal_admin_reject_barcode_correction(
  p_auth_subject uuid,
  p_auth_session_id uuid,
  p_correction_id uuid,
  p_expected_version integer,
  p_reason text,
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
  select private.reject_admin_barcode_correction(
    p_auth_subject, p_auth_session_id, p_correction_id, p_expected_version,
    p_reason, p_request_id, p_external_sequence, p_external_timestamp,
    p_external_record_hash, p_external_receipt_signature,
    p_external_key_version, p_external_idempotency_hash
  )
$$;

create function public.internal_admin_activate_product_matching_rule(
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
  select private.activate_admin_product_matching_rule(
    p_auth_subject, p_auth_session_id, p_matching_rule_id, p_expected_version,
    p_request_id, p_external_sequence, p_external_timestamp,
    p_external_record_hash, p_external_receipt_signature,
    p_external_key_version, p_external_idempotency_hash
  )
$$;

revoke all on function private.record_product_admin_intent(
  uuid, uuid, text, text, uuid, uuid, bytea, bytea, bigint, timestamptz,
  bytea, bytea, integer, bytea
) from public, anon, authenticated, service_role;
revoke all on function private.admin_product_effective_profile(uuid, uuid)
from public, anon, authenticated, service_role;
revoke all on function private.admin_product_replay(uuid, uuid, text, uuid, bytea)
from public, anon, authenticated, service_role;
revoke all on function private.admin_product_store_idempotency(
  uuid, uuid, text, uuid, bytea, jsonb
) from public, anon, authenticated, service_role;
revoke all on function private.list_admin_barcode_corrections(
  uuid, uuid, text, uuid, integer
) from public, anon, authenticated, service_role;
revoke all on function private.get_admin_barcode_correction(uuid, uuid, uuid)
from public, anon, authenticated, service_role;
revoke all on function private.admin_product_audit_context(uuid, uuid, text, uuid)
from public, anon, authenticated, service_role;
revoke all on function private.correct_admin_barcode_correction(
  uuid, uuid, uuid, integer, jsonb, text, jsonb, uuid, bigint, timestamptz,
  bytea, bytea, integer, bytea
) from public, anon, authenticated, service_role;
revoke all on function private.approve_admin_barcode_correction(
  uuid, uuid, uuid, integer, text, text, jsonb, uuid, bigint, timestamptz,
  bytea, bytea, integer, bytea
) from public, anon, authenticated, service_role;
revoke all on function private.reject_admin_barcode_correction(
  uuid, uuid, uuid, integer, text, uuid, bigint, timestamptz, bytea, bytea,
  integer, bytea
) from public, anon, authenticated, service_role;
revoke all on function private.activate_admin_product_matching_rule(
  uuid, uuid, uuid, integer, uuid, bigint, timestamptz, bytea, bytea, integer, bytea
) from public, anon, authenticated, service_role;

revoke all on function public.internal_admin_list_barcode_corrections(
  uuid, uuid, text, uuid, integer
) from public, anon, authenticated;
revoke all on function public.internal_admin_get_barcode_correction(uuid, uuid, uuid)
from public, anon, authenticated;
revoke all on function public.internal_admin_product_audit_context(uuid, uuid, text, uuid)
from public, anon, authenticated;
revoke all on function public.internal_admin_correct_barcode_correction(
  uuid, uuid, uuid, integer, jsonb, text, jsonb, uuid, bigint, timestamptz,
  bytea, bytea, integer, bytea
) from public, anon, authenticated;
revoke all on function public.internal_admin_approve_barcode_correction(
  uuid, uuid, uuid, integer, text, text, jsonb, uuid, bigint, timestamptz,
  bytea, bytea, integer, bytea
) from public, anon, authenticated;
revoke all on function public.internal_admin_reject_barcode_correction(
  uuid, uuid, uuid, integer, text, uuid, bigint, timestamptz, bytea, bytea,
  integer, bytea
) from public, anon, authenticated;
revoke all on function public.internal_admin_activate_product_matching_rule(
  uuid, uuid, uuid, integer, uuid, bigint, timestamptz, bytea, bytea, integer, bytea
) from public, anon, authenticated;

grant execute on function public.internal_admin_list_barcode_corrections(
  uuid, uuid, text, uuid, integer
) to service_role;
grant execute on function public.internal_admin_get_barcode_correction(uuid, uuid, uuid)
to service_role;
grant execute on function public.internal_admin_product_audit_context(uuid, uuid, text, uuid)
to service_role;
grant execute on function public.internal_admin_correct_barcode_correction(
  uuid, uuid, uuid, integer, jsonb, text, jsonb, uuid, bigint, timestamptz,
  bytea, bytea, integer, bytea
) to service_role;
grant execute on function public.internal_admin_approve_barcode_correction(
  uuid, uuid, uuid, integer, text, text, jsonb, uuid, bigint, timestamptz,
  bytea, bytea, integer, bytea
) to service_role;
grant execute on function public.internal_admin_reject_barcode_correction(
  uuid, uuid, uuid, integer, text, uuid, bigint, timestamptz, bytea, bytea,
  integer, bytea
) to service_role;
grant execute on function public.internal_admin_activate_product_matching_rule(
  uuid, uuid, uuid, integer, uuid, bigint, timestamptz, bytea, bytea, integer, bytea
) to service_role;
