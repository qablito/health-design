import { describe, expect, it } from "vitest";

import type { LedgerReceipt } from "@health-design/contracts";
import {
  adminIntentIdempotencyHash,
  adminOutcomeIdempotencyHash,
  receiptSigningPayload,
  verifyLedgerReceipt,
  type AdminIntentInput,
} from "../../supabase/functions/_shared/audit";

function base64Url(bytes: ArrayBuffer): string {
  return Buffer.from(bytes).toString("base64url");
}

const input: AdminIntentInput = {
  action: "impersonation_start",
  effectiveProfileId: "51000000-0000-4000-8000-000000005101",
  originalActorId: "31000000-0000-4000-8000-000000005101",
  requestId: "61000000-0000-4000-8000-000000005104",
  targetId: "51000000-0000-4000-8000-000000005101",
  targetType: "profile",
};

describe("continuidad criptográfica de auditoría", () => {
  it("liga la idempotencia al evento completo", async () => {
    const first = await adminIntentIdempotencyHash("development", input);
    const replayWithChangedTarget = await adminIntentIdempotencyHash("development", {
      ...input,
      targetId: "51000000-0000-4000-8000-000000005102",
    });

    expect(first).toMatch(/^[a-f0-9]{64}$/);
    expect(replayWithChangedTarget).not.toBe(first);
    await expect(
      adminOutcomeIdempotencyHash("development", {
        ...input,
        intentRecordHash: "b".repeat(64),
        result: "success",
      }),
    ).resolves.toMatch(/^[a-f0-9]{64}$/);
    await expect(
      adminOutcomeIdempotencyHash("development", {
        ...input,
        errorCode: "reconciliation_required",
        intentRecordHash: "b".repeat(64),
        result: "failure",
      }),
    ).resolves.not.toBe(
      await adminOutcomeIdempotencyHash("development", {
        ...input,
        intentRecordHash: "b".repeat(64),
        result: "success",
      }),
    );
  });

  it("rechaza firma, campos firmados y clave Ed25519 alterados", async () => {
    const keyPair = await crypto.subtle.generateKey("Ed25519", true, [
      "sign",
      "verify",
    ]);
    const publicKey = base64Url(
      await crypto.subtle.exportKey("raw", keyPair.publicKey),
    );
    const idempotencyHash = await adminIntentIdempotencyHash("development", input);
    const unsigned = {
      environment: "development",
      idempotencyHash,
      keyVersion: 1,
      recordHash: "b".repeat(64),
      sequence: 12,
      stream: "admin-audit",
      timestamp: "2026-07-17T16:00:00.000Z",
    } as const;
    const signature = await crypto.subtle.sign(
      "Ed25519",
      keyPair.privateKey,
      receiptSigningPayload(unsigned),
    );
    const receipt: LedgerReceipt = { ...unsigned, signature: base64Url(signature) };

    expect(await verifyLedgerReceipt(receipt, publicKey)).toBe(true);
    expect(
      await verifyLedgerReceipt(
        { ...receipt, sequence: receipt.sequence + 1 },
        publicKey,
      ),
    ).toBe(false);
    expect(
      await verifyLedgerReceipt(
        {
          ...receipt,
          signature: `${receipt.signature.startsWith("A") ? "B" : "A"}${receipt.signature.slice(1)}`,
        },
        publicKey,
      ),
    ).toBe(false);

    const unknownKeyPair = await crypto.subtle.generateKey("Ed25519", true, [
      "sign",
      "verify",
    ]);
    const unknownPublicKey = base64Url(
      await crypto.subtle.exportKey("raw", unknownKeyPair.publicKey),
    );
    expect(await verifyLedgerReceipt(receipt, unknownPublicKey)).toBe(false);
  });
});
