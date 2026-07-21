import { createClient } from "@supabase/supabase-js";
import { sha256CanonicalJson } from "@health-design/engine";

import {
  handleNutritionCatalog,
  type NutritionCatalogDependencies,
} from "./nutrition.ts";
import {
  fetchOpenFoodFactsProduct,
  handleProductCatalog,
  type ProductCatalogDependencies,
} from "./products.ts";

function runtimeValue(name: string): string | undefined {
  const deno = (
    globalThis as typeof globalThis & {
      Deno?: { env?: { get(key: string): string | undefined } };
    }
  ).Deno;
  return deno?.env?.get(name);
}

function secret(name: string, fallback?: string): string {
  const value = runtimeValue(name) ?? fallback;
  if (!value) throw new Error(`missing_${name.toLowerCase()}`);
  return value;
}

function dependencies(): NutritionCatalogDependencies & ProductCatalogDependencies {
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
      const { data, error } = await authClient.auth.getClaims(token);
      const claims = data?.claims as Record<string, unknown> | undefined;
      if (
        error ||
        !claims ||
        typeof claims.sub !== "string" ||
        typeof claims.session_id !== "string"
      ) {
        throw new Error("unauthenticated");
      }
      return {
        aal: claims.aal === "aal2" ? "aal2" : "aal1",
        sessionId: claims.session_id,
        userId: claims.sub,
      };
    },
    environment,
    fetchOpenFoodFacts: (gtin) => {
      const userAgent = runtimeValue("OPEN_FOOD_FACTS_USER_AGENT");
      return fetchOpenFoodFactsProduct(gtin, userAgent ? { userAgent } : {});
    },
    hashCanonical: sha256CanonicalJson,
    rpc: async (name, args) => {
      const result: unknown = await serviceClient.rpc(name as never, args as never);
      const { data, error } = result as {
        data: unknown;
        error: { code?: string; message?: string } | null;
      };
      return { data, error };
    },
  };
}

export default {
  fetch(request: Request) {
    const currentDependencies = dependencies();
    return new URL(request.url).pathname.includes("/products/barcode/")
      ? handleProductCatalog(request, currentDependencies)
      : handleNutritionCatalog(request, currentDependencies);
  },
};
