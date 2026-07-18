export const STATIC_CACHE_PREFIX = "health-design-static-";
export const STATIC_CACHE_VERSION = `${STATIC_CACHE_PREFIX}v1`;

export function isImmutablePublicAsset(requestUrl, applicationOrigin, method = "GET") {
  if (method !== "GET") return false;
  const url = new URL(requestUrl);
  return url.origin === applicationOrigin && url.pathname.startsWith("/assets/");
}
