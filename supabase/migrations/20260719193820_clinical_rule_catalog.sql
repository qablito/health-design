create function private.clinical_rule_catalog_descriptor_hash(
  p_source_manifest_id uuid,
  p_rule_set_revision_id uuid,
  p_clinical_catalog_version text
)
returns bytea
language sql
immutable
set search_path = pg_catalog
as $$
  select sha256(convert_to(format(
    '{"canonicalizationVersion":"canonical-json-v1","clinicalCatalogVersion":"%s","hashAlgorithm":"sha256","ruleSetRevisionId":"%s","schemaVersion":"1","sourceManifestId":"%s"}',
    p_clinical_catalog_version,
    p_rule_set_revision_id,
    p_source_manifest_id
  ), 'UTF8'))
$$;

create table public.clinical_rule_catalog_revisions (
  id uuid primary key default gen_random_uuid(),
  source_manifest_id uuid not null,
  rule_set_revision_id uuid not null,
  clinical_catalog_version text not null check (
    clinical_catalog_version ~ '^[a-z0-9][a-z0-9._-]{0,63}$'
  ),
  schema_version smallint not null default 1 check (schema_version = 1),
  canonicalization_version text not null default 'canonical-json-v1' check (
    canonicalization_version = 'canonical-json-v1'
  ),
  hash_algorithm text not null default 'sha256' check (hash_algorithm = 'sha256'),
  descriptor_hash bytea not null check (
    octet_length(descriptor_hash) = 32
    and descriptor_hash = private.clinical_rule_catalog_descriptor_hash(
      source_manifest_id, rule_set_revision_id, clinical_catalog_version
    )
  ),
  status text not null check (status in ('staged', 'validated')),
  origin text not null check (origin in ('admin', 'bootstrap')),
  staged_request_id uuid unique,
  staged_by uuid references public.actors (id) on delete restrict,
  validated_request_id uuid unique,
  reviewed_by uuid references public.actors (id) on delete restrict,
  reviewed_at timestamptz,
  review_justification text check (
    review_justification is null
    or length(btrim(review_justification)) between 1 and 2000
  ),
  created_at timestamptz not null default clock_timestamp(),
  unique (source_manifest_id, rule_set_revision_id, clinical_catalog_version),
  check (
    (
      origin = 'bootstrap'
      and status = 'validated'
      and staged_request_id is null
      and staged_by is null
      and validated_request_id is null
      and reviewed_by is null
      and reviewed_at is null
      and review_justification is not null
    )
    or (
      origin = 'admin'
      and staged_request_id is not null
      and staged_by is not null
      and (
        (
          status = 'staged'
          and validated_request_id is null
          and reviewed_by is null
          and reviewed_at is null
          and review_justification is null
        )
        or (
          status = 'validated'
          and validated_request_id is not null
          and reviewed_by is not null
          and reviewed_at is not null
          and review_justification is not null
        )
      )
    )
  )
);

create index clinical_rule_catalog_revisions_status_created_idx
on public.clinical_rule_catalog_revisions (status, created_at desc);

create table public.clinical_rule_catalog_activations (
  id uuid primary key default gen_random_uuid(),
  revision_id uuid not null
    references public.clinical_rule_catalog_revisions (id) on delete restrict,
  activation_request_id uuid unique,
  activated_by uuid references public.actors (id) on delete restrict,
  activated_at timestamptz not null default clock_timestamp(),
  superseded_at timestamptz,
  check (superseded_at is null or superseded_at >= activated_at),
  check (
    (activation_request_id is null and activated_by is null)
    or (activation_request_id is not null and activated_by is not null)
  )
);

create unique index clinical_rule_catalog_one_active_idx
on public.clinical_rule_catalog_activations ((true))
where superseded_at is null;

create index clinical_rule_catalog_activation_history_idx
on public.clinical_rule_catalog_activations (activated_at desc);

insert into public.clinical_rule_catalog_revisions (
  id, source_manifest_id, rule_set_revision_id, clinical_catalog_version,
  descriptor_hash, status, origin, review_justification
) values (
  'c1200000-0000-4000-8000-000000000001',
  'd46591cd-ae2a-4330-a037-c39436cae923',
  '9cf98aae-0f9f-452f-9577-72283eeff4d5',
  'clinical-selective-v2',
  decode('af2fb4b04376b25e6054e0c12bc9df144a5ee8a0df585813c871f9505530752e', 'hex'),
  'validated',
  'bootstrap',
  'Descriptor T12 cotejado con las constantes compiladas y su hash canónico.'
);

insert into public.clinical_rule_catalog_activations (
  id, revision_id
) values (
  'c1200000-0000-4000-8000-000000000002',
  'c1200000-0000-4000-8000-000000000001'
);

create function private.guard_clinical_catalog_revision_update()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  if old.status = 'staged'
    and new.status = 'validated'
    and new.id = old.id
    and new.source_manifest_id = old.source_manifest_id
    and new.rule_set_revision_id = old.rule_set_revision_id
    and new.clinical_catalog_version = old.clinical_catalog_version
    and new.schema_version = old.schema_version
    and new.canonicalization_version = old.canonicalization_version
    and new.hash_algorithm = old.hash_algorithm
    and new.descriptor_hash = old.descriptor_hash
    and new.origin = old.origin
    and new.staged_request_id = old.staged_request_id
    and new.staged_by = old.staged_by
    and new.created_at = old.created_at
    and new.validated_request_id is not null
    and new.reviewed_by is not null
    and new.reviewed_at is not null
    and new.review_justification is not null
  then
    return new;
  end if;
  raise exception using
    errcode = '55000', message = 'immutable_clinical_catalog_revision';
end;
$$;

create trigger clinical_rule_catalog_revisions_are_guarded
before update or delete on public.clinical_rule_catalog_revisions
for each row execute function private.guard_clinical_catalog_revision_update();

create function private.guard_clinical_catalog_activation_update()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  if old.superseded_at is null
    and new.superseded_at is not null
    and new.id = old.id
    and new.revision_id = old.revision_id
    and new.activation_request_id is not distinct from old.activation_request_id
    and new.activated_by is not distinct from old.activated_by
    and new.activated_at = old.activated_at
  then
    return new;
  end if;
  raise exception using
    errcode = '55000', message = 'immutable_clinical_catalog_activation';
end;
$$;

create trigger clinical_rule_catalog_activations_are_guarded
before update or delete on public.clinical_rule_catalog_activations
for each row execute function private.guard_clinical_catalog_activation_update();

create function private.record_clinical_catalog_audit(
  p_actor_id uuid,
  p_action text,
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
    p_actor_id, p_action, 'rule_revision', p_target_id, 'success', p_request_id,
    'outcome', p_actor_id
  );
end;
$$;

create function private.stage_clinical_rule_catalog(
  p_auth_subject uuid,
  p_auth_session_id uuid,
  p_source_manifest_id uuid,
  p_rule_set_revision_id uuid,
  p_clinical_catalog_version text,
  p_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_actor_id uuid;
  v_existing public.clinical_rule_catalog_revisions%rowtype;
  v_revision public.clinical_rule_catalog_revisions%rowtype;
begin
  v_actor_id := private.require_superadmin_aal2(p_auth_subject, p_auth_session_id);
  if p_source_manifest_id is null
    or p_rule_set_revision_id is null
    or p_clinical_catalog_version !~ '^[a-z0-9][a-z0-9._-]{0,63}$'
  then
    raise exception using errcode = '22023', message = 'invalid_clinical_catalog_descriptor';
  end if;

  lock table public.clinical_rule_catalog_revisions in share row exclusive mode;

  select * into v_existing
  from public.clinical_rule_catalog_revisions revision
  where revision.staged_request_id = p_request_id;
  if v_existing.id is not null then
    if v_existing.source_manifest_id <> p_source_manifest_id
      or v_existing.rule_set_revision_id <> p_rule_set_revision_id
      or v_existing.clinical_catalog_version <> p_clinical_catalog_version
    then
      raise exception using errcode = '23505', message = 'idempotency_key_reused';
    end if;
    return jsonb_build_object(
      'descriptor_hash', encode(v_existing.descriptor_hash, 'hex'),
      'revision_id', v_existing.id,
      'status', v_existing.status
    );
  end if;

  insert into public.clinical_rule_catalog_revisions (
    source_manifest_id, rule_set_revision_id, clinical_catalog_version,
    descriptor_hash, status, origin, staged_request_id, staged_by
  ) values (
    p_source_manifest_id, p_rule_set_revision_id, p_clinical_catalog_version,
    private.clinical_rule_catalog_descriptor_hash(
      p_source_manifest_id, p_rule_set_revision_id, p_clinical_catalog_version
    ),
    'staged', 'admin', p_request_id, v_actor_id
  ) returning * into v_revision;

  perform private.record_clinical_catalog_audit(
    v_actor_id, 'clinical_catalog_stage', v_revision.id, p_request_id
  );
  return jsonb_build_object(
    'descriptor_hash', encode(v_revision.descriptor_hash, 'hex'),
    'revision_id', v_revision.id,
    'status', v_revision.status
  );
end;
$$;

create function private.validate_clinical_rule_catalog(
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
  v_revision public.clinical_rule_catalog_revisions%rowtype;
begin
  v_actor_id := private.require_superadmin_aal2(p_auth_subject, p_auth_session_id);
  if length(btrim(p_justification)) not between 1 and 2000 then
    raise exception using errcode = '22023', message = 'invalid_justification';
  end if;
  select * into v_revision
  from public.clinical_rule_catalog_revisions revision
  where revision.id = p_revision_id
  for update;
  if v_revision.id is null then
    raise exception using errcode = 'P0002', message = 'clinical_catalog_revision_not_found';
  end if;
  if v_revision.status = 'validated'
    and v_revision.validated_request_id = p_request_id
  then
    return jsonb_build_object('revision_id', v_revision.id, 'status', 'validated');
  end if;
  if v_revision.status <> 'staged' then
    raise exception using errcode = '55000', message = 'clinical_catalog_revision_not_staged';
  end if;

  update public.clinical_rule_catalog_revisions revision
  set status = 'validated',
      validated_request_id = p_request_id,
      reviewed_by = v_actor_id,
      reviewed_at = clock_timestamp(),
      review_justification = p_justification
  where revision.id = v_revision.id;
  perform private.record_clinical_catalog_audit(
    v_actor_id, 'clinical_catalog_validate', v_revision.id, p_request_id
  );
  return jsonb_build_object('revision_id', v_revision.id, 'status', 'validated');
end;
$$;

create function private.activate_clinical_rule_catalog(
  p_auth_subject uuid,
  p_auth_session_id uuid,
  p_revision_id uuid,
  p_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_activation public.clinical_rule_catalog_activations%rowtype;
  v_actor_id uuid;
  v_revision public.clinical_rule_catalog_revisions%rowtype;
begin
  v_actor_id := private.require_superadmin_aal2(p_auth_subject, p_auth_session_id);
  lock table public.clinical_rule_catalog_activations in share row exclusive mode;
  select * into v_activation
  from public.clinical_rule_catalog_activations activation
  where activation.activation_request_id = p_request_id;
  if v_activation.id is not null then
    if v_activation.revision_id <> p_revision_id then
      raise exception using errcode = '23505', message = 'idempotency_key_reused';
    end if;
    return jsonb_build_object(
      'activation_id', v_activation.id,
      'revision_id', v_activation.revision_id,
      'status', 'active'
    );
  end if;

  select * into v_revision
  from public.clinical_rule_catalog_revisions revision
  where revision.id = p_revision_id;
  if v_revision.id is null then
    raise exception using errcode = 'P0002', message = 'clinical_catalog_revision_not_found';
  end if;
  if v_revision.status <> 'validated' then
    raise exception using errcode = '55000', message = 'clinical_catalog_revision_not_validated';
  end if;

  update public.clinical_rule_catalog_activations activation
  set superseded_at = clock_timestamp()
  where activation.superseded_at is null;
  insert into public.clinical_rule_catalog_activations (
    revision_id, activation_request_id, activated_by
  ) values (
    v_revision.id, p_request_id, v_actor_id
  ) returning * into v_activation;
  perform private.record_clinical_catalog_audit(
    v_actor_id, 'clinical_catalog_activate', v_revision.id, p_request_id
  );
  return jsonb_build_object(
    'activation_id', v_activation.id,
    'revision_id', v_revision.id,
    'status', 'active'
  );
end;
$$;

create function private.list_active_clinical_rule_catalog()
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog
as $$
  select jsonb_build_object(
    'canonicalizationVersion', revision.canonicalization_version,
    'clinicalCatalogVersion', revision.clinical_catalog_version,
    'descriptorHash', encode(revision.descriptor_hash, 'hex'),
    'hashAlgorithm', revision.hash_algorithm,
    'ruleSetRevisionId', revision.rule_set_revision_id,
    'schemaVersion', revision.schema_version,
    'sourceManifestId', revision.source_manifest_id
  )
  from public.clinical_rule_catalog_activations activation
  join public.clinical_rule_catalog_revisions revision
    on revision.id = activation.revision_id
  where activation.superseded_at is null
    and revision.status = 'validated'
$$;

create function private.clinical_identity_text_array_valid(
  p_values text[],
  p_minimum integer
)
returns boolean
language sql
immutable
set search_path = pg_catalog
as $$
  select cardinality(p_values) between p_minimum and 20
    and not exists (
      select 1 from unnest(p_values) value
      where length(btrim(value)) not between 1 and 200
    )
$$;

create table public.clinical_medication_identities (
  aemps_id text primary key check (aemps_id ~ '^[0-9A-Z]{1,32}$'),
  canonical_name text not null check (length(btrim(canonical_name)) between 1 and 500),
  active_ingredients text[] not null check (
    private.clinical_identity_text_array_valid(active_ingredients, 1)
  ),
  administration_routes text[] not null default '{}'::text[] check (
    private.clinical_identity_text_array_valid(administration_routes, 0)
  ),
  commercialized boolean,
  prescription_required boolean,
  source_version text not null check (source_version = 'CIMA_REST_API_1_23'),
  source_hash bytea not null check (octet_length(source_hash) = 32),
  retrieved_at timestamptz not null,
  updated_at timestamptz not null default clock_timestamp()
);

create index clinical_medication_identities_retrieved_idx
on public.clinical_medication_identities (retrieved_at desc);

create function private.upsert_clinical_medication_identities(p_identities jsonb)
returns integer
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_count integer := 0;
  v_entry jsonb;
  v_row_count integer;
begin
  if jsonb_typeof(p_identities) is distinct from 'array'
    or jsonb_array_length(p_identities) not between 1 and 20
  then
    raise exception using errcode = '22023', message = 'invalid_clinical_medication_identity';
  end if;

  for v_entry in select value from jsonb_array_elements(p_identities)
  loop
    if jsonb_typeof(v_entry) is distinct from 'object'
      or (select count(*) from jsonb_object_keys(v_entry)) <> 9
      or not v_entry ?& array[
        'activeIngredients', 'administrationRoutes', 'aempsId',
        'canonicalName', 'commercialized', 'prescriptionRequired',
        'retrievedAt', 'sourceHash', 'sourceVersion'
      ]
      or jsonb_typeof(v_entry -> 'aempsId') is distinct from 'string'
      or v_entry ->> 'aempsId' !~ '^[0-9A-Z]{1,32}$'
      or jsonb_typeof(v_entry -> 'canonicalName') is distinct from 'string'
      or length(btrim(v_entry ->> 'canonicalName')) not between 1 and 500
      or jsonb_typeof(v_entry -> 'activeIngredients') is distinct from 'array'
      or jsonb_array_length(v_entry -> 'activeIngredients') not between 1 and 20
      or exists (
        select 1 from jsonb_array_elements(v_entry -> 'activeIngredients') item
        where jsonb_typeof(item) <> 'string'
          or length(btrim(item #>> '{}')) not between 1 and 200
      )
      or jsonb_typeof(v_entry -> 'administrationRoutes') is distinct from 'array'
      or jsonb_array_length(v_entry -> 'administrationRoutes') > 20
      or exists (
        select 1 from jsonb_array_elements(v_entry -> 'administrationRoutes') item
        where jsonb_typeof(item) <> 'string'
          or length(btrim(item #>> '{}')) not between 1 and 200
      )
      or (
        v_entry -> 'commercialized' <> 'null'::jsonb
        and jsonb_typeof(v_entry -> 'commercialized') <> 'boolean'
      )
      or (
        v_entry -> 'prescriptionRequired' <> 'null'::jsonb
        and jsonb_typeof(v_entry -> 'prescriptionRequired') <> 'boolean'
      )
      or jsonb_typeof(v_entry -> 'sourceVersion') is distinct from 'string'
      or v_entry ->> 'sourceVersion' is distinct from 'CIMA_REST_API_1_23'
      or jsonb_typeof(v_entry -> 'sourceHash') is distinct from 'string'
      or v_entry ->> 'sourceHash' !~ '^[0-9a-f]{64}$'
      or jsonb_typeof(v_entry -> 'retrievedAt') is distinct from 'string'
    then
      raise exception using errcode = '22023', message = 'invalid_clinical_medication_identity';
    end if;

    insert into public.clinical_medication_identities (
      aemps_id, canonical_name, active_ingredients, administration_routes,
      commercialized, prescription_required, source_version, source_hash,
      retrieved_at
    ) values (
      v_entry ->> 'aempsId',
      v_entry ->> 'canonicalName',
      array(select item #>> '{}' from jsonb_array_elements(v_entry -> 'activeIngredients') item),
      array(select item #>> '{}' from jsonb_array_elements(v_entry -> 'administrationRoutes') item),
      (v_entry ->> 'commercialized')::boolean,
      (v_entry ->> 'prescriptionRequired')::boolean,
      v_entry ->> 'sourceVersion',
      decode(v_entry ->> 'sourceHash', 'hex'),
      (v_entry ->> 'retrievedAt')::timestamptz
    )
    on conflict (aemps_id) do update
    set canonical_name = excluded.canonical_name,
        active_ingredients = excluded.active_ingredients,
        administration_routes = excluded.administration_routes,
        commercialized = excluded.commercialized,
        prescription_required = excluded.prescription_required,
        source_version = excluded.source_version,
        source_hash = excluded.source_hash,
        retrieved_at = excluded.retrieved_at,
        updated_at = clock_timestamp()
    where excluded.retrieved_at >= public.clinical_medication_identities.retrieved_at;
    get diagnostics v_row_count = row_count;
    v_count := v_count + v_row_count;
  end loop;
  return v_count;
exception
  when invalid_text_representation or datetime_field_overflow then
    raise exception using errcode = '22023', message = 'invalid_clinical_medication_identity';
end;
$$;

create function private.resolve_clinical_medication_identities(p_aemps_ids text[])
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog
as $$
begin
  if p_aemps_ids is null
    or cardinality(p_aemps_ids) > 50
    or exists (
      select 1 from unnest(p_aemps_ids) aemps_id
      where aemps_id is null or aemps_id !~ '^[0-9A-Z]{1,32}$'
    )
  then
    raise exception using errcode = '22023', message = 'invalid_aemps_ids';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'activeIngredients', identity.active_ingredients,
      'administrationRoutes', identity.administration_routes,
      'aempsId', identity.aemps_id,
      'canonicalName', identity.canonical_name,
      'commercialized', identity.commercialized,
      'prescriptionRequired', identity.prescription_required,
      'retrievedAt', identity.retrieved_at,
      'sourceHash', encode(identity.source_hash, 'hex'),
      'sourceVersion', identity.source_version
    ) order by identity.aemps_id)
    from public.clinical_medication_identities identity
    where identity.aemps_id = any(p_aemps_ids)
  ), '[]'::jsonb);
end;
$$;

alter table public.clinical_rule_catalog_revisions enable row level security;
alter table public.clinical_rule_catalog_activations enable row level security;
alter table public.clinical_medication_identities enable row level security;

revoke all on table public.clinical_rule_catalog_revisions
from public, anon, authenticated, service_role;
revoke all on table public.clinical_rule_catalog_activations
from public, anon, authenticated, service_role;
revoke all on table public.clinical_medication_identities
from public, anon, authenticated, service_role;

create function public.internal_clinical_rule_catalog_stage(
  p_auth_subject uuid,
  p_auth_session_id uuid,
  p_source_manifest_id uuid,
  p_rule_set_revision_id uuid,
  p_clinical_catalog_version text,
  p_request_id uuid
)
returns jsonb
language sql
security definer
set search_path = pg_catalog
as $$
  select private.stage_clinical_rule_catalog(
    p_auth_subject, p_auth_session_id, p_source_manifest_id,
    p_rule_set_revision_id, p_clinical_catalog_version, p_request_id
  )
$$;

create function public.internal_clinical_rule_catalog_validate(
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
  select private.validate_clinical_rule_catalog(
    p_auth_subject, p_auth_session_id, p_revision_id, p_justification, p_request_id
  )
$$;

create function public.internal_clinical_rule_catalog_activate(
  p_auth_subject uuid,
  p_auth_session_id uuid,
  p_revision_id uuid,
  p_request_id uuid
)
returns jsonb
language sql
security definer
set search_path = pg_catalog
as $$
  select private.activate_clinical_rule_catalog(
    p_auth_subject, p_auth_session_id, p_revision_id, p_request_id
  )
$$;

create function public.internal_clinical_rule_catalog_active()
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog
as $$
  select private.list_active_clinical_rule_catalog()
$$;

create function public.internal_clinical_medication_identities_upsert(
  p_identities jsonb
)
returns integer
language sql
security definer
set search_path = pg_catalog
as $$
  select private.upsert_clinical_medication_identities(p_identities)
$$;

create function public.internal_clinical_medication_identities_resolve(
  p_aemps_ids text[]
)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog
as $$
  select private.resolve_clinical_medication_identities(p_aemps_ids)
$$;

revoke all on function private.clinical_rule_catalog_descriptor_hash(uuid, uuid, text)
from public, anon, authenticated, service_role;
revoke all on function private.guard_clinical_catalog_revision_update()
from public, anon, authenticated, service_role;
revoke all on function private.guard_clinical_catalog_activation_update()
from public, anon, authenticated, service_role;
revoke all on function private.record_clinical_catalog_audit(uuid, text, uuid, uuid)
from public, anon, authenticated, service_role;
revoke all on function private.stage_clinical_rule_catalog(uuid, uuid, uuid, uuid, text, uuid)
from public, anon, authenticated, service_role;
revoke all on function private.validate_clinical_rule_catalog(uuid, uuid, uuid, text, uuid)
from public, anon, authenticated, service_role;
revoke all on function private.activate_clinical_rule_catalog(uuid, uuid, uuid, uuid)
from public, anon, authenticated, service_role;
revoke all on function private.list_active_clinical_rule_catalog()
from public, anon, authenticated, service_role;
revoke all on function private.clinical_identity_text_array_valid(text[], integer)
from public, anon, authenticated, service_role;
revoke all on function private.upsert_clinical_medication_identities(jsonb)
from public, anon, authenticated, service_role;
revoke all on function private.resolve_clinical_medication_identities(text[])
from public, anon, authenticated, service_role;

revoke all on function public.internal_clinical_rule_catalog_stage(
  uuid, uuid, uuid, uuid, text, uuid
) from public, anon, authenticated;
revoke all on function public.internal_clinical_rule_catalog_validate(
  uuid, uuid, uuid, text, uuid
) from public, anon, authenticated;
revoke all on function public.internal_clinical_rule_catalog_activate(
  uuid, uuid, uuid, uuid
) from public, anon, authenticated;
revoke all on function public.internal_clinical_rule_catalog_active()
from public, anon, authenticated;
revoke all on function public.internal_clinical_medication_identities_upsert(jsonb)
from public, anon, authenticated;
revoke all on function public.internal_clinical_medication_identities_resolve(text[])
from public, anon, authenticated;

grant execute on function public.internal_clinical_rule_catalog_stage(
  uuid, uuid, uuid, uuid, text, uuid
) to service_role;
grant execute on function public.internal_clinical_rule_catalog_validate(
  uuid, uuid, uuid, text, uuid
) to service_role;
grant execute on function public.internal_clinical_rule_catalog_activate(
  uuid, uuid, uuid, uuid
) to service_role;
grant execute on function public.internal_clinical_rule_catalog_active()
to service_role;
grant execute on function public.internal_clinical_medication_identities_upsert(jsonb)
to service_role;
grant execute on function public.internal_clinical_medication_identities_resolve(text[])
to service_role;

comment on table public.clinical_rule_catalog_revisions is
  'T12: descriptor versionado; no contiene expresiones de reglas ejecutables.';
comment on table public.clinical_medication_identities is
  'T12: caché privada de identidades canónicas validadas contra AEMPS/CIMA.';
