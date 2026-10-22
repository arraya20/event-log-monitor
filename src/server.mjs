import { createServer } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { PHAROS_CHAIN_ID } from "./events.mjs";
export function createApi(
  monitor,
  { token = process.env.COLLECTOR_TOKEN } = {},
) {
  return createServer((req, res) => {
    res.setHeader("content-type", "application/json; charset=utf-8");
    res.setHeader("cache-control", "no-store");
    res.setHeader("x-content-type-options", "nosniff");
    const send = (code, body) => res.writeHead(code).end(JSON.stringify(body));
    if (req.method !== "GET") {
      res.setHeader("allow", "GET");
      return send(405, { error: "GET only" });
    }
    const url = new URL(req.url, "http://localhost");
    if (
      !["/healthz", "/api/status", "/api/events"].includes(url.pathname) ||
      url.search
    )
      return send(404, { error: "Not found" });
    if (token) {
      const expected = Buffer.from(`Bearer ${token}`),
        given = Buffer.from(req.headers.authorization ?? "");
      if (given.length !== expected.length || !timingSafeEqual(given, expected))
        return send(401, { error: "Unauthorized" });
    }
    if (url.pathname === "/healthz")
      return send(monitor.status.status === "error" ? 503 : 200, {
        status: monitor.status.status,
      });
    if (url.pathname === "/api/status")
      return send(200, { ...monitor.status, chainId: PHAROS_CHAIN_ID });
    return send(200, { events: monitor.events() });
  });
}
