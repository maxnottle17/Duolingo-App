import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export function openDb(path) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS friends (
      id INTEGER PRIMARY KEY,
      username TEXT NOT NULL UNIQUE COLLATE NOCASE,
      display_name TEXT,
      avatar_url TEXT,
      duo_user_id TEXT,
      added_at INTEGER NOT NULL,
      last_fetched_at INTEGER,
      last_error TEXT
    );
    CREATE TABLE IF NOT EXISTS snapshots (
      id INTEGER PRIMARY KEY,
      friend_id INTEGER NOT NULL REFERENCES friends(id) ON DELETE CASCADE,
      taken_at INTEGER NOT NULL,
      total_xp INTEGER NOT NULL,
      streak INTEGER NOT NULL,
      courses_json TEXT
    );
    CREATE INDEX IF NOT EXISTS snapshots_friend_time ON snapshots(friend_id, taken_at);
    CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
  `);
  return new Store(db);
}

export class Store {
  constructor(db) {
    this.db = db;
  }

  listFriends() {
    return this.db.prepare('SELECT * FROM friends ORDER BY username').all();
  }

  getFriend(username) {
    return this.db.prepare('SELECT * FROM friends WHERE username = ?').get(username);
  }

  addFriend(profile, now = Date.now()) {
    const { lastInsertRowid } = this.db
      .prepare(
        'INSERT INTO friends (username, display_name, avatar_url, duo_user_id, added_at) VALUES (?, ?, ?, ?, ?)'
      )
      .run(profile.username, profile.displayName ?? null, profile.avatarUrl ?? null, profile.duoUserId ?? null, now);
    return Number(lastInsertRowid);
  }

  removeFriend(username) {
    return this.db.prepare('DELETE FROM friends WHERE username = ?').run(username).changes > 0;
  }

  recordSnapshot(friendId, profile, now = Date.now()) {
    this.db
      .prepare(
        'INSERT INTO snapshots (friend_id, taken_at, total_xp, streak, courses_json) VALUES (?, ?, ?, ?, ?)'
      )
      .run(friendId, now, profile.totalXp, profile.streak ?? 0, JSON.stringify(profile.courses ?? []));
    this.db
      .prepare(
        'UPDATE friends SET display_name = ?, avatar_url = ?, duo_user_id = ?, last_fetched_at = ?, last_error = NULL WHERE id = ?'
      )
      .run(profile.displayName ?? null, profile.avatarUrl ?? null, profile.duoUserId ?? null, now, friendId);
  }

  recordError(friendId, message) {
    this.db.prepare('UPDATE friends SET last_error = ? WHERE id = ?').run(message, friendId);
  }

  snapshots(friendId) {
    return this.db
      .prepare('SELECT taken_at, total_xp, streak FROM snapshots WHERE friend_id = ? ORDER BY taken_at')
      .all(friendId);
  }

  latestSnapshot(friendId) {
    return this.db
      .prepare('SELECT * FROM snapshots WHERE friend_id = ? ORDER BY taken_at DESC LIMIT 1')
      .get(friendId);
  }

  getMeta(key) {
    return this.db.prepare('SELECT value FROM meta WHERE key = ?').get(key)?.value ?? null;
  }

  setMeta(key, value) {
    this.db
      .prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .run(key, String(value));
  }

  close() {
    this.db.close();
  }
}
