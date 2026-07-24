export function clearQuarantinedRetry(input: {
  restoreId: string;
  targetDirectory: string;
}): Promise<true>;

export function prepareQuarantinedRetry(input: {
  restoreId: string;
  targetDirectory: string;
}): Promise<true>;

export function quarantineFailedRestore(input: {
  dependencies?: { revokeSessions(): Promise<void> };
  job?: { status: string; version: number };
  jobs: {
    transitionRestore(
      restoreId: string,
      version: number,
      status: "blocked",
      extra: { p_error_code: "restore_verification_failed" },
    ): Promise<unknown>;
  };
  restoreId: string;
  targetDirectory: string;
}): Promise<{
  jobBlocked: boolean;
  sessionsRevoked: boolean;
  targetQuarantined: boolean;
}>;
