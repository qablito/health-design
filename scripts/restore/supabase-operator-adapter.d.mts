export const SECURITY_POLICY_MANIFEST_DIGEST: string;

export function createSupabaseRestoreDependencies(
  bundle: {
    signingPublicKeys?: Record<string, string>;
    knownProjectRefs: string[];
    targetDatabaseUrl: string;
    targetFingerprint: string;
    targetRef: string;
    targetServiceRoleKey: string;
    targetSupabaseUrl: string;
    tombstoneHmacKeys: Record<string, string>;
  },
  options?: {
    fetcher?: typeof fetch;
    migrationsDirectory?: string;
    operatorJobs?: {
      registerRestoreValidationKey(
        keyVersion: number,
        publicKeyHex: string,
      ): Promise<void>;
    };
    psql?(databaseUrl: string, sql: string): Promise<string>;
  },
): {
  applyAuditRecords(records: unknown[]): Promise<void>;
  isStorageProfileMarkerValid(input: {
    profileId: string;
    profileMarker: string;
  }): boolean;
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
};

export function runOperatorProcess(
  command: string,
  args: string[],
  options: {
    environment: { PGDATABASE: string };
    input?: string;
  },
): Promise<string>;
