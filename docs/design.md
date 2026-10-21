# Design decisions

## Approved scope
- Standalone Event/Log Monitor for the Pharos Agent Arena task.
- Cloudflare Pages dashboard on a task subdomain, planned `monitor.nampharos.web.id`.
- Separate read-only VPS collector; existing reader and services remain unchanged.
- Official Pharos Chain MCP only, chain ID 1672; no wallet or transactions.
- ERC-20 Transfer decoding, continuously polled log ranges, persistent checkpoint and duplicate prevention.
- Reviewer evidence must distinguish historical bootstrap events from events observed after startup.

## Architecture
Browser requests same-origin `/api/status` and `/api/events` from Pages Functions. The Function proxies only these paths to a fixed HTTPS `COLLECTOR_ORIGIN`, optionally with a secret bearer token. The VPS API listens on loopback. A separately configured authenticated reverse proxy/tunnel exposes that API to Pages. Never expose a raw public loopback service or caller-selected upstream.

Collector queries `get_logs` with contract and Transfer topic, no direct RPC fallback. Sequential polling defaults to 10 seconds, with five blocks of confirmation delay and chunk size below the 1,000-block inclusive upstream limit. Token quantities remain integers/decimal strings.

## Storage and reliability
One collector per data directory. Bounded event history and cursor saved together atomically. Retry leaves checkpoint unchanged on failure. Reorg detection fails closed on checkpoint hash mismatch; operator selects a fresh directory/replay point after investigation. Five confirmations reduce reorg exposure, not a finality guarantee. JSON persistence chosen over a DB for this single-writer demo; not a general full-history indexer.

## Non-goals
No trading, payment, Telegram notifications, multi-wallet analytics, automatic chain writes, or changes to existing production services. Deployment/account authentication remains a separate verified step.

## Trade-offs
- Pages-only polling stops when the page closes: rejected for task continuity.
- Workers Cron + D1 removes VPS dependency but adds a second backend platform: deferred.
- VPS collector + Pages retains the user's existing deployment pattern, with one persistent process to maintain.

## Verification
Syntax and unit/integration tests; real filtered MCP event capture; bounded continuous cycles and restart using the same checkpoint; API tests; browser desktop/mobile/error behavior. Public deployment cannot be claimed before the actual URL is fetched and verified.
