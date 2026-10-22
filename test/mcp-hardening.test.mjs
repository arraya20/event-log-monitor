import { test } from "node:test";
import assert from "node:assert/strict";
import { McpClient, parseResponse } from "../src/mcp.mjs";

function response(message, session = "session") {
  return new Response(`event: message\ndata: ${JSON.stringify(message)}\n\n`, {
    headers: { "content-type": "text/event-stream", "mcp-session-id": session },
  });
}

test("tools/list pagination is followed before tool validation", async () => {
  const calls = [];
  const client = new McpClient({
    fetchImpl: async (_url, init) => {
      const request = JSON.parse(init.body);
      calls.push(request);
      if (request.method === "initialize")
        return response({ id: request.id, result: {} });
      if (request.method === "notifications/initialized")
        return new Response("", { status: 202 });
      if (request.method === "tools/list" && !request.params.cursor)
        return response({
          id: request.id,
          result: { tools: [], nextCursor: "next" },
        });
      if (request.method === "tools/list")
        return response({
          id: request.id,
          result: {
            tools: [
              "get_chain_info",
              "get_block_number",
              "get_block",
              "get_logs",
              "get_code",
              "eth_call",
            ].map((name) => ({ name })),
          },
        });
      throw new Error(`unexpected ${request.method}`);
    },
  });
  await client.connect();
  assert.equal(calls.filter((call) => call.method === "tools/list").length, 2);
});

test("JSON response size is measured in bytes, not JavaScript characters", async () => {
  const body = JSON.stringify({
    id: 1,
    result: { text: "é".repeat(4_100_000) },
  });
  assert.ok(body.length < 8_000_000);
  assert.ok(Buffer.byteLength(body) > 8_000_000);
  await assert.rejects(
    parseResponse(
      new Response(body, { headers: { "content-type": "application/json" } }),
      1,
    ),
    /too large/,
  );
});

test("MCP session can close and reconnect with a fresh session", async () => {
  const sessions = ["first", "second"];
  const calls = [];
  const client = new McpClient({
    fetchImpl: async (_url, init) => {
      const request = JSON.parse(init.body);
      calls.push({ request, session: init.headers["mcp-session-id"] ?? null });
      if (request.method === "initialize")
        return response({ id: request.id, result: {} }, sessions.shift());
      if (request.method === "notifications/initialized")
        return new Response("", { status: 202 });
      if (request.method === "tools/list") {
        return response(
          {
            id: request.id,
            result: {
              tools: [
                "get_chain_info",
                "get_block_number",
                "get_block",
                "get_logs",
                "get_code",
                "eth_call",
              ].map((name) => ({ name })),
            },
          },
          init.headers["mcp-session-id"],
        );
      }
      if (request.method === "DELETE") return new Response("", { status: 204 });
      throw new Error(`unexpected ${request.method}`);
    },
  });

  await client.connect();
  assert.equal(client.sessionId, "first");
  await client.close();
  await client.connect();
  assert.equal(client.sessionId, "second");
  assert.deepEqual(
    calls
      .filter(({ request }) => request.method === "initialize")
      .map(({ session }) => session),
    [null, null],
  );
});

test("MCP retries transient HTTP failure and succeeds", async () => {
  let attempts = 0;
  const client = new McpClient({
    attempts: 2,
    timeoutMs: 1000,
    fetchImpl: async (_url, init) => {
      attempts += 1;
      const request = JSON.parse(init.body);
      if (attempts === 1) return new Response("temporary", { status: 503 });
      return response({ id: request.id, result: { ok: true } });
    },
  });
  assert.deepEqual(await client.request("get_block_number"), { ok: true });
  assert.equal(attempts, 2);
});
