import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { sha256CanonicalJson } from "@health-design/engine";

import {
  decideManualSelection,
  deleteTemporaryUser,
  idempotencyKeyDigest,
  isRetryableRemoteSql,
  receiptKeyDigest,
  safeErrorCodes,
} from "../scripts/supermarket-catalog-remote-smoke.mjs";

describe("T17 remote smoke manual selection gate", () => {
  it("marks the remote subgate not applicable when the publication has one SKU", () => {
    expect(
      decideManualSelection(
        {
          alternatives: [],
          selected: { projection: { skuId: "sku-primary" } },
        },
        1,
      ),
    ).toEqual({
      alternative: null,
      status: "NOT_APPLICABLE_REMOTE_NO_SECOND_PUBLISHED_SKU",
    });
  });

  it("keeps the manual selection check when a second SKU is published", () => {
    const alternative = {
      selection: { projection: { skuId: "sku-alternative" } },
      state: "resolved",
    };

    expect(
      decideManualSelection(
        {
          alternatives: [alternative],
          selected: { projection: { skuId: "sku-primary" } },
        },
        2,
      ),
    ).toEqual({ alternative, status: "PASS" });
  });

  it("fails closed when the publication and snapshot disagree", () => {
    expect(() =>
      decideManualSelection(
        {
          alternatives: [],
          selected: { projection: { skuId: "sku-primary" } },
        },
        2,
      ),
    ).toThrowError("manual_alternative_required");
  });

  it("reports nested smoke and cleanup failures without leaking unsafe messages", () => {
    expect(
      safeErrorCodes(
        new AggregateError(
          [
            new Error("active_pdf_export_failed"),
            new AggregateError(
              [new Error("private_object_cleanup_failed")],
              "remote_cleanup_failed",
            ),
          ],
          "remote_smoke_and_cleanup_failed",
        ),
      ),
    ).toEqual(["active_pdf_export_failed", "private_object_cleanup_failed"]);
    expect(safeErrorCodes(new Error("request failed for user@example.test"))).toEqual([
      "unexpected_failure",
    ]);
  });

  it("derives receipt keys with the same canonical digest as the Edge Function", async () => {
    const key = "0e74d8da-6b7b-4ef9-9998-a7a4c4038d6f";

    expect(idempotencyKeyDigest(key)).toBe(await sha256CanonicalJson({ key }));
  });

  it("uses the raw-key digest required by exports without changing shopping receipts", async () => {
    const key = "0e74d8da-6b7b-4ef9-9998-a7a4c4038d6f";

    expect(receiptKeyDigest("export-create", key)).toBe(
      createHash("sha256").update(key).digest("hex"),
    );
    expect(receiptKeyDigest("shopping-preference-put", key)).toBe(
      await sha256CanonicalJson({ key }),
    );
  });

  it("retries temporary auth cleanup once and accepts an already absent user", async () => {
    let attempts = 0;
    const retryingAdmin = {
      auth: {
        admin: {
          deleteUser: async () => {
            attempts += 1;
            return attempts === 1
              ? { error: { code: "temporary_failure", status: 503 } }
              : { error: null };
          },
        },
      },
    };

    await expect(
      deleteTemporaryUser(retryingAdmin, "00000000-0000-4000-8000-000000000001"),
    ).resolves.toBeUndefined();
    expect(attempts).toBe(2);

    const absentAdmin = {
      auth: {
        admin: {
          deleteUser: async () => ({
            error: { code: "user_not_found", status: 404 },
          }),
        },
      },
    };
    await expect(
      deleteTemporaryUser(absentAdmin, "00000000-0000-4000-8000-000000000002"),
    ).resolves.toBeUndefined();
  });

  it("retries only read-only remote SQL", () => {
    expect(
      isRetryableRemoteSql("\n  SELECT count(*) FROM private.plan_idempotency"),
    ).toBe(true);
    expect(isRetryableRemoteSql("insert into private.shopping_rate_limit_events")).toBe(
      false,
    );
    expect(isRetryableRemoteSql("begin; delete from public.profiles; commit;")).toBe(
      false,
    );
    expect(
      isRetryableRemoteSql("select count(*) from public.profiles; delete from x"),
    ).toBe(false);
  });
});
