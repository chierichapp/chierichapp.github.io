/**
 * Service Worker per supporto PWA (Progressive Web App)
 * 
 * Funzionalità:
 * - Cache delle risorse offline
 * - Aggiornamenti automatici
 * - Installazione come app nativa
 */
<<<<<<< Updated upstream

const CACHE_NAME = 'chierichetti-v3';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/webapp.html',
  '/manifest.json',
  '/icons/icon-192x192.png',
  '/icons/icon-512x512.png'
=======
const CACHE_NAME = 'chierichapp-v6';
const PRECACHE = [
  './',
  './index.html',
  './js/supabase-api.js',
  './icons/icon-192x192.png',
  './icons/icon-512x512.png',
  './icons/apple-touch-icon.png',
  './icons/favicon-32x32.png',
  './icons/favicon-16x16.png'
>>>>>>> Stashed changes
];

// Installazione - Cache risorse
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('Cache delle risorse statiche');
        return cache.addAll(STATIC_ASSETS);
      })
      .catch(err => console.log('Errore cache install:', err))
  );
});

// Attivazione - Pulizia vecchie cache
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keyList) => {
      return Promise.all(
        keyList.map((key) => {
          if (key !== CACHE_NAME) {
            console.log('Eliminazione cache vecchia:', key);
            return caches.delete(key);
          }
        })
      );
    })
  );
});

// Fetch - Interceptar richieste
self.addEventListener('fetch', (event) => {
<<<<<<< Updated upstream
  event.respondWith(
    caches.match(event.request)
      .then((response) => {
        const fetchPromise = fetch(event.request).then((networkResponse) => {
          // Cache risposte con strategia network-first
          if (networkResponse && networkResponse.status === 200) {
            const responseClone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, responseClone);
            });
          }
          return networkResponse;
        });
        
        return response || fetchPromise;
      })
  );
=======
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // API / auth: passa sempre in rete
  if (
    url.hostname.includes('supabase.co')
    || url.pathname.includes('/auth/')
    || url.pathname.includes('/rest/')
    || url.pathname.includes('/realtime/')
  ) {
    return;
  }

  // CDN font / supabase-js: SWR
  if (
    url.hostname === 'fonts.googleapis.com'
    || url.hostname === 'fonts.gstatic.com'
    || url.hostname === 'cdn.jsdelivr.net'
  ) {
    event.respondWith(staleWhileRevalidate(request));
    return;
  }

  if (!sameOrigin(url)) return;

  // Manifest sempre fresco (display mode installazione)
  if (url.pathname.endsWith('/manifest.json') || url.pathname.endsWith('manifest.json')) {
    event.respondWith(networkFirst(request));
    return;
  }

  if (isNavigation(request, url)) {
    event.respondWith(networkFirst(request));
    return;
  }

  // Asset locali (js, icone)
  event.respondWith(staleWhileRevalidate(request));
>>>>>>> Stashed changes
});

// Push Notification (opzionale - per future espansioni)
self.addEventListener('push', (event) => {
  const data = event.data ? JSON.parse(event.data.text()) : {};
  const title = data.title || 'Gestione Chierichetti';
  const options = {
    body: data.body || 'Nuova notifica',
    icon: '/icons/icon-192x192.png',
    badge: '/icons/icon-72x72.png'
  };
  
  event.waitUntil(
    self.registration.showNotification(title, options)
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    clients.openWindow('/')
  );
});
