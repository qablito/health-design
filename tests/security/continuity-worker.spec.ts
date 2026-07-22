import { describe, expect, it } from "vitest";

import { verifyLedgerReceipt } from "../../supabase/functions/_shared/audit";
import {
  ContinuityLedger,
  decryptAdminAuditRecord,
  signServiceRequest,
  triggerAdminReconciliation,
  validateAdminAuditPayload,
} from "../../workers/continuity-ledger/src/index.js";
import continuityWorker from "../../workers/continuity-ledger/src/index.js";

type StoredRecord = Record<string, unknown>;

class MemoryStorage {
  readonly values = new Map<string, unknown>();
  alarm?: number;

  get(key: string) {
    return Promise.resolve(this.values.get(key));
  }

  put(keyOrEntries: string | Record<string, unknown>, value?: unknown) {
    if (typeof keyOrEntries === "string") {
      this.values.set(keyOrEntries, value);
    } else {
      for (const [key, entry] of Object.entries(keyOrEntries)) {
        this.values.set(key, entry);
      }
    }
    return Promise.resolve();
  }

  delete(key: string) {
    this.values.delete(key);
    return Promise.resolve(true);
  }

  list({ prefix }: { prefix: string }) {
    return Promise.resolve(
      new Map([...this.values].filter(([key]) => key.startsWith(prefix))),
    );
  }

  setAlarm(value: number) {
    this.alarm = value;
    return Promise.resolve();
  }
}

class MemoryBucket {
  readonly objects = new Map<string, string>();

  put(key: string, value: string) {
    if (this.objects.has(key)) return Promise.resolve(null);
    this.objects.set(key, value);
    return Promise.resolve({ key });
  }

  get(key: string) {
    const value = this.objects.get(key);
    return Promise.resolve(
      value === undefined ? null : { text: () => Promise.resolve(value) },
    );
  }
}

function base64Url(bytes: ArrayBuffer | Uint8Array): string {
  return Buffer.from(
    bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : bytes,
  ).toString("base64url");
}

async function fixture() {
  const storage = new MemoryStorage();
  const bucket = new MemoryBucket();
  const signingKeys = await crypto.subtle.generateKey("Ed25519", true, [
    "sign",
    "verify",
  ]);
  const env = {
    ADMIN_AUDIT_BUCKET: bucket,
    ADMIN_AUDIT_KEK_V1: base64Url(crypto.getRandomValues(new Uint8Array(32))),
    ADMIN_AUDIT_KEK_VERSION: "1",
    CONTINUITY_LEDGER_HMAC_KEY: "ledger-hmac-key-with-at-least-256-bits",
    ENVIRONMENT: "development",
    LEDGER_SIGNING_KEY_VERSION: "1",
    LEDGER_SIGNING_PRIVATE_KEY_PKCS8_V1: base64Url(
      await crypto.subtle.exportKey("pkcs8", signingKeys.privateKey),
    ),
    MUTATIONS_ENABLED: "true",
  };
  const ledger = new ContinuityLedger({ storage }, env);
  const publicKey = base64Url(
    await crypto.subtle.exportKey("raw", signingKeys.publicKey),
  );
  return { bucket, env, ledger, publicKey, storage };
}

function payload(requestId: string) {
  return {
    action: "impersonation_start",
    createdAt: new Date().toISOString(),
    effectiveProfileId: "51000000-0000-4000-8000-000000005101",
    originalActorId: "31000000-0000-4000-8000-000000005101",
    phase: "intent",
    requestId,
    result: "pending",
    schemaVersion: 1,
    stream: "admin-audit",
    targetId: "51000000-0000-4000-8000-000000005101",
    targetType: "profile",
  };
}

async function signedRequest(
  body: Record<string, unknown>,
  secret: string,
  nonce = crypto.randomUUID(),
  options: { method?: "GET" | "POST"; path?: string } = {},
) {
  const method = options.method ?? "POST";
  const path = options.path ?? "/v1/admin-audit/append";
  const rawBody = method === "GET" ? "" : JSON.stringify(body);
  const timestamp = new Date().toISOString();
  const signature = await signServiceRequest({
    body: rawBody,
    method,
    nonce,
    path,
    secret,
    timestamp,
  });
  return new Request(`https://ledger.test${path}`, {
    ...(method === "POST" ? { body: rawBody } : {}),
    headers: {
      "content-type": "application/json",
      ...(method === "POST" ? { "idempotency-key": String(body.requestId) } : {}),
      "x-ledger-nonce": nonce,
      "x-ledger-signature": signature,
      "x-ledger-timestamp": timestamp,
    },
    method,
  });
}

describe("Worker de continuidad", () => {
  it("acepta las acciones administrativas cerradas de productos T16", () => {
    const expectedTargets = {
      barcode_correction_approve: "commercial_product_revision",
      barcode_correction_correct: "barcode_correction",
      barcode_correction_reject: "barcode_correction",
      catalog_match_candidates_generate: "catalog_revision",
      catalog_publication_hide: "catalog_publication",
      catalog_revision_publish: "catalog_revision",
      matching_rule_activate: "product_matching_rule",
      matching_rule_review: "product_matching_rule",
    } as const;

    for (const [action, targetType] of Object.entries(expectedTargets)) {
      expect(() =>
        validateAdminAuditPayload({
          ...payload(crypto.randomUUID()),
          action,
          targetType,
        }),
      ).not.toThrow();
    }
  });

  it("rechaza payload libre, canarios, cuerpos grandes y HMAC débil", async () => {
    expect(() =>
      validateAdminAuditPayload({ ...payload(crypto.randomUUID()), note: "x" }),
    ).toThrow("invalid_payload");
    expect(() =>
      validateAdminAuditPayload({
        ...payload(crypto.randomUUID()),
        medication: "canario-medicacion",
      }),
    ).toThrow("invalid_payload");
    expect(() =>
      validateAdminAuditPayload(
        JSON.parse(`{"padding":"${"x".repeat(4_097)}"}`) as unknown,
      ),
    ).toThrow("payload_too_large");
    await expect(
      signServiceRequest({
        body: "{}",
        method: "POST",
        nonce: crypto.randomUUID(),
        path: "/v1/admin-audit/append",
        secret: "short",
        timestamp: new Date().toISOString(),
      }),
    ).rejects.toThrow("invalid_hmac_key");

    const state = await fixture();
    const malformedBody = '{"medication":"canario-secreto",';
    const timestamp = new Date().toISOString();
    const nonce = crypto.randomUUID();
    const malformed = await state.ledger.fetch(
      new Request("https://ledger.test/v1/admin-audit/append", {
        body: malformedBody,
        headers: {
          "idempotency-key": crypto.randomUUID(),
          "x-ledger-nonce": nonce,
          "x-ledger-signature": await signServiceRequest({
            body: malformedBody,
            method: "POST",
            nonce,
            path: "/v1/admin-audit/append",
            secret: state.env.CONTINUITY_LEDGER_HMAC_KEY,
            timestamp,
          }),
          "x-ledger-timestamp": timestamp,
        },
        method: "POST",
      }),
    );
    expect(malformed.status).toBe(422);
    await expect(malformed.json()).resolves.toEqual({ error: "invalid_payload" });
  });

  it("serializa secuencias, firma recibos y hace idempotente el reintento", async () => {
    const state = await fixture();
    const firstBody = payload("61000000-0000-4000-8000-000000005104");
    const secondBody = payload("61000000-0000-4000-8000-000000005105");
    const [first, second] = await Promise.all([
      state.ledger.fetch(
        await signedRequest(firstBody, state.env.CONTINUITY_LEDGER_HMAC_KEY),
      ),
      state.ledger.fetch(
        await signedRequest(secondBody, state.env.CONTINUITY_LEDGER_HMAC_KEY),
      ),
    ]);
    const receipts = (await Promise.all([first.json(), second.json()])) as Array<{
      sequence: number;
      signature: string;
    }>;

    expect([first.status, second.status]).toEqual([200, 200]);
    expect(receipts.map(({ sequence }) => sequence).sort()).toEqual([1, 2]);
    expect(state.bucket.objects.size).toBe(2);
    expect(await verifyLedgerReceipt(receipts[0] as never, state.publicKey)).toBe(true);

    const retry = await state.ledger.fetch(
      await signedRequest(firstBody, state.env.CONTINUITY_LEDGER_HMAC_KEY),
    );
    const retryReceipt = (await retry.json()) as { sequence: number };
    expect(retry.status).toBe(200);
    expect(retryReceipt.sequence).toBe(receipts[0]!.sequence);
    expect(state.bucket.objects.size).toBe(2);
  });

  it("rechaza nonce repetido y detecta ciphertext, AAD o KEK alterados", async () => {
    const state = await fixture();
    const body = payload("61000000-0000-4000-8000-000000005106");
    const nonce = crypto.randomUUID();
    const first = await state.ledger.fetch(
      await signedRequest(body, state.env.CONTINUITY_LEDGER_HMAC_KEY, nonce),
    );
    const replay = await state.ledger.fetch(
      await signedRequest(body, state.env.CONTINUITY_LEDGER_HMAC_KEY, nonce),
    );
    expect(first.status).toBe(200);
    expect(replay.status).toBe(409);

    const stored = JSON.parse([...state.bucket.objects.values()][0]!) as StoredRecord;
    await expect(
      decryptAdminAuditRecord(stored, state.env.ADMIN_AUDIT_KEK_V1),
    ).resolves.toMatchObject({ requestId: body.requestId });

    const ciphertext = String(stored.ciphertext);
    await expect(
      decryptAdminAuditRecord(
        {
          ...stored,
          ciphertext: `${ciphertext.startsWith("A") ? "B" : "A"}${ciphertext.slice(1)}`,
        },
        state.env.ADMIN_AUDIT_KEK_V1,
      ),
    ).rejects.toThrow();
    await expect(
      decryptAdminAuditRecord(
        { ...stored, sequence: Number(stored.sequence) + 1 },
        state.env.ADMIN_AUDIT_KEK_V1,
      ),
    ).rejects.toThrow();
    await expect(
      decryptAdminAuditRecord(
        stored,
        base64Url(crypto.getRandomValues(new Uint8Array(32))),
      ),
    ).rejects.toThrow();
  });

  it("enumera intents pendientes y los elimina al cerrar el outcome", async () => {
    const state = await fixture();
    const intent = payload("61000000-0000-4000-8000-000000005107");
    const intentResponse = await state.ledger.fetch(
      await signedRequest(intent, state.env.CONTINUITY_LEDGER_HMAC_KEY),
    );
    const intentReceipt = (await intentResponse.json()) as { recordHash: string };
    const pendingResponse = await state.ledger.fetch(
      await signedRequest(
        {},
        state.env.CONTINUITY_LEDGER_HMAC_KEY,
        crypto.randomUUID(),
        { method: "GET", path: "/v1/admin-audit/pending" },
      ),
    );

    expect(pendingResponse.status).toBe(200);
    await expect(pendingResponse.json()).resolves.toEqual({
      items: [
        {
          ...intent,
          intentRecordHash: intentReceipt.recordHash,
        },
      ],
    });

    const outcome = {
      ...intent,
      createdAt: new Date().toISOString(),
      intentRecordHash: intentReceipt.recordHash,
      phase: "outcome",
      result: "success",
    };
    const outcomeResponse = await state.ledger.fetch(
      await signedRequest(outcome, state.env.CONTINUITY_LEDGER_HMAC_KEY),
    );
    expect(outcomeResponse.status).toBe(200);

    const closedResponse = await state.ledger.fetch(
      await signedRequest(
        {},
        state.env.CONTINUITY_LEDGER_HMAC_KEY,
        crypto.randomUUID(),
        { method: "GET", path: "/v1/admin-audit/pending" },
      ),
    );
    await expect(closedResponse.json()).resolves.toEqual({ items: [] });
  });

  it("acepta el código cerrado de reconciliación sin texto libre", () => {
    const intent = payload("61000000-0000-4000-8000-000000005108");
    expect(() =>
      validateAdminAuditPayload({
        ...intent,
        errorCode: "reconciliation_required",
        intentRecordHash: "a".repeat(64),
        phase: "outcome",
        result: "failure",
      }),
    ).not.toThrow();
  });

  it("firma y dispara el reconciliador periódico sin exponer secretos", async () => {
    const requests: Request[] = [];
    const env = {
      CONTINUITY_RECONCILER_HMAC_KEY: "reconciler-hmac-key-with-256-bits-minimum",
      CONTINUITY_RECONCILER_URL:
        "https://project.supabase.co/functions/v1/admin-reconciler/v1/admin-audit/reconcile",
    };
    await triggerAdminReconciliation(env, (request) => {
      requests.push(request);
      return Promise.resolve(new Response("{}", { status: 200 }));
    });

    expect(requests).toHaveLength(1);
    const sent = requests[0]!;
    const body = await sent.clone().text();
    const timestamp = sent.headers.get("x-reconciler-timestamp")!;
    const nonce = sent.headers.get("x-reconciler-nonce")!;
    expect(await sent.json()).toEqual({ schemaVersion: 1 });
    expect(sent.headers.get("x-reconciler-signature")).toBe(
      await signServiceRequest({
        body,
        method: "POST",
        nonce,
        path: "/functions/v1/admin-reconciler/v1/admin-audit/reconcile",
        secret: env.CONTINUITY_RECONCILER_HMAC_KEY,
        timestamp,
      }),
    );
  });

  it("no dispara el cron mientras las mutaciones sigan desactivadas", () => {
    const promises: Promise<unknown>[] = [];
    continuityWorker.scheduled(
      {},
      { MUTATIONS_ENABLED: "false" },
      { waitUntil: (promise: Promise<unknown>) => promises.push(promise) },
    );
    expect(promises).toEqual([]);
  });
});
