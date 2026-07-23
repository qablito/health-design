import type { LedgerReceipt } from "@health-design/contracts";

export type AccessAuditAction =
  | "code_consume"
  | "invitation_redeem"
  | "profile_deletion_request"
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

export type AdminAuditAction =
  | "barcode_correction_approve"
  | "barcode_correction_correct"
  | "barcode_correction_reject"
  | "catalog_match_candidates_generate"
  | "catalog_publication_hide"
  | "catalog_revision_publish"
  | "anonymous_auth_cleanup"
  | "audit_range_delete_execute"
  | "audit_range_delete_prepare"
  | "backup_create"
  | "impersonation_end"
  | "impersonation_start"
  | "matching_rule_activate"
  | "matching_rule_review"
  | "profile_deletion_permanent"
  | "profile_deletion_resume"
  | "restore_create"
  | "restore_promote";
export type AdminAuditTargetType =
  | "audit_deletion_job"
  | "auth_user"
  | "backup_job"
  | "barcode_correction"
  | "commercial_product_revision"
  | "catalog_publication"
  | "catalog_revision"
  | "impersonation_session"
  | "product_matching_rule"
  | "profile"
  | "deletion_job"
  | "restore_job";

export type AdminIntentInput = {
  action: AdminAuditAction;
  effectiveProfileId: string | null;
  originalActorId: string;
  requestId: string;
  targetId: string;
  targetType: AdminAuditTargetType;
};

export type AdminOutcomeInput = AdminIntentInput & {
  errorCode?: "domain_constraint" | "mutation_failed" | "reconciliation_required";
  intentRecordHash: string;
  result: "failure" | "success";
};

type SignedReceiptFields = Omit<LedgerReceipt, "signature">;

function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const base64 = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function receiptSigningPayload(
  receipt: SignedReceiptFields,
): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(
    JSON.stringify({
      environment: receipt.environment,
      idempotencyHash: receipt.idempotencyHash,
      keyVersion: receipt.keyVersion,
      recordHash: receipt.recordHash,
      sequence: receipt.sequence,
      stream: receipt.stream,
      timestamp: receipt.timestamp,
    }),
  );
}

export async function adminIntentIdempotencyHash(
  environment: "development" | "local" | "production",
  input: AdminIntentInput,
): Promise<string> {
  const payload = new TextEncoder().encode(
    JSON.stringify({
      action: input.action,
      effectiveProfileId: input.effectiveProfileId,
      environment,
      originalActorId: input.originalActorId,
      phase: "intent",
      requestId: input.requestId,
      stream: "admin-audit",
      targetId: input.targetId,
      targetType: input.targetType,
    }),
  );
  return bytesToHex(new Uint8Array(await crypto.subtle.digest("SHA-256", payload)));
}

export async function adminOutcomeIdempotencyHash(
  environment: "development" | "local" | "production",
  input: AdminOutcomeInput,
): Promise<string> {
  const payload = new TextEncoder().encode(
    JSON.stringify({
      action: input.action,
      effectiveProfileId: input.effectiveProfileId,
      environment,
      originalActorId: input.originalActorId,
      phase: "outcome",
      requestId: input.requestId,
      stream: "admin-audit",
      targetId: input.targetId,
      targetType: input.targetType,
      errorCode: input.errorCode ?? null,
      intentRecordHash: input.intentRecordHash,
      result: input.result,
    }),
  );
  return bytesToHex(new Uint8Array(await crypto.subtle.digest("SHA-256", payload)));
}

export async function verifyLedgerReceipt(
  receipt: LedgerReceipt,
  publicKeyBase64Url: string,
): Promise<boolean> {
  try {
    const publicKey = await crypto.subtle.importKey(
      "raw",
      base64UrlToBytes(publicKeyBase64Url),
      { name: "Ed25519" },
      false,
      ["verify"],
    );
    return await crypto.subtle.verify(
      "Ed25519",
      publicKey,
      base64UrlToBytes(receipt.signature),
      receiptSigningPayload(receipt),
    );
  } catch {
    return false;
  }
}
