/* global caches, self */

import {
  STATIC_CACHE_PREFIX,
  STATIC_CACHE_VERSION,
  isImmutablePublicAsset,
} from "./static-cache-policy.js";

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(
          names
            .filter(
              (name) =>
                name.startsWith(STATIC_CACHE_PREFIX) && name !== STATIC_CACHE_VERSION,
            )
            .map((name) => caches.delete(name)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type !== "CLEAR_PUBLIC_ASSET_CACHES") return;
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(
          names
            .filter((name) => name.startsWith(STATIC_CACHE_PREFIX))
            .map((name) => caches.delete(name)),
        ),
      ),
  );
});

self.addEventListener("fetch", (event) => {
  if (
    !isImmutablePublicAsset(
      event.request.url,
      self.location.origin,
      event.request.method,
    )
  ) {
    return;
  }

  event.respondWith(
    caches.open(STATIC_CACHE_VERSION).then(async (cache) => {
      const cached = await cache.match(event.request);
      if (cached) return cached;
      const response = await fetch(event.request);
      if (response.ok && response.type === "basic") {
        await cache.put(event.request, response.clone());
      }
      return response;
    }),
  );
});
