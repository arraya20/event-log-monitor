import { McpClient, MCP_URL } from "./mcp.mjs";
import {
  DEFAULT_CONTRACT,
  PHAROS_CHAIN_ID,
  TRANSFER_TOPIC,
  address,
  integer,
  decodeEvent,
  categoryOf,
  categoriesFor,
  eventTopics,
  parseEventTypes,
} from "./events.mjs";
import { StateStore } from "./store.mjs";

export function abiUint(data) {
  if (!/^0x[0-9a-fA-F]{64}$/.test(data))
    throw new Error("Invalid token decimals ABI");
  const value = Number(BigInt(data));
  if (!Number.isInteger(value) || value < 0 || value > 255)
    throw new Error("Invalid token decimals");
  return value;
}

export function abiSymbol(data) {
  if (!/^0x[0-9a-fA-F]+$/.test(data) || data.length % 2 !== 0)
    throw new Error("Invalid token symbol ABI");
  const bytes = Buffer.from(data.slice(2), "hex");
  if (bytes.length === 32)
    return new TextDecoder("utf-8", { fatal: true })
      .decode(bytes)
      .replace(/\0+$/, "")
      .slice(0, 64);
  if (
    bytes.length < 64 ||
    BigInt("0x" + bytes.subarray(0, 32).toString("hex")) !== 32n
  )
    throw new Error("Invalid symbol ABI offset");
  const length = BigInt("0x" + bytes.subarray(32, 64).toString("hex"));
  if (length > 256n || bytes.length < 64 + Number(length))
    throw new Error("Invalid symbol ABI length");
  return new TextDecoder("utf-8", { fatal: true })
    .decode(bytes.subarray(64, 64 + Number(length)))
    .slice(0, 64);
}

export function isPermanentMonitorError(error) {
  return /checkpoint block hash mismatch|possible reorg|manual recovery|required Pharos chain ID|Expected Pharos chain ID|token metadata changed|target has no contract bytecode|returned invalid JSON|returned non-array|Log outside requested range|Not an ERC20|Unexpected event signature|Unexpected log contract|Noncanonical|Invalid uint256|Invalid EVM address|Invalid token|ABI|Removed log/i.test(
    error.message,
  );
}

export class Monitor {
  constructor({
    contract = DEFAULT_CONTRACT,
    dataDir = "./data",
    intervalMs = 10_000,
    confirmations = 5,
    fromBlock,
    chunkSize = 500,
    eventTypes = ["transfer"],
    client = new McpClient(),
  } = {}) {
    this.contract = address(contract);
    this.eventTypes = parseEventTypes(eventTypes);
    this.topics = eventTopics(this.eventTypes);
    this.intervalMs = integer(intervalMs);
    this.confirmations = integer(confirmations);
    this.chunkSize = integer(chunkSize);
    if (
      this.intervalMs < 1000 ||
      this.chunkSize < 1 ||
      this.chunkSize > 1000 ||
      this.confirmations > 10000
    )
      throw new Error("Invalid monitor limits");
    this.fromBlock = fromBlock === undefined ? undefined : integer(fromBlock);
    this.client = client;
    // Transfer-only keeps the original fingerprint so existing state directories resume.
    const transferOnly =
      this.topics.length === 1 && this.topics[0] === TRANSFER_TOPIC;
    this.store = new StateStore(
      dataDir,
      JSON.stringify({
        chainId: PHAROS_CHAIN_ID,
        contract: this.contract,
        ...(transferOnly ? { topic: TRANSFER_TOPIC } : { topics: this.topics }),
      }),
    );
    this.status = {
      contractAddress: this.contract,
      chainId: PHAROS_CHAIN_ID,
      symbol: null,
      decimals: null,
      mcpUrl: MCP_URL,
      eventTypes: this.eventTypes,
      categories: categoriesFor(this.eventTypes),
      pollIntervalMs: this.intervalMs,
      confirmations: this.confirmations,
      latestBlock: null,
      lastScannedBlock: null,
      lastSuccessAt: null,
      lastError: null,
      startedAt: new Date().toISOString(),
      eventCount: 0,
      status: "starting",
    };
  }

  async initialize() {
    await this.store.open();
    try {
      await this.client.connect();
      const chain = await this.client.call("get_chain_info");
      if (Number(chain.chainId) !== PHAROS_CHAIN_ID)
        throw new Error(`Expected Pharos chain ID ${PHAROS_CHAIN_ID}`);
      const head = integer(
        (await this.client.call("get_block_number")).blockNumber,
      );
      this.liveBoundary = head;
      const block = String(head);
      const code = await this.client.call("get_code", {
        address: this.contract,
        block,
      });
      if (!/^0x[0-9a-fA-F]+$/.test(code.code) || /^0x0*$/.test(code.code))
        throw new Error("Target has no contract bytecode");
      const decimals = abiUint(
        (
          await this.client.call("eth_call", {
            transaction: { to: this.contract, data: "0x313ce567" },
            block,
          })
        ).result,
      );
      const symbol = abiSymbol(
        (
          await this.client.call("eth_call", {
            transaction: { to: this.contract, data: "0x95d89b41" },
            block,
          })
        ).result,
      );
      if (
        this.store.state &&
        (this.store.state.decimals !== decimals ||
          this.store.state.symbol !== symbol)
      )
        throw new Error("Token metadata changed; investigate before resuming");
      Object.assign(this.status, {
        latestBlock: head,
        decimals,
        symbol,
        status: "ready",
      });
      if (!this.store.state) {
        await this.store.save({
          nextBlock: this.fromBlock ?? Math.max(0, head - 99),
          events: [],
          checkpoint: null,
          symbol,
          decimals,
          totalEvents: 0,
        });
      }
      this.refresh();
      return this;
    } catch (error) {
      if (isPermanentMonitorError(error)) error.permanent = true;
      await this.close();
      throw error;
    }
  }

  refresh() {
    const state = this.store.state;
    this.status.lastScannedBlock = state.checkpoint?.number ?? null;
    this.status.eventCount = state.totalEvents;
  }

  events() {
    return [...(this.store.state?.events ?? [])]
      .reverse()
      .slice(0, 300)
      .map((event) => ({
        ...event,
        category: categoryOf(event),
        timestamp: event.timestamp ?? null,
      }));
  }

  async poll() {
    if (this.busy) throw new Error("Poll already in progress");
    this.busy = true;
    try {
      const head = integer(
        (await this.client.call("get_block_number")).blockNumber,
      );
      this.status.latestBlock = head;
      const state = this.store.state;
      if (state.checkpoint) {
        const saved = await this.client.call("get_block", {
          block: String(state.checkpoint.number),
        });
        if (saved?.hash?.toLowerCase() !== state.checkpoint.hash) {
          const error = new Error(
            "Checkpoint block hash mismatch (possible reorg); manual recovery required",
          );
          error.permanent = true;
          throw error;
        }
      }
      const to = Math.min(
        head - this.confirmations,
        state.nextBlock + this.chunkSize - 1,
      );
      let added = [];
      let checkpointBlockHash = state.checkpoint?.hash ?? null;
      if (to >= state.nextBlock) {
        const args = {
          address: this.contract,
          topics: [this.topics.length === 1 ? this.topics[0] : this.topics],
          fromBlock: String(state.nextBlock),
          toBlock: String(to),
        };
        const before = await this.client.call("get_block", {
          block: String(to),
        });
        const logs = await this.client.call("get_logs", args);
        if (!Array.isArray(logs))
          throw new Error("get_logs returned non-array");
        const decoded = logs
          .map((log) => {
            const event = decodeEvent(log, {
              contractAddress: this.contract,
              decimals: this.status.decimals,
              symbol: this.status.symbol,
              backfill: integer(log.blockNumber) <= this.liveBoundary,
              types: this.eventTypes,
            });
            if (event.blockNumber < state.nextBlock || event.blockNumber > to)
              throw new Error("Log outside requested range");
            return {
              ...event,
              amountRaw: event.value,
              explorerUrl: `https://pharosscan.xyz/tx/${event.transactionHash}`,
              observedAt: new Date().toISOString(),
            };
          })
          .sort(
            (a, b) => a.blockNumber - b.blockNumber || a.logIndex - b.logIndex,
          );
        const after = await this.client.call("get_block", {
          block: String(to),
        });
        if (
          !/^0x[0-9a-fA-F]{64}$/.test(before?.hash) ||
          before.hash?.toLowerCase() !== after?.hash?.toLowerCase()
        ) {
          throw new Error(
            "Scan block changed during query; retry without advancing",
          );
        }
        checkpointBlockHash = before.hash.toLowerCase();
        const ids = new Set(state.events.map((event) => event.id));
        for (const event of decoded) {
          if (!ids.has(event.id)) {
            ids.add(event.id);
            added.push(event);
          }
        }
      }
      const nextBlock = to >= state.nextBlock ? to + 1 : state.nextBlock;
      const checkpoint =
        to >= state.nextBlock
          ? { number: to, hash: checkpointBlockHash }
          : state.checkpoint;
      const updatedEvents = added.length
        ? [...state.events, ...added].slice(-1000)
        : state.events;
      const stateChanged = nextBlock !== state.nextBlock || added.length > 0;
      if (stateChanged) {
        await this.store.save({
          ...state,
          nextBlock,
          checkpoint,
          events: updatedEvents,
          totalEvents: state.totalEvents + added.length,
        });
      }
      this.refresh();
      Object.assign(this.status, {
        status: "watching",
        lastSuccessAt: new Date().toISOString(),
        lastError: null,
      });
      return {
        scannedTo: this.status.lastScannedBlock,
        latestBlock: head,
        newEvents: added.length,
        liveEvents: added.filter((event) => event.mode === "live").length,
        caughtUp: nextBlock > head - this.confirmations,
        events: added,
      };
    } catch (error) {
      if (isPermanentMonitorError(error)) error.permanent = true;
      if (error.permanent) {
        Object.assign(this.status, {
          status: "error",
          lastError: error.message.slice(0, 300),
        });
        throw error;
      }
      if (this.status.status !== "error") {
        Object.assign(this.status, {
          status: "error",
          lastError: error.message.slice(0, 300),
        });
      }
      throw error;
    } finally {
      this.busy = false;
    }
  }

  async close() {
    await this.client.close();
    await this.store.close();
  }
}
