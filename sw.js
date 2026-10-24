// הדברה 360 — Service Worker
const CACHE = 'hadbara360-v1';
const ASSETS = [
  '/hadbara360/',
  '/hadbara360/index.html',
  '/hadbara360/manifest.json',
];

// CDN libs to cache
const CDN_ASSETS = [
  'https://unpkg.com/react@18.2.0/umd/react.production.min.js',
  'https://unpkg.com/react-dom@18.2.0/umd/react-dom.production.min.js',
  'https://unpkg.com/@babel/standalone@7.23.5/babel.min.js',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.39.3/dist/umd/supabase.js',
];

// Install: cache all assets
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(cache => {
      // Cache local assets
      cache.addAll(ASSETS).catch(() => {});
      // Cache CDN assets (best effort)
      CDN_ASSETS.forEach(url => {
        fetch(url).then(r => { if(r.ok) cache.put(url, r); }).catch(() => {});
      });
    })
  );
  self.skipWaiting();
});

// Activate: clean old caches
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch: cache-first for local, network-first for Supabase
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // Supabase requests — network only (never cache auth/data)
  if (url.hostname.includes('supabase.co')) {
    e.respondWith(fetch(e.request).catch(() => new Response('{"error":"offline"}', {
      status: 503,
      headers: {'Content-Type': 'application/json'}
    })));
    return;
  }

  // Everything else — cache first, fallback to network
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(response => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE).then(cache => cache.put(e.request, clone));
        }
        return response;
      }).catch(() => {
        // Offline fallback for navigation
        if (e.request.mode === 'navigate') {
          return caches.match('/hadbara360/index.html');
        }
      });
    })
  );
});
