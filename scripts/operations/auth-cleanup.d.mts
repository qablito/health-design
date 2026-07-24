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
    requestIdForCandidate(candidate: AuthCleanupCandidate): string;
  },
  dependencies: {
    appendIntent(candidate: AuthCleanupCandidate, requestId: string): Promise<unknown>;
    appendOutcome(
      candidate: AuthCleanupCandidate,
      requestId: string,
      intentReceipt: unknown,
      result: "failure" | "success",
    ): Promise<unknown>;
    deleteAuthUser(authSubject: string): Promise<void>;
    disableActor(authSubject: string): Promise<void>;
    finalizeOutcome(
      requestId: string,
      receipt: unknown,
      result: "failure" | "success",
    ): Promise<void>;
    markOutcome(requestId: string, result: "failure" | "success"): Promise<void>;
    recordIntent(
      candidate: AuthCleanupCandidate,
      requestId: string,
      receipt: unknown,
    ): Promise<void>;
  },
): Promise<AuthCleanupResult>;
export const DEVELOPMENT_PROJECT_REF: "nwoivdxdupklervtnovd";
export const DEVELOPMENT_SUPABASE_URL: "https://nwoivdxdupklervtnovd.supabase.co";
export function assertDevelopmentCleanupTarget(input: {
  environment: string;
  projectRef: string;
  supabaseUrl: string;
}): void;
