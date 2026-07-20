import { describe, expect, it, vi } from "vitest";

import { createNutritionPlanClient } from "../apps/web/src/features/nutrition/nutrition-client";

const versionId = "10000000-0000-4000-8000-000000001403";

describe("Cliente web de explicación", () => {
  it("solicita una explicación opcional e interpreta su procedencia", async () => {
    const fetcher = vi.fn<typeof fetch>(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            planOutputHash: "12".repeat(32),
            planVersionId: versionId,
            schemaVersion: 1,
            segments: [
              {
                messageKey: "ai.explanation.summary.complete",
                slot: "summary",
                text: "Tu plan está completo y ha superado la validación interna.",
              },
            ],
            source: "luna",
          }),
          { status: 200 },
        ),
      ),
    );
    const client = createNutritionPlanClient({
      baseUrl: "https://project.supabase.co/functions/v1/plans",
      fetcher,
      getAccessToken: () => Promise.resolve("access-token"),
      publishableKey: "publishable-key",
    });

    await expect(client.explainVersion(versionId)).resolves.toMatchObject({
      source: "luna",
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, init] = fetcher.mock.calls[0] ?? [];
    expect(url).toBe(
      `https://project.supabase.co/functions/v1/plans/v1/plans/${versionId}/explanation`,
    );
    expect(init?.method).toBe("POST");
    expect(new Headers(init?.headers).get("idempotency-key")).toMatch(/^[0-9a-f-]+$/);
  });
});
