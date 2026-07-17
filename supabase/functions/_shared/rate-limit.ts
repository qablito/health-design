export type AccessAttemptDecision =
  | { decision: "allow" }
  | { decision: "challenge" }
  | { decision: "rate-limited"; retryAfterSeconds: number };

export function classifyAccessAttempt(input: {
  candidateFailures: number;
  globalIpAttempts: number;
}): AccessAttemptDecision {
  if (input.globalIpAttempts >= 30) {
    return { decision: "rate-limited", retryAfterSeconds: 3_600 };
  }
  if (input.candidateFailures >= 5) {
    return { decision: "rate-limited", retryAfterSeconds: 900 };
  }
  if (input.candidateFailures >= 3) return { decision: "challenge" };
  return { decision: "allow" };
}
