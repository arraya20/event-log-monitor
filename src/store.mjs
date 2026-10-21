import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';

export class StateStore {
  constructor(directory, fingerprint) {
    this.directory = resolve(directory); this.fingerprint = fingerprint;
    this.path = join(this.directory, 'state.json'); this.lockPath = join(this.directory, 'collector.lock');
  }
  async open() {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    try { this.lock = await open(this.lockPath, 'wx', 0o600); }
    catch (error) { if (error.code === 'EEXIST') throw new Error('Data directory locked. Check for a running collector before removing stale collector.lock'); throw error; }
    try {
      await this.lock.writeFile(JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
      try {
        const text = await readFile(this.path, 'utf8');
        if (text.length > 8_000_000) throw new Error('State file too large');
        const state = JSON.parse(text);
        if (state.version !== 1 || state.fingerprint !== this.fingerprint || !Array.isArray(state.events) || state.events.length > 1000 || !Number.isSafeInteger(state.nextBlock) || state.nextBlock < 0) throw new Error('Invalid state or configuration mismatch; use a separate data directory');
        if (state.events.some(event => typeof event.id !== 'string') || new Set(state.events.map(event => event.id)).size !== state.events.length) throw new Error('Invalid or duplicate stored event IDs');
        this.state = state;
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
      return this;
    } catch (error) { await this.close(); throw error; }
  }
  async save(state) {
    if (!this.lock) throw new Error('State store not locked');
    const next = { ...state, version: 1, fingerprint: this.fingerprint };
    const temporary = this.path + '.tmp';
    const handle = await open(temporary, 'w', 0o600);
    try { await handle.writeFile(JSON.stringify(next)); await handle.sync(); }
    finally { await handle.close(); }
    await rename(temporary, this.path);
    this.state = next;
  }
  async close() {
    if (!this.lock) return;
    await this.lock.close(); this.lock = undefined;
    await unlink(this.lockPath).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }
}
