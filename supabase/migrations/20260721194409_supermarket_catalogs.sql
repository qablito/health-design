create table private.supermarket_source_manifests (
  id uuid primary key default gen_random_uuid(),
  market text not null check (market = 'ES'),
  chain text not null check (chain in ('mercadona', 'dia', 'aldi')),
  source_kind text not null check (
    source_kind in ('csv_capture', 'json_capture', 'manual_export')
  ),
  source_location_internal text not null check (
    length(source_location_internal) between 1 and 500
  ),
  collected_at timestamptz not null,
  importer_version text not null check (length(importer_version) between 1 and 100),
  canonicalization_version text not null check (
    length(canonicalization_version) between 1 and 100
  ),
  raw_object_ref text not null check (length(raw_object_ref) between 1 and 500),
  normalized_object_ref text not null check (
    length(normalized_object_ref) between 1 and 500
  ),
  capture_evidence_ref text not null check (
    length(capture_evidence_ref) between 1 and 500
  ),
  error_evidence_ref text check (
    error_evidence_ref is null or length(error_evidence_ref) between 1 and 500
  ),
  raw_sha256 bytea not null check (octet_length(raw_sha256) = 32),
  normalized_sha256 bytea not null check (octet_length(normalized_sha256) = 32),
  import_key bytea not null unique check (octet_length(import_key) = 32),
  record_count integer not null check (record_count between 0 and 100000),
  price_count integer not null check (price_count between 0 and record_count),
  error_count integer not null check (error_count between 0 and 100000),
  coverage jsonb not null check (
    jsonb_typeof(coverage) = 'object'
    and octet_length(coverage::text) <= 32768
  ),
  license_status text not null check (
    license_status in ('approved', 'restricted', 'unknown')
  ),
  source_terms_status text not null check (
    source_terms_status in ('approved', 'restricted', 'unknown')
  ),
  created_at timestamptz not null default clock_timestamp(),
  unique (market, chain, normalized_sha256)
);

create index supermarket_source_manifests_chain_created_idx
on private.supermarket_source_manifests (market, chain, created_at desc);

create table private.supermarket_catalog_revisions (
  id uuid primary key default gen_random_uuid(),
  market text not null check (market = 'ES'),
  chain text not null check (chain in ('mercadona', 'dia', 'aldi')),
  manifest_id uuid not null unique
    references private.supermarket_source_manifests (id) on delete restrict,
  revision_number integer not null check (revision_number >= 1),
  state text not null default 'quarantine' check (
    state in ('quarantine', 'review', 'publishable', 'published', 'hidden')
  ),
  quality_status text not null default 'current' check (
    quality_status in ('current', 'review_due', 'degraded')
  ),
  record_count integer not null check (record_count between 0 and 100000),
  usable_count integer not null check (usable_count between 0 and record_count),
  observed_at timestamptz not null,
  supersedes_id uuid
    references private.supermarket_catalog_revisions (id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  unique (market, chain, revision_number)
);

create index supermarket_catalog_revisions_chain_state_idx
on private.supermarket_catalog_revisions (market, chain, state, revision_number desc);

create table private.supermarket_skus (
  id uuid primary key default gen_random_uuid(),
  market text not null check (market = 'ES'),
  chain text not null check (chain in ('mercadona', 'dia', 'aldi')),
  external_sku text not null check (length(external_sku) between 1 and 240),
  gtin14 text check (gtin14 is null or gtin14 ~ '^[0-9]{14}$'),
  created_at timestamptz not null default clock_timestamp(),
  unique (market, chain, external_sku)
);

create index supermarket_skus_chain_gtin_idx
on private.supermarket_skus (market, chain, gtin14)
where gtin14 is not null;

create table private.supermarket_sku_revisions (
  id uuid primary key default gen_random_uuid(),
  catalog_revision_id uuid not null
    references private.supermarket_catalog_revisions (id) on delete restrict,
  sku_id uuid not null references private.supermarket_skus (id) on delete restrict,
  name text not null check (length(name) between 1 and 500),
  category_path jsonb not null check (
    jsonb_typeof(category_path) = 'array'
    and jsonb_array_length(category_path) between 0 and 30
    and octet_length(category_path::text) <= 8192
  ),
  format_text text check (format_text is null or length(format_text) <= 500),
  purchase_form text not null check (
    purchase_form in (
      'dry', 'fresh', 'drained', 'canned', 'natural', 'prepared', 'marinated'
    )
  ),
  package jsonb check (
    package is null
    or (jsonb_typeof(package) = 'object' and octet_length(package::text) <= 8192)
  ),
  equivalent_edible_mass_g numeric(12, 3) check (
    equivalent_edible_mass_g is null or equivalent_edible_mass_g > 0
  ),
  equivalence_evidence jsonb check (
    equivalence_evidence is null
    or (
      jsonb_typeof(equivalence_evidence) = 'object'
      and octet_length(equivalence_evidence::text) <= 8192
    )
  ),
  base_price_eur numeric(12, 4) check (base_price_eur is null or base_price_eur > 0),
  normalized_price jsonb check (
    normalized_price is null
    or (
      jsonb_typeof(normalized_price) = 'object'
      and octet_length(normalized_price::text) <= 4096
    )
  ),
  source_fields jsonb not null check (
    jsonb_typeof(source_fields) = 'object'
    and octet_length(source_fields::text) <= 65536
  ),
  usability text not null check (usability in ('calculable', 'visible', 'excluded')),
  exclusion_reasons jsonb not null default '[]'::jsonb check (
    jsonb_typeof(exclusion_reasons) = 'array'
    and jsonb_array_length(exclusion_reasons) <= 50
    and octet_length(exclusion_reasons::text) <= 8192
  ),
  content_hash bytea not null check (octet_length(content_hash) = 32),
  created_at timestamptz not null default clock_timestamp(),
  unique (catalog_revision_id, sku_id)
);

create index supermarket_sku_revisions_catalog_sku_idx
on private.supermarket_sku_revisions (catalog_revision_id, sku_id);

create index supermarket_sku_revisions_content_idx
on private.supermarket_sku_revisions (content_hash);

alter table private.supermarket_source_manifests enable row level security;
alter table private.supermarket_catalog_revisions enable row level security;
alter table private.supermarket_skus enable row level security;
alter table private.supermarket_sku_revisions enable row level security;

revoke all on table private.supermarket_source_manifests
from public, anon, authenticated, service_role;
revoke all on table private.supermarket_catalog_revisions
from public, anon, authenticated, service_role;
revoke all on table private.supermarket_skus
from public, anon, authenticated, service_role;
revoke all on table private.supermarket_sku_revisions
from public, anon, authenticated, service_role;

create function private.reject_supermarket_catalog_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  raise exception using errcode = '55000', message = 'immutable_supermarket_catalog';
end;
$$;

create trigger supermarket_source_manifests_are_immutable
before update or delete on private.supermarket_source_manifests
for each row execute function private.reject_supermarket_catalog_mutation();

create trigger supermarket_catalog_revisions_are_immutable
before update or delete on private.supermarket_catalog_revisions
for each row execute function private.reject_supermarket_catalog_mutation();

create trigger supermarket_skus_are_immutable
before update or delete on private.supermarket_skus
for each row execute function private.reject_supermarket_catalog_mutation();

create trigger supermarket_sku_revisions_are_immutable
before update or delete on private.supermarket_sku_revisions
for each row execute function private.reject_supermarket_catalog_mutation();

create function private.decode_supermarket_sha256(p_value text, p_field text)
returns bytea
language plpgsql
immutable
strict
set search_path = pg_catalog
as $$
declare
  v_value bytea;
begin
  if p_value !~ '^[a-f0-9]{64}$' then
    raise exception using errcode = '22023', message = 'invalid_' || p_field;
  end if;
  v_value := decode(p_value, 'hex');
  return v_value;
end;
$$;

create function private.import_supermarket_catalog(
  p_manifest jsonb,
  p_revision jsonb,
  p_records jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_manifest_id uuid;
  v_revision_id uuid;
  v_record jsonb;
  v_sku_id uuid;
  v_import_key bytea;
begin
  if jsonb_typeof(p_manifest) <> 'object'
    or jsonb_typeof(p_revision) <> 'object'
    or jsonb_typeof(p_records) <> 'array'
    or jsonb_array_length(p_records) > 100000
    or octet_length(p_manifest::text) > 65536
    or octet_length(p_revision::text) > 32768
    or octet_length(p_records::text) > 104857600
  then
    raise exception using errcode = '22023', message = 'invalid_catalog_import';
  end if;

  v_import_key := private.decode_supermarket_sha256(
    p_manifest ->> 'importKey', 'import_key'
  );

  select manifest.id into v_manifest_id
  from private.supermarket_source_manifests manifest
  where manifest.import_key = v_import_key;

  if v_manifest_id is not null then
    select revision.id into v_revision_id
    from private.supermarket_catalog_revisions revision
    where revision.manifest_id = v_manifest_id;
    return jsonb_build_object(
      'catalogRevisionId', v_revision_id,
      'manifestId', v_manifest_id,
      'replayed', true
    );
  end if;

  insert into private.supermarket_source_manifests (
    market, chain, source_kind, source_location_internal, collected_at,
    importer_version, canonicalization_version, raw_object_ref,
    normalized_object_ref, capture_evidence_ref, error_evidence_ref,
    raw_sha256, normalized_sha256, import_key, record_count, price_count,
    error_count, coverage, license_status, source_terms_status
  ) values (
    p_manifest ->> 'market', p_manifest ->> 'chain',
    p_manifest ->> 'sourceKind', p_manifest ->> 'sourceLocationInternal',
    (p_manifest ->> 'collectedAt')::timestamptz,
    p_manifest ->> 'importerVersion', p_manifest ->> 'canonicalizationVersion',
    p_manifest ->> 'rawObjectRef', p_manifest ->> 'normalizedObjectRef',
    p_manifest ->> 'captureEvidenceRef', p_manifest ->> 'errorEvidenceRef',
    private.decode_supermarket_sha256(p_manifest ->> 'rawSha256', 'raw_sha256'),
    private.decode_supermarket_sha256(
      p_manifest ->> 'normalizedSha256', 'normalized_sha256'
    ),
    v_import_key, (p_manifest ->> 'recordCount')::integer,
    (p_manifest ->> 'priceCount')::integer,
    (p_manifest ->> 'errorCount')::integer,
    p_manifest -> 'coverage', p_manifest ->> 'licenseStatus',
    p_manifest ->> 'sourceTermsStatus'
  ) returning id into v_manifest_id;

  insert into private.supermarket_catalog_revisions (
    market, chain, manifest_id, revision_number, state, quality_status,
    record_count, usable_count, observed_at, supersedes_id
  ) values (
    p_manifest ->> 'market', p_manifest ->> 'chain', v_manifest_id,
    (p_revision ->> 'revisionNumber')::integer,
    'quarantine',
    coalesce(p_revision ->> 'qualityStatus', 'current'),
    (p_revision ->> 'recordCount')::integer,
    (p_revision ->> 'usableCount')::integer,
    (p_revision ->> 'observedAt')::timestamptz,
    nullif(p_revision ->> 'supersedesId', '')::uuid
  ) returning id into v_revision_id;

  for v_record in select value from jsonb_array_elements(p_records)
  loop
    if jsonb_typeof(v_record) <> 'object' then
      raise exception using errcode = '22023', message = 'invalid_catalog_record';
    end if;

    insert into private.supermarket_skus (market, chain, external_sku, gtin14)
    values (
      p_manifest ->> 'market', p_manifest ->> 'chain',
      v_record ->> 'externalSku', nullif(v_record ->> 'gtin14', '')
    )
    on conflict (market, chain, external_sku) do nothing;

    select sku.id into strict v_sku_id
    from private.supermarket_skus sku
    where sku.market = p_manifest ->> 'market'
      and sku.chain = p_manifest ->> 'chain'
      and sku.external_sku = v_record ->> 'externalSku';

    insert into private.supermarket_sku_revisions (
      catalog_revision_id, sku_id, name, category_path, format_text,
      purchase_form, package, equivalent_edible_mass_g, equivalence_evidence,
      base_price_eur, normalized_price, source_fields, usability,
      exclusion_reasons, content_hash
    ) values (
      v_revision_id, v_sku_id, v_record ->> 'name', v_record -> 'categoryPath',
      v_record ->> 'formatText', v_record ->> 'purchaseForm',
      nullif(v_record -> 'package', 'null'::jsonb),
      nullif(v_record ->> 'equivalentEdibleMassG', '')::numeric,
      nullif(v_record -> 'equivalenceEvidence', 'null'::jsonb),
      nullif(v_record ->> 'basePriceEur', '')::numeric,
      nullif(v_record -> 'normalizedPrice', 'null'::jsonb),
      v_record -> 'sourceFields',
      v_record ->> 'usability', coalesce(v_record -> 'exclusionReasons', '[]'::jsonb),
      private.decode_supermarket_sha256(v_record ->> 'contentHash', 'content_hash')
    );
  end loop;

  if (select count(*) from private.supermarket_sku_revisions row
      where row.catalog_revision_id = v_revision_id)
    <> (p_revision ->> 'recordCount')::integer
  then
    raise exception using errcode = '22023', message = 'catalog_record_count_mismatch';
  end if;

  return jsonb_build_object(
    'catalogRevisionId', v_revision_id,
    'manifestId', v_manifest_id,
    'replayed', false
  );
end;
$$;

create function public.internal_import_supermarket_catalog(
  p_manifest jsonb,
  p_revision jsonb,
  p_records jsonb
)
returns jsonb
language sql
security definer
set search_path = pg_catalog
as $$
  select private.import_supermarket_catalog(p_manifest, p_revision, p_records)
$$;

create function public.internal_list_published_supermarket_catalog(
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
  from private.supermarket_catalog_revisions revision
  join private.supermarket_sku_revisions row
    on row.catalog_revision_id = revision.id
  join private.supermarket_skus sku on sku.id = row.sku_id
  where revision.market = 'ES'
    and revision.chain = p_chain
    and revision.state = 'published'
    and (p_cursor is null or sku.external_sku > p_cursor)
  order by sku.external_sku, sku.id
  limit p_limit;
end;
$$;

revoke all on function public.internal_import_supermarket_catalog(jsonb, jsonb, jsonb)
from public, anon, authenticated;
revoke all on function public.internal_list_published_supermarket_catalog(
  text, text, integer
) from public, anon, authenticated;
revoke all on function private.decode_supermarket_sha256(text, text)
from public, anon, authenticated, service_role;
revoke all on function private.import_supermarket_catalog(jsonb, jsonb, jsonb)
from public, anon, authenticated, service_role;

grant execute on function public.internal_import_supermarket_catalog(
  jsonb, jsonb, jsonb
) to service_role;
grant execute on function public.internal_list_published_supermarket_catalog(
  text, text, integer
) to service_role;
