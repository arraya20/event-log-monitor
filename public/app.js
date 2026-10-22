const $ = (selector) => document.querySelector(selector);
let latest = { events: [] },
  selectedCategory = "all",
  page = 1,
  busy = false;
const PAGE_SIZE = 25;
const text = (selector, value) => {
  $(selector).textContent = value ?? "—";
};
const short = (value) =>
  typeof value === "string" && value.length > 18
    ? `${value.slice(0, 10)}…${value.slice(-8)}`
    : (value ?? "—");
function safeHash(value) {
  return typeof value === "string" && /^0x[0-9a-f]{64}$/i.test(value)
    ? value
    : null;
}
const timeFormat = new Intl.DateTimeFormat(undefined, {
  year: "numeric",
  month: "short",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});
function renderTime(event) {
  const cell = document.createElement("td");
  const date = new Date(event.timestamp ?? NaN);
  if (Number.isNaN(date.getTime())) {
    cell.textContent = "—";
    return cell;
  }
  const time = document.createElement("time");
  time.dateTime = date.toISOString();
  time.title = `${date.toISOString()} (block time, UTC)`;
  time.textContent = timeFormat.format(date);
  cell.append(time);
  return cell;
}
const categoryOf = (event) =>
  typeof event.category === "string" ? event.category : "transfer";
function renderEvent(event) {
  const row = document.createElement("tr");
  row.append(renderTime(event));
  for (const value of [
    categoryOf(event),
    event.mode,
    event.blockNumber,
    short(event.from),
    short(event.to),
    `${event.amount ?? event.amountRaw ?? "—"} ${event.symbol ?? ""}`.trim(),
  ]) {
    const cell = document.createElement("td");
    cell.textContent = value;
    row.append(cell);
  }
  const tx = document.createElement("td");
  const hash = safeHash(event.transactionHash);
  if (hash) {
    const link = document.createElement("a");
    link.href = `https://pharosscan.xyz/tx/${hash}`;
    link.target = "_blank";
    link.rel = "noreferrer";
    link.textContent = short(hash);
    tx.append(link);
  } else tx.textContent = "invalid hash";
  row.append(tx);
  return row;
}
function syncFilter(events, status) {
  const select = $("#category");
  const counts = new Map();
  for (const event of events)
    counts.set(categoryOf(event), (counts.get(categoryOf(event)) ?? 0) + 1);
  const names = new Set([...(status.categories ?? []), ...counts.keys()]);
  if (selectedCategory !== "all") names.add(selectedCategory);
  const options = [["all", `All (${events.length})`]];
  for (const name of [...names].sort())
    options.push([name, `${name} (${counts.get(name) ?? 0})`]);
  select.replaceChildren(
    ...options.map(([value, label]) => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = label;
      return option;
    }),
  );
  select.value = selectedCategory;
}
function visibleEvents() {
  const events = Array.isArray(latest.events) ? latest.events : [];
  return selectedCategory === "all"
    ? events
    : events.filter((event) => categoryOf(event) === selectedCategory);
}
function renderPager(total, pages, start, shown) {
  $("#pager").hidden = total <= PAGE_SIZE;
  $("#prev").disabled = page <= 1;
  $("#next").disabled = page >= pages;
  text(
    "#page-info",
    total
      ? `Page ${page} of ${pages} · rows ${start + 1}–${start + shown} of ${total}`
      : null,
  );
}
function renderTable() {
  const body = $("#events");
  body.replaceChildren();
  const all = visibleEvents();
  const pages = Math.max(1, Math.ceil(all.length / PAGE_SIZE));
  page = Math.min(Math.max(1, page), pages);
  const start = (page - 1) * PAGE_SIZE;
  const events = all.slice(start, start + PAGE_SIZE);
  renderPager(all.length, pages, start, events.length);
  if (!events.length) {
    const row = document.createElement("tr"),
      cell = document.createElement("td");
    cell.colSpan = 8;
    cell.className = "empty";
    cell.textContent =
      selectedCategory === "all"
        ? "No events captured yet."
        : `No ${selectedCategory} events among the latest ${latest.events.length} captured.`;
    row.append(cell);
    body.append(row);
  } else events.forEach((event) => body.append(renderEvent(event)));
}
function render(status, payload) {
  latest = {
    ...payload,
    events: Array.isArray(payload.events) ? payload.events : [],
  };
  const fresh =
    status.lastSuccessAt &&
    Date.now() - Date.parse(status.lastSuccessAt) <=
      3 * (status.pollIntervalMs ?? 10_000);
  const isError = status.status === "error";
  const stateLabel = isError ? "error" : fresh ? status.status : "stale";
  text("#state", stateLabel);
  text(
    "#token",
    status.symbol && status.decimals !== null
      ? `${status.symbol} · ${status.decimals} decimals`
      : null,
  );
  text("#chain", status.chainId ? `Pharos · ${status.chainId}` : null);
  text("#block", status.latestBlock);
  text("#count", status.eventCount);
  text("#scanned", status.lastScannedBlock);
  text("#contract", status.contractAddress);
  text("#source", status.mcpUrl);
  text(
    "#updated",
    status.lastSuccessAt
      ? `Last successful scan ${new Date(status.lastSuccessAt).toLocaleString()}`
      : "No successful scan",
  );
  const notice = $("#notice");
  notice.className = `notice ${isError || !fresh ? "bad" : "good"}`;
  if (isError)
    notice.textContent = `Collector error: ${status.lastError ?? "unknown error"}`;
  else if (!fresh)
    notice.textContent = `Collector data is stale. Last successful scan: ${status.lastSuccessAt ? new Date(status.lastSuccessAt).toLocaleString() : "none"}.`;
  else
    notice.textContent = `Collector ${status.status}. Page refreshes every ${Math.round((status.pollIntervalMs ?? 10000) / 1000)} seconds; this UI is not a websocket.`;
  syncFilter(latest.events, status);
  renderTable();
}
async function refresh() {
  if (busy || document.hidden) return;
  busy = true;
  try {
    const [statusResponse, eventsResponse] = await Promise.all([
      fetch("/api/status", { cache: "no-store" }),
      fetch("/api/events", { cache: "no-store" }),
    ]);
    if (!statusResponse.ok || !eventsResponse.ok)
      throw new Error(
        `collector HTTP ${statusResponse.status}/${eventsResponse.status}`,
      );
    render(await statusResponse.json(), await eventsResponse.json());
  } catch (error) {
    const notice = $("#notice");
    notice.className = "notice bad";
    notice.textContent = `Collector unavailable: ${error.message}`;
    text("#state", "unavailable");
    text("#updated", "Retrying on next poll");
  } finally {
    busy = false;
  }
}
$("#category").addEventListener("change", (event) => {
  selectedCategory = event.target.value;
  page = 1;
  renderTable();
});
$("#prev").addEventListener("click", () => {
  page -= 1;
  renderTable();
});
$("#next").addEventListener("click", () => {
  page += 1;
  renderTable();
});
$("#export").addEventListener("click", () => {
  const payload = {
    ...latest,
    category: selectedCategory,
    events: visibleEvents(),
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: "application/json",
  });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = "pharos-event-monitor.json";
  link.click();
  URL.revokeObjectURL(link.href);
});
refresh();
setInterval(refresh, 10_000);
