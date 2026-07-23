import type { OperatorKeyring, RemoteLedgerHeads } from "../backup/recovery-set.mjs";

export interface RestoreTargetInput {
  knownProjectRefs: string[];
  targetDirectory: string;
  targetEnvironment: "local-isolated";
  targetRef: string;
}

export interface RestoredDatabase {
  audit: Array<{ id: string; sequence: number }>;
  profiles: Array<{ alias: string; marker: string }>;
  security: { aal2Required: true; rlsEnabled: true };
  sessions: Array<{ id: string; revoked: boolean }>;
}

export function assertIsolatedRestoreTarget(input: RestoreTargetInput): Promise<string>;
export function restoreFixtureRecoverySet(
  input: RestoreTargetInput & {
    directory: string;
    keyring: OperatorKeyring;
    remoteLedgerHeads?: RemoteLedgerHeads;
  },
): Promise<{
  backupId: string;
  database: RestoredDatabase;
  restoredStoragePaths: string[];
  status: "ready_for_promotion";
  targetEnvironment: "local-isolated";
  targetRef: string;
  trafficEnabled: false;
}>;
