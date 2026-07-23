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
  const reference = timestamp(candidate.lastActiveAt ?? candidate.createdAt);
  const ageHours = (nowMs - reference) / 3_600_000;
  return candidate.anonymous ? ageHours > 24 : ageHours > 30 * 24;
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
    try {
      await dependencies.disableActor(candidate.authSubject);
      await dependencies.deleteAuthUser(candidate.authSubject);
      succeeded += 1;
    } catch {
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
