# Pharos Event Log Monitor

Read-only ERC-20 event monitor for Pharos Mainnet. Queries the official Chain MCP, decodes `Transfer` (and optionally `Approval`, `Deposit`, `Withdrawal`) events, and keeps a persistent checkpoint across restarts. No wallet connection, private keys, signing, or direct RPC fallback.

## Features

- Filters `get_logs` by contract address and the selected event signatures (default: ERC-20 `Transfer`).
- Shows block time, category, sender, recipient, raw amount, formatted amount, transaction hash, log index, and block number.
- Block time (`timestamp`, ISO 8601 UTC, plus `blockTimestamp` in unix seconds) comes from the chain's block, not from when the collector saw the event.
- Categories: `transfer`, `mint` (from the zero address), `burn` (to the zero address), `approval`, `deposit`, `withdrawal`. The dashboard filters by category.
- Preserves token amounts with integer arithmetic, without floating-point rounding.
- Stores events and scan cursor in separate atomically replaced files; this avoids rewriting the event history when only the cursor changes. An uncommitted event file is safe: replay uses stable IDs and advances cursor only afterward.
- Reclaims a stale lock only when its recorded PID is confirmed absent; live or unverifiable locks remain protected.
- Deduplicates events by transaction hash and log index.
- Distinguishes historical bootstrap events (`backfill`) from events in blocks after collector startup (`live`). Both are obtained by polling, not subscriptions.
- Provides a read-only API and a dashboard with transaction links and JSON export.

## Requirements

Node.js 22 or newer and access to `https://mcp.pharos.xyz/mcp`.

## Quick start

```sh
npm ci --ignore-scripts
npm start
```

Defaults:

| Setting | Value |
| --- | --- |
| Network | Pharos Mainnet, chain ID `1672` |
| Contract | `0xc879c018db60520f4355c26ed1a6d572cdac1815` |
| Token metadata | Read from the contract through MCP |
| Events | ERC-20 `Transfer(address,address,uint256)`; others via `--events` |
| Polling delay | 10 seconds between completed scans |
| Confirmation depth | 5 blocks |
| Bootstrap range | Starts 99 blocks behind the startup head |
| Maximum query range | 500 blocks per scan |
| State directory | `./data` |
| API | `http://127.0.0.1:8791` |

## CLI

```sh
npm start -- --help

# Watch another ERC-20 contract in its own state directory
npm start -- --contract 0xYOUR_ERC20_ADDRESS --data-dir ./data/other-token

# Begin at a specified block when creating a new state directory
npm start -- --from-block 20000000 --data-dir ./data/replay

# Also watch Approval, Deposit and Withdrawal (needs its own state directory)
npm start -- --events transfer,approval,deposit,withdrawal --data-dir ./data/all-events

# Run three scans, then exit
npm start -- --cycles 3 --data-dir ./data/check

# Run one scan without starting the API server
npm start -- --once --data-dir ./data/check
```

Options: `--contract`, `--from-block`, `--events`, `--data-dir`, `--port`, `--interval-ms`, `--confirmations`, `--cycles`, `--once`, `--help`.

`--from-block` only selects the initial cursor for a new state directory. Existing state resumes its saved cursor. `--confirmations` may be adjusted between restarts. Use a separate directory for each contract; only one collector may own a directory.

## API

GET endpoints:

| Path | Response |
| --- | --- |
| `/healthz` | Collector state; HTTP 503 when the state is `error` |
| `/api/status` | Network, contract, metadata, scan blocks, last success time, error, cumulative event count |
| `/api/events` | `{ "events": [...] }`, newest first, up to 300 retained events, each with `timestamp` and `category` |

```sh
curl http://127.0.0.1:8791/api/status
curl http://127.0.0.1:8791/api/events
```

Set `COLLECTOR_TOKEN` in the collector process environment to require `Authorization: Bearer <token>` on all endpoints. Environment files are not automatically loaded by `npm start`; a process supervisor or Node's environment-file support must load them. Never put credentials in browser assets or Git.

## Dashboard

The frontend requests `/api/status` and `/api/events` through a same-origin Pages proxy. It refreshes every 10 seconds while visible, displays scan information and events with block time and category, filters by category in the browser, and exports the currently displayed events as JSON. The collector continues independently when the browser closes.

A local integration preview is available with `node scripts/preview.mjs` on `http://127.0.0.1:8792`. It expects a collector on port 8791 and does not add authentication headers; use it only with an isolated local test collector, not an authenticated production instance.

## Limits and recovery

- ERC-20 layouts only; ERC-721 `Transfer` layouts are rejected. `Deposit` and `Withdrawal` use the WETH-style `(address indexed, uint256)` layout, and a contract only emits them if it implements them. The default token does not emit them, so choosing them for it simply yields nothing.
- The event selection is part of the state fingerprint: use a separate data directory per contract and event selection. Transfer-only state created before this option still resumes.
- Events saved before block time existed show `—` as time until they age out; new events always carry it.
- Stores the latest 1,000 events; the API returns at most 300. Not an archival indexer or a complete transaction-history service.
- Query, decoding, or storage errors do not advance the checkpoint.
- Confirmation delay reduces reorg exposure; it does not guarantee finality. A checkpoint hash mismatch blocks further progress pending operator investigation.
- A saved checkpoint is reused after restart. Stale locks are reclaimed only after proving their recorded PID is gone.
- `--confirmations` may change between restarts; contract and chain still must match the saved state.
- Check `lastSuccessAt` and scan progress, not just HTTP 200, to determine freshness.
- Permanent errors, including chain mismatch, token metadata changes, and checkpoint reorg mismatch, stop the collector with exit code `2`; investigate before changing state.
- Do not delete `cursor.json` or `events.json` to bypass a reorg mismatch. Preserve the files for investigation, then choose an explicit recovery directory or replay point.

## Operator runbook

Validate before installation:

```sh
npm ci --ignore-scripts
npm run build
npm audit --audit-level=high
npm start -- --once --data-dir ./data/check
```

For production, run the collector under a supervisor with a writable `data/` directory and `COLLECTOR_TOKEN` loaded outside Git. The systemd template binds the API to loopback; expose it through a dedicated authenticated HTTPS proxy, not directly to the internet.

Recovery rules:

- After `SIGKILL`, OOM, or power loss, restart with the same data directory. A dead-PID lock is reclaimed automatically; a live or unverifiable lock is not removed.
- After a transient MCP/network error, the CLI reconnects and retries with bounded exponential backoff.
- After a permanent error, stop and inspect logs and persisted state. Do not force progress by deleting state.
- To change confirmations, restart with the same data directory. The saved cursor remains valid.
- To change contract, use a separate data directory and run a bounded check before enabling continuous polling.
- Back up `cursor.json` and `events.json` together. Restore both as one consistent pair, then run `--once` before resuming service.

## Development

```sh
npm run build
npm audit --omit=dev
```

`build` runs syntax checks and Node's built-in tests. No third-party runtime dependencies.

## License

MIT.
