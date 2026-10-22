import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { StateStore } from "../src/store.mjs";

async function temporaryDirectory(t) {
  const directory = await mkdtemp(join(tmpdir(), "pharos-lock-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

test("live PID lock is not stolen", async (t) => {
  const directory = await temporaryDirectory(t);
  const first = await new StateStore(directory, "same").open();
  const second = new StateStore(directory, "same");
  await assert.rejects(second.open(), /locked by a running collector/);
  await first.close();
  await second.open();
  await second.close();
});

test("stale dead PID lock is reclaimed and state resumes", async (t) => {
  const directory = await temporaryDirectory(t);
  await writeFile(
    join(directory, "collector.lock"),
    JSON.stringify({ pid: 2147483647, startedAt: "old" }),
  );
  const store = await new StateStore(directory, "same").open();
  assert.equal(store.state, undefined);
  await store.save({
    nextBlock: 101,
    events: [],
    checkpoint: null,
    totalEvents: 0,
  });
  await store.close();
  const resumed = await new StateStore(directory, "same").open();
  assert.equal(resumed.state.nextBlock, 101);
  await resumed.close();
});

test("legacy v1 state migrates and tolerates confirmation-setting changes", async (t) => {
  const directory = await temporaryDirectory(t);
  const oldFingerprint = JSON.stringify({
    chainId: 1672,
    contract: "token",
    topic: "transfer",
    confirmations: 5,
  });
  await writeFile(
    join(directory, "state.json"),
    JSON.stringify({
      version: 1,
      fingerprint: oldFingerprint,
      nextBlock: 44,
      checkpoint: null,
      events: [],
      totalEvents: 0,
      symbol: "T",
      decimals: 6,
    }),
  );
  const store = await new StateStore(
    directory,
    JSON.stringify({ chainId: 1672, contract: "token", topic: "transfer" }),
  ).open();
  assert.equal(store.state.nextBlock, 44);
  await store.save({ ...store.state });
  assert.equal(
    JSON.parse(await readFile(join(directory, "cursor.json"), "utf8"))
      .nextBlock,
    44,
  );
  await store.close();
});

test("changing confirmations does not invalidate the saved cursor", async (t) => {
  const directory = await temporaryDirectory(t);
  const first = await new StateStore(
    directory,
    JSON.stringify({ chainId: 1672, contract: "token", topic: "transfer" }),
  ).open();
  await first.save({
    nextBlock: 8,
    events: [],
    checkpoint: null,
    totalEvents: 0,
    symbol: "T",
    decimals: 6,
  });
  await first.close();
  const changedConfirmationFingerprint = JSON.stringify({
    chainId: 1672,
    contract: "token",
    topic: "transfer",
  });
  const resumed = await new StateStore(
    directory,
    changedConfirmationFingerprint,
  ).open();
  assert.equal(resumed.state.nextBlock, 8);
  await resumed.close();
});

test("saving unchanged cursor and events does not rewrite state files", async (t) => {
  const directory = await temporaryDirectory(t);
  const store = await new StateStore(directory, "same").open();
  await store.save({
    nextBlock: 1,
    events: [],
    checkpoint: null,
    totalEvents: 0,
  });
  const before = await readFile(join(directory, "cursor.json"));
  const eventsBefore = await readFile(join(directory, "events.json"));
  await new Promise((resolve) => setTimeout(resolve, 10));
  await store.save({ ...store.state });
  assert.deepEqual(await readFile(join(directory, "cursor.json")), before);
  assert.deepEqual(
    await readFile(join(directory, "events.json")),
    eventsBefore,
  );
  await store.close();
});

test("removed lock owner or invalid lock is not deleted automatically", async (t) => {
  const directory = await temporaryDirectory(t);
  await writeFile(
    join(directory, "collector.lock"),
    JSON.stringify({ pid: process.pid, startedAt: "current" }),
  );
  const contender = new StateStore(directory, "same");
  await assert.rejects(contender.open(), /locked by a running collector/);
  assert.equal(
    JSON.parse(await readFile(join(directory, "collector.lock"), "utf8")).pid,
    process.pid,
  );
});
