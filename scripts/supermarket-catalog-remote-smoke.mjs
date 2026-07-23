import { execFileSync } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

import { createClient } from "@supabase/supabase-js";
import { createServer } from "../apps/web/node_modules/vite/dist/node/index.js";

const DEVELOPMENT_PROJECT_REF = "nwoivdxdupklervtnovd";
const DEVELOPMENT_URL = `https://${DEVELOPMENT_PROJECT_REF}.supabase.co`;
const DEVELOPMENT_ORIGIN = "https://task-02-environments.health-design.pages.dev";
const DEVELOPMENT_CAPTCHA_TOKEN = "XXXX.DUMMY.TOKEN.XXXX";
const PRODUCTION_PROJECT_REF = "rbfrpgafytexrarcfmmp";
const PRODUCTION_URL = `https://${PRODUCTION_PROJECT_REF}.supabase.co`;
const REMOTE_CONFIRMATION = "health-design-dev:t17-shopping";
const BUCKET = "plan-exports";
const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const MAX_ARTIFACT_BYTES = 25 * 1024 * 1024;
const AAL2_MAX_AGE_SECONDS = 5 * 60;

const stages = [
  "Validar health-design-dev y rechazar Production",
  "Exigir una sesión operadora AAL2/TOTP reciente",
  "Confirmar la publicación Mercadona sin alterar catálogos",
  "Crear dos identidades y perfiles sintéticos aislados",
  "Resolver cestas completa y parcial, sobrante y selección manual",
  "Verificar RLS cruzada, replay idempotente y snapshot archivado",
  "Exportar PDF/XLSX privados desde snapshots activo y archivado",
  "Sembrar un límite controlado y verificar un único 429 con Retry-After",
  "Purgar perfiles, snapshots y artefactos sin alterar el catálogo global",
];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`missing_${name.toLowerCase()}`);
  return value;
}

function optional(name) {
  return process.env[name]?.trim();
}

function assertDevelopmentReferences({ requireAll }) {
  const url = optional("SUPABASE_URL");
  const projectRef = optional("SUPABASE_PROJECT_REF");
  for (const value of [url, projectRef].filter(Boolean)) {
    if (
      value === PRODUCTION_URL ||
      value === PRODUCTION_PROJECT_REF ||
      value.includes(PRODUCTION_PROJECT_REF)
    ) {
      throw new Error("production_is_forbidden");
    }
  }
  if (url && url !== DEVELOPMENT_URL) throw new Error("development_url_required");
  if (projectRef && projectRef !== DEVELOPMENT_PROJECT_REF) {
    throw new Error("development_project_required");
  }
  if (requireAll && (!url || !projectRef)) {
    throw new Error("development_environment_required");
  }
}

function printPlan() {
  assertDevelopmentReferences({ requireAll: false });
  process.stdout.write(
    `${JSON.stringify(
      {
        allowedEnvironment: {
          projectRef: DEVELOPMENT_PROJECT_REF,
          url: DEVELOPMENT_URL,
        },
        forbiddenEnvironment: {
          projectRef: PRODUCTION_PROJECT_REF,
          url: PRODUCTION_URL,
        },
        mode: "dry-run",
        network: false,
        secretsRequired: false,
        stages,
      },
      null,
      2,
    )}\n`,
  );
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

function decodeJwt(token) {
  const payload = token.split(".")[1];
  if (!payload) throw new Error("invalid_aal2_token");
  try {
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    throw new Error("invalid_aal2_token");
  }
}

function assertRecentAal2(token) {
  const claims = decodeJwt(token);
  const now = Math.floor(Date.now() / 1_000);
  const methods = Array.isArray(claims.amr) ? claims.amr : [];
  const totpTimestamps = methods
    .filter(
      (entry) => entry?.method === "totp" && Number.isSafeInteger(entry.timestamp),
    )
    .map((entry) => entry.timestamp);
  assert(claims.aal === "aal2", "aal2_required");
  assert(totpTimestamps.length > 0, "totp_required");
  const latestTotp = Math.max(...totpTimestamps);
  assert(
    latestTotp <= now && now - latestTotp <= AAL2_MAX_AGE_SECONDS,
    "totp_not_recent",
  );
  assert(Number.isInteger(claims.iat), "aal2_iat_required");
  assert(Number.isInteger(claims.exp) && claims.exp > now, "aal2_token_expired");
  assert(claims.iat <= now, "aal2_iat_invalid");
}

function decodeSessionId(token) {
  return uuid(decodeJwt(token).session_id, "auth_session_id");
}

function sqlLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function assertLinkedDevelopment() {
  let projectRef;
  try {
    projectRef = readFileSync(
      new URL("../supabase/.temp/project-ref", import.meta.url),
      "utf8",
    ).trim();
  } catch {
    throw new Error("linked_project_ref_required");
  }
  assert(projectRef === DEVELOPMENT_PROJECT_REF, "linked_development_required");
}

function runSql(sql) {
  assertLinkedDevelopment();
  const output = execFileSync(
    "pnpm",
    ["exec", "supabase", "db", "query", "--linked", sql],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
  return JSON.parse(output).rows;
}

function parseJson(responsePromise) {
  return responsePromise.then(async (response) => ({
    body: await response.json().catch(() => ({})),
    headers: response.headers,
    status: response.status,
  }));
}

function assertPrivateHeaders(headers, label) {
  assert(headers.get("cache-control") === "no-store, private", `${label}_cache`);
  assert(headers.get("referrer-policy") === "no-referrer", `${label}_referrer`);
  assert(headers.get("x-content-type-options") === "nosniff", `${label}_nosniff`);
}

function requestHeaders(publishableKey, token, body, idempotencyKey) {
  return {
    apikey: publishableKey,
    ...(token ? { authorization: `Bearer ${token}` } : {}),
    ...(body === undefined ? {} : { "content-type": "application/json" }),
    ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}),
    origin: DEVELOPMENT_ORIGIN,
    "x-client-info": "health-design-t17-remote-smoke/1",
  };
}

async function invoke({
  body,
  functionName,
  idempotencyKey,
  method = "POST",
  path,
  publishableKey,
  token,
}) {
  const result = await parseJson(
    fetch(`${DEVELOPMENT_URL}/functions/v1/${functionName}${path}`, {
      body: body === undefined ? undefined : JSON.stringify(body),
      headers: requestHeaders(publishableKey, token, body, idempotencyKey),
      method,
      redirect: "manual",
    }),
  );
  if (result.status >= 200 && result.status < 300) {
    assertPrivateHeaders(result.headers, `${functionName}_json`);
    assert(!result.headers.has("location"), `${functionName}_redirected`);
  }
  return result;
}

async function createIdentity(admin, publishableKey, label, identityRegistry) {
  const suffix = randomUUID().replaceAll("-", "");
  const email = `t17-${label}-${suffix}@health-design.test`;
  const password = `T17!${randomBytes(24).toString("base64url")}`;
  const created = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
    password,
  });
  if (created.error || !created.data.user) {
    throw new Error("temporary_user_creation_failed");
  }
  const identity = {
    userId: uuid(created.data.user.id, "temporary_user_id"),
  };
  identityRegistry.push(identity);
  const auth = createClient(DEVELOPMENT_URL, publishableKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });
  identity.auth = auth;
  const signedIn = await auth.auth.signInWithPassword({
    email,
    options: { captchaToken: DEVELOPMENT_CAPTCHA_TOKEN },
    password,
  });
  if (signedIn.error || !signedIn.data.session) {
    throw new Error("temporary_user_sign_in_failed");
  }
  identity.sessionId = decodeSessionId(signedIn.data.session.access_token);
  identity.token = signedIn.data.session.access_token;
  return identity;
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
    mealsPerDay: 4,
    nutritionAllergiesStatus: "none",
    nutritionFoodAnxiety: "no",
    nutritionIntolerancesStatus: "none",
    nutritionMealAnchors: ["wake_up", "midday", "afternoon", "evening"],
    nutritionMode: "balanced",
    physiologicalSex: "male",
    primaryObjective: "body_composition_maintain",
    proteinPreference: "food_only",
    trainingMode: "none",
    weightKg: 80,
  };
}

async function generatedNutrition() {
  const vite = await createServer({
    appType: "custom",
    logLevel: "silent",
    server: { middlewareMode: true },
  });
  try {
    const engine = await vite.ssrLoadModule("/packages/engine/src/index.ts");
    const fixtures = await vite.ssrLoadModule(
      "/packages/test-fixtures/src/profiles/nutrition/index.ts",
    );
    return engine.generateNutritionWeek({
      answers: nutritionAnswers(),
      catalog: fixtures.effectiveNutritionFoods,
    });
  } finally {
    await vite.close();
  }
}

function publishedCatalogState() {
  return runSql(`
    select
      count(*)::int as publication_count,
      encode(
        extensions.digest(
          convert_to(
            jsonb_build_object(
              'publications', (
                select coalesce(
                  jsonb_agg(to_jsonb(state_publication) order by state_publication.id),
                  '[]'::jsonb
                )
                from private.catalog_publications state_publication
              ),
              'catalogRevisions', (
                select coalesce(
                  jsonb_agg(to_jsonb(catalog_revision) order by catalog_revision.id),
                  '[]'::jsonb
                )
                from private.supermarket_catalog_revisions catalog_revision
                where catalog_revision.id in (
                  select state_publication.catalog_revision_id
                  from private.catalog_publications state_publication
                )
              ),
              'skuRevisions', (
                select coalesce(
                  jsonb_agg(to_jsonb(sku_revision) order by sku_revision.id),
                  '[]'::jsonb
                )
                from private.supermarket_sku_revisions sku_revision
                where sku_revision.catalog_revision_id in (
                  select state_publication.catalog_revision_id
                  from private.catalog_publications state_publication
                )
              ),
              'matchingRules', (
                select coalesce(
                  jsonb_agg(to_jsonb(matching_rule) order by matching_rule.id),
                  '[]'::jsonb
                )
                from private.supermarket_sku_matching_rule_revisions matching_rule
                where matching_rule.sku_id in (
                  select sku_revision.sku_id
                  from private.supermarket_sku_revisions sku_revision
                  where sku_revision.catalog_revision_id in (
                    select state_publication.catalog_revision_id
                    from private.catalog_publications state_publication
                  )
                )
              ),
              'seedRevisions', (
                select coalesce(
                  jsonb_agg(to_jsonb(seed_revision) order by seed_revision.id),
                  '[]'::jsonb
                )
                from private.basket_seed_revisions seed_revision
                where seed_revision.id in (
                  select state_publication.basket_seed_revision_id
                  from private.catalog_publications state_publication
                )
              ),
              'seedItems', (
                select coalesce(
                  jsonb_agg(to_jsonb(seed_item) order by seed_item.id),
                  '[]'::jsonb
                )
                from private.basket_seed_items seed_item
                where seed_item.basket_seed_revision_id in (
                  select state_publication.basket_seed_revision_id
                  from private.catalog_publications state_publication
                )
              )
            )::text,
            'utf8'
          ),
          'sha256'
        ),
        'hex'
      ) as catalog_state_digest,
      count(*) filter (
        where publication.chain = 'mercadona'
          and publication.hidden_at is null
      )::int as mercadona_count,
      coalesce(bool_and(
        (publication.coverage ->> 'publishable')::boolean
      ) filter (
        where publication.chain = 'mercadona'
          and publication.hidden_at is null
      ), false) as mercadona_publishable,
      coalesce(min(
        (publication.coverage ->> 'totalUsable')::integer
      ) filter (
        where publication.chain = 'mercadona'
          and publication.hidden_at is null
      ), 0)::int as mercadona_usable,
      coalesce(bool_and(not exists (
        select 1
        from jsonb_array_elements(publication.coverage -> 'groups') coverage_group
        where (coverage_group ->> 'usable')::integer * 4
          < (coverage_group ->> 'required')::integer * 3
      )) filter (
        where publication.chain = 'mercadona'
          and publication.hidden_at is null
      ), false) as mercadona_groups_pass
    from private.catalog_publications publication;
  `)[0];
}

function compatiblePublishedFood() {
  const row = runSql(`
    select food.food_key, food.name
    from private.catalog_publications publication
    join private.supermarket_sku_revisions revision
      on revision.catalog_revision_id = publication.catalog_revision_id
    join private.supermarket_sku_matching_rule_revisions rule
      on rule.sku_id = revision.sku_id
      and rule.status = 'active'
      and rule.match_state in ('exact', 'allowed')
      and rule.criteria ->> 'catalogRevisionId' = publication.catalog_revision_id::text
      and rule.criteria ->> 'skuContentHash' = encode(revision.content_hash, 'hex')
    join public.canonical_foods food on food.id = rule.canonical_food_id
    join private.basket_seed_items seed
      on seed.basket_seed_revision_id = publication.basket_seed_revision_id
      and seed.canonical_food_id = food.id
      and seed.food_state = rule.food_state
      and seed.purchase_form = rule.purchase_form
      and seed.edible_part = rule.edible_part
    where publication.chain = 'mercadona'
      and publication.hidden_at is null
      and revision.usability = 'calculable'
      and revision.package is not null
      and revision.base_price_eur is not null
      and jsonb_array_length(revision.exclusion_reasons) = 0
    group by food.food_key, food.name
    having count(distinct revision.sku_id) >= 2
    order by food.food_key
    limit 1;
  `)[0];
  assert(row?.food_key && row?.name, "published_alternative_food_required");
  return row;
}

function nutritionDigest(planVersionId) {
  const row = runSql(`
    select encode(
      extensions.digest(result.payload::text, 'sha256'),
      'hex'
    ) as digest
    from public.module_results result
    where result.plan_version_id = '${planVersionId}'
      and result.module = 'nutrition';
  `)[0];
  assert(/^[0-9a-f]{64}$/.test(row?.digest ?? ""), "nutrition_digest_required");
  return row.digest;
}

function nutritionForShopping(nutrition, food, partial) {
  return {
    ...nutrition,
    shoppingList: [
      {
        amountG: "1000",
        canonicalFoodKey: food.food_key,
        name: food.name,
      },
      ...(partial
        ? [
            {
              amountG: "500",
              canonicalFoodKey: "food:test.t17-unmatched",
              name: "Alimento sintético sin producto",
            },
          ]
        : []),
    ],
  };
}

async function createActorSession(admin, identity, label, actorRegistry) {
  const actorId = await insertedId(admin, "actors", {
    auth_subject: identity.userId,
    role: "device",
  });
  actorRegistry.push(actorId);
  const now = new Date();
  await insertedId(admin, "device_sessions", {
    absolute_expires_at: new Date(now.getTime() + 48 * 60 * 60 * 1_000).toISOString(),
    actor_id: actorId,
    auth_session_id: identity.sessionId,
    created_at: now.toISOString(),
    idle_expires_at: new Date(now.getTime() + 24 * 60 * 60 * 1_000).toISOString(),
    label,
    last_seen_at: now.toISOString(),
  });
  return actorId;
}

async function createProfilePlan(admin, actorId, label, nutrition, profileRegistry) {
  const profileId = await insertedId(admin, "profiles", {
    adult_attested_at: new Date().toISOString(),
    alias: `T17${label}${randomBytes(5).toString("hex")}`,
    country: "ES",
    timezone: "Europe/Madrid",
  });
  profileRegistry.push(profileId);
  await insertedId(admin, "profile_access", {
    access_scope: "owner",
    actor_id: actorId,
    profile_id: profileId,
  });
  const ids = {
    context: randomUUID(),
    draft: randomUUID(),
    plan: randomUUID(),
    version: randomUUID(),
  };
  const payload = JSON.stringify(nutrition);
  const answers = JSON.stringify(nutritionAnswers());
  assert(!payload.includes("$t17$") && !answers.includes("$t17$"), "fixture_delimiter");
  runSql(`
    begin;
    insert into public.questionnaire_drafts (
      id, profile_id, schema_version, version, status, completeness,
      answers, confirmed_block_ids, current_block_id
    ) values (
      '${ids.draft}', '${profileId}', 2, 1, 'submitted', 'complete',
      $t17$${answers}$t17$::jsonb, array['summary']::text[], 'summary'
    );
    insert into public.context_snapshots (
      id, profile_id, source_draft_id, source_draft_version, schema_version,
      effective_at, answers, completeness, normalization_version, input_hash,
      canonicalization_version
    ) values (
      '${ids.context}', '${profileId}', '${ids.draft}', 1, 1,
      clock_timestamp(), $t17$${answers}$t17$::jsonb, 'complete',
      't17-smoke-v1', decode(repeat('17', 32), 'hex'), 'jcs-v1'
    );
    insert into public.plans (id, profile_id)
    values ('${ids.plan}', '${profileId}');
    insert into public.plan_versions (
      id, plan_id, ordinal, status, completeness, validation_status,
      validation, context_snapshot_id, engine_version, rule_set_revision_id,
      source_manifest_id, input_hash, output_hash, canonicalization_version,
      activated_at, activated_by
    ) values (
      '${ids.version}', '${ids.plan}', 1, 'active', 'complete', 'valid',
      '{"completeness":"complete"}', '${ids.context}', 't17-smoke-v1',
      gen_random_uuid(), gen_random_uuid(), decode(repeat('17', 32), 'hex'),
      decode('${randomBytes(32).toString("hex")}', 'hex'), 'jcs-v1',
      clock_timestamp(), '${actorId}'
    );
    update public.plans
    set active_version_id = '${ids.version}', updated_at = clock_timestamp()
    where id = '${ids.plan}';
    insert into public.module_results (
      plan_version_id, module, status, confidence, payload, uncertainties
    ) values (
      '${ids.version}', 'nutrition', 'valid', 'high',
      $t17$${payload}$t17$::jsonb, '[]'
    );
    commit;
  `);
  return { planVersionId: ids.version, profileId };
}

function assertIdempotencyReceipt(actorId, profileId, operation, key) {
  const keyDigest = createHash("sha256").update(key).digest("hex");
  const row = runSql(`
    select count(*)::int as receipt_count
    from private.plan_idempotency receipt
    where receipt.actor_id = '${actorId}'
      and receipt.profile_id = '${profileId}'
      and receipt.operation = '${operation}'
      and receipt.key_digest = decode('${keyDigest}', 'hex');
  `)[0];
  assert(row?.receipt_count === 1, "idempotency_receipt_required");
}

async function putPreference(publishableKey, identity, profileId, actorId) {
  const key = randomUUID();
  const body = {
    comparedChains: [],
    expectedVersion: null,
    mode: "single",
    preferredChain: "mercadona",
    schemaVersion: 1,
    sorting: "normalized_price_asc",
  };
  const first = await invoke({
    body,
    functionName: "catalogs",
    idempotencyKey: key,
    method: "PUT",
    path: `/v1/profiles/${profileId}/shopping-preference`,
    publishableKey,
    token: identity.token,
  });
  assert(first.status === 200, "shopping_preference_failed");
  assertIdempotencyReceipt(actorId, profileId, "shopping-preference-put", key);
  const replay = await invoke({
    body,
    functionName: "catalogs",
    idempotencyKey: key,
    method: "PUT",
    path: `/v1/profiles/${profileId}/shopping-preference`,
    publishableKey,
    token: identity.token,
  });
  assert(
    replay.status === 200 &&
      replay.body?.preferenceRevisionId === first.body?.preferenceRevisionId,
    "shopping_preference_replay_failed",
  );
  assertIdempotencyReceipt(actorId, profileId, "shopping-preference-put", key);
  const conflict = await invoke({
    body: { ...body, sorting: "name_asc" },
    functionName: "catalogs",
    idempotencyKey: key,
    method: "PUT",
    path: `/v1/profiles/${profileId}/shopping-preference`,
    publishableKey,
    token: identity.token,
  });
  assert(
    conflict.status === 409 && conflict.body?.error?.code === "IDEMPOTENCY_KEY_REUSED",
    "shopping_preference_conflict_not_rejected",
  );
  return first.body.preferenceRevisionId;
}

async function createSnapshot(
  publishableKey,
  identity,
  planVersionId,
  preferenceRevisionId,
  idempotencyKey = randomUUID(),
) {
  return invoke({
    body: { preferenceRevisionId, schemaVersion: 1 },
    functionName: "catalogs",
    idempotencyKey,
    path: `/v1/plans/${planVersionId}/shopping`,
    publishableKey,
    token: identity.token,
  });
}

async function getSnapshot(publishableKey, identity, snapshotId) {
  return invoke({
    functionName: "catalogs",
    method: "GET",
    path: `/v1/shopping/${snapshotId}`,
    publishableKey,
    token: identity.token,
  });
}

async function mutateSnapshot(publishableKey, identity, snapshotId, segment, body) {
  return invoke({
    body,
    functionName: "catalogs",
    idempotencyKey: randomUUID(),
    path: `/v1/shopping/${snapshotId}/${segment}`,
    publishableKey,
    token: identity.token,
  });
}

function exportConfig(format, snapshotId) {
  return {
    choices: [],
    detail: "complete",
    format,
    includeShopping: true,
    includeWeeklyPreparation: false,
    presentation: "ingredients",
    range: { kind: "week" },
    schemaVersion: 1,
    shoppingSnapshotId: snapshotId,
  };
}

async function createExport(
  publishableKey,
  identity,
  planVersionId,
  format,
  snapshotId,
  idempotencyKey = randomUUID(),
) {
  return invoke({
    body: exportConfig(format, snapshotId),
    functionName: "exports",
    idempotencyKey,
    path: `/v1/plans/${planVersionId}/exports`,
    publishableKey,
    token: identity.token,
  });
}

async function downloadExport(publishableKey, identity, artifactId, format) {
  const response = await fetch(
    `${DEVELOPMENT_URL}/functions/v1/exports/v1/exports/${artifactId}/content`,
    {
      headers: requestHeaders(publishableKey, identity.token),
      method: "GET",
      redirect: "manual",
    },
  );
  assert(response.status === 200, `${format}_download_failed`);
  assertPrivateHeaders(response.headers, `${format}_download`);
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
  assert(bytes.byteLength > 0, `${format}_empty`);
  assert(bytes.byteLength < MAX_ARTIFACT_BYTES, `${format}_too_large`);
  return {
    bytes: bytes.byteLength,
    digest: createHash("sha256").update(bytes).digest("hex"),
  };
}

function seedOneRateLimit(profileId, actorId) {
  runSql(`
    insert into private.shopping_rate_limit_events (
      actor_id, profile_id, operation, key_digest, ip_digest, created_at
    )
    select
      '${actorId}', '${profileId}', 'snapshot-create',
      decode(lpad(to_hex(value), 64, '0'), 'hex'),
      decode(repeat('e1', 32), 'hex'),
      clock_timestamp()
    from generate_series(1, 30) value;
  `);
}

function exportPaths(profileIds) {
  const values = profileIds.map(sqlLiteral).join(",");
  return runSql(`
    select storage_path
    from private.export_artifacts
    where profile_id in (${values}) and storage_deleted_at is null
    order by storage_path;
  `).map((row) => row.storage_path);
}

function cleanupRows(profileIds, actorIds) {
  const profiles = profileIds.map(sqlLiteral).join(",");
  const actors = actorIds.map(sqlLiteral).join(",");
  runSql(`
    begin;
    delete from private.plan_idempotency where profile_id in (${profiles});
    delete from private.export_rate_limit_events where profile_id in (${profiles});
    delete from private.export_artifacts where profile_id in (${profiles});
    delete from private.shopping_rate_limit_events where profile_id in (${profiles});
    delete from public.profile_access where profile_id in (${profiles});
    delete from public.context_snapshot_origins where context_snapshot_id in (
      select id from public.context_snapshots where profile_id in (${profiles})
    );
    update public.plans set active_version_id = null where profile_id in (${profiles});
    delete from public.plans where profile_id in (${profiles});
    delete from public.profiles where id in (${profiles});
    delete from public.device_sessions where actor_id in (${actors});
    delete from public.actors where id in (${actors});
    commit;
  `);
}

async function execute() {
  assertDevelopmentReferences({ requireAll: true });
  assertLinkedDevelopment();
  assert(required("T17_REMOTE_CONFIRM") === REMOTE_CONFIRMATION, "confirmation");
  const aal2Token = required("T17_SUPERADMIN_AAL2_ACCESS_TOKEN");
  assertRecentAal2(aal2Token);
  const publishableKey = required("SUPABASE_PUBLISHABLE_KEY");
  const secretKey = required("SUPABASE_SECRET_KEY");
  const admin = createClient(DEVELOPMENT_URL, secretKey, {
    auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
  });
  const publicClient = createClient(DEVELOPMENT_URL, publishableKey, {
    auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
  });
  const operator = await admin.auth.getUser(aal2Token);
  assert(!operator.error && operator.data.user, "aal2_operator_not_authorized");

  const catalogBefore = publishedCatalogState();
  assert(
    catalogBefore?.mercadona_count === 1 &&
      catalogBefore.mercadona_publishable === true &&
      catalogBefore.mercadona_usable >= 72 &&
      catalogBefore.mercadona_groups_pass === true,
    "mercadona_publication_gate_required",
  );
  const food = compatiblePublishedFood();
  const baseNutrition = await generatedNutrition();
  const identities = [];
  const profileIds = [];
  const actorIds = [];
  let result;
  let failure;
  let cleanupFailure;

  try {
    const identityA = await createIdentity(admin, publishableKey, "a", identities);
    const identityB = await createIdentity(admin, publishableKey, "b", identities);
    const aal1Admin = await invoke({
      functionName: "admin",
      method: "GET",
      path: "/v1/admin/context",
      publishableKey,
      token: identityA.token,
    });
    assert(
      aal1Admin.status === 403 && aal1Admin.body?.error?.code === "AAL2_REQUIRED",
      "aal1_admin_not_rejected",
    );
    const aal2Admin = await invoke({
      functionName: "admin",
      method: "GET",
      path: "/v1/admin/context",
      publishableKey,
      token: aal2Token,
    });
    assert(aal2Admin.status === 200, "aal2_superadmin_not_authorized");
    const recentMfaMutationGuard = await invoke({
      body: {},
      functionName: "admin",
      idempotencyKey: randomUUID(),
      method: "POST",
      path: `/v1/admin/matching-rules/${randomUUID()}/activate`,
      publishableKey,
      token: aal2Token,
    });
    assert(
      recentMfaMutationGuard.status === 400 &&
        recentMfaMutationGuard.body?.error?.code === "INVALID_INPUT",
      "recent_totp_mutation_guard_not_passed",
    );
    const actorA = await createActorSession(admin, identityA, "T17 remote A", actorIds);
    const actorB = await createActorSession(admin, identityB, "T17 remote B", actorIds);
    const profileA = await createProfilePlan(
      admin,
      actorA,
      "Complete",
      nutritionForShopping(baseNutrition, food, false),
      profileIds,
    );
    const profileB = await createProfilePlan(
      admin,
      actorB,
      "Partial",
      nutritionForShopping(baseNutrition, food, true),
      profileIds,
    );
    const nutritionDigestBefore = nutritionDigest(profileA.planVersionId);

    const preferenceA = await putPreference(
      publishableKey,
      identityA,
      profileA.profileId,
      actorA,
    );
    const preferenceB = await putPreference(
      publishableKey,
      identityB,
      profileB.profileId,
      actorB,
    );

    const completeKey = randomUUID();
    const complete = await createSnapshot(
      publishableKey,
      identityA,
      profileA.planVersionId,
      preferenceA,
      completeKey,
    );
    assert(complete.status === 200, "complete_snapshot_failed");
    assertIdempotencyReceipt(
      actorA,
      profileA.profileId,
      "shopping-snapshot-create",
      completeKey,
    );
    const completeReplay = await createSnapshot(
      publishableKey,
      identityA,
      profileA.planVersionId,
      preferenceA,
      completeKey,
    );
    assert(
      completeReplay.status === 200 &&
        completeReplay.body?.snapshotId === complete.body?.snapshotId,
      "snapshot_replay_failed",
    );
    const completeEnvelope = await getSnapshot(
      publishableKey,
      identityA,
      complete.body.snapshotId,
    );
    assert(
      completeEnvelope.status === 200 &&
        completeEnvelope.body?.snapshot?.completeness === "complete",
      "complete_snapshot_not_complete",
    );
    const firstItem = completeEnvelope.body.snapshot.items[0];
    assert(firstItem?.state === "resolved" && firstItem.selected, "resolved_item");

    const partial = await createSnapshot(
      publishableKey,
      identityB,
      profileB.planVersionId,
      preferenceB,
    );
    assert(partial.status === 200, "partial_snapshot_failed");
    const partialEnvelope = await getSnapshot(
      publishableKey,
      identityB,
      partial.body.snapshotId,
    );
    assert(
      partialEnvelope.status === 200 &&
        partialEnvelope.body?.snapshot?.completeness === "partial" &&
        partialEnvelope.body.snapshot.totals.kind === "partial",
      "partial_snapshot_not_partial",
    );

    const crossProfile = await getSnapshot(
      publishableKey,
      identityB,
      complete.body.snapshotId,
    );
    assert([403, 404].includes(crossProfile.status), "cross_profile_snapshot_exposed");

    const leftover = await mutateSnapshot(
      publishableKey,
      identityA,
      complete.body.snapshotId,
      "leftovers",
      {
        action: "set",
        canonicalFoodKey: firstItem.canonicalFoodKey,
        declaredMeasure: { dimension: "mass", quantity: "100", unit: "g" },
        expectedVersion: completeEnvelope.body.snapshot.revision,
        schemaVersion: 1,
      },
    );
    assert(leftover.status === 200, "leftover_mutation_failed");
    const leftoverEnvelope = await getSnapshot(
      publishableKey,
      identityA,
      leftover.body.snapshotId,
    );
    const leftoverItem = leftoverEnvelope.body?.snapshot?.items?.[0];
    assert(
      leftoverItem?.selected?.requiredAfterLeftoverG === "900",
      "leftover_not_applied",
    );

    const alternative = leftoverItem?.alternatives?.find(
      (candidate) =>
        candidate.state === "resolved" &&
        candidate.selection.projection.skuId !== leftoverItem.selected.projection.skuId,
    );
    assert(alternative?.state === "resolved", "manual_alternative_required");
    const manual = await mutateSnapshot(
      publishableKey,
      identityA,
      leftover.body.snapshotId,
      "product-selection",
      {
        canonicalFoodKey: leftoverItem.canonicalFoodKey,
        expectedVersion: leftoverEnvelope.body.snapshot.revision,
        schemaVersion: 1,
        skuId: alternative.selection.projection.skuId,
      },
    );
    assert(manual.status === 200, "manual_selection_failed");
    const activeEnvelope = await getSnapshot(
      publishableKey,
      identityA,
      manual.body.snapshotId,
    );
    assert(
      activeEnvelope.body?.snapshot?.items?.[0]?.selectionOrigin === "manual",
      "manual_selection_not_preserved",
    );
    assert(
      activeEnvelope.body?.snapshot?.items?.[0]?.selected?.projection?.skuId ===
        alternative.selection.projection.skuId,
      "manual_alternative_not_selected",
    );
    const archivedEnvelope = await getSnapshot(
      publishableKey,
      identityA,
      complete.body.snapshotId,
    );
    assert(
      archivedEnvelope.status === 200 &&
        archivedEnvelope.body?.lifecycle?.status === "archived",
      "historical_snapshot_not_archived",
    );

    const exportKey = randomUUID();
    const pdf = await createExport(
      publishableKey,
      identityA,
      profileA.planVersionId,
      "pdf",
      manual.body.snapshotId,
      exportKey,
    );
    assert(pdf.status === 200, "active_pdf_export_failed");
    assertIdempotencyReceipt(actorA, profileA.profileId, "export-create", exportKey);
    const pdfReplay = await createExport(
      publishableKey,
      identityA,
      profileA.planVersionId,
      "pdf",
      manual.body.snapshotId,
      exportKey,
    );
    assert(
      pdfReplay.status === 200 && pdfReplay.body?.artifactId === pdf.body?.artifactId,
      "export_replay_failed",
    );
    const xlsx = await createExport(
      publishableKey,
      identityA,
      profileA.planVersionId,
      "xlsx",
      manual.body.snapshotId,
    );
    assert(xlsx.status === 200, "active_xlsx_export_failed");
    const archivedPdf = await createExport(
      publishableKey,
      identityA,
      profileA.planVersionId,
      "pdf",
      complete.body.snapshotId,
    );
    assert(archivedPdf.status === 200, "archived_pdf_export_failed");
    const archivedXlsx = await createExport(
      publishableKey,
      identityA,
      profileA.planVersionId,
      "xlsx",
      complete.body.snapshotId,
    );
    assert(archivedXlsx.status === 200, "archived_xlsx_export_failed");
    const pdfEvidence = await downloadExport(
      publishableKey,
      identityA,
      pdf.body.artifactId,
      "pdf",
    );
    const xlsxEvidence = await downloadExport(
      publishableKey,
      identityA,
      xlsx.body.artifactId,
      "xlsx",
    );
    await downloadExport(publishableKey, identityA, archivedPdf.body.artifactId, "pdf");
    await downloadExport(
      publishableKey,
      identityA,
      archivedXlsx.body.artifactId,
      "xlsx",
    );
    const direct = await publicClient.storage
      .from(BUCKET)
      .download(`${profileA.profileId}/${pdf.body.artifactId}.pdf`);
    assert(direct.error && !direct.data, "private_object_publicly_downloadable");

    const crossProfileExport = await createExport(
      publishableKey,
      identityB,
      profileA.planVersionId,
      "pdf",
      manual.body.snapshotId,
    );
    assert([403, 404].includes(crossProfileExport.status), "cross_profile_export");

    seedOneRateLimit(profileB.profileId, actorB);
    const limited = await createSnapshot(
      publishableKey,
      identityB,
      profileB.planVersionId,
      preferenceB,
    );
    assert(
      limited.status === 429 &&
        limited.body?.error?.code === "RATE_LIMITED" &&
        Number(limited.headers.get("retry-after")) > 0,
      "controlled_rate_limit_failed",
    );
    assert(
      nutritionDigest(profileA.planVersionId) === nutritionDigestBefore,
      "nutrition_changed_during_shopping",
    );

    result = {
      activeAndArchivedExported: true,
      aal1RejectedBeforeAdminAccess: true,
      aal2TotpRecent: true,
      aal2SuperadminAuthorized: true,
      completeSnapshots: 1,
      crossProfileRejected: true,
      idempotencyConflictRejected: true,
      idempotencyReused: true,
      manualSelectionApplied: true,
      multistore: "NOT_APPLICABLE_REMOTE_ONLY_ONE_CHAIN_PUBLISHED",
      partialSnapshots: 1,
      pdfBytes: pdfEvidence.bytes,
      pdfDigest: pdfEvidence.digest,
      privateStorageConfirmed: true,
      rateLimitedRequests: 1,
      nutritionInvariant: true,
      historicalPublication: "NOT_APPLICABLE_WITHOUT_SAFE_PUBLICATION_CHANGE",
      fullRestoreT18: "NOT_IMPLEMENTED",
      status: "T17_REMOTE_SMOKE_PASS",
      xlsxBytes: xlsxEvidence.bytes,
      xlsxDigest: xlsxEvidence.digest,
    };
  } catch (error) {
    failure = error;
  } finally {
    const cleanupErrors = [];
    let storagePaths = [];
    const attempt = async (operation) => {
      try {
        await operation();
      } catch (error) {
        cleanupErrors.push(error);
      }
    };
    await attempt(async () => {
      if (profileIds.length > 0) {
        storagePaths = exportPaths(profileIds);
      }
    });
    await attempt(async () => {
      if (storagePaths.length > 0) {
        const removed = await admin.storage.from(BUCKET).remove(storagePaths);
        assert(!removed.error, "private_object_cleanup_failed");
      }
    });
    await attempt(async () => {
      if (profileIds.length > 0) {
        cleanupRows(profileIds, actorIds);
      } else if (actorIds.length > 0) {
        const actors = actorIds.map(sqlLiteral).join(",");
        runSql(`
          delete from public.device_sessions where actor_id in (${actors});
          delete from public.actors where id in (${actors});
        `);
      }
    });
    await attempt(async () => {
      if (storagePaths.length > 0) {
        const removed = await admin.storage.from(BUCKET).remove(storagePaths);
        assert(!removed.error, "private_object_cleanup_replay_failed");
      }
      if (profileIds.length > 0) {
        cleanupRows(profileIds, actorIds);
      } else if (actorIds.length > 0) {
        const actors = actorIds.map(sqlLiteral).join(",");
        runSql(`
          delete from public.device_sessions where actor_id in (${actors});
          delete from public.actors where id in (${actors});
        `);
      }
    });
    for (const identity of identities) {
      await attempt(async () => {
        const deleted = await admin.auth.admin.deleteUser(identity.userId);
        assert(!deleted.error, "temporary_auth_user_cleanup_failed");
        if (identity.auth) {
          await identity.auth.auth.signOut({ scope: "local" });
        }
      });
    }
    await attempt(async () => {
      const counts = [];
      if (profileIds.length > 0) {
        const profiles = profileIds.map(sqlLiteral).join(",");
        counts.push(
          `(select count(*) from public.profiles where id in (${profiles}))`,
          `(select count(*) from private.export_artifacts where profile_id in (${profiles}))`,
          `(select count(*) from public.shopping_snapshots where profile_id in (${profiles}))`,
          `(select count(*) from public.shopping_preference_revisions where profile_id in (${profiles}))`,
          `(select count(*) from public.shopping_leftover_confirmations where profile_id in (${profiles}))`,
          `(select count(*) from public.shopping_product_selection_confirmations where profile_id in (${profiles}))`,
          `(select count(*) from private.plan_idempotency where profile_id in (${profiles}))`,
          `(select count(*) from private.export_rate_limit_events where profile_id in (${profiles}))`,
          `(select count(*) from private.shopping_rate_limit_events where profile_id in (${profiles}))`,
          `(select count(*) from storage.objects where bucket_id = '${BUCKET}' and split_part(name, '/', 1) in (${profiles}))`,
        );
      }
      if (actorIds.length > 0) {
        const actors = actorIds.map(sqlLiteral).join(",");
        counts.push(
          `(select count(*) from public.device_sessions where actor_id in (${actors}))`,
          `(select count(*) from public.actors where id in (${actors}))`,
        );
      }
      if (identities.length > 0) {
        const users = identities
          .map((identity) => sqlLiteral(identity.userId))
          .join(",");
        counts.push(`(select count(*) from auth.users where id in (${users}))`);
      }
      if (counts.length > 0) {
        const remaining = runSql(`
          select (${counts.join(" + ")})::int as remaining_count;
        `)[0];
        assert(remaining?.remaining_count === 0, "remote_fixture_rows_remained");
      }
      const catalogAfter = publishedCatalogState();
      assert(
        catalogAfter?.publication_count === catalogBefore.publication_count &&
          catalogAfter?.catalog_state_digest === catalogBefore.catalog_state_digest &&
          catalogAfter?.mercadona_count === catalogBefore.mercadona_count &&
          catalogAfter?.mercadona_publishable === catalogBefore.mercadona_publishable &&
          catalogAfter?.mercadona_usable === catalogBefore.mercadona_usable &&
          catalogAfter?.mercadona_groups_pass === catalogBefore.mercadona_groups_pass,
        "global_catalog_changed",
      );
    });
    if (cleanupErrors.length === 1) {
      cleanupFailure = cleanupErrors[0];
    } else if (cleanupErrors.length > 1) {
      cleanupFailure = new AggregateError(cleanupErrors, "remote_cleanup_failed");
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

async function main() {
  const [requestedMode, ...extra] = process.argv.slice(2);
  const mode = requestedMode ?? "--dry-run";
  if (extra.length > 0 || !["--dry-run", "--execute"].includes(mode)) {
    throw new Error("usage: supermarket-catalog-remote-smoke.mjs --dry-run|--execute");
  }
  if (mode === "--dry-run") {
    printPlan();
    return;
  }
  await execute();
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : "";
  const code = /^[a-z][a-z0-9_]{0,63}$/.test(message) ? message : "unexpected_failure";
  process.stderr.write(`t17_remote_smoke=${code}\n`);
  process.exitCode = 1;
});
