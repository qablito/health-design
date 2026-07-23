const ALLOWED_ERROR_CODES = new Set([
  "audit_range_incomplete",
  "auth_cleanup_failed",
  "backup_failed",
  "ledger_divergence",
  "restore_blocked",
]);
const ALLOWED_ENVIRONMENTS = new Set(["local", "development", "production"]);
const ALLOWED_JOB_TYPES = new Set([
  "audit_range",
  "auth_cleanup",
  "backup",
  "deletion",
  "restore",
]);
const CLOSED_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function buildOperationalEvent(input) {
  if (
    !UUID.test(input.requestId) ||
    !ALLOWED_ENVIRONMENTS.has(input.environment) ||
    !ALLOWED_JOB_TYPES.has(input.jobType) ||
    !CLOSED_IDENTIFIER.test(input.operation) ||
    !CLOSED_IDENTIFIER.test(input.state) ||
    !CLOSED_IDENTIFIER.test(input.opaqueId) ||
    !Number.isSafeInteger(input.counter) ||
    input.counter < 0 ||
    !Number.isSafeInteger(input.durationMs) ||
    input.durationMs < 0 ||
    (input.errorCode !== null && !ALLOWED_ERROR_CODES.has(input.errorCode))
  ) {
    throw new Error("invalid_operational_event");
  }
  return Object.freeze({
    counter: input.counter,
    duration_ms: input.durationMs,
    environment: input.environment,
    error_code: input.errorCode,
    job_type: input.jobType,
    opaque_id: input.opaqueId,
    operation: input.operation,
    request_id: input.requestId,
    state: input.state,
  });
}

export function operationalAlerts(metrics) {
  const alerts = [];
  if (metrics.pendingIntentAgeSeconds > 300) {
    alerts.push("pending_intent_over_5m");
  }
  if (metrics.ledgerDiverged) alerts.push("ledger_divergence");
  if (metrics.backupReadyAgeHours > 7 * 24) alerts.push("backup_rpo_over_7d");
  if (metrics.restoreBlocked) alerts.push("restore_blocked");
  if (metrics.incompleteAuditRanges > 0) alerts.push("audit_range_incomplete");
  if (metrics.cleanupFailures > 0) alerts.push("auth_cleanup_failed");
  if (metrics.rotationPrunePending) alerts.push("rotation_prune_pending");
  if (metrics.rtoHours >= 24) alerts.push("restore_rto_over_24h");
  return alerts;
}
