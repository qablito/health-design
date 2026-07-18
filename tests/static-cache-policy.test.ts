import { describe, expect, it } from "vitest";

type CachePolicy = {
  isImmutablePublicAsset(
    requestUrl: string,
    applicationOrigin: string,
    method?: string,
  ): boolean;
  STATIC_CACHE_PREFIX: string;
};

const policyUrl = new URL("../apps/web/public/static-cache-policy.js", import.meta.url)
  .href;
const policy = (await import(policyUrl)) as CachePolicy;

describe("política del service worker", () => {
  it("solo admite GET de assets inmutables del mismo origen", () => {
    const origin = "https://app.health-design.test";
    expect(
      policy.isImmutablePublicAsset(`${origin}/assets/index-a1b2c3.js`, origin),
    ).toBe(true);
    expect(
      policy.isImmutablePublicAsset(
        `${origin}/functions/v1/plans/v1/profiles/secret/draft`,
        origin,
      ),
    ).toBe(false);
    expect(policy.isImmutablePublicAsset(`${origin}/questionnaire`, origin)).toBe(
      false,
    );
    expect(
      policy.isImmutablePublicAsset(`${origin}/assets/index-a1b2c3.js`, origin, "POST"),
    ).toBe(false);
    expect(
      policy.isImmutablePublicAsset(
        "https://third-party.test/assets/tracker.js",
        origin,
      ),
    ).toBe(false);
  });

  it("reserva un prefijo exclusivo para poder limpiar sus caches", () => {
    expect(policy.STATIC_CACHE_PREFIX).toBe("health-design-static-");
  });
});
