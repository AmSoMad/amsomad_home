// sw.js
const CACHE = "tournament-v4";

// 즉시 활성화
self.addEventListener("install", (e) => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // 1) HTML 네비게이션은 항상 네트워크 (최신 UI 즉시)
  if (req.mode === "navigate") {
    event.respondWith(fetch(req).catch(() => caches.match("/index.html")));
    return;
  }

  // 2) Supabase 트래픽은 절대 캐시하지 않음 (Realtime/REST 모두)
  if (url.hostname.endsWith("supabase.co") || url.hostname.endsWith("supabase.net")) {
    event.respondWith(fetch(req));
    return;
  }

  // 3) 정적 리소스(css/js/img/webmanifest)만 캐시-후보강(Stale-While-Revalidate)
  const isStatic =
    url.origin === location.origin &&
    /\.(css|js|png|jpg|jpeg|gif|svg|ico|webp|woff2?|ttf|otf|map|webmanifest)$/.test(
      url.pathname
    );

  if (isStatic) {
    event.respondWith(
      caches.open(CACHE).then(async (cache) => {
        const cached = await cache.match(req);
        const update = fetch(req)
          .then((res) => {
            // 성공한 응답만 캐시
            if (res && res.status === 200) cache.put(req, res.clone());
            return res;
          })
          .catch(() => null);
        // 캐시 우선 + 백그라운드 갱신
        return cached || update || fetch(req);
      })
    );
  }
});