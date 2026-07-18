const STATIC_CACHE_PREFIX = "health-design-static-";

export async function clearPublicAssetCaches(): Promise<void> {
  if ("caches" in globalThis) {
    const names = await globalThis.caches.keys();
    await Promise.all(
      names
        .filter((name) => name.startsWith(STATIC_CACHE_PREFIX))
        .map((name) => globalThis.caches.delete(name)),
    );
  }
  if ("navigator" in globalThis) {
    globalThis.navigator.serviceWorker?.controller?.postMessage({
      type: "CLEAR_PUBLIC_ASSET_CACHES",
    });
  }
}

export async function registerPublicAssetWorker(): Promise<void> {
  if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return;
  await navigator.serviceWorker.register("/sw.js", {
    scope: "/",
    type: "module",
    updateViaCache: "none",
  });
}
