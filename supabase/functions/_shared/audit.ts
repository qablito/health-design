export type AccessAuditAction =
  | "code_consume"
  | "invitation_redeem"
  | "private_code_rotate"
  | "qr_consume"
  | "qr_create"
  | "session_revoke"
  | "session_touch";

export type AuditRpc = (
  name: string,
  args: Record<string, unknown>,
) => Promise<{ data: unknown; error: { code?: string; message?: string } | null }>;

export async function recordAccessAudit(
  rpc: AuditRpc,
  input: {
    action: AccessAuditAction;
    authSubject: string;
    requestId: string;
    result: "denied" | "success";
    targetId?: string;
    targetType: "profile" | "profile_access" | "session";
  },
): Promise<void> {
  const { error } = await rpc("internal_record_access_audit", {
    p_action: input.action,
    p_auth_subject: input.authSubject,
    p_request_id: input.requestId,
    p_result: input.result,
    p_target_id: input.targetId ?? null,
    p_target_type: input.targetType,
  });
  if (error) throw new Error("audit_unavailable");
}
