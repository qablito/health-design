import { randomUUID } from "node:crypto";

import { createClient } from "@supabase/supabase-js";
import { buildNutritionQuarantineBatch } from "@health-design/catalog/nutrition";

const DEVELOPMENT_URL = "https://nwoivdxdupklervtnovd.supabase.co";
const DEVELOPMENT_CAPTCHA_TOKEN = "XXXX.DUMMY.TOKEN.XXXX";
const encoder = new TextEncoder();

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`missing_${name.toLowerCase()}`);
  return value;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function artifact({ foodKey, protein, sourceKey, sourceVersion }) {
  const record = {
    aliases: [`fixture ${foodKey}`],
    basis: "per_100_g",
    canonicalFoodKey: foodKey,
    category: "test_foods",
    ediblePart: "whole_edible_product",
    foodState: "raw",
    method: "source_declared",
    name: "Fixture remoto T9",
    nutrients: {
      protein: {
        nutrientClass: "protein",
        state: "known",
        unit: "g",
        value: protein,
      },
    },
    targetKind: "generic_food",
  };
  const rawBytes = encoder.encode(JSON.stringify({ record, sourceKey, sourceVersion }));
  return {
    envelope: {
      archiveDepth: 0,
      columnCount: 16,
      maximumCellBytes: 256,
      rowCount: 1,
      uncompressedBytes: rawBytes.byteLength,
    },
    licenseStatus: "approved",
    rawBytes,
    records: [record],
    retrievedAt: new Date().toISOString(),
    sourceKey,
    sourceVersion,
    transformations: [`t9-remote-smoke:${sourceKey}:v1`],
  };
}

async function parseResponse(response) {
  const body = await response.json().catch(() => ({}));
  return { body, headers: response.headers, status: response.status };
}

async function main() {
  const url = required("SUPABASE_URL");
  assert(url === DEVELOPMENT_URL, "development_project_required");
  const publishableKey = required("SUPABASE_PUBLISHABLE_KEY");
  const serviceRoleKey = required("SUPABASE_SERVICE_ROLE_KEY");
  const email = required("SUPERADMIN_EMAIL");
  const password = required("SUPERADMIN_PASSWORD");
  const totpCode = required("SUPERADMIN_TOTP_CODE");
  assert(/^\d{6}$/.test(totpCode), "invalid_superadmin_totp_code");

  const auth = createClient(url, publishableKey, {
    auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
  });
  const inspector = createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
  });
  const signIn = await auth.auth.signInWithPassword({
    email,
    options: { captchaToken: DEVELOPMENT_CAPTCHA_TOKEN },
    password,
  });
  if (signIn.error || !signIn.data.session)
    throw new Error("superadmin_sign_in_failed");

  let token = signIn.data.session.access_token;
  const smokeId = randomUUID().replaceAll("-", "");
  const foodKey = `food:t9-remote-smoke-${smokeId}`;
  const requestIds = [];

  const invoke = async (path, { body, method = "POST", requestId } = {}) => {
    if (requestId) requestIds.push(requestId);
    return parseResponse(
      await fetch(`${url}/functions/v1/catalogs${path}`, {
        body: body === undefined ? undefined : JSON.stringify(body),
        headers: {
          apikey: publishableKey,
          authorization: `Bearer ${token}`,
          ...(body === undefined ? {} : { "content-type": "application/json" }),
          ...(requestId === undefined ? {} : { "idempotency-key": requestId }),
          origin: "https://task-02-environments.health-design.pages.dev",
        },
        method,
      }),
    );
  };

  try {
    const assuranceBefore = await auth.auth.mfa.getAuthenticatorAssuranceLevel();
    assert(
      assuranceBefore.data.currentLevel === "aal1" &&
        assuranceBefore.data.nextLevel === "aal2",
      "expected_aal1_before_smoke",
    );
    const aal1 = await invoke("/v1/admin/nutrition/reviews/open", { method: "GET" });
    assert(
      aal1.status === 403 && aal1.body?.error?.code === "AAL2_REQUIRED",
      "aal1_was_not_rejected",
    );

    const listedFactors = await auth.auth.mfa.listFactors();
    const factor = listedFactors.data?.totp.find(
      (candidate) => candidate.status === "verified",
    );
    if (listedFactors.error || !factor) throw new Error("verified_totp_factor_missing");
    const challenge = await auth.auth.mfa.challenge({ factorId: factor.id });
    if (challenge.error) throw new Error("totp_challenge_failed");
    const verification = await auth.auth.mfa.verify({
      challengeId: challenge.data.id,
      code: totpCode,
      factorId: factor.id,
    });
    if (verification.error || !verification.data?.access_token) {
      throw new Error(
        `totp_verification_failed:${verification.error?.code ?? "missing_access_token"}:${verification.error?.status ?? "unknown_status"}`,
      );
    }
    token = verification.data.access_token;

    const assuranceAfter = await auth.auth.mfa.getAuthenticatorAssuranceLevel();
    assert(assuranceAfter.data.currentLevel === "aal2", "expected_aal2_after_verify");
    const aal2 = await invoke("/v1/admin/nutrition/reviews/open", { method: "GET" });
    assert(
      aal2.status === 200 && Array.isArray(aal2.body.reviews),
      "aal2_was_not_accepted",
    );
    assert(
      aal2.headers.get("cache-control") === "no-store, private",
      "private_cache_header_missing",
    );

    const anchorBatch = await buildNutritionQuarantineBatch(
      artifact({
        foodKey,
        protein: "13",
        sourceKey: "ciqual_2025",
        sourceVersion: `t9-smoke-${smokeId}-ciqual`,
      }),
    );
    const candidateBatch = await buildNutritionQuarantineBatch(
      artifact({
        foodKey,
        protein: "20",
        sourceKey: "bls_4_0",
        sourceVersion: `t9-smoke-${smokeId}-bls`,
      }),
    );
    assert(
      anchorBatch.status === "quarantined" && candidateBatch.status === "quarantined",
      "fixture_batch_not_quarantined",
    );

    const anchorRequestId = randomUUID();
    const stagedAnchor = await invoke("/v1/admin/nutrition/imports", {
      body: anchorBatch,
      requestId: anchorRequestId,
    });
    assert(stagedAnchor.status === 201, "anchor_import_failed");
    const anchorReplay = await invoke("/v1/admin/nutrition/imports", {
      body: anchorBatch,
      requestId: anchorRequestId,
    });
    assert(
      anchorReplay.status === 201 &&
        anchorReplay.body.manifest_id === stagedAnchor.body.manifest_id,
      "anchor_import_replay_failed",
    );
    const anchorRevisionId = stagedAnchor.body.revisions?.[0]?.revision_id;
    assert(typeof anchorRevisionId === "string", "anchor_revision_id_missing");

    const validatedAnchor = await invoke(
      `/v1/admin/nutrition/revisions/${anchorRevisionId}/validate`,
      {
        body: { justification: "Fixture remoto T9 validado en desarrollo" },
        requestId: randomUUID(),
      },
    );
    assert(validatedAnchor.status === 200, "anchor_validation_failed");

    const resolutionContext = {
      basis: "per_100_g",
      ediblePart: "whole_edible_product",
      foodState: "raw",
      method: "source_declared",
    };
    const activatedAnchor = await invoke(
      `/v1/admin/nutrition/revisions/${anchorRevisionId}/activate`,
      {
        body: {
          precedenceReason: "CIQUAL es la fuente prioritaria compatible",
          resolutionContext,
        },
        requestId: randomUUID(),
      },
    );
    assert(activatedAnchor.status === 200, "anchor_activation_failed");

    const stagedCandidate = await invoke("/v1/admin/nutrition/imports", {
      body: candidateBatch,
      requestId: randomUUID(),
    });
    assert(stagedCandidate.status === 201, "candidate_import_failed");
    const candidateRevisionId = stagedCandidate.body.revisions?.[0]?.revision_id;
    assert(typeof candidateRevisionId === "string", "candidate_revision_id_missing");

    const validatedCandidate = await invoke(
      `/v1/admin/nutrition/revisions/${candidateRevisionId}/validate`,
      {
        body: {
          justification: "Schema válido; discrepancia material pendiente de revisión",
        },
        requestId: randomUUID(),
      },
    );
    assert(validatedCandidate.status === 200, "candidate_validation_failed");

    const reviewRequestId = randomUUID();
    const reviewBody = {
      anchorRevisionId,
      candidateRevisionId,
      comparison: {
        anchor: "13",
        basis: "per_100_g",
        candidate: "20",
        unit: "g",
      },
      nutrientKey: "protein",
      reason: "La diferencia de proteína supera el umbral contractual",
      reviewKind: "manual_review",
    };
    const opened = await invoke("/v1/admin/nutrition/reviews", {
      body: reviewBody,
      requestId: reviewRequestId,
    });
    assert(
      opened.status === 201 && opened.body.status === "open",
      "review_open_failed",
    );
    const reviewReplay = await invoke("/v1/admin/nutrition/reviews", {
      body: reviewBody,
      requestId: reviewRequestId,
    });
    assert(
      reviewReplay.status === 201 &&
        reviewReplay.body.review_id === opened.body.review_id,
      "review_replay_failed",
    );

    const blocked = await invoke(
      `/v1/admin/nutrition/revisions/${candidateRevisionId}/activate`,
      {
        body: {
          precedenceReason: "Intento bloqueado por revisión abierta",
          resolutionContext,
        },
        requestId: randomUUID(),
      },
    );
    assert(
      blocked.status === 409 && blocked.body?.error?.code === "REVIEW_OPEN",
      "open_review_did_not_block_activation",
    );

    const resolved = await invoke(
      `/v1/admin/nutrition/reviews/${opened.body.review_id}/resolve`,
      {
        body: {
          decision: "Aceptar fixture secundario",
          justification: "Revisión manual remota T9 completada en desarrollo",
          resolution: "approved",
        },
        requestId: randomUUID(),
      },
    );
    assert(resolved.status === 200, "review_resolution_failed");

    const activatedCandidate = await invoke(
      `/v1/admin/nutrition/revisions/${candidateRevisionId}/activate`,
      {
        body: {
          precedenceReason: "Discrepancia aceptada manualmente para el smoke remoto",
          resolutionContext,
        },
        requestId: randomUUID(),
      },
    );
    assert(activatedCandidate.status === 200, "candidate_activation_failed");

    const food = await inspector
      .from("canonical_foods")
      .select("id,active")
      .eq("food_key", foodKey)
      .single();
    if (food.error || !food.data) throw new Error("remote_food_inspection_failed");
    const history = await inspector
      .from("effective_food_revisions")
      .select("revision_id,superseded_at")
      .eq("canonical_food_id", food.data.id)
      .order("activated_at", { ascending: true });
    if (history.error || !history.data)
      throw new Error("remote_history_inspection_failed");
    assert(
      history.data.length === 2 &&
        history.data[0]?.superseded_at !== null &&
        history.data[1]?.superseded_at === null,
      "effective_revision_history_invalid",
    );

    process.stdout.write(
      `${JSON.stringify(
        {
          aal1Rejected: true,
          aal2Accepted: true,
          activeRevisionId: history.data[1].revision_id,
          anchorRevisionId,
          candidateRevisionId,
          effectiveHistoryCount: history.data.length,
          foodKey,
          idempotentImport: true,
          idempotentReview: true,
          openReviewBlockedActivation: true,
          requestIds: [...new Set(requestIds)],
          reviewId: opened.body.review_id,
          status: "T9_REMOTE_SMOKE_PASS",
        },
        null,
        2,
      )}\n`,
    );
  } finally {
    await auth.auth.signOut({ scope: "local" });
  }
}

await main();
