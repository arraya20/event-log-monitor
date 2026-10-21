export const DEFAULT_CONTRACT = '0xc879c018db60520f4355c26ed1a6d572cdac1815';
export const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
export function address(value) {
  if (typeof value !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(value)) throw new Error('Invalid EVM address');
  return value.toLowerCase();
}
export function integer(value, label = 'integer') {
  if (!/^(?:0x[0-9a-fA-F]+|[0-9]+)$/.test(String(value))) throw new Error(`Invalid ${label}`);
  const result = Number(BigInt(value));
  if (!Number.isSafeInteger(result) || result < 0) throw new Error(`Unsafe ${label}`);
  return result;
}
export function formatUnits(value, decimals) {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 255) throw new Error('Invalid decimals');
  const digits = BigInt(value).toString().padStart(decimals + 1, '0');
  return decimals ? `${digits.slice(0, -decimals)}.${digits.slice(-decimals)}` : digits;
}
export function decodeTransfer(log, { contractAddress = DEFAULT_CONTRACT, decimals = 6, symbol = 'USDC', backfill = false } = {}) {
  if (log.removed) throw new Error('Removed log; manual recovery required');
  if (address(log.address) !== address(contractAddress)) throw new Error('Unexpected log contract');
  if (!Array.isArray(log.topics) || log.topics.length !== 3 || log.topics[0].toLowerCase() !== TRANSFER_TOPIC) throw new Error('Not an ERC20 Transfer (NFT logs rejected)');
  const decodeAddress = topic => {
    if (typeof topic !== 'string' || !/^0x0{24}[0-9a-fA-F]{40}$/.test(topic)) throw new Error('Noncanonical address topic');
    return address(`0x${topic.slice(-40)}`);
  };
  if (!/^0x[0-9a-fA-F]{64}$/.test(log.data)) throw new Error('Invalid uint256 data');
  for (const field of ['transactionHash', 'blockHash']) if (!/^0x[0-9a-fA-F]{64}$/.test(log[field])) throw new Error(`Invalid ${field}`);
  const logIndex = integer(log.logIndex, 'log index');
  const transactionHash = log.transactionHash.toLowerCase();
  const value = BigInt(log.data).toString();
  return { id: `${transactionHash}:${logIndex}`, transactionHash, logIndex, blockNumber: integer(log.blockNumber, 'block number'), blockHash: log.blockHash.toLowerCase(), contractAddress: address(contractAddress), from: decodeAddress(log.topics[1]), to: decodeAddress(log.topics[2]), value, amount: formatUnits(value, decimals), symbol, decimals, backfill, mode: backfill ? 'backfill' : 'live' };
}
