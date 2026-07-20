import { createClient } from "@supabase/supabase-js";
import { runDeterministicEngine, sha256CanonicalJson } from "@health-design/engine";

import {
  handleQuestionnaire,
  type QuestionnaireDependencies,
} from "./questionnaire.ts";
import { handlePlanLifecycle, type PlanLifecycleDependencies } from "./lifecycle.ts";
import { hydrateActiveClinicalCatalog } from "./clinical-catalog.ts";
import { hydrateCanonicalMedicationIdentities } from "./medication-identities.ts";
import { hydrateEffectiveNutritionCatalog } from "./nutrition-catalog.ts";
import {
  handleAIExplanation,
  handleAIProviderAdmin,
  type AIExplanationDependencies,
} from "./explanation.ts";
import { createOpenAIProviderCaller } from "./openai-provider.ts";

function secret(name: string, fallback?: string): string {
  const value = runtimeValue(name) ?? fallback;
  if (!value) throw new Error(`missing_${name.toLowerCase()}`);
  return value;
}

function runtimeValue(name: string): string | undefined {
  const deno = (
    globalThis as typeof globalThis & {
      Deno?: { env?: { get(key: string): string | undefined } };
    }
  ).Deno;
  return deno?.env?.get(name);
}

function decodeSessionId(token: string): string {
  const payload = token.split(".")[1];
  if (!payload) throw new Error("invalid_token");
  const base64 = payload.replaceAll("-", "+").replaceAll("_", "/");
  const decoded = JSON.parse(
    atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "=")),
  ) as Record<string, unknown>;
  if (typeof decoded.session_id !== "string") throw new Error("missing_session");
  return decoded.session_id;
}

function dependencies(): QuestionnaireDependencies &
  PlanLifecycleDependencies &
  AIExplanationDependencies {
  const url = secret("SUPABASE_URL");
  const publishableKey =
    runtimeValue("SUPABASE_PUBLISHABLE_KEY") ?? secret("SUPABASE_ANON_KEY");
  const authClient = createClient(url, publishableKey, {
    auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
  });
  const serviceClient = createClient(url, secret("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
  });
  const environment = secret("APP_ENV", "local");
  if (
    environment !== "local" &&
    environment !== "development" &&
    environment !== "production"
  ) {
    throw new Error("invalid_environment");
  }
  return {
    authenticate: async (token) => {
      const { data, error } = await authClient.auth.getUser(token);
      if (error || !data.user) throw new Error("unauthenticated");
      return { sessionId: decodeSessionId(token), userId: data.user.id };
    },
    callProvider: createOpenAIProviderCaller(() => secret("OPENAI_API_KEY")),
    environment,
    now: () => new Date(),
    randomUUID: () => crypto.randomUUID(),
    rpc: async (name, args) => {
      const result: unknown = await serviceClient.rpc(name as never, args as never);
      const { data, error } = result as {
        data: unknown;
        error: { code?: string; message?: string } | null;
      };
      return { data, error };
    },
    runEngine: async (input) => {
      const requestedAempsIds = new Set(
        (input.context.answers.medications ?? []).flatMap(({ aempsId }) =>
          aempsId ? [aempsId] : [],
        ),
      );
      const rpcData = async (
        name: string,
        args?: Record<string, unknown>,
      ): Promise<unknown> => {
        const result: unknown = await serviceClient.rpc(name as never, args as never);
        const { data, error } = result as {
          data: unknown;
          error: { code?: string; message?: string } | null;
        };
        if (error) throw new Error(`${name}_unavailable`);
        return data;
      };
      const [nutritionData, clinicalData, medicationData] = await Promise.all([
        rpcData("internal_nutrition_effective_generator_catalog"),
        rpcData("internal_clinical_rule_catalog_active"),
        requestedAempsIds.size === 0
          ? Promise.resolve([])
          : rpcData("internal_clinical_medication_identities_resolve", {
              p_aemps_ids: [...requestedAempsIds],
            }),
      ]);
      return runDeterministicEngine({
        ...input,
        canonicalMedicationIdentities: hydrateCanonicalMedicationIdentities(
          medicationData,
          requestedAempsIds,
        ),
        clinicalCatalogDescriptor: await hydrateActiveClinicalCatalog(
          clinicalData,
          sha256CanonicalJson,
        ),
        nutritionCatalog: hydrateEffectiveNutritionCatalog(nutritionData),
      });
    },
  };
}

function isQuestionnaireRoute(request: Request): boolean {
  const url = new URL(request.url);
  const versionIndex = url.pathname.lastIndexOf("/v1/");
  if (versionIndex < 0) return false;
  const path = url.pathname.slice(versionIndex);
  return (
    path === "/v1/questionnaire/schema" ||
    /^\/v1\/profiles\/[0-9a-f-]+\/draft(?:\/submit)?$/i.test(path)
  );
}

function isExplanationRoute(request: Request): boolean {
  const url = new URL(request.url);
  const versionIndex = url.pathname.lastIndexOf("/v1/");
  if (versionIndex < 0) return false;
  return /^\/v1\/plans\/[0-9a-f-]+\/explanation$/i.test(
    url.pathname.slice(versionIndex),
  );
}

function isAIAdminRoute(request: Request): boolean {
  const url = new URL(request.url);
  const versionIndex = url.pathname.lastIndexOf("/v1/");
  if (versionIndex < 0) return false;
  return /^\/v1\/admin\/ai-provider-revisions\/[0-9a-f-]+\/activate$/i.test(
    url.pathname.slice(versionIndex),
  );
}

export default {
  fetch(request: Request) {
    const current = dependencies();
    if (isQuestionnaireRoute(request)) return handleQuestionnaire(request, current);
    if (isAIAdminRoute(request)) return handleAIProviderAdmin(request, current);
    if (isExplanationRoute(request)) return handleAIExplanation(request, current);
    return handlePlanLifecycle(request, current);
  },
};
