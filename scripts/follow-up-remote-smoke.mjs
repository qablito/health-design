import { execFileSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";

import { createClient } from "@supabase/supabase-js";

const DEVELOPMENT_URL = "https://nwoivdxdupklervtnovd.supabase.co";
const DEVELOPMENT_ORIGIN = "https://task-02-environments.health-design.pages.dev";
const DEVELOPMENT_CAPTCHA_TOKEN = "XXXX.DUMMY.TOKEN.XXXX";
const POSTGRES_IMAGE = "public.ecr.aws/supabase/postgres:17.6.1.147";

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`missing_${name.toLowerCase()}`);
  return value;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function debug(label, value) {
  if (process.env.T13_REMOTE_DEBUG !== "1") return;
  process.stderr.write(`${label}=${JSON.stringify(value)}\n`);
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
  const databaseUrl = required("SUPABASE_DB_URL");
  const password = required("SUPABASE_DB_PASSWORD");
  assert(
    databaseUrl.includes("postgres.nwoivdxdupklervtnovd@"),
    "development_database_required",
  );
  return execFileSync(
    "docker",
    [
      "run",
      "--rm",
      "--pull=never",
      "-e",
      "PGPASSWORD",
      POSTGRES_IMAGE,
      "psql",
      "--no-psqlrc",
      "--set",
      "ON_ERROR_STOP=1",
      "--quiet",
      "--tuples-only",
      "--no-align",
      databaseUrl,
      "--command",
      sql,
    ],
    {
      encoding: "utf8",
      env: { ...process.env, PGPASSWORD: password },
      stdio: ["ignore", "pipe", "pipe"],
    },
  ).trim();
}

async function parseResponse(response) {
  const body = await response.json().catch(() => ({}));
  return { body, headers: response.headers, status: response.status };
}

async function createIdentity(admin, publishableKey, label) {
  const suffix = randomUUID().replaceAll("-", "");
  const email = `t13-${label}-${suffix}@health-design.test`;
  const password = `T13!${randomBytes(24).toString("base64url")}`;
  const created = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
    password,
  });
  if (created.error || !created.data.user) {
    throw new Error(`temporary_${label}_creation_failed`);
  }
  const auth = createClient(DEVELOPMENT_URL, publishableKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });
  const signIn = await auth.auth.signInWithPassword({
    email,
    options: { captchaToken: DEVELOPMENT_CAPTCHA_TOKEN },
    password,
  });
  if (signIn.error || !signIn.data.session) {
    throw new Error(`temporary_${label}_sign_in_failed`);
  }
  return {
    auth,
    sessionId: decodeSessionId(signIn.data.session.access_token),
    token: signIn.data.session.access_token,
    userId: uuid(created.data.user.id, `${label}_user_id`),
  };
}

async function insertedId(client, table, values) {
  const result = await client.from(table).insert(values).select("id").single();
  if (result.error || !result.data) {
    throw new Error(`${table}_fixture_insert_failed`);
  }
  return uuid(result.data.id, `${table}_id`);
}

async function main() {
  const url = required("SUPABASE_URL");
  assert(url === DEVELOPMENT_URL, "development_project_required");
  const publishableKey = required("SUPABASE_PUBLISHABLE_KEY");
  const serviceRoleKey = required("SUPABASE_SERVICE_ROLE_KEY");
  const admin = createClient(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });

  let firstIdentity;
  let secondIdentity;
  let firstActorId;
  let secondActorId;
  let profileId;
  let result;
  let failure;
  let cleanupFailure;

  const invoke = async (
    token,
    path,
    { body, expectedVersion, method = "POST" } = {},
  ) => {
    const response = await parseResponse(
      await fetch(`${url}/functions/v1/plans${path}`, {
        body: body === undefined ? undefined : JSON.stringify(body),
        headers: {
          apikey: publishableKey,
          authorization: `Bearer ${token}`,
          ...(body === undefined ? {} : { "content-type": "application/json" }),
          ...(method === "GET" ? {} : { "idempotency-key": randomUUID() }),
          ...(expectedVersion === undefined
            ? {}
            : { "if-match": `"${expectedVersion}"` }),
          origin: DEVELOPMENT_ORIGIN,
          "x-client-info": "health-design-t13-remote-smoke/1",
        },
        method,
      }),
    );
    if (response.status >= 200 && response.status < 300) {
      assert(
        response.headers.get("cache-control") === "no-store, private",
        "private_cache_header_missing",
      );
    }
    return response;
  };

  try {
    firstIdentity = await createIdentity(admin, publishableKey, "primary");
    secondIdentity = await createIdentity(admin, publishableKey, "linked");
    const createdAt = new Date();
    const idleExpiry = new Date(createdAt.getTime() + 24 * 60 * 60 * 1_000);
    const absoluteExpiry = new Date(createdAt.getTime() + 48 * 60 * 60 * 1_000);

    firstActorId = await insertedId(admin, "actors", {
      auth_subject: firstIdentity.userId,
      role: "device",
    });
    secondActorId = await insertedId(admin, "actors", {
      auth_subject: secondIdentity.userId,
      role: "device",
    });
    profileId = await insertedId(admin, "profiles", {
      adult_attested_at: createdAt.toISOString(),
      alias: `T13Smoke${randomBytes(6).toString("hex")}`,
      country: "ES",
      timezone: "Europe/Madrid",
    });
    await insertedId(admin, "profile_access", {
      access_scope: "owner",
      actor_id: firstActorId,
      profile_id: profileId,
    });
    for (const [identity, actorId, label] of [
      [firstIdentity, firstActorId, "T13 remote primary"],
      [secondIdentity, secondActorId, "T13 remote linked"],
    ]) {
      await insertedId(admin, "device_sessions", {
        absolute_expires_at: absoluteExpiry.toISOString(),
        actor_id: actorId,
        auth_session_id: identity.sessionId,
        created_at: createdAt.toISOString(),
        idle_expires_at: idleExpiry.toISOString(),
        label,
        last_seen_at: createdAt.toISOString(),
      });
    }

    const answers = {
      activeModules: ["nutrition", "hydration", "sleep", "supplements"],
      activityLevel: "moderate",
      age: 35,
      country: "ES",
      dailySchedule: "regular",
      dietaryPattern: "omnivore",
      hasConditions: false,
      hasCurrentSupplements: false,
      hasLabValues: false,
      hasMedications: false,
      habitualWaterMl: 2_000,
      heightCm: 178,
      hydrationClimate: "temperate",
      hydrationFluidRestriction: "none",
      hydrationSweat: "medium",
      mealsPerDay: 4,
      nutritionAllergiesStatus: "none",
      nutritionFoodAnxiety: "no",
      nutritionIntolerancesStatus: "none",
      physiologicalSex: "male",
      primaryObjective: "body_composition_maintain",
      proteinPreference: "food_only",
      sleepHours: 7.5,
      sleepQuality: "good",
      sleepRegularity: "regular",
      trainingMode: "none",
      weightKg: 80,
    };
    const saved = await invoke(firstIdentity.token, `/v1/profiles/${profileId}/draft`, {
      body: {
        answers,
        confirmedBlockIds: [
          "core",
          "goals",
          "modules",
          "nutrition",
          "hydration",
          "sleep",
          "supplements",
          "clinical",
          "labs",
          "summary",
        ],
        currentBlockId: "summary",
        expectedVersion: 0,
        schemaVersion: 2,
      },
      expectedVersion: 0,
      method: "PUT",
    });
    assert(saved.status === 200, "questionnaire_save_failed");
    assert(saved.body?.hardErrors?.length === 0, "questionnaire_hard_error");
    const submitted = await invoke(
      firstIdentity.token,
      `/v1/profiles/${profileId}/draft/submit`,
      {
        body: { expectedVersion: saved.body.version, schemaVersion: 2 },
        expectedVersion: saved.body.version,
      },
    );
    assert(submitted.status === 200, "questionnaire_submit_failed");

    const snapshot = await invoke(
      firstIdentity.token,
      `/v1/profiles/${profileId}/contexts/snapshot`,
      {
        body: {
          expectedDraftVersion: submitted.body.version,
          schemaVersion: 1,
        },
        expectedVersion: submitted.body.version,
      },
    );
    assert(snapshot.status === 200, "context_snapshot_failed");
    const generated = await invoke(
      firstIdentity.token,
      `/v1/profiles/${profileId}/plans/generate`,
      {
        body: { contextSnapshotId: snapshot.body.id, schemaVersion: 1 },
      },
    );
    assert(generated.status === 200, "initial_plan_generation_failed");
    const activated = await invoke(
      firstIdentity.token,
      `/v1/plans/${generated.body.planId}/versions/${generated.body.planVersionId}/activate`,
      {
        body: { expectedVersion: generated.body.aggregateVersion, schemaVersion: 1 },
        expectedVersion: generated.body.aggregateVersion,
      },
    );
    assert(
      activated.status === 200 &&
        activated.body.activeVersionId === activated.body.planVersionId,
      "initial_plan_activation_failed",
    );

    const weekly = await invoke(
      firstIdentity.token,
      `/v1/profiles/${profileId}/follow-ups`,
      {
        body: {
          basePlanVersionId: activated.body.planVersionId,
          observedAt: new Date().toISOString(),
          requestRecalculation: false,
          schemaVersion: 1,
          scope: "weekly",
          values: {
            common: {
              adherence: 4,
              importantSymptoms: [],
              materialChanges: [],
            },
            nutrition: { hunger: 3, satiety: 4 },
          },
        },
      },
    );
    assert(
      weekly.status === 200 && weekly.body.candidate === null,
      "weekly_follow_up_failed",
    );
    const daily = await invoke(
      firstIdentity.token,
      `/v1/profiles/${profileId}/follow-ups`,
      {
        body: {
          basePlanVersionId: activated.body.planVersionId,
          observedAt: new Date().toISOString(),
          requestRecalculation: false,
          schemaVersion: 1,
          scope: "daily",
          values: { hydration: { averageMl: 2_150, issues: "none" } },
        },
      },
    );
    assert(daily.status === 200 && daily.body.candidate === null, "daily_failed");
    const contextual = await invoke(
      firstIdentity.token,
      `/v1/profiles/${profileId}/follow-ups`,
      {
        body: {
          basePlanVersionId: activated.body.planVersionId,
          observedAt: new Date().toISOString(),
          requestRecalculation: true,
          schemaVersion: 1,
          scope: "weekly",
          values: {
            common: {
              adherence: 4,
              importantSymptoms: [],
              materialChanges: ["medication"],
            },
          },
        },
      },
    );
    assert(
      contextual.status === 200 &&
        contextual.body.contextUpdateRequired === true &&
        contextual.body.entry.completeness === "provisional" &&
        contextual.body.candidate === null,
      "material_change_was_not_gated",
    );

    const firstLab = await invoke(
      firstIdentity.token,
      `/v1/profiles/${profileId}/labs`,
      {
        body: {
          basePlanVersionId: activated.body.planVersionId,
          observations: [
            {
              analyte: "b12",
              measurement: { date: "2026-06-01", kind: "exact" },
              name: "Vitamina B12",
              referenceRange: { maximum: "900", minimum: "200", unit: "pg/mL" },
              source: "laboratory",
              unit: "pg/mL",
              value: "410",
            },
          ],
          requestRecalculation: false,
          schemaVersion: 1,
        },
      },
    );
    assert(
      firstLab.status === 200 && firstLab.body.candidate === null,
      "baseline_lab_failed",
    );
    const secondLab = await invoke(
      firstIdentity.token,
      `/v1/profiles/${profileId}/labs`,
      {
        body: {
          basePlanVersionId: activated.body.planVersionId,
          observations: [
            {
              analyte: "b12",
              measurement: { date: "2026-07-15", kind: "exact" },
              name: "Vitamina B12",
              referenceRange: { maximum: "900", minimum: "200", unit: "pg/mL" },
              source: "laboratory",
              unit: "pg/mL",
              value: "150",
            },
          ],
          requestRecalculation: false,
          schemaVersion: 1,
        },
      },
    );
    debug("second_lab", {
      candidate: secondLab.body?.candidate ?? null,
      items: secondLab.body?.history?.items ?? null,
      status: secondLab.status,
    });
    assert(
      secondLab.status === 200 &&
        secondLab.body.candidate?.candidateStatus === "pending" &&
        secondLab.body.history.items[0]?.trend === "down" &&
        secondLab.body.history.items[0]?.interpretation === "below_range",
      "lab_candidate_or_trend_failed",
    );

    const deniedBeforeLink = await invoke(
      secondIdentity.token,
      `/v1/profiles/${profileId}/labs`,
      { method: "GET" },
    );
    assert(
      deniedBeforeLink.status === 403 &&
        deniedBeforeLink.body?.error?.code === "FORBIDDEN",
      "unlinked_device_was_not_denied",
    );
    await insertedId(admin, "profile_access", {
      access_scope: "owner",
      actor_id: secondActorId,
      profile_id: profileId,
    });
    const restoredOnLinkedDevice = await invoke(
      secondIdentity.token,
      `/v1/profiles/${profileId}/labs`,
      { method: "GET" },
    );
    assert(
      restoredOnLinkedDevice.status === 200 &&
        restoredOnLinkedDevice.body.pendingCandidates[0]?.candidateId ===
          secondLab.body.candidate.candidateId,
      "linked_device_did_not_restore_candidate",
    );

    const acceptedCandidate = await invoke(
      secondIdentity.token,
      `/v1/candidates/${secondLab.body.candidate.candidateId}/activate`,
      {
        body: {
          expectedVersion: secondLab.body.candidate.aggregateVersion,
          schemaVersion: 1,
        },
        expectedVersion: secondLab.body.candidate.aggregateVersion,
      },
    );
    assert(
      acceptedCandidate.status === 200 && acceptedCandidate.body.status === "active",
      "candidate_activation_failed",
    );
    const recalculation = await invoke(
      firstIdentity.token,
      `/v1/profiles/${profileId}/follow-ups`,
      {
        body: {
          basePlanVersionId: acceptedCandidate.body.planVersionId,
          observedAt: new Date().toISOString(),
          requestRecalculation: true,
          schemaVersion: 1,
          scope: "weekly",
          values: {
            common: {
              adherence: 3,
              importantSymptoms: [],
              materialChanges: [],
            },
            nutrition: { hunger: 2 },
          },
        },
      },
    );
    assert(
      recalculation.status === 200 &&
        recalculation.body.candidate?.candidateStatus === "pending",
      "selective_recalculation_candidate_failed",
    );
    const discardedCandidate = await invoke(
      firstIdentity.token,
      `/v1/candidates/${recalculation.body.candidate.candidateId}/discard`,
      {
        body: {
          expectedVersion: recalculation.body.candidate.aggregateVersion,
          schemaVersion: 1,
        },
        expectedVersion: recalculation.body.candidate.aggregateVersion,
      },
    );
    assert(
      discardedCandidate.status === 200 &&
        discardedCandidate.body.candidateStatus === "discarded" &&
        discardedCandidate.body.activeVersionId ===
          acceptedCandidate.body.planVersionId,
      "candidate_discard_failed",
    );

    const followUpHistory = await invoke(
      secondIdentity.token,
      `/v1/profiles/${profileId}/follow-ups`,
      { method: "GET" },
    );
    const finalLabs = await invoke(
      secondIdentity.token,
      `/v1/profiles/${profileId}/labs`,
      { method: "GET" },
    );
    assert(
      followUpHistory.status === 200 && followUpHistory.body.entries.length === 4,
      "follow_up_history_incomplete",
    );
    assert(
      finalLabs.status === 200 && finalLabs.body.pendingCandidates.length === 0,
      "pending_candidate_remained",
    );

    result = {
      candidateActivated: true,
      candidateDiscarded: true,
      candidateRestoredOnLinkedDevice: true,
      dailyOptional: true,
      followUpEntryCount: followUpHistory.body.entries.length,
      labObservationCount: finalLabs.body.observations.length,
      materialChangeGated: true,
      pendingCandidateCount: finalLabs.body.pendingCandidates.length,
      preLinkIsolation: true,
      status: "T13_REMOTE_SMOKE_PASS",
      trend: finalLabs.body.items[0]?.trend,
      weeklyMinimum: true,
    };
  } catch (error) {
    failure = error;
  } finally {
    try {
      if (profileId && firstActorId && secondActorId) {
        runSql(`
          begin;
          delete from public.profile_access
          where profile_id = '${uuid(profileId, "cleanup_profile_id")}';
          delete from public.device_sessions
          where actor_id in (
            '${uuid(firstActorId, "cleanup_first_actor_id")}',
            '${uuid(secondActorId, "cleanup_second_actor_id")}'
          );
          delete from public.context_snapshot_origins
          where context_snapshot_id in (
            select id from public.context_snapshots
            where profile_id = '${profileId}'
          );
          delete from public.follow_up_entries where profile_id = '${profileId}';
          delete from public.lab_batches where profile_id = '${profileId}';
          update public.plans set active_version_id = null
          where profile_id = '${profileId}';
          delete from public.plans where profile_id = '${profileId}';
          delete from public.profiles where id = '${profileId}';
          delete from public.actors where id in ('${firstActorId}', '${secondActorId}');
          commit;
        `);
        const remaining = runSql(`
          select (
            (select count(*) from public.profiles where id = '${profileId}') +
            (select count(*) from public.actors
              where id in ('${firstActorId}', '${secondActorId}')) +
            (select count(*) from public.follow_up_entries
              where profile_id = '${profileId}') +
            (select count(*) from public.lab_observations
              where profile_id = '${profileId}')
          );
        `);
        assert(remaining === "0", "remote_fixture_rows_remained");
      }
      for (const identity of [firstIdentity, secondIdentity]) {
        if (!identity) continue;
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
