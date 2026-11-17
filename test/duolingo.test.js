import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchProfile, normalizeAvatar, ProfileNotFoundError, mockProfile } from '../src/duolingo.js';

// Shape of a real response from duolingo.com/2017-06-30/users?username=...
const sample = {
  users: [
    {
      id: 123456,
      username: 'Maria_P',
      name: 'María',
      totalXp: 48210,
      streak: 0,
      streakData: { currentStreak: { length: 212, startDate: '2026-04-19', endDate: '2026-11-16' } },
      picture: '//simg-ssl.duolingo.com/ssr-avatars/123456/SSR-abc',
      courses: [
        { id: 'DUOLINGO_FR_EN', title: 'French', xp: 9000, learningLanguage: 'fr', fromLanguage: 'en' },
        { id: 'DUOLINGO_ES_EN', title: 'Spanish', xp: 39210, learningLanguage: 'es', fromLanguage: 'en' },
      ],
    },
  ],
};

const fakeFetch = (status, body) => async (url, opts) => {
  fakeFetch.lastUrl = url;
  fakeFetch.lastOpts = opts;
  return { status, ok: status >= 200 && status < 300, json: async () => body };
};

test('fetchProfile parses and normalizes a profile', async () => {
  const p = await fetchProfile('maria_p', { fetchImpl: fakeFetch(200, sample) });
  assert.match(fakeFetch.lastUrl, /^https:\/\/www\.duolingo\.com\/2017-06-30\/users\?username=maria_p&fields=/);
  assert.equal(p.username, 'Maria_P');
  assert.equal(p.displayName, 'María');
  assert.equal(p.totalXp, 48210);
  assert.equal(p.streak, 212, 'prefers streakData over the stale streak field');
  assert.equal(p.avatarUrl, 'https://simg-ssl.duolingo.com/ssr-avatars/123456/SSR-abc/large');
  assert.deepEqual(p.courses.map((c) => c.title), ['Spanish', 'French']);
});

test('fetchProfile reports missing users', async () => {
  await assert.rejects(fetchProfile('nobody', { fetchImpl: fakeFetch(200, { users: [] }) }), ProfileNotFoundError);
  await assert.rejects(fetchProfile('nobody', { fetchImpl: fakeFetch(404, {}) }), ProfileNotFoundError);
  await assert.rejects(fetchProfile('x', { fetchImpl: fakeFetch(429, {}) }), /HTTP 429/);
});

test('normalizeAvatar rejects non-https and keeps full URLs', () => {
  assert.equal(normalizeAvatar(null), null);
  assert.equal(normalizeAvatar('javascript:alert(1)'), null);
  assert.equal(normalizeAvatar('https://example.com/a.png'), 'https://example.com/a.png');
});

test('mock profiles grow over time and never shrink', () => {
  const a = mockProfile('sam', 1_790_000_000_000);
  const b = mockProfile('sam', 1_790_000_000_000 + 86_400_000);
  assert.ok(b.totalXp > a.totalXp);
  assert.throws(() => mockProfile('missing_user'), ProfileNotFoundError);
});
