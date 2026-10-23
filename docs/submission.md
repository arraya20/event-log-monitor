# Event/Log Monitor submission checklist

Task: https://pharos-agent-arena.vercel.app/tasks/event-log-monitor

## Reviewer requirements
1. Chain MCP `get_logs`, filtered by contract and Transfer event signature.
2. Continuous polling; new events only, duplicate prevention.
3. Readable from/to/amount/transaction hash/block fields.
4. At least one actual live or test event captured.

## Evidence to retain
- Actual MCP endpoint and chain ID.
- Contract address, token decimals source, event signature.
- Startup and checkpoint block, polling interval and confirmation delay.
- Historical bootstrap versus events observed in subsequent cycles.
- First and subsequent polling output, transaction explorer links.
- Restart with the same data directory and no duplicate event IDs.

## Suggested video
1. Open the deployed monitor and point out contract, chain and MCP source.
2. Show collector scans advancing and an event arriving; explain polling and delay.
3. Open that transaction on the explorer and compare decoded fields.
4. Restart the collector, show checkpoint recovery and unique event IDs.
5. Show tests and repository structure briefly.

## Proof links
Fill only after verification. A planned domain or a local preview is not a public proof link.

- Proof URL: https://event-log-monitor.pages.dev (fetched 2026-10-23: HTTP 200, `/api/status` reported `watching`).
- Repository URL: https://github.com/arraya20/event-log-monitor
- Video URL: optional, pending recording/publication (+50 subject to reviewer approval).

## Verified on 2026-10-23

Checked by fetching the public URLs, not from local runs:

- Dashboard HTML and `app.js` served by Pages are byte-identical to `public/` in the repository.
- `/api/status` through Pages returns chain ID `1672`, the contract address, `eventTypes: ["transfer"]`, a 10 second poll interval, 5 confirmations, `lastError: null`, and a `lastSuccessAt` within seconds of the request; `lastScannedBlock` trails `latestBlock` by the confirmation depth.
- The collector's journal shows scans every ~10 seconds with `mode: "live"` events carrying block `timestamp` and `category`.

Not yet recorded here: a restart-recovery run with before and after cursors, and the demo video. Add them only after capturing them.

## Reviewer note template
Pharos Event Log Monitor continuously polls the official Pharos Chain MCP for ERC-20 Transfer logs, filtered by contract address and event signature. It decodes sender, recipient, raw and formatted token amount, transaction hash, log index, and block number. The collector persists events and its checkpoint together and resumes from the checkpoint after restart. The Cloudflare Pages dashboard reads the separate collector through a same-origin API proxy. Each event carries its block time and a category (transfer, mint, burn, plus optional approval, deposit, withdrawal) and the dashboard can filter by category. Historical bootstrap events are distinguished from events detected after startup. No wallet connection, private keys, or transactions are required. Please see the proof page and repository for the exact configuration and captured evidence.
