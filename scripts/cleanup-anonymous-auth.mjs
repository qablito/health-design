#!/usr/bin/env node
import { readFile } from "node:fs/promises";

import { cleanupEligibleAuth } from "./operations/auth-cleanup.mjs";

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
    if (
      environment !== "development" ||
      projectRef !== secrets.projectRef ||
      (Array.isArray(secrets.productionProjectRefs) &&
        secrets.productionProjectRefs.includes(projectRef))
    ) {
      throw new Error("cleanup_project_boundary_failed");
    }
  }
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
    },
    {
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
