import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONTRACT, TRANSFER_TOPIC, decodeTransfer, formatUnits } from '../src/events.mjs';
const word = value => '0x' + BigInt(value).toString(16).padStart(64, '0');
const log = {
  address: DEFAULT_CONTRACT,
  topics: [TRANSFER_TOPIC, '0x' + '0'.repeat(24) + '12'.repeat(20), '0x' + '0'.repeat(24) + '34'.repeat(20)],
  data: word(900719925474099312345678n),
  transactionHash: '0x' + 'ab'.repeat(32), blockHash: '0x' + 'cd'.repeat(32),
  blockNumber: '0x123', logIndex: '0x2', removed: false,
};
test('exact uint256 formatting beyond floating point precision', () => {
  const event = decodeTransfer(log);
  assert.equal(event.amount, '900719925474099312.345678');
  assert.equal(event.blockNumber, 291);
  assert.equal(event.from, '0x' + '12'.repeat(20));
  assert.equal(event.to, '0x' + '34'.repeat(20));
});
test('format handles zero decimals and 255 decimals without rounding', () => {
  assert.equal(formatUnits('10', 0), '10');
  const formatted = formatUnits('1', 255);
  assert.equal(formatted, '0.' + '0'.repeat(254) + '1');
});
test('reject ERC721, noncanonical topics, malformed amounts, foreign contract and removed logs', () => {
  for (const patch of [
    { topics: [...log.topics, word(7)] },
    { topics: [TRANSFER_TOPIC, '0x' + 'ff'.repeat(32), log.topics[2]] },
    { data: '0x1' }, { address: '0x' + 'ff'.repeat(20) }, { removed: true },
    { transactionHash: '0x123' }, { blockHash: '0x123' }, { logIndex: '-1' },
  ]) assert.throws(() => decodeTransfer({ ...log, ...patch }));
});
test('backfill distinguished from observation after startup', () => {
  assert.equal(decodeTransfer(log, { backfill: true }).mode, 'backfill');
  assert.equal(decodeTransfer(log).mode, 'live');
});
