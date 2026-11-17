import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { Tracker } from '../src/tracker.js';
import { createApp } from '../src/server.js';
import { mockProfile } from '../src/duolingo.js';

let server, base, store;
const quiet = { info() {}, warn() {}, error() {} };

before(async () => {
  store = openDb(':memory:');
  const config = { adminToken: 'secret', fetchIntervalHours: 3, fetchDelayMs: 0, mock: true };
  const tracker = new Tracker(store, config, { fetcher: async (u) => mockProfile(u), log: quiet });
  server = createApp({ store, tracker, config });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server.close();
  store.close();
});

const call = (path, { method = 'GET', body, token } = {}) =>
  fetch(base + path, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

test('serves the app shell and static files', async () => {
  const res = await call('/');
  assert.equal(res.status, 200);
  assert.match(await res.text(), /XP League/);
  assert.equal((await call('/manifest.webmanifest')).headers.get('content-type'), 'application/manifest+json');
  assert.equal((await call('/settings')).status, 200, 'unknown paths fall back to the shell');
  assert.equal((await call('/..%2fpackage.json')).status, 404, 'no path traversal');
});

test('adding friends needs the admin password', async () => {
  assert.equal((await call('/api/friends', { method: 'POST', body: { username: 'ana' } })).status, 401);
  assert.equal((await call('/api/friends', { method: 'POST', body: { username: 'ana' }, token: 'wrong' })).status, 401);
  const res = await call('/api/friends', { method: 'POST', body: { username: 'ana' }, token: 'secret' });
  assert.equal(res.status, 201);
  assert.equal((await call('/api/friends', { method: 'POST', body: { username: 'ANA' }, token: 'secret' })).status, 409);
  assert.equal((await call('/api/friends', { method: 'POST', body: { username: 'missing_x' }, token: 'secret' })).status, 404);
  assert.equal((await call('/api/friends', { method: 'POST', body: { username: 'bad name!' }, token: 'secret' })).status, 400);
});

test('leaderboard, detail, refresh and remove', async () => {
  await call('/api/friends', { method: 'POST', body: { username: 'ben' }, token: 'secret' });
  const board = await (await call('/api/leaderboard?period=all')).json();
  assert.deepEqual(board.friends.map((f) => f.username).sort(), ['ana', 'ben']);
  assert.ok(board.friends.every((f) => f.totalXp > 0 && f.rank >= 1));

  assert.equal((await call('/api/leaderboard?period=year')).status, 400);

  const detail = await (await call('/api/friends/ana')).json();
  assert.equal(detail.history.length, 30);
  assert.ok(detail.courses.length >= 1);

  const refresh = await (await call('/api/refresh', { method: 'POST', token: 'secret' })).json();
  assert.equal(refresh.updated, 2);
  const status = await (await call('/api/status')).json();
  assert.equal(status.adminRequired, true);
  assert.equal(status.isAdmin, false);
  assert.ok(status.lastRefreshAt);

  assert.equal((await call('/api/friends/ben', { method: 'DELETE' })).status, 401);
  assert.equal((await call('/api/friends/ben', { method: 'DELETE', token: 'secret' })).status, 200);
  assert.equal((await call('/api/friends/ben')).status, 404);
});
