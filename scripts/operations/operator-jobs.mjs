function baseUrl(bundle) {
  const url = new URL(bundle.supabaseUrl);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error("invalid_supabase_url");
  }
  return url;
}

async function jsonResponse(response, code) {
  if (!response.ok) throw new Error(code);
  try {
    return await response.json();
  } catch {
    throw new Error(code);
  }
}

export function createOperatorJobs(bundle, fetcher = fetch) {
  const base = baseUrl(bundle);
  if (
    typeof bundle.serviceRoleKey !== "string" ||
    typeof bundle.userAccessToken !== "string" ||
    typeof bundle.authSubject !== "string" ||
    typeof bundle.authSessionId !== "string"
  ) {
    throw new Error("invalid_operator_job_credentials");
  }
  const rpc = async (name, body) => {
    const response = await fetcher(new URL(`/rest/v1/rpc/${name}`, base), {
      body: JSON.stringify(body),
      headers: {
        apikey: bundle.serviceRoleKey,
        authorization: `Bearer ${bundle.serviceRoleKey}`,
        "content-type": "application/json",
      },
      method: "POST",
      referrerPolicy: "no-referrer",
    });
    return jsonResponse(response, "operator_job_rpc_failed");
  };
  const edge = async (path, requestId, body) => {
    const response = await fetcher(new URL(`/functions/v1/admin${path}`, base), {
      body: JSON.stringify(body),
      headers: {
        apikey: bundle.serviceRoleKey,
        authorization: `Bearer ${bundle.userAccessToken}`,
        "content-type": "application/json",
        "idempotency-key": requestId,
      },
      method: "POST",
      referrerPolicy: "no-referrer",
    });
    return jsonResponse(response, "operator_job_edge_failed");
  };
  const auth = {
    p_auth_session_id: bundle.authSessionId,
    p_auth_subject: bundle.authSubject,
  };
  return {
    createBackup: (jobId, kind) =>
      edge("/v1/admin/backups", jobId, { kind, schemaVersion: 1 }),
    createRestore: (jobId, backupId, targetFingerprint) =>
      edge("/v1/admin/restores", jobId, {
        backupId,
        schemaVersion: 1,
        targetFingerprint,
      }),
    registerRestoreValidationKey: (keyVersion, publicKeyHex) =>
      rpc("internal_admin_register_restore_validation_key", {
        ...auth,
        p_key_version: keyVersion,
        p_public_key: `\\x${publicKeyHex}`,
      }),
    transitionBackup: (jobId, expectedVersion, nextStatus, extra = {}) =>
      rpc("internal_admin_transition_backup_job", {
        ...auth,
        p_error_code: null,
        p_expected_version: expectedVersion,
        p_job_id: jobId,
        p_key_version: null,
        p_manifest_digest: null,
        p_next_status: nextStatus,
        ...extra,
      }),
    transitionRestore: (jobId, expectedVersion, nextStatus, extra = {}) =>
      rpc("internal_admin_transition_restore_job", {
        ...auth,
        p_admin_audit_head: null,
        p_deleted_profiles_absent: null,
        p_deletions_head: null,
        p_error_code: null,
        p_expected_version: expectedVersion,
        p_incomplete_ranges: null,
        p_job_id: jobId,
        p_manifest_digest: null,
        p_next_status: nextStatus,
        p_pending_intents: null,
        p_rls_verified: null,
        p_sessions_revoked: null,
        p_storage_complete: null,
        p_target_fingerprint: null,
        p_validation_digest: null,
        p_validation_key_version: null,
        p_validation_payload: null,
        p_validation_signature: null,
        ...extra,
      }),
  };
}
