import { execFileSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";

import { createClient } from "@supabase/supabase-js";

const DEVELOPMENT_URL = "https://nwoivdxdupklervtnovd.supabase.co";
const DEVELOPMENT_ORIGIN = "https://task-02-environments.health-design.pages.dev";
const DEVELOPMENT_CAPTCHA_TOKEN = "XXXX.DUMMY.TOKEN.XXXX";
const PROVIDER_REVISION_ID = "a1400000-0000-4000-8000-000000000002";
const OUTPUT_HASH = "22".repeat(32);

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`missing_${name.toLowerCase()}`);
  return value;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function uuid(value, name) {
  assert(
    typeof value === "string" &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        value,
      ),
    `invalid_${name}`,
  );
  return value;
}

function decodeSessionId(token) {
  const payload = token.split(".")[1];
  if (!payload) throw new Error("invalid_access_token");
  const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  return uuid(decoded.session_id, "auth_session_id");
}

function runSql(sql) {
  const output = execFileSync(
    "pnpm",
    ["exec", "supabase", "db", "query", "--linked", sql],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
  return JSON.parse(output).rows;
}

async function parsed(response) {
  response = await response;
  return {
    body: await response.json().catch(() => ({})),
    headers: response.headers,
    status: response.status,
  };
}

async function main() {
  const url = required("SUPABASE_URL");
  assert(url === DEVELOPMENT_URL, "development_project_required");
  const publishableKey = required("SUPABASE_PUBLISHABLE_KEY");
  const secretKey = required("SUPABASE_SECRET_KEY");
  const superadminEmail = required("SUPERADMIN_EMAIL");
  const superadminPassword = required("SUPERADMIN_PASSWORD");
  const totpCode = required("SUPERADMIN_TOTP_CODE");
  assert(/^\d{6}$/.test(totpCode), "invalid_superadmin_totp_code");

  const admin = createClient(url, secretKey, {
    auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
  });
  const superadmin = createClient(url, publishableKey, {
    auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
  });
  const signedIn = await superadmin.auth.signInWithPassword({
    email: superadminEmail,
    options: { captchaToken: DEVELOPMENT_CAPTCHA_TOKEN },
    password: superadminPassword,
  });
  if (signedIn.error || !signedIn.data.session) {
    throw new Error("superadmin_sign_in_failed");
  }
  let superadminToken = signedIn.data.session.access_token;

  const invoke = (token, path, requestId) =>
    parsed(
      fetch(`${url}/functions/v1/plans${path}`, {
        body: JSON.stringify({ schemaVersion: 1 }),
        headers: {
          apikey: publishableKey,
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
          "idempotency-key": requestId,
          origin: DEVELOPMENT_ORIGIN,
          "x-client-info": "health-design-t14-remote-smoke/1",
        },
        method: "POST",
      }),
    );

  const aal1 = await invoke(
    superadminToken,
    `/v1/admin/ai-provider-revisions/${PROVIDER_REVISION_ID}/activate`,
    randomUUID(),
  );
  assert(
    aal1.status === 403 && aal1.body?.error?.code === "AAL2_REQUIRED",
    "aal1_was_not_rejected",
  );

  const factors = await superadmin.auth.mfa.listFactors();
  const factor = factors.data?.totp.find(
    (candidate) => candidate.status === "verified",
  );
  if (factors.error || !factor) throw new Error("verified_totp_factor_missing");
  const challenge = await superadmin.auth.mfa.challenge({ factorId: factor.id });
  if (challenge.error) throw new Error("totp_challenge_failed");
  const verified = await superadmin.auth.mfa.verify({
    challengeId: challenge.data.id,
    code: totpCode,
    factorId: factor.id,
  });
  if (verified.error || !verified.data?.access_token) {
    throw new Error("totp_verification_failed");
  }
  superadminToken = verified.data.access_token;
  const activationRequestId = randomUUID();
  const activated = await invoke(
    superadminToken,
    `/v1/admin/ai-provider-revisions/${PROVIDER_REVISION_ID}/activate`,
    activationRequestId,
  );
  assert(
    activated.status === 200 &&
      activated.body?.revisionId === PROVIDER_REVISION_ID &&
      activated.body?.status === "active",
    "provider_activation_failed",
  );

  const suffix = randomUUID().replaceAll("-", "");
  const email = `t14-evidence-${suffix}@health-design.test`;
  const password = `T14!${randomBytes(24).toString("base64url")}`;
  const created = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
    password,
  });
  if (created.error || !created.data.user)
    throw new Error("evidence_user_creation_failed");
  const evidenceAuth = createClient(url, publishableKey, {
    auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
  });
  const evidenceSignIn = await evidenceAuth.auth.signInWithPassword({
    email,
    options: { captchaToken: DEVELOPMENT_CAPTCHA_TOKEN },
    password,
  });
  if (evidenceSignIn.error || !evidenceSignIn.data.session) {
    throw new Error("evidence_user_sign_in_failed");
  }

  const ids = {
    actor: randomUUID(),
    context: randomUUID(),
    draft: randomUUID(),
    plan: randomUUID(),
    profile: randomUUID(),
    session: randomUUID(),
    version: randomUUID(),
  };
  const authSessionId = decodeSessionId(evidenceSignIn.data.session.access_token);
  const userId = uuid(created.data.user.id, "evidence_user_id");
  try {
    runSql(`
      begin;
    insert into public.actors (id, auth_subject, role)
    values ('${ids.actor}', '${userId}', 'device');
    insert into public.profiles (id, alias, country, timezone, adult_attested_at)
    values ('${ids.profile}', 'T14Smoke${suffix.slice(0, 12)}', 'ES',
      'Europe/Madrid', clock_timestamp());
    insert into public.profile_access (profile_id, actor_id, access_scope)
    values ('${ids.profile}', '${ids.actor}', 'owner');
    insert into public.device_sessions (
      id, actor_id, auth_session_id, label, created_at, last_seen_at,
      idle_expires_at, absolute_expires_at
    ) values (
      '${ids.session}', '${ids.actor}', '${authSessionId}', 'T14 remote evidence',
      clock_timestamp(), clock_timestamp(), clock_timestamp() + interval '1 day',
      clock_timestamp() + interval '2 days'
    );
    insert into public.questionnaire_drafts (
      id, profile_id, schema_version, version, status, completeness,
      answers, confirmed_block_ids, current_block_id
    ) values (
      '${ids.draft}', '${ids.profile}', 2, 1, 'submitted', 'complete', '{}',
      array['summary']::text[], 'summary'
    );
    insert into public.context_snapshots (
      id, profile_id, source_draft_id, source_draft_version, schema_version,
      effective_at, answers, completeness, normalization_version, input_hash,
      canonicalization_version
    ) values (
      '${ids.context}', '${ids.profile}', '${ids.draft}', 1, 1,
      clock_timestamp(), '{}', 'complete', 't14-smoke-v1',
      decode(repeat('11', 32), 'hex'), 'jcs-v1'
    );
    insert into public.plans (id, profile_id)
    values ('${ids.plan}', '${ids.profile}');
    insert into public.plan_versions (
      id, plan_id, ordinal, status, completeness, validation_status,
      validation, context_snapshot_id, engine_version, rule_set_revision_id,
      source_manifest_id, input_hash, output_hash, canonicalization_version
    ) values (
      '${ids.version}', '${ids.plan}', 1, 'draft', 'complete', 'valid',
      '{"completeness":"complete"}',
      '${ids.context}', 't14-smoke-v1', gen_random_uuid(), gen_random_uuid(),
      decode(repeat('11', 32), 'hex'), decode(repeat('22', 32), 'hex'), 'jcs-v1'
    );
    insert into public.module_results (
      plan_version_id, module, status, confidence, payload, uncertainties
    ) values ('${ids.version}', 'nutrition', 'valid', 'high', '{}', '[]');
      commit;
    `);
  } catch (error) {
    await admin.auth.admin.deleteUser(userId);
    throw error;
  }

  const evidenceToken = evidenceSignIn.data.session.access_token;
  const real = await invoke(
    evidenceToken,
    `/v1/plans/${ids.version}/explanation`,
    `t14-real-${randomUUID()}`,
  );
  assert(real.status === 200, "real_explanation_request_failed");
  assert(real.body?.source === "luna", "real_explanation_did_not_use_luna");
  assert(real.body?.planOutputHash === OUTPUT_HASH, "plan_output_hash_changed");

  const persisted = runSql(`
    select
      usage.id::text as usage_event_id,
      usage.actual_eur::text,
      usage.status,
      (select count(*)::int from private.ai_explanations explanation
        where explanation.usage_event_id = usage.id) as explanation_count,
      budget.cap_eur::text,
      budget.reserved_upper_bound_eur::text,
      provider.status as provider_status,
      (select count(*)::int from private.technical_audit_events audit
        where audit.request_id = '${activationRequestId}'
          and audit.action = 'ai_provider_revision_activate'
          and audit.phase = 'outcome'
          and audit.result = 'success') as activation_outcome_count
    from private.ai_usage_events usage
    join private.ai_budget_months budget on budget.month = usage.budget_month
    join private.ai_provider_revisions provider on provider.id = usage.provider_revision_id
    where usage.profile_id = '${ids.profile}' and usage.status = 'settled'
    order by usage.created_at desc limit 1;
  `)[0];
  assert(persisted?.status === "settled", "usage_was_not_settled");
  assert(Number(persisted.actual_eur) > 0, "actual_cost_was_not_persisted");
  assert(persisted.explanation_count === 1, "explanation_was_not_persisted");
  assert(persisted.cap_eur === "10.00", "monthly_cap_changed");
  assert(persisted.reserved_upper_bound_eur === "0.00000000", "reservation_remained");
  assert(persisted.provider_status === "active", "provider_revision_not_active");
  assert(persisted.activation_outcome_count === 1, "activation_outcome_missing");

  const syntheticRequestIds = Array.from({ length: 9 }, () => randomUUID());
  const syntheticValues = syntheticRequestIds
    .map(
      (requestId, index) =>
        `('${ids.actor}', '${ids.profile}', '${ids.version}', ` +
        `'a1400000-0000-4000-8000-000000000002', ` +
        `'a1400000-0000-4000-8000-000000000001', date_trunc('month', ` +
        `clock_timestamp())::date, timezone('Europe/Madrid', clock_timestamp())::date, ` +
        `decode(lpad(to_hex(${index + 101}), 64, '0'), 'hex'), '${requestId}', ` +
        `2048, 256, 0, 0, 0, 0, 'settled', clock_timestamp())`,
    )
    .join(",\n");
  runSql(`
    insert into private.ai_usage_events (
      actor_id, profile_id, plan_version_id, provider_revision_id,
      pricing_fx_revision_id, budget_month, profile_local_date,
      idempotency_key_digest, request_id, max_input_tokens, max_output_tokens,
      reserved_upper_bound_eur, input_tokens, output_tokens, actual_eur,
      status, settled_at
    ) values ${syntheticValues};
  `);

  const quota = await invoke(
    evidenceToken,
    `/v1/plans/${ids.version}/explanation`,
    `t14-quota-${randomUUID()}`,
  );
  assert(quota.status === 200, "quota_request_failed");
  assert(
    quota.body?.source === "deterministic_fallback",
    "daily_quota_did_not_return_fallback",
  );
  const quotaEvidence = runSql(`
    select count(*)::int as rejected_count
    from private.ai_usage_events
    where profile_id = '${ids.profile}' and status = 'rejected'
      and rejection_code = 'daily_profile_quota';
  `)[0];
  assert(quotaEvidence?.rejected_count === 1, "daily_quota_rejection_missing");

  runSql(`
    delete from private.ai_usage_events
    where profile_id = '${ids.profile}' and (
      status = 'rejected'
      or request_id in (${syntheticRequestIds.map((id) => `'${id}'`).join(",")})
    );
  `);
  const finalLedger = runSql(`
    select
      count(*)::int as usage_count,
      count(*) filter (where status = 'settled')::int as settled_count,
      (select count(*)::int from private.ai_explanations explanation
        join private.ai_usage_events usage on usage.id = explanation.usage_event_id
        where usage.profile_id = '${ids.profile}') as explanation_count
    from private.ai_usage_events where profile_id = '${ids.profile}';
  `)[0];
  assert(
    finalLedger?.usage_count === 1 &&
      finalLedger?.settled_count === 1 &&
      finalLedger?.explanation_count === 1,
    "synthetic_quota_rows_remained",
  );

  await evidenceAuth.auth.signOut({ scope: "local" });
  await superadmin.auth.signOut({ scope: "local" });
  process.stdout.write(
    `${JSON.stringify(
      {
        aal1Rejected: true,
        aal2Accepted: true,
        actualEur: persisted.actual_eur,
        budgetCapEur: persisted.cap_eur,
        explanationPersisted: true,
        fallbackSource: quota.body.source,
        fixtureProfileId: ids.profile,
        fixtureRetainedForFinancialAudit: true,
        lunaSource: real.body.source,
        planOutputHashPreserved: true,
        providerRevisionId: PROVIDER_REVISION_ID,
        quotaRejected: true,
        status: "T14_REMOTE_SMOKE_PASS",
        technicalAuditOutcomePersisted: true,
      },
      null,
      2,
    )}\n`,
  );
}

await main();
