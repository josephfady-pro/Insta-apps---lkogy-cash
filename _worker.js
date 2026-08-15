// ═══════════════════════════════════════════════════════════════
// _worker.js — Cloudflare Pages Worker
// يجيب Firebase + imgbb + Cloudinary secrets من env vars
// المفاتيح محميّة في Cloudflare Secrets — مش موجودة في الكود
// ═══════════════════════════════════════════════════════════════

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // ─── / أو /index.html → حقن الكونفيج في HTML ──────────────
    if (url.pathname === '/' || url.pathname === '/index.html') {
      const response = await env.ASSETS.fetch(request);

      // لو الاستجابة مش HTML، ابعتها عادي
      const ct = response.headers.get('content-type') || '';
      if (!ct.includes('text/html')) return response;

      return new HTMLRewriter()
        .on('head', new ConfigInjector(env))
        .transform(response);
    }

    // ─── أي طلب تاني → ابعته عادي ─────────────────────────────
    return env.ASSETS.fetch(request);
  }
};

// ═══════════════════════════════════════════════════════════════
// ConfigInjector — بيحقن window.__LKOGY_CONFIG__ في أول <head>
// ═══════════════════════════════════════════════════════════════
class ConfigInjector {
  constructor(env) {
    this.env = env;
  }

  element(element) {
    const cfg = {
      firebase: {
        apiKey:            this.env.FIREBASE_API_KEY             || '',
        authDomain:        this.env.FIREBASE_AUTH_DOMAIN         || '',
        projectId:         this.env.FIREBASE_PROJECT_ID          || '',
        storageBucket:     this.env.FIREBASE_STORAGE_BUCKET      || '',
        messagingSenderId: this.env.FIREBASE_MESSAGING_SENDER_ID || '',
        appId:             this.env.FIREBASE_APP_ID              || '',
        measurementId:     this.env.FIREBASE_MEASUREMENT_ID      || ''
      },
      fcmVapidKey:        this.env.FCM_VAPID_KEY                 || '',
      // ─── Upload keys ───────────────────────────────────────────
      imgbbKey:           this.env.IMGBB_KEY                     || '',
      cloudinaryCloud:    this.env.CLOUDINARY_CLOUD              || '',
      cloudinaryPreset:   this.env.CLOUDINARY_PRESET             || '',
      // ─── Push Worker (Cloudflare Worker للإشعارات الخارجية) ───
      pushWorkerUrl:      this.env.PUSH_WORKER_URL               || '',
      pushSecret:         this.env.PUSH_WORKER_SECRET            || ''
    };

    // ① الكونفيج نفسه — بيتوضع أول حاجة في <head>
    const cfgScript = `window.__LKOGY_CONFIG__ = ${JSON.stringify(cfg)};`;

    // ② سكريبت يبعت الكونفيج للـ Service Worker تلقائياً
    const swBridgeScript = `
(function() {
  var _cfg = window.__LKOGY_CONFIG__;
  if (!_cfg || !('serviceWorker' in navigator)) return;

  function _sendCfg(sw) {
    if (sw && sw.state !== 'redundant') {
      sw.postMessage({ type: 'FIREBASE_CONFIG', config: _cfg });
    }
  }

  navigator.serviceWorker.ready.then(function(reg) {
    _sendCfg(reg.active);
  });

  navigator.serviceWorker.addEventListener('controllerchange', function() {
    _sendCfg(navigator.serviceWorker.controller);
  });
})();
`.trim();

    // حقن السكريبتين في أول <head> قبل أي حاجة تانية
    element.prepend(
      `<script>${cfgScript}</script><script defer>${swBridgeScript}</script>`,
      { html: true }
    );
  }
}
