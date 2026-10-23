#!/usr/bin/env node
import { parseArgs } from "node:util";
import { setTimeout as delay } from "node:timers/promises";
import { once } from "node:events";
import { Monitor, scanSummary } from "./monitor.mjs";
import { createApi } from "./server.mjs";
import { integer } from "./events.mjs";

const { values } = parseArgs({
  options: {
    contract: { type: "string" },
    "from-block": { type: "string" },
    events: { type: "string" },
    "data-dir": { type: "string" },
    port: { type: "string", default: "8791" },
    "interval-ms": { type: "string", default: "10000" },
    confirmations: { type: "string", default: "5" },
    cycles: { type: "string" },
    once: { type: "boolean" },
    help: { type: "boolean" },
  },
});

if (values.help) {
  console.log(
    "pharos-event-monitor [--contract 0x...] [--from-block N] [--events transfer,approval,deposit,withdrawal] [--data-dir ./data] [--port 8791] [--interval-ms 10000] [--confirmations 5] [--cycles N] [--once]",
  );
} else {
  let monitor;
  let server;
  let failed = false;
  let stopping = false;
  let errorStreak = 0;
  let retryDelayMs = 0;
  const shutdown = new AbortController();
  const stop = () => {
    stopping = true;
    shutdown.abort();
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);

  try {
    const port = integer(values.port, "port");
    if (port < 1 || port > 65535) throw new Error("Invalid port");
    const cycles = values.once
      ? 1
      : values.cycles === undefined
        ? Infinity
        : integer(values.cycles, "cycles");
    if (cycles < 1) throw new Error("cycles must be positive");
    monitor = new Monitor({
      contract: values.contract,
      dataDir: values["data-dir"],
      intervalMs: values["interval-ms"],
      confirmations: values.confirmations,
      fromBlock: values["from-block"],
      eventTypes: values.events,
    });
    await monitor.initialize();
    if (!values.once) {
      server = createApi(monitor);
      server.listen(port, "127.0.0.1");
      await once(server, "listening");
      console.log(
        JSON.stringify({
          type: "ready",
          api: `http://127.0.0.1:${port}`,
          ...monitor.status,
        }),
      );
    }

    for (let i = 0; i < cycles && !stopping; i += 1) {
      if (errorStreak > 0) {
        await delay(retryDelayMs, undefined, { signal: shutdown.signal }).catch(
          (error) => {
            if (error.name !== "AbortError") throw error;
          },
        );
      }
      try {
        const result = await monitor.poll();
        errorStreak = 0;
        retryDelayMs = 0;
        console.log(JSON.stringify(scanSummary(result)));
        if (!result.caughtUp && cycles === Infinity) continue;
      } catch (error) {
        failed = true;
        errorStreak += 1;
        console.error(
          JSON.stringify({
            type: "error",
            permanent: Boolean(error.permanent),
            message: error.message,
          }),
        );
        if (error.permanent) {
          process.exitCode = 2;
          break;
        }
        if (cycles !== Infinity) break;
        await monitor.client.close();
        try {
          await monitor.client.connect();
        } catch (reconnectError) {
          console.error(
            JSON.stringify({
              type: "reconnect-error",
              message: reconnectError.message,
            }),
          );
        }
        retryDelayMs = Math.min(
          monitor.intervalMs * 16,
          1000 * 2 ** Math.min(errorStreak, 10),
        );
        continue;
      }
      if (i + 1 < cycles && !stopping) {
        await delay(monitor.intervalMs, undefined, {
          signal: shutdown.signal,
        }).catch((error) => {
          if (error.name !== "AbortError") throw error;
        });
      }
    }
  } catch (error) {
    failed = true;
    if (error.permanent) process.exitCode = 2;
    console.error(JSON.stringify({ type: "fatal", message: error.message }));
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    await monitor?.close().catch((error) => {
      failed = true;
      console.error(error.message);
    });
    process.off("SIGINT", stop);
    process.off("SIGTERM", stop);
  }
  if (failed && process.exitCode === undefined) process.exitCode = 1;
}
