import type { AuditRangeManifest, AuditRangeReceipt } from "./audit-range.mjs";

export interface LedgerRecord {
  idempotencyHash: string;
  payload: Record<string, unknown>;
  previousHash: string;
  recordHash: string;
  schemaVersion: 1;
  sequence: number;
  stream: string;
  timestamp: string;
}

export function buildSyntheticLedger(
  records: Array<Record<string, unknown>>,
  stream: string,
): LedgerRecord[];
export function verifyLedgerContinuity(
  records: LedgerRecord[],
  options: {
    gaps?: Array<{
      complete: AuditRangeReceipt | null;
      intent: AuditRangeReceipt;
      manifest: AuditRangeManifest;
    }>;
    stream: string;
  },
): { head: string; sequence: number };
export function verifyDeletionTombstones(
  records: LedgerRecord[],
  knownKeyVersions: Set<number>,
): { head: string; sequence: number };
