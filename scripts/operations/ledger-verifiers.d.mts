import type {
  AuditRangeGapManifest,
  AuditRangeGapReceipt,
  AuditRangeManifest,
  AuditRangeReceipt,
} from "./audit-range.mjs";

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
  options?: {
    initialHead?: string;
    initialSequence?: number;
  },
): LedgerRecord[];
export function verifyLedgerContinuity(
  records: LedgerRecord[],
  options: {
    gaps?: Array<{
      complete: AuditRangeReceipt | AuditRangeGapReceipt | null;
      intent: AuditRangeReceipt | AuditRangeGapReceipt;
      manifest: AuditRangeManifest | AuditRangeGapManifest;
    }>;
    initialHead?: string;
    initialSequence?: number;
    stream: string;
  },
): { head: string; sequence: number };
export function verifyDeletionTombstones(
  records: LedgerRecord[],
  knownKeyVersions: Set<number>,
): {
  activeProfileMarkerKeyVersions: number[];
  activeProfileMarkers: string[];
  completedAuditRanges: Array<{
    complete: AuditRangeGapReceipt;
    intent: AuditRangeGapReceipt;
    manifest: AuditRangeGapManifest;
  }>;
  head: string;
  incompleteAuditRanges: Array<{
    fromSequence: number;
    jobId: string;
    toSequence: number;
  }>;
  sequence: number;
};
export function verifyAuditRangeTombstones(records: LedgerRecord[]): {
  completedAuditRanges: Array<{
    complete: AuditRangeGapReceipt;
    intent: AuditRangeGapReceipt;
    manifest: AuditRangeGapManifest;
  }>;
  incompleteAuditRanges: Array<{
    fromSequence: number;
    jobId: string;
    toSequence: number;
  }>;
};
export function verifyAdminAuditClosure(records: LedgerRecord[]): {
  pendingRequestIds: string[];
};
