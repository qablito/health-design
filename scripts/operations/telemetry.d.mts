export function buildOperationalEvent(input: {
  counter: number;
  durationMs: number;
  environment: "development" | "local" | "production";
  errorCode:
    | "audit_range_incomplete"
    | "auth_cleanup_failed"
    | "backup_failed"
    | "ledger_divergence"
    | "restore_blocked"
    | null;
  jobType: "audit_range" | "auth_cleanup" | "backup" | "deletion" | "restore";
  opaqueId: string;
  operation: string;
  requestId: string;
  state: string;
  [key: string]: unknown;
}): Readonly<{
  counter: number;
  duration_ms: number;
  environment: string;
  error_code: string | null;
  job_type: string;
  opaque_id: string;
  operation: string;
  request_id: string;
  state: string;
}>;

export function operationalAlerts(metrics: {
  backupReadyAgeHours: number;
  cleanupFailures: number;
  incompleteAuditRanges: number;
  ledgerDiverged: boolean;
  pendingIntentAgeSeconds: number;
  restoreBlocked: boolean;
  rotationPrunePending: boolean;
  rtoHours: number;
}): string[];
