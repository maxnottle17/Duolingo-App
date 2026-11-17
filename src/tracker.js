// Fetches profiles and records snapshots, on a schedule and on demand.
import { fetchProfile, mockProfile, ProfileNotFoundError } from './duolingo.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class Tracker {
  constructor(store, config, { fetcher, log = console } = {}) {
    this.store = store;
    this.config = config;
    this.log = log;
    this.fetcher = fetcher ?? (config.mock ? async (u) => mockProfile(u) : (u) => fetchProfile(u));
    this.running = null;
    this.timers = [];
  }

  // Look up a username on Duolingo, save it, and take a first snapshot.
  async addFriend(username) {
    const clean = String(username || '').trim().replace(/^@/, '');
    if (!/^[A-Za-z0-9._-]{1,40}$/.test(clean)) {
      const err = new Error('That does not look like a Duolingo username.');
      err.status = 400;
      throw err;
    }
    if (this.store.getFriend(clean)) {
      const err = new Error(`${clean} is already on the board.`);
      err.status = 409;
      throw err;
    }
    let profile;
    try {
      profile = await this.fetcher(clean);
    } catch (e) {
      if (e instanceof ProfileNotFoundError) e.status = 404;
      else e.status = 502;
      throw e;
    }
    const id = this.store.addFriend(profile);
    this.store.recordSnapshot(id, profile);
    return this.store.getFriend(profile.username);
  }

  // Refresh everyone. Concurrent calls share the same run.
  refreshAll() {
    if (!this.running) {
      this.running = this.#refresh().finally(() => {
        this.running = null;
      });
    }
    return this.running;
  }

  async #refresh() {
    const friends = this.store.listFriends();
    let ok = 0;
    for (const [i, f] of friends.entries()) {
      if (i > 0 && this.config.fetchDelayMs > 0) await sleep(this.config.fetchDelayMs);
      try {
        const profile = await this.fetcher(f.username);
        this.store.recordSnapshot(f.id, profile);
        ok++;
      } catch (e) {
        this.store.recordError(f.id, e.message);
        this.log.warn(`[refresh] ${f.username}: ${e.message}`);
      }
    }
    const at = Date.now();
    this.store.setMeta('last_refresh_at', at);
    this.log.info(`[refresh] updated ${ok}/${friends.length} friends`);
    return { updated: ok, total: friends.length, at };
  }

  // Refresh every N hours, plus once just after local midnight so that
  // "Today" numbers start from an accurate baseline.
  start() {
    const every = this.config.fetchIntervalHours * 3_600_000;
    const last = Number(this.store.getMeta('last_refresh_at')) || 0;
    const firstDelay = Math.max(5_000, last + every - Date.now());
    const kick = () => this.refreshAll().catch((e) => this.log.error('[refresh]', e));
    this.timers.push(
      setTimeout(() => {
        kick();
        this.timers.push(setInterval(kick, every));
      }, firstDelay)
    );
    const scheduleMidnight = () => {
      const next = new Date();
      next.setHours(24, 2, 0, 0);
      this.timers.push(
        setTimeout(() => {
          kick();
          scheduleMidnight();
        }, next.getTime() - Date.now())
      );
    };
    scheduleMidnight();
  }

  stop() {
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
  }
}
