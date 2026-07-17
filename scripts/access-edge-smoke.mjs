import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const endpoint =
  process.env.ACCESS_EDGE_SMOKE_URL ?? "http://127.0.0.1:54321/functions/v1/access";

async function localAnonKey() {
  if (process.env.ACCESS_EDGE_SMOKE_ANON_KEY) {
    return process.env.ACCESS_EDGE_SMOKE_ANON_KEY;
  }
  const { stdout } = await execFileAsync(
    "pnpm",
    ["exec", "supabase", "status", "-o", "json"],
    { maxBuffer: 1024 * 1024 },
  );
  const status = JSON.parse(stdout);
  const key = status.ANON_KEY ?? status.anon_key;
  if (typeof key !== "string" || key.length === 0) {
    throw new Error("Supabase local no devolvió ANON_KEY");
  }
  return key;
}

const anonKey = await localAnonKey();
const origin = "http://127.0.0.1:5173";

const unauthenticated = await fetch(`${endpoint}/v1/me/profiles`, {
  headers: { origin },
});
assert.equal(unauthenticated.status, 401);

const querySecret = await fetch(
  `${endpoint}/v1/invitations/redeem?invitationSecret=prohibido`,
  {
    body: "{}",
    headers: {
      apikey: anonKey,
      authorization: `Bearer ${anonKey}`,
      "content-type": "application/json",
      origin,
    },
    method: "POST",
  },
);
assert.equal(querySecret.status, 400);
assert.equal(querySecret.headers.get("cache-control"), "no-store, private");
assert.equal(querySecret.headers.get("referrer-policy"), "no-referrer");
assert.ok(
  [origin, "*"].includes(querySecret.headers.get("access-control-allow-origin") ?? ""),
);

const anonymousRoleOnly = await fetch(`${endpoint}/v1/me/profiles`, {
  headers: {
    apikey: anonKey,
    authorization: `Bearer ${anonKey}`,
    origin,
  },
});
assert.equal(anonymousRoleOnly.status, 401);
assert.ok(
  [origin, "*"].includes(
    anonymousRoleOnly.headers.get("access-control-allow-origin") ?? "",
  ),
);

const foreignOrigin = await fetch(
  `${endpoint}/v1/invitations/redeem?invitationSecret=prohibido`,
  {
    body: "{}",
    headers: {
      apikey: anonKey,
      authorization: `Bearer ${anonKey}`,
      "content-type": "application/json",
      origin: "https://attacker.invalid",
    },
    method: "POST",
  },
);
assert.equal(foreignOrigin.status, 403);

const preflight = await fetch(`${endpoint}/v1/me/profiles`, {
  headers: {
    "access-control-request-headers":
      "authorization, apikey, content-type, idempotency-key",
    "access-control-request-method": "GET",
    origin,
  },
  method: "OPTIONS",
});
assert.ok(
  preflight.status === 200 || preflight.status === 204,
  `preflight inesperado: ${preflight.status}`,
);
assert.ok(
  [origin, "*"].includes(preflight.headers.get("access-control-allow-origin") ?? ""),
  "el gateway local devolvió un preflight CORS inesperado",
);

process.stdout.write(
  "Access Edge HTTP smoke: 401 sin identidad, query secreta 400, origen ajeno 403 y wildcard limitado al proxy local\n",
);
