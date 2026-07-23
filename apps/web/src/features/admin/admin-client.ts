import {
  AdminBarcodeCorrectionDetailSchema,
  AdminBarcodeCorrectionListSchema,
  AdminBarcodeCorrectionMutationAckSchema,
  AdminBackupCreateRequestSchema,
  AdminBackupJobListSchema,
  AdminBackupJobSchema,
  AdminCatalogMatchCandidatesAckSchema,
  AdminCatalogPublicationMutationAckSchema,
  AdminCatalogRevisionListSchema,
  AdminImpersonationContextSchema,
  AdminDeletionJobSchema,
  AdminPermanentDeletionRequestSchema,
  AdminMatchingRuleMutationAckSchema,
  AdminProfileSummarySchema,
  AdminRestoreCreateRequestSchema,
  AdminRestoreJobListSchema,
  AdminRestoreJobSchema,
  AdminRestorePromoteRequestSchema,
  AdminSupermarketMatchingRuleListSchema,
  AdminSupermarketMatchingRuleReviewAckSchema,
  type AdminBarcodeCorrectionDetail,
  type AdminBarcodeCorrectionList,
  type AdminBarcodeCorrectionMutationAck,
  type AdminBackupJob,
  type AdminCatalogMatchCandidatesAck,
  type AdminCatalogPublicationMutationAck,
  type AdminCatalogRevisionList,
  type AdminImpersonationContext,
  type AdminDeletionJob,
  type AdminMatchingRuleMutationAck,
  type AdminProfileSummary,
  type AdminRestoreJob,
  type AdminSupermarketMatchingRuleList,
  type AdminSupermarketMatchingRuleReviewAck,
  type CommercialProductSnapshot,
} from "@health-design/contracts";

import { supabaseAuth } from "../../services/supabase";

type AdminErrorBody = {
  error?: {
    code?: string;
    message_key?: string;
    request_id?: string;
    retryable?: boolean;
  };
};

type Schema<T> = {
  safeParse(
    value: unknown,
  ): { data: T; success: true } | { error: unknown; success: false };
};

type AdminClientDependencies = {
  baseUrl: string;
  fetcher: typeof fetch;
  getAccessToken: () => Promise<string>;
  publishableKey: string;
};

export class AdminApiError extends Error {
  readonly code: string;
  readonly requestId?: string;
  readonly retryable: boolean;
  readonly status: number;

  constructor(status: number, body: AdminErrorBody) {
    const code = body.error?.code ?? "UNKNOWN_ERROR";
    super(body.error?.message_key ?? "admin.unknown_error");
    this.name = "AdminApiError";
    this.code = code;
    this.status = status;
    this.retryable = body.error?.retryable ?? false;
    if (body.error?.request_id) this.requestId = body.error.request_id;
  }
}

async function parseJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function validate<T>(schema: Schema<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new Error("invalid_admin_response");
  return parsed.data;
}

export function createAdminClient(dependencies: AdminClientDependencies) {
  async function request<T>(
    path: string,
    schema: Schema<T>,
    method: "DELETE" | "GET" | "POST",
    body?: unknown,
    allowQuery = false,
  ): Promise<T> {
    if (
      !path.startsWith("/v1/admin/") ||
      (!allowQuery && path.includes("?")) ||
      path.includes("#")
    ) {
      throw new Error("invalid_admin_path");
    }
    const accessToken = await dependencies.getAccessToken();
    const headers: Record<string, string> = {
      apikey: dependencies.publishableKey,
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
      "x-client-info": "health-design-web/admin-v1",
    };
    if (method !== "GET") headers["idempotency-key"] = crypto.randomUUID();
    const fetcher = dependencies.fetcher;
    const response = await fetcher(`${dependencies.baseUrl}${path}`, {
      ...(method !== "GET"
        ? { body: JSON.stringify(body ?? { schemaVersion: 1 }) }
        : {}),
      headers,
      method,
      referrerPolicy: "no-referrer",
    });
    const responseBody = await parseJson(response);
    if (!response.ok) throw new AdminApiError(response.status, responseBody ?? {});
    return validate(schema, responseBody);
  }

  return {
    createBackup(kind: "precritical" | "weekly") {
      return request<AdminBackupJob>(
        "/v1/admin/backups",
        AdminBackupJobSchema,
        "POST",
        AdminBackupCreateRequestSchema.parse({ kind, schemaVersion: 1 }),
      );
    },
    createRestore(backupId: string, targetFingerprint: string) {
      return request<AdminRestoreJob>(
        "/v1/admin/restores",
        AdminRestoreJobSchema,
        "POST",
        AdminRestoreCreateRequestSchema.parse({
          backupId,
          schemaVersion: 1,
          targetFingerprint,
        }),
      );
    },
    deletionJob(jobId: string) {
      return request<AdminDeletionJob>(
        `/v1/admin/deletion-jobs/${jobId}`,
        AdminDeletionJobSchema,
        "GET",
      );
    },
    permanentlyDeleteProfile(profileId: string, expectedVersion: number) {
      return request<AdminDeletionJob>(
        `/v1/admin/profiles/${profileId}/permanent`,
        AdminDeletionJobSchema,
        "DELETE",
        AdminPermanentDeletionRequestSchema.parse({
          confirmationPhrase: "PURGAR PERFIL PERMANENTEMENTE",
          confirmed: true,
          expectedVersion,
          schemaVersion: 1,
        }),
      );
    },
    activateMatchingRule(matchingRuleId: string, expectedVersion: number) {
      return request<AdminMatchingRuleMutationAck>(
        `/v1/admin/matching-rules/${matchingRuleId}/activate`,
        AdminMatchingRuleMutationAckSchema,
        "POST",
        { expectedVersion, schemaVersion: 1 },
      );
    },
    generateCatalogMatchCandidates(catalogRevisionId: string, expectedVersion: number) {
      return request<AdminCatalogMatchCandidatesAck>(
        `/v1/admin/catalog-revisions/${catalogRevisionId}/match-candidates`,
        AdminCatalogMatchCandidatesAckSchema,
        "POST",
        { expectedVersion, schemaVersion: 1 },
      );
    },
    listSupermarketMatchingRules(catalogRevisionId: string, cursor?: string) {
      const query = new URLSearchParams({ catalogRevisionId });
      if (cursor) query.set("cursor", cursor);
      return request<AdminSupermarketMatchingRuleList>(
        `/v1/admin/matching-rules?${query.toString()}`,
        AdminSupermarketMatchingRuleListSchema,
        "GET",
        undefined,
        true,
      );
    },
    reviewSupermarketMatchingRule(
      matchingRuleId: string,
      expectedVersion: number,
      matchState: "exact" | "allowed" | "excluded",
    ) {
      return request<AdminSupermarketMatchingRuleReviewAck>(
        `/v1/admin/matching-rules/${matchingRuleId}/review`,
        AdminSupermarketMatchingRuleReviewAckSchema,
        "POST",
        { expectedVersion, matchState, schemaVersion: 1 },
      );
    },
    hideCatalogPublication(catalogPublicationId: string, expectedVersion: number) {
      return request<AdminCatalogPublicationMutationAck>(
        `/v1/admin/catalog-publications/${catalogPublicationId}/hide`,
        AdminCatalogPublicationMutationAckSchema,
        "POST",
        { expectedVersion, schemaVersion: 1 },
      );
    },
    approveBarcodeCorrection(
      correctionId: string,
      input: {
        canonicalFoodKey: string;
        evidence: string[];
        expectedVersion: number;
        matchState: "allowed" | "exact" | "excluded" | "insufficient" | "review";
      },
    ) {
      return request<AdminBarcodeCorrectionMutationAck>(
        `/v1/admin/barcode-corrections/${correctionId}/approve`,
        AdminBarcodeCorrectionMutationAckSchema,
        "POST",
        { ...input, schemaVersion: 1 },
      );
    },
    barcodeCorrection(correctionId: string) {
      return request<AdminBarcodeCorrectionDetail>(
        `/v1/admin/barcode-corrections/${correctionId}`,
        AdminBarcodeCorrectionDetailSchema,
        "GET",
      );
    },
    correctBarcodeCorrection(
      correctionId: string,
      expectedVersion: number,
      snapshot: CommercialProductSnapshot,
    ) {
      return request<AdminBarcodeCorrectionMutationAck>(
        `/v1/admin/barcode-corrections/${correctionId}/correct`,
        AdminBarcodeCorrectionMutationAckSchema,
        "POST",
        { expectedVersion, schemaVersion: 1, snapshot },
      );
    },
    currentContext() {
      return request<AdminImpersonationContext>(
        "/v1/admin/context",
        AdminImpersonationContextSchema,
        "GET",
      );
    },
    endImpersonation(impersonationSessionId: string) {
      return request<AdminImpersonationContext>(
        `/v1/admin/impersonations/${impersonationSessionId}/end`,
        AdminImpersonationContextSchema,
        "POST",
      );
    },
    listProfiles() {
      return request<AdminProfileSummary[]>(
        "/v1/admin/profiles",
        AdminProfileSummarySchema.array(),
        "GET",
      );
    },
    listBackups() {
      return request<AdminBackupJob[]>(
        "/v1/admin/backups",
        AdminBackupJobListSchema,
        "GET",
      );
    },
    listBarcodeCorrections(
      status: "approved" | "pending" | "rejected" | "superseded" = "pending",
      cursor?: string,
    ) {
      const query = new URLSearchParams({ status });
      if (cursor) query.set("cursor", cursor);
      return request<AdminBarcodeCorrectionList>(
        `/v1/admin/barcode-corrections?${query.toString()}`,
        AdminBarcodeCorrectionListSchema,
        "GET",
        undefined,
        true,
      );
    },
    listCatalogRevisions(input?: {
      chain?: "mercadona" | "dia" | "aldi";
      cursor?: string;
      state?: "quarantine" | "review" | "publishable" | "published" | "hidden";
    }) {
      const query = new URLSearchParams();
      if (input?.chain) query.set("chain", input.chain);
      if (input?.state) query.set("state", input.state);
      if (input?.cursor) query.set("cursor", input.cursor);
      const suffix = query.size > 0 ? `?${query.toString()}` : "";
      return request<AdminCatalogRevisionList>(
        `/v1/admin/catalog-revisions${suffix}`,
        AdminCatalogRevisionListSchema,
        "GET",
        undefined,
        true,
      );
    },
    listRestores() {
      return request<AdminRestoreJob[]>(
        "/v1/admin/restores",
        AdminRestoreJobListSchema,
        "GET",
      );
    },
    promoteRestore(restoreId: string, expectedVersion: number) {
      return request<AdminRestoreJob>(
        `/v1/admin/restores/${restoreId}/promote`,
        AdminRestoreJobSchema,
        "POST",
        AdminRestorePromoteRequestSchema.parse({
          confirmationPhrase: "PROMOVER RESTAURACIÓN VERIFICADA",
          confirmed: true,
          expectedVersion,
          schemaVersion: 1,
        }),
      );
    },
    publishCatalogRevision(
      catalogRevisionId: string,
      input: {
        expectedCatalogHash: string;
        expectedCoverageHash: string;
        expectedSeedHash: string;
        expectedVersion: number;
        sourceUseDecision: "development_approved" | "development_restricted_approved";
      },
    ) {
      return request<AdminCatalogPublicationMutationAck>(
        `/v1/admin/catalog-revisions/${catalogRevisionId}/publish`,
        AdminCatalogPublicationMutationAckSchema,
        "POST",
        { ...input, schemaVersion: 1 },
      );
    },
    rejectBarcodeCorrection(
      correctionId: string,
      expectedVersion: number,
      reason: "duplicate" | "insufficient_evidence" | "invalid_data" | "safety_risk",
    ) {
      return request<AdminBarcodeCorrectionMutationAck>(
        `/v1/admin/barcode-corrections/${correctionId}/reject`,
        AdminBarcodeCorrectionMutationAckSchema,
        "POST",
        { expectedVersion, reason, schemaVersion: 1 },
      );
    },
    startImpersonation(profileId: string) {
      return request<AdminImpersonationContext>(
        `/v1/admin/profiles/${profileId}/impersonations`,
        AdminImpersonationContextSchema,
        "POST",
      );
    },
  };
}

async function currentAccessToken(): Promise<string> {
  const { data, error } = await supabaseAuth.getSession();
  const accessToken = data.session?.access_token;
  if (error || !accessToken) throw new AdminApiError(401, {});
  return accessToken;
}

export const adminClient = createAdminClient({
  baseUrl: `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/admin`,
  fetcher: fetch,
  getAccessToken: currentAccessToken,
  publishableKey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
});

export type {
  AdminBackupJob,
  AdminDeletionJob,
  AdminImpersonationContext,
  AdminProfileSummary,
  AdminRestoreJob,
};
