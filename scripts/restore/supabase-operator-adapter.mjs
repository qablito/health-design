import { createHash, createHmac } from "node:crypto";
import { spawn } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import { basename, join } from "node:path";

import { assertRestoreTargetIdentity } from "../operations/supabase-project-identity.mjs";

export const SECURITY_POLICY_MANIFEST_DIGEST =
  "949f93950219470fe325bb427912bcf274ba594c60f94a5623add2517de73bf5";

function run(command, args, { environment, input = "" }) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      env: { PATH: process.env.PATH, PGDATABASE: environment.PGDATABASE },
      stdio: ["pipe", "pipe", "pipe"],
    });
    const stdout = [];
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.resume();
    child.once("error", () => reject(new Error(`${command}_unavailable`)));
    child.once("close", (code) => {
      if (code === 0) resolvePromise(Buffer.concat(stdout).toString("utf8"));
      else reject(new Error(`${command}_failed`));
    });
    child.stdin.end(input);
  });
}

function sqlLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function auditMirrorEvent(record) {
  const payload = record?.payload;
  const receipt = record?.receipt;
  let signature;
  try {
    signature = Buffer.from(receipt?.signature ?? "", "base64url");
  } catch {
    throw new Error("restore_audit_record_invalid");
  }
  if (
    !payload ||
    payload.stream !== "admin-audit" ||
    !["intent", "outcome"].includes(payload.phase) ||
    !receipt ||
    receipt.recordHash !== record.recordHash ||
    receipt.idempotencyHash !== record.idempotencyHash ||
    receipt.sequence !== record.sequence ||
    receipt.timestamp !== record.timestamp ||
    receipt.stream !== "admin-audit" ||
    !Number.isSafeInteger(record.sequence) ||
    record.sequence < 1 ||
    !Number.isInteger(receipt.keyVersion) ||
    receipt.keyVersion < 1 ||
    !/^[a-f0-9]{64}$/.test(record.recordHash) ||
    !/^[a-f0-9]{64}$/.test(record.idempotencyHash) ||
    signature.length !== 64
  ) {
    throw new Error("restore_audit_record_invalid");
  }
  return {
    ...payload,
    externalIdempotencyHash: record.idempotencyHash,
    externalKeyVersion: receipt.keyVersion,
    externalReceiptSignature: signature.toString("hex"),
    externalRecordHash: record.recordHash,
    externalSequence: record.sequence,
    externalTimestamp: record.timestamp,
    impersonationSessionId:
      payload.targetType === "impersonation_session" ? payload.targetId : null,
    result: payload.phase === "intent" ? "accepted" : payload.result,
  };
}

async function psql(databaseUrl, sql) {
  return run(
    "psql",
    ["--no-psqlrc", "--set=ON_ERROR_STOP=1", "--quiet", "--tuples-only", "--no-align"],
    { environment: { PGDATABASE: databaseUrl }, input: sql },
  );
}

function targetBase(bundle) {
  const url = new URL(bundle.targetSupabaseUrl);
  if (
    !(
      url.protocol === "https:" ||
      (url.protocol === "http:" &&
        ["127.0.0.1", "[::1]", "localhost"].includes(url.hostname))
    ) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error("invalid_target_supabase_url");
  }
  return url;
}

function targetHeaders(bundle, json = false) {
  return {
    apikey: bundle.targetServiceRoleKey,
    authorization: `Bearer ${bundle.targetServiceRoleKey}`,
    ...(json ? { "content-type": "application/json" } : {}),
  };
}

async function applyCurrentMigrations(databaseUrl, migrationsDirectory, query = psql) {
  const installed = new Set(
    (
      await query(
        databaseUrl,
        "select version from supabase_migrations.schema_migrations order by version;",
      )
    )
      .split("\n")
      .filter(Boolean),
  );
  const files = (await readdir(migrationsDirectory))
    .filter((file) => /^[0-9]+_.+\.sql$/.test(file))
    .sort();
  for (const file of files) {
    const version = file.slice(0, file.indexOf("_"));
    if (installed.has(version)) continue;
    const migration = await readFile(join(migrationsDirectory, file), "utf8");
    await query(
      databaseUrl,
      `begin;\n${migration}\ninsert into supabase_migrations.schema_migrations(version,name) values (${sqlLiteral(
        version,
      )}, ${sqlLiteral(basename(file, ".sql").slice(version.length + 1))});\ncommit;`,
    );
  }
}

export function createSupabaseRestoreDependencies(bundle, options = {}) {
  if (
    typeof bundle.targetDatabaseUrl !== "string" ||
    typeof bundle.targetServiceRoleKey !== "string" ||
    typeof bundle.targetSupabaseUrl !== "string" ||
    !bundle.tombstoneHmacKeys ||
    typeof bundle.tombstoneHmacKeys !== "object"
  ) {
    throw new Error("invalid_restore_operator_secrets");
  }
  targetBase(bundle);
  assertRestoreTargetIdentity(bundle);
  const databaseUrl = bundle.targetDatabaseUrl;
  const query = options.psql ?? psql;
  const uploaded = new Map();
  return {
    applyAuditRecords: async (records) => {
      const events = records.map(auditMirrorEvent);
      const encoded = Buffer.from(JSON.stringify(events)).toString("base64");
      const mirrored = Number(
        (
          await query(
            databaseUrl,
            `
begin;

alter table private.technical_audit_events
disable trigger technical_audit_events_are_immutable;

delete from private.audit_outbox outbox
using private.technical_audit_events event
where outbox.technical_audit_event_id = event.id
  and event.external_sequence is not null;

delete from private.technical_audit_events
where external_sequence is not null;

with payload as (
  select value
  from jsonb_array_elements(
    convert_from(decode(${sqlLiteral(encoded)}, 'base64'), 'UTF8')::jsonb
  )
)
insert into private.technical_audit_events (
  actor_id, action, target_type, target_id, result, request_id, created_at,
  phase, original_actor_id, effective_profile_id, impersonation_session_id,
  external_sequence, external_timestamp, external_record_hash,
  external_receipt_signature, external_key_version, external_idempotency_hash
)
select
  case when exists (
    select 1 from public.actors actor
    where actor.id = (value ->> 'originalActorId')::uuid
  ) then (value ->> 'originalActorId')::uuid else null end,
  value ->> 'action',
  value ->> 'targetType',
  (value ->> 'targetId')::uuid,
  value ->> 'result',
  (value ->> 'requestId')::uuid,
  (value ->> 'createdAt')::timestamptz,
  value ->> 'phase',
  case when exists (
    select 1 from public.actors actor
    where actor.id = (value ->> 'originalActorId')::uuid
  ) then (value ->> 'originalActorId')::uuid else null end,
  case when exists (
    select 1 from public.profiles profile
    where profile.id = (value ->> 'effectiveProfileId')::uuid
  ) then (value ->> 'effectiveProfileId')::uuid else null end,
  case when exists (
    select 1 from private.impersonation_sessions impersonation
    where impersonation.id = (value ->> 'impersonationSessionId')::uuid
  ) then (value ->> 'impersonationSessionId')::uuid else null end,
  (value ->> 'externalSequence')::bigint,
  (value ->> 'externalTimestamp')::timestamptz,
  decode(value ->> 'externalRecordHash', 'hex'),
  decode(value ->> 'externalReceiptSignature', 'hex'),
  (value ->> 'externalKeyVersion')::integer,
  decode(value ->> 'externalIdempotencyHash', 'hex')
from payload
on conflict (request_id, phase) do update set
  actor_id = excluded.actor_id,
  action = excluded.action,
  target_type = excluded.target_type,
  target_id = excluded.target_id,
  result = excluded.result,
  created_at = excluded.created_at,
  original_actor_id = excluded.original_actor_id,
  effective_profile_id = excluded.effective_profile_id,
  impersonation_session_id = excluded.impersonation_session_id,
  external_sequence = excluded.external_sequence,
  external_timestamp = excluded.external_timestamp,
  external_record_hash = excluded.external_record_hash,
  external_receipt_signature = excluded.external_receipt_signature,
  external_key_version = excluded.external_key_version,
  external_idempotency_hash = excluded.external_idempotency_hash;

alter table private.technical_audit_events
enable trigger technical_audit_events_are_immutable;

with payload as (
  select value
  from jsonb_array_elements(
    convert_from(decode(${sqlLiteral(encoded)}, 'base64'), 'UTF8')::jsonb
  )
)
select count(*)
from payload
join private.technical_audit_events event
  on event.request_id = (value ->> 'requestId')::uuid
 and event.phase = value ->> 'phase'
where event.action = value ->> 'action'
  and event.target_type = value ->> 'targetType'
  and event.target_id is not distinct from (value ->> 'targetId')::uuid
  and event.result = value ->> 'result'
  and event.created_at = (value ->> 'createdAt')::timestamptz
  and event.actor_id is not distinct from (
    case when exists (
      select 1 from public.actors actor
      where actor.id = (value ->> 'originalActorId')::uuid
    ) then (value ->> 'originalActorId')::uuid else null end
  )
  and event.original_actor_id is not distinct from (
    case when exists (
      select 1 from public.actors actor
      where actor.id = (value ->> 'originalActorId')::uuid
    ) then (value ->> 'originalActorId')::uuid else null end
  )
  and event.effective_profile_id is not distinct from (
    case when exists (
      select 1 from public.profiles profile
      where profile.id = (value ->> 'effectiveProfileId')::uuid
    ) then (value ->> 'effectiveProfileId')::uuid else null end
  )
  and event.impersonation_session_id is not distinct from (
    case when exists (
      select 1 from private.impersonation_sessions impersonation
      where impersonation.id = (value ->> 'impersonationSessionId')::uuid
    ) then (value ->> 'impersonationSessionId')::uuid else null end
  )
  and event.external_sequence = (value ->> 'externalSequence')::bigint
  and event.external_timestamp = (value ->> 'externalTimestamp')::timestamptz
  and event.external_record_hash = decode(value ->> 'externalRecordHash', 'hex')
  and event.external_receipt_signature =
    decode(value ->> 'externalReceiptSignature', 'hex')
   and event.external_key_version = (value ->> 'externalKeyVersion')::integer
   and event.external_idempotency_hash =
     decode(value ->> 'externalIdempotencyHash', 'hex');

commit;
`,
          )
        ).trim(),
      );
      if (mirrored !== events.length) {
        throw new Error("restore_audit_mirror_mismatch");
      }
    },
    applyCurrentMigrations: () =>
      applyCurrentMigrations(
        databaseUrl,
        options.migrationsDirectory ?? join(process.cwd(), "supabase/migrations"),
        query,
      ),
    applyTombstones: async (markers) => {
      const ids = (
        await query(databaseUrl, "select id::text from public.profiles order by id;")
      )
        .split("\n")
        .filter(Boolean);
      const markerSet = new Set(markers);
      for (const profileId of ids) {
        let matched = false;
        for (const key of Object.values(bundle.tombstoneHmacKeys)) {
          if (
            typeof key === "string" &&
            markerSet.has(createHmac("sha256", key).update(profileId).digest("hex"))
          ) {
            matched = true;
            break;
          }
        }
        if (matched) {
          await query(
            databaseUrl,
            `select private.restore_apply_profile_tombstone(${sqlLiteral(
              profileId,
            )}::uuid);`,
          );
        }
      }
    },
    assertDatabaseEmpty: async () => {
      const count = Number(
        (
          await query(
            databaseUrl,
            `
select count(*)
from pg_class relation
join pg_namespace namespace on namespace.oid = relation.relnamespace
where relation.relkind in ('r','p','v','m','S')
  and namespace.nspname not in ('pg_catalog','information_schema');
`,
          )
        ).trim(),
      );
      if (count !== 0) throw new Error("restore_target_database_not_empty");
    },
    registerValidationKey: async ({ keyVersion }) => {
      const publicKey = bundle.signingPublicKeys?.[String(keyVersion)];
      if (typeof publicKey !== "string") {
        throw new Error("restore_validation_public_key_required");
      }
      const spki = Buffer.from(publicKey, "base64");
      const raw = spki.subarray(-32);
      if (raw.length !== 32) throw new Error("invalid_restore_validation_public_key");
      await options.operatorJobs.registerRestoreValidationKey(
        keyVersion,
        raw.toString("hex"),
      );
    },
    revokeSessions: async () => {
      await query(
        databaseUrl,
        "begin; delete from auth.refresh_tokens; delete from auth.sessions; commit;",
      );
    },
    uploadStorageObject: async ({ bucket, bytes, path }) => {
      const encodedPath = path.split("/").map(encodeURIComponent).join("/");
      const url = new URL(
        `/storage/v1/object/${encodeURIComponent(bucket)}/${encodedPath}`,
        targetBase(bundle),
      );
      const stored = await (options.fetcher ?? fetch)(url, {
        body: bytes,
        headers: {
          ...targetHeaders(bundle),
          "x-upsert": "false",
        },
        method: "POST",
        redirect: "error",
        referrerPolicy: "no-referrer",
      });
      if (!stored.ok) throw new Error("restore_storage_upload_failed");
      const readback = await (options.fetcher ?? fetch)(url, {
        headers: targetHeaders(bundle),
        method: "GET",
        redirect: "error",
        referrerPolicy: "no-referrer",
      });
      if (!readback.ok) throw new Error("restore_storage_readback_failed");
      const actual = new Uint8Array(await readback.arrayBuffer());
      if (
        createHash("sha256").update(actual).digest("hex") !==
        createHash("sha256").update(bytes).digest("hex")
      ) {
        throw new Error("restore_storage_readback_mismatch");
      }
      uploaded.set(`${bucket}/${path}`, true);
    },
    verifyAbsenceAndSecurity: async ({ deletedMarkers, expectedStorageObjects }) => {
      const profileIds = (
        await query(databaseUrl, "select id::text from public.profiles order by id;")
      )
        .split("\n")
        .filter(Boolean);
      const markerSet = new Set(deletedMarkers);
      const deletedProfilesAbsent = profileIds.every((profileId) =>
        Object.values(bundle.tombstoneHmacKeys).every(
          (key) =>
            typeof key !== "string" ||
            !markerSet.has(createHmac("sha256", key).update(profileId).digest("hex")),
        ),
      );
      const sessions = Number(
        (
          await query(
            databaseUrl,
            "select (select count(*) from auth.sessions) + (select count(*) from auth.refresh_tokens);",
          )
        ).trim(),
      );
      const securityPolicyDigest = (
        await query(
          databaseUrl,
          `
with security_policy_manifest_relations as (
  select
    namespace.nspname as schema_name,
    relation.relname as relation_name,
    relation.relrowsecurity,
    relation.relforcerowsecurity,
    relation.relowner::regrole::text as owner,
    (
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'grantor', entry.grantor::regrole::text,
            'grantee', case
              when entry.grantee = 0 then 'PUBLIC'
              else entry.grantee::regrole::text
            end,
            'privilege', entry.privilege_type,
            'grantable', entry.is_grantable
          )
          order by entry.grantor, entry.grantee, entry.privilege_type,
            entry.is_grantable
        ),
        '[]'::jsonb
      )
      from aclexplode(
        coalesce(relation.relacl, acldefault('r', relation.relowner))
      ) entry
    ) as acl
  from pg_class relation
  join pg_namespace namespace on namespace.oid = relation.relnamespace
  where relation.relkind in ('r', 'p')
    and (
      namespace.nspname in ('public', 'private', 'storage')
      or (
        namespace.nspname = 'auth'
        and relation.relname in (
          'users', 'sessions', 'refresh_tokens', 'identities',
          'mfa_amr_claims', 'mfa_challenges', 'mfa_factors',
          'one_time_tokens'
        )
      )
    )
),
security_policy_manifest_policies as (
  select
    schemaname, tablename, policyname, permissive, roles, cmd,
    coalesce(qual, '') as qual,
    coalesce(with_check, '') as with_check
  from pg_policies
  where schemaname in ('public', 'storage')
),
security_policy_manifest_functions as (
  select
    namespace.nspname as schema_name,
    procedure.proname,
    pg_get_function_identity_arguments(procedure.oid) as arguments,
    procedure.prosecdef,
    procedure.proowner::regrole::text as owner,
    (
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'grantor', entry.grantor::regrole::text,
            'grantee', case
              when entry.grantee = 0 then 'PUBLIC'
              else entry.grantee::regrole::text
            end,
            'privilege', entry.privilege_type,
            'grantable', entry.is_grantable
          )
          order by entry.grantor, entry.grantee, entry.privilege_type,
            entry.is_grantable
        ),
        '[]'::jsonb
      )
      from aclexplode(
        coalesce(procedure.proacl, acldefault('f', procedure.proowner))
      ) entry
    ) as acl,
    pg_get_functiondef(procedure.oid) as definition
  from pg_proc procedure
  join pg_namespace namespace on namespace.oid = procedure.pronamespace
  where procedure.oid in (
    'private.require_superadmin_aal2(uuid,uuid)'::regprocedure,
    'private.has_active_profile_access(uuid)'::regprocedure
  )
),
security_policy_manifest as (
  select jsonb_build_object(
    'schemaVersion', 1,
    'relations', (
      select jsonb_agg(
        to_jsonb(relation_entry)
        order by relation_entry.schema_name, relation_entry.relation_name
      )
      from security_policy_manifest_relations relation_entry
    ),
    'policies', (
      select jsonb_agg(
        to_jsonb(policy_entry)
        order by policy_entry.schemaname, policy_entry.tablename,
          policy_entry.policyname
      )
      from security_policy_manifest_policies policy_entry
    ),
    'functions', (
      select jsonb_agg(
        to_jsonb(function_entry)
        order by function_entry.schema_name, function_entry.proname
      )
      from security_policy_manifest_functions function_entry
    ),
    'bucket', (
      select jsonb_build_object(
        'id', id,
        'name', name,
        'public', public,
        'fileSizeLimit', file_size_limit,
        'allowedMimeTypes', allowed_mime_types
      )
      from storage.buckets
      where id = 'plan-exports'
    )
  ) as value
)
select encode(extensions.digest(value::text, 'sha256'), 'hex')
from security_policy_manifest;
`,
        )
      ).trim();
      const securityPolicyVerified =
        securityPolicyDigest === SECURITY_POLICY_MANIFEST_DIGEST;
      let targetObjects;
      try {
        targetObjects = JSON.parse(
          (
            await query(
              databaseUrl,
              `
select coalesce(
  jsonb_agg(
    jsonb_build_object('bucket', object.bucket_id, 'path', object.name)
    order by object.bucket_id, object.name
  ),
  '[]'::jsonb
)::text
from storage.objects object;
`,
            )
          ).trim(),
        );
      } catch {
        throw new Error("restore_storage_inventory_invalid");
      }
      if (
        !Array.isArray(targetObjects) ||
        targetObjects.some(
          (object) =>
            !object ||
            typeof object.bucket !== "string" ||
            typeof object.path !== "string",
        )
      ) {
        throw new Error("restore_storage_inventory_invalid");
      }
      const targetKeys = targetObjects
        .map((object) => `${object.bucket}/${object.path}`)
        .sort((left, right) => left.localeCompare(right, "en"));
      const uploadedKeys = [...uploaded.keys()].sort((left, right) =>
        left.localeCompare(right, "en"),
      );
      return {
        aal2Required: securityPolicyVerified,
        deletedProfilesAbsent,
        rlsVerified: securityPolicyVerified,
        securityPolicyDigest,
        sessionsRevoked: sessions === 0,
        storageComplete:
          uploaded.size === expectedStorageObjects &&
          targetKeys.length === uploadedKeys.length &&
          targetKeys.every((key, index) => key === uploadedKeys[index]),
      };
    },
  };
}

export { run as runOperatorProcess };
