import type { LedgerHeadProvider, OperatorKeyring } from "../backup/recovery-set.mjs";

export interface RestoreTargetInput {
  knownProjectRefs: string[];
  targetDirectory: string;
  targetEnvironment: "local-isolated";
  targetRef: string;
}

export interface RestoredDatabase {
  audit: Array<{ id: string; sequence: number }>;
  profiles: Array<{ alias: string; marker: string }>;
  security: { aal2Required: true; policyDigest: string; rlsEnabled: true };
  sessions: Array<{ id: string; revoked: boolean }>;
}

export function assertIsolatedRestoreTarget(input: RestoreTargetInput): Promise<string>;
export function restoreFixtureRecoverySet(
  input: RestoreTargetInput & {
    directory: string;
    keyring: OperatorKeyring;
    knownTombstoneKeyVersions: Set<number>;
    ledgerHeadProvider: LedgerHeadProvider;
    backupJobId: string;
    restoreJobId: string;
    targetFingerprint: string;
  },
): Promise<{
  attestation: { keyVersion: number; signature: string };
  backupId: string;
  database: RestoredDatabase;
  promotion: {
    attestation: { keyVersion: number; signature: string };
    payload: Record<string, unknown>;
  };
  restoredStoragePaths: string[];
  status: "ready_for_promotion";
  targetEnvironment: "local-isolated";
  targetRef: string;
  trafficEnabled: false;
}>;
export function verifyRestoreValidation(
  validation: unknown,
  keyring: OperatorKeyring,
): Promise<true>;
