alter table private.plan_idempotency
drop constraint plan_idempotency_operation_check;

alter table private.plan_idempotency
add constraint plan_idempotency_operation_check
check (
  operation in (
    'context-snapshot', 'plan-generate', 'version-activate',
    'candidate-create', 'candidate-activate', 'candidate-discard',
    'follow-up-create', 'lab-create', 'export-create'
  )
);

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
) values (
  'plan-exports',
  'plan-exports',
  false,
  26214400,
  array[
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  ]::text[]
)
on conflict (id) do update
set name = excluded.name,
    public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create table private.export_artifacts (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete restrict,
  actor_id uuid not null references public.actors (id) on delete restrict,
  plan_version_id uuid not null
    references public.plan_versions (id) on delete restrict,
  renderer_version text not null
    check (renderer_version ~ '^[a-z0-9][a-z0-9._-]{0,63}$'),
  config jsonb not null check (
    jsonb_typeof(config) = 'object'
    and octet_length(config::text) <= 16384
  ),
  config_digest bytea not null check (octet_length(config_digest) = 32),
  format text not null check (format in ('pdf', 'xlsx')),
  detail text not null check (detail in ('compact', 'complete')),
  presentation text not null check (presentation in ('ingredients', 'preparation')),
  storage_path text not null unique check (
    length(storage_path) between 42 and 160
    and storage_path !~ '(^|/)\.\.(/|$)'
  ),
  mime_type text not null check (
    (format = 'pdf' and mime_type = 'application/pdf')
    or (
      format = 'xlsx'
      and mime_type = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    )
  ),
  size_bytes bigint check (size_bytes between 1 and 26214400),
  content_digest bytea check (
    content_digest is null or octet_length(content_digest) = 32
  ),
  status text not null default 'pending'
    check (status in ('pending', 'ready', 'failed')),
  created_at timestamptz not null default clock_timestamp(),
  ready_at timestamptz,
  failed_at timestamptz,
  storage_deleted_at timestamptz,
  constraint export_artifacts_state_check check (
    (
      status = 'pending'
      and size_bytes is null
      and content_digest is null
      and ready_at is null
      and failed_at is null
    )
    or (
      status = 'ready'
      and size_bytes is not null
      and content_digest is not null
      and ready_at is not null
      and failed_at is null
    )
    or (
      status = 'failed'
      and ready_at is null
      and failed_at is not null
    )
  ),
  check (ready_at is null or ready_at >= created_at),
  check (failed_at is null or failed_at >= created_at),
  check (storage_deleted_at is null or storage_deleted_at >= created_at)
);

create unique index export_artifacts_one_pending_profile_idx
on private.export_artifacts (profile_id)
where status = 'pending' and storage_deleted_at is null;

create unique index export_artifacts_ready_config_idx
on private.export_artifacts (plan_version_id, renderer_version, config_digest)
where status = 'ready' and storage_deleted_at is null;

create index export_artifacts_profile_created_idx
on private.export_artifacts (profile_id, created_at desc);

create table private.export_rate_limit_events (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  actor_id uuid not null references public.actors (id) on delete cascade,
  ip_digest bytea not null check (octet_length(ip_digest) = 32),
  attempted_at timestamptz not null default clock_timestamp()
);

create index export_rate_limit_profile_window_idx
on private.export_rate_limit_events (profile_id, attempted_at desc);

create index export_rate_limit_actor_window_idx
on private.export_rate_limit_events (actor_id, attempted_at desc);

create index export_rate_limit_ip_window_idx
on private.export_rate_limit_events (ip_digest, attempted_at desc);

alter table private.export_artifacts enable row level security;
alter table private.export_rate_limit_events enable row level security;

revoke all on table private.export_artifacts
from public, anon, authenticated, service_role;
revoke all on table private.export_rate_limit_events
from public, anon, authenticated, service_role;

create function private.require_export_access(
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

create function private.export_artifact_json(p_artifact_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog
as $$
  select jsonb_build_object(
    'artifactId', artifact.id,
    'createdAt', artifact.created_at,
    'detail', artifact.detail,
    'format', artifact.format,
    'planVersionId', artifact.plan_version_id,
    'presentation', artifact.presentation,
    'schemaVersion', (artifact.config ->> 'schemaVersion')::integer,
    'status', artifact.status,
    'profileId', artifact.profile_id,
    'actorId', artifact.actor_id,
    'rendererVersion', artifact.renderer_version,
    'storagePath', artifact.storage_path,
    'mimeType', artifact.mime_type,
    'sizeBytes', artifact.size_bytes,
    'contentDigest', case
      when artifact.content_digest is null then null
      else encode(artifact.content_digest, 'hex')
    end,
    'config', artifact.config
  )
  from private.export_artifacts artifact
  where artifact.id = p_artifact_id
    and artifact.storage_deleted_at is null
$$;

create function private.get_plan_export_source(
  p_auth_subject uuid,
  p_auth_session_id uuid,
  p_plan_version_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_profile_id uuid;
  v_plan_id uuid;
  v_output_hash bytea;
  v_nutrition jsonb;
begin
  select plan.profile_id, plan.id, version.output_hash
  into v_profile_id, v_plan_id, v_output_hash
  from public.plan_versions version
  join public.plans plan on plan.id = version.plan_id
  where version.id = p_plan_version_id
    and version.validation_status = 'valid';

  if not found then
    raise exception using errcode = 'P0002', message = 'plan_version_not_found';
  end if;

  perform private.require_export_access(
    p_auth_subject, p_auth_session_id, v_profile_id
  );

  select result.payload into v_nutrition
  from public.module_results result
  where result.plan_version_id = p_plan_version_id
    and result.module = 'nutrition'
    and result.status in ('valid', 'provisional');

  if v_nutrition is null then
    raise exception using errcode = 'P0002', message = 'nutrition_result_not_found';
  end if;

  return jsonb_build_object(
    'planId', v_plan_id,
    'planVersionId', p_plan_version_id,
    'outputHash', encode(v_output_hash, 'hex'),
    'nutrition', v_nutrition
  );
end;
$$;

create function private.reserve_plan_export(
  p_auth_subject uuid,
  p_auth_session_id uuid,
  p_plan_version_id uuid,
  p_renderer_version text,
  p_config jsonb,
  p_config_digest bytea,
  p_idempotency_key_digest bytea,
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
  v_profile_id uuid;
  v_plan_id uuid;
  v_artifact_id uuid;
  v_existing jsonb;
  v_profile_attempts integer;
  v_actor_attempts integer;
  v_ip_attempts integer;
  v_format text;
  v_mime_type text;
  v_response jsonb;
begin
  if p_renderer_version !~ '^[a-z0-9][a-z0-9._-]{0,63}$'
    or jsonb_typeof(p_config) <> 'object'
    or octet_length(p_config::text) > 16384
    or coalesce(p_config ->> 'schemaVersion', '') <> '1'
    or coalesce(p_config ->> 'format', '') not in ('pdf', 'xlsx')
    or coalesce(p_config ->> 'detail', '') not in ('compact', 'complete')
    or coalesce(p_config ->> 'presentation', '') not in (
      'ingredients', 'preparation'
    )
    or octet_length(p_config_digest) <> 32
    or octet_length(p_idempotency_key_digest) <> 32
    or octet_length(p_request_digest) <> 32
    or octet_length(p_ip_digest) <> 32
  then
    raise exception using errcode = '22023', message = 'invalid_input';
  end if;

  select plan.profile_id, plan.id
  into v_profile_id, v_plan_id
  from public.plan_versions version
  join public.plans plan on plan.id = version.plan_id
  where version.id = p_plan_version_id
    and version.validation_status = 'valid';

  if not found then
    raise exception using errcode = 'P0002', message = 'plan_version_not_found';
  end if;

  v_actor_id := private.require_export_access(
    p_auth_subject, p_auth_session_id, v_profile_id
  );

  perform pg_advisory_xact_lock(hashtextextended(
    'export:actor:' || v_actor_id::text, 0
  ));
  perform pg_advisory_xact_lock(hashtextextended(
    'export:profile:' || v_profile_id::text, 0
  ));
  perform pg_advisory_xact_lock(hashtextextended(
    'export:ip:' || encode(p_ip_digest, 'hex'), 0
  ));

  v_existing := private.get_plan_idempotency(
    v_actor_id,
    v_profile_id,
    'export-create',
    p_idempotency_key_digest,
    p_request_digest
  );
  if v_existing is not null then
    v_artifact_id := (v_existing ->> 'artifactId')::uuid;
    v_response := private.export_artifact_json(v_artifact_id);
    if v_response is null then
      raise exception using errcode = '55000', message = 'export_artifact_unavailable';
    end if;
    return v_response || jsonb_build_object(
      'outcome', case v_response ->> 'status'
        when 'ready' then 'ready'
        when 'pending' then 'pending'
        else 'failed'
      end,
      'planId', v_plan_id
    );
  end if;

  select artifact.id into v_artifact_id
  from private.export_artifacts artifact
  where artifact.plan_version_id = p_plan_version_id
    and artifact.renderer_version = p_renderer_version
    and artifact.config_digest = p_config_digest
    and artifact.status = 'ready'
    and artifact.storage_deleted_at is null;

  if v_artifact_id is not null then
    v_response := private.export_artifact_json(v_artifact_id);
    perform private.store_plan_idempotency(
      v_actor_id, v_profile_id, 'export-create',
      p_idempotency_key_digest, p_request_digest,
      jsonb_build_object('artifactId', v_artifact_id), true
    );
    return v_response || jsonb_build_object('outcome', 'ready', 'planId', v_plan_id);
  end if;

  select artifact.id into v_artifact_id
  from private.export_artifacts artifact
  where artifact.profile_id = v_profile_id
    and artifact.status = 'pending'
    and artifact.storage_deleted_at is null;

  if v_artifact_id is not null then
    return private.export_artifact_json(v_artifact_id)
      || jsonb_build_object('outcome', 'pending', 'planId', v_plan_id);
  end if;

  select count(*) into v_profile_attempts
  from private.export_rate_limit_events event
  where event.profile_id = v_profile_id
    and event.attempted_at > clock_timestamp() - interval '1 hour';
  select count(*) into v_actor_attempts
  from private.export_rate_limit_events event
  where event.actor_id = v_actor_id
    and event.attempted_at > clock_timestamp() - interval '1 hour';
  select count(*) into v_ip_attempts
  from private.export_rate_limit_events event
  where event.ip_digest = p_ip_digest
    and event.attempted_at > clock_timestamp() - interval '1 hour';

  if v_profile_attempts >= 20 or v_actor_attempts >= 30 or v_ip_attempts >= 60 then
    raise exception using errcode = 'PT429', message = 'export_rate_limited';
  end if;

  insert into private.export_rate_limit_events (profile_id, actor_id, ip_digest)
  values (v_profile_id, v_actor_id, p_ip_digest);

  v_artifact_id := gen_random_uuid();
  v_format := p_config ->> 'format';
  v_mime_type := case v_format
    when 'pdf' then 'application/pdf'
    else 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  end;

  insert into private.export_artifacts (
    id, profile_id, actor_id, plan_version_id, renderer_version,
    config, config_digest, format, detail, presentation,
    storage_path, mime_type
  ) values (
    v_artifact_id, v_profile_id, v_actor_id, p_plan_version_id,
    p_renderer_version, p_config, p_config_digest, v_format,
    p_config ->> 'detail', p_config ->> 'presentation',
    v_profile_id::text || '/' || v_artifact_id::text || '.' || v_format,
    v_mime_type
  );

  perform private.store_plan_idempotency(
    v_actor_id, v_profile_id, 'export-create',
    p_idempotency_key_digest, p_request_digest,
    jsonb_build_object('artifactId', v_artifact_id), true
  );

  return private.export_artifact_json(v_artifact_id)
    || jsonb_build_object('outcome', 'reserved', 'planId', v_plan_id);
end;
$$;

create function private.complete_plan_export(
  p_auth_subject uuid,
  p_auth_session_id uuid,
  p_artifact_id uuid,
  p_size_bytes bigint,
  p_content_digest bytea
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_artifact private.export_artifacts%rowtype;
begin
  if p_size_bytes not between 1 and 26214400
    or octet_length(p_content_digest) <> 32
  then
    raise exception using errcode = '22023', message = 'invalid_input';
  end if;

  select artifact.* into v_artifact
  from private.export_artifacts artifact
  where artifact.id = p_artifact_id
    and artifact.storage_deleted_at is null
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'export_artifact_not_found';
  end if;

  perform private.require_export_access(
    p_auth_subject, p_auth_session_id, v_artifact.profile_id
  );

  if v_artifact.status = 'ready' then
    if v_artifact.size_bytes <> p_size_bytes
      or v_artifact.content_digest <> p_content_digest
    then
      raise exception using errcode = '55000', message = 'export_completion_mismatch';
    end if;
    return private.export_artifact_json(p_artifact_id);
  end if;
  if v_artifact.status <> 'pending' then
    raise exception using errcode = '55000', message = 'export_not_pending';
  end if;

  update private.export_artifacts
  set status = 'ready',
      size_bytes = p_size_bytes,
      content_digest = p_content_digest,
      ready_at = clock_timestamp()
  where id = p_artifact_id;

  return private.export_artifact_json(p_artifact_id);
end;
$$;

create function private.fail_plan_export(
  p_auth_subject uuid,
  p_auth_session_id uuid,
  p_artifact_id uuid
)
returns void
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_profile_id uuid;
begin
  select artifact.profile_id into v_profile_id
  from private.export_artifacts artifact
  where artifact.id = p_artifact_id
    and artifact.status = 'pending'
    and artifact.storage_deleted_at is null
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'export_artifact_not_found';
  end if;

  perform private.require_export_access(
    p_auth_subject, p_auth_session_id, v_profile_id
  );

  update private.export_artifacts
  set status = 'failed', failed_at = clock_timestamp()
  where id = p_artifact_id;
end;
$$;

create function private.get_plan_export(
  p_auth_subject uuid,
  p_auth_session_id uuid,
  p_artifact_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_profile_id uuid;
  v_status text;
begin
  select artifact.profile_id, artifact.status
  into v_profile_id, v_status
  from private.export_artifacts artifact
  where artifact.id = p_artifact_id
    and artifact.storage_deleted_at is null;
  if not found or v_status <> 'ready' then
    raise exception using errcode = 'P0002', message = 'export_artifact_not_found';
  end if;

  perform private.require_export_access(
    p_auth_subject, p_auth_session_id, v_profile_id
  );
  return private.export_artifact_json(p_artifact_id);
end;
$$;

create function private.list_profile_export_purge_paths(p_job_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_profile_id uuid;
  v_paths jsonb;
begin
  select job.profile_id into v_profile_id
  from private.deletion_jobs job
  where job.id = p_job_id and job.status = 'purging'
  for update;
  if not found or v_profile_id is null then
    raise exception using errcode = 'P0002', message = 'deletion_job_not_purging';
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object('artifactId', artifact.id, 'storagePath', artifact.storage_path)
      order by artifact.storage_path
    ),
    '[]'::jsonb
  ) into v_paths
  from private.export_artifacts artifact
  where artifact.profile_id = v_profile_id
    and artifact.storage_deleted_at is null;

  return v_paths;
end;
$$;

create function private.confirm_profile_export_purge(
  p_job_id uuid,
  p_removed_paths jsonb
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_profile_id uuid;
  v_expected_paths jsonb;
  v_count integer;
begin
  if jsonb_typeof(p_removed_paths) <> 'array'
    or jsonb_array_length(p_removed_paths) > 1000
  then
    raise exception using errcode = '22023', message = 'invalid_removed_paths';
  end if;

  select job.profile_id into v_profile_id
  from private.deletion_jobs job
  where job.id = p_job_id and job.status = 'purging'
  for update;
  if not found or v_profile_id is null then
    raise exception using errcode = 'P0002', message = 'deletion_job_not_purging';
  end if;

  select coalesce(jsonb_agg(artifact.storage_path order by artifact.storage_path), '[]'::jsonb)
  into v_expected_paths
  from private.export_artifacts artifact
  where artifact.profile_id = v_profile_id
    and artifact.storage_deleted_at is null;

  if v_expected_paths <> (
    select coalesce(jsonb_agg(value order by value), '[]'::jsonb)
    from jsonb_array_elements_text(p_removed_paths)
  ) then
    raise exception using errcode = '22023', message = 'export_purge_paths_mismatch';
  end if;

  update private.export_artifacts
  set storage_deleted_at = clock_timestamp()
  where profile_id = v_profile_id
    and storage_deleted_at is null;
  get diagnostics v_count = row_count;

  delete from private.export_artifacts
  where profile_id = v_profile_id and storage_deleted_at is not null;

  return v_count;
end;
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
      select 1
      from private.export_artifacts artifact
      where artifact.profile_id = new.profile_id
    ) then
      raise exception using errcode = '55000', message = 'export_purge_incomplete';
    end if;

    delete from public.profiles
    where id = new.profile_id
      and status = 'deletion_requested';

    if not found then
      raise exception using
        errcode = '55000',
        message = 'profile_not_deletion_requested';
    end if;
  end if;
  return new;
end;
$$;

create function public.internal_get_plan_export_source(
  p_auth_subject uuid,
  p_auth_session_id uuid,
  p_plan_version_id uuid
)
returns jsonb
language sql
security definer
set search_path = pg_catalog
as $$
  select private.get_plan_export_source(
    p_auth_subject, p_auth_session_id, p_plan_version_id
  )
$$;

create function public.internal_reserve_plan_export(
  p_auth_subject uuid,
  p_auth_session_id uuid,
  p_plan_version_id uuid,
  p_renderer_version text,
  p_config jsonb,
  p_config_digest bytea,
  p_idempotency_key_digest bytea,
  p_request_digest bytea,
  p_ip_digest bytea
)
returns jsonb
language sql
security definer
set search_path = pg_catalog
as $$
  select private.reserve_plan_export(
    p_auth_subject, p_auth_session_id, p_plan_version_id,
    p_renderer_version, p_config, p_config_digest,
    p_idempotency_key_digest, p_request_digest, p_ip_digest
  )
$$;

create function public.internal_complete_plan_export(
  p_auth_subject uuid,
  p_auth_session_id uuid,
  p_artifact_id uuid,
  p_size_bytes bigint,
  p_content_digest bytea
)
returns jsonb
language sql
security definer
set search_path = pg_catalog
as $$
  select private.complete_plan_export(
    p_auth_subject, p_auth_session_id, p_artifact_id,
    p_size_bytes, p_content_digest
  )
$$;

create function public.internal_fail_plan_export(
  p_auth_subject uuid,
  p_auth_session_id uuid,
  p_artifact_id uuid
)
returns void
language sql
security definer
set search_path = pg_catalog
as $$
  select private.fail_plan_export(
    p_auth_subject, p_auth_session_id, p_artifact_id
  )
$$;

create function public.internal_get_plan_export(
  p_auth_subject uuid,
  p_auth_session_id uuid,
  p_artifact_id uuid
)
returns jsonb
language sql
security definer
set search_path = pg_catalog
as $$
  select private.get_plan_export(
    p_auth_subject, p_auth_session_id, p_artifact_id
  )
$$;

create function public.internal_list_profile_export_purge_paths(p_job_id uuid)
returns jsonb
language sql
security definer
set search_path = pg_catalog
as $$
  select private.list_profile_export_purge_paths(p_job_id)
$$;

create function public.internal_confirm_profile_export_purge(
  p_job_id uuid,
  p_removed_paths jsonb
)
returns integer
language sql
security definer
set search_path = pg_catalog
as $$
  select private.confirm_profile_export_purge(p_job_id, p_removed_paths)
$$;

revoke all on function private.require_export_access(uuid, uuid, uuid)
from public, anon, authenticated, service_role;
revoke all on function private.export_artifact_json(uuid)
from public, anon, authenticated, service_role;
revoke all on function private.get_plan_export_source(uuid, uuid, uuid)
from public, anon, authenticated, service_role;
revoke all on function private.reserve_plan_export(
  uuid, uuid, uuid, text, jsonb, bytea, bytea, bytea, bytea
) from public, anon, authenticated, service_role;
revoke all on function private.complete_plan_export(uuid, uuid, uuid, bigint, bytea)
from public, anon, authenticated, service_role;
revoke all on function private.fail_plan_export(uuid, uuid, uuid)
from public, anon, authenticated, service_role;
revoke all on function private.get_plan_export(uuid, uuid, uuid)
from public, anon, authenticated, service_role;
revoke all on function private.list_profile_export_purge_paths(uuid)
from public, anon, authenticated, service_role;
revoke all on function private.confirm_profile_export_purge(uuid, jsonb)
from public, anon, authenticated, service_role;

revoke all on function public.internal_get_plan_export_source(uuid, uuid, uuid)
from public, anon, authenticated;
revoke all on function public.internal_reserve_plan_export(
  uuid, uuid, uuid, text, jsonb, bytea, bytea, bytea, bytea
) from public, anon, authenticated;
revoke all on function public.internal_complete_plan_export(uuid, uuid, uuid, bigint, bytea)
from public, anon, authenticated;
revoke all on function public.internal_fail_plan_export(uuid, uuid, uuid)
from public, anon, authenticated;
revoke all on function public.internal_get_plan_export(uuid, uuid, uuid)
from public, anon, authenticated;
revoke all on function public.internal_list_profile_export_purge_paths(uuid)
from public, anon, authenticated;
revoke all on function public.internal_confirm_profile_export_purge(uuid, jsonb)
from public, anon, authenticated;

grant execute on function public.internal_get_plan_export_source(uuid, uuid, uuid)
to service_role;
grant execute on function public.internal_reserve_plan_export(
  uuid, uuid, uuid, text, jsonb, bytea, bytea, bytea, bytea
) to service_role;
grant execute on function public.internal_complete_plan_export(uuid, uuid, uuid, bigint, bytea)
to service_role;
grant execute on function public.internal_fail_plan_export(uuid, uuid, uuid)
to service_role;
grant execute on function public.internal_get_plan_export(uuid, uuid, uuid)
to service_role;
grant execute on function public.internal_list_profile_export_purge_paths(uuid)
to service_role;
grant execute on function public.internal_confirm_profile_export_purge(uuid, jsonb)
to service_role;
