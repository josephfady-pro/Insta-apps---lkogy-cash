/**
 * ============================================================
 * Service Worker — lkogy Manager
 * يجمع بين:
 *   1. FCM background messaging (إشعارات لما الـ tab مش مفتوح)
 *   2. PWA offline caching (الصفحة تشتغل أوفلاين بعد أول زيارة)
 * ============================================================
 *
 * Firebase Config يُحقن عبر رسالة من الصفحة (postMessage)
 * —— المفاتيح ليست موجودة في الكود المصدر
 */

// ======================================================
// قسم FCM (ديناميكي)
// ======================================================
importScripts('https://www.gstatic.com/firebasejs/10.8.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.8.0/firebase-messaging-compat.js');

let messaging = null;
let firebaseInitialized = false;

// استقبال الكونفيغ من الصفحة
self.addEventListener('message', function(event) {
  const data = event.data;
  if (data && data.type === 'FIREBASE_CONFIG' && data.config && data.config.firebase) {
    const firebaseConfig = data.config.firebase;
    if (!firebaseInitialized) {
      firebase.initializeApp(firebaseConfig);
      messaging = firebase.messaging();
      firebaseInitialized = true;

      // تسجيل مستمع الإشعارات الخلفية
      messaging.onBackgroundMessage(function(payload) {
        console.log('[SW] Background FCM message:', payload);

        const notificationTitle = payload.notification?.title || 'منتج جديد نزل 🛍️🛒';
        const notificationOptions = {
          body: payload.notification?.body || 'خش شوفه و الحق اشتري 🛒✨',
          icon: payload.notification?.icon || 'https://insta-lkogy.pages.dev/WEb%20icon-modified.png',
          image: payload.notification?.image || payload.notification?.icon,
          badge: 'https://insta-lkogy.pages.dev/WEb%20icon-modified.png',
          data: payload.data || {},
          requireInteraction: true,
          vibrate: [200, 100, 200],
          actions: [
            { action: 'open', title: 'فتح التطبيق' },
            { action: 'dismiss', title: 'إغلاق' }
          ]
        };

        self.registration.showNotification(notificationTitle, notificationOptions);
      });

      // إرسال تأكيد للصفحة (اختياري)
      if (event.ports && event.ports[0]) {
        event.ports[0].postMessage({ status: 'initialized' });
      }
    }
  }
});

// فتح التطبيق عند الضغط على الإشعار
self.addEventListener('notificationclick', function(event) {
  event.notification.close();

  if (event.action === 'dismiss') return;

  const urlToOpen = event.notification.data?.click_action
    || event.notification.data?.clickAction
    || 'https://insta-lkogy.pages.dev/';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(clientList) {
      for (const client of clientList) {
        if (client.url === urlToOpen && 'focus' in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(urlToOpen);
      }
    })
  );
});

// ======================================================
// قسم PWA Offline Cache (يبقى كما هو)
// ======================================================
const CACHE_NAME = 'lkogy-manager-v2';

const STATIC_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './logo.jpg',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css',
  'https://cdn.rawgit.com/davidshimjs/qrcodejs/gh-pages/qrcode.min.js'
];

self.addEventListener('install', function(event) {
  console.log('[SW] Installing v2...');
  event.waitUntil(
    caches.open(CACHE_NAME).then(function(cache) {
      return cache.addAll(STATIC_ASSETS.map(url => {
        return new Request(url, { cache: 'reload' });
      })).catch(err => {
        console.warn('[SW] Some assets failed to cache:', err.message);
      });
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', function(event) {
  console.log('[SW] Activating...');
  event.waitUntil(
    caches.keys().then(function(cacheNames) {
      return Promise.all(
        cacheNames
          .filter(name => name !== CACHE_NAME)
          .map(name => caches.delete(name))
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', function(event) {
  const url = event.request.url;
  if (
    url.includes('firestore.googleapis.com') ||
    url.includes('firebase.googleapis.com') ||
    url.includes('i.ibb.co') ||
    url.includes('api.imgbb.com') ||
    url.includes('googleapis.com/identitytoolkit') ||
    event.request.method !== 'GET'
  ) {
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then(function(response) {
        if (response && response.status === 200) {
          const responseClone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, responseClone));
        }
        return response;
      })
      .catch(function() {
        return caches.match(event.request).then(function(cached) {
          if (cached) return cached;
          if (event.request.destination === 'document') {
            return caches.match('./') || caches.match('./index.html');
          }
        });
      })
  );
});
