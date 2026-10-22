import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Monitor } from "../src/monitor.mjs";
import { DEFAULT_CONTRACT, TRANSFER_TOPIC } from "../src/events.mjs";

const hash = "0x" + "ab".repeat(32);
const log = {
  address: DEFAULT_CONTRACT,
  topics: [
    TRANSFER_TOPIC,
    "0x" + "0".repeat(24) + "12".repeat(20),
    "0x" + "0".repeat(24) + "34".repeat(20),
  ],
  data: "0x" + "1".padStart(64, "0"),
  transactionHash: "0x" + "cd".repeat(32),
  blockHash: hash,
  blockNumber: "100",
  logIndex: "0",
  removed: false,
};
class FakeClient {
  head = 125;
  logs = [];
  calls = [];
  blockHash = hash;
  async connect() {}
  async close() {}
  async call(name, args = {}) {
    this.calls.push({ name, args });
    if (name === "get_chain_info") return { chainId: 1672 };
    if (name === "get_block_number") return { blockNumber: String(this.head) };
    if (name === "get_code") return { code: "0x6000" };
    if (name === "eth_call")
      return {
        result:
          args.transaction.data === "0x313ce567"
            ? "0x" + "6".padStart(64, "0")
            : "0x" +
              "20".padStart(64, "0") +
              "4".padStart(64, "0") +
              Buffer.from("USDC").toString("hex").padEnd(64, "0"),
      };
    if (name === "get_block") return { hash: this.blockHash };
    if (name === "get_logs") return this.logs;
    throw new Error(name);
  }
}

test("initialization marks chain mismatch as permanent", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "pharos-init-error-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const client = new FakeClient();
  client.call = async (name) =>
    name === "get_chain_info" ? { chainId: 1 } : null;
  const monitor = new Monitor({ client, dataDir: directory });
  await assert.rejects(
    monitor.initialize(),
    (error) => error.permanent === true && /chain ID/.test(error.message),
  );
});
test("replay keeps polling without waiting until it catches up", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "pharos-replay-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const client = new FakeClient();
  const monitor = new Monitor({
    client,
    dataDir: directory,
    fromBlock: 100,
    chunkSize: 5,
    confirmations: 5,
  });
  await monitor.initialize();
  t.after(() => monitor.close());
  const first = await monitor.poll();
  const second = await monitor.poll();
  assert.equal(first.caughtUp, false);
  assert.equal(second.caughtUp, false);
  assert.equal(second.scannedTo, 109);
  assert.equal(
    client.calls.filter((call) => call.name === "get_logs").length,
    2,
  );
});

test("empty scans advance cursor without appending any events", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "pharos-idle-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const client = new FakeClient();
  client.head = 105;
  const monitor = new Monitor({
    client,
    dataDir: directory,
    fromBlock: 100,
    confirmations: 5,
  });
  await monitor.initialize();
  t.after(() => monitor.close());
  await monitor.poll();
  const eventsBefore = await readFile(join(directory, "events.json"));
  client.head = 106;
  await monitor.poll();
  assert.deepEqual(
    await readFile(join(directory, "events.json")),
    eventsBefore,
  );
});
