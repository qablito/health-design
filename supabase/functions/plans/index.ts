import { createClient } from "@supabase/supabase-js";
import { runDeterministicEngine } from "@health-design/engine";

import {
  handleQuestionnaire,
  type QuestionnaireDependencies,
} from "./questionnaire.ts";
import { handlePlanLifecycle, type PlanLifecycleDependencies } from "./lifecycle.ts";
import { hydrateEffectiveNutritionCatalog } from "./nutrition-catalog.ts";

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

function dependencies(): QuestionnaireDependencies & PlanLifecycleDependencies {
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
      const result: unknown = await serviceClient.rpc(
        "internal_nutrition_effective_generator_catalog" as never,
      );
      const { data, error } = result as {
        data: unknown;
        error: { code?: string; message?: string } | null;
      };
      if (error) throw new Error("effective_nutrition_catalog_unavailable");
      return runDeterministicEngine({
        ...input,
        nutritionCatalog: hydrateEffectiveNutritionCatalog(data),
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

export default {
  fetch(request: Request) {
    const current = dependencies();
    return isQuestionnaireRoute(request)
      ? handleQuestionnaire(request, current)
      : handlePlanLifecycle(request, current);
  },
};
