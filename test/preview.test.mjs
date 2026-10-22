import { test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";

process.env.COLLECTOR_PORT = "18793";
const { server } = await import("../scripts/preview.mjs");
test("local preview serves dashboard, rejects unknown paths and handles missing collector", async () => {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    const origin = `http://127.0.0.1:${server.address().port}`;
    const page = await fetch(origin);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /monitor/i);
    assert.equal(page.headers.get("cache-control"), "no-store");
    assert.equal((await fetch(origin + "/unknown")).status, 404);
    assert.equal((await fetch(origin, { method: "POST" })).status, 405);
    const unavailable = await fetch(origin + "/api/status");
    assert.equal(unavailable.status, 502);
    assert.equal((await unavailable.json()).error, "Collector unavailable");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
