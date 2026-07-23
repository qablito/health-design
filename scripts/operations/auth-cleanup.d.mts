export interface AuthCleanupCandidate {
  actorDisabled: boolean;
  actorRole: "device" | "superadmin";
  anonymous: boolean;
  authPresent: boolean;
  authSubject: string;
  createdAt: string;
  hasActiveInvitation: boolean;
  hasActiveMembership: boolean;
  hasPendingOperation: boolean;
  lastActiveAt: string | null;
}

export interface AuthCleanupResult {
  attempted: number;
  eligible: number;
  failed: number;
  mode: "apply" | "dry-run";
  succeeded: number;
}

export function selectAuthCleanupCandidates(
  candidates: AuthCleanupCandidate[],
  options: { limit: number; now: string },
): AuthCleanupCandidate[];
export function cleanupEligibleAuth(
  input: {
    candidates: AuthCleanupCandidate[];
    dryRun: boolean;
    limit: number;
    now: string;
  },
  dependencies: {
    deleteAuthUser(authSubject: string): Promise<void>;
    disableActor(authSubject: string): Promise<void>;
  },
): Promise<AuthCleanupResult>;
