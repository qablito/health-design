import { spawn } from "node:child_process";
import { createHmac } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  verifyAdminAuditClosure,
  verifyDeletionTombstones,
  verifyLedgerContinuity,
} from "../operations/ledger-verifiers.mjs";
import { assertBackupSourceIdentity } from "../operations/supabase-project-identity.mjs";

const encoder = new TextEncoder();

function closedBuckets(value) {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    new Set(value).size !== value.length ||
    value.some(
      (bucket) =>
        typeof bucket !== "string" || !/^[a-z0-9][a-z0-9._-]{0,62}$/.test(bucket),
    )
  ) {
    throw new Error("authorized_private_buckets_required");
  }
  return [...value].sort((left, right) => left.localeCompare(right, "en"));
}

function storageBase(input) {
  let url;
  try {
    url = new URL(input.supabaseUrl);
  } catch {
    throw new Error("invalid_supabase_url");
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.pathname !== "/" && url.pathname !== "")
  ) {
    throw new Error("invalid_supabase_url");
  }
  return url;
}

async function responseJson(response, code) {
  if (!response.ok) throw new Error(code);
  try {
    return await response.json();
  } catch {
    throw new Error(code);
  }
}

function storageHeaders(serviceRoleKey) {
  if (typeof serviceRoleKey !== "string" || serviceRoleKey.length < 16) {
    throw new Error("invalid_service_role_key");
  }
  return {
    apikey: serviceRoleKey,
    authorization: `Bearer ${serviceRoleKey}`,
    "content-type": "application/json",
  };
}

async function listPrivateBuckets(input, fetcher) {
  const response = await fetcher(new URL("/storage/v1/bucket", storageBase(input)), {
    headers: storageHeaders(input.serviceRoleKey),
    method: "GET",
    referrerPolicy: "no-referrer",
  });
  const buckets = await responseJson(response, "storage_bucket_list_failed");
  if (!Array.isArray(buckets)) throw new Error("storage_bucket_list_invalid");
  return buckets
    .filter((bucket) => bucket?.public === false)
    .map((bucket) => bucket.id)
    .sort((left, right) => left.localeCompare(right, "en"));
}

async function listBucketObjects(input, bucket, fetcher) {
  const objects = [];
  const prefixes = [""];
  while (prefixes.length > 0) {
    const prefix = prefixes.shift();
    let offset = 0;
    while (true) {
      const response = await fetcher(
        new URL(
          `/storage/v1/object/list/${encodeURIComponent(bucket)}`,
          storageBase(input),
        ),
        {
          body: JSON.stringify({
            limit: 1_000,
            offset,
            prefix,
            sortBy: { column: "name", order: "asc" },
          }),
          headers: storageHeaders(input.serviceRoleKey),
          method: "POST",
          referrerPolicy: "no-referrer",
        },
      );
      const page = await responseJson(response, "storage_object_list_failed");
      if (!Array.isArray(page)) throw new Error("storage_object_list_invalid");
      for (const entry of page) {
        if (!entry || typeof entry.name !== "string" || entry.name.length === 0) {
          throw new Error("storage_object_list_invalid");
        }
        const path = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (!Object.hasOwn(entry, "metadata")) {
          throw new Error("storage_object_metadata_unverified");
        }
        if (entry.metadata === null) {
          prefixes.push(path);
        } else {
          objects.push(path);
        }
      }
      if (page.length < 1_000) break;
      offset += page.length;
    }
  }
  return objects.sort((left, right) => left.localeCompare(right, "en"));
}

async function downloadStorageObject(input, bucket, path, fetcher) {
  const encodedPath = path.split("/").map(encodeURIComponent).join("/");
  const response = await fetcher(
    new URL(
      `/storage/v1/object/${encodeURIComponent(bucket)}/${encodedPath}`,
      storageBase(input),
    ),
    {
      headers: storageHeaders(input.serviceRoleKey),
      method: "GET",
      referrerPolicy: "no-referrer",
    },
  );
  if (!response.ok) throw new Error("storage_object_download_failed");
  return new Uint8Array(await response.arrayBuffer());
}

export function runPgDump({ args, environment }) {
  let databaseUrl;
  try {
    databaseUrl = new URL(environment.PGDATABASE);
  } catch {
    throw new Error("invalid_database_url");
  }
  const sslmode = databaseUrl.searchParams.get("sslmode") ?? "require";
  const database = decodeURIComponent(databaseUrl.pathname.slice(1));
  if (
    !["postgres:", "postgresql:"].includes(databaseUrl.protocol) ||
    !databaseUrl.hostname ||
    !databaseUrl.username ||
    !databaseUrl.password ||
    !database ||
    !["require", "verify-ca", "verify-full"].includes(sslmode)
  ) {
    throw new Error("invalid_database_url");
  }
  return new Promise((resolvePromise, reject) => {
    const child = spawn("pg_dump", args, {
      env: {
        PATH: process.env.PATH,
        PGDATABASE: database,
        PGHOST: databaseUrl.hostname,
        PGPASSWORD: decodeURIComponent(databaseUrl.password),
        PGPORT: databaseUrl.port || "5432",
        PGSSLMODE: sslmode,
        PGUSER: decodeURIComponent(databaseUrl.username),
      },
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      if (stderr.length < 4_096) stderr += String(chunk);
    });
    child.once("error", () => reject(new Error("pg_dump_unavailable")));
    child.once("close", (code) => {
      if (code === 0) resolvePromise();
      else reject(new Error(stderr ? "pg_dump_failed" : "pg_dump_failed"));
    });
  });
}

function ledgerObject(
  stream,
  live,
  knownTombstoneKeyVersions,
  completedAuditRanges = [],
) {
  const records = live.suffixRecords;
  if (!Array.isArray(records)) throw new Error("ledger_snapshot_invalid");
  if (live.requested.sequence !== 0 || live.requested.recordHash !== "0".repeat(64)) {
    throw new Error("ledger_snapshot_anchor_invalid");
  }
  const head = {
    hash: live.current.recordHash,
    sequence: live.current.sequence,
  };
  if (stream === "deletions") {
    const verified = verifyDeletionTombstones(records, knownTombstoneKeyVersions);
    if (
      verified.head !== head.hash ||
      verified.sequence !== head.sequence ||
      verified.incompleteAuditRanges.length > 0
    ) {
      throw new Error("deletions_ledger_snapshot_invalid");
    }
    return {
      bytes: encoder.encode(JSON.stringify({ head, records })),
      logicalPath: "ledgers/deletions.json",
      prefix: head,
      type: "deletions-ledger",
    };
  }
  const missingSequences = live.missingSequences ?? [];
  if (
    !Array.isArray(missingSequences) ||
    missingSequences.some(
      (sequence, index) =>
        !Number.isSafeInteger(sequence) ||
        sequence < 1 ||
        (index > 0 && missingSequences[index - 1] >= sequence),
    )
  ) {
    throw new Error("admin_audit_ledger_snapshot_invalid");
  }
  let missingIndex = 0;
  for (const range of completedAuditRanges) {
    for (
      let sequence = range.manifest.fromSequence;
      sequence <= range.manifest.toSequence;
      sequence += 1
    ) {
      if (missingSequences[missingIndex] !== sequence) {
        throw new Error("admin_audit_ledger_snapshot_invalid");
      }
      missingIndex += 1;
    }
  }
  if (missingIndex !== missingSequences.length) {
    throw new Error("admin_audit_ledger_snapshot_invalid");
  }
  const closure = verifyAdminAuditClosure(records);
  const verified = verifyLedgerContinuity(records, {
    gaps: completedAuditRanges,
    stream: "admin-audit",
  });
  if (
    verified.head !== head.hash ||
    verified.sequence !== head.sequence ||
    closure.pendingRequestIds.length > 0
  ) {
    throw new Error("admin_audit_ledger_snapshot_invalid");
  }
  return {
    bytes: encoder.encode(
      JSON.stringify({
        completedRanges: completedAuditRanges,
        head,
        incompleteRanges: [],
        pendingIntents: closure.pendingRequestIds,
        records,
      }),
    ),
    logicalPath: "ledgers/admin-audit.json",
    prefix: head,
    type: "admin-audit-ledger",
  };
}

export async function captureLiveBackupInputs(input, dependencies = {}) {
  assertBackupSourceIdentity(input);
  const authorized = closedBuckets(input.authorizedPrivateBuckets);
  const fetcher = dependencies.fetcher ?? fetch;
  const privateBuckets = await listPrivateBuckets(input, fetcher);
  if (
    privateBuckets.length !== authorized.length ||
    privateBuckets.some((bucket, index) => bucket !== authorized[index])
  ) {
    throw new Error("private_bucket_allowlist_mismatch");
  }
  if (typeof dependencies.ledgerHeadProvider !== "function") {
    throw new Error("live_ledger_head_provider_required");
  }
  const knownTombstoneKeyVersions = new Set(
    Object.keys(input.tombstoneHmacKeys ?? {}).map(Number),
  );
  if (
    knownTombstoneKeyVersions.size === 0 ||
    [...knownTombstoneKeyVersions].some(
      (version) => !Number.isInteger(version) || version < 1,
    )
  ) {
    throw new Error("known_tombstone_key_versions_required");
  }
  const storageInventory = [];
  const storagePaths = [];
  for (const bucket of privateBuckets) {
    const paths = await listBucketObjects(input, bucket, fetcher);
    const logicalPaths = [];
    for (const path of paths) {
      const profileId = path.split("/", 1)[0];
      if (
        !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(
          profileId,
        )
      ) {
        throw new Error("storage_profile_owner_required");
      }
      const logicalPath = `storage/${bucket}/${path}`;
      logicalPaths.push(logicalPath);
      storagePaths.push({ bucket, logicalPath, path, profileId });
    }
    storageInventory.push({ bucket, enumerated: true, logicalPaths });
  }

  const temporaryDirectory = await mkdtemp(
    join(tmpdir(), "health-design-t18-pg-dump-"),
  );
  try {
    const outputPath = join(temporaryDirectory, "postgres.dump");
    await (dependencies.runPgDump ?? runPgDump)({
      args: ["--format=custom", "--file", outputPath],
      environment: { PGDATABASE: input.databaseUrl },
      outputPath,
    });
    const database = new Uint8Array(await readFile(outputPath));
    const [deletions, adminAudit] = await Promise.all([
      dependencies.ledgerHeadProvider("deletions", 0),
      dependencies.ledgerHeadProvider("admin-audit", 0),
    ]);
    const deletionState = verifyDeletionTombstones(
      deletions.suffixRecords,
      knownTombstoneKeyVersions,
    );
    if (deletionState.activeProfileMarkerKeyVersions.length > 1) {
      throw new Error("tombstone_key_rotation_incomplete");
    }
    const activeMarkerKeyVersion =
      deletionState.activeProfileMarkerKeyVersions[0] ??
      Math.max(...knownTombstoneKeyVersions);
    const activeMarkerKey = input.tombstoneHmacKeys[String(activeMarkerKeyVersion)];
    if (typeof activeMarkerKey !== "string" || activeMarkerKey.length === 0) {
      throw new Error("active_tombstone_key_required");
    }
    const storageObjects = [];
    for (const { bucket, logicalPath, path, profileId } of storagePaths) {
      storageObjects.push({
        bytes: await downloadStorageObject(input, bucket, path, fetcher),
        logicalPath,
        profileMarker: createHmac("sha256", activeMarkerKey)
          .update(profileId.toLowerCase())
          .digest("hex"),
        type: "storage",
      });
    }
    return {
      objects: [
        {
          bytes: database,
          logicalPath: "database/postgres.dump",
          type: "database",
        },
        ledgerObject("deletions", deletions, knownTombstoneKeyVersions),
        ledgerObject(
          "admin-audit",
          adminAudit,
          knownTombstoneKeyVersions,
          deletionState.completedAuditRanges,
        ),
        ...storageObjects,
      ],
      storageInventory,
    };
  } finally {
    await rm(temporaryDirectory, { force: true, recursive: true });
  }
}
