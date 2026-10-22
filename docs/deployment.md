# Deployment runbook

This file is a runbook, not evidence of an installed service or a deployed domain.

## Collector

From the repository directory, run validation and a bounded read-only live check first. Verify checkpoint recovery using the same data directory. Do not create paid transactions to generate a demonstration event.

The service template `deploy/pharos-event-monitor.service` assumes:
- repository `/home/ubuntu/event-log-monitor`;
- user `ubuntu`;
- Node available under system PATH;
- pre-created writable `data/` owned by `ubuntu`;
- API port 8791 bound to loopback.

Before installation, compare these assumptions with the actual host. The service template is not automatically enabled by building this repository. Do not replace an existing service or tunnel configuration.

## HTTPS collector route

Expose the loopback API through a dedicated hostname, for example an operator-chosen collector API subdomain. Configure the edge/reverse proxy to:
- allow only GET `/api/status` and `/api/events`;
- authenticate Pages-to-collector requests with a secret bearer token;
- reject missing/incorrect tokens;
- rate-limit requests and disable caching;
- never forward arbitrary paths or arbitrary upstream URLs.

Pages sends `Authorization: Bearer <COLLECTOR_TOKEN>` if that secret is configured. Authentication must actually be enforced by the collector or proxy; merely setting the Pages secret does not protect the origin. Test unauthorized requests return 401/403 before exposing the route.

## Pages settings

- Project root: repository root.
- Production branch: `main`.
- Build: `npm ci --ignore-scripts && npm run build`.
- Output: `public`.
- `COLLECTOR_ORIGIN`: fixed HTTPS collector origin, no path/query/credentials.
- `COLLECTOR_TOKEN`: optional Pages secret matching upstream authentication.

Secrets and variables are snapshotted per deployment. After changing either one, deploy again; an existing deployment keeps its old values. Set secrets for the Production environment, which is configured separately from Preview.

Generate the token with `openssl rand -hex 32`. Put the same value in the collector's `.env.service` (`COLLECTOR_TOKEN=<value>`, no quotes or trailing spaces, mode 600) and restart the service, since the environment file is read only at start. Then set it in Pages with `npx wrangler pages secret put COLLECTOR_TOKEN --project-name event-log-monitor`. The token cannot be recovered from Pages; if it is lost, generate and set a new one in both places.

Check generated `pages.dev` URL before adding `monitor.nampharos.web.id` under Custom domains. Route the monitor domain to Pages, not directly to the collector. Keep collector origin separate from the public dashboard domain to avoid proxy loops.

## Verification after deployment

1. Collector API is reachable through the expected HTTPS origin only.
2. Anonymous origin requests are denied when auth is configured.
3. Pages `/api/status` and `/api/events` return successful JSON; successful responses use a 5-second edge cache and errors remain `no-store`.
4. Dashboard reports actual current checkpoint and scan time.
5. Stop collector briefly: dashboard reports stale/unavailable, not healthy live data.
6. Restart collector: previous checkpoint retained, event IDs remain unique.
7. Mobile and keyboard dashboard paths work.
8. Existing reader still responds at `reader.nampharos.web.id`.

## Release gate

Do not call the deployment complete until the following evidence is captured:

```text
- npm run build: syntax, formatting, and all tests pass
- npm audit --audit-level=high: no high-severity vulnerabilities
- systemctl status: collector active
- unauthorized collector request: 401 or 403
- authorized collector request: 200
- Pages status/events routes: 200
- collector stopped: dashboard stale or unavailable
- collector restarted: previous cursor retained and event IDs remain unique
```

For a checkpoint hash mismatch, preserve `cursor.json` and `events.json`. Investigate the reorg first; do not delete state as an automatic recovery step.

Record actual URLs, HTTP statuses and captured chain evidence only after these steps run.

## Troubleshooting the dashboard

The dashboard message `collector HTTP <status>/<status>` shows the status returned by the Pages Function. Identify the source before changing anything. Stream live Function logs with:

```sh
npx wrangler pages deployment tail --project-name event-log-monitor --environment production
```

| Symptom | Source | Cause and fix |
| --- | --- | --- |
| 503, no `x-content-type-options` header | Function | `COLLECTOR_ORIGIN` is missing or not a plain HTTPS origin in that deployment. Set it in `wrangler.toml` `[vars]` or Pages settings, then deploy again. |
| 502 | Function | `fetch` to the collector threw. Read the `collector fetch failed:` log line for the error name and message. |
| 401 | Collector or proxy | `COLLECTOR_TOKEN` is missing from Pages Production, differs from the collector's token, or the collector was not restarted after the token changed. Test the collector directly with `curl -H "Authorization: Bearer <token>"`. |
| 200 but stale | Collector | Check `lastSuccessAt` and `lastScannedBlock` in `/api/status`, and `systemctl status`. |

Known pitfalls:

- **Cloudflare Workers rejects `redirect: "error"`.** `fetch` throws `TypeError: Invalid redirect value` and every request becomes a 502. The proxy uses `redirect: "manual"` and treats any 3xx as an upstream failure, so redirects are still never followed. Node's `fetch` accepts the invalid value, so unit tests cannot catch this class of error; confirm with a live request after deployment.
- **`<hash>.<project>.pages.dev` URLs are immutable snapshots.** A later deployment gets a new hash and never changes an old one. Test with the production alias or the hash printed by the latest deploy. Compare the served `app.js` with `public/app.js` if unsure which commit a URL is running.
