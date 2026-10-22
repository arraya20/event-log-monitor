import { PHAROS_CHAIN_ID } from "./events.mjs";

export const MCP_URL = "https://mcp.pharos.xyz/mcp";
const ALLOWED = new Set([
  "get_chain_info",
  "get_block_number",
  "get_block",
  "get_logs",
  "get_code",
  "eth_call",
]);
const MAX_RESPONSE_BYTES = 8_000_000;

export async function parseResponse(response, id) {
  if (response.headers.get("content-type")?.includes("application/json")) {
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.byteLength > MAX_RESPONSE_BYTES)
      throw new Error("MCP response too large");
    return JSON.parse(buffer.toString("utf8"));
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) throw new Error("MCP SSE ended without matching response");
      bytes += value.byteLength;
      if (bytes > MAX_RESPONSE_BYTES) throw new Error("MCP response too large");
      buffer += decoder.decode(value, { stream: true });
      let match;
      while ((match = /\r?\n\r?\n/.exec(buffer))) {
        const frame = buffer.slice(0, match.index);
        buffer = buffer.slice(match.index + match[0].length);
        const data = frame
          .split(/\r?\n/)
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trimStart())
          .join("\n");
        if (!data) continue;
        const message = JSON.parse(data);
        if (message.id === id) return message;
      }
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
}

export class McpClient {
  constructor({ fetchImpl = fetch, timeoutMs = 15_000, attempts = 3 } = {}) {
    this.fetch = fetchImpl;
    this.timeoutMs = timeoutMs;
    this.attempts = attempts;
    this.id = 0;
  }

  async request(method, params = {}, notification = false) {
    const id = notification ? undefined : ++this.id;
    for (let attempt = 0; attempt < this.attempts; attempt += 1) {
      try {
        const headers = {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          "MCP-Protocol-Version": "2025-06-18",
        };
        if (this.sessionId) headers["mcp-session-id"] = this.sessionId;
        const response = await this.fetch(MCP_URL, {
          method: "POST",
          headers,
          signal: AbortSignal.timeout(this.timeoutMs),
          body: JSON.stringify({
            jsonrpc: "2.0",
            ...(notification ? {} : { id }),
            method,
            params,
          }),
        });
        if (!response.ok) {
          await response.body?.cancel();
          const error = new Error(`MCP HTTP ${response.status}`);
          error.permanent =
            response.status < 500 && ![408, 429].includes(response.status);
          throw error;
        }
        this.sessionId =
          response.headers.get("mcp-session-id") ?? this.sessionId;
        if (notification) {
          await response.body?.cancel();
          return;
        }
        const message = await parseResponse(response, id);
        if (message.id !== id || message.error || !message.result) {
          const error = new Error(
            message.error?.message ?? "Invalid MCP response",
          );
          error.permanent = true;
          throw error;
        }
        return message.result;
      } catch (error) {
        if (error.permanent || attempt + 1 === this.attempts) throw error;
        await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** attempt));
      }
    }
  }

  async connect() {
    await this.request("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "pharos-event-log-monitor", version: "0.1.0" },
    });
    await this.request("notifications/initialized", {}, true);
    let cursor;
    const available = new Set();
    const cursors = new Set();
    do {
      const page = await this.request("tools/list", cursor ? { cursor } : {});
      for (const tool of page.tools ?? []) available.add(tool.name);
      cursor = page.nextCursor;
      if (cursor && cursors.has(cursor))
        throw new Error("MCP tools/list repeated pagination cursor");
      if (cursor) cursors.add(cursor);
    } while (cursor);
    for (const name of ALLOWED) {
      if (!available.has(name)) throw new Error(`Missing MCP tool ${name}`);
    }
    return this;
  }

  async call(name, args = {}) {
    if (!ALLOWED.has(name))
      throw new Error(`Read-only tool not allowed: ${name}`);
    const result = await this.request("tools/call", { name, arguments: args });
    const text = result.content?.find((item) => item.type === "text")?.text;
    if (result.isError || !text) {
      const error = new Error(
        `MCP ${name} failed: ${text?.slice(0, 250) ?? "empty response"}`,
      );
      error.permanent = !/HTTP 5\d\d|timeout|temporar|rate limit/i.test(
        text ?? "",
      );
      throw error;
    }
    try {
      return JSON.parse(text);
    } catch (parseError) {
      const error = new Error(
        `MCP ${name} returned invalid JSON: ${parseError.message}`,
      );
      error.permanent = true;
      throw error;
    }
  }

  async close() {
    if (!this.sessionId) return;
    try {
      const response = await this.fetch(MCP_URL, {
        method: "DELETE",
        headers: { "mcp-session-id": this.sessionId },
        signal: AbortSignal.timeout(3000),
      });
      await response.body?.cancel();
    } catch {
      // Cleanup does not change persisted evidence.
    }
    this.sessionId = undefined;
  }
}
