import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";

import { createClient } from "@supabase/supabase-js";
import { GENERATOR_METADATA_BY_FOOD_KEY } from "@health-design/catalog/nutrition-generator";

const DEVELOPMENT_URL = "https://nwoivdxdupklervtnovd.supabase.co";
const DEVELOPMENT_CAPTCHA_TOKEN = "XXXX.DUMMY.TOKEN.XXXX";

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`missing_${name.toLowerCase()}`);
  return value;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function preflightGeneratorCore(batches) {
  const revisions = batches.flatMap((batch) => batch.revisions);
  assert(
    new Set(revisions.map(({ canonicalFoodKey }) => canonicalFoodKey)).size ===
      revisions.length,
    "nutrition_duplicate_canonical_food_key",
  );
  const verifiedKeys = revisions.map((revision) => {
    const metadata = GENERATOR_METADATA_BY_FOOD_KEY.get(revision.canonicalFoodKey);
    assert(metadata, `nutrition_metadata_missing_${revision.canonicalFoodKey}`);
    assert(
      metadata.sourceKey === revision.sourceKey &&
        metadata.sourceVersion === revision.sourceVersion,
      `nutrition_source_mismatch_${revision.canonicalFoodKey}`,
    );
    for (const key of ["carbohydrates", "energy_kcal", "fat", "fiber", "protein"]) {
      const observation = revision.nutrients[key];
      assert(
        observation?.state === "known" &&
          typeof observation.normalizedValue === "string",
        `nutrition_required_nutrient_invalid_${revision.canonicalFoodKey}_${key}`,
      );
    }
    return revision.canonicalFoodKey;
  });
  assert(
    verifiedKeys.length === GENERATOR_METADATA_BY_FOOD_KEY.size,
    "nutrition_generator_core_count_mismatch",
  );
  const verifiedKeySet = new Set(verifiedKeys);
  for (const key of GENERATOR_METADATA_BY_FOOD_KEY.keys()) {
    assert(verifiedKeySet.has(key), `nutrition_generator_core_missing_${key}`);
  }
  return {
    catalogFoods: verifiedKeys.length,
    requiredNutrientObservations: verifiedKeys.length * 5,
  };
}

async function responseJson(response) {
  return {
    body: await response.json().catch(() => ({})),
    status: response.status,
  };
}

async function main() {
  const batchPaths = (
    process.env.NUTRITION_BATCH_PATHS ?? required("CIQUAL_BATCH_PATH")
  )
    .split(",")
    .map((path) => path.trim())
    .filter(Boolean);
  assert(batchPaths.length > 0, "nutrition_batch_paths_empty");
  const batches = await Promise.all(
    batchPaths.map(async (path) => JSON.parse(await readFile(path, "utf8"))),
  );
  for (const batch of batches) {
    assert(batch?.status === "quarantined", "nutrition_batch_not_quarantined");
    assert(batch?.manifest?.sourceKey, "nutrition_source_required");
    assert(batch?.manifest?.sourceVersion, "nutrition_source_version_required");
    assert(Array.isArray(batch.revisions) && batch.revisions.length > 0, "empty_batch");
  }
  assert(
    new Set(batches.map(({ manifest }) => manifest.id)).size === batches.length,
    "nutrition_duplicate_manifest",
  );
  const preflight = preflightGeneratorCore(batches);
  if (process.argv.includes("--preflight")) {
    process.stdout.write(
      `${JSON.stringify(
        {
          generatorPreflightFoods: preflight.catalogFoods,
          requiredNutrientObservations: preflight.requiredNutrientObservations,
          manifestImportKeys: batches.map(({ manifest }) => manifest.id),
          sources: batches.map(({ manifest, revisions }) => ({
            key: manifest.sourceKey,
            records: revisions.length,
            version: manifest.sourceVersion,
          })),
          status: "T17_NUTRITION_CORE_PREFLIGHT_PASS",
        },
        null,
        2,
      )}\n`,
    );
    return;
  }

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
  if (signIn.error || !signIn.data.session) {
    throw new Error("superadmin_sign_in_failed");
  }
  let token = signIn.data.session.access_token;

  const invoke = async (path, body) =>
    responseJson(
      await fetch(`${url}/functions/v1/catalogs${path}`, {
        body: JSON.stringify(body),
        headers: {
          apikey: publishableKey,
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
          "idempotency-key": randomUUID(),
          origin: "https://task-02-environments.health-design.pages.dev",
        },
        method: "POST",
      }),
    );

  try {
    const listed = await auth.auth.mfa.listFactors();
    const factor = listed.data?.totp.find(({ status }) => status === "verified");
    if (listed.error || !factor) throw new Error("verified_totp_factor_missing");
    const challenge = await auth.auth.mfa.challenge({ factorId: factor.id });
    if (challenge.error) throw new Error("totp_challenge_failed");
    const verification = await auth.auth.mfa.verify({
      challengeId: challenge.data.id,
      code: totpCode,
      factorId: factor.id,
    });
    if (verification.error || !verification.data?.access_token) {
      throw new Error("totp_verification_failed");
    }
    token = verification.data.access_token;

    const activatedManifests = [];
    const activatedRevisionIds = [];
    for (const batch of batches) {
      let manifest = await inspector
        .from("nutrition_source_manifests")
        .select("id,import_key,status")
        .eq("import_key", batch.manifest.id)
        .maybeSingle();
      if (manifest.error) throw new Error("manifest_lookup_failed");
      if (!manifest.data) {
        const staged = await invoke("/v1/admin/nutrition/imports", batch);
        assert(staged.status === 201, `nutrition_stage_failed_${staged.status}`);
        manifest = await inspector
          .from("nutrition_source_manifests")
          .select("id,import_key,status")
          .eq("id", staged.body.manifest_id)
          .single();
        if (manifest.error || !manifest.data) {
          throw new Error("staged_manifest_missing");
        }
      }

      let revisions = await inspector
        .from("food_composition_revisions")
        .select("id,import_key,status")
        .eq("source_manifest_id", manifest.data.id)
        .order("import_key", { ascending: true });
      if (revisions.error || !revisions.data) {
        throw new Error("revision_lookup_failed");
      }
      assert(
        revisions.data.length === batch.revisions.length,
        "revision_count_mismatch",
      );

      for (const revision of revisions.data) {
        if (revision.status !== "quarantined") continue;
        const validated = await invoke(
          `/v1/admin/nutrition/revisions/${revision.id}/validate`,
          {
            justification: `${batch.manifest.sourceKey} ${batch.manifest.sourceVersion}; fuente oficial seleccionada y cinco nutrientes obligatorios normalizados`,
          },
        );
        assert(validated.status === 200, `nutrition_validation_failed_${revision.id}`);
      }

      revisions = await inspector
        .from("food_composition_revisions")
        .select("id,import_key,status")
        .eq("source_manifest_id", manifest.data.id)
        .order("import_key", { ascending: true });
      if (revisions.error || !revisions.data) {
        throw new Error("revision_refresh_failed");
      }
      assert(
        revisions.data.every(({ status }) => status === "validated"),
        "not_all_revisions_validated",
      );

      const batchByImportKey = new Map(
        batch.revisions.map((revision) => [revision.id, revision]),
      );
      for (const revision of revisions.data) {
        const source = batchByImportKey.get(revision.import_key);
        assert(source, `batch_revision_missing_${revision.import_key}`);
        const activated = await invoke(
          `/v1/admin/nutrition/revisions/${revision.id}/activate`,
          {
            precedenceReason:
              "Fuente oficial seleccionada para la identidad canónica del núcleo generador V1",
            resolutionContext: {
              basis: source.basis,
              ediblePart: source.ediblePart,
              foodState: source.foodState,
              method: source.method,
            },
          },
        );
        assert(activated.status === 200, `nutrition_activation_failed_${revision.id}`);
      }
      activatedRevisionIds.push(...revisions.data.map(({ id }) => id));
      activatedManifests.push({
        id: manifest.data.id,
        importKey: batch.manifest.id,
        normalizedContentHash: batch.manifest.normalizedContentHash,
        rawContentHash: batch.manifest.rawContentHash,
        sourceKey: batch.manifest.sourceKey,
        sourceVersion: batch.manifest.sourceVersion,
      });
    }

    const effective = await inspector
      .from("effective_food_revisions")
      .select("id,revision_id,superseded_at")
      .in("revision_id", activatedRevisionIds)
      .is("superseded_at", null);
    if (effective.error || !effective.data) throw new Error("effective_lookup_failed");
    assert(
      effective.data.length === activatedRevisionIds.length,
      "effective_count_mismatch",
    );

    const readable = await inspector.rpc(
      "internal_nutrition_effective_generator_catalog",
    );
    if (readable.error || !Array.isArray(readable.data)) {
      throw new Error("generator_catalog_rpc_failed");
    }
    const expectedKeys = new Set(
      batches.flatMap(({ revisions }) =>
        revisions.map(({ canonicalFoodKey }) => canonicalFoodKey),
      ),
    );
    const readableKeys = new Set(
      readable.data.map(({ canonicalFoodKey }) => canonicalFoodKey),
    );
    assert(
      [...expectedKeys].every((key) => readableKeys.has(key)),
      "generator_catalog_incomplete",
    );

    process.stdout.write(
      `${JSON.stringify(
        {
          activatedRevisions: effective.data.length,
          generatorPreflightFoods: preflight.catalogFoods,
          requiredNutrientObservations: preflight.requiredNutrientObservations,
          generatorReadableFoods: readable.data.length,
          manifests: activatedManifests,
          status: "T17_NUTRITION_CORE_REMOTE_PASS",
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
