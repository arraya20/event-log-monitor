import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { scanSummary } from "../src/monitor.mjs";

const event = (category, n) => ({
  category,
  transactionHash: "0x" + String(n).repeat(64),
  blockNumber: 100 + n,
  timestamp: "2026-10-23T07:30:44.000Z",
  from: "0x" + "12".repeat(20),
  amount: "1.000000",
});

test("scan log is a compact summary without full event bodies", () => {
  const summary = scanSummary({
    scannedTo: 110,
    latestBlock: 115,
    newEvents: 3,
    liveEvents: 2,
    events: [event("transfer", 1), event("transfer", 2), event("mint", 3)],
  });
  assert.deepEqual(summary.categories, { transfer: 2, mint: 1 });
  assert.deepEqual(summary.lastEvent, {
    transactionHash: "0x" + "3".repeat(64),
    blockNumber: 103,
    timestamp: "2026-10-23T07:30:44.000Z",
    category: "mint",
  });
  assert.equal(summary.type, "scan");
  assert.equal(summary.newEvents, 3);
  assert.equal("firstEvent" in summary, false);
  assert.ok(JSON.stringify(summary).length < 400);
});

test("empty scan reports no categories and no last event", () => {
  const summary = scanSummary({
    scannedTo: 110,
    latestBlock: 115,
    newEvents: 0,
    liveEvents: 0,
    events: [],
  });
  assert.deepEqual(summary.categories, {});
  assert.equal(summary.lastEvent, null);
});

test("CI audit gate matches the documented release gate", async () => {
  const [ci, docs] = await Promise.all([
    readFile(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8"),
    readFile(new URL("../docs/deployment.md", import.meta.url), "utf8"),
  ]);
  assert.match(ci, /npm audit --audit-level=high/);
  assert.match(docs, /npm audit --audit-level=high/);
});
