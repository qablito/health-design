export type EdgeEnvironment = "development" | "local" | "production";

const ALLOWED_ORIGINS: Readonly<Record<EdgeEnvironment, ReadonlySet<string>>> = {
  development: new Set(["https://task-02-environments.health-design.pages.dev"]),
  local: new Set(["http://127.0.0.1:5173"]),
  production: new Set(["https://health-design.pages.dev"]),
};

type CorsResolution = {
  allowed: boolean;
  headers: Record<string, string>;
};

export function resolveCors(
  origin: string | null,
  environment: EdgeEnvironment,
): CorsResolution {
  if (origin === null) return { allowed: true, headers: {} };
  if (!ALLOWED_ORIGINS[environment].has(origin)) {
    return { allowed: false, headers: {} };
  }

  return {
    allowed: true,
    headers: {
      "access-control-allow-origin": origin,
      vary: "Origin",
    },
  };
}
