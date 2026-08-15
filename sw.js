// ═══════════════════════════════════════════════════════════════
// sw.js — INSTA LKOGY Service Worker (Network-First Navigation)
// الكونفيج بييجي من الصفحة تلقائياً عبر Cloudflare Worker
// يدعم: FCM background messages + تذكيرات مجدولة + كاش أوفلاين + صفحات متعددة
// ═══════════════════════════════════════════════════════════════

// ─── Firebase CDN (بيتحمل من النت — مش من سيرفرك) ───────────────
let _firebaseLoaded = false;
try {
    importScripts('https://www.gstatic.com/firebasejs/10.7.1/firebase-app-compat.js');
    importScripts('https://www.gstatic.com/firebasejs/10.7.1/firebase-messaging-compat.js');
    _firebaseLoaded = true;
} catch (e) {
    console.warn('[SW] Firebase CDN not available (offline install):', e.message);
}

// ═══════════════════════════════════════════════════════════════
// IndexedDB helper — لحفظ الكونفيج بين جلسات الـ SW
// (ضروري للـ FCM background لما التطبيق مقفول)
// ═══════════════════════════════════════════════════════════════
const IDB_NAME = 'lkogy-sw-store';
const IDB_VERSION = 763;
const IDB_STORE = 'config';

function _idbOpen() {
    return new Promise(function(resolve, reject) {
        const req = indexedDB.open(IDB_NAME, IDB_VERSION);
        req.onupgradeneeded = function(e) {
            // مهم: نتحقق إن الـ store مش موجود قبل، عشان لو رفعت رقم
            // الإصدار (IDB_VERSION) لاحقًا لإجبار تحديث/كاش جديدة، ما يحصلش
            // خطأ "object store already exists" يكسر تحميل الكونفيج والإشعارات
            const d = e.target.result;
            if (!d.objectStoreNames.contains(IDB_STORE)) d.createObjectStore(IDB_STORE);
        };
        req.onsuccess = function(e) { resolve(e.target.result); };
        req.onerror = function(e) { reject(e.target.error); };
    });
}

function _idbPut(key, value) {
    return _idbOpen().then(function(db) {
        return new Promise(function(resolve, reject) {
            const tx = db.transaction(IDB_STORE, 'readwrite');
            const req = tx.objectStore(IDB_STORE).put(value, key);
            req.onsuccess = function() { resolve(); };
            req.onerror = function(e) { reject(e.target.error); };
        });
    });
}

function _idbGet(key) {
    return _idbOpen().then(function(db) {
        return new Promise(function(resolve, reject) {
            const tx = db.transaction(IDB_STORE, 'readonly');
            const req = tx.objectStore(IDB_STORE).get(key);
            req.onsuccess = function(e) { resolve(e.target.result); };
            req.onerror = function(e) { reject(e.target.error); };
        });
    });
}

// ═══════════════════════════════════════════════════════════════
// Firebase — lazy init بالكونفيج اللي جه من الصفحة
// ═══════════════════════════════════════════════════════════════
let _messagingInited = false;
let _messaging = null;

function _initFirebase(cfg) {
    if (_messagingInited || !_firebaseLoaded || !cfg || !cfg.apiKey) return;
    try {
        if (!firebase.apps.length) { firebase.initializeApp(cfg); }
        _messaging = firebase.messaging();
        _messagingInited = true;
        console.log('[SW] Firebase initialized ✓');

        _messaging.onBackgroundMessage(function(payload) {
            try {
                const n = payload.notification || {};
                const d = payload.data || {};
                const title = n.title || d.title || 'INSTA LKOGY 🔔';
                const body = n.body || d.body || '';
                return self.registration.showNotification(title, {
                    body,
                    icon: n.icon || 'https://insta-lkogy.pages.dev/logo.jpg',
                    badge: 'https://insta-lkogy.pages.dev/logo.jpg',
                    tag: d.tag || 'lkogy-fcm',
                    data: { url: d.url || '/' },
                    vibrate: [200, 100, 200],
                    requireInteraction: !!d.requireInteraction
                });
            } catch (e) {
                console.error('[SW] onBackgroundMessage error:', e);
            }
        });
    } catch (e) {
        console.error('[SW] Firebase init error:', e);
    }
}

// ─── حاول تحمّل الكونفيج من IDB عند بدء الـ SW ──────────────────
_idbGet('firebaseConfig').then(function(cfg) {
    if (cfg) _initFirebase(cfg);
}).catch(function() {});

// ─── استرجع productBaseline من IDB لو الـ SW اتعيد تشغيله ─────
_idbGet('productBaseline').then(function(ids) {
    if (Array.isArray(ids) && ids.length > 0) {
        _productBaseline = new Set(ids);
        console.log('[SW] Restored productBaseline from IDB:', ids.length, 'items');
    }
}).catch(function() {});

// ─── Push Event Fallback (لو Firebase مش متثبت) ──────────────────
self.addEventListener('push', function(event) {
    if (!event.data) return;
    try {
        const payload = event.data.json();
        const n = payload.notification || {};
        const d = payload.data || {};
        const title = n.title || d.title || 'INSTA LKOGY 🔔';
        const body = n.body || d.body || '';
        event.waitUntil(
            self.registration.showNotification(title, {
                body,
                icon: 'https://insta-lkogy.pages.dev/logo.jpg',
                badge: 'https://insta-lkogy.pages.dev/logo.jpg',
                tag: d.tag || 'lkogy-push',
                data: { url: d.url || '/' },
                vibrate: [200, 100, 200]
            })
        );
    } catch (e) { /* JSON parse failed — ignore */ }
});

// ─── Notification Click ──────────────────────────────────────────
self.addEventListener('notificationclick', function(event) {
    event.notification.close();
    const targetUrl = (event.notification.data && event.notification.data.url) || '/';
    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(windowClients) {
            for (const client of windowClients) {
                if (client.url.includes(self.location.origin) && 'focus' in client) {
                    return client.focus();
                }
            }
            if (clients.openWindow) { return clients.openWindow(targetUrl); }
        })
    );
});

// ═══════════════════════════════════════════════════════════════
// تذكيرات مجدولة
// ═══════════════════════════════════════════════════════════════
let _scheduledTimers = [];

function _clearScheduled() {
    _scheduledTimers.forEach(id => clearTimeout(id));
    _scheduledTimers = [];
}

function _showReminderNotif(label, tag) {
    return self.registration.showNotification('INSTA LKOGY ⏰', {
        body: label || 'علمت علي المهام ؟!! متنساش علم علي المهام انهاردة 😉✨',
        icon: 'https://insta-lkogy.pages.dev/logo.jpg',
        badge: 'https://insta-lkogy.pages.dev/logo.jpg',
        tag: tag || 'lkogy-reminder',
        vibrate: [200, 100, 200],
        data: { url: '/' }
    });
}

function _scheduleReminders(reminders) {
    _clearScheduled();
    const msDay = 24 * 60 * 60 * 1000;
    reminders.forEach(function(r, i) {
        let ms = 0;
        if (typeof r.msUntil === 'number') {
            ms = r.msUntil;
        } else if (typeof r.hour === 'number') {
            const now = new Date();
            const target = new Date();
            target.setHours(r.hour, r.minute || 0, 0, 0);
            ms = target - now;
            if (ms <= 0) ms += msDay;
        }
        if (ms < 0) ms = 0;
        const tag = 'lkogy-reminder-' + i;
        const id = setTimeout(function() {
            _showReminderNotif(r.label || r.message, tag);
            _scheduledTimers.push(setTimeout(function() {
                _showReminderNotif(r.label || r.message, tag);
            }, msDay));
        }, ms);
        _scheduledTimers.push(id);
    });
}

let _wheelTimer = null;

function _scheduleWheelReminder(msUntil) {
    if (_wheelTimer) { clearTimeout(_wheelTimer); _wheelTimer = null; }
    if (!msUntil || msUntil <= 0) return;
    _wheelTimer = setTimeout(function() {
        self.registration.showNotification('عجلة الحظ تنتظرك! 🎡', {
            body: 'لسه ما لعبتش عجلة الحظ انهاردة — جرّب حظك دلوقتي!',
            icon: 'https://insta-lkogy.pages.dev/logo.jpg',
            badge: 'https://insta-lkogy.pages.dev/logo.jpg',
            tag: 'lkogy-wheel-reminder',
            vibrate: [300, 100, 300],
            data: { url: '/' }
        });
    }, msUntil);
}

let _productBaseline = null;

// ═══════════════════════════════════════════════════════════════
// Message Handler — الصفحة ← SW
// ═══════════════════════════════════════════════════════════════
self.addEventListener('message', function(event) {
    const msg = event.data || {};
    const type = msg.type || '';
    switch (type) {
        case 'FIREBASE_CONFIG':
            if (msg.config && msg.config.apiKey) {
                _idbPut('firebaseConfig', msg.config).catch(function() {});
                _initFirebase(msg.config);
            }
            break;
        case 'SCHEDULE_REMINDERS':
            if (Array.isArray(msg.reminders)) { _scheduleReminders(msg.reminders); }
            if (typeof msg.wheelMs === 'number') { _scheduleWheelReminder(msg.wheelMs); }
            break;
        case 'SHOW_NOTIFICATION':
            self.registration.showNotification(msg.title || 'INSTA LKOGY', {
                body: msg.body || '',
                icon: msg.icon || 'https://insta-lkogy.pages.dev/logo.jpg',
                badge: 'https://insta-lkogy.pages.dev/logo.jpg',
                tag: msg.tag || 'lkogy-manual',
                data: { url: msg.url || '/' },
                vibrate: [200, 100, 200],
                requireInteraction: !!msg.requireInteraction
            });
            break;
        case 'UPDATE_PRODUCT_BASELINE':
            if (Array.isArray(msg.productIds)) {
                _productBaseline = new Set(msg.productIds);
                // Persist to IDB so it survives SW restarts
                _idbPut('productBaseline', msg.productIds).catch(function() {});
            }
            break;
        case 'CHECK_NEW_PRODUCTS':
            if (Array.isArray(msg.productIds) && _productBaseline) {
                const newIds = msg.productIds.filter(id => !_productBaseline.has(id));
                if (newIds.length > 0) {
                    self.registration.showNotification('منتج جديد في INSTA LKOGY 🛍️', {
                        body: `تم إضافة ${newIds.length} منتج جديد — تفضل اشوف!`,
                        icon: 'https://insta-lkogy.pages.dev/logo.jpg',
                        badge: 'https://insta-lkogy.pages.dev/logo.jpg',
                        tag: 'lkogy-new-product',
                        data: { url: '/' },
                        vibrate: [300, 100, 300]
                    });
                    msg.productIds.forEach(id => _productBaseline.add(id));
                    // Persist updated baseline to IDB
                    _idbPut('productBaseline', Array.from(_productBaseline)).catch(function() {});
                }
            }
            break;
        case 'INIT_CONFIG':
            if (msg.productIds) { _productBaseline = new Set(msg.productIds); }
            break;
        case 'SKIP_WAITING':
            self.skipWaiting();
            break;
        case 'CHECK_FONTS':
            // الصفحة بتطلب من الـ SW يتأكد إن الخط محفوظ ويعمّره لو مختفي
            _warmFontCache().then(function() {
                try { event.source && event.source.postMessage({ type: 'FONTS_CHECKED' }); } catch(e) {}
            });
            break;
        default:
            break;
    }
});

// ═══════════════════════════════════════════════════════════════
// App Shell Cache
// ═══════════════════════════════════════════════════════════════
// اسم الكاش ثابت — لا يتغير مع كل تحديث، المحتوى بيتحدث تلقائياً عبر network-first
const CACHE_NAME = 'insta-lkogy-cache';
const FIREBASE_VER = '11.3.1';
const FIREBASE_CDN = 'https://www.gstatic.com/firebasejs/' + FIREBASE_VER;
const APP_SHELL = [
    './',
    './index.html',
    './index-data-loss.html',
    './manifest.json',
    './logo.jpg',
    FIREBASE_CDN + '/firebase-app.js',
    FIREBASE_CDN + '/firebase-firestore.js',
    FIREBASE_CDN + '/firebase-auth.js',
    FIREBASE_CDN + '/firebase-messaging.js'
];

// ═══════════════════════════════════════════════════════════════
// Font Cache — تثبيت ملفات خط Cairo فعليًا (CSS + كل ملفات woff2)
// ═══════════════════════════════════════════════════════════════
// السبب الحقيقي وراء اختفاء الخط بعد أيام أوفلاين مش "تاريخ صلاحية"
// مكتوب في الكود — Cache Storage في المتصفح مش بيمسح تلقائيًا بنفسه.
// المشكلة إن المتصفحات (خصوصًا Safari على iOS) بتمسح بيانات الموقع
// المخزّنة (Cache Storage / IndexedDB / localStorage) لو الموقع فضل
// من غير فتح/استخدام فعلي لفترة طويلة (في iOS ده معروف بسياسة الـ
// 7 أيام لـ ITP)، أو لو الجهاز محتاج مساحة وبيمسح بيانات المواقع
// الأقل استخدامًا. ده تصرف من نظام التشغيل/المتصفح مش حاجة كودنا
// بيحددها. الحل العملي المتاح فعليًا في الكود:
//   1) نخزّن ملف CSS الخط + كل ملفات woff2 المرتبطة بيه في كاش
//      مخصص ليهم، ونعيد التحقق/التحديث منه في كل مرة الـ SW يشتغل
//      (install + activate) — يعني لو الكاش فضل فاضي أو جزء اتمسح،
//      أول ما يكون فيه نت هيرجع يتعمّر تلقائيًا من غير ما نحتاج
//      تحديث للموقع.
//   2) لو حابب حل أقوى وأكثر ضمانًا: حمّل ملفات woff2 ذاتها داخل
//      مشروعك (نفس origin) بدل الاعتماد على fonts.gstatic.com،
//      وضيفها في APP_SHELL فوق — كده تتفادى أي تعامل خاص مع موارد
//      cross-origin خالص.
//   3) لو التطبيق مُضاف لشاشة الهاتف الرئيسية (Add to Home Screen)
//      وبيفتح بـ "standalone display mode"، نظام iOS بيكون أكثر
//      تسامحًا مع بياناته بالمقارنة بفتحه من المتصفح العادي.
// ═══════════════════════════════════════════════════════════════
const FONT_CACHE   = 'insta-lkogy-fonts-v1';
const FONT_CSS_URL = 'https://fonts.googleapis.com/css2?family=Cairo:wght@400;500;600;700;800;900&display=swap';

function _warmFontCache() {
    return fetch(FONT_CSS_URL, { mode: 'cors', cache: 'reload' })
        .then(function(cssRes) {
            if (!cssRes || !cssRes.ok) return;
            return cssRes.clone().text().then(function(cssText) {
                return caches.open(FONT_CACHE).then(function(cache) {
                    cache.put(FONT_CSS_URL, cssRes.clone()).catch(function() {});
                    var urls = Array.from(cssText.matchAll(/url\((https:\/\/fonts\.gstatic\.com[^)]+)\)/g))
                        .map(function(m) { return m[1]; });
                    return Promise.allSettled(urls.map(function(fontUrl) {
                        return fetch(fontUrl, { mode: 'cors', cache: 'reload' }).then(function(fRes) {
                            if (fRes && fRes.ok) return cache.put(fontUrl, fRes);
                        }).catch(function() {});
                    }));
                });
            });
        })
        .catch(function(err) { console.warn('[SW] Font warm-up failed (probably offline):', err && err.message); });
}

// ─── Install ──────────────────────────────────────────────────
self.addEventListener('install', function(event) {
    console.log('[SW] Installing INSTA LKOGY...');
    event.waitUntil(
        Promise.all([
            caches.open(CACHE_NAME).then(function(cache) {
                return Promise.allSettled(
                    APP_SHELL.map(function(url) {
                        var fetchOpts = { cache: 'reload' };
                        if (typeof url === 'string' && url.startsWith('https://www.gstatic.com')) {
                            fetchOpts.mode = 'cors';
                        }
                        return fetch(url, fetchOpts)
                            .then(function(res) {
                                if (res && res.status === 200) {
                                    const cleanRes = res.redirected
                                        ? new Response(res.body, { status: res.status, statusText: res.statusText, headers: res.headers })
                                        : res;
                                    return cache.put(url, cleanRes);
                                }
                            })
                            .catch(function(err) {
                                console.warn('[SW] Failed to cache (will use existing):', url, err.message);
                            });
                    })
                );
            }),
            _warmFontCache()
        ]).then(function() {
            console.log('[SW] App Shell + Fonts cached ✓');
            return self.skipWaiting();
        })
    );
});

// ─── Activate ─────────────────────────────────────────────────
self.addEventListener('activate', function(event) {
    console.log('[SW] Activated — Network-First Navigation');
    event.waitUntil(
        Promise.all([
            caches.keys().then(function(keys) {
                // احذف بس الكاشات القديمة اللي ليها رقم إصدار (insta-lkogy-v*)
                // الكاش الحالي (insta-lkogy-cache) بيتحدث تدريجياً — مش هيتحذف
                return Promise.all(
                    keys
                        .filter(function(k) { return k !== CACHE_NAME && k !== FONT_CACHE && /^insta-lkogy-v\d/.test(k); })
                        .map(function(k) {
                            console.log('[SW] Removing old versioned cache:', k);
                            return caches.delete(k);
                        })
                );
            }),
            // إعادة تأكيد/تعمير كاش الخط في كل مرة الـ SW يشتغل —
            // ده "self-heal" دوري بيحصل من غير ما المستخدم يحتاج يحدّث التطبيق
            _warmFontCache()
        ]).then(function() {
            return clients.claim();
        })
    );
});

// ─── Fetch Strategy ───────────────────────────────────────────
// Helper: clone a response safely for caching (strip redirect flag)
function _cloneForCache(res) {
    if (!res || !res.ok) return null;
    try {
        return res.redirected
            ? new Response(res.clone().body, { status: 200, statusText: 'OK', headers: res.headers })
            : res.clone();
    } catch (e) { return null; }
}

var _offlineHTML = '<!DOCTYPE html><html lang="ar"><body dir="rtl" style="text-align:center;padding:40px;font-family:Cairo,sans-serif;background:#0a0a1a;color:#e2e8f0"><h2 style="color:#FF6B35">⚠️ لا يوجد اتصال بالإنترنت</h2><p>يرجى التحقق من اتصالك ثم أعِد التحميل</p><button onclick="location.reload()" style="margin-top:20px;padding:10px 28px;border-radius:10px;border:none;background:#7c3aed;color:#fff;font-size:1em;cursor:pointer;font-family:Cairo,sans-serif">🔄 إعادة المحاولة</button></body></html>';

self.addEventListener('fetch', function(event) {
    if (event.request.method !== 'GET') return;
    var url = event.request.url;

    if (!url.startsWith('http://') && !url.startsWith('https://')) return;

    // ── تجاوز كل طلبات Firebase API الحيّة (مش CDN) ──────────────
    if (
        url.includes('firestore.googleapis.com') ||
        url.includes('fcm.googleapis.com') ||
        url.includes('identitytoolkit.googleapis.com') ||
        url.includes('securetoken.googleapis.com') ||
        (url.includes('googleapis.com') && !url.includes('gstatic.com'))
    ) return;

    // ── Navigation requests (تحميل الصفحة الرئيسية) ───────────────
    // استراتيجية: Network-First بـ event.request الأصلي (مش URL مُنشأ يدوياً)
    // لو النت نجح ورجع res.ok → خدم الصفحة وحدّث الكاش
    // لو النت فشل أو رجع خطأ → ارجع للكاش
    // لو الكاش مش موجود → صفحة offline
    if (event.request.mode === 'navigate') {
        event.respondWith(
            fetch(event.request, { cache: 'no-cache' })
                .then(function(res) {
                    if (res && res.ok) {
                        // ✅ النت نجح — خدّث الكاش في الخلفية
                        var toCache = _cloneForCache(res);
                        if (toCache) {
                            caches.open(CACHE_NAME).then(function(c) {
                                c.put(event.request, toCache);
                            }).catch(function() {});
                        }
                        return res;
                    }
                    // 🔴 رجع status غير 200 (مثلاً redirect أو 404) → ارجع للكاش
                    return caches.match(event.request)
                        .then(function(cached) {
                            return cached
                                || caches.match(new Request(self.location.origin + '/'))
                                || new Response(_offlineHTML, { headers: { 'Content-Type': 'text/html;charset=utf-8' } });
                        }).catch(function() {
                            return new Response(_offlineHTML, { headers: { 'Content-Type': 'text/html;charset=utf-8' } });
                        });
                })
                .catch(function() {
                    // 🔴 أوفلاين كامل — ارجع للكاش
                    return caches.match(event.request)
                        .then(function(cached) {
                            if (cached) return cached;
                            return caches.match(new Request(self.location.origin + '/'))
                                .then(function(root) {
                                    return root || new Response(_offlineHTML, { headers: { 'Content-Type': 'text/html;charset=utf-8' } });
                                }).catch(function() {
                                    return new Response(_offlineHTML, { headers: { 'Content-Type': 'text/html;charset=utf-8' } });
                                });
                        }).catch(function() {
                            return new Response(_offlineHTML, { headers: { 'Content-Type': 'text/html;charset=utf-8' } });
                        });
                })
        );
        return;
    }

    // ── ملفات ثابتة (CSS / JS / صور / Firebase CDN) ───────────────
    // استراتيجية: Cache-First + تحديث في الخلفية
    event.respondWith(
        caches.match(event.request).then(function(cached) {
            // تحديث في الخلفية دائماً
            var networkFetch = fetch(event.request, { cache: 'no-cache' }).then(function(res) {
                if (res && res.ok) {
                    var toCache = _cloneForCache(res);
                    if (toCache) {
                        caches.open(CACHE_NAME).then(function(c) {
                            c.put(event.request, toCache);
                        }).catch(function() {});
                    }
                }
                return res;
            }).catch(function() {
                return cached || new Response('', { status: 503, statusText: 'Service Unavailable' });
            });

            // لو في كاش → ارجعه فوراً والتحديث يحصل في الخلفية
            return cached || networkFetch;
        })
    );
});
