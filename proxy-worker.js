/**
 * Cloudflare Worker для сайту плеєра.
 *  - /proxy?u=<посилання ashdi>  → посередник (сервер сам забирає відео з ashdi)
 *  - все інше (index.html тощо)  → звичайні файли сайту з репозиторію
 * Плеєр звертається до /proxy ТІЛЬКИ коли напряму не вийшло (ПК з Telegram
 * Desktop); телефони грають напряму.
 */
const ALLOWED = ['ashdi.vip'];

const allowed = (host) => ALLOWED.some(h => host === h || host.endsWith('.' + h));

function text(msg, status) {
  return new Response(msg, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}

async function proxy(request) {
  const raw = new URL(request.url).searchParams.get('u');
  if (!raw) return text('proxy ok', 200);

  let target;
  try { target = new URL(raw); } catch { return text('bad url', 400); }
  if (target.protocol !== 'https:' && target.protocol !== 'http:') return text('bad protocol', 400);
  if (!allowed(target.hostname)) return text('host not allowed: ' + target.hostname, 403);

  // Запит виглядає так само, як від власного плеєра ashdi.
  const headers = new Headers({
    'Accept': '*/*',
    'Referer': 'https://ashdi.vip/',
    'Origin': 'https://ashdi.vip',
    'User-Agent': request.headers.get('User-Agent') || 'Mozilla/5.0',
  });
  const range = request.headers.get('Range');
  if (range) headers.set('Range', range);

  let up;
  try {
    up = await fetch(target.href, { headers, redirect: 'follow' });
  } catch (e) {
    return text('upstream error: ' + (e && e.message || e), 502);
  }
  if (!allowed(new URL(up.url || target.href).hostname)) return text('redirect not allowed', 403);

  const out = new Headers();
  for (const k of ['Content-Type', 'Content-Length', 'Content-Range', 'Accept-Ranges', 'Last-Modified', 'ETag']) {
    const v = up.headers.get(k);
    if (v) out.set(k, v);
  }
  // Плейлисти не кешуємо (у них токени), сегменти — можна.
  const isPlaylist = /\.m3u8(\?|$)/i.test(target.pathname) || (up.headers.get('Content-Type') || '').includes('mpegurl');
  out.set('Cache-Control', isPlaylist ? 'no-store' : 'public, max-age=3600');
  out.set('Access-Control-Allow-Origin', '*');

  return new Response(up.body, { status: up.status, headers: out });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/proxy' || url.pathname === '/proxy/') return proxy(request);
    return env.ASSETS.fetch(request);
  },
};
