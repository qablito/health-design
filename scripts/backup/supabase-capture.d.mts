import type { LedgerHeadProvider, RecoverySourceObject } from "./recovery-set.mjs";

export interface CaptureSecrets {
  authorizedPrivateBuckets: string[];
  databaseUrl: string;
  productionProjectRef: string;
  projectRef: string;
  serviceRoleKey: string;
  supabaseUrl: string;
  tombstoneHmacKeys: Record<string, string>;
}

export function captureLiveBackupInputs(
  input: CaptureSecrets,
  dependencies: {
    fetcher?: typeof fetch;
    ledgerHeadProvider: LedgerHeadProvider;
    runPgDump?(input: {
      args: string[];
      environment: { PGDATABASE: string };
      outputPath: string;
    }): Promise<void>;
  },
): Promise<{
  objects: RecoverySourceObject[];
  storageInventory: Array<{
    bucket: string;
    enumerated: true;
    logicalPaths: string[];
  }>;
}>;
