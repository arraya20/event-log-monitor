import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFile } from "node:fs/promises";
import {
  DEFAULT_CONTRACT,
  TRANSFER_TOPIC,
  DEPOSIT_TOPIC,
  WITHDRAWAL_TOPIC,
  APPROVAL_TOPIC,
  decodeEvent,
  decodeTransfer,
  categoryOf,
  parseEventTypes,
} from "../src/events.mjs";
import { Monitor } from "../src/monitor.mjs";

const ZERO = "0x" + "0".repeat(40);
const addr = (byte) => "0x" + byte.repeat(20);
const topic = (address) => "0x" + "0".repeat(24) + address.slice(2);
const word = (value) => "0x" + BigInt(value).toString(16).padStart(64, "0");
const base = {
  address: DEFAULT_CONTRACT,
  data: word(5_000_000),
  transactionHash: "0x" + "cd".repeat(32),
  blockHash: "0x" + "ab".repeat(32),
  blockNumber: "0x64",
  blockTimestamp: "0x6ada33c1",
  logIndex: "0x0",
  removed: false,
};
const transfer = (from, to, extra = {}) => ({
  ...base,
  topics: [TRANSFER_TOPIC, topic(from), topic(to)],
  ...extra,
});
const options = {
  contractAddress: DEFAULT_CONTRACT,
  decimals: 6,
  symbol: "USDC",
};

test("event carries block time as ISO timestamp and unix seconds", () => {
  const event = decodeTransfer(transfer(addr("12"), addr("34")), options);
  assert.equal(event.blockTimestamp, 0x6ada33c1);
  assert.equal(event.timestamp, "2026-10-22T16:03:13.000Z");
});

test("missing or malformed block time never blocks decoding", () => {
  for (const blockTimestamp of [undefined, null, "nope", "-1"]) {
    const event = decodeTransfer(
      transfer(addr("12"), addr("34"), { blockTimestamp }),
      options,
    );
    assert.equal(event.timestamp, null);
    assert.equal(event.blockTimestamp, null);
  }
});

test("Transfer is classified as transfer, mint or burn", () => {
  const kind = (from, to) =>
    decodeTransfer(transfer(from, to), options).category;
  assert.equal(kind(addr("12"), addr("34")), "transfer");
  assert.equal(kind(ZERO, addr("34")), "mint");
  assert.equal(kind(addr("12"), ZERO), "burn");
});

test("Deposit, Withdrawal and Approval decode with their own categories", () => {
  const types = ["transfer", "approval", "deposit", "withdrawal"];
  const deposit = decodeEvent(
    { ...base, topics: [DEPOSIT_TOPIC, topic(addr("12"))] },
    { ...options, types },
  );
  assert.equal(deposit.category, "deposit");
  assert.equal(deposit.eventType, "Deposit");
  assert.equal(deposit.to, addr("12"));
  assert.equal(deposit.from, null);
  assert.equal(deposit.amount, "5.000000");
  const withdrawal = decodeEvent(
    { ...base, topics: [WITHDRAWAL_TOPIC, topic(addr("12"))] },
    { ...options, types },
  );
  assert.equal(withdrawal.category, "withdrawal");
  assert.equal(withdrawal.from, addr("12"));
  assert.equal(withdrawal.to, null);
  const approval = decodeEvent(
    { ...base, topics: [APPROVAL_TOPIC, topic(addr("12")), topic(addr("34"))] },
    { ...options, types },
  );
  assert.equal(approval.category, "approval");
});

test("only requested event types are accepted; layouts are validated", () => {
  assert.throws(
    () =>
      decodeEvent(
        { ...base, topics: [DEPOSIT_TOPIC, topic(addr("12"))] },
        options,
      ),
    /Unexpected event signature/,
  );
  assert.throws(
    () =>
      decodeEvent(
        { ...base, topics: [DEPOSIT_TOPIC, topic(addr("12")), word(1)] },
        { ...options, types: ["deposit"] },
      ),
    /Not an ERC20 Deposit/,
  );
  assert.throws(
    () => parseEventTypes("transfer,swap"),
    /Unsupported event type: swap/,
  );
  assert.throws(() => parseEventTypes(" , "), /At least one/);
  assert.deepEqual(parseEventTypes("Deposit, transfer,deposit"), [
    "deposit",
    "transfer",
  ]);
});

test("categoryOf derives a category for events stored before categories existed", () => {
  assert.equal(categoryOf({ from: addr("12"), to: addr("34") }), "transfer");
  assert.equal(categoryOf({ from: ZERO, to: addr("34") }), "mint");
  assert.equal(categoryOf({ from: addr("12"), to: ZERO }), "burn");
  assert.equal(categoryOf({ category: "deposit" }), "deposit");
});

class FakeClient {
  head = 110;
  logs = [];
  calls = [];
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
            ? word(6)
            : "0x" +
              word(32).slice(2) +
              word(4).slice(2) +
              Buffer.from("USDC").toString("hex").padEnd(64, "0"),
      };
    if (name === "get_block") return { hash: base.blockHash };
    if (name === "get_logs") return this.logs;
    throw new Error(name);
  }
}

async function monitorFor(t, extra = {}) {
  const dir = await mkdtemp(join(tmpdir(), "pharos-categories-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const client = new FakeClient();
  const monitor = new Monitor({
    client,
    dataDir: dir,
    fromBlock: 100,
    ...extra,
  });
  await monitor.initialize();
  t.after(() => monitor.close());
  return { monitor, client, dir };
}

test("default scan queries Transfer only and exposes timestamped categorized events", async (t) => {
  const { monitor, client } = await monitorFor(t);
  client.logs = [transfer(ZERO, addr("34"))];
  await monitor.poll();
  assert.deepEqual(
    client.calls.find((c) => c.name === "get_logs").args.topics,
    [TRANSFER_TOPIC],
  );
  const [event] = monitor.events();
  assert.equal(event.category, "mint");
  assert.equal(event.timestamp, "2026-10-22T16:03:13.000Z");
  assert.deepEqual(monitor.status.eventTypes, ["transfer"]);
  assert.deepEqual(monitor.status.categories, ["transfer", "mint", "burn"]);
});

test("multi-event scan sends an OR topic filter and stores each category", async (t) => {
  const { monitor, client } = await monitorFor(t, {
    eventTypes: "transfer,deposit",
  });
  client.logs = [
    transfer(addr("12"), addr("34")),
    {
      ...base,
      logIndex: "0x1",
      topics: [DEPOSIT_TOPIC, topic(addr("56"))],
    },
  ];
  await monitor.poll();
  const topics = client.calls.find((c) => c.name === "get_logs").args.topics;
  assert.equal(topics.length, 1);
  assert.deepEqual(
    [...topics[0]].sort(),
    [DEPOSIT_TOPIC, TRANSFER_TOPIC].sort(),
  );
  assert.deepEqual(
    monitor
      .events()
      .map((event) => event.category)
      .sort(),
    ["deposit", "transfer"],
  );
});

test("a data directory cannot be reused with a different event selection", async (t) => {
  const { monitor, dir } = await monitorFor(t);
  await monitor.close();
  const other = new Monitor({
    client: new FakeClient(),
    dataDir: dir,
    eventTypes: "transfer,deposit",
  });
  await assert.rejects(
    other.initialize(),
    /different chain, contract, or event filter/,
  );
});

test("dashboard paginates 25 rows per page and resets on filter change", async () => {
  const [source, html] = await Promise.all([
    readFile(new URL("../public/app.js", import.meta.url), "utf8"),
    readFile(new URL("../public/index.html", import.meta.url), "utf8"),
  ]);
  assert.match(source, /const PAGE_SIZE = 25;/);
  assert.match(source, /all\.slice\(start, start \+ PAGE_SIZE\)/);
  assert.match(source, /selectedCategory = event\.target\.value;\s+page = 1;/);
  assert.match(source, /Math\.min\(Math\.max\(1, page\), pages\)/);
  for (const id of ["pager", "prev", "next", "page-info"])
    assert.match(html, new RegExp(`id="${id}"`));
  // Export keeps every filtered row, not just the visible page.
  assert.match(source, /events: visibleEvents\(\)/);
});

test("dashboard renders block time and a category filter", async () => {
  const [source, html] = await Promise.all([
    readFile(new URL("../public/app.js", import.meta.url), "utf8"),
    readFile(new URL("../public/index.html", import.meta.url), "utf8"),
  ]);
  assert.match(html, /<th>Time<\/th><th>Category<\/th>/);
  assert.match(html, /<select id="category">/);
  assert.match(source, /time\.dateTime = date\.toISOString\(\)/);
  assert.match(source, /categoryOf\(event\) === selectedCategory/);
  assert.match(source, /selectedCategory = event\.target\.value/);
});
