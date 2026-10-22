import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("dashboard contains stale threshold and stale notice behavior", async () => {
  const source = await readFile(
    new URL("../public/app.js", import.meta.url),
    "utf8",
  );
  assert.match(source, /3 \* \(status\.pollIntervalMs \?\? 10_000\)/);
  assert.match(
    source,
    /const stateLabel = isError \? "error" : fresh \? status\.status : "stale";/,
  );
  assert.match(source, /Collector data is stale/);
  assert.match(source, /text\("#state", "unavailable"\)/);
});
