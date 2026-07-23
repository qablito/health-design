export interface AuditRangeRecord {
  objectKey: string;
  recordHash: string;
  sequence: number;
}

export interface AuditRangeManifest {
  fromSequence: number;
  hashBeforeRange: string;
  manifestDigest: string;
  records: AuditRangeRecord[];
  terminalRecordHash: string;
  toSequence: number;
}

export interface AuditRangeReceipt extends AuditRangeManifest {
  operationId: string;
}

export function prepareAuditRangeManifest(input: {
  hashBeforeRange: string;
  records: AuditRangeRecord[];
}): Promise<AuditRangeManifest>;
export function verifyAuditRangeGap(input: {
  complete: AuditRangeReceipt | null;
  intent: AuditRangeReceipt;
  manifest: AuditRangeManifest;
}): true;
export function executeAuditRangeDeletion(
  input: {
    confirmationId: string;
    environment: "development";
    manifest: AuditRangeManifest;
    operationId: string;
  },
  dependencies: {
    appendComplete(receipt: AuditRangeReceipt): Promise<void>;
    appendIntent(receipt: AuditRangeReceipt): Promise<void>;
    createJitCredential(scope: {
      bucket: "admin-audit";
      objectKeys: string[];
      permissions: ["delete"];
      ttlSeconds: 300;
    }): Promise<{ id: string }>;
    deleteObjects(credential: { id: string }, objectKeys: string[]): Promise<void>;
    revokeJitCredential(credential: { id: string }): Promise<void>;
    verifyAbsent(objectKeys: string[]): Promise<boolean>;
  },
): Promise<{
  deletedCount: number;
  operationId: string;
  status: "verified";
}>;
