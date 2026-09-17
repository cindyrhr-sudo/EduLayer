/**
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║  EduLayer – Service Worker                                      ║
 * ║  Datei: sw.js                                                   ║
 * ║  Zweck: Offline-Caching aller App-Ressourcen                    ║
 * ╚══════════════════════════════════════════════════════════════════╝
 *
 * ANPASSEN:
 * - CACHE_VERSION: Bei Änderungen hochzählen (z.B. 'v2', 'v3')
 *   um den Browser zu zwingen den neuen Cache zu laden.
 * - CACHE_RESSOURCEN: Liste aller Dateien die offline verfügbar
 *   sein sollen. Neue Dateien hier eintragen.
 *
 * ÄNDERUNG v2:
 * - Icon-Dateien (Manifest-Icons, Apple-Touch-Icon, Favicon,
 *   Geodreieck-PNG) sind jetzt explizit im Precache statt nur
 *   optional dynamisch beim ersten Laden gecacht zu werden. Das
 *   macht die Offline-Nutzung zuverlässiger, falls der allererste
 *   Seitenaufruf aus irgendeinem Grund nicht jede Ressource
 *   angefragt hat (z.B. bei sehr kurzem Online-Fenster).
 */

'use strict';

// ── Konfiguration ──────────────────────────────────────────────────
const CACHE_VERSION  = 'edulayer-v2';

// Alle Ressourcen die beim ersten Laden gecacht werden
const CACHE_RESSOURCEN = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.json',
  // App-Icons (Manifest, Apple-Touch-Icon, Favicon)
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
  './icons/favicon.ico',
  // Geodreieck-Overlay-Bild
  './icons/geodreieck.png',
  // CDN-Ressourcen werden ebenfalls gecacht
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/pdf-lib/1.17.1/pdf-lib.min.js',
];


// ── Installation: Alle Ressourcen vorab cachen ────────────────────
self.addEventListener('install', ereignis => {
  console.log('[SW] Installation gestartet');

  ereignis.waitUntil(
    caches.open(CACHE_VERSION)
      .then(cache => {
        console.log('[SW] Ressourcen werden gecacht…');
        // Fehler bei einzelnen Ressourcen sollen die Installation
        // nicht abbrechen → Promise.allSettled statt Promise.all
        return Promise.allSettled(
          CACHE_RESSOURCEN.map(url =>
            cache.add(url).catch(err =>
              console.warn(`[SW] Konnte nicht cachen: ${url}`, err)
            )
          )
        );
      })
      .then(() => {
        console.log('[SW] Installation abgeschlossen');
        // Sofort aktivieren ohne auf bestehende Tabs zu warten
        return self.skipWaiting();
      })
  );
});


// ── Aktivierung: Alten Cache löschen ─────────────────────────────
self.addEventListener('activate', ereignis => {
  console.log('[SW] Aktivierung gestartet');

  ereignis.waitUntil(
    caches.keys()
      .then(cacheNamen => {
        return Promise.all(
          cacheNamen
            .filter(name => name !== CACHE_VERSION)
            .map(name => {
              console.log('[SW] Alter Cache wird gelöscht:', name);
              return caches.delete(name);
            })
        );
      })
      .then(() => {
        console.log('[SW] Aktivierung abgeschlossen');
        // Sofort alle Tabs übernehmen
        return self.clients.claim();
      })
  );
});


// ── Fetch: Cache-First-Strategie ──────────────────────────────────
// Für App-Ressourcen: Erst Cache prüfen, dann Netzwerk
// Für PDF-Dateien (dynamisch): Erst Netzwerk, dann Cache
self.addEventListener('fetch', ereignis => {
  const url = new URL(ereignis.request.url);

  // PDF-Dateien die der Nutzer öffnet: nicht cachen
  // (diese kommen vom lokalen Gerät, nicht vom Netzwerk)
  if (ereignis.request.url.startsWith('blob:') ||
      ereignis.request.url.startsWith('data:')) {
    return; // Nativ behandeln
  }

  ereignis.respondWith(
    caches.match(ereignis.request)
      .then(cachedResponse => {
        if (cachedResponse) {
          // Aus Cache liefern (funktioniert offline)
          return cachedResponse;
        }

        // Nicht im Cache: Vom Netzwerk laden und cachen
        return fetch(ereignis.request)
          .then(networkResponse => {
            // Nur erfolgreiche Antworten cachen
            if (networkResponse && networkResponse.status === 200) {
              const responseKopie = networkResponse.clone();
              caches.open(CACHE_VERSION)
                .then(cache => cache.put(ereignis.request, responseKopie));
            }
            return networkResponse;
          })
          .catch(() => {
            // Offline und nicht im Cache: Fallback auf index.html
            if (ereignis.request.mode === 'navigate') {
              return caches.match('./index.html');
            }
            // Für andere Ressourcen: leere Antwort
            return new Response('', {
              status: 503,
              statusText: 'Offline – Ressource nicht verfügbar',
            });
          });
      })
  );
});
