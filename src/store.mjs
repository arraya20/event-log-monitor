import { mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { join, resolve } from "node:path";

export class StateStore {
  constructor(directory, fingerprint) {
    this.directory = resolve(directory);
    this.fingerprint = fingerprint;
    this.path = join(this.directory, "state.json");
    this.eventsPath = join(this.directory, "events.json");
    this.cursorPath = join(this.directory, "cursor.json");
    this.lockPath = join(this.directory, "collector.lock");
  }

  async open() {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    await this.acquireLock();
    try {
      await this.readState();
      return this;
    } catch (error) {
      await this.close();
      throw error;
    }
  }

  async acquireLock() {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        this.lock = await open(this.lockPath, "wx", 0o600);
        await this.lock.writeFile(
          JSON.stringify({
            pid: process.pid,
            startedAt: new Date().toISOString(),
          }),
        );
        await this.lock.sync();
        return;
      } catch (error) {
        if (this.lock) {
          await this.lock.close().catch(() => {});
          this.lock = undefined;
          await unlink(this.lockPath).catch(() => {});
        }
        if (error.code !== "EEXIST") throw error;
        if (await this.removeStaleLock()) continue;
        throw new Error(
          "Data directory locked by a running collector; do not remove collector.lock",
        );
      }
    }
    throw new Error(
      "Could not acquire collector lock after stale-lock cleanup",
    );
  }

  async removeStaleLock() {
    let owner;
    try {
      const text = await readFile(this.lockPath, "utf8");
      if (Buffer.byteLength(text) > 4096) return false;
      owner = JSON.parse(text);
    } catch (error) {
      // A newly-created lock may not yet contain its PID. Never unlink it blindly.
      return error.code === "ENOENT";
    }
    if (!Number.isSafeInteger(owner.pid) || owner.pid < 1) return false;
    try {
      process.kill(owner.pid, 0);
      return false;
    } catch (error) {
      if (error.code !== "ESRCH") return false; // EPERM means process exists but is not signalable.
    }
    try {
      const current = JSON.parse(await readFile(this.lockPath, "utf8"));
      if (current.pid !== owner.pid || current.startedAt !== owner.startedAt)
        return false;
      await unlink(this.lockPath);
      return true;
    } catch {
      return false;
    }
  }

  async readJson(path) {
    const text = await readFile(path, "utf8");
    if (Buffer.byteLength(text) > 8_000_000)
      throw new Error(`State file too large: ${path}`);
    return JSON.parse(text);
  }

  async readState() {
    let cursor;
    let eventState;
    try {
      [cursor, eventState] = await Promise.all([
        this.readJson(this.cursorPath),
        this.readJson(this.eventsPath),
      ]);
    } catch (error) {
      if (error.code === "ENOENT") {
        // Migrate the v1 single-file format on the next successful save.
        try {
          this.state = await this.readJson(this.path);
          this.validateState(this.state);
          this.legacyState = true;
          return;
        } catch (legacyError) {
          if (legacyError.code === "ENOENT") return;
          throw legacyError;
        }
      }
      throw error;
    }
    if (
      cursor.version !== 2 ||
      eventState.version !== 2 ||
      cursor.fingerprint !== this.fingerprint ||
      eventState.fingerprint !== this.fingerprint
    ) {
      throw new Error(
        "State belongs to a different chain, contract, or event filter; use a separate data directory (configuration mismatch)",
      );
    }
    if (
      !Array.isArray(eventState.events) ||
      eventState.events.length > 1000 ||
      !Number.isSafeInteger(cursor.nextBlock) ||
      cursor.nextBlock < 0
    ) {
      throw new Error("Invalid persisted event or cursor state");
    }
    if (
      eventState.events.some((event) => typeof event.id !== "string") ||
      new Set(eventState.events.map((event) => event.id)).size !==
        eventState.events.length
    ) {
      throw new Error("Invalid or duplicate stored event IDs");
    }
    this.state = {
      version: 2,
      fingerprint: this.fingerprint,
      nextBlock: cursor.nextBlock,
      checkpoint: cursor.checkpoint,
      events: eventState.events,
      totalEvents: eventState.totalEvents,
      symbol: eventState.symbol,
      decimals: eventState.decimals,
    };
  }

  validateState(state) {
    if (
      state.version !== 1 ||
      !Array.isArray(state.events) ||
      state.events.length > 1000 ||
      !Number.isSafeInteger(state.nextBlock) ||
      state.nextBlock < 0
    ) {
      throw new Error("Invalid legacy state");
    }
    if (!this.legacyFingerprintMatches(state.fingerprint)) {
      throw new Error(
        "State belongs to a different chain, contract, or event filter",
      );
    }
    if (
      state.events.some((event) => typeof event.id !== "string") ||
      new Set(state.events.map((event) => event.id)).size !==
        state.events.length
    ) {
      throw new Error("Invalid or duplicate stored event IDs");
    }
  }

  legacyFingerprintMatches(fingerprint) {
    try {
      const oldValue = JSON.parse(fingerprint);
      const newValue = JSON.parse(this.fingerprint);
      return (
        oldValue.chainId === newValue.chainId &&
        oldValue.contract === newValue.contract &&
        oldValue.topic === newValue.topic
      );
    } catch {
      return false;
    }
  }

  async atomicWrite(path, value) {
    const temporary = `${path}.tmp-${process.pid}`;
    const handle = await open(temporary, "w", 0o600);
    try {
      await handle.writeFile(JSON.stringify(value));
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temporary, path);
    try {
      const directoryHandle = await open(this.directory, "r");
      try {
        await directoryHandle.sync();
      } finally {
        await directoryHandle.close();
      }
    } catch (error) {
      if (!["EINVAL", "ENOTSUP", "EISDIR"].includes(error.code)) throw error;
    }
  }

  async save(state) {
    if (!this.lock) throw new Error("State store not locked");
    const eventsChanged =
      this.legacyState ||
      !this.state ||
      state.events !== this.state.events ||
      state.totalEvents !== this.state.totalEvents ||
      state.symbol !== this.state.symbol ||
      state.decimals !== this.state.decimals;
    const cursorChanged =
      this.legacyState ||
      !this.state ||
      state.nextBlock !== this.state.nextBlock ||
      state.checkpoint?.number !== this.state.checkpoint?.number ||
      state.checkpoint?.hash !== this.state.checkpoint?.hash;

    // Write event data first. If the process dies before cursor replacement,
    // the scan replays and stable IDs deduplicate those already-persisted events.
    if (eventsChanged) {
      await this.atomicWrite(this.eventsPath, {
        version: 2,
        fingerprint: this.fingerprint,
        events: state.events,
        totalEvents: state.totalEvents,
        symbol: state.symbol,
        decimals: state.decimals,
      });
    }
    if (cursorChanged) {
      await this.atomicWrite(this.cursorPath, {
        version: 2,
        fingerprint: this.fingerprint,
        nextBlock: state.nextBlock,
        checkpoint: state.checkpoint,
      });
    }
    this.state = { ...state, version: 2, fingerprint: this.fingerprint };
    this.legacyState = false;
  }

  async close() {
    if (!this.lock) return;
    await this.lock.close();
    this.lock = undefined;
    await unlink(this.lockPath).catch((error) => {
      if (error.code !== "ENOENT") throw error;
    });
  }
}
