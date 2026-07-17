import { GoTrueClient } from "@supabase/auth-js";

const supabaseUrl = new URL(import.meta.env.VITE_SUPABASE_URL);
const projectReference = supabaseUrl.hostname.split(".")[0] ?? "health-design";

export const supabaseAuth = new GoTrueClient({
  autoRefreshToken: true,
  detectSessionInUrl: false,
  headers: { apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY },
  persistSession: true,
  storageKey: `sb-${projectReference}-auth-token`,
  url: `${supabaseUrl.origin}/auth/v1`,
});
