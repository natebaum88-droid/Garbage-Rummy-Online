self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));
// Multiplayer requires an active connection. Avoid caching stale game versions.
