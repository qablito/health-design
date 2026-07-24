export interface RestoreTargetIdentity {
  knownProjectRefs: string[];
  targetDatabaseUrl: string;
  targetFingerprint?: string;
  targetRef: string;
  targetSupabaseUrl: string;
}

export function assertBackupSourceIdentity(input: {
  databaseUrl: string;
  productionProjectRef: string;
  projectRef: string;
  supabaseUrl: string;
}): string;

export function targetIdentityFingerprint(input: RestoreTargetIdentity): string;

export function assertRestoreTargetIdentity(
  input: RestoreTargetIdentity & { targetFingerprint: string },
): string;
