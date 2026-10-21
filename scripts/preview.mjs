import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

// Local integration preview only. Production uses Pages Functions, not this server.
const assets = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/style.css', ['style.css', 'text/css; charset=utf-8']],
]);
const port = Number(process.env.PREVIEW_PORT ?? 8792);
const collectorPort = Number(process.env.COLLECTOR_PORT ?? 8791);
for (const value of [port, collectorPort]) if (!Number.isInteger(value) || value < 1 || value > 65535) throw new Error('Invalid local port');
const server = createServer(async (req, res) => {
  res.setHeader('cache-control', 'no-store');
  res.setHeader('x-content-type-options', 'nosniff');
  if (req.method !== 'GET') { res.writeHead(405).end(); return; }
  const path = new URL(req.url, 'http://localhost').pathname;
  try {
    if (['/api/status', '/api/events'].includes(path)) {
      const upstream = await fetch(`http://127.0.0.1:${collectorPort}${path}`, { signal: AbortSignal.timeout(8000) });
      const text = await upstream.text();
      res.writeHead(upstream.status, { 'content-type': 'application/json' }).end(text);
      return;
    }
    const asset = assets.get(path);
    if (!asset) { res.writeHead(404).end(); return; }
    const body = await readFile(fileURLToPath(new URL(`../public/${asset[0]}`, import.meta.url)));
    res.writeHead(200, { 'content-type': asset[1] }).end(body);
  } catch {
    res.writeHead(502, { 'content-type': 'application/json' }).end(JSON.stringify({ error: 'Collector unavailable' }));
  }
});
server.listen(port, '127.0.0.1', () => console.log(`Local preview http://127.0.0.1:${port}`));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close());
