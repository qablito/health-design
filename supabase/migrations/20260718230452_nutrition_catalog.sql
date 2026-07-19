create table public.nutrition_sources (
  id uuid primary key,
  source_key text not null unique check (
    source_key in (
      'ciqual_2025', 'bls_4_0', 'fineli', 'livsmedelsverket',
      'usda_foundation', 'usda_sr_legacy'
    )
  ),
  name text not null check (length(btrim(name)) between 1 and 160),
  precedence smallint not null unique check (precedence between 1 and 6),
  license_reference text not null
    check (length(btrim(license_reference)) between 1 and 256),
  created_at timestamptz not null default clock_timestamp()
);

insert into public.nutrition_sources (
  id, source_key, name, precedence, license_reference
) values
  (
    '19000000-0000-4000-8000-000000000001', 'ciqual_2025',
    'ANSES-CIQUAL 2025', 1, 'Licence Ouverte 2.0'
  ),
  (
    '19000000-0000-4000-8000-000000000002', 'bls_4_0',
    'Bundeslebensmittelschlüssel 4.0', 2, 'CC BY 4.0'
  ),
  (
    '19000000-0000-4000-8000-000000000003', 'fineli',
    'Fineli', 3, 'THL open data terms'
  ),
  (
    '19000000-0000-4000-8000-000000000004', 'livsmedelsverket',
    'Livsmedelsverket', 4, 'CC BY'
  ),
  (
    '19000000-0000-4000-8000-000000000005', 'usda_foundation',
    'USDA Foundation Foods', 5, 'US public domain'
  ),
  (
    '19000000-0000-4000-8000-000000000006', 'usda_sr_legacy',
    'USDA SR Legacy', 6, 'US public domain'
  );

create table public.nutrition_source_manifests (
  id uuid primary key default gen_random_uuid(),
  import_key text not null unique
    check (import_key ~ '^manifest:[0-9a-f]{64}$'),
  source_id uuid not null
    references public.nutrition_sources (id) on delete restrict,
  source_version text not null
    check (length(btrim(source_version)) between 1 and 128),
  license_status text not null
    check (license_status in ('approved', 'restricted', 'unknown')),
  retrieved_at timestamptz not null,
  transformations jsonb not null check (
    jsonb_typeof(transformations) = 'array'
    and octet_length(transformations::text) <= 65536
  ),
  coverage jsonb not null default '{}'::jsonb check (
    jsonb_typeof(coverage) = 'object'
    and octet_length(coverage::text) <= 65536
  ),
  raw_content_hash bytea not null check (octet_length(raw_content_hash) = 32),
  normalized_content_hash bytea not null
    check (octet_length(normalized_content_hash) = 32),
  hash_algorithm text not null default 'sha256' check (hash_algorithm = 'sha256'),
  canonicalization_version text not null check (
    canonicalization_version ~ '^[a-z0-9][a-z0-9._-]{0,63}$'
  ),
  status text not null default 'quarantined'
    check (status in ('quarantined', 'validated', 'rejected')),
  staged_request_id uuid not null unique,
  staged_by uuid not null references public.actors (id) on delete restrict,
  reviewed_by uuid references public.actors (id) on delete restrict,
  reviewed_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  check (raw_content_hash <> normalized_content_hash),
  check (
    (status = 'quarantined' and reviewed_by is null and reviewed_at is null)
    or (status in ('validated', 'rejected') and reviewed_by is not null and reviewed_at is not null)
  )
);

create index nutrition_source_manifests_source_created_idx
on public.nutrition_source_manifests (source_id, created_at desc);
create index nutrition_source_manifests_staged_by_idx
on public.nutrition_source_manifests (staged_by, created_at desc);
create index nutrition_source_manifests_reviewed_by_idx
on public.nutrition_source_manifests (reviewed_by)
where reviewed_by is not null;

create table public.canonical_foods (
  id uuid primary key default gen_random_uuid(),
  food_key text not null unique check (food_key ~ '^food:[a-z0-9][a-z0-9._:-]{0,127}$'),
  name text not null check (length(btrim(name)) between 1 and 200),
  category text not null check (category ~ '^[a-z][a-z0-9_]{0,63}$'),
  food_state text not null check (food_state in ('raw', 'cooked', 'unspecified')),
  edible_part text not null check (edible_part ~ '^[a-z][a-z0-9_]{0,95}$'),
  active boolean not null default false,
  created_at timestamptz not null default clock_timestamp()
);

create table public.canonical_food_aliases (
  id uuid primary key default gen_random_uuid(),
  canonical_food_id uuid not null
    references public.canonical_foods (id) on delete restrict,
  alias text not null check (length(btrim(alias)) between 1 and 200),
  alias_normalized text generated always as (
    lower(regexp_replace(btrim(alias), ' +', ' ', 'g'))
  ) stored,
  source_manifest_id uuid not null
    references public.nutrition_source_manifests (id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  unique (canonical_food_id, alias_normalized)
);

create index canonical_food_aliases_manifest_idx
on public.canonical_food_aliases (source_manifest_id);

create table public.nutrition_nutrients (
  id uuid primary key,
  nutrient_key text not null unique check (nutrient_key ~ '^[a-z][a-z0-9_]{0,63}$'),
  nutrient_class text not null check (
    nutrient_class in (
      'energy', 'protein', 'carbohydrates', 'sugars', 'fiber', 'total_fat',
      'saturated_fat', 'monounsaturated_fat', 'polyunsaturated_fat',
      'sodium', 'salt', 'vitamin', 'mineral'
    )
  ),
  canonical_unit text not null check (
    canonical_unit in ('g', 'mg', 'ug', 'kcal', 'kJ')
  ),
  created_at timestamptz not null default clock_timestamp()
);

insert into public.nutrition_nutrients (
  id, nutrient_key, nutrient_class, canonical_unit
) values
  ('29000000-0000-4000-8000-000000000001', 'energy_kcal', 'energy', 'kcal'),
  ('29000000-0000-4000-8000-000000000002', 'protein', 'protein', 'g'),
  ('29000000-0000-4000-8000-000000000003', 'carbohydrates', 'carbohydrates', 'g'),
  ('29000000-0000-4000-8000-000000000004', 'fat', 'total_fat', 'g'),
  ('29000000-0000-4000-8000-000000000005', 'fiber', 'fiber', 'g'),
  ('29000000-0000-4000-8000-000000000006', 'sugars', 'sugars', 'g'),
  ('29000000-0000-4000-8000-000000000007', 'saturated_fat', 'saturated_fat', 'g'),
  ('29000000-0000-4000-8000-000000000008', 'monounsaturated_fat', 'monounsaturated_fat', 'g'),
  ('29000000-0000-4000-8000-000000000009', 'polyunsaturated_fat', 'polyunsaturated_fat', 'g'),
  ('29000000-0000-4000-8000-000000000010', 'sodium', 'sodium', 'g'),
  ('29000000-0000-4000-8000-000000000011', 'salt', 'salt', 'g'),
  ('29000000-0000-4000-8000-000000000012', 'vitamin_c', 'vitamin', 'mg'),
  ('29000000-0000-4000-8000-000000000013', 'vitamin_b12', 'vitamin', 'ug'),
  ('29000000-0000-4000-8000-000000000014', 'folate', 'vitamin', 'ug'),
  ('29000000-0000-4000-8000-000000000015', 'calcium', 'mineral', 'mg'),
  ('29000000-0000-4000-8000-000000000016', 'iron', 'mineral', 'mg'),
  ('29000000-0000-4000-8000-000000000017', 'magnesium', 'mineral', 'mg'),
  ('29000000-0000-4000-8000-000000000018', 'potassium', 'mineral', 'mg'),
  ('29000000-0000-4000-8000-000000000019', 'zinc', 'mineral', 'mg'),
  ('29000000-0000-4000-8000-000000000020', 'iodine', 'mineral', 'ug'),
  ('29000000-0000-4000-8000-000000000021', 'selenium', 'mineral', 'ug');

create table public.food_composition_revisions (
  id uuid primary key default gen_random_uuid(),
  import_key text not null unique check (import_key ~ '^revision:[0-9a-f]{64}$'),
  canonical_food_id uuid not null
    references public.canonical_foods (id) on delete restrict,
  source_manifest_id uuid not null
    references public.nutrition_source_manifests (id) on delete restrict,
  basis text not null check (basis in ('per_100_g', 'per_100_ml', 'per_serving')),
  food_state text not null check (food_state in ('raw', 'cooked', 'unspecified')),
  edible_part text not null check (edible_part ~ '^[a-z][a-z0-9_]{0,95}$'),
  method text not null check (length(btrim(method)) between 1 and 160),
  source_version text not null
    check (length(btrim(source_version)) between 1 and 128),
  observed_at date,
  confidence text not null default 'moderate'
    check (confidence in ('high', 'moderate', 'low', 'unknown')),
  status text not null default 'quarantined'
    check (status in ('quarantined', 'validated', 'rejected')),
  validation jsonb not null default '{}'::jsonb check (
    jsonb_typeof(validation) = 'object'
    and octet_length(validation::text) <= 65536
  ),
  reviewed_by uuid references public.actors (id) on delete restrict,
  reviewed_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  check (
    (status = 'quarantined' and reviewed_by is null and reviewed_at is null)
    or (status in ('validated', 'rejected') and reviewed_by is not null and reviewed_at is not null)
  ),
  unique (
    canonical_food_id, source_manifest_id, basis, food_state, edible_part, method
  )
);

create index food_composition_revisions_food_created_idx
on public.food_composition_revisions (canonical_food_id, created_at desc);
create index food_composition_revisions_manifest_idx
on public.food_composition_revisions (source_manifest_id);
create index food_composition_revisions_reviewed_by_idx
on public.food_composition_revisions (reviewed_by)
where reviewed_by is not null;

create table public.nutrient_observations (
  id uuid primary key default gen_random_uuid(),
  food_revision_id uuid not null
    references public.food_composition_revisions (id) on delete restrict,
  nutrient_id uuid not null
    references public.nutrition_nutrients (id) on delete restrict,
  source_manifest_id uuid not null
    references public.nutrition_source_manifests (id) on delete restrict,
  value_state text not null check (
    value_state in (
      'known', 'missing', 'estimated', 'stale', 'conflicting', 'trace', 'less_than'
    )
  ),
  original_value_text text,
  original_value numeric,
  original_unit text not null check (
    original_unit in ('g', 'mg', 'ug', 'kcal', 'kJ')
  ),
  normalized_value numeric,
  normalized_unit text not null check (
    normalized_unit in ('g', 'mg', 'ug', 'kcal', 'kJ')
  ),
  interval_minimum numeric,
  interval_maximum numeric,
  basis text not null check (basis in ('per_100_g', 'per_100_ml', 'per_serving')),
  food_state text not null check (food_state in ('raw', 'cooked', 'unspecified')),
  created_at timestamptz not null default clock_timestamp(),
  unique (food_revision_id, nutrient_id),
  check (
    (
      value_state = 'missing'
      and original_value_text is null
      and original_value is null
      and normalized_value is null
      and interval_minimum is null
      and interval_maximum is null
    )
    or (
      value_state in ('known', 'estimated', 'stale', 'conflicting')
      and original_value_text is not null
      and original_value is not null
      and normalized_value is not null
      and interval_minimum is null
      and interval_maximum is null
    )
    or (
      value_state in ('trace', 'less_than')
      and original_value_text is not null
      and original_value is null
      and normalized_value is null
      and interval_minimum is not null
      and interval_maximum is not null
      and interval_minimum <= interval_maximum
    )
  )
);

create index nutrient_observations_nutrient_idx
on public.nutrient_observations (nutrient_id, food_revision_id);
create index nutrient_observations_manifest_idx
on public.nutrient_observations (source_manifest_id);

create table public.nutrition_reviews (
  id uuid primary key default gen_random_uuid(),
  canonical_food_id uuid not null
    references public.canonical_foods (id) on delete restrict,
  anchor_revision_id uuid not null
    references public.food_composition_revisions (id) on delete restrict,
  candidate_revision_id uuid not null
    references public.food_composition_revisions (id) on delete restrict,
  nutrient_id uuid references public.nutrition_nutrients (id) on delete restrict,
  review_kind text not null check (
    review_kind in ('manual_review', 'priority_review')
  ),
  reason text not null check (length(btrim(reason)) between 1 and 1000),
  comparison jsonb not null check (
    jsonb_typeof(comparison) = 'object'
    and octet_length(comparison::text) <= 65536
  ),
  status text not null default 'open' check (
    status in ('open', 'resolved_approved', 'resolved_rejected')
  ),
  decision text,
  justification text,
  opened_by uuid not null references public.actors (id) on delete restrict,
  opened_request_id uuid not null unique,
  reviewer_actor_id uuid references public.actors (id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  resolved_at timestamptz,
  check (anchor_revision_id <> candidate_revision_id),
  check (
    (status = 'open' and decision is null and justification is null
      and reviewer_actor_id is null and resolved_at is null)
    or (status in ('resolved_approved', 'resolved_rejected')
      and length(btrim(decision)) between 1 and 160
      and length(btrim(justification)) between 1 and 2000
      and reviewer_actor_id is not null and resolved_at is not null)
  )
);

create unique index nutrition_reviews_one_open_comparison_idx
on public.nutrition_reviews (
  anchor_revision_id, candidate_revision_id,
  coalesce(nutrient_id, '00000000-0000-0000-0000-000000000000'::uuid)
)
where status = 'open';
create index nutrition_reviews_food_status_idx
on public.nutrition_reviews (canonical_food_id, status, created_at desc);
create index nutrition_reviews_candidate_idx
on public.nutrition_reviews (candidate_revision_id, status);
create index nutrition_reviews_nutrient_idx
on public.nutrition_reviews (nutrient_id)
where nutrient_id is not null;
create index nutrition_reviews_opened_by_idx
on public.nutrition_reviews (opened_by);
create index nutrition_reviews_reviewer_idx
on public.nutrition_reviews (reviewer_actor_id)
where reviewer_actor_id is not null;

create table public.effective_food_revisions (
  id uuid primary key default gen_random_uuid(),
  canonical_food_id uuid not null
    references public.canonical_foods (id) on delete restrict,
  resolution_context jsonb not null check (
    jsonb_typeof(resolution_context) = 'object'
    and octet_length(resolution_context::text) <= 8192
  ),
  resolution_context_hash bytea not null
    check (octet_length(resolution_context_hash) = 32),
  revision_id uuid not null
    references public.food_composition_revisions (id) on delete restrict,
  precedence_reason text not null
    check (length(btrim(precedence_reason)) between 1 and 1000),
  activated_at timestamptz not null default clock_timestamp(),
  approved_by uuid not null references public.actors (id) on delete restrict,
  superseded_at timestamptz,
  check (superseded_at is null or superseded_at >= activated_at)
);

create unique index effective_food_revisions_one_active_context_idx
on public.effective_food_revisions (canonical_food_id, resolution_context_hash)
where superseded_at is null;
create index effective_food_revisions_history_idx
on public.effective_food_revisions (
  canonical_food_id, resolution_context_hash, activated_at desc
);
create index effective_food_revisions_revision_idx
on public.effective_food_revisions (revision_id);
create index effective_food_revisions_approved_by_idx
on public.effective_food_revisions (approved_by);

alter table public.nutrition_sources enable row level security;
alter table public.nutrition_source_manifests enable row level security;
alter table public.canonical_foods enable row level security;
alter table public.canonical_food_aliases enable row level security;
alter table public.nutrition_nutrients enable row level security;
alter table public.food_composition_revisions enable row level security;
alter table public.nutrient_observations enable row level security;
alter table public.nutrition_reviews enable row level security;
alter table public.effective_food_revisions enable row level security;

revoke all on table public.nutrition_sources from public, anon, authenticated;
revoke all on table public.nutrition_source_manifests from public, anon, authenticated;
revoke all on table public.canonical_foods from public, anon, authenticated;
revoke all on table public.canonical_food_aliases from public, anon, authenticated;
revoke all on table public.nutrition_nutrients from public, anon, authenticated;
revoke all on table public.food_composition_revisions from public, anon, authenticated;
revoke all on table public.nutrient_observations from public, anon, authenticated;
revoke all on table public.nutrition_reviews from public, anon, authenticated;
revoke all on table public.effective_food_revisions from public, anon, authenticated;

grant select on table public.nutrition_sources to service_role;
grant select on table public.nutrition_source_manifests to service_role;
grant select on table public.canonical_foods to service_role;
grant select on table public.canonical_food_aliases to service_role;
grant select on table public.nutrition_nutrients to service_role;
grant select on table public.food_composition_revisions to service_role;
grant select on table public.nutrient_observations to service_role;
grant select on table public.nutrition_reviews to service_role;
grant select on table public.effective_food_revisions to service_role;

create function private.reject_nutrition_observation_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  raise exception using errcode = '55000', message = 'immutable_nutrition_observation';
end;
$$;

create trigger nutrient_observations_are_immutable
before update or delete on public.nutrient_observations
for each row execute function private.reject_nutrition_observation_mutation();

create function private.guard_nutrition_revision_update()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  if old.status = 'quarantined'
    and new.status in ('validated', 'rejected')
    and new.import_key = old.import_key
    and new.canonical_food_id = old.canonical_food_id
    and new.source_manifest_id = old.source_manifest_id
    and new.basis = old.basis
    and new.food_state = old.food_state
    and new.edible_part = old.edible_part
    and new.method = old.method
    and new.source_version = old.source_version
    and new.observed_at is not distinct from old.observed_at
    and new.confidence = old.confidence
    and new.created_at = old.created_at
    and new.reviewed_by is not null
    and new.reviewed_at is not null
  then
    return new;
  end if;
  raise exception using errcode = '55000', message = 'immutable_food_revision';
end;
$$;

create trigger food_composition_revisions_are_guarded
before update or delete on public.food_composition_revisions
for each row execute function private.guard_nutrition_revision_update();

create function private.guard_nutrition_manifest_update()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  if old.status = 'quarantined'
    and new.status in ('validated', 'rejected')
    and new.import_key = old.import_key
    and new.source_id = old.source_id
    and new.source_version = old.source_version
    and new.license_status = old.license_status
    and new.retrieved_at = old.retrieved_at
    and new.transformations = old.transformations
    and new.coverage = old.coverage
    and new.raw_content_hash = old.raw_content_hash
    and new.normalized_content_hash = old.normalized_content_hash
    and new.hash_algorithm = old.hash_algorithm
    and new.canonicalization_version = old.canonicalization_version
    and new.staged_request_id = old.staged_request_id
    and new.staged_by = old.staged_by
    and new.created_at = old.created_at
    and new.reviewed_by is not null
    and new.reviewed_at is not null
  then
    return new;
  end if;
  raise exception using errcode = '55000', message = 'immutable_source_manifest';
end;
$$;

create trigger nutrition_source_manifests_are_guarded
before update or delete on public.nutrition_source_manifests
for each row execute function private.guard_nutrition_manifest_update();

create function private.guard_effective_food_revision_update()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  if old.superseded_at is null
    and new.superseded_at is not null
    and new.id = old.id
    and new.canonical_food_id = old.canonical_food_id
    and new.resolution_context = old.resolution_context
    and new.resolution_context_hash = old.resolution_context_hash
    and new.revision_id = old.revision_id
    and new.precedence_reason = old.precedence_reason
    and new.activated_at = old.activated_at
    and new.approved_by = old.approved_by
  then
    return new;
  end if;
  raise exception using errcode = '55000', message = 'immutable_effective_food_revision';
end;
$$;

create trigger effective_food_revisions_are_guarded
before update or delete on public.effective_food_revisions
for each row execute function private.guard_effective_food_revision_update();

create function private.record_nutrition_audit(
  p_actor_id uuid,
  p_action text,
  p_target_type text,
  p_target_id uuid,
  p_request_id uuid
)
returns void
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  insert into private.technical_audit_events (
    actor_id, action, target_type, target_id, result, request_id,
    phase, original_actor_id
  ) values (
    p_actor_id, p_action, p_target_type, p_target_id, 'success', p_request_id,
    'outcome', p_actor_id
  );
end;
$$;

create function private.stage_nutrition_batch(
  p_auth_subject uuid,
  p_auth_session_id uuid,
  p_request_id uuid,
  p_batch jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_actor_id uuid;
  v_alias jsonb;
  v_existing public.nutrition_source_manifests%rowtype;
  v_food public.canonical_foods%rowtype;
  v_manifest public.nutrition_source_manifests%rowtype;
  v_nutrient public.nutrition_nutrients%rowtype;
  v_nutrient_entry record;
  v_observation jsonb;
  v_original_text text;
  v_revision public.food_composition_revisions%rowtype;
  v_revision_json jsonb;
  v_revision_count integer := 0;
  v_source public.nutrition_sources%rowtype;
begin
  v_actor_id := private.require_superadmin_aal2(p_auth_subject, p_auth_session_id);

  select * into v_existing
  from public.nutrition_source_manifests manifest
  where manifest.staged_request_id = p_request_id;
  if v_existing.id is not null then
    if jsonb_typeof(p_batch) is distinct from 'object'
      or p_batch -> 'manifest' ->> 'id' is distinct from v_existing.import_key
    then
      raise exception using errcode = '23505', message = 'idempotency_key_reused';
    end if;
    return jsonb_build_object(
      'manifest_id', v_existing.id,
      'revision_count', (
        select count(*)
        from public.food_composition_revisions revision
        where revision.source_manifest_id = v_existing.id
      ),
      'revisions', coalesce((
        select jsonb_agg(jsonb_build_object(
          'canonical_food_id', revision.canonical_food_id,
          'import_key', revision.import_key,
          'revision_id', revision.id,
          'status', revision.status
        ) order by revision.import_key)
        from public.food_composition_revisions revision
        where revision.source_manifest_id = v_existing.id
      ), '[]'::jsonb),
      'status', v_existing.status
    );
  end if;

  if p_batch is null
    or jsonb_typeof(p_batch) is distinct from 'object'
    or octet_length(p_batch::text) > 33554432
    or p_batch ->> 'status' is distinct from 'quarantined'
    or coalesce((p_batch ->> 'publicationCount')::integer, -1) <> 0
    or jsonb_typeof(p_batch -> 'violations') is distinct from 'array'
    or jsonb_array_length(p_batch -> 'violations') <> 0
    or jsonb_typeof(p_batch -> 'manifest') is distinct from 'object'
    or jsonb_typeof(p_batch -> 'revisions') is distinct from 'array'
    or jsonb_array_length(p_batch -> 'revisions') = 0
    or jsonb_array_length(p_batch -> 'revisions') > 100000
  then
    raise exception using errcode = '22023', message = 'invalid_nutrition_batch';
  end if;

  if p_batch -> 'manifest' ->> 'licenseStatus' is distinct from 'approved'
    or p_batch -> 'manifest' ->> 'hashAlgorithm' is distinct from 'sha256'
    or p_batch -> 'manifest' ->> 'canonicalizationVersion'
      !~ '^[a-z0-9][a-z0-9._-]{0,63}$'
    or p_batch -> 'manifest' ->> 'id' !~ '^manifest:[0-9a-f]{64}$'
    or p_batch -> 'manifest' ->> 'rawContentHash' !~ '^[0-9a-f]{64}$'
    or p_batch -> 'manifest' ->> 'normalizedContentHash' !~ '^[0-9a-f]{64}$'
    or p_batch -> 'manifest' ->> 'rawContentHash'
      is not distinct from p_batch -> 'manifest' ->> 'normalizedContentHash'
    or jsonb_typeof(p_batch -> 'manifest' -> 'transformations')
      is distinct from 'array'
    or octet_length((p_batch -> 'manifest' -> 'transformations')::text) > 65536
  then
    raise exception using errcode = '22023', message = 'invalid_source_manifest';
  end if;

  select * into v_source
  from public.nutrition_sources source
  where source.source_key = p_batch -> 'manifest' ->> 'sourceKey';
  if v_source.id is null then
    raise exception using errcode = '22023', message = 'nutrition_source_not_supported';
  end if;

  insert into public.nutrition_source_manifests (
    import_key, source_id, source_version, license_status, retrieved_at,
    transformations, raw_content_hash, normalized_content_hash,
    hash_algorithm, canonicalization_version, staged_request_id, staged_by
  ) values (
    p_batch -> 'manifest' ->> 'id',
    v_source.id,
    p_batch -> 'manifest' ->> 'sourceVersion',
    p_batch -> 'manifest' ->> 'licenseStatus',
    (p_batch -> 'manifest' ->> 'retrievedAt')::timestamptz,
    p_batch -> 'manifest' -> 'transformations',
    decode(p_batch -> 'manifest' ->> 'rawContentHash', 'hex'),
    decode(p_batch -> 'manifest' ->> 'normalizedContentHash', 'hex'),
    p_batch -> 'manifest' ->> 'hashAlgorithm',
    p_batch -> 'manifest' ->> 'canonicalizationVersion',
    p_request_id,
    v_actor_id
  ) returning * into v_manifest;

  for v_revision_json in
    select entry.value from jsonb_array_elements(p_batch -> 'revisions') entry
  loop
    if jsonb_typeof(v_revision_json) is distinct from 'object'
      or v_revision_json ->> 'targetKind' is distinct from 'generic_food'
    then
      raise exception using errcode = '22023', message = 'commercial_product_not_allowed';
    end if;
    if v_revision_json ->> 'id' !~ '^revision:[0-9a-f]{64}$'
      or v_revision_json ->> 'canonicalFoodKey'
        !~ '^food:[a-z0-9][a-z0-9._:-]{0,127}$'
      or length(btrim(v_revision_json ->> 'name')) not between 1 and 200
      or v_revision_json ->> 'category' !~ '^[a-z][a-z0-9_]{0,63}$'
      or v_revision_json ->> 'basis' not in ('per_100_g', 'per_100_ml', 'per_serving')
      or v_revision_json ->> 'foodState' not in ('raw', 'cooked', 'unspecified')
      or v_revision_json ->> 'ediblePart' !~ '^[a-z][a-z0-9_]{0,95}$'
      or length(btrim(v_revision_json ->> 'method')) not between 1 and 160
      or v_revision_json ->> 'sourceKey' is distinct from v_source.source_key
      or v_revision_json ->> 'sourceVersion' is distinct from v_manifest.source_version
      or v_revision_json ->> 'status' is distinct from 'quarantined'
      or jsonb_typeof(v_revision_json -> 'aliases') is distinct from 'array'
      or jsonb_typeof(v_revision_json -> 'nutrients') is distinct from 'object'
      or (select count(*) from jsonb_object_keys(v_revision_json -> 'nutrients')) > 200
    then
      raise exception using errcode = '22023', message = 'invalid_food_revision';
    end if;

    select * into v_food
    from public.canonical_foods food
    where food.food_key = v_revision_json ->> 'canonicalFoodKey'
    for update;

    if v_food.id is null then
      insert into public.canonical_foods (
        food_key, name, category, food_state, edible_part
      ) values (
        v_revision_json ->> 'canonicalFoodKey',
        v_revision_json ->> 'name',
        v_revision_json ->> 'category',
        v_revision_json ->> 'foodState',
        v_revision_json ->> 'ediblePart'
      ) returning * into v_food;
    elsif v_food.food_state <> v_revision_json ->> 'foodState'
      or v_food.edible_part <> v_revision_json ->> 'ediblePart'
      or v_food.category <> v_revision_json ->> 'category'
    then
      raise exception using errcode = '22023', message = 'canonical_food_identity_conflict';
    end if;

    insert into public.food_composition_revisions (
      import_key, canonical_food_id, source_manifest_id, basis, food_state,
      edible_part, method, source_version
    ) values (
      v_revision_json ->> 'id', v_food.id, v_manifest.id,
      v_revision_json ->> 'basis', v_revision_json ->> 'foodState',
      v_revision_json ->> 'ediblePart', v_revision_json ->> 'method',
      v_revision_json ->> 'sourceVersion'
    ) returning * into v_revision;

    for v_alias in
      select entry.value from jsonb_array_elements(v_revision_json -> 'aliases') entry
    loop
      if jsonb_typeof(v_alias) <> 'string'
        or length(btrim(v_alias #>> '{}')) not between 1 and 200
      then
        raise exception using errcode = '22023', message = 'invalid_food_alias';
      end if;
      insert into public.canonical_food_aliases (
        canonical_food_id, alias, source_manifest_id
      ) values (v_food.id, v_alias #>> '{}', v_manifest.id)
      on conflict (canonical_food_id, alias_normalized) do nothing;
    end loop;

    for v_nutrient_entry in
      select entry.key, entry.value
      from jsonb_each(v_revision_json -> 'nutrients') entry
    loop
      v_observation := v_nutrient_entry.value;
      select * into v_nutrient
      from public.nutrition_nutrients nutrient
      where nutrient.nutrient_key = v_nutrient_entry.key;
      if v_nutrient.id is null
        or jsonb_typeof(v_observation) <> 'object'
        or v_observation ->> 'nutrientClass' <> v_nutrient.nutrient_class
        or v_observation ->> 'normalizedUnit' <> v_nutrient.canonical_unit
        or v_observation ->> 'basis' <> v_revision.basis
        or v_observation ->> 'foodState' <> v_revision.food_state
        or v_observation ->> 'state'
          not in ('known', 'missing', 'estimated', 'stale', 'conflicting')
      then
        raise exception using errcode = '22023', message = 'invalid_nutrient_observation';
      end if;

      v_original_text := v_observation ->> 'originalValue';
      if v_observation ->> 'state' = 'missing' then
        if v_observation -> 'originalValue' <> 'null'::jsonb
          or v_observation -> 'normalizedValue' <> 'null'::jsonb
        then
          raise exception using errcode = '22023', message = 'missing_is_not_zero';
        end if;
      elsif v_original_text is null
        or v_original_text !~ '^-?[0-9]+([.][0-9]+)?$'
        or v_observation ->> 'normalizedValue' !~ '^-?[0-9]+([.][0-9]+)?$'
      then
        raise exception using errcode = '22023', message = 'invalid_nutrient_value';
      end if;

      insert into public.nutrient_observations (
        food_revision_id, nutrient_id, source_manifest_id, value_state,
        original_value_text, original_value, original_unit,
        normalized_value, normalized_unit, basis, food_state
      ) values (
        v_revision.id, v_nutrient.id, v_manifest.id,
        v_observation ->> 'state',
        v_original_text,
        case when v_original_text is null then null else v_original_text::numeric end,
        v_observation ->> 'originalUnit',
        case when v_observation ->> 'normalizedValue' is null then null
          else (v_observation ->> 'normalizedValue')::numeric end,
        v_observation ->> 'normalizedUnit',
        v_observation ->> 'basis',
        v_observation ->> 'foodState'
      );
    end loop;
    v_revision_count := v_revision_count + 1;
  end loop;

  perform private.record_nutrition_audit(
    v_actor_id, 'nutrition_batch_stage', 'nutrition_source_manifest',
    v_manifest.id, p_request_id
  );
  return jsonb_build_object(
    'manifest_id', v_manifest.id,
    'publication_count', 0,
    'revision_count', v_revision_count,
    'revisions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'canonical_food_id', revision.canonical_food_id,
        'import_key', revision.import_key,
        'revision_id', revision.id,
        'status', revision.status
      ) order by revision.import_key)
      from public.food_composition_revisions revision
      where revision.source_manifest_id = v_manifest.id
    ), '[]'::jsonb),
    'status', 'quarantined'
  );
exception
  when invalid_text_representation or datetime_field_overflow or numeric_value_out_of_range then
    raise exception using errcode = '22023', message = 'invalid_nutrition_batch';
end;
$$;

create function private.validate_nutrition_revision(
  p_auth_subject uuid,
  p_auth_session_id uuid,
  p_revision_id uuid,
  p_justification text,
  p_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_actor_id uuid;
  v_revision public.food_composition_revisions%rowtype;
begin
  v_actor_id := private.require_superadmin_aal2(p_auth_subject, p_auth_session_id);
  if length(btrim(p_justification)) not between 1 and 2000 then
    raise exception using errcode = '22023', message = 'invalid_justification';
  end if;
  select * into v_revision
  from public.food_composition_revisions revision
  where revision.id = p_revision_id
  for update;
  if v_revision.id is null then
    raise exception using errcode = 'P0002', message = 'nutrition_revision_not_found';
  end if;
  if v_revision.status <> 'quarantined' then
    raise exception using errcode = '55000', message = 'nutrition_revision_not_quarantined';
  end if;
  if not exists (
    select 1 from public.nutrient_observations observation
    where observation.food_revision_id = v_revision.id
  ) then
    raise exception using errcode = '55000', message = 'nutrition_revision_empty';
  end if;
  if exists (
    select 1
    from public.nutrient_observations observation
    where observation.food_revision_id = v_revision.id
      and (
        observation.original_value < 0
        or observation.normalized_value < 0
        or observation.interval_minimum < 0
        or observation.interval_maximum < 0
      )
  ) then
    raise exception using
      errcode = '55000', message = 'nutrition_revision_negative_value';
  end if;

  update public.food_composition_revisions revision
  set status = 'validated',
      validation = jsonb_build_object('justification', p_justification),
      reviewed_by = v_actor_id,
      reviewed_at = clock_timestamp()
  where revision.id = v_revision.id;

  if not exists (
    select 1 from public.food_composition_revisions sibling
    where sibling.source_manifest_id = v_revision.source_manifest_id
      and sibling.status = 'quarantined'
  ) then
    update public.nutrition_source_manifests manifest
    set status = case
          when exists (
            select 1 from public.food_composition_revisions sibling
            where sibling.source_manifest_id = v_revision.source_manifest_id
              and sibling.status = 'rejected'
          ) then 'rejected'
          else 'validated'
        end,
        reviewed_by = v_actor_id,
        reviewed_at = clock_timestamp()
    where manifest.id = v_revision.source_manifest_id;
  end if;

  perform private.record_nutrition_audit(
    v_actor_id, 'nutrition_revision_validate', 'food_composition_revision',
    v_revision.id, p_request_id
  );
  return jsonb_build_object('revision_id', v_revision.id, 'status', 'validated');
end;
$$;

create function private.open_nutrition_review(
  p_auth_subject uuid,
  p_auth_session_id uuid,
  p_anchor_revision_id uuid,
  p_candidate_revision_id uuid,
  p_nutrient_key text,
  p_review_kind text,
  p_reason text,
  p_comparison jsonb,
  p_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_actor_id uuid;
  v_anchor public.food_composition_revisions%rowtype;
  v_candidate public.food_composition_revisions%rowtype;
  v_nutrient_id uuid;
  v_review public.nutrition_reviews%rowtype;
begin
  v_actor_id := private.require_superadmin_aal2(p_auth_subject, p_auth_session_id);
  select * into v_anchor from public.food_composition_revisions where id = p_anchor_revision_id;
  select * into v_candidate from public.food_composition_revisions where id = p_candidate_revision_id;
  if v_anchor.id is null or v_candidate.id is null then
    raise exception using errcode = 'P0002', message = 'nutrition_revision_not_found';
  end if;
  if v_anchor.canonical_food_id <> v_candidate.canonical_food_id then
    raise exception using errcode = '22023', message = 'nutrition_review_food_mismatch';
  end if;
  if p_review_kind not in ('manual_review', 'priority_review')
    or length(btrim(p_reason)) not between 1 and 1000
    or jsonb_typeof(p_comparison) <> 'object'
    or octet_length(p_comparison::text) > 65536
  then
    raise exception using errcode = '22023', message = 'invalid_nutrition_review';
  end if;
  if p_nutrient_key is not null then
    select id into v_nutrient_id
    from public.nutrition_nutrients where nutrient_key = p_nutrient_key;
    if v_nutrient_id is null then
      raise exception using errcode = '22023', message = 'nutrition_nutrient_not_found';
    end if;
  end if;

  select * into v_review
  from public.nutrition_reviews review
  where review.opened_request_id = p_request_id;
  if v_review.id is not null then
    if v_review.anchor_revision_id is distinct from v_anchor.id
      or v_review.candidate_revision_id is distinct from v_candidate.id
      or v_review.nutrient_id is distinct from v_nutrient_id
      or v_review.review_kind is distinct from p_review_kind
      or v_review.reason is distinct from p_reason
      or v_review.comparison is distinct from p_comparison
    then
      raise exception using errcode = '23505', message = 'idempotency_key_reused';
    end if;
    return jsonb_build_object('review_id', v_review.id, 'status', v_review.status);
  end if;

  insert into public.nutrition_reviews (
    canonical_food_id, anchor_revision_id, candidate_revision_id, nutrient_id,
    review_kind, reason, comparison, opened_by, opened_request_id
  ) values (
    v_anchor.canonical_food_id, v_anchor.id, v_candidate.id, v_nutrient_id,
    p_review_kind, p_reason, p_comparison, v_actor_id, p_request_id
  ) returning * into v_review;
  perform private.record_nutrition_audit(
    v_actor_id, 'nutrition_review_open', 'nutrition_review', v_review.id, p_request_id
  );
  return jsonb_build_object('review_id', v_review.id, 'status', v_review.status);
end;
$$;

create function private.list_nutrition_reviews(
  p_auth_subject uuid,
  p_auth_session_id uuid,
  p_status text default 'open'
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  perform private.require_superadmin_aal2(p_auth_subject, p_auth_session_id);
  if p_status not in ('open', 'resolved_approved', 'resolved_rejected') then
    raise exception using errcode = '22023', message = 'invalid_review_status';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'review_id', review.id,
      'canonical_food_id', review.canonical_food_id,
      'anchor_revision_id', review.anchor_revision_id,
      'candidate_revision_id', review.candidate_revision_id,
      'nutrient_key', nutrient.nutrient_key,
      'review_kind', review.review_kind,
      'reason', review.reason,
      'comparison', review.comparison,
      'status', review.status,
      'created_at', review.created_at
    ) order by review.created_at, review.id)
    from public.nutrition_reviews review
    left join public.nutrition_nutrients nutrient on nutrient.id = review.nutrient_id
    where review.status = p_status
  ), '[]'::jsonb);
end;
$$;

create function private.resolve_nutrition_review(
  p_auth_subject uuid,
  p_auth_session_id uuid,
  p_review_id uuid,
  p_resolution text,
  p_decision text,
  p_justification text,
  p_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_actor_id uuid;
  v_review public.nutrition_reviews%rowtype;
begin
  v_actor_id := private.require_superadmin_aal2(p_auth_subject, p_auth_session_id);
  if p_resolution not in ('approved', 'rejected')
    or length(btrim(p_decision)) not between 1 and 160
    or length(btrim(p_justification)) not between 1 and 2000
  then
    raise exception using errcode = '22023', message = 'invalid_review_resolution';
  end if;
  select * into v_review
  from public.nutrition_reviews review
  where review.id = p_review_id
  for update;
  if v_review.id is null then
    raise exception using errcode = 'P0002', message = 'nutrition_review_not_found';
  end if;
  if v_review.status <> 'open' then
    raise exception using errcode = '55000', message = 'nutrition_review_not_open';
  end if;
  update public.nutrition_reviews review
  set status = case when p_resolution = 'approved'
        then 'resolved_approved' else 'resolved_rejected' end,
      decision = p_decision,
      justification = p_justification,
      reviewer_actor_id = v_actor_id,
      resolved_at = clock_timestamp()
  where review.id = v_review.id;
  perform private.record_nutrition_audit(
    v_actor_id, 'nutrition_review_resolve', 'nutrition_review', v_review.id, p_request_id
  );
  return jsonb_build_object(
    'review_id', v_review.id,
    'status', case when p_resolution = 'approved'
      then 'resolved_approved' else 'resolved_rejected' end
  );
end;
$$;

create function private.activate_nutrition_revision(
  p_auth_subject uuid,
  p_auth_session_id uuid,
  p_revision_id uuid,
  p_resolution_context jsonb,
  p_resolution_context_hash bytea,
  p_precedence_reason text,
  p_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_actor_id uuid;
  v_effective public.effective_food_revisions%rowtype;
  v_revision public.food_composition_revisions%rowtype;
begin
  v_actor_id := private.require_superadmin_aal2(p_auth_subject, p_auth_session_id);
  if jsonb_typeof(p_resolution_context) <> 'object'
    or octet_length(p_resolution_context::text) > 8192
    or octet_length(p_resolution_context_hash) <> 32
    or length(btrim(p_precedence_reason)) not between 1 and 1000
  then
    raise exception using errcode = '22023', message = 'invalid_resolution_context';
  end if;
  select * into v_revision
  from public.food_composition_revisions revision
  where revision.id = p_revision_id
  for update;
  if v_revision.id is null then
    raise exception using errcode = 'P0002', message = 'nutrition_revision_not_found';
  end if;
  if p_resolution_context ->> 'basis' is distinct from v_revision.basis
    or p_resolution_context ->> 'foodState' is distinct from v_revision.food_state
    or p_resolution_context ->> 'ediblePart' is distinct from v_revision.edible_part
    or p_resolution_context ->> 'method' is distinct from v_revision.method
  then
    raise exception using errcode = '22023', message = 'resolution_context_mismatch';
  end if;
  if v_revision.status <> 'validated' then
    raise exception using errcode = '55000', message = 'nutrition_revision_not_validated';
  end if;
  if exists (
    select 1 from public.nutrition_reviews review
    where review.status = 'open'
      and (review.anchor_revision_id = v_revision.id
        or review.candidate_revision_id = v_revision.id)
  ) then
    raise exception using errcode = '55000', message = 'nutrition_review_open';
  end if;
  if exists (
    select 1 from public.nutrition_reviews review
    where review.status = 'resolved_rejected'
      and review.candidate_revision_id = v_revision.id
  ) then
    raise exception using errcode = '55000', message = 'nutrition_revision_rejected';
  end if;

  select * into v_effective
  from public.effective_food_revisions effective
  where effective.canonical_food_id = v_revision.canonical_food_id
    and effective.resolution_context_hash = p_resolution_context_hash
    and effective.superseded_at is null
  for update;
  if v_effective.id is not null and v_effective.revision_id = v_revision.id then
    return jsonb_build_object(
      'effective_revision_id', v_effective.id,
      'revision_id', v_effective.revision_id,
      'status', 'active'
    );
  end if;
  if v_effective.id is not null then
    update public.effective_food_revisions effective
    set superseded_at = clock_timestamp()
    where effective.id = v_effective.id;
  end if;
  insert into public.effective_food_revisions (
    canonical_food_id, resolution_context, resolution_context_hash,
    revision_id, precedence_reason, approved_by
  ) values (
    v_revision.canonical_food_id, p_resolution_context, p_resolution_context_hash,
    v_revision.id, p_precedence_reason, v_actor_id
  ) returning * into v_effective;
  update public.canonical_foods food
  set active = true
  where food.id = v_revision.canonical_food_id;
  perform private.record_nutrition_audit(
    v_actor_id, 'nutrition_revision_activate', 'effective_food_revision',
    v_effective.id, p_request_id
  );
  return jsonb_build_object(
    'effective_revision_id', v_effective.id,
    'revision_id', v_revision.id,
    'status', 'active'
  );
exception
  when unique_violation then
    raise exception using errcode = 'PT409', message = 'nutrition_activation_conflict';
end;
$$;

create function public.internal_nutrition_stage_batch(
  p_auth_subject uuid,
  p_auth_session_id uuid,
  p_request_id uuid,
  p_batch jsonb
)
returns jsonb
language sql
security definer
set search_path = pg_catalog
as $$
  select private.stage_nutrition_batch(
    p_auth_subject, p_auth_session_id, p_request_id, p_batch
  )
$$;

create function public.internal_nutrition_validate_revision(
  p_auth_subject uuid,
  p_auth_session_id uuid,
  p_revision_id uuid,
  p_justification text,
  p_request_id uuid
)
returns jsonb
language sql
security definer
set search_path = pg_catalog
as $$
  select private.validate_nutrition_revision(
    p_auth_subject, p_auth_session_id, p_revision_id, p_justification, p_request_id
  )
$$;

create function public.internal_nutrition_open_review(
  p_auth_subject uuid,
  p_auth_session_id uuid,
  p_anchor_revision_id uuid,
  p_candidate_revision_id uuid,
  p_nutrient_key text,
  p_review_kind text,
  p_reason text,
  p_comparison jsonb,
  p_request_id uuid
)
returns jsonb
language sql
security definer
set search_path = pg_catalog
as $$
  select private.open_nutrition_review(
    p_auth_subject, p_auth_session_id, p_anchor_revision_id,
    p_candidate_revision_id, p_nutrient_key, p_review_kind, p_reason,
    p_comparison, p_request_id
  )
$$;

create function public.internal_nutrition_list_reviews(
  p_auth_subject uuid,
  p_auth_session_id uuid,
  p_status text default 'open'
)
returns jsonb
language sql
security definer
set search_path = pg_catalog
as $$
  select private.list_nutrition_reviews(p_auth_subject, p_auth_session_id, p_status)
$$;

create function public.internal_nutrition_resolve_review(
  p_auth_subject uuid,
  p_auth_session_id uuid,
  p_review_id uuid,
  p_resolution text,
  p_decision text,
  p_justification text,
  p_request_id uuid
)
returns jsonb
language sql
security definer
set search_path = pg_catalog
as $$
  select private.resolve_nutrition_review(
    p_auth_subject, p_auth_session_id, p_review_id, p_resolution,
    p_decision, p_justification, p_request_id
  )
$$;

create function public.internal_nutrition_activate_revision(
  p_auth_subject uuid,
  p_auth_session_id uuid,
  p_revision_id uuid,
  p_resolution_context jsonb,
  p_resolution_context_hash bytea,
  p_precedence_reason text,
  p_request_id uuid
)
returns jsonb
language sql
security definer
set search_path = pg_catalog
as $$
  select private.activate_nutrition_revision(
    p_auth_subject, p_auth_session_id, p_revision_id, p_resolution_context,
    p_resolution_context_hash, p_precedence_reason, p_request_id
  )
$$;

revoke all on function private.reject_nutrition_observation_mutation()
from public, anon, authenticated, service_role;
revoke all on function private.guard_nutrition_revision_update()
from public, anon, authenticated, service_role;
revoke all on function private.guard_nutrition_manifest_update()
from public, anon, authenticated, service_role;
revoke all on function private.guard_effective_food_revision_update()
from public, anon, authenticated, service_role;
revoke all on function private.record_nutrition_audit(uuid, text, text, uuid, uuid)
from public, anon, authenticated, service_role;
revoke all on function private.stage_nutrition_batch(uuid, uuid, uuid, jsonb)
from public, anon, authenticated, service_role;
revoke all on function private.validate_nutrition_revision(uuid, uuid, uuid, text, uuid)
from public, anon, authenticated, service_role;
revoke all on function private.open_nutrition_review(
  uuid, uuid, uuid, uuid, text, text, text, jsonb, uuid
) from public, anon, authenticated, service_role;
revoke all on function private.list_nutrition_reviews(uuid, uuid, text)
from public, anon, authenticated, service_role;
revoke all on function private.resolve_nutrition_review(
  uuid, uuid, uuid, text, text, text, uuid
) from public, anon, authenticated, service_role;
revoke all on function private.activate_nutrition_revision(
  uuid, uuid, uuid, jsonb, bytea, text, uuid
) from public, anon, authenticated, service_role;

revoke all on function public.internal_nutrition_stage_batch(uuid, uuid, uuid, jsonb)
from public, anon, authenticated;
revoke all on function public.internal_nutrition_validate_revision(
  uuid, uuid, uuid, text, uuid
) from public, anon, authenticated;
revoke all on function public.internal_nutrition_open_review(
  uuid, uuid, uuid, uuid, text, text, text, jsonb, uuid
) from public, anon, authenticated;
revoke all on function public.internal_nutrition_list_reviews(uuid, uuid, text)
from public, anon, authenticated;
revoke all on function public.internal_nutrition_resolve_review(
  uuid, uuid, uuid, text, text, text, uuid
) from public, anon, authenticated;
revoke all on function public.internal_nutrition_activate_revision(
  uuid, uuid, uuid, jsonb, bytea, text, uuid
) from public, anon, authenticated;

grant execute on function public.internal_nutrition_stage_batch(uuid, uuid, uuid, jsonb)
to service_role;
grant execute on function public.internal_nutrition_validate_revision(
  uuid, uuid, uuid, text, uuid
) to service_role;
grant execute on function public.internal_nutrition_open_review(
  uuid, uuid, uuid, uuid, text, text, text, jsonb, uuid
) to service_role;
grant execute on function public.internal_nutrition_list_reviews(uuid, uuid, text)
to service_role;
grant execute on function public.internal_nutrition_resolve_review(
  uuid, uuid, uuid, text, text, text, uuid
) to service_role;
grant execute on function public.internal_nutrition_activate_revision(
  uuid, uuid, uuid, jsonb, bytea, text, uuid
) to service_role;

comment on table public.nutrition_source_manifests is
  'Manifiesto inmutable de un artefacto nutricional importado y su normalización.';
comment on table public.effective_food_revisions is
  'Selección manual exacta por contexto; las filas sustituidas se conservan.';
comment on function public.internal_nutrition_stage_batch(uuid, uuid, uuid, jsonb) is
  'Importa atómicamente un lote ya normalizado a cuarentena; nunca publica.';
