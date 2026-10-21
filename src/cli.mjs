#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { once } from 'node:events';
import { Monitor } from './monitor.mjs';
import { createApi } from './server.mjs';
import { integer } from './events.mjs';

const { values } = parseArgs({ options: {
  contract: { type: 'string' }, 'from-block': { type: 'string' }, 'data-dir': { type: 'string' },
  port: { type: 'string', default: '8791' }, 'interval-ms': { type: 'string', default: '10000' },
  confirmations: { type: 'string', default: '5' }, cycles: { type: 'string' }, once: { type: 'boolean' }, help: { type: 'boolean' },
} });
if (values.help) {
  console.log('pharos-event-monitor [--contract 0x...] [--from-block N] [--data-dir ./data] [--port 8791] [--interval-ms 10000] [--confirmations 5] [--cycles N] [--once]');
} else {
  let monitor, server, failed = false, stopping = false;
  const shutdown = new AbortController();
  const stop = () => { stopping = true; shutdown.abort(); };
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
  try {
    const port = integer(values.port, 'port');
    if (port < 1 || port > 65535) throw new Error('Invalid port');
    const cycles = values.once ? 1 : values.cycles === undefined ? Infinity : integer(values.cycles, 'cycles');
    if (cycles < 1) throw new Error('cycles must be positive');
    monitor = new Monitor({ contract: values.contract, dataDir: values['data-dir'], intervalMs: values['interval-ms'], confirmations: values.confirmations, fromBlock: values['from-block'] });
    await monitor.initialize();
    if (!values.once) {
      server = createApi(monitor); server.listen(port, '127.0.0.1'); await once(server, 'listening');
      console.log(JSON.stringify({ type: 'ready', api: `http://127.0.0.1:${port}`, ...monitor.status }));
    }
    for (let i = 0; i < cycles && !stopping; i++) {
      try {
        const result = await monitor.poll();
        console.log(JSON.stringify({ type: 'scan', scannedTo: result.scannedTo, latestBlock: result.latestBlock, newEvents: result.newEvents, liveEvents: result.liveEvents, firstEvent: result.events[0] ?? null, lastEvent: result.events.at(-1) ?? null }));
      } catch (error) {
        failed = true; console.error(JSON.stringify({ type: 'error', message: error.message }));
        if (cycles !== Infinity) break;
        // Reconnect for expired/failed MCP sessions without resetting stored evidence.
        await monitor.client.close();
        try { await monitor.client.connect(); } catch (e) { console.error(JSON.stringify({ type: 'reconnect-error', message: e.message })); }
      }
      if (i + 1 < cycles && !stopping) await delay(monitor.intervalMs, undefined, { signal: shutdown.signal }).catch(error => { if (error.name !== 'AbortError') throw error; });
    }
  } catch (error) { failed = true; console.error(JSON.stringify({ type: 'fatal', message: error.message })); }
  finally {
    if (server) await new Promise(resolve => server.close(resolve));
    await monitor?.close().catch(error => { failed = true; console.error(error.message); });
    process.off('SIGINT', stop); process.off('SIGTERM', stop);
  }
  if (failed) process.exitCode = 1;
}
