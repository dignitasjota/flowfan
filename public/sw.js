/* FanFlow service worker — push notifications + basic app-shell install.
 * Kept dependency-free and small. Bump CACHE_VERSION to force an update. */

const CACHE_VERSION = "fanflow-v1";

self.addEventListener("install", (event) => {
  // Activa la nueva versión inmediatamente.
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // Limpia caches de versiones anteriores.
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))
      );
      await self.clients.claim();
    })()
  );
});

// --- Push notifications ---
self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch (e) {
    payload = { title: "FanFlow", body: event.data ? event.data.text() : "" };
  }

  const title = payload.title || "FanFlow";
  const options = {
    body: payload.body || "",
    icon: "/logo.png",
    badge: "/logo.png",
    tag: payload.tag || undefined,
    data: { url: payload.url || "/conversations" },
    renotify: Boolean(payload.tag),
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

// --- Click en la notificación: enfoca una pestaña existente o abre una nueva ---
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || "/conversations";

  event.waitUntil(
    (async () => {
      const allClients = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      for (const client of allClients) {
        // Si ya hay una pestaña de la app abierta, la enfoca y navega.
        if ("focus" in client) {
          await client.focus();
          if ("navigate" in client) {
            try {
              await client.navigate(targetUrl);
            } catch (e) {
              /* cross-origin navigate puede fallar; ignorar */
            }
          }
          return;
        }
      }
      if (self.clients.openWindow) {
        await self.clients.openWindow(targetUrl);
      }
    })()
  );
});
