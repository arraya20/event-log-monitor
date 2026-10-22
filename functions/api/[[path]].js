const ALLOWED = new Set(["/api/status", "/api/events"]);
const MAX_BODY = 1_000_000;

function collectorOrigin(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("Invalid collector origin");
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  )
    throw new Error("Collector origin must be an HTTPS origin");
  return url;
}

function response(body, status, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
      ...headers,
    },
  });
}

export async function onRequest(context) {
  const requestUrl = new URL(context.request.url);
  if (context.request.method !== "GET")
    return response({ error: "GET only" }, 405, { allow: "GET" });
  if (!ALLOWED.has(requestUrl.pathname) || requestUrl.search)
    return response({ error: "Not found" }, 404);

  let origin;
  try {
    origin = collectorOrigin(context.env.COLLECTOR_ORIGIN);
  } catch {
    return response({ error: "Collector unavailable" }, 503);
  }

  const headers = { accept: "application/json", "cache-control": "no-store" };
  if (context.env.COLLECTOR_TOKEN)
    headers.authorization = `Bearer ${context.env.COLLECTOR_TOKEN}`;
  try {
    const upstream = await fetch(new URL(requestUrl.pathname, origin), {
      headers,
      redirect: "error",
      signal: AbortSignal.timeout(8000),
      cf: { cacheTtl: 5, cacheEverything: true },
    });
    if (upstream.redirected) throw new Error("redirect");
    const body = await upstream.arrayBuffer();
    if (body.byteLength > MAX_BODY) throw new Error("large response");
    const responseHeaders = {
      "content-type":
        upstream.headers.get("content-type") ?? "application/json",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    };
    if (upstream.status === 200)
      responseHeaders["cache-control"] = "public, max-age=5, s-maxage=5";
    return new Response(body, {
      status: upstream.status,
      headers: responseHeaders,
    });
  } catch (error) {
    console.error(
      "collector fetch failed:",
      requestUrl.pathname,
      error?.name,
      error?.message,
    );
    return response({ error: "Collector unavailable" }, 502, {
      "x-content-type-options": "nosniff",
    });
  }
}
