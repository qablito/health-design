const JSON_HEADERS = {
  "cache-control": "no-store",
  "content-type": "application/json; charset=utf-8",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
};
const MAX_EVENT_BYTES = 4_096;
const MAX_CLOCK_SKEW_MS = 60_000;
const PENDING_ALERT_MS = 300_000;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HEX_64_PATTERN = /^[a-f0-9]{64}$/;
const INTENT_KEYS = new Set([
  "action",
  "createdAt",
  "effectiveProfileId",
  "originalActorId",
  "phase",
  "requestId",
  "result",
  "schemaVersion",
  "stream",
  "targetId",
  "targetType",
]);
const OUTCOME_KEYS = new Set([...INTENT_KEYS, "errorCode", "intentRecordHash"]);
const PROFILE_DELETION_KEYS = new Set([
  "markerKeyVersion",
  "operationId",
  "profileMarker",
  "recordType",
  "schemaVersion",
  "stream",
]);
const PROFILE_MARKER_REKEY_KEYS = new Set([
  ...PROFILE_DELETION_KEYS,
  "previousMarkerKeyVersion",
  "previousProfileMarker",
]);
const AUDIT_RANGE_INTENT_KEYS = new Set([
  "auditDeletionJobId",
  "fromSequence",
  "operationId",
  "rangeHash",
  "recordType",
  "schemaVersion",
  "stream",
  "toSequence",
]);
const AUDIT_RANGE_COMPLETE_KEYS = new Set([
  ...AUDIT_RANGE_INTENT_KEYS,
  "intentRecordHash",
]);
const ACTION_TARGETS = {
  barcode_correction_approve: "commercial_product_revision",
  barcode_correction_correct: "barcode_correction",
  barcode_correction_reject: "barcode_correction",
  catalog_match_candidates_generate: "catalog_revision",
  catalog_publication_hide: "catalog_publication",
  catalog_revision_publish: "catalog_revision",
  anonymous_auth_cleanup: "auth_user",
  audit_range_delete_execute: "audit_deletion_job",
  audit_range_delete_prepare: "audit_deletion_job",
  backup_create: "backup_job",
  impersonation_end: "impersonation_session",
  impersonation_start: "profile",
  matching_rule_activate: "product_matching_rule",
  matching_rule_review: "product_matching_rule",
  profile_deletion_permanent: "deletion_job",
  profile_deletion_resume: "deletion_job",
  restore_create: "restore_job",
  restore_promote: "restore_job",
};
const PROFILE_SCOPED_ACTIONS = new Set([
  "barcode_correction_approve",
  "barcode_correction_correct",
  "barcode_correction_reject",
  "catalog_match_candidates_generate",
  "catalog_publication_hide",
  "catalog_revision_publish",
  "impersonation_end",
  "impersonation_start",
  "matching_rule_activate",
  "matching_rule_review",
  "profile_deletion_permanent",
  "profile_deletion_resume",
]);

function json(body, status) {
  return new Response(JSON.stringify(body), {
    headers: JSON_HEADERS,
    status,
  });
}

function base64UrlToBytes(value) {
  const base64 = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function bytesToBase64Url(bytes) {
  let binary = "";
  for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function bytesToHex(bytes) {
  return Array.from(new Uint8Array(bytes), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

function normalizeCanonical(value) {
  if (typeof value === "string") return value.normalize("NFC");
  if (Array.isArray(value)) return value.map(normalizeCanonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, normalizeCanonical(value[key])]),
    );
  }
  return value;
}

function canonicalJson(value) {
  return JSON.stringify(normalizeCanonical(value));
}

async function sha256Hex(value) {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
  return bytesToHex(await crypto.subtle.digest("SHA-256", bytes));
}

async function hmacSha256Hex(value, secret) {
  if (typeof secret !== "string" || new TextEncoder().encode(secret).byteLength < 32) {
    fail("invalid_hmac_key");
  }
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { hash: "SHA-256", name: "HMAC" },
    false,
    ["sign"],
  );
  return bytesToHex(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value)),
  );
}

function constantTimeHexEqual(left, right) {
  if (
    typeof left !== "string" ||
    typeof right !== "string" ||
    left.length !== right.length
  ) {
    return false;
  }
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

export async function signServiceRequest({
  body,
  method,
  nonce,
  path,
  secret,
  timestamp,
}) {
  return hmacSha256Hex(
    `${timestamp}\n${nonce}\n${method}\n${path}\n${await sha256Hex(body)}`,
    secret,
  );
}

function fail(message) {
  throw new Error(message);
}

export function validateAdminAuditPayload(candidate) {
  let serialized;
  try {
    serialized = JSON.stringify(candidate);
  } catch {
    fail("invalid_payload");
  }
  if (new TextEncoder().encode(serialized).byteLength > MAX_EVENT_BYTES) {
    fail("payload_too_large");
  }
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    fail("invalid_payload");
  }

  const allowedKeys = candidate.phase === "outcome" ? OUTCOME_KEYS : INTENT_KEYS;
  if (Object.keys(candidate).some((key) => !allowedKeys.has(key))) {
    fail("invalid_payload");
  }
  if (
    candidate.schemaVersion !== 1 ||
    candidate.stream !== "admin-audit" ||
    !UUID_PATTERN.test(candidate.originalActorId) ||
    (PROFILE_SCOPED_ACTIONS.has(candidate.action)
      ? !UUID_PATTERN.test(candidate.effectiveProfileId)
      : candidate.effectiveProfileId !== null) ||
    !UUID_PATTERN.test(candidate.requestId) ||
    !UUID_PATTERN.test(candidate.targetId) ||
    !(candidate.action in ACTION_TARGETS) ||
    ACTION_TARGETS[candidate.action] !== candidate.targetType ||
    !Number.isFinite(Date.parse(candidate.createdAt))
  ) {
    fail("invalid_payload");
  }

  if (candidate.phase === "intent") {
    if (
      candidate.result !== "pending" ||
      Object.keys(candidate).length !== INTENT_KEYS.size
    ) {
      fail("invalid_payload");
    }
  } else if (candidate.phase === "outcome") {
    if (
      !["failure", "success"].includes(candidate.result) ||
      !HEX_64_PATTERN.test(candidate.intentRecordHash) ||
      (candidate.result === "failure" &&
        !["domain_constraint", "mutation_failed", "reconciliation_required"].includes(
          candidate.errorCode,
        )) ||
      (candidate.result === "success" && candidate.errorCode !== undefined)
    ) {
      fail("invalid_payload");
    }
  } else {
    fail("invalid_payload");
  }

  return Object.freeze({ ...candidate });
}

function hasExactKeys(candidate, expected) {
  const keys = Object.keys(candidate);
  return keys.length === expected.size && keys.every((key) => expected.has(key));
}

export function validateDeletionLedgerPayload(candidate) {
  let serialized;
  try {
    serialized = JSON.stringify(candidate);
  } catch {
    fail("invalid_payload");
  }
  if (new TextEncoder().encode(serialized).byteLength > MAX_EVENT_BYTES) {
    fail("payload_too_large");
  }
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    fail("invalid_payload");
  }
  if (
    candidate.schemaVersion !== 1 ||
    candidate.stream !== "deletions" ||
    !UUID_PATTERN.test(candidate.operationId)
  ) {
    fail("invalid_payload");
  }

  if (candidate.recordType === "profile_deletion") {
    if (
      !hasExactKeys(candidate, PROFILE_DELETION_KEYS) ||
      !HEX_64_PATTERN.test(candidate.profileMarker) ||
      !Number.isInteger(candidate.markerKeyVersion) ||
      candidate.markerKeyVersion < 1
    ) {
      fail("invalid_payload");
    }
  } else if (candidate.recordType === "profile_marker_rekey") {
    if (
      !hasExactKeys(candidate, PROFILE_MARKER_REKEY_KEYS) ||
      !HEX_64_PATTERN.test(candidate.profileMarker) ||
      !HEX_64_PATTERN.test(candidate.previousProfileMarker) ||
      !Number.isInteger(candidate.markerKeyVersion) ||
      !Number.isInteger(candidate.previousMarkerKeyVersion) ||
      candidate.markerKeyVersion <= candidate.previousMarkerKeyVersion ||
      candidate.previousMarkerKeyVersion < 1
    ) {
      fail("invalid_payload");
    }
  } else if (
    candidate.recordType === "audit_range_delete_intent" ||
    candidate.recordType === "audit_range_delete_complete"
  ) {
    const expected =
      candidate.recordType === "audit_range_delete_complete"
        ? AUDIT_RANGE_COMPLETE_KEYS
        : AUDIT_RANGE_INTENT_KEYS;
    if (
      !hasExactKeys(candidate, expected) ||
      !UUID_PATTERN.test(candidate.auditDeletionJobId) ||
      !Number.isSafeInteger(candidate.fromSequence) ||
      !Number.isSafeInteger(candidate.toSequence) ||
      candidate.fromSequence < 1 ||
      candidate.toSequence < candidate.fromSequence ||
      !HEX_64_PATTERN.test(candidate.rangeHash) ||
      (candidate.recordType === "audit_range_delete_complete" &&
        !HEX_64_PATTERN.test(candidate.intentRecordHash))
    ) {
      fail("invalid_payload");
    }
  } else {
    fail("invalid_payload");
  }

  return Object.freeze({ ...candidate });
}

export function verifyProfileMarkerRekeyCoverage(
  existingMarkers,
  replacementMarkers,
  targetVersion,
) {
  if (!Number.isInteger(targetVersion) || targetVersion < 1) return false;
  const replacements = new Map();
  for (const replacement of replacementMarkers) {
    if (
      !replacement ||
      typeof replacement.operationId !== "string" ||
      !HEX_64_PATTERN.test(replacement.profileMarker) ||
      !HEX_64_PATTERN.test(replacement.previousProfileMarker) ||
      replacement.markerKeyVersion !== targetVersion ||
      !Number.isInteger(replacement.previousMarkerKeyVersion)
    ) {
      return false;
    }
    const key = `${replacement.operationId}:${replacement.previousMarkerKeyVersion}:${replacement.previousProfileMarker}`;
    if (replacements.has(key)) return false;
    replacements.set(key, replacement);
  }
  return existingMarkers.every((existing) => {
    if (
      !existing ||
      typeof existing.operationId !== "string" ||
      !HEX_64_PATTERN.test(existing.profileMarker) ||
      !Number.isInteger(existing.markerKeyVersion) ||
      existing.markerKeyVersion >= targetVersion
    ) {
      return false;
    }
    return replacements.has(
      `${existing.operationId}:${existing.markerKeyVersion}:${existing.profileMarker}`,
    );
  });
}

function auditAad(metadata) {
  return new TextEncoder().encode(
    `${metadata.environment}|admin-audit|${metadata.sequence}|${metadata.schemaVersion}|${metadata.previousHash}|${metadata.timestamp}`,
  );
}

async function importKek(kekBase64Url, usages) {
  const bytes = base64UrlToBytes(kekBase64Url);
  if (bytes.byteLength !== 32) fail("invalid_kek");
  return crypto.subtle.importKey("raw", bytes, "AES-KW", false, usages);
}

async function encryptAdminAuditPayload(payload, metadata, kekBase64Url) {
  const kek = await importKek(kekBase64Url, ["wrapKey"]);
  const dek = await crypto.subtle.generateKey({ length: 256, name: "AES-GCM" }, true, [
    "encrypt",
  ]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    {
      additionalData: auditAad(metadata),
      iv,
      name: "AES-GCM",
      tagLength: 128,
    },
    dek,
    new TextEncoder().encode(canonicalJson(payload)),
  );
  const wrappedDek = await crypto.subtle.wrapKey("raw", dek, kek, "AES-KW");
  return {
    ciphertext: bytesToBase64Url(ciphertext),
    iv: bytesToBase64Url(iv),
    wrappedDek: bytesToBase64Url(wrappedDek),
  };
}

function recordHashPayload(record) {
  const payload = { ...record };
  delete payload.recordHash;
  return payload;
}

export async function decryptAdminAuditRecord(record, kekBase64Url) {
  if (
    !record ||
    typeof record !== "object" ||
    !Number.isInteger(record.sequence) ||
    typeof record.environment !== "string" ||
    typeof record.previousHash !== "string" ||
    typeof record.timestamp !== "string" ||
    record.stream !== "admin-audit" ||
    record.schemaVersion !== 1 ||
    !HEX_64_PATTERN.test(record.recordHash)
  ) {
    fail("invalid_record");
  }
  const expectedHash = await sha256Hex(canonicalJson(recordHashPayload(record)));
  if (!constantTimeHexEqual(expectedHash, record.recordHash)) {
    fail("record_hash_mismatch");
  }
  const kek = await importKek(kekBase64Url, ["unwrapKey"]);
  const dek = await crypto.subtle.unwrapKey(
    "raw",
    base64UrlToBytes(record.wrappedDek),
    kek,
    "AES-KW",
    { length: 256, name: "AES-GCM" },
    false,
    ["decrypt"],
  );
  const plaintext = await crypto.subtle.decrypt(
    {
      additionalData: auditAad(record),
      iv: base64UrlToBytes(record.iv),
      name: "AES-GCM",
      tagLength: 128,
    },
    dek,
    base64UrlToBytes(record.ciphertext),
  );
  return JSON.parse(new TextDecoder().decode(plaintext));
}

async function eventIdempotencyHash(environment, event) {
  const base = {
    action: event.action,
    effectiveProfileId: event.effectiveProfileId,
    environment,
    originalActorId: event.originalActorId,
    phase: event.phase,
    requestId: event.requestId,
    stream: "admin-audit",
    targetId: event.targetId,
    targetType: event.targetType,
  };
  if (event.phase === "outcome") {
    return sha256Hex(
      JSON.stringify({
        ...base,
        errorCode: event.errorCode ?? null,
        intentRecordHash: event.intentRecordHash,
        result: event.result,
      }),
    );
  }
  return sha256Hex(JSON.stringify(base));
}

async function deletionIdempotencyHash(environment, event) {
  return sha256Hex(
    canonicalJson({
      environment,
      ...event,
    }),
  );
}

function deletionIdempotencyKey(event) {
  return `${event.operationId}:${event.recordType}:${
    event.markerKeyVersion === undefined ? "" : event.markerKeyVersion
  }`;
}

function receiptSigningPayload(receipt) {
  return new TextEncoder().encode(
    JSON.stringify({
      environment: receipt.environment,
      idempotencyHash: receipt.idempotencyHash,
      keyVersion: receipt.keyVersion,
      recordHash: receipt.recordHash,
      sequence: receipt.sequence,
      stream: receipt.stream,
      timestamp: receipt.timestamp,
    }),
  );
}

async function signReceipt(receipt, privateKeyPkcs8Base64Url) {
  const privateKey = await crypto.subtle.importKey(
    "pkcs8",
    base64UrlToBytes(privateKeyPkcs8Base64Url),
    { name: "Ed25519" },
    false,
    ["sign"],
  );
  return bytesToBase64Url(
    await crypto.subtle.sign("Ed25519", privateKey, receiptSigningPayload(receipt)),
  );
}

function versionedSecret(env, prefix, version) {
  const value = env[`${prefix}_V${version}`];
  if (typeof value !== "string" || value.length === 0) fail("missing_key");
  return value;
}

async function authenticateServiceRequest(request, rawBody, secret) {
  const timestamp = request.headers.get("x-ledger-timestamp");
  const nonce = request.headers.get("x-ledger-nonce");
  const suppliedSignature = request.headers.get("x-ledger-signature");
  if (
    !timestamp ||
    !nonce ||
    !suppliedSignature ||
    !UUID_PATTERN.test(nonce) ||
    !HEX_64_PATTERN.test(suppliedSignature)
  ) {
    return null;
  }
  const parsedTimestamp = Date.parse(timestamp);
  if (
    !Number.isFinite(parsedTimestamp) ||
    Math.abs(Date.now() - parsedTimestamp) > MAX_CLOCK_SKEW_MS
  ) {
    return null;
  }
  const expectedSignature = await signServiceRequest({
    body: rawBody,
    method: request.method,
    nonce,
    path: new URL(request.url).pathname,
    secret,
    timestamp,
  });
  return constantTimeHexEqual(suppliedSignature, expectedSignature)
    ? { nonce, timestamp }
    : null;
}

export class ContinuityLedger {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.tail = Promise.resolve();
  }

  fetch(request) {
    const operation = this.tail.then(() => this.handle(request));
    this.tail = operation.catch(() => undefined);
    return operation;
  }

  async handle(request) {
    const url = new URL(request.url);
    if (!this.env || this.env.MUTATIONS_ENABLED !== "true") {
      return json({ error: "ledger_mutations_not_enabled" }, 503);
    }
    const isAdminAppend =
      request.method === "POST" && url.pathname === "/v1/admin-audit/append";
    const isDeletionAppend =
      request.method === "POST" && url.pathname === "/v1/deletions/append";
    const isAppend = isAdminAppend || isDeletionAppend;
    const isPendingList =
      request.method === "GET" && url.pathname === "/v1/admin-audit/pending";
    if (url.search || (!isAppend && !isPendingList)) {
      return json({ error: "not_found" }, 404);
    }

    const rawBody = isAppend ? await request.text() : "";
    if (new TextEncoder().encode(rawBody).byteLength > MAX_EVENT_BYTES) {
      return json({ error: "payload_too_large" }, 413);
    }
    const authentication = await authenticateServiceRequest(
      request,
      rawBody,
      this.env.CONTINUITY_LEDGER_HMAC_KEY,
    );
    if (!authentication) return json({ error: "unauthorized" }, 401);

    const nonceKey = `nonce:${authentication.nonce}`;
    if (await this.state.storage.get(nonceKey)) {
      return json({ error: "replay" }, 409);
    }
    await this.state.storage.put(nonceKey, authentication.timestamp);

    if (isPendingList) {
      const pending = await this.state.storage.list({ prefix: "pending:" });
      const items = [];
      for (const [, value] of [...pending].slice(0, 25)) {
        const object = await this.env.ADMIN_AUDIT_BUCKET.get(value.objectKey);
        if (!object) fail("pending_record_missing");
        const record = JSON.parse(await object.text());
        const intent = await decryptAdminAuditRecord(
          record,
          versionedSecret(this.env, "ADMIN_AUDIT_KEK", record.encryptionKeyVersion),
        );
        if (intent.phase !== "intent" || intent.requestId === undefined) {
          fail("invalid_pending_record");
        }
        items.push({ ...intent, intentRecordHash: value.recordHash });
      }
      return json({ items }, 200);
    }

    let event;
    try {
      event = isDeletionAppend
        ? validateDeletionLedgerPayload(JSON.parse(rawBody))
        : validateAdminAuditPayload(JSON.parse(rawBody));
    } catch (error) {
      const errorCode =
        error instanceof Error &&
        ["invalid_payload", "payload_too_large"].includes(error.message)
          ? error.message
          : "invalid_payload";
      return json({ error: errorCode }, errorCode === "payload_too_large" ? 413 : 422);
    }
    const expectedIdempotencyKey = isDeletionAppend
      ? deletionIdempotencyKey(event)
      : event.requestId;
    if (request.headers.get("idempotency-key") !== expectedIdempotencyKey) {
      return json({ error: "invalid_idempotency_key" }, 422);
    }
    if (
      isAdminAppend &&
      Math.abs(Date.now() - Date.parse(event.createdAt)) > PENDING_ALERT_MS
    ) {
      return json({ error: "stale_event" }, 422);
    }

    const stream = isDeletionAppend ? "deletions" : "admin-audit";
    const idempotencyHash = isDeletionAppend
      ? await deletionIdempotencyHash(this.env.ENVIRONMENT, event)
      : await eventIdempotencyHash(this.env.ENVIRONMENT, event);
    const requestKey = `request:${stream}:${expectedIdempotencyKey}:${
      event.phase ?? event.recordType
    }`;
    const previousRequestHash = await this.state.storage.get(requestKey);
    if (previousRequestHash && previousRequestHash !== idempotencyHash) {
      return json({ error: "idempotency_conflict" }, 409);
    }
    const existingReceipt = await this.state.storage.get(`receipt:${idempotencyHash}`);
    if (existingReceipt) return json(existingReceipt, 200);

    if (isAdminAppend && event.phase === "outcome") {
      const intent = await this.state.storage.get(`pending:${event.requestId}`);
      if (!intent || intent.recordHash !== event.intentRecordHash) {
        return json({ error: "intent_not_found" }, 409);
      }
    }

    const head = (await this.state.storage.get(`head:${stream}`)) ?? {
      recordHash: "0".repeat(64),
      sequence: 0,
    };
    const draftKey = `draft:${idempotencyHash}`;
    let draft = await this.state.storage.get(draftKey);
    if (draft) {
      if (
        draft.stream !== stream ||
        draft.sequence !== head.sequence + 1 ||
        draft.previousHash !== head.recordHash
      ) {
        return json({ error: "sequence_conflict" }, 409);
      }
    } else {
      const sequence = head.sequence + 1;
      const timestamp = new Date().toISOString();
      const encryptionKeyVersion = Number(this.env.ADMIN_AUDIT_KEK_VERSION);
      const metadata = {
        environment: this.env.ENVIRONMENT,
        previousHash: head.recordHash,
        schemaVersion: 1,
        sequence,
        stream,
        timestamp,
      };
      const encrypted = isAdminAppend
        ? await encryptAdminAuditPayload(
            event,
            metadata,
            versionedSecret(this.env, "ADMIN_AUDIT_KEK", encryptionKeyVersion),
          )
        : { payload: event };
      const recordWithoutHash = {
        ...metadata,
        ...encrypted,
        ...(isAdminAppend ? { encryptionKeyVersion } : {}),
        idempotencyHash,
      };
      const recordHash = await sha256Hex(canonicalJson(recordWithoutHash));
      const objectBody = canonicalJson({ ...recordWithoutHash, recordHash });
      draft = {
        objectBody,
        objectKey: `${stream}/${String(sequence).padStart(20, "0")}.json`,
        previousHash: head.recordHash,
        recordHash,
        sequence,
        stream,
        timestamp,
      };
      await this.state.storage.put(draftKey, draft);
    }
    const { objectBody, objectKey, recordHash, sequence, timestamp } = draft;
    const bucket = isDeletionAppend
      ? this.env.DELETIONS_BUCKET
      : this.env.ADMIN_AUDIT_BUCKET;
    const stored = await bucket.put(objectKey, objectBody, {
      customMetadata: {
        recordHash,
        sequence: String(sequence),
      },
      onlyIf: { etagDoesNotMatch: "*" },
      sha256: await sha256Hex(objectBody),
    });
    if (!stored) {
      const existing = await bucket.get(objectKey);
      if (!existing || (await existing.text()) !== objectBody) {
        return json({ error: "sequence_conflict" }, 409);
      }
    }
    const readback = await bucket.get(objectKey);
    if (!readback || (await readback.text()) !== objectBody) {
      return json({ error: "storage_verification_failed" }, 503);
    }

    const signingKeyVersion = Number(this.env.LEDGER_SIGNING_KEY_VERSION);
    const unsignedReceipt = {
      environment: this.env.ENVIRONMENT,
      idempotencyHash,
      keyVersion: signingKeyVersion,
      recordHash,
      sequence,
      stream,
      timestamp,
    };
    const receipt = {
      ...unsignedReceipt,
      signature: await signReceipt(
        unsignedReceipt,
        versionedSecret(
          this.env,
          "LEDGER_SIGNING_PRIVATE_KEY_PKCS8",
          signingKeyVersion,
        ),
      ),
    };

    const updates = {
      [`head:${stream}`]: { recordHash, sequence },
      [`receipt:${idempotencyHash}`]: receipt,
      [requestKey]: idempotencyHash,
    };
    if (isAdminAppend && event.phase === "intent") {
      updates[`pending:${event.requestId}`] = {
        createdAt: timestamp,
        objectKey,
        recordHash,
      };
    }
    await this.state.storage.put(updates);
    if (isAdminAppend && event.phase === "outcome") {
      await this.state.storage.delete(`pending:${event.requestId}`);
    } else if (isAdminAppend) {
      await this.state.storage.setAlarm(Date.now() + PENDING_ALERT_MS);
    }
    await this.state.storage.delete(draftKey);
    return json(receipt, 200);
  }

  async alarm() {
    const pending = await this.state.storage.list({ prefix: "pending:" });
    let nextAlarm;
    for (const [key, value] of pending) {
      const dueAt = Date.parse(value.createdAt) + PENDING_ALERT_MS;
      if (dueAt <= Date.now()) {
        await this.state.storage.put(`alert:${key.slice(8)}`, {
          detectedAt: new Date().toISOString(),
          reason: "intent_without_outcome",
        });
      } else {
        nextAlarm = nextAlarm === undefined ? dueAt : Math.min(nextAlarm, dueAt);
      }
    }
    if (nextAlarm !== undefined) await this.state.storage.setAlarm(nextAlarm);
  }
}

function durableStub(env) {
  if (typeof env.LEDGER.getByName === "function") {
    return env.LEDGER.getByName(env.ENVIRONMENT);
  }
  return env.LEDGER.get(env.LEDGER.idFromName(env.ENVIRONMENT));
}

export async function triggerAdminReconciliation(env, fetcher = fetch) {
  const url = new URL(env.CONTINUITY_RECONCILER_URL);
  if (url.protocol !== "https:" || url.search || url.hash) {
    fail("invalid_reconciler_url");
  }
  const body = JSON.stringify({ schemaVersion: 1 });
  const timestamp = new Date().toISOString();
  const nonce = crypto.randomUUID();
  const signature = await signServiceRequest({
    body,
    method: "POST",
    nonce,
    path: url.pathname,
    secret: env.CONTINUITY_RECONCILER_HMAC_KEY,
    timestamp,
  });
  const response = await fetcher(
    new Request(url, {
      body,
      headers: {
        "content-type": "application/json",
        "x-reconciler-nonce": nonce,
        "x-reconciler-signature": signature,
        "x-reconciler-timestamp": timestamp,
      },
      method: "POST",
    }),
  );
  if (!response.ok) fail("reconciler_unavailable");
}

export default {
  fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/health") {
      return json(
        {
          mutationsEnabled: env?.MUTATIONS_ENABLED === "true",
          status: "ready",
        },
        200,
      );
    }
    if (
      request.method === "POST" &&
      ["/v1/admin-audit/append", "/v1/deletions/append"].includes(url.pathname) &&
      !url.search
    ) {
      if (env?.MUTATIONS_ENABLED !== "true") {
        return json({ error: "ledger_mutations_not_enabled" }, 503);
      }
      return durableStub(env).fetch(request);
    }
    if (
      request.method === "GET" &&
      url.pathname === "/v1/admin-audit/pending" &&
      !url.search
    ) {
      if (env?.MUTATIONS_ENABLED !== "true") {
        return json({ error: "ledger_mutations_not_enabled" }, 503);
      }
      return durableStub(env).fetch(request);
    }
    return json({ error: "not_found" }, 404);
  },
  scheduled(_controller, env, context) {
    if (env.MUTATIONS_ENABLED === "true") {
      context.waitUntil(triggerAdminReconciliation(env));
    }
  },
};
