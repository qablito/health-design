import type { LedgerHeadProvider, OperatorKeyring } from "../backup/recovery-set.mjs";

export function restoreSupabaseRecoverySet(
  input: {
    backupJobId: string;
    databaseUrl: string;
    directory: string;
    keyring: OperatorKeyring;
    knownProjectRefs: string[];
    knownTombstoneKeyVersions: Set<number>;
    ledgerHeadProvider: LedgerHeadProvider;
    restoreJobId: string;
    targetDirectory: string;
    targetEnvironment: "local-isolated";
    targetFingerprint: string;
    targetRef: string;
    targetSupabaseUrl: string;
  },
  dependencies: {
    applyAuditRecords(records: unknown[]): Promise<void>;
    applyCurrentMigrations(): Promise<void>;
    applyTombstones(markers: string[]): Promise<void>;
    assertDatabaseEmpty(): Promise<void>;
    onDatabaseRestored?(): Promise<void>;
    onRecoveryVerified?(verified: unknown): Promise<void>;
    registerValidationKey(input: { keyVersion: number }): Promise<void>;
    revokeSessions(): Promise<void>;
    runPgRestore?(input: {
      args: string[];
      environment: { PGDATABASE: string };
      inputPath: string;
    }): Promise<void>;
    uploadStorageObject(input: {
      bucket: string;
      bytes: Uint8Array;
      path: string;
    }): Promise<void>;
    verifyAbsenceAndSecurity(input: {
      deletedMarkers: string[];
      expectedStorageObjects: number;
    }): Promise<{
      aal2Required: boolean;
      deletedProfilesAbsent: boolean;
      rlsVerified: boolean;
      securityPolicyDigest: string;
      sessionsRevoked: boolean;
      storageComplete: boolean;
    }>;
  },
): Promise<{
  promotion: {
    attestation: { keyVersion: number; signature: string };
    payload: {
      aal2Required: true;
      adminAuditHead: string;
      backupJobId: string;
      deletedProfilesAbsent: true;
      deletionsHead: string;
      incompleteRanges: 0;
      manifestDigest: string;
      pendingIntents: 0;
      restoreJobId: string;
      rlsVerified: true;
      schemaVersion: 1;
      securityPolicyDigest: string;
      sessionsRevoked: true;
      storageComplete: true;
      targetFingerprint: string;
      targetIsolated: true;
      trafficEnabled: false;
    };
  };
  status: "ready_for_promotion";
  trafficEnabled: false;
  validationDigest: string;
}>;
