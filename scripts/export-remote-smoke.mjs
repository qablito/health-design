import { execFileSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";

import { createClient } from "@supabase/supabase-js";

const DEVELOPMENT_URL = "https://nwoivdxdupklervtnovd.supabase.co";
const DEVELOPMENT_ORIGIN = "https://task-02-environments.health-design.pages.dev";
const DEVELOPMENT_CAPTCHA_TOKEN = "XXXX.DUMMY.TOKEN.XXXX";
const BUCKET = "plan-exports";
const MAX_ARTIFACT_BYTES = 25 * 1024 * 1024;
const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

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

async function parseJson(responsePromise) {
  const response = await responsePromise;
  return {
    body: await response.json().catch(() => ({})),
    headers: response.headers,
    status: response.status,
  };
}

function assertPrivateHeaders(headers, label) {
  assert(headers.get("cache-control") === "no-store, private", `${label}_cache`);
  assert(headers.get("referrer-policy") === "no-referrer", `${label}_referrer`);
  assert(headers.get("x-content-type-options") === "nosniff", `${label}_nosniff`);
}

function requestHeaders(publishableKey, token, body, idempotencyKey, expectedVersion) {
  return {
    apikey: publishableKey,
    ...(token ? { authorization: `Bearer ${token}` } : {}),
    ...(body === undefined ? {} : { "content-type": "application/json" }),
    ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}),
    ...(expectedVersion === undefined ? {} : { "if-match": `"${expectedVersion}"` }),
    origin: DEVELOPMENT_ORIGIN,
    "x-client-info": "health-design-t15-remote-smoke/1",
  };
}

async function invokeJson({
  body,
  functionName,
  idempotencyKey,
  expectedVersion,
  method = "POST",
  path,
  publishableKey,
  token,
}) {
  const result = await parseJson(
    fetch(`${DEVELOPMENT_URL}/functions/v1/${functionName}${path}`, {
      body: body === undefined ? undefined : JSON.stringify(body),
      headers: requestHeaders(
        publishableKey,
        token,
        body,
        idempotencyKey,
        expectedVersion,
      ),
      method,
      redirect: "manual",
    }),
  );
  if (result.status >= 200 && result.status < 300) {
    assertPrivateHeaders(result.headers, `${functionName}_json`);
    assert(!result.headers.has("location"), `${functionName}_json_redirected`);
  }
  return result;
}

async function createIdentity(admin, publishableKey) {
  const suffix = randomUUID().replaceAll("-", "");
  const email = `t15-evidence-${suffix}@health-design.test`;
  const password = `T15!${randomBytes(24).toString("base64url")}`;
  const created = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
    password,
  });
  if (created.error || !created.data.user) {
    throw new Error("temporary_user_creation_failed");
  }
  const auth = createClient(DEVELOPMENT_URL, publishableKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });
  const signedIn = await auth.auth.signInWithPassword({
    email,
    options: { captchaToken: DEVELOPMENT_CAPTCHA_TOKEN },
    password,
  });
  if (signedIn.error || !signedIn.data.session) {
    await admin.auth.admin.deleteUser(created.data.user.id);
    throw new Error("temporary_user_sign_in_failed");
  }
  return {
    auth,
    sessionId: decodeSessionId(signedIn.data.session.access_token),
    token: signedIn.data.session.access_token,
    userId: uuid(created.data.user.id, "temporary_user_id"),
  };
}

async function insertedId(client, table, values) {
  const result = await client.from(table).insert(values).select("id").single();
  if (result.error || !result.data) throw new Error(`${table}_fixture_insert_failed`);
  return uuid(result.data.id, `${table}_id`);
}

function nutritionAnswers() {
  return {
    activeModules: ["nutrition"],
    activityLevel: "moderate",
    age: 35,
    country: "ES",
    dietaryPattern: "omnivore",
    hasConditions: false,
    hasMedications: false,
    heightCm: 178,
    mealsPerDay: 6,
    nutritionAllergiesStatus: "none",
    nutritionFoodAnxiety: "no",
    nutritionIntolerancesStatus: "none",
    nutritionMealAnchors: [
      "wake_up",
      "mid_morning",
      "midday",
      "afternoon",
      "evening",
      "pre_sleep",
    ],
    nutritionMode: "balanced",
    physiologicalSex: "male",
    primaryObjective: "body_composition_maintain",
    proteinPreference: "food_only",
    trainingMode: "none",
    weightKg: 80,
  };
}

async function createProfilePlan(
  admin,
  actorId,
  identity,
  publishableKey,
  label,
  profileRegistry,
) {
  const createdAt = new Date();
  const profileId = await insertedId(admin, "profiles", {
    adult_attested_at: createdAt.toISOString(),
    alias: `T15${label}${randomBytes(5).toString("hex")}`,
    country: "ES",
    timezone: "Europe/Madrid",
  });
  profileRegistry.push(profileId);
  await insertedId(admin, "profile_access", {
    access_scope: "owner",
    actor_id: actorId,
    profile_id: profileId,
  });

  const plans = (path, options = {}) =>
    invokeJson({
      functionName: "plans",
      path,
      publishableKey,
      token: identity.token,
      ...options,
    });
  const saved = await plans(`/v1/profiles/${profileId}/draft`, {
    body: {
      answers: nutritionAnswers(),
      confirmedBlockIds: [
        "core",
        "goals",
        "modules",
        "nutrition",
        "clinical",
        "summary",
      ],
      currentBlockId: "summary",
      expectedVersion: 0,
      schemaVersion: 2,
    },
    idempotencyKey: randomUUID(),
    expectedVersion: 0,
    method: "PUT",
  });
  assert(saved.status === 200, `${label}_questionnaire_save_failed`);
  assert(saved.body?.hardErrors?.length === 0, `${label}_questionnaire_invalid`);

  const submitted = await plans(`/v1/profiles/${profileId}/draft/submit`, {
    body: { expectedVersion: saved.body.version, schemaVersion: 2 },
    idempotencyKey: randomUUID(),
    expectedVersion: saved.body.version,
  });
  assert(submitted.status === 200, `${label}_questionnaire_submit_failed`);

  const snapshot = await plans(`/v1/profiles/${profileId}/contexts/snapshot`, {
    body: { expectedDraftVersion: submitted.body.version, schemaVersion: 1 },
    idempotencyKey: randomUUID(),
    expectedVersion: submitted.body.version,
  });
  assert(snapshot.status === 200, `${label}_context_snapshot_failed`);

  const generated = await plans(`/v1/profiles/${profileId}/plans/generate`, {
    body: { contextSnapshotId: snapshot.body.id, schemaVersion: 1 },
    idempotencyKey: randomUUID(),
  });
  assert(generated.status === 200, `${label}_plan_generation_failed`);

  const detail = await plans(
    `/v1/plans/${generated.body.planId}/versions/${generated.body.planVersionId}`,
    { method: "GET" },
  );
  assert(detail.status === 200, `${label}_plan_detail_failed`);
  const nutrition = detail.body?.moduleResults?.find(
    (result) => result?.module === "nutrition",
  )?.payload;
  assert(nutrition?.nutritionSchemaVersion === 2, `${label}_nutrition_v2_missing`);
  return {
    nutrition,
    planVersionId: uuid(generated.body.planVersionId, `${label}_version_id`),
    profileId,
  };
}

function fullChoices(nutrition) {
  const choices = [];
  for (const [dayIndex, day] of nutrition.days.entries()) {
    for (const [mealIndex, meal] of day.meals.entries()) {
      for (const [foodIndex] of meal.foods.entries()) {
        choices.push([dayIndex, mealIndex, foodIndex, choices.length % 3]);
      }
    }
  }
  assert(choices.length === 168, "maximum_choice_fixture_is_not_168");
  return choices;
}

function maximumConfig(format, nutrition) {
  return {
    choices: fullChoices(nutrition),
    detail: "complete",
    format,
    includeShopping: true,
    includeWeeklyPreparation: true,
    presentation: "preparation",
    range: { kind: "week" },
    schemaVersion: 1,
  };
}

function lightConfigs() {
  const configs = [];
  for (const day of [1, 2, 3, 4, 5, 6, 7]) {
    for (const format of ["pdf", "xlsx"]) {
      for (const includeShopping of [false, true]) {
        configs.push({
          choices: [],
          detail: "compact",
          format,
          includeShopping,
          includeWeeklyPreparation: false,
          presentation: "ingredients",
          range: { day, kind: "day" },
          schemaVersion: 1,
        });
      }
    }
  }
  return configs.slice(0, 20);
}

async function createExport(publishableKey, token, planVersionId, config, key) {
  return invokeJson({
    body: config,
    functionName: "exports",
    idempotencyKey: key,
    path: `/v1/plans/${planVersionId}/exports`,
    publishableKey,
    token,
  });
}

async function downloadExport(publishableKey, token, artifactId, format) {
  const response = await fetch(
    `${DEVELOPMENT_URL}/functions/v1/exports/v1/exports/${artifactId}/content`,
    {
      headers: requestHeaders(publishableKey, token),
      method: "GET",
      redirect: "manual",
    },
  );
  assert(response.status === 200, `${format}_download_failed`);
  assertPrivateHeaders(response.headers, `${format}_download`);
  assert(!response.headers.has("location"), `${format}_download_redirected`);
  assert(
    response.headers.get("content-type") ===
      (format === "pdf" ? "application/pdf" : XLSX_MIME),
    `${format}_content_type_mismatch`,
  );
  assert(
    response.headers.get("content-disposition") ===
      `attachment; filename="plan-${artifactId}.${format}"`,
    `${format}_content_disposition_mismatch`,
  );
  const bytes = new Uint8Array(await response.arrayBuffer());
  assert(bytes.byteLength > 0, `${format}_empty_artifact`);
  assert(bytes.byteLength < MAX_ARTIFACT_BYTES, `${format}_artifact_too_large`);
  return bytes.byteLength;
}

function artifactEvidence(profileIds) {
  const values = profileIds.map((profileId) => `'${profileId}'`).join(",");
  return runSql(`
    select
      count(*)::int as artifact_count,
      count(*) filter (where artifact.status = 'ready')::int as ready_count,
      count(*) filter (where object.id is not null)::int as object_count,
      coalesce(max(artifact.size_bytes), 0)::bigint as maximum_size_bytes,
      count(*) filter (where artifact.size_bytes >= 26214400)::int as oversized_count
    from private.export_artifacts artifact
    left join storage.objects object
      on object.bucket_id = '${BUCKET}' and object.name = artifact.storage_path
    where artifact.profile_id in (${values});
  `)[0];
}

async function main() {
  const url = required("SUPABASE_URL");
  assert(url === DEVELOPMENT_URL, "development_project_required");
  const publishableKey = required("SUPABASE_PUBLISHABLE_KEY");
  const secretKey = required("SUPABASE_SECRET_KEY");
  const admin = createClient(url, secretKey, {
    auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
  });
  const publicClient = createClient(url, publishableKey, {
    auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
  });

  let actorId;
  let identity;
  const profileIds = [];
  let result;
  let failure;
  let cleanupFailure;

  try {
    identity = await createIdentity(admin, publishableKey);
    actorId = await insertedId(admin, "actors", {
      auth_subject: identity.userId,
      role: "device",
    });
    const now = new Date();
    await insertedId(admin, "device_sessions", {
      absolute_expires_at: new Date(now.getTime() + 48 * 60 * 60 * 1_000).toISOString(),
      actor_id: actorId,
      auth_session_id: identity.sessionId,
      created_at: now.toISOString(),
      idle_expires_at: new Date(now.getTime() + 24 * 60 * 60 * 1_000).toISOString(),
      label: "T15 remote evidence",
      last_seen_at: now.toISOString(),
    });

    const maximum = await createProfilePlan(
      admin,
      actorId,
      identity,
      publishableKey,
      "Maximum",
      profileIds,
    );
    const limited = await createProfilePlan(
      admin,
      actorId,
      identity,
      publishableKey,
      "Rate",
      profileIds,
    );

    const anonymousCreate = await createExport(
      publishableKey,
      undefined,
      maximum.planVersionId,
      maximumConfig("pdf", maximum.nutrition),
      randomUUID(),
    );
    assert(anonymousCreate.status === 401, "anonymous_creation_was_not_rejected");

    const pdfKey = randomUUID();
    const pdf = await createExport(
      publishableKey,
      identity.token,
      maximum.planVersionId,
      maximumConfig("pdf", maximum.nutrition),
      pdfKey,
    );
    assert(pdf.status === 200 && pdf.body?.format === "pdf", "maximum_pdf_failed");
    assert(!("signedUrl" in pdf.body), "pdf_signed_url_exposed");
    const beforeReplay = artifactEvidence(profileIds);
    const replay = await createExport(
      publishableKey,
      identity.token,
      maximum.planVersionId,
      maximumConfig("pdf", maximum.nutrition),
      pdfKey,
    );
    const afterReplay = artifactEvidence(profileIds);
    assert(
      replay.status === 200 && replay.body?.artifactId === pdf.body.artifactId,
      "idempotent_pdf_was_not_reused",
    );
    assert(
      beforeReplay.object_count === afterReplay.object_count,
      "idempotent_replay_uploaded_again",
    );

    const xlsx = await createExport(
      publishableKey,
      identity.token,
      maximum.planVersionId,
      maximumConfig("xlsx", maximum.nutrition),
      randomUUID(),
    );
    assert(xlsx.status === 200 && xlsx.body?.format === "xlsx", "maximum_xlsx_failed");
    assert(!("signedUrl" in xlsx.body), "xlsx_signed_url_exposed");
    const pdfBytes = await downloadExport(
      publishableKey,
      identity.token,
      pdf.body.artifactId,
      "pdf",
    );
    const xlsxBytes = await downloadExport(
      publishableKey,
      identity.token,
      xlsx.body.artifactId,
      "xlsx",
    );

    const anonymousDownload = await fetch(
      `${url}/functions/v1/exports/v1/exports/${pdf.body.artifactId}/content`,
      {
        headers: requestHeaders(publishableKey),
        method: "GET",
        redirect: "manual",
      },
    );
    assert(anonymousDownload.status === 401, "anonymous_download_was_not_rejected");

    const privatePath = `${maximum.profileId}/${pdf.body.artifactId}.pdf`;
    const direct = await publicClient.storage.from(BUCKET).download(privatePath);
    assert(direct.error && !direct.data, "private_object_was_publicly_downloadable");

    const configs = lightConfigs();
    const lightArtifacts = [];
    const keys = [];
    for (const config of configs) {
      const key = randomUUID();
      keys.push(key);
      const created = await createExport(
        publishableKey,
        identity.token,
        limited.planVersionId,
        config,
        key,
      );
      assert(created.status === 200, "one_of_twenty_exports_failed");
      lightArtifacts.push(created.body.artifactId);
    }
    assert(new Set(lightArtifacts).size === 20, "light_configs_were_not_distinct");

    const rateEvidence = artifactEvidence(profileIds);
    const rateReplay = await createExport(
      publishableKey,
      identity.token,
      limited.planVersionId,
      configs[0],
      keys[0],
    );
    const rateAfterReplay = artifactEvidence(profileIds);
    assert(
      rateReplay.status === 200 && rateReplay.body?.artifactId === lightArtifacts[0],
      "limited_profile_replay_failed",
    );
    assert(
      rateEvidence.object_count === rateAfterReplay.object_count,
      "limited_profile_replay_uploaded_again",
    );

    const twentyFirst = await createExport(
      publishableKey,
      identity.token,
      limited.planVersionId,
      {
        choices: [],
        detail: "compact",
        format: "pdf",
        includeShopping: false,
        includeWeeklyPreparation: false,
        presentation: "preparation",
        range: { day: 1, kind: "day" },
        schemaVersion: 1,
      },
      randomUUID(),
    );
    assert(
      twentyFirst.status === 429 &&
        twentyFirst.body?.error?.code === "RATE_LIMITED" &&
        Number(twentyFirst.headers.get("retry-after")) > 0,
      "twenty_first_export_was_not_rate_limited",
    );

    const evidence = artifactEvidence(profileIds);
    assert(evidence.artifact_count === 22, "unexpected_artifact_count");
    assert(evidence.ready_count === 22, "non_ready_artifact_remained");
    assert(evidence.object_count === 22, "private_storage_object_missing");
    assert(evidence.oversized_count === 0, "artifact_size_limit_breached");

    result = {
      anonymousCreateRejected: true,
      anonymousDownloadRejected: true,
      artifactCount: evidence.artifact_count,
      fixtureChoiceCount: fullChoices(maximum.nutrition).length,
      idempotencyReused: true,
      maximumPdfBytes: pdfBytes,
      maximumXlsxBytes: xlsxBytes,
      privateStorageConfirmed: true,
      rateLimitProfileAttempts: 20,
      status: "T15_REMOTE_SMOKE_PASS",
      twentyFirstRateLimited: true,
    };
  } catch (error) {
    failure = error;
  } finally {
    try {
      if (profileIds.length > 0) {
        const values = profileIds.map((profileId) => `'${profileId}'`).join(",");
        const paths = runSql(`
          select storage_path
          from private.export_artifacts
          where profile_id in (${values}) and storage_deleted_at is null
          order by storage_path;
        `).map((row) => row.storage_path);
        if (paths.length > 0) {
          const removed = await admin.storage.from(BUCKET).remove(paths);
          assert(!removed.error, "private_object_cleanup_failed");
        }
        runSql(`
          begin;
          delete from private.plan_idempotency where profile_id in (${values});
          delete from private.export_rate_limit_events where profile_id in (${values});
          delete from private.export_artifacts where profile_id in (${values});
          delete from public.profile_access where profile_id in (${values});
          delete from public.context_snapshot_origins where context_snapshot_id in (
            select id from public.context_snapshots where profile_id in (${values})
          );
          update public.plans set active_version_id = null where profile_id in (${values});
          delete from public.plans where profile_id in (${values});
          delete from public.profiles where id in (${values});
          commit;
        `);
        const remaining = runSql(`
          select (
            (select count(*) from private.export_artifacts
              where profile_id in (${values})) +
            (select count(*) from storage.objects
              where bucket_id = '${BUCKET}'
                and split_part(name, '/', 1) in (${values})) +
            (select count(*) from public.profiles where id in (${values}))
          )::int as remaining_count;
        `)[0];
        assert(remaining?.remaining_count === 0, "remote_fixture_rows_remained");
      }
      if (actorId) {
        runSql(`
          delete from public.device_sessions where actor_id = '${actorId}';
          delete from public.actors where id = '${actorId}';
        `);
      }
      if (identity) {
        const deleted = await admin.auth.admin.deleteUser(identity.userId);
        assert(!deleted.error, "temporary_auth_user_cleanup_failed");
        await identity.auth.auth.signOut({ scope: "local" });
      }
    } catch (error) {
      cleanupFailure = error;
    }
  }

  if (failure && cleanupFailure) {
    throw new AggregateError(
      [failure, cleanupFailure],
      "remote_smoke_and_cleanup_failed",
    );
  }
  if (failure) throw failure;
  if (cleanupFailure) throw cleanupFailure;
  process.stdout.write(
    `${JSON.stringify({ ...result, fixtureCleanup: true }, null, 2)}\n`,
  );
}

await main();
