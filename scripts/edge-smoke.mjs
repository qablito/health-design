import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { RUNTIME_SMOKE_EXAMPLE } from "../supabase/functions/_shared/generated/contracts.js";

const endpoint =
  process.env.EDGE_SMOKE_URL ?? "http://127.0.0.1:54321/functions/v1/runtime-smoke";
const attempts = 60;
const retryMilliseconds = 500;
const execFileAsync = promisify(execFile);

async function resolveAuthorizationToken() {
  if (process.env.EDGE_SMOKE_TOKEN) return process.env.EDGE_SMOKE_TOKEN;
  if (process.env.EDGE_SMOKE_USE_LOCAL_ANON !== "true") return undefined;

  const { stdout } = await execFileAsync(
    "pnpm",
    ["exec", "supabase", "status", "-o", "json"],
    { maxBuffer: 1024 * 1024 },
  );
  const status = JSON.parse(stdout);
  const token = status.ANON_KEY ?? status.anon_key;
  if (typeof token !== "string" || token.length === 0) {
    throw new Error("Supabase local no devolvió ANON_KEY");
  }
  return token;
}

const authorizationToken = await resolveAuthorizationToken();

async function post(payload, { authenticated = true } = {}) {
  const headers = new Headers({ "content-type": "application/json" });
  if (authenticated && authorizationToken) {
    headers.set("apikey", authorizationToken);
    headers.set("authorization", `Bearer ${authorizationToken}`);
  }
  return fetch(endpoint, {
    body: JSON.stringify(payload),
    headers,
    method: "POST",
  });
}

async function waitForValidResponse() {
  let lastStatus = "sin respuesta";
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await post(RUNTIME_SMOKE_EXAMPLE);
      lastStatus = `${response.status} ${await response.text()}`;
      if (response.status === 200) return;
    } catch (error) {
      lastStatus = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, retryMilliseconds));
  }
  throw new Error(`Edge no quedó listo: ${lastStatus}`);
}

await waitForValidResponse();

if (authorizationToken) {
  const unauthenticatedResponse = await post(RUNTIME_SMOKE_EXAMPLE, {
    authenticated: false,
  });
  assert.equal(unauthenticatedResponse.status, 401);
}

const validResponse = await post(RUNTIME_SMOKE_EXAMPLE);
assert.equal(validResponse.status, 200);
assert.deepEqual(await validResponse.json(), RUNTIME_SMOKE_EXAMPLE);

const invalidResponse = await post({
  ...RUNTIME_SMOKE_EXAMPLE,
  unexpected: true,
});
assert.equal(invalidResponse.status, 400);
assert.deepEqual(await invalidResponse.json(), {
  error: "invalid_runtime_smoke_payload",
});

const oversizedResponse = await post({ payload: "x".repeat(1_100) });
assert.equal(oversizedResponse.status, 413);
assert.deepEqual(await oversizedResponse.json(), {
  error: "payload_too_large",
});

console.log(
  authorizationToken
    ? "Edge HTTP smoke: 401 sin JWT, 200 canónico, 400 estricto y 413 por tamaño"
    : "Edge HTTP smoke: 200 canónico, 400 estricto y 413 por tamaño",
);
