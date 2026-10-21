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

Check generated `pages.dev` URL before adding `monitor.nampharos.web.id` under Custom domains. Route the monitor domain to Pages, not directly to the collector. Keep collector origin separate from the public dashboard domain to avoid proxy loops.

## Verification after deployment

1. Collector API is reachable through the expected HTTPS origin only.
2. Anonymous origin requests are denied when auth is configured.
3. Pages `/api/status` and `/api/events` return successful no-store JSON.
4. Dashboard reports actual current checkpoint and scan time.
5. Stop collector briefly: dashboard reports stale/unavailable, not healthy live data.
6. Restart collector: previous checkpoint retained, event IDs remain unique.
7. Mobile and keyboard dashboard paths work.
8. Existing reader still responds at `reader.nampharos.web.id`.

Record actual URLs, HTTP statuses and captured chain evidence only after these steps run.
