/**
 * Service Worker per supporto PWA (Progressive Web App)
 * 
 * Funzionalità:
 * - Cache delle risorse offline
 * - Aggiornamenti automatici
 * - Installazione come app nativa
 */

const CACHE_NAME = 'chierichetti-v2';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/webapp.html',
  '/manifest.json',
  '/icons/icon-192x192.png',
  '/icons/icon-512x512.png'
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
