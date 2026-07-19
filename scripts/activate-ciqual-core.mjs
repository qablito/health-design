import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";

import { createClient } from "@supabase/supabase-js";
import { GENERATOR_METADATA_BY_FOOD_KEY } from "@health-design/catalog/nutrition-generator";
import { generateNutritionWeek } from "@health-design/engine";

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

function preflightGeneratorCore(batch) {
  const manifestId = "93000000-0000-4000-8000-000000000001";
  const catalog = batch.revisions.map((revision, index) => {
    const metadata = GENERATOR_METADATA_BY_FOOD_KEY.get(revision.canonicalFoodKey);
    assert(metadata, `ciqual_metadata_missing_${revision.canonicalFoodKey}`);
    const nutrient = (key) => {
      const observation = revision.nutrients[key];
      assert(
        observation?.state === "known" &&
          typeof observation.normalizedValue === "string",
        `ciqual_required_nutrient_invalid_${revision.canonicalFoodKey}_${key}`,
      );
      return observation.normalizedValue;
    };
    return {
      ...metadata,
      clinicalNutrients: Object.fromEntries(
        [
          ["calcium", "mg"],
          ["folate", "ug"],
          ["iron", "mg"],
          ["iodine", "ug"],
          ["magnesium", "mg"],
          ["potassium", "mg"],
          ["salt", "g"],
          ["saturated_fat", "g"],
          ["selenium", "ug"],
          ["sodium", "mg"],
          ["sugars", "g"],
          ["vitamin_b12", "ug"],
          ["vitamin_c", "mg"],
          ["zinc", "mg"],
        ].flatMap(([key, unit]) => {
          const observation = revision.nutrients[key];
          return observation?.state === "known" &&
            typeof observation.normalizedValue === "string"
            ? [[key, { unit, value: observation.normalizedValue }]]
            : [];
        }),
      ),
      manifestId,
      nutrients: {
        carbohydratesG: nutrient("carbohydrates"),
        energyKcal: nutrient("energy_kcal"),
        fatG: nutrient("fat"),
        fiberG: nutrient("fiber"),
        proteinG: nutrient("protein"),
      },
      revisionId: `94000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
      sourceKey: revision.sourceKey,
      sourceVersion: revision.sourceVersion,
    };
  });
  const baseAnswers = {
    activeModules: ["nutrition"],
    activityLevel: "moderate",
    age: 35,
    country: "ES",
    hasConditions: false,
    hasMedications: false,
    heightCm: 178,
    nutritionAllergiesStatus: "none",
    nutritionFoodAnxiety: "no",
    nutritionIntolerancesStatus: "none",
    nutritionMode: "balanced",
    physiologicalSex: "male",
    primaryObjective: "body_composition_maintain",
    proteinPreference: "food_only",
    trainingMode: "none",
    weightKg: 80,
  };
  let generatedPlans = 0;
  for (const dietaryPattern of ["omnivore", "pescetarian", "vegetarian", "vegan"]) {
    for (const mealsPerDay of [2, 4, 6]) {
      const plan = generateNutritionWeek({
        answers: { ...baseAnswers, dietaryPattern, mealsPerDay },
        catalog,
      });
      assert(
        plan.validation.status === "valid",
        `ciqual_generator_preflight_failed_${dietaryPattern}_${mealsPerDay}`,
      );
      generatedPlans += 1;
    }
  }
  return { catalogFoods: catalog.length, generatedPlans };
}

async function responseJson(response) {
  return {
    body: await response.json().catch(() => ({})),
    status: response.status,
  };
}

async function main() {
  const batchPath = required("CIQUAL_BATCH_PATH");
  const batch = JSON.parse(await readFile(batchPath, "utf8"));
  assert(batch?.status === "quarantined", "ciqual_batch_not_quarantined");
  assert(batch?.manifest?.sourceKey === "ciqual_2025", "ciqual_source_required");
  assert(batch?.manifest?.sourceVersion === "2025", "ciqual_2025_required");
  assert(Array.isArray(batch.revisions) && batch.revisions.length > 0, "empty_batch");
  const preflight = preflightGeneratorCore(batch);
  if (process.argv.includes("--preflight")) {
    process.stdout.write(
      `${JSON.stringify(
        {
          generatorPreflightFoods: preflight.catalogFoods,
          generatorPreflightPlans: preflight.generatedPlans,
          manifestImportKey: batch.manifest.id,
          status: "T10_CIQUAL_CORE_PREFLIGHT_PASS",
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

    let manifest = await inspector
      .from("nutrition_source_manifests")
      .select("id,import_key,status")
      .eq("import_key", batch.manifest.id)
      .maybeSingle();
    if (manifest.error) throw new Error("manifest_lookup_failed");
    if (!manifest.data) {
      const staged = await invoke("/v1/admin/nutrition/imports", batch);
      assert(staged.status === 201, `ciqual_stage_failed_${staged.status}`);
      manifest = await inspector
        .from("nutrition_source_manifests")
        .select("id,import_key,status")
        .eq("id", staged.body.manifest_id)
        .single();
      if (manifest.error || !manifest.data) throw new Error("staged_manifest_missing");
    }

    let revisions = await inspector
      .from("food_composition_revisions")
      .select("id,import_key,status")
      .eq("source_manifest_id", manifest.data.id)
      .order("import_key", { ascending: true });
    if (revisions.error || !revisions.data) throw new Error("revision_lookup_failed");
    assert(revisions.data.length === batch.revisions.length, "revision_count_mismatch");

    for (const revision of revisions.data) {
      if (revision.status !== "quarantined") continue;
      const validated = await invoke(
        `/v1/admin/nutrition/revisions/${revision.id}/validate`,
        {
          justification:
            "CIQUAL 2025 oficial; digest verificado y cinco nutrientes obligatorios exactos",
        },
      );
      assert(validated.status === 200, `ciqual_validation_failed_${revision.id}`);
    }

    revisions = await inspector
      .from("food_composition_revisions")
      .select("id,import_key,status")
      .eq("source_manifest_id", manifest.data.id)
      .order("import_key", { ascending: true });
    if (revisions.error || !revisions.data) throw new Error("revision_refresh_failed");
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
            "CIQUAL 2025 es la fuente oficial prioritaria del núcleo generador V1",
          resolutionContext: {
            basis: source.basis,
            ediblePart: source.ediblePart,
            foodState: source.foodState,
            method: source.method,
          },
        },
      );
      assert(activated.status === 200, `ciqual_activation_failed_${revision.id}`);
    }

    const effective = await inspector
      .from("effective_food_revisions")
      .select("id,revision_id,superseded_at")
      .in(
        "revision_id",
        revisions.data.map(({ id }) => id),
      )
      .is("superseded_at", null);
    if (effective.error || !effective.data) throw new Error("effective_lookup_failed");
    assert(effective.data.length === revisions.data.length, "effective_count_mismatch");

    const readable = await inspector.rpc(
      "internal_nutrition_effective_generator_catalog",
    );
    if (readable.error || !Array.isArray(readable.data)) {
      throw new Error("generator_catalog_rpc_failed");
    }
    const expectedKeys = new Set(
      batch.revisions.map(({ canonicalFoodKey }) => canonicalFoodKey),
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
          generatorPreflightPlans: preflight.generatedPlans,
          generatorPreflightFoods: preflight.catalogFoods,
          generatorReadableFoods: readable.data.length,
          manifestId: manifest.data.id,
          manifestImportKey: batch.manifest.id,
          normalizedContentHash: batch.manifest.normalizedContentHash,
          rawContentHash: batch.manifest.rawContentHash,
          source: "ciqual_2025",
          sourceVersion: "2025",
          status: "T10_CIQUAL_CORE_REMOTE_PASS",
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
