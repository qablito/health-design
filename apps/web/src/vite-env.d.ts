/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_APP_ENV: "development" | "local" | "production";
  readonly VITE_SUPABASE_PUBLISHABLE_KEY: string;
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_TURNSTILE_SITE_KEY: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
