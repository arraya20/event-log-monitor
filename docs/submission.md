# Event/Log Monitor submission checklist

Task: https://pharos-agent-arena.vercel.app/tasks/event-log-monitor

## Reviewer requirements
1. Chain MCP `get_logs`, filtered by contract and Transfer event signature.
2. Continuous polling; new events only, duplicate prevention.
3. Readable from/to/amount/transaction hash/block fields.
4. At least one actual live or test event captured.

## Evidence to retain
- Actual MCP endpoint and chain ID.
- Contract address, token decimals source, event signature.
- Startup and checkpoint block, polling interval and confirmation delay.
- Historical bootstrap versus events observed in subsequent cycles.
- First and subsequent polling output, transaction explorer links.
- Restart with the same data directory and no duplicate event IDs.

## Suggested video
1. Open the deployed monitor and point out contract, chain and MCP source.
2. Show collector scans advancing and an event arriving; explain polling and delay.
3. Open that transaction on the explorer and compare decoded fields.
4. Restart the collector, show checkpoint recovery and unique event IDs.
5. Show tests and repository structure briefly.

## Proof links
Fill only after verification. A planned domain or a local preview is not a public proof link.

- Proof URL: pending deployment verification.
- Repository URL: pending publication.
- Video URL: optional, pending recording/publication (+50 subject to reviewer approval).

## Reviewer note template
Pharos Event Log Monitor continuously polls the official Pharos Chain MCP for ERC-20 Transfer logs, filtered by contract address and event signature. It decodes sender, recipient, raw and formatted token amount, transaction hash, log index, and block number. The collector persists events and its checkpoint together and resumes from the checkpoint after restart. The Cloudflare Pages dashboard reads the separate collector through a same-origin API proxy. Historical bootstrap events are distinguished from events detected after startup. No wallet connection, private keys, or transactions are required. Please see the proof page and repository for the exact configuration and captured evidence.
