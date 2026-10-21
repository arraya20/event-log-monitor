# Security boundaries

## Assets
- Integrity of the persisted checkpoint and event evidence.
- Optional Pages-to-origin bearer credential.
- Availability of the VPS and the official MCP endpoint.

## Boundaries and controls

| Boundary | Threat | Control |
|---|---|---|
| Browser to Pages | Arbitrary upstream/path forwarding | Only two GET paths; origin set by deployment configuration, not request |
| Pages to collector | Token exposure / redirects | Secret server-side only; HTTPS; redirects rejected |
| Public origin to loopback | Anonymous request floods | Authenticate and rate-limit at reverse proxy; do not expose port directly |
| MCP response to decoder | Malformed ABI, oversized responses, bad chain | Validate chain/addresses/topics/integers; response caps and timeouts |
| Chain log to browser | HTML/script injection | textContent, constructed explorer URLs, restrictive CSP |
| Process to disk | Concurrent writers / cursor loss | Single owner lock; cursor + events written atomically |
| Retry to chain | Duplicate processing | Stable event IDs, checkpointed range, sequential polls |
| Chain reorganization | Orphaned event evidence | Confirmation delay and checkpoint hash validation; fail closed |

## Operational limits
A bearer token in the Pages environment does not enforce authentication by itself. Validate the origin gate explicitly. Cloudflare WAF/proxy rate limiting is an infrastructure requirement, not implied by a source-code constant.

Disk permissions and a single writer protect ordinary runtime state, not a hostile administrator. JSON rename provides atomic replacement but is not a backup. Event history is bounded and must not be presented as a complete wallet or protocol audit.

This tool intentionally does not accept private keys, sign transactions, call write MCP tools, or make direct RPC fallback calls.
