import { createClient } from "@supabase/supabase-js";
import { sha256CanonicalJson } from "@health-design/engine";
import { resolveShopping } from "@health-design/engine/shopping";

import { hmacSha256Hex } from "../_shared/access-security.ts";
import {
  handleNutritionCatalog,
  type NutritionCatalogDependencies,
} from "./nutrition.ts";
import {
  fetchOpenFoodFactsProduct,
  handleProductCatalog,
  type ProductCatalogDependencies,
} from "./products.ts";
import {
  createCatalogConcurrencyGuard,
  handleShoppingCatalog,
  type ShoppingEdgeDependencies,
} from "./shopping.ts";

const shoppingCatalogGuard = createCatalogConcurrencyGuard(4);

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

function dependencies(): NutritionCatalogDependencies &
  ProductCatalogDependencies &
  ShoppingEdgeDependencies {
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
    catalogGuard: shoppingCatalogGuard,
    digestIp: (ip) => hmacSha256Hex(ip, secret("ACCESS_RATE_LIMIT_PEPPER")),
    fetchOpenFoodFacts: (gtin) => {
      const userAgent = runtimeValue("OPEN_FOOD_FACTS_USER_AGENT");
      return fetchOpenFoodFactsProduct(gtin, userAgent ? { userAgent } : {});
    },
    hashCanonical: sha256CanonicalJson,
    now: () => new Date().toISOString(),
    randomUUID: () => crypto.randomUUID(),
    resolveShopping,
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
    const pathname = new URL(request.url).pathname;
    if (
      pathname.includes("/v1/catalogs") ||
      pathname.includes("/shopping-preference") ||
      /\/v1\/plans\/[0-9a-f-]{36}\/shopping$/i.test(pathname) ||
      /\/v1\/shopping\/[0-9a-f-]{36}(?:\/(?:leftovers|product-selection))?$/i.test(
        pathname,
      )
    ) {
      return handleShoppingCatalog(request, currentDependencies);
    }
    return pathname.includes("/products/barcode/")
      ? handleProductCatalog(request, currentDependencies)
      : handleNutritionCatalog(request, currentDependencies);
  },
};
