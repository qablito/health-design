import { createClient } from "@supabase/supabase-js";
import { canonicalJson, hashSha256Hex } from "../_shared/access-security.ts";

import { handleMedicationSearch, type MedicationSearchDependencies } from "./search.ts";

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

function dependencies(): MedicationSearchDependencies {
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
      if (error || !claims || typeof claims.sub !== "string") {
        throw new Error("unauthenticated");
      }
      return { userId: claims.sub };
    },
    cacheIdentities: async (identities) => {
      const result: unknown = await serviceClient.rpc(
        "internal_clinical_medication_identities_upsert" as never,
        { p_identities: identities } as never,
      );
      const { error } = result as {
        data: unknown;
        error: { code?: string; message?: string } | null;
      };
      if (error) throw new Error("clinical_medication_identity_cache_unavailable");
    },
    environment,
    fetchCima: (input, init) => fetch(input, init),
    hashCanonical: (value) => hashSha256Hex(canonicalJson(value)),
    now: () => new Date(),
  };
}

export default {
  fetch(request: Request) {
    return handleMedicationSearch(request, dependencies());
  },
};
