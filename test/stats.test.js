import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gainSince, periodGain, dailyHistory, snapshotAt, startOfDay, buildLeaderboard } from '../src/stats.js';
import { openDb } from '../src/db.js';

const H = 3_600_000;
const now = new Date(2026, 10, 17, 15, 0).getTime(); // 17 Nov, 15:00 local
const today = startOfDay(now);

const snap = (t, xp) => ({ taken_at: t, total_xp: xp, streak: 1 });

test('snapshotAt finds the last snapshot at or before a time', () => {
  const s = [snap(10, 1), snap(20, 2), snap(30, 3)];
  assert.equal(snapshotAt(s, 5), null);
  assert.equal(snapshotAt(s, 20).total_xp, 2);
  assert.equal(snapshotAt(s, 29).total_xp, 2);
  assert.equal(snapshotAt(s, 99).total_xp, 3);
});

test('today gain uses the last snapshot before midnight as baseline', () => {
  const s = [snap(today - 2 * H, 1000), snap(today + 9 * H, 1050), snap(today + 14 * H, 1120)];
  assert.deepEqual(periodGain(s, 'today', now), { xp: 120, partial: false });
});

test('gain is marked partial when tracking started inside the period', () => {
  const s = [snap(today - 2 * 24 * H, 500), snap(today + H, 800)];
  assert.deepEqual(periodGain(s, 'week', now), { xp: 300, partial: true });
  assert.deepEqual(gainSince([], today), { xp: 0, partial: true });
});

test('all-time is the total XP', () => {
  assert.deepEqual(periodGain([snap(1, 10), snap(2, 4321)], 'all', now), { xp: 4321, partial: false });
});

test('daily history buckets by local day and leaves untracked days null', () => {
  const s = [
    snap(today - 2 * 24 * H + 12 * H, 100), // first snapshot, 2 days ago at noon
    snap(today - 24 * H + 10 * H, 160), // yesterday
    snap(today - 24 * H + 22 * H, 200),
    snap(today + 8 * H, 230), // today
  ];
  const h = dailyHistory(s, 4, now);
  assert.equal(h.length, 4);
  assert.equal(h[0].xp, null); // 3 days ago: nothing tracked
  assert.equal(h[1].xp, 0); // only one snapshot that day
  assert.equal(h[2].xp, 100); // 200 - 100
  assert.equal(h[3].xp, 30);
  assert.match(h[3].date, /^2026-11-17$/);
});

test('leaderboard ranks by XP gained with ties sharing a rank', () => {
  const store = openDb(':memory:');
  const add = (name, xps) => {
    const id = store.addFriend({ username: name, displayName: name, avatarUrl: null, duoUserId: null });
    xps.forEach(([t, xp]) => store.recordSnapshot(id, { username: name, displayName: name, totalXp: xp, streak: 5, courses: [] }, t));
  };
  add('ana', [[today - H, 100], [today + H, 300]]);
  add('ben', [[today - H, 900], [today + H, 1100]]);
  add('cy', [[today - H, 50], [today + H, 60]]);
  const rows = buildLeaderboard(store, 'today', now);
  assert.deepEqual(rows.map((r) => [r.username, r.xp, r.rank]), [
    ['ben', 200, 1],
    ['ana', 200, 1],
    ['cy', 10, 3],
  ]);
  store.close();
});
