import { createHash, timingSafeEqual } from "node:crypto";

import { verifyAuditRangeGap } from "./audit-range.mjs";

const HEX_64 = /^[a-f0-9]{64}$/;
const ZERO_HASH = "0".repeat(64);
const TOMBSTONE_KEYS = new Set([
  "markerKeyVersion",
  "operationId",
  "profileMarker",
  "recordType",
  "schemaVersion",
  "stream",
]);

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

export function buildSyntheticLedger(records, stream) {
  let previousHash = ZERO_HASH;
  return records.map((payload, index) => {
    const recordWithoutHash = {
      idempotencyHash: sha256Hex(`idempotency:${stream}:${index + 1}`),
      payload,
      previousHash,
      schemaVersion: 1,
      sequence: index + 1,
      stream,
      timestamp: `2026-07-23T00:00:${String(index).padStart(2, "0")}.000Z`,
    };
    const recordHash = sha256Hex(canonicalJson(recordWithoutHash));
    previousHash = recordHash;
    return { ...recordWithoutHash, recordHash };
  });
}

export function verifyLedgerContinuity(records, { gaps = [], stream }) {
  if (!Array.isArray(records) || !Array.isArray(gaps)) {
    throw new Error("invalid_ledger_input");
  }
  const ordered = [...records].sort((left, right) => left.sequence - right.sequence);
  let expectedSequence = 1;
  let previousHash = ZERO_HASH;
  for (const record of ordered) {
    while (expectedSequence < record.sequence) {
      const gap = gaps.find(
        (candidate) =>
          candidate.manifest.fromSequence <= expectedSequence &&
          candidate.manifest.toSequence >= expectedSequence,
      );
      if (!gap || stream !== "admin-audit") throw new Error("ledger_gap");
      verifyAuditRangeGap(gap);
      expectedSequence = gap.manifest.toSequence + 1;
      previousHash = gap.manifest.terminalRecordHash;
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
    if (!equalHex(record.recordHash, sha256Hex(canonicalJson(value)))) {
      throw new Error("ledger_record_hash_mismatch");
    }
    previousHash = record.recordHash;
    expectedSequence += 1;
  }
  return { head: previousHash, sequence: expectedSequence - 1 };
}

export function verifyDeletionTombstones(records, knownKeyVersions) {
  const operations = new Set();
  for (const record of records) {
    const payload = record.payload;
    if (
      !payload ||
      typeof payload !== "object" ||
      Object.keys(payload).some((key) => !TOMBSTONE_KEYS.has(key)) ||
      payload.recordType !== "profile_deletion" ||
      payload.schemaVersion !== 1 ||
      payload.stream !== "deletions" ||
      !Number.isInteger(payload.markerKeyVersion) ||
      !knownKeyVersions.has(payload.markerKeyVersion) ||
      !/^[a-f0-9]{64}$/.test(payload.profileMarker) ||
      typeof payload.operationId !== "string"
    ) {
      throw new Error("invalid_deletion_tombstone");
    }
    if (operations.has(payload.operationId)) throw new Error("tombstone_replay");
    operations.add(payload.operationId);
  }
  return verifyLedgerContinuity(records, { stream: "deletions" });
}
