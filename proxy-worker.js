/*
 * Cloudflare Worker для cinema-github-io.*.workers.dev
 *
 *  /proxy?u=<encoded url>  — CORS-посередник для hls.js (плейлисти, сегменти, ключі)
 *  /proxy?u=ping           — перевірка, що посередник живий (відповідь "ok")
 *  усе інше                — статичні файли репо (index.html тощо) через env.ASSETS
 *
 * Навіщо Worker, а не functions/proxy.js: папка functions/ працює лише в
 * проєктах Cloudflare Pages (*.pages.dev). На *.workers.dev її ігнорують,
 * і /proxy віддавав index.html/404.
 *
 * Посередник лише додає CORS-заголовки, щоб браузер дозволив hls.js прочитати
 * відповідь. Відповідь сервера відео (включно з 403/404) передається як є.
 */
 
// Дозволені хости (сам домен і всі його піддомени). Без списку це був би
// відкритий проксі для будь-кого в інтернеті.
const ALLOWED_HOSTS = ['ashdi.vip'];
 
// Заголовки відповіді, які пропускаємо від сервера відео до браузера.
const PASS_HEADERS = [
    'content-type', 'content-length', 'content-range', 'accept-ranges',
    'cache-control', 'expires', 'last-modified', 'etag',
];
 
const CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
    'Access-Control-Allow-Headers': 'Range, Content-Type',
    'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges, Content-Type, X-Proxy-Status',
    'Access-Control-Max-Age': '86400',
};
 
function hostAllowed(hostname) {
    const h = hostname.toLowerCase();
    return ALLOWED_HOSTS.some((a) => h === a || h.endsWith('.' + a));
}
 
// Власні помилки посередника теж мають X-Proxy-Status — плеєр бачить,
// що відповів саме проксі, а не хостинг.
function fail(status, msg) {
    return new Response(msg + '\n', {
        status,
        headers: { ...CORS, 'Content-Type': 'text/plain; charset=utf-8', 'X-Proxy-Status': 'proxy-' + status },
    });
}
 
async function proxy(request, url) {
    if (request.method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: CORS });
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
        return fail(405, 'method not allowed');
    }
 
    const raw = url.searchParams.get('u');
    if (!raw) return fail(400, 'missing ?u=');
    if (raw === 'ping') {
        return new Response('ok\n', {
            headers: { ...CORS, 'Content-Type': 'text/plain; charset=utf-8', 'X-Proxy-Status': 'ping', 'Cache-Control': 'no-store' },
        });
    }
 
    let target;
    try { target = new URL(raw); } catch { return fail(400, 'bad url'); }
    if (target.protocol !== 'https:' && target.protocol !== 'http:') return fail(400, 'bad protocol');
    if (!hostAllowed(target.hostname)) return fail(403, 'host not allowed: ' + target.hostname);
 
    const headers = new Headers();
    const range = request.headers.get('range');
    if (range) headers.set('Range', range);
    headers.set('Accept', request.headers.get('accept') || '*/*');
    headers.set('Accept-Language', request.headers.get('accept-language') || 'uk,en;q=0.8');
    headers.set('User-Agent', request.headers.get('user-agent') || 'Mozilla/5.0');
 
    let upstream;
    try {
        upstream = await fetch(target.toString(), { method: request.method, headers, redirect: 'follow' });
    } catch (e) {
        return fail(502, 'upstream fetch failed: ' + (e && e.message || e));
    }
 
    // Редирект міг піти на чужий хост — перевіряємо кінцеву адресу.
    try {
        const finalHost = new URL(upstream.url || target.toString()).hostname;
        if (!hostAllowed(finalHost)) return fail(403, 'redirect to disallowed host: ' + finalHost);
    } catch {}
 
    const out = new Headers(CORS);
    for (const k of PASS_HEADERS) {
        const v = upstream.headers.get(k);
        if (v) out.set(k, v);
    }
    out.set('X-Proxy-Status', String(upstream.status));
 
    return new Response(request.method === 'HEAD' ? null : upstream.body, {
        status: upstream.status,
        statusText: upstream.statusText,
        headers: out,
    });
}
 
export default {
    async fetch(request, env) {
        const url = new URL(request.url);
        if (url.pathname === '/proxy' || url.pathname === '/proxy/') {
            return proxy(request, url);
        }
        return env.ASSETS.fetch(request);
    },
};
