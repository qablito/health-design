import { randomUUID } from "node:crypto";

const DEVELOPMENT_URL = "https://nwoivdxdupklervtnovd.supabase.co";
const DEVELOPMENT_ORIGIN = "https://task-02-environments.health-design.pages.dev";
const CONFIRMATION = "health-design-dev:t16-commercial-products";
const MUTATION_CONFIRMATION = "I_ACCEPT_SYNTHETIC_T16_MUTATIONS";

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`missing_${name.toLowerCase()}`);
  return value;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function uuid(value, name) {
  assert(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    ),
    `invalid_${name}`,
  );
  return value;
}

function integer(name, minimum, maximum) {
  const value = Number(required(name));
  assert(
    Number.isInteger(value) && value >= minimum && value <= maximum,
    `invalid_${name.toLowerCase()}`,
  );
  return value;
}

function jwtPayload(token, name) {
  const payload = token.split(".")[1];
  assert(payload, `invalid_${name}`);
  try {
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    throw new Error(`invalid_${name}`);
  }
}

function privateHeaders(headers, label) {
  assert(headers.get("cache-control") === "no-store, private", `${label}_cache`);
  assert(headers.get("referrer-policy") === "no-referrer", `${label}_referrer`);
  assert(headers.get("x-content-type-options") === "nosniff", `${label}_nosniff`);
}

async function invoke({
  body,
  functionName,
  idempotencyKey,
  method = "GET",
  path,
  token,
  version,
}) {
  const response = await fetch(
    `${DEVELOPMENT_URL}/functions/v1/${functionName}${path}`,
    {
      body: body === undefined ? undefined : JSON.stringify(body),
      headers: {
        apikey: publishableKey,
        authorization: `Bearer ${token}`,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
        ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}),
        ...(version === undefined ? {} : { "if-match": `"${version}"` }),
        origin: DEVELOPMENT_ORIGIN,
        "x-client-info": "health-design-t16-remote-smoke/1",
      },
      method,
      redirect: "manual",
    },
  );
  const parsed = await response.json().catch(() => ({}));
  if (response.status >= 200 && response.status < 300) {
    privateHeaders(response.headers, `${functionName}_${method.toLowerCase()}`);
    assert(!response.headers.has("location"), `${functionName}_redirected`);
  }
  return { body: parsed, status: response.status };
}

function snapshot() {
  const known = (value, unit = "g") => ({ state: "known", unit, value });
  return {
    basis: "per_100_g",
    brand: "T16 Evidence",
    density: { state: "unknown" },
    gtin: { displayGtin, gtin14, symbology },
    name: `Producto sintético T16 ${displayGtin}`,
    nutrients: {
      carbohydratesG: known("4.7"),
      clinical: {},
      energyKcal: known("63", "kcal"),
      fatG: known("3.5"),
      fiberG: known("0"),
      proteinG: known("3.4"),
      saltG: known("0.1"),
      saturatedFatG: known("2.3"),
      sugarsG: known("4.7"),
    },
    safety: {
      allergens: { state: "known", values: [] },
      crossContactAllergens: { state: "known", values: [] },
      ingredients: { state: "known", values: ["Ingrediente sintético de prueba"] },
    },
    schemaVersion: 1,
  };
}

const url = required("SUPABASE_URL");
assert(url === DEVELOPMENT_URL, "t16_remote_wrong_environment");
assert(
  required("T16_REMOTE_CONFIRM") === CONFIRMATION,
  "t16_remote_confirmation_required",
);
assert(
  required("T16_REMOTE_MUTATION_CONFIRM") === MUTATION_CONFIRMATION,
  "t16_remote_mutation_confirmation_required",
);
const publishableKey = required("SUPABASE_PUBLISHABLE_KEY");
void required("SUPABASE_SERVICE_ROLE_KEY");
const profileA = uuid(required("T16_PROFILE_A_ID"), "profile_a_id");
const profileB = uuid(required("T16_PROFILE_B_ID"), "profile_b_id");
assert(profileA !== profileB, "t16_profiles_must_differ");
const tokenA = required("T16_PROFILE_A_TOKEN");
const tokenB = required("T16_PROFILE_B_TOKEN");
const adminToken = required("T16_ADMIN_AAL2_TOKEN");
const adminClaims = jwtPayload(adminToken, "admin_aal2_token");
assert(adminClaims.aal === "aal2", "admin_token_not_aal2");
assert(
  Array.isArray(adminClaims.amr) &&
    adminClaims.amr.some(
      (entry) => entry?.method === "totp" && Number.isSafeInteger(entry.timestamp),
    ),
  "admin_token_missing_totp",
);
const planId = uuid(required("T16_PLAN_ID"), "plan_id");
const baseVersionId = uuid(required("T16_BASE_VERSION_ID"), "base_version_id");
const expectedVersion = integer("T16_PLAN_AGGREGATE_VERSION", 1, 1_000_000);
const canonicalFoodKey = required("T16_CANONICAL_FOOD_KEY");
assert(
  /^food:[a-z0-9][a-z0-9._:-]{0,127}$/.test(canonicalFoodKey),
  "invalid_canonical_food_key",
);
const selection = {
  dayIndex: integer("T16_DAY_INDEX", 0, 6),
  expectedCanonicalFoodKey: canonicalFoodKey,
  foodIndex: integer("T16_FOOD_INDEX", 0, 11),
  mealIndex: integer("T16_MEAL_INDEX", 0, 5),
};
const displayGtin = required("T16_TEST_GTIN");
assert(/^\d{8}$|^\d{12}$|^\d{13}$|^\d{14}$/.test(displayGtin), "invalid_test_gtin");
const symbology = required("T16_TEST_SYMBOLOGY");
assert(
  ["ean_8", "ean_13", "upc_a", "upc_e", "itf_14"].includes(symbology),
  "invalid_test_symbology",
);
const gtin14 = displayGtin.padStart(14, "0");
const barcodePath = (profile, suffix = "") =>
  `/v1/profiles/${profile}/products/barcode/${displayGtin}${suffix}?symbology=${symbology}&canonicalFoodKey=${encodeURIComponent(canonicalFoodKey)}`;

const anonymous = await fetch(
  `${DEVELOPMENT_URL}/functions/v1/catalogs${barcodePath(profileA)}`,
  {
    headers: { apikey: publishableKey, origin: DEVELOPMENT_ORIGIN },
  },
);
assert(anonymous.status === 401, "anonymous_product_resolution_not_rejected");

const aal1Admin = await invoke({
  functionName: "admin",
  path: "/v1/admin/barcode-corrections?status=pending",
  token: tokenA,
});
assert(
  aal1Admin.status === 403 && aal1Admin.body?.error?.code === "AAL2_REQUIRED",
  "aal1_admin_not_rejected",
);
const aal2Admin = await invoke({
  functionName: "admin",
  path: "/v1/admin/barcode-corrections?status=pending",
  token: adminToken,
});
assert(aal2Admin.status === 200, "aal2_admin_not_accepted");

const resolutionA = await invoke({
  functionName: "catalogs",
  path: barcodePath(profileA),
  token: tokenA,
});
assert(resolutionA.status === 200, "profile_a_resolution_failed");
const confirmationBody = {
  ...(resolutionA.body?.revisionId
    ? { baseRevisionId: resolutionA.body.revisionId }
    : {}),
  ...(resolutionA.body?.contentHash
    ? { expectedContentHash: resolutionA.body.contentHash }
    : {}),
  schemaVersion: 1,
  snapshot: snapshot(),
};
const confirmationKey = randomUUID();
const confirmationA = await invoke({
  body: confirmationBody,
  functionName: "catalogs",
  idempotencyKey: confirmationKey,
  method: "POST",
  path: barcodePath(profileA, "/confirm"),
  token: tokenA,
});
assert(confirmationA.status === 201, "profile_a_confirmation_failed");

const replay = await invoke({
  body: confirmationBody,
  functionName: "catalogs",
  idempotencyKey: confirmationKey,
  method: "POST",
  path: barcodePath(profileA, "/confirm"),
  token: tokenA,
});
assert(
  replay.status === 201 &&
    replay.body?.confirmationId === confirmationA.body?.confirmationId,
  "confirmation_replay_failed",
);
const changedReplay = await invoke({
  body: {
    ...confirmationBody,
    snapshot: {
      ...confirmationBody.snapshot,
      name: `${confirmationBody.snapshot.name} cambio`,
    },
  },
  functionName: "catalogs",
  idempotencyKey: confirmationKey,
  method: "POST",
  path: barcodePath(profileA, "/confirm"),
  token: tokenA,
});
assert(changedReplay.status === 409, "changed_confirmation_replay_not_rejected");

const confirmedResolutionA = await invoke({
  functionName: "catalogs",
  path: barcodePath(profileA),
  token: tokenA,
});
assert(
  confirmedResolutionA.status === 200 &&
    confirmedResolutionA.body?.confirmedForProfile === true &&
    confirmedResolutionA.body?.revisionId &&
    confirmedResolutionA.body?.contentHash,
  "profile_a_confirmation_not_resolved",
);
const correctedSnapshot = {
  ...confirmedResolutionA.body.snapshot,
  name: `${confirmedResolutionA.body.snapshot.name} revisión privada`,
};
const correctionConfirmation = await invoke({
  body: {
    baseRevisionId: confirmedResolutionA.body.revisionId,
    expectedContentHash: confirmedResolutionA.body.contentHash,
    schemaVersion: 1,
    snapshot: correctedSnapshot,
  },
  functionName: "catalogs",
  idempotencyKey: randomUUID(),
  method: "POST",
  path: barcodePath(profileA, "/confirm"),
  token: tokenA,
});
assert(
  correctionConfirmation.status === 201,
  "profile_a_correction_confirmation_failed",
);
const correctionId = uuid(
  correctionConfirmation.body?.correctionId ?? "",
  "correction_id",
);

const resolutionBBefore = await invoke({
  functionName: "catalogs",
  path: barcodePath(profileB),
  token: tokenB,
});
assert(
  resolutionBBefore.status === 200 && resolutionBBefore.body?.source !== "profile",
  "private_revision_leaked",
);
const detail = await invoke({
  functionName: "admin",
  path: `/v1/admin/barcode-corrections/${correctionId}`,
  token: adminToken,
});
assert(
  detail.status === 200 && detail.body?.status === "pending",
  "correction_detail_failed",
);
const approval = await invoke({
  body: {
    canonicalFoodKey,
    evidence: ["T16 remote synthetic verification"],
    expectedVersion: detail.body.version,
    matchState: "exact",
    schemaVersion: 1,
  },
  functionName: "admin",
  idempotencyKey: randomUUID(),
  method: "POST",
  path: `/v1/admin/barcode-corrections/${correctionId}/approve`,
  token: adminToken,
});
assert(
  approval.status === 200 && approval.body?.status === "approved",
  "correction_approval_failed",
);
const matchingRuleId = uuid(approval.body?.matchingRuleId ?? "", "matching_rule_id");
const activation = await invoke({
  body: { expectedVersion: 1, schemaVersion: 1 },
  functionName: "admin",
  idempotencyKey: randomUUID(),
  method: "POST",
  path: `/v1/admin/matching-rules/${matchingRuleId}/activate`,
  token: adminToken,
});
assert(
  activation.status === 200 && activation.body?.status === "active",
  "matching_activation_failed",
);

const resolutionBAfter = await invoke({
  functionName: "catalogs",
  path: barcodePath(profileB),
  token: tokenB,
});
assert(
  resolutionBAfter.status === 200 && resolutionBAfter.body?.source === "global",
  "global_revision_not_resolved",
);
const confirmationB = await invoke({
  body: {
    baseRevisionId: resolutionBAfter.body.revisionId,
    expectedContentHash: resolutionBAfter.body.contentHash,
    schemaVersion: 1,
    snapshot: resolutionBAfter.body.snapshot,
  },
  functionName: "catalogs",
  idempotencyKey: randomUUID(),
  method: "POST",
  path: barcodePath(profileB, "/confirm"),
  token: tokenB,
});
assert(confirmationB.status === 201, "profile_b_confirmation_failed");
const candidate = await invoke({
  body: {
    baseVersionId,
    confirmationId: confirmationB.body.confirmationId,
    expectedVersion,
    schemaVersion: 1,
    selection,
  },
  functionName: "plans",
  idempotencyKey: randomUUID(),
  method: "POST",
  path: `/v1/plans/${planId}/product-applications`,
  token: tokenB,
  version: expectedVersion,
});
assert(candidate.status === 201, "commercial_product_candidate_failed");
assert(
  candidate.body?.candidateStatus === "pending" && candidate.body?.status === "draft",
  "candidate_not_pending_draft",
);
assert(
  candidate.body?.activeVersionId === baseVersionId,
  "active_plan_changed_implicitly",
);

console.log(
  JSON.stringify(
    {
      adminAal1: "rejected",
      adminAal2: "accepted",
      candidateId: candidate.body.candidateId,
      candidateStatus: candidate.body.candidateStatus,
      correctionId,
      environment: "development",
      matchingRuleId,
      privateIsolation: "pass",
      productionTouched: false,
      status: "T16_REMOTE_SMOKE_CORE_PASS",
    },
    null,
    2,
  ),
);
