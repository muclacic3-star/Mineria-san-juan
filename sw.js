/* ============================================================
   SERVICE WORKER — Minería San Juan (PWA)
   ¿Qué hace? Guarda una copia de la app en el celular para que:
   1) se pueda instalar como aplicación (requisito de PWABuilder);
   2) abra aunque no haya internet (los datos y las pantallas
      principales quedan disponibles offline).
   Estrategia:
   - Archivos propios: primero la copia guardada (rápido).
   - Librerías externas, imágenes y teselas del mapa: se muestran
     al instante desde la copia y se actualizan en segundo plano.
   ============================================================ */

const VERSION = 'v1.0-jul2026';
const CACHE_APP = 'msj-app-' + VERSION;      // archivos propios
const CACHE_EXT = 'msj-ext-' + VERSION;      // librerías, imágenes, mapa

// Archivos que se guardan apenas se instala la app
const APP_SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-180.png',
  './icons/favicon-32.png'
];

// Al instalar: guardar la base de la app
self.addEventListener('install', function (evento) {
  evento.waitUntil(
    caches.open(CACHE_APP)
      .then(function (cache) { return cache.addAll(APP_SHELL); })
      .then(function () { return self.skipWaiting(); })
  );
});

// Al activar: borrar cachés de versiones anteriores
self.addEventListener('activate', function (evento) {
  evento.waitUntil(
    caches.keys()
      .then(function (claves) {
        return Promise.all(
          claves
            .filter(function (c) { return c.indexOf(VERSION) === -1; })
            .map(function (c) { return caches.delete(c); })
        );
      })
      .then(function () { return self.clients.claim(); })
  );
});

// Cada vez que la app pide un archivo de internet:
self.addEventListener('fetch', function (evento) {
  const pedido = evento.request;
  if (pedido.method !== 'GET') return;

  const url = new URL(pedido.url);

  // Navegación (abrir la app): intentar internet; si no hay, usar la copia
  if (pedido.mode === 'navigate') {
    evento.respondWith(
      fetch(pedido)
        .then(function (respuesta) {
          const copia = respuesta.clone();
          caches.open(CACHE_APP).then(function (cache) {
            cache.put('./index.html', copia);
          });
          return respuesta;
        })
        .catch(function () { return caches.match('./index.html'); })
    );
    return;
  }

  // Archivos propios (íconos, manifiesto): primero la copia guardada
  if (url.origin === self.location.origin) {
    evento.respondWith(
      caches.match(pedido).then(function (guardado) {
        return guardado || fetch(pedido).then(function (respuesta) {
          const copia = respuesta.clone();
          caches.open(CACHE_APP).then(function (cache) {
            cache.put(pedido, copia);
          });
          return respuesta;
        });
      })
    );
    return;
  }

  // Recursos externos (Tailwind, Leaflet, FontAwesome, imágenes,
  // teselas de OpenStreetMap): mostrar la copia al instante y
  // actualizarla en segundo plano para la próxima apertura.
  evento.respondWith(
    caches.open(CACHE_EXT).then(function (cache) {
      return cache.match(pedido).then(function (guardado) {
        const deRed = fetch(pedido).then(function (respuesta) {
          if (respuesta && (respuesta.status === 200 || respuesta.type === 'opaque')) {
            cache.put(pedido, respuesta.clone());
          }
          return respuesta;
        }).catch(function () { return guardado; });
        return guardado || deRed;
      });
    })
  );
});
