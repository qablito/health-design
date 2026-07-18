import { createClient } from "@supabase/supabase-js";

import {
  handleQuestionnaire,
  type QuestionnaireDependencies,
} from "./questionnaire.ts";

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

function dependencies(): QuestionnaireDependencies {
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
  };
}

export default {
  fetch(request: Request) {
    return handleQuestionnaire(request, dependencies());
  },
};
