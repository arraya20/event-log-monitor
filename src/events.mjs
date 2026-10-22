export const PHAROS_CHAIN_ID = 1672;
export const MCP_URL = "https://mcp.pharos.xyz/mcp";
export const DEFAULT_CONTRACT = "0xc879c018db60520f4355c26ed1a6d572cdac1815";
export const TRANSFER_TOPIC =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
export const APPROVAL_TOPIC =
  "0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925";
export const DEPOSIT_TOPIC =
  "0xe1fffcc4923d04b559f4d29a8bfc6cda04eb5b0d3c460751c2402c5c5cc9109c";
export const WITHDRAWAL_TOPIC =
  "0x7fcf532c15f0a6db0bd6d0e038bea71d30d808c7d98cb3bf7268a95bf5081b65";
const ZERO_ADDRESS = "0x" + "0".repeat(40);

// `indexed` is the number of indexed parameters, i.e. log.topics.length - 1.
export const EVENT_TYPES = {
  transfer: {
    name: "Transfer",
    topic: TRANSFER_TOPIC,
    indexed: 2,
    categories: ["transfer", "mint", "burn"],
  },
  approval: {
    name: "Approval",
    topic: APPROVAL_TOPIC,
    indexed: 2,
    categories: ["approval"],
  },
  deposit: {
    name: "Deposit",
    topic: DEPOSIT_TOPIC,
    indexed: 1,
    categories: ["deposit"],
  },
  withdrawal: {
    name: "Withdrawal",
    topic: WITHDRAWAL_TOPIC,
    indexed: 1,
    categories: ["withdrawal"],
  },
};
export const CATEGORIES = Object.values(EVENT_TYPES).flatMap(
  (type) => type.categories,
);

export function parseEventTypes(value = "transfer") {
  const items = (Array.isArray(value) ? value : String(value).split(","))
    .map((item) => String(item).trim().toLowerCase())
    .filter(Boolean);
  if (!items.length) throw new Error("At least one event type is required");
  for (const item of items)
    if (!Object.hasOwn(EVENT_TYPES, item))
      throw new Error(
        `Unsupported event type: ${item}. Use: ${Object.keys(EVENT_TYPES).join(", ")}`,
      );
  return [...new Set(items)];
}
export const eventTopics = (types) =>
  types.map((type) => EVENT_TYPES[type].topic).sort();
export const categoriesFor = (types) =>
  types.flatMap((type) => EVENT_TYPES[type].categories);
// Events stored before categories existed were all ERC-20 Transfers.
export function categoryOf(event) {
  if (event.category) return event.category;
  if (event.from === ZERO_ADDRESS) return "mint";
  if (event.to === ZERO_ADDRESS) return "burn";
  return "transfer";
}
export function address(value) {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(value))
    throw new Error("Invalid EVM address");
  return value.toLowerCase();
}
export function integer(value, label = "integer") {
  if (!/^(?:0x[0-9a-fA-F]+|[0-9]+)$/.test(String(value)))
    throw new Error(`Invalid ${label}`);
  const result = Number(BigInt(value));
  if (!Number.isSafeInteger(result) || result < 0)
    throw new Error(`Unsafe ${label}`);
  return result;
}
export function formatUnits(value, decimals) {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 255)
    throw new Error("Invalid decimals");
  const digits = BigInt(value)
    .toString()
    .padStart(decimals + 1, "0");
  return decimals
    ? `${digits.slice(0, -decimals)}.${digits.slice(-decimals)}`
    : digits;
}
// Block time is informational; a missing or malformed value must not stall the scan.
function blockTime(log) {
  try {
    if (log.blockTimestamp === undefined || log.blockTimestamp === null)
      throw new Error("missing");
    const blockTimestamp = integer(log.blockTimestamp, "block timestamp");
    const date = new Date(blockTimestamp * 1000);
    if (Number.isNaN(date.getTime())) throw new Error("invalid");
    return { blockTimestamp, timestamp: date.toISOString() };
  } catch {
    return { blockTimestamp: null, timestamp: null };
  }
}

export function decodeEvent(
  log,
  {
    contractAddress,
    decimals,
    symbol,
    backfill = false,
    types = ["transfer"],
  } = {},
) {
  if (decimals === undefined || symbol === undefined)
    throw new Error("Token decimals and symbol are required");
  if (log.removed) throw new Error("Removed log; manual recovery required");
  if (address(log.address) !== address(contractAddress))
    throw new Error("Unexpected log contract");
  const topic0 =
    Array.isArray(log.topics) && typeof log.topics[0] === "string"
      ? log.topics[0].toLowerCase()
      : null;
  const type = types.find((key) => EVENT_TYPES[key].topic === topic0);
  if (!type) throw new Error("Unexpected event signature");
  const definition = EVENT_TYPES[type];
  if (log.topics.length !== definition.indexed + 1)
    throw new Error(`Not an ERC20 ${definition.name} (NFT logs rejected)`);
  const decodeAddress = (topic) => {
    if (typeof topic !== "string" || !/^0x0{24}[0-9a-fA-F]{40}$/.test(topic))
      throw new Error("Noncanonical address topic");
    return address(`0x${topic.slice(-40)}`);
  };
  if (!/^0x[0-9a-fA-F]{64}$/.test(log.data))
    throw new Error("Invalid uint256 data");
  for (const field of ["transactionHash", "blockHash"])
    if (!/^0x[0-9a-fA-F]{64}$/.test(log[field]))
      throw new Error(`Invalid ${field}`);
  const logIndex = integer(log.logIndex, "log index");
  const transactionHash = log.transactionHash.toLowerCase();
  const value = BigInt(log.data).toString();
  const first = decodeAddress(log.topics[1]);
  // Deposit(dst, amount) has only a recipient; Withdrawal(src, amount) only a sender.
  const from = type === "deposit" ? null : first;
  const to =
    type === "withdrawal"
      ? null
      : type === "deposit"
        ? first
        : decodeAddress(log.topics[2]);
  const event = {
    id: `${transactionHash}:${logIndex}`,
    transactionHash,
    logIndex,
    blockNumber: integer(log.blockNumber, "block number"),
    blockHash: log.blockHash.toLowerCase(),
    ...blockTime(log),
    contractAddress: address(contractAddress),
    eventType: definition.name,
    from,
    to,
    value,
    amount: formatUnits(value, decimals),
    symbol,
    decimals,
    backfill,
    mode: backfill ? "backfill" : "live",
  };
  return { ...event, category: type === "transfer" ? categoryOf(event) : type };
}

export function decodeTransfer(log, options = {}) {
  return decodeEvent(log, { ...options, types: ["transfer"] });
}
