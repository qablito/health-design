#!/usr/bin/env node
import { createHash, createHmac, randomUUID, webcrypto } from "node:crypto";
import { readFile } from "node:fs/promises";

import {
  assertDevelopmentCleanupTarget,
  cleanupEligibleAuth,
} from "./operations/auth-cleanup.mjs";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function argumentValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function readSecrets() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  if (chunks.length === 0) throw new Error("operator_secrets_stdin_required");
  let value;
  try {
    value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new Error("invalid_operator_secrets");
  }
  if (
    typeof value.supabaseUrl !== "string" ||
    !value.supabaseUrl.startsWith("https://") ||
    typeof value.serviceRoleKey !== "string" ||
    value.serviceRoleKey.length < 32 ||
    !UUID.test(value.authSubject) ||
    !UUID.test(value.authSessionId) ||
    typeof value.projectRef !== "string"
  ) {
    throw new Error("invalid_operator_secrets");
  }
  return value;
}

function deterministicRequestId(cleanupId, authSubject) {
  const bytes = createHash("sha256")
    .update(`${cleanupId}:${authSubject}`, "utf8")
    .digest()
    .subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join("-");
}

function bytea(hex) {
  return `\\x${hex}`;
}

async function ledgerAppend(secrets, event) {
  const body = JSON.stringify(event);
  const path = "/v1/admin-audit/append";
  const timestamp = new Date().toISOString();
  const nonce = randomUUID();
  const bodyHash = createHash("sha256").update(body).digest("hex");
  const signature = createHmac("sha256", secrets.continuityLedgerHmacKey)
    .update(`${timestamp}\n${nonce}\nPOST\n${path}\n${bodyHash}`)
    .digest("hex");
  const response = await fetch(`${secrets.continuityLedgerUrl}${path}`, {
    body,
    headers: {
      "content-type": "application/json",
      "idempotency-key": event.requestId,
      "x-ledger-nonce": nonce,
      "x-ledger-signature": signature,
      "x-ledger-timestamp": timestamp,
    },
    method: "POST",
    referrerPolicy: "no-referrer",
  });
  if (!response.ok) throw new Error("cleanup_ledger_append_failed");
  const receipt = await response.json();
  const unsigned = {
    environment: receipt.environment,
    idempotencyHash: receipt.idempotencyHash,
    keyVersion: receipt.keyVersion,
    recordHash: receipt.recordHash,
    sequence: receipt.sequence,
    stream: receipt.stream,
    timestamp: receipt.timestamp,
  };
  const publicKey = await webcrypto.subtle.importKey(
    "raw",
    Buffer.from(secrets.ledgerSigningPublicKey, "base64url"),
    "Ed25519",
    false,
    ["verify"],
  );
  const valid = await webcrypto.subtle.verify(
    "Ed25519",
    publicKey,
    Buffer.from(receipt.signature, "base64url"),
    new TextEncoder().encode(JSON.stringify(unsigned)),
  );
  if (
    !valid ||
    receipt.environment !== "development" ||
    receipt.stream !== "admin-audit"
  ) {
    throw new Error("cleanup_ledger_receipt_invalid");
  }
  return receipt;
}

function receiptRpcArgs(receipt) {
  return {
    p_external_idempotency_hash: bytea(receipt.idempotencyHash),
    p_external_key_version: receipt.keyVersion,
    p_external_receipt_signature: bytea(
      Buffer.from(receipt.signature, "base64url").toString("hex"),
    ),
    p_external_record_hash: bytea(receipt.recordHash),
    p_external_sequence: receipt.sequence,
    p_external_timestamp: receipt.timestamp,
  };
}

async function rpc(secrets, name, body) {
  const response = await fetch(`${secrets.supabaseUrl}/rest/v1/rpc/${name}`, {
    body: JSON.stringify(body),
    headers: {
      apikey: secrets.serviceRoleKey,
      authorization: `Bearer ${secrets.serviceRoleKey}`,
      "content-type": "application/json",
    },
    method: "POST",
    referrerPolicy: "no-referrer",
  });
  if (!response.ok) throw new Error("cleanup_database_adapter_failed");
  return response.json();
}

try {
  const apply = process.argv.includes("--apply");
  const remote = process.argv.includes("--secrets-stdin");
  const fixture =
    process.argv.includes("--fixture") || (!argumentValue("--descriptor") && !remote);
  const limit = Number(argumentValue("--limit") ?? 100);
  const cleanupId = argumentValue("--cleanup-id") ?? "fixture-cleanup";
  const environment = argumentValue("--environment") ?? "local";
  if (apply && environment !== "development") {
    throw new Error("cleanup_environment_forbidden");
  }
  if (apply && argumentValue("--confirm") !== cleanupId) {
    throw new Error("cleanup_confirmation_mismatch");
  }
  if (apply && fixture) throw new Error("fixture_apply_forbidden");
  const secrets = remote ? await readSecrets() : null;
  if (secrets) {
    const projectRef = argumentValue("--project-ref");
    if (projectRef !== secrets.projectRef) {
      throw new Error("cleanup_project_boundary_failed");
    }
    assertDevelopmentCleanupTarget({
      environment,
      projectRef,
      supabaseUrl: secrets.supabaseUrl,
    });
    if (
      apply &&
      (!UUID.test(cleanupId) ||
        typeof secrets.continuityLedgerUrl !== "string" ||
        !secrets.continuityLedgerUrl.startsWith("https://") ||
        typeof secrets.continuityLedgerHmacKey !== "string" ||
        secrets.continuityLedgerHmacKey.length < 32 ||
        typeof secrets.ledgerSigningPublicKey !== "string" ||
        secrets.ledgerSigningPublicKey.length < 40)
    ) {
      throw new Error("invalid_operator_secrets");
    }
  }
  const originalActorId = secrets
    ? await rpc(secrets, "internal_admin_authorize", {
        p_auth_session_id: secrets.authSessionId,
        p_auth_subject: secrets.authSubject,
      })
    : "31000000-0000-4000-8000-000000018501";
  const candidates = secrets
    ? await rpc(secrets, "internal_admin_list_auth_cleanup_candidates", {
        p_auth_session_id: secrets.authSessionId,
        p_auth_subject: secrets.authSubject,
        p_cursor: null,
        p_limit: limit,
      })
    : fixture
      ? [
          {
            actorDisabled: false,
            actorRole: "device",
            anonymous: true,
            authPresent: true,
            authSubject: "00000000-0000-4000-8000-000000018501",
            createdAt: "2026-07-20T00:00:00.000Z",
            hasActiveInvitation: false,
            hasActiveMembership: false,
            hasPendingOperation: false,
            lastActiveAt: null,
          },
        ]
      : JSON.parse(await readFile(argumentValue("--descriptor"), "utf8")).candidates;
  const result = await cleanupEligibleAuth(
    {
      candidates,
      dryRun: !apply,
      limit,
      now: argumentValue("--now") ?? new Date().toISOString(),
      requestIdForCandidate: (candidate) =>
        deterministicRequestId(cleanupId, candidate.authSubject),
    },
    {
      appendIntent: (candidate, requestId) =>
        ledgerAppend(secrets, {
          action: "anonymous_auth_cleanup",
          createdAt: new Date().toISOString(),
          effectiveProfileId: null,
          originalActorId,
          phase: "intent",
          requestId,
          result: "pending",
          schemaVersion: 1,
          stream: "admin-audit",
          targetId: candidate.authSubject,
          targetType: "auth_user",
        }),
      appendOutcome: (candidate, requestId, intentReceipt, result) =>
        ledgerAppend(secrets, {
          action: "anonymous_auth_cleanup",
          createdAt: new Date().toISOString(),
          effectiveProfileId: null,
          ...(result === "failure" ? { errorCode: "mutation_failed" } : {}),
          intentRecordHash: intentReceipt.recordHash,
          originalActorId,
          phase: "outcome",
          requestId,
          result,
          schemaVersion: 1,
          stream: "admin-audit",
          targetId: candidate.authSubject,
          targetType: "auth_user",
        }),
      deleteAuthUser: async (authSubject) => {
        if (!secrets) throw new Error("remote_auth_adapter_required");
        const response = await fetch(
          `${secrets.supabaseUrl}/auth/v1/admin/users/${authSubject}`,
          {
            headers: {
              apikey: secrets.serviceRoleKey,
              authorization: `Bearer ${secrets.serviceRoleKey}`,
            },
            method: "DELETE",
            referrerPolicy: "no-referrer",
          },
        );
        if (!response.ok && response.status !== 404) {
          throw new Error("auth_delete_failed");
        }
      },
      disableActor: async (authSubject) => {
        if (!secrets) throw new Error("remote_database_adapter_required");
        await rpc(secrets, "internal_admin_disable_auth_cleanup_actor", {
          p_auth_session_id: secrets.authSessionId,
          p_auth_subject: secrets.authSubject,
          p_candidate_auth_subject: authSubject,
        });
      },
      finalizeOutcome: async (requestId, receipt, result) => {
        if (!secrets) throw new Error("remote_audit_adapter_required");
        await rpc(secrets, "internal_admin_finalize_t18_audit_outbox", {
          p_error_code: result === "failure" ? "mutation_failed" : null,
          p_request_id: requestId,
          p_result: result,
          ...receiptRpcArgs(receipt),
        });
      },
      markOutcome: async (requestId, result) => {
        if (!secrets) throw new Error("remote_audit_adapter_required");
        await rpc(secrets, "internal_admin_mark_t18_audit_outcome", {
          p_error_code: result === "failure" ? "mutation_failed" : null,
          p_request_id: requestId,
          p_result: result,
        });
      },
      recordIntent: async (candidate, requestId, receipt) => {
        if (!secrets) throw new Error("remote_audit_adapter_required");
        await rpc(secrets, "internal_record_t18_admin_intent", {
          p_action: "anonymous_auth_cleanup",
          p_auth_session_id: secrets.authSessionId,
          p_auth_subject: secrets.authSubject,
          p_effective_profile_id: null,
          p_request_id: requestId,
          p_target_id: candidate.authSubject,
          p_target_type: "auth_user",
          ...receiptRpcArgs(receipt),
        });
      },
    },
  );
  process.stdout.write(`${JSON.stringify({ ...result, cleanupId })}\n`);
} catch (error) {
  process.stderr.write(
    `${JSON.stringify({
      error: error instanceof Error ? error.message : "auth_cleanup_failed",
      status: "AUTH_CLEANUP_FAILED",
    })}\n`,
  );
  process.exitCode = 1;
}
