export const DEVELOPMENT_PROJECT_REF = "nwoivdxdupklervtnovd";
export const DEVELOPMENT_SUPABASE_URL = `https://${DEVELOPMENT_PROJECT_REF}.supabase.co`;

export function assertDevelopmentCleanupTarget({
  environment,
  projectRef,
  supabaseUrl,
}) {
  if (
    environment !== "development" ||
    projectRef !== DEVELOPMENT_PROJECT_REF ||
    supabaseUrl !== DEVELOPMENT_SUPABASE_URL
  ) {
    throw new Error("cleanup_project_boundary_failed");
  }
}

function timestamp(value) {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error("invalid_auth_candidate_time");
  return parsed;
}

function eligible(candidate, nowMs) {
  if (
    !candidate ||
    typeof candidate !== "object" ||
    candidate.authPresent !== true ||
    candidate.actorRole !== "device" ||
    candidate.hasActiveInvitation ||
    candidate.hasActiveMembership ||
    candidate.hasPendingOperation ||
    typeof candidate.authSubject !== "string"
  ) {
    return false;
  }
  if (candidate.anonymous !== true) return false;
  const reference = timestamp(candidate.lastActiveAt ?? candidate.createdAt);
  const ageHours = (nowMs - reference) / 3_600_000;
  return ageHours > 24;
}

export function selectAuthCleanupCandidates(candidates, { limit, now }) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new Error("invalid_cleanup_limit");
  }
  const nowMs = timestamp(now);
  return candidates
    .filter((candidate) => eligible(candidate, nowMs))
    .sort((left, right) => left.authSubject.localeCompare(right.authSubject, "en"))
    .slice(0, limit);
}

export async function cleanupEligibleAuth(input, dependencies) {
  const selected = selectAuthCleanupCandidates(input.candidates, input);
  if (input.dryRun) {
    return {
      attempted: 0,
      eligible: selected.length,
      failed: 0,
      mode: "dry-run",
      succeeded: 0,
    };
  }
  let failed = 0;
  let succeeded = 0;
  for (const candidate of selected) {
    const requestId = input.requestIdForCandidate(candidate);
    let intentReceipt;
    let desiredResult = null;
    try {
      intentReceipt = await dependencies.appendIntent(candidate, requestId);
      await dependencies.recordIntent(candidate, requestId, intentReceipt);
      await dependencies.disableActor(candidate.authSubject);
      await dependencies.deleteAuthUser(candidate.authSubject);
      await dependencies.markOutcome(requestId, "success");
      desiredResult = "success";
      const outcomeReceipt = await dependencies.appendOutcome(
        candidate,
        requestId,
        intentReceipt,
        "success",
      );
      await dependencies.finalizeOutcome(requestId, outcomeReceipt, "success");
      succeeded += 1;
    } catch {
      if (intentReceipt && desiredResult === null) {
        try {
          await dependencies.markOutcome(requestId, "failure");
          desiredResult = "failure";
          const outcomeReceipt = await dependencies.appendOutcome(
            candidate,
            requestId,
            intentReceipt,
            "failure",
          );
          await dependencies.finalizeOutcome(requestId, outcomeReceipt, "failure");
        } catch {
          // El intent duradero queda pendiente para reconciliación.
        }
      }
      failed += 1;
    }
  }
  return {
    attempted: selected.length,
    eligible: selected.length,
    failed,
    mode: "apply",
    succeeded,
  };
}
