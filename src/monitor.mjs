import { McpClient, MCP_URL } from './mcp.mjs';
import { DEFAULT_CONTRACT, TRANSFER_TOPIC, address, integer, decodeTransfer } from './events.mjs';
import { StateStore } from './store.mjs';

function abiUint(data) {
  if (!/^0x[0-9a-fA-F]{64}$/.test(data)) throw new Error('Invalid token decimals ABI');
  const value = Number(BigInt(data));
  if (!Number.isInteger(value) || value < 0 || value > 255) throw new Error('Invalid token decimals');
  return value;
}
function abiSymbol(data) {
  if (!/^0x[0-9a-fA-F]+$/.test(data) || data.length % 2 !== 0) throw new Error('Invalid token symbol ABI');
  const bytes = Buffer.from(data.slice(2), 'hex');
  if (bytes.length === 32) return new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/\0+$/, '').slice(0, 64);
  if (bytes.length < 64 || BigInt('0x' + bytes.subarray(0,32).toString('hex')) !== 32n) throw new Error('Invalid symbol ABI offset');
  const length = BigInt('0x' + bytes.subarray(32,64).toString('hex'));
  if (length > 256n || bytes.length < 64 + Number(length)) throw new Error('Invalid symbol ABI length');
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(64,64 + Number(length))).slice(0,64);
}
export class Monitor {
  constructor({ contract = DEFAULT_CONTRACT, dataDir = './data', intervalMs = 10_000, confirmations = 5, fromBlock, chunkSize = 500, client = new McpClient() } = {}) {
    this.contract = address(contract); this.intervalMs = integer(intervalMs); this.confirmations = integer(confirmations); this.chunkSize = integer(chunkSize);
    if (this.intervalMs < 1000 || this.chunkSize < 1 || this.chunkSize > 1000 || this.confirmations > 10000) throw new Error('Invalid monitor limits');
    this.fromBlock = fromBlock === undefined ? undefined : integer(fromBlock);
    this.client = client;
    this.store = new StateStore(dataDir, JSON.stringify({ chainId: 1672, contract: this.contract, topic: TRANSFER_TOPIC, confirmations: this.confirmations }));
    this.status = { contractAddress: this.contract, chainId: 1672, symbol: null, decimals: null, mcpUrl: MCP_URL, pollIntervalMs: this.intervalMs, confirmations: this.confirmations, latestBlock: null, lastScannedBlock: null, lastSuccessAt: null, lastError: null, startedAt: new Date().toISOString(), eventCount: 0, status: 'starting' };
  }
  async initialize() {
    await this.store.open();
    try {
      await this.client.connect();
      const chain = await this.client.call('get_chain_info');
      if (Number(chain.chainId) !== 1672) throw new Error('Expected Pharos chain ID 1672');
      const head = integer((await this.client.call('get_block_number')).blockNumber);
      this.liveBoundary = head;
      const block = String(head);
      const code = await this.client.call('get_code', { address: this.contract, block });
      if (!/^0x[0-9a-fA-F]+$/.test(code.code) || /^0x0*$/.test(code.code)) throw new Error('Target has no contract bytecode');
      const decimals = abiUint((await this.client.call('eth_call', { transaction: { to: this.contract, data: '0x313ce567' }, block })).result);
      const symbol = abiSymbol((await this.client.call('eth_call', { transaction: { to: this.contract, data: '0x95d89b41' }, block })).result);
      if (this.store.state && (this.store.state.decimals !== decimals || this.store.state.symbol !== symbol)) throw new Error('Token metadata changed; investigate before resuming');
      Object.assign(this.status, { latestBlock: head, decimals, symbol, status: 'ready' });
      if (!this.store.state) await this.store.save({ nextBlock: this.fromBlock ?? Math.max(0, head - 99), events: [], checkpoint: null, symbol, decimals, totalEvents: 0 });
      this.refresh();
      return this;
    } catch (error) { await this.close(); throw error; }
  }
  refresh() {
    const state = this.store.state;
    this.status.lastScannedBlock = state.checkpoint?.number ?? null;
    this.status.eventCount = state.totalEvents;
  }
  events() { return [...(this.store.state?.events ?? [])].reverse().slice(0,100); }
  async poll() {
    if (this.busy) throw new Error('Poll already in progress');
    this.busy = true;
    try {
      const head = integer((await this.client.call('get_block_number')).blockNumber);
      this.status.latestBlock = head;
      const state = this.store.state;
      if (state.checkpoint) {
        const saved = await this.client.call('get_block', { block: String(state.checkpoint.number) });
        if (saved?.hash?.toLowerCase() !== state.checkpoint.hash) throw new Error('Checkpoint block hash mismatch (possible reorg); manual recovery required');
      }
      const to = Math.min(head - this.confirmations, state.nextBlock + this.chunkSize - 1);
      let added = [];
      if (to >= state.nextBlock) {
        const args = { address: this.contract, topics: [TRANSFER_TOPIC], fromBlock: String(state.nextBlock), toBlock: String(to) };
        const before = await this.client.call('get_block', { block: String(to) });
        const logs = await this.client.call('get_logs', args);
        if (!Array.isArray(logs)) throw new Error('get_logs returned non-array');
        const decoded = logs.map(log => {
          const event = decodeTransfer(log, { contractAddress: this.contract, decimals: this.status.decimals, symbol: this.status.symbol, backfill: integer(log.blockNumber) <= this.liveBoundary });
          if (event.blockNumber < state.nextBlock || event.blockNumber > to) throw new Error('Log outside requested range');
          return { ...event, amountRaw: event.value, explorerUrl: `https://pharosscan.xyz/tx/${event.transactionHash}`, observedAt: new Date().toISOString() };
        }).sort((a,b) => a.blockNumber - b.blockNumber || a.logIndex - b.logIndex);
        const after = await this.client.call('get_block', { block: String(to) });
        if (!/^0x[0-9a-fA-F]{64}$/.test(before?.hash) || before.hash !== after?.hash) throw new Error('Scan block changed during query; retry without advancing');
        const ids = new Set(state.events.map(event => event.id));
        for (const event of decoded) if (!ids.has(event.id)) { ids.add(event.id); added.push(event); }
        await this.store.save({ ...state, nextBlock: to + 1, checkpoint: { number: to, hash: before.hash.toLowerCase() }, events: [...state.events, ...added].slice(-1000), totalEvents: state.totalEvents + added.length });
      }
      this.refresh();
      Object.assign(this.status, { status: 'watching', lastSuccessAt: new Date().toISOString(), lastError: null });
      return { scannedTo: this.status.lastScannedBlock, latestBlock: head, newEvents: added.length, liveEvents: added.filter(event => event.mode === 'live').length, events: added };
    } catch (error) {
      Object.assign(this.status, { status: 'error', lastError: error.message.slice(0,300) });
      throw error;
    } finally { this.busy = false; }
  }
  async close() { await this.client.close(); await this.store.close(); }
}
