# Pharos Event Log Monitor

Read-only ERC-20 Transfer monitor using the official Pharos Chain MCP. Separate VPS collector and Cloudflare Pages dashboard. No direct RPC fallback, wallet connection, or signing.

## Requirements

- Node.js 22 or newer.
- Network access to `https://mcp.pharos.xyz/mcp`.
- Cloudflare Pages account for public dashboard deployment.
- A VPS process and HTTPS reverse proxy/tunnel for the collector API.

## Run locally

```sh
npm ci --ignore-scripts
npm run build
npm start
```

Collector API defaults to `127.0.0.1:8791`:

```sh
curl http://127.0.0.1:8791/healthz
curl http://127.0.0.1:8791/api/status
curl http://127.0.0.1:8791/api/events
```

Default contract: `0xc879c018db60520f4355c26ed1a6d572cdac1815`. Its `symbol()` and `decimals()` were read through MCP as USDC and 6. The collector must verify chain and contract metadata itself; the name alone is not a safety endorsement.

Each event includes addresses, exact raw integer value, decimal amount, transaction hash, log index, block and explorer link. The collector filters by contract plus ERC-20 Transfer signature. ERC-721 Transfer events are not supported.

## Reliability model

- Sequential polling, default 10-second interval.
- Bounded block windows (upstream MCP permits at most 1,000 blocks inclusive).
- Confirmation delay reduces reorg exposure, not a guarantee of finality.
- Persistent cursor and bounded event history. This is not a full-chain archival indexer.
- One collector owns a data directory. Do not run two writers against the same state.
- Checkpoint never advances on query/decode/storage failure.
- Restart continues from the saved cursor; events have deterministic transaction-hash/log-index IDs.
- Historical bootstrap events are marked separately from observations after startup.
- Reorg/checkpoint mismatch must stop progress rather than silently discard evidence. Investigate before replaying into a fresh data directory.
- Atomic file replacement protects against partial writes; maintain normal VPS backups for disk loss.

`data/` and `artifacts/` are ignored by Git. Public API output contains public chain activity, not secrets.

## Cloudflare Pages

1. Publish this standalone repository and connect it to Cloudflare Pages.
2. Build command: `npm ci --ignore-scripts && npm run build`.
3. Build output directory: `public`.
4. Configure `COLLECTOR_ORIGIN` as the HTTPS origin exposing the collector. Never accept an origin from browser input.
5. Configure optional `COLLECTOR_TOKEN` as a Pages secret if the upstream requires bearer authentication. Tokens never belong in `public/` or Git.
6. Verify `/api/status` and `/api/events` on the generated `pages.dev` URL.
7. Attach `monitor.nampharos.web.id` through Pages Custom domains, then verify that domain separately.

Pages Functions allowlist two GET API routes, reject redirects, apply timeouts, and return no-store responses. They do not start or schedule the collector.

## VPS boundaries

Keep the API bound to loopback, expose only required read-only routes through a configured HTTPS tunnel/reverse proxy, and apply authentication/rate limiting there. Do not expose port 8791 directly to the internet. Existing Cloudflare tunnel routes and existing reader deployments must not be replaced to install this app.

The collector needs a persistent process supervisor for unattended use. Creating source files or running a bounded verification is not equivalent to enabling an always-on service. Service installation, public routing and deployment must be verified independently.

## Evidence and task submission

See [design](docs/design.md) and [submission checklist](docs/submission.md). A deployed dashboard, actual collector evidence, and optional walkthrough video make a reviewer-accessible proof package. Never present recorded historical events as newly captured live activity.

## Checks

```sh
npm run check
npm test
npm audit --omit=dev
```

No third-party runtime dependencies. Tests use Node's built-in test runner. GitHub Actions runs the same checks.
