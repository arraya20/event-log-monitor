const ALLOWED = new Set(['/api/status', '/api/events']);
const MAX_BODY = 1_000_000;
function collectorOrigin(raw) {
  let url;
  try { url = new URL(raw); } catch { throw new Error('Invalid collector origin'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('Collector origin must be an HTTPS origin');
  return url;
}
export async function onRequest(context) {
  const requestUrl = new URL(context.request.url);
  if (context.request.method !== 'GET') return new Response(JSON.stringify({ error: 'GET only' }), { status: 405, headers: { allow: 'GET', 'content-type': 'application/json', 'cache-control': 'no-store' } });
  if (!ALLOWED.has(requestUrl.pathname) || requestUrl.search) return new Response(JSON.stringify({ error: 'Not found' }), { status: 404, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
  let origin;
  try { origin = collectorOrigin(context.env.COLLECTOR_ORIGIN); } catch { return new Response(JSON.stringify({ error: 'Collector unavailable' }), { status: 503, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } }); }
  const headers = { accept: 'application/json', 'cache-control': 'no-store' };
  if (context.env.COLLECTOR_TOKEN) headers.authorization = `Bearer ${context.env.COLLECTOR_TOKEN}`;
  try {
    const upstream = await fetch(new URL(requestUrl.pathname, origin), { headers, redirect: 'error', signal: AbortSignal.timeout(8000) });
    if (upstream.redirected) throw new Error('redirect');
    const body = await upstream.arrayBuffer();
    if (body.byteLength > MAX_BODY) throw new Error('large response');
    const responseHeaders = new Headers({ 'content-type': upstream.headers.get('content-type') ?? 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
    return new Response(body, { status: upstream.status, headers: responseHeaders });
  } catch { return new Response(JSON.stringify({ error: 'Collector unavailable' }), { status: 502, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } }); }
}
