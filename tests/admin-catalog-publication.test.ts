import { describe, expect, it, vi } from "vitest";

vi.mock("../apps/web/src/services/supabase", () => ({
  supabaseAuth: { getSession: () => Promise.resolve({ data: {}, error: null }) },
}));

import { createAdminClient } from "../apps/web/src/features/admin/admin-client";
import { catalogPublicationSummaryText } from "../apps/web/src/features/admin/CatalogPublicationPanel";

const revisionId = "84000000-0000-4000-8000-000000000001";

describe("panel administrativo de publicación", () => {
  it("muestra el objetivo 80, cobertura global, grupos, errores y manifest", () => {
    const summary = catalogPublicationSummaryText({
      items: [
        {
          activePublicationId: null,
          basketSeedHash: "2".repeat(64),
          basketSeedRevisionId: "84000000-0000-4000-8000-000000000002",
          catalogHash: "1".repeat(64),
          catalogRevisionId: revisionId,
          chain: "mercadona",
          coverage: {
            dynamicRequired: 20,
            dynamicUsable: 18,
            fixedRequired: 60,
            fixedUsable: 54,
            groups: [{ groupKey: "protein", required: 20, usable: 15 }],
            publishable: true,
            totalRequired: 80,
            totalUsable: 72,
          },
          coverageHash: "3".repeat(64),
          manifest: {
            errorCount: 2,
            licenseStatus: "approved",
            recordCount: 4314,
            sourceTermsStatus: "approved",
          },
          publicationVersion: null,
          qualityStatus: "current",
          revisionNumber: 1,
          schemaVersion: 1,
          sourceDecisionReady: true,
          state: "publishable",
          usableCount: 4200,
        },
      ],
      nextCursor: null,
      schemaVersion: 1,
    });
    expect(summary).toContain("72 / 80");
    expect(summary).toContain("protein");
    expect(summary).toContain("2 errores");
    expect(summary).toContain("Licencia aprobada");
  });

  it("usa rutas separadas y no incluye referencias internas", async () => {
    const requests: Array<{ body: unknown; path: string }> = [];
    const client = createAdminClient({
      baseUrl: "https://api.test/admin",
      fetcher: (url, init) => {
        const requestBody = typeof init?.body === "string" ? init.body : "{}";
        const requestUrl =
          typeof url === "string" ? url : url instanceof URL ? url.href : url.url;
        requests.push({
          body: JSON.parse(requestBody),
          path: requestUrl.replace("https://api.test/admin", ""),
        });
        return Promise.resolve(
          new Response(
            JSON.stringify({
              catalogPublicationId: "84000000-0000-4000-8000-000000000003",
              chain: "mercadona",
              schemaVersion: 1,
              status: "active",
              version: 1,
            }),
            { status: 200 },
          ),
        );
      },
      getAccessToken: () => Promise.resolve("token"),
      publishableKey: "publishable",
    });
    await client.publishCatalogRevision(revisionId, {
      expectedCatalogHash: "1".repeat(64),
      expectedCoverageHash: "3".repeat(64),
      expectedSeedHash: "2".repeat(64),
      expectedVersion: 1,
      sourceUseDecision: "development_approved",
    });
    expect(requests[0]?.path).toBe(`/v1/admin/catalog-revisions/${revisionId}/publish`);
    expect(JSON.stringify(requests[0])).not.toMatch(/objectRef|sourceLocation|postal/i);
  });
});
