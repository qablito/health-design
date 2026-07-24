import { createHash, timingSafeEqual } from "node:crypto";

const HEX_64 = /^[a-f0-9]{64}$/;
const SAFE_OBJECT_KEY = /^admin-audit\/[0-9]{20}\.json$/;

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
  if (
    typeof left !== "string" ||
    typeof right !== "string" ||
    left.length !== right.length ||
    !HEX_64.test(left) ||
    !HEX_64.test(right)
  ) {
    return false;
  }
  return timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
}

function assertRecord(record) {
  if (
    !record ||
    typeof record !== "object" ||
    !Number.isSafeInteger(record.sequence) ||
    record.sequence < 1 ||
    !HEX_64.test(record.recordHash) ||
    !SAFE_OBJECT_KEY.test(record.objectKey) ||
    record.objectKey !== `admin-audit/${String(record.sequence).padStart(20, "0")}.json`
  ) {
    throw new Error("invalid_audit_range_record");
  }
}

export async function prepareAuditRangeManifest({ hashBeforeRange, records }) {
  if (
    !HEX_64.test(hashBeforeRange) ||
    !Array.isArray(records) ||
    records.length === 0
  ) {
    throw new Error("invalid_audit_range");
  }
  const ordered = [...records].sort(
    (left, right) =>
      left.sequence - right.sequence ||
      left.objectKey.localeCompare(right.objectKey, "en"),
  );
  ordered.forEach(assertRecord);
  for (let index = 1; index < ordered.length; index += 1) {
    if (ordered[index].sequence !== ordered[index - 1].sequence + 1) {
      throw new Error("audit_range_not_contiguous");
    }
  }
  const base = {
    fromSequence: ordered[0].sequence,
    hashBeforeRange,
    records: ordered.map((record) => ({
      objectKey: record.objectKey,
      recordHash: record.recordHash,
      sequence: record.sequence,
    })),
    terminalRecordHash: ordered.at(-1).recordHash,
    toSequence: ordered.at(-1).sequence,
  };
  return {
    ...base,
    manifestDigest: sha256Hex(canonicalJson(base)),
  };
}

function receiptMatchesManifest(receipt, manifest) {
  return (
    receipt &&
    typeof receipt === "object" &&
    receipt.fromSequence === manifest.fromSequence &&
    receipt.toSequence === manifest.toSequence &&
    equalHex(receipt.hashBeforeRange, manifest.hashBeforeRange) &&
    equalHex(receipt.terminalRecordHash, manifest.terminalRecordHash) &&
    equalHex(receipt.manifestDigest, manifest.manifestDigest)
  );
}

export function verifyAuditRangeGap({ complete, intent, manifest }) {
  if (!manifest || !Array.isArray(manifest.records) || manifest.records.length === 0) {
    throw new Error("invalid_audit_range");
  }
  const ordered = [...manifest.records].sort(
    (left, right) =>
      left.sequence - right.sequence ||
      left.objectKey.localeCompare(right.objectKey, "en"),
  );
  ordered.forEach(assertRecord);
  for (let index = 1; index < ordered.length; index += 1) {
    if (ordered[index].sequence !== ordered[index - 1].sequence + 1) {
      throw new Error("audit_range_not_contiguous");
    }
  }
  const base = {
    fromSequence: ordered[0].sequence,
    hashBeforeRange: manifest.hashBeforeRange,
    records: ordered,
    terminalRecordHash: ordered.at(-1).recordHash,
    toSequence: ordered.at(-1).sequence,
  };
  if (
    manifest.fromSequence !== base.fromSequence ||
    manifest.toSequence !== base.toSequence ||
    !equalHex(manifest.terminalRecordHash, base.terminalRecordHash) ||
    !equalHex(manifest.manifestDigest, sha256Hex(canonicalJson(base)))
  ) {
    throw new Error("invalid_audit_range");
  }
  if (!receiptMatchesManifest(intent, manifest)) {
    throw new Error("audit_range_receipt_mismatch");
  }
  if (!complete) throw new Error("audit_range_incomplete");
  if (
    !receiptMatchesManifest(complete, manifest) ||
    complete.operationId !== intent.operationId
  ) {
    throw new Error("audit_range_receipt_mismatch");
  }
  return true;
}

export async function executeAuditRangeDeletion(input, dependencies) {
  if (input.environment !== "development") {
    throw new Error("audit_range_environment_forbidden");
  }
  if (
    typeof input.operationId !== "string" ||
    input.confirmationId !== input.operationId
  ) {
    throw new Error("audit_range_confirmation_mismatch");
  }
  const verifiedManifest = await prepareAuditRangeManifest({
    hashBeforeRange: input.manifest.hashBeforeRange,
    records: input.manifest.records,
  });
  if (canonicalJson(verifiedManifest) !== canonicalJson(input.manifest)) {
    throw new Error("invalid_audit_range");
  }
  const objectKeys = input.manifest.records.map((record) => record.objectKey);
  await dependencies.appendIntent({
    ...input.manifest,
    operationId: input.operationId,
  });
  let credential;
  try {
    credential = await dependencies.createJitCredential({
      bucket: "admin-audit",
      objectKeys,
      permissions: ["delete"],
      ttlSeconds: 300,
    });
    await dependencies.deleteObjects(credential, objectKeys);
    if (!(await dependencies.verifyAbsent(objectKeys))) {
      throw new Error("audit_range_objects_remain");
    }
    await dependencies.appendComplete({
      ...input.manifest,
      operationId: input.operationId,
    });
    return {
      deletedCount: objectKeys.length,
      operationId: input.operationId,
      status: "verified",
    };
  } catch {
    throw new Error("audit_range_delete_partial");
  } finally {
    if (credential) await dependencies.revokeJitCredential(credential);
  }
}
