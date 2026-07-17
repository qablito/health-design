import { spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  checkPublicBundle,
  renderPagesHeaders,
  resolvePublicEnvironment,
} from "./check-public-env.mjs";

const configuration = resolvePublicEnvironment(process.env);
const childEnvironment = {
  ...process.env,
  VITE_APP_ENV: configuration.appEnvironment,
  VITE_SUPABASE_PUBLISHABLE_KEY: configuration.publishableKey,
  VITE_SUPABASE_URL: configuration.supabaseUrl,
  VITE_TURNSTILE_SITE_KEY: configuration.turnstileSiteKey,
};

await new Promise((resolveBuild, rejectBuild) => {
  const child = spawn("pnpm", ["--filter", "@health-design/web", "build"], {
    env: childEnvironment,
    stdio: "inherit",
  });
  child.once("error", rejectBuild);
  child.once("exit", (code) => {
    if (code === 0) resolveBuild();
    else rejectBuild(new Error(`Vite terminó con código ${String(code)}.`));
  });
});

const distribution = resolve("apps/web/dist");
await writeFile(resolve(distribution, "_headers"), renderPagesHeaders(configuration));
await checkPublicBundle(distribution, configuration);
