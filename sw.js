// הדברה 360 — Service Worker v2
// תכונות: cache-first, offline queue, auto-update

const VERSION = 'hadbara360-v22';
const ASSETS = [
  '/hadbara360/',
  '/hadbara360/index.html',
  '/hadbara360/manifest.json',
];
const CDN_ASSETS = [
  'https://unpkg.com/react@18.2.0/umd/react.production.min.js',
  'https://unpkg.com/react-dom@18.2.0/umd/react-dom.production.min.js',
  'https://unpkg.com/@babel/standalone@7.23.5/babel.min.js',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.39.3/dist/umd/supabase.js',
];

// ─── Offline Queue (IndexedDB) ─────────────────────────────────────────────
const DB_NAME = 'h360-offline-queue';
const DB_VERSION = 1;

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = e => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('queue')) {
        const store = db.createObjectStore('queue', { keyPath: 'id', autoIncrement: true });
        store.createIndex('by_time', 'ts');
      }
    };
    req.onsuccess = e => resolve(e.target.result);
    req.onerror = e => reject(e.target.error);
  });
}

async function enqueueRequest(request) {
  try {
    const body = await request.text();
    const db = await openDB();
    const tx = db.transaction('queue', 'readwrite');
    tx.objectStore('queue').add({
      url: request.url,
      method: request.method,
      headers: Object.fromEntries(request.headers.entries()),
      body,
      ts: Date.now(),
    });
    await new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = rej; });
    db.close();
    console.log('[SW] Queued offline request:', request.url);
  } catch (e) {
    console.warn('[SW] Failed to enqueue:', e);
  }
}

async function flushQueue() {
  let db;
  try {
    db = await openDB();
    const tx = db.transaction('queue', 'readonly');
    const all = await new Promise((res, rej) => {
      const req = tx.objectStore('queue').getAll();
      req.onsuccess = e => res(e.target.result);
      req.onerror = rej;
    });

    if (!all || all.length === 0) return;
    console.log('[SW] Flushing', all.length, 'queued requests');

    const succeeded = [];
    for (const item of all) {
      try {
        const resp = await fetch(item.url, {
          method: item.method,
          headers: item.headers,
          body: item.method !== 'GET' ? item.body : undefined,
        });
        if (resp.ok || resp.status === 409) {
          // 409 = conflict (already exists) — treat as success
          succeeded.push(item.id);
        }
      } catch (e) {
        // Still offline, stop flushing
        break;
      }
    }

    if (succeeded.length > 0) {
      const tx2 = db.transaction('queue', 'readwrite');
      const store = tx2.objectStore('queue');
      succeeded.forEach(id => store.delete(id));
      await new Promise((res, rej) => { tx2.oncomplete = res; tx2.onerror = rej; });
      console.log('[SW] Flushed', succeeded.length, 'requests');

      // Tell clients to refresh data
      const clients = await self.clients.matchAll({ includeUncontrolled: true });
      clients.forEach(c => c.postMessage({ type: 'OFFLINE_SYNC_DONE', count: succeeded.length }));
    }
  } catch (e) {
    console.warn('[SW] flushQueue error:', e);
  } finally {
    if (db) db.close();
  }
}

// ─── Install ───────────────────────────────────────────────────────────────
self.addEventListener('install', e => {
  console.log('[SW] Installing', VERSION);
  e.waitUntil(
    caches.open(VERSION).then(async cache => {
      // Cache local assets
      try { await cache.addAll(ASSETS); } catch(err) { console.warn('[SW] ASSETS cache fail:', err); }
      // Cache CDN assets (best effort)
      await Promise.allSettled(CDN_ASSETS.map(async url => {
        try {
          const r = await fetch(url);
          if (r.ok) await cache.put(url, r);
        } catch(e) {}
      }));
    })
  );
  // Take over immediately — do NOT skipWaiting here (we want controlled update)
});

// ─── Activate ─────────────────────────────────────────────────────────────
self.addEventListener('activate', e => {
  console.log('[SW] Activating', VERSION);
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== VERSION).map(k => {
        console.log('[SW] Deleting old cache:', k);
        return caches.delete(k);
      }))
    ).then(() => self.clients.claim())
  );
});

// ─── Message from app ─────────────────────────────────────────────────────
self.addEventListener('message', e => {
  if (e.data && e.data.type === 'SKIP_WAITING') {
    console.log('[SW] SKIP_WAITING received — updating now');
    self.skipWaiting();
  }
  if (e.data && e.data.type === 'FLUSH_QUEUE') {
    flushQueue();
  }
});

// ─── Online event — flush queue ───────────────────────────────────────────
self.addEventListener('sync', e => {
  if (e.tag === 'offline-sync') {
    e.waitUntil(flushQueue());
  }
});

// ─── Fetch ────────────────────────────────────────────────────────────────
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // ── Supabase API calls ──────────────────────────────────────────────────
  if (url.hostname.includes('supabase.co')) {
    // Only queue write operations (POST/PATCH/DELETE/PUT)
    if (['POST', 'PATCH', 'DELETE', 'PUT'].includes(e.request.method)) {
      e.respondWith(
        fetch(e.request.clone()).catch(async () => {
          // Offline — queue the request
          await enqueueRequest(e.request.clone());
          return new Response(JSON.stringify({ queued: true, offline: true }), {
            status: 202,
            headers: { 'Content-Type': 'application/json' }
          });
        })
      );
    } else {
      // GET — network only, no cache
      e.respondWith(
        fetch(e.request).catch(() =>
          new Response('{"error":"offline"}', {
            status: 503,
            headers: { 'Content-Type': 'application/json' }
          })
        )
      );
    }
    return;
  }

  // ── Everything else: cache-first ────────────────────────────────────────
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) {
        // Also try to refresh in background (stale-while-revalidate)
        const fetchPromise = fetch(e.request).then(response => {
          if (response && response.ok) {
            caches.open(VERSION).then(cache => cache.put(e.request, response.clone()));
          }
          return response;
        }).catch(() => {});
        return cached;
      }

      return fetch(e.request).then(response => {
        if (response && response.ok) {
          const clone = response.clone();
          caches.open(VERSION).then(cache => cache.put(e.request, clone));
        }
        return response;
      }).catch(() => {
        // Offline fallback for page navigation
        if (e.request.mode === 'navigate') {
          return caches.match('/hadbara360/index.html');
        }
        return new Response('', { status: 503 });
      });
    })
  );
});

// ─── Periodic flush when online ───────────────────────────────────────────
// Listen for "online" via clients
self.addEventListener('message', e => {
  if (e.data && e.data.type === 'ONLINE') {
    flushQueue();
  }
});

// ─── Push notifications (לידים חדשים, תורים חדשים למדביר) ─────────────────
self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (_) { d = { body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(d.title || 'הדברה 360', {
    body: d.body || '',
    icon: '/hadbara360/icon-192.png',
    badge: '/hadbara360/badge-96.png',
    tag: d.tag || 'h360',
    renotify: true,
    dir: 'rtl',
    lang: 'he',
    data: { url: d.url || '/hadbara360/' },
  }));
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || '/hadbara360/';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    for (const c of list) { if (c.url.includes('/hadbara360/') && 'focus' in c) return c.focus(); }
    return self.clients.openWindow(url);
  }));
});
