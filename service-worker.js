/* Roselor PWA service worker.
 * Cache only the static app shell. Never cache Supabase/API responses or user data.
 */
const CACHE_NAME = "roselor-shell-v7";
const SHELL_URLS = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./icons/original-logo/roselor-icon-192.png?v=3"
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(SHELL_URLS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter(name => name.startsWith("roselor-shell-") && name !== CACHE_NAME)
      .map(name => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", event => {
  const request = event.request;
  const url = new URL(request.url);

  // Do not intercept writes, cross-origin requests, or API/data requests.
  if (request.method !== "GET" || url.origin !== self.location.origin) return;
  if (/supabase|\/rest\/v1\/|\/auth\/v1\/|\/functions\/v1\//i.test(url.href)) return;

  // Cache only known static shell files; all other requests use the network.
  const allowed = new Set(SHELL_URLS.map(path => new URL(path, self.registration.scope).href));
  if (!allowed.has(url.href)) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const isAppDocument = url.pathname.endsWith("/") || url.pathname.endsWith("/index.html");
    if (isAppDocument) {
      try {
        const response = await fetch(request, { cache: "no-store" });
        if (response && response.ok) await cache.put(request, response.clone());
        return response;
      } catch (error) {
        const cached = await cache.match(request);
        if (cached) return cached;
        throw error;
      }
    }
    const cached = await cache.match(request);
    if (cached) {
      fetch(request).then(response => {
        if (response && response.ok) cache.put(request, response.clone());
      }).catch(() => {});
      return cached;
    }
    const response = await fetch(request);
    if (response && response.ok) await cache.put(request, response.clone());
    return response;
  })());
});

self.addEventListener("push", event => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; }
  catch (_) { data = { body: event.data ? event.data.text() : "" }; }
  const title = String(data.title || "رز لر");
  const options = {
    body: String(data.body || "اعلان جدید دارید."),
    icon: "./icons/original-logo/roselor-icon-192.png",
    badge: "./icons/original-logo/roselor-icon-192.png",
    data: { url: typeof data.url === "string" ? data.url : "./" },
    tag: typeof data.tag === "string" ? data.tag : "roselor-notification"
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", event => {
  event.notification.close();
  let target = new URL("./", self.registration.scope).href;
  try {
    const candidate = new URL(String(event.notification.data?.url || "./"), self.registration.scope);
    if (candidate.origin === self.location.origin) target = candidate.href;
  } catch (_) {}
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of windows) {
      if (new URL(client.url).origin === self.location.origin) {
        await client.navigate(target);
        return client.focus();
      }
    }
    return self.clients.openWindow(target);
  })());
});
