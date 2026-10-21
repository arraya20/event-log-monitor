const $ = selector => document.querySelector(selector);
let latest = { events: [] }, busy = false;
const text = (selector, value) => { $(selector).textContent = value ?? '—'; };
const short = value => typeof value === 'string' && value.length > 18 ? `${value.slice(0, 10)}…${value.slice(-8)}` : value ?? '—';
function safeHash(value) { return typeof value === 'string' && /^0x[0-9a-f]{64}$/i.test(value) ? value : null; }
function renderEvent(event) {
  const row = document.createElement('tr');
  for (const value of [event.mode, event.blockNumber, short(event.from), short(event.to), `${event.amount ?? event.amountRaw ?? '—'} ${event.symbol ?? ''}`.trim()]) { const cell = document.createElement('td'); cell.textContent = value; row.append(cell); }
  const tx = document.createElement('td'); const hash = safeHash(event.transactionHash);
  if (hash) { const link = document.createElement('a'); link.href = `https://pharosscan.xyz/tx/${hash}`; link.target = '_blank'; link.rel = 'noreferrer'; link.textContent = short(hash); tx.append(link); } else tx.textContent = 'invalid hash';
  row.append(tx); return row;
}
function render(status, payload) {
  latest = payload;
  text('#state', status.status === 'watching' ? 'watching' : status.status);
  text('#token', status.symbol && status.decimals !== null ? `${status.symbol} · ${status.decimals} decimals` : null);
  text('#chain', status.chainId ? `Pharos · ${status.chainId}` : null); text('#block', status.latestBlock); text('#count', status.eventCount); text('#scanned', status.lastScannedBlock);
  text('#contract', status.contractAddress); text('#source', status.mcpUrl); text('#updated', status.lastSuccessAt ? `Last successful scan ${new Date(status.lastSuccessAt).toLocaleString()}` : 'No successful scan');
  const notice = $('#notice'); notice.className = `notice ${status.status === 'error' ? 'bad' : 'good'}`; notice.textContent = status.status === 'error' ? `Collector error: ${status.lastError ?? 'unknown error'}` : `Collector ${status.status}. Page refreshes every ${Math.round((status.pollIntervalMs ?? 10000) / 1000)} seconds; this UI is not a websocket.`;
  const body = $('#events'); body.replaceChildren(); const events = Array.isArray(payload.events) ? payload.events : [];
  if (!events.length) { const row=document.createElement('tr'), cell=document.createElement('td'); cell.colSpan=6; cell.className='empty'; cell.textContent='No events captured yet.'; row.append(cell); body.append(row); } else events.forEach(event => body.append(renderEvent(event)));
}
async function refresh() {
  if (busy || document.hidden) return; busy = true;
  try { const [statusResponse, eventsResponse] = await Promise.all([fetch('/api/status', { cache: 'no-store' }), fetch('/api/events', { cache: 'no-store' })]); if (!statusResponse.ok || !eventsResponse.ok) throw new Error(`collector HTTP ${statusResponse.status}/${eventsResponse.status}`); render(await statusResponse.json(), await eventsResponse.json()); }
  catch (error) { const notice=$('#notice'); notice.className='notice bad'; notice.textContent=`Collector unavailable: ${error.message}`; text('#updated','Retrying on next poll'); }
  finally { busy = false; }
}
$('#export').addEventListener('click', () => { const blob=new Blob([JSON.stringify(latest,null,2)],{type:'application/json'}); const link=document.createElement('a'); link.href=URL.createObjectURL(blob); link.download='pharos-event-monitor.json'; link.click(); URL.revokeObjectURL(link.href); });
refresh(); setInterval(refresh, 10_000);
