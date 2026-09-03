// ============================================================
// TSG Metronome & Tuner — Service Worker（オフライン対応）
// ============================================================
// 方針（更新事故を起こさないための設計）
//   ・ページ本体(index.html)は「ネット優先」：オンラインなら必ず最新版を取りに行く。
//     電波が無い／4秒応答が無い時だけ、保存しておいたコピーで起動する。
//     → 更新をpushすれば、オンラインで開いた人には今までどおり即反映される。
//   ・画像・音源・外部ライブラリは「保存版優先＋裏で更新」：一度取ったものは
//     端末に保存し、次回からは保存版で即表示しつつ、裏で新しいものを取り直す。
//     → ファイルを差し替えても、次の次の起動までには自動で新しくなる。
//
// CACHE の版名を上げるべき時：音源・アイコンなど「index.html以外のファイル」を
//   追加・削除した時（古い保存内容を確実に捨てるため）。index.htmlの修正だけなら不要。
// ============================================================
const CACHE = 'tsg-metro-v1';

// 初回オンライン時に必ず保存しておく「オフライン起動に必要な最小セット」
const CORE = [
  './',
  './index.html',
  './manifest.json',
  './images/favicon-64.png',
  './images/apple-touch-icon-180.png',
  './images/icon-192.png',
  './images/icon-512.png',
  './images/icon-192-maskable.png',
  './images/icon-512-maskable.png',
  './images/icon-8th-shuffle.png',
  './images/icon-16th-shuffle.png',
  './sounds/snare/Snare02.mp3',
  './sounds/voice/v1.mp3', './sounds/voice/v2.mp3', './sounds/voice/v3.mp3', './sounds/voice/v4.mp3',
  './sounds/voice/v5.mp3', './sounds/voice/v6.mp3', './sounds/voice/v7.mp3',
  './sounds/voice/va.mp3', './sounds/voice/vu.mp3', './sounds/voice/vi.mp3', './sounds/voice/vo.mp3',
];

// あれば嬉しいが、失敗しても導入を止めないもの（外部CDNのライブラリ）
const OPTIONAL = [
  'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js',
  'https://cdn.jsdelivr.net/npm/sortablejs@1.15.2/Sortable.min.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(CORE);
    // 外部ライブラリは1つずつ試し、失敗しても続行。
    // ※ cache.add() は外部サイトの「不透明な応答（status 0）」を拒否するため、
    //    fetch → put で手動保存する（put は不透明応答でも保存できる）
    await Promise.allSettled(OPTIONAL.map(async (url) => {
      const res = await fetch(new Request(url, { mode: 'no-cors' }));
      await cache.put(url, res);
    }));
    await self.skipWaiting(); // 新しいSWをすぐ有効化
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    // 古い版の保存領域を掃除
    const keys = await caches.keys();
    await Promise.all(keys
      .filter((k) => k.startsWith('tsg-metro-') && k !== CACHE)
      .map((k) => caches.delete(k)));
    await self.clients.claim(); // 開いているページにも即適用
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;

  // ① ページ本体：ネット優先（タイムアウト付き）→ 保存版
  const isPage = req.mode === 'navigate' ||
    (sameOrigin && (url.pathname.endsWith('/') || url.pathname.endsWith('/index.html')));
  if (isPage) {
    event.respondWith(networkFirstPage(req));
    return;
  }

  // ② 同一オリジンの素材（画像・音源）：保存版優先＋裏で更新
  if (sameOrigin) {
    event.respondWith(staleWhileRevalidate(req));
    return;
  }

  // ③ 外部（CDNライブラリ・フォント）：保存版優先→無ければネット（版が固定なので更新不要）
  event.respondWith(cacheFirst(req));
});

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms);
    promise.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

async function networkFirstPage(req) {
  const cache = await caches.open(CACHE);
  try {
    const res = await withTimeout(fetch(req), 4000);
    if (res && res.ok) cache.put('./index.html', res.clone()); // 最新版を保存（次のオフライン起動用）
    return res;
  } catch (e) {
    const cached = await cache.match('./index.html');
    if (cached) return cached;
    throw e;
  }
}

async function staleWhileRevalidate(req) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(req);
  const refresh = fetch(req).then((res) => {
    if (res && res.ok) cache.put(req, res.clone());
    return res;
  }).catch(() => null);
  if (cached) { refresh.catch(() => {}); return cached; } // 裏で更新しつつ即返す
  const res = await refresh;
  if (res) return res;
  throw new Error('offline and not cached: ' + req.url);
}

async function cacheFirst(req) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(req);
  if (cached) return cached;
  const res = await fetch(req);
  if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone());
  return res;
}
