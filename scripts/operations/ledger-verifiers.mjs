import { createHash, timingSafeEqual } from "node:crypto";

import { verifyAuditRangeGap } from "./audit-range.mjs";

const HEX_64 = /^[a-f0-9]{64}$/;
const ZERO_HASH = "0".repeat(64);
const PROFILE_DELETION_KEYS = new Set([
  "markerKeyVersion",
  "operationId",
  "profileMarker",
  "recordType",
  "schemaVersion",
  "stream",
]);
const PROFILE_REKEY_KEYS = new Set([
  "markerKeyVersion",
  "operationId",
  "previousMarkerKeyVersion",
  "previousProfileMarker",
  "profileMarker",
  "recordType",
  "schemaVersion",
  "stream",
]);
const AUDIT_RANGE_KEYS = new Set([
  "auditDeletionJobId",
  "fromSequence",
  "hashBeforeRange",
  "operationId",
  "rangeHash",
  "recordType",
  "schemaVersion",
  "stream",
  "terminalRecordHash",
  "toSequence",
]);
const AUDIT_RANGE_COMPLETE_KEYS = new Set([...AUDIT_RANGE_KEYS, "intentRecordHash"]);

function assertAuditRangePayload(payload) {
  const allowed =
    payload.recordType === "audit_range_delete_complete"
      ? AUDIT_RANGE_COMPLETE_KEYS
      : AUDIT_RANGE_KEYS;
  if (
    Object.keys(payload).some((key) => !allowed.has(key)) ||
    payload.schemaVersion !== 1 ||
    payload.stream !== "deletions" ||
    typeof payload.operationId !== "string" ||
    typeof payload.auditDeletionJobId !== "string" ||
    !Number.isSafeInteger(payload.fromSequence) ||
    !Number.isSafeInteger(payload.toSequence) ||
    payload.fromSequence < 1 ||
    payload.toSequence < payload.fromSequence ||
    !HEX_64.test(payload.rangeHash) ||
    !HEX_64.test(payload.hashBeforeRange) ||
    !HEX_64.test(payload.terminalRecordHash) ||
    (payload.recordType === "audit_range_delete_complete" &&
      !HEX_64.test(payload.intentRecordHash))
  ) {
    throw new Error("invalid_deletion_tombstone");
  }
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalize(value[key])]),
    );
  }
  return value;
}

function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

function sha256Hex(value) {
  return createHash("sha256").update(value).digest("hex");
}

function equalHex(left, right) {
  return (
    typeof left === "string" &&
    typeof right === "string" &&
    left.length === right.length &&
    HEX_64.test(left) &&
    HEX_64.test(right) &&
    timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"))
  );
}

export function buildSyntheticLedger(
  records,
  stream,
  { initialHead = ZERO_HASH, initialSequence = 0 } = {},
) {
  let previousHash = initialHead;
  return records.map((payload, index) => {
    const recordWithoutHash = {
      idempotencyHash: sha256Hex(
        `idempotency:${stream}:${initialSequence + index + 1}`,
      ),
      payload,
      previousHash,
      schemaVersion: 1,
      sequence: initialSequence + index + 1,
      stream,
      timestamp: `2026-07-23T00:00:${String(index).padStart(2, "0")}.000Z`,
    };
    const recordHash = sha256Hex(canonicalJson(recordWithoutHash));
    previousHash = recordHash;
    return { ...recordWithoutHash, recordHash };
  });
}

export function verifyLedgerContinuity(
  records,
  { gaps = [], initialHead = ZERO_HASH, initialSequence = 0, stream },
) {
  if (!Array.isArray(records) || !Array.isArray(gaps)) {
    throw new Error("invalid_ledger_input");
  }
  const ordered = [...records].sort((left, right) => left.sequence - right.sequence);
  if (
    !Number.isSafeInteger(initialSequence) ||
    initialSequence < 0 ||
    !HEX_64.test(initialHead)
  ) {
    throw new Error("invalid_ledger_anchor");
  }
  let expectedSequence = initialSequence + 1;
  let previousHash = initialHead;
  const orderedGaps = [...gaps].sort(
    (left, right) =>
      left.manifest.fromSequence - right.manifest.fromSequence ||
      left.manifest.toSequence - right.manifest.toSequence,
  );
  if (orderedGaps.length > 0 && stream !== "admin-audit") {
    throw new Error("ledger_gap");
  }
  for (let index = 0; index < orderedGaps.length; index += 1) {
    verifyAuditRangeGap(orderedGaps[index]);
    if (
      index > 0 &&
      orderedGaps[index - 1].manifest.toSequence >=
        orderedGaps[index].manifest.fromSequence
    ) {
      throw new Error("audit_range_overlap");
    }
  }
  let gapIndex = 0;
  if (orderedGaps.some((gap) => gap.manifest.fromSequence < expectedSequence)) {
    throw new Error("audit_range_outside_anchor");
  }
  const consumeGap = () => {
    const gap = orderedGaps[gapIndex];
    if (!gap || gap.manifest.fromSequence !== expectedSequence) return false;
    if (gap.manifest.hashBeforeRange !== previousHash) {
      throw new Error("audit_range_anchor_mismatch");
    }
    expectedSequence = gap.manifest.toSequence + 1;
    previousHash = gap.manifest.terminalRecordHash;
    gapIndex += 1;
    return true;
  };
  for (const record of ordered) {
    while (expectedSequence < record.sequence) {
      if (!consumeGap()) throw new Error("ledger_gap");
    }
    if (
      record.sequence !== expectedSequence ||
      record.stream !== stream ||
      record.previousHash !== previousHash ||
      !HEX_64.test(record.recordHash)
    ) {
      throw new Error("ledger_divergence");
    }
    const value = { ...record };
    delete value.recordHash;
    delete value.receipt;
    if (record.encryptionKeyVersion !== undefined) {
      delete value.payload;
    }
    if (!equalHex(record.recordHash, sha256Hex(canonicalJson(value)))) {
      throw new Error("ledger_record_hash_mismatch");
    }
    previousHash = record.recordHash;
    expectedSequence += 1;
  }
  while (consumeGap()) {
    // Consume authorized ranges at the current tail.
  }
  if (gapIndex !== orderedGaps.length) {
    throw new Error("ledger_gap");
  }
  return { head: previousHash, sequence: expectedSequence - 1 };
}

export function verifyAuditRangeTombstones(records) {
  const pendingRanges = new Map();
  const completedAuditRanges = [];
  for (const record of records) {
    const payload = record?.payload;
    if (
      payload?.recordType !== "audit_range_delete_intent" &&
      payload?.recordType !== "audit_range_delete_complete"
    ) {
      continue;
    }
    assertAuditRangePayload(payload);
    if (payload.recordType === "audit_range_delete_intent") {
      if (pendingRanges.has(payload.auditDeletionJobId)) {
        throw new Error("audit_range_replay");
      }
      pendingRanges.set(payload.auditDeletionJobId, {
        fromSequence: payload.fromSequence,
        hashBeforeRange: payload.hashBeforeRange,
        intentRecordHash: record.recordHash,
        operationId: payload.operationId,
        rangeHash: payload.rangeHash,
        terminalRecordHash: payload.terminalRecordHash,
        toSequence: payload.toSequence,
      });
      continue;
    }
    const intent = pendingRanges.get(payload.auditDeletionJobId);
    if (
      !intent ||
      intent.fromSequence !== payload.fromSequence ||
      intent.toSequence !== payload.toSequence ||
      intent.operationId !== payload.operationId ||
      intent.rangeHash !== payload.rangeHash ||
      intent.hashBeforeRange !== payload.hashBeforeRange ||
      intent.terminalRecordHash !== payload.terminalRecordHash ||
      intent.intentRecordHash !== payload.intentRecordHash
    ) {
      throw new Error("audit_range_receipt_mismatch");
    }
    const receipt = {
      fromSequence: payload.fromSequence,
      hashBeforeRange: payload.hashBeforeRange,
      manifestDigest: payload.rangeHash,
      operationId: payload.operationId,
      terminalRecordHash: payload.terminalRecordHash,
      toSequence: payload.toSequence,
    };
    completedAuditRanges.push({
      complete: receipt,
      intent: { ...receipt },
      manifest: {
        fromSequence: receipt.fromSequence,
        hashBeforeRange: receipt.hashBeforeRange,
        manifestDigest: receipt.manifestDigest,
        terminalRecordHash: receipt.terminalRecordHash,
        toSequence: receipt.toSequence,
      },
    });
    pendingRanges.delete(payload.auditDeletionJobId);
  }
  return {
    completedAuditRanges: completedAuditRanges.sort(
      (left, right) =>
        left.manifest.fromSequence - right.manifest.fromSequence ||
        left.manifest.toSequence - right.manifest.toSequence,
    ),
    incompleteAuditRanges: [...pendingRanges.entries()]
      .map(([jobId, range]) => ({
        fromSequence: range.fromSequence,
        jobId,
        toSequence: range.toSequence,
      }))
      .sort(
        (left, right) =>
          left.fromSequence - right.fromSequence ||
          left.jobId.localeCompare(right.jobId, "en"),
      ),
  };
}

export function verifyDeletionTombstones(records, knownKeyVersions) {
  const operations = new Set();
  const markers = new Map();
  const auditRanges = verifyAuditRangeTombstones(records);
  for (const record of records) {
    const payload = record.payload;
    if (!payload || typeof payload !== "object") {
      throw new Error("invalid_deletion_tombstone");
    }
    if (payload.recordType === "profile_deletion") {
      if (
        Object.keys(payload).some((key) => !PROFILE_DELETION_KEYS.has(key)) ||
        payload.schemaVersion !== 1 ||
        payload.stream !== "deletions" ||
        !Number.isInteger(payload.markerKeyVersion) ||
        !knownKeyVersions.has(payload.markerKeyVersion) ||
        !/^[a-f0-9]{64}$/.test(payload.profileMarker) ||
        typeof payload.operationId !== "string"
      ) {
        throw new Error("invalid_deletion_tombstone");
      }
    } else if (payload.recordType === "profile_marker_rekey") {
      if (
        Object.keys(payload).some((key) => !PROFILE_REKEY_KEYS.has(key)) ||
        payload.schemaVersion !== 1 ||
        payload.stream !== "deletions" ||
        !Number.isInteger(payload.markerKeyVersion) ||
        !Number.isInteger(payload.previousMarkerKeyVersion) ||
        payload.markerKeyVersion <= payload.previousMarkerKeyVersion ||
        !knownKeyVersions.has(payload.markerKeyVersion) ||
        !knownKeyVersions.has(payload.previousMarkerKeyVersion) ||
        !/^[a-f0-9]{64}$/.test(payload.profileMarker) ||
        !/^[a-f0-9]{64}$/.test(payload.previousProfileMarker) ||
        typeof payload.operationId !== "string"
      ) {
        throw new Error("invalid_deletion_tombstone");
      }
    } else if (
      payload.recordType !== "audit_range_delete_intent" &&
      payload.recordType !== "audit_range_delete_complete"
    ) {
      throw new Error("invalid_deletion_tombstone");
    }
    if (!payload || typeof payload.operationId !== "string") {
      throw new Error("invalid_deletion_tombstone");
    }
    const operationKey = `${payload.recordType}:${payload.operationId}`;
    if (operations.has(operationKey)) throw new Error("tombstone_replay");
    operations.add(operationKey);
    if (payload.recordType === "profile_deletion") {
      markers.set(payload.profileMarker, payload.markerKeyVersion);
    } else if (payload.recordType === "profile_marker_rekey") {
      if (
        markers.get(payload.previousProfileMarker) !== payload.previousMarkerKeyVersion
      ) {
        throw new Error("invalid_profile_marker_rekey");
      }
      markers.delete(payload.previousProfileMarker);
      markers.set(payload.profileMarker, payload.markerKeyVersion);
    }
  }
  const continuity = verifyLedgerContinuity(records, { stream: "deletions" });
  return {
    ...continuity,
    activeProfileMarkerKeyVersions: [...new Set(markers.values())].sort(
      (left, right) => left - right,
    ),
    activeProfileMarkers: [...markers.keys()].sort(),
    ...auditRanges,
  };
}

export function verifyAdminAuditClosure(records) {
  const pending = new Map();
  const closed = new Set();
  const identity = (payload) => ({
    action: payload.action,
    effectiveProfileId: payload.effectiveProfileId,
    originalActorId: payload.originalActorId,
    requestId: payload.requestId,
    schemaVersion: payload.schemaVersion,
    stream: payload.stream,
    targetId: payload.targetId,
    targetType: payload.targetType,
  });
  for (const record of records) {
    const payload = record?.payload;
    if (
      !payload ||
      payload.stream !== "admin-audit" ||
      typeof payload.requestId !== "string"
    ) {
      throw new Error("invalid_admin_audit_record");
    }
    if (payload.phase === "intent") {
      if (pending.has(payload.requestId) || closed.has(payload.requestId)) {
        throw new Error("admin_audit_replay");
      }
      pending.set(payload.requestId, {
        identity: canonicalJson(identity(payload)),
        recordHash: record.recordHash,
      });
    } else if (payload.phase === "outcome") {
      const intent = pending.get(payload.requestId);
      if (
        intent?.recordHash !== payload.intentRecordHash ||
        intent.identity !== canonicalJson(identity(payload)) ||
        closed.has(payload.requestId)
      ) {
        throw new Error("admin_audit_outcome_mismatch");
      }
      pending.delete(payload.requestId);
      closed.add(payload.requestId);
    } else {
      throw new Error("invalid_admin_audit_record");
    }
  }
  return { pendingRequestIds: [...pending.keys()].sort() };
}
