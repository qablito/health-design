import { describe, expect, it, vi } from "vitest";

import type {
  ProductApplicationRequest,
  ProductConfirmationRequest,
} from "@health-design/contracts";
import { COMMERCIAL_PRODUCT_FIXTURE } from "@health-design/test-fixtures/products";

import { createProductClient } from "../apps/web/src/features/barcode/product-client";

const profileId = "51000000-0000-4000-8000-000000000016";
const planId = "52000000-0000-4000-8000-000000000016";
const baseVersionId = "53000000-0000-4000-8000-000000000016";
const confirmationId = "54000000-0000-4000-8000-000000000016";

const confirmation = {
  completeness: "provisional",
  confirmationId,
  confirmedAt: "2026-07-21T12:00:00.000Z",
  correctionId: null,
  productId: "55000000-0000-4000-8000-000000000016",
  reusedRevision: false,
  revisionId: "56000000-0000-4000-8000-000000000016",
  schemaVersion: 1,
  scope: "profile",
} as const;

const resolution = {
  completeness: "provisional",
  confirmedForProfile: false,
  contentHash: "ab".repeat(32),
  gtin: COMMERCIAL_PRODUCT_FIXTURE.gtin,
  matching: {
    canonicalFoodKey: "food:chicken-breast",
    messageKey: "commercial_products.matching.exact",
    state: "exact",
  },
  revisionId: confirmation.revisionId,
  schemaVersion: 1,
  snapshot: COMMERCIAL_PRODUCT_FIXTURE,
  source: "global",
  sourceAvailability: "available",
  uncertainties: ["fiberG_unknown"],
} as const;

const candidate = {
  activatedAt: null,
  activeVersionId: baseVersionId,
  aggregateVersion: 3,
  archivedAt: null,
  baseVersionId,
  candidateId: "57000000-0000-4000-8000-000000000016",
  candidateStatus: "pending",
  changeEventId: "58000000-0000-4000-8000-000000000016",
  completeness: "provisional",
  contextSnapshotId: "59000000-0000-4000-8000-000000000016",
  createdAt: "2026-07-21T12:01:00.000Z",
  diff: {
    affectedModules: ["nutrition"],
    changedFields: ["nutrition.productApplication"],
  },
  impact: "module_only",
  ordinal: 2,
  planId,
  planVersionId: "5a000000-0000-4000-8000-000000000016",
  resolvedAt: null,
  status: "draft",
  validation: { completeness: "provisional" },
  validationStatus: "valid",
} as const;

function client(fetcher: typeof fetch) {
  return createProductClient({
    baseUrl: "https://project.supabase.co/functions/v1",
    fetcher,
    getAccessToken: () => Promise.resolve("user-jwt"),
    publishableKey: "publishable-key",
  });
}

describe("cliente de productos comerciales", () => {
  it("resuelve el código y el canónico sin confirmar nada", async () => {
    const fetcher = vi.fn<typeof fetch>(() =>
      Promise.resolve(new Response(JSON.stringify(resolution), { status: 200 })),
    );

    await expect(
      client(fetcher).resolve(
        profileId,
        COMMERCIAL_PRODUCT_FIXTURE.gtin,
        "food:chicken-breast",
      ),
    ).resolves.toEqual(resolution);

    const [url, init] = fetcher.mock.calls[0] ?? [];
    expect(url).toBe(
      `https://project.supabase.co/functions/v1/catalogs/v1/profiles/${profileId}/products/barcode/${COMMERCIAL_PRODUCT_FIXTURE.gtin.displayGtin}?symbology=ean_13&canonicalFoodKey=food%3Achicken-breast`,
    );
    expect(init?.method).toBe("GET");
    expect(init?.body).toBeUndefined();
    expect(new Headers(init?.headers).get("idempotency-key")).toBeNull();
  });

  it("confirma una ficha estructurada en una operación explícita", async () => {
    const fetcher = vi.fn<typeof fetch>(() =>
      Promise.resolve(new Response(JSON.stringify(confirmation), { status: 201 })),
    );
    const body = {
      baseRevisionId: resolution.revisionId,
      expectedContentHash: resolution.contentHash,
      schemaVersion: 1,
      snapshot: resolution.snapshot,
    } satisfies ProductConfirmationRequest;

    await expect(
      client(fetcher).confirm(profileId, resolution.gtin, body),
    ).resolves.toEqual(confirmation);

    const [url, init] = fetcher.mock.calls[0] ?? [];
    expect(url).toContain("/catalogs/v1/profiles/");
    expect(url).toContain("/confirm?symbology=ean_13");
    expect(new Headers(init?.headers).get("idempotency-key")).toMatch(
      /^[0-9a-f-]{36}$/,
    );
    if (typeof init?.body !== "string") throw new Error("expected_body");
    expect(JSON.parse(init.body)).toEqual(body);
  });

  it("crea el candidato por separado y usa control optimista", async () => {
    const fetcher = vi.fn<typeof fetch>(() =>
      Promise.resolve(new Response(JSON.stringify(candidate), { status: 200 })),
    );
    const body = {
      baseVersionId,
      confirmationId,
      expectedVersion: 2,
      schemaVersion: 1,
      selection: {
        dayIndex: 0,
        expectedCanonicalFoodKey: "food:chicken-breast",
        foodIndex: 0,
        mealIndex: 1,
      },
    } satisfies ProductApplicationRequest;

    await expect(client(fetcher).apply(planId, body)).resolves.toEqual(candidate);

    const [url, init] = fetcher.mock.calls[0] ?? [];
    expect(url).toBe(
      `https://project.supabase.co/functions/v1/plans/v1/plans/${planId}/product-applications`,
    );
    expect(new Headers(init?.headers).get("if-match")).toBe('"2"');
    expect(new Headers(init?.headers).get("idempotency-key")).toMatch(
      /^[0-9a-f-]{36}$/,
    );
  });

  it("rechaza respuestas que no respetan el contrato", async () => {
    const fetcher = vi.fn<typeof fetch>(() =>
      Promise.resolve(new Response(JSON.stringify({ snapshot: {} }), { status: 200 })),
    );

    await expect(
      client(fetcher).resolve(
        profileId,
        COMMERCIAL_PRODUCT_FIXTURE.gtin,
        "food:chicken-breast",
      ),
    ).rejects.toThrow("invalid_product_response");
  });
});
