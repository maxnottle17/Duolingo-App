// Reads public Duolingo profiles through Duolingo's unofficial web endpoint.
// There is no official API, so this may break if Duolingo changes things.

const FIELDS =
  'users{id,username,name,totalXp,streak,picture,streakData,courses{id,title,xp,learningLanguage,fromLanguage}}';

const USER_AGENT =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';

export class ProfileNotFoundError extends Error {
  constructor(username) {
    super(`No public Duolingo profile found for "${username}"`);
    this.name = 'ProfileNotFoundError';
  }
}

export function normalizeAvatar(picture) {
  if (!picture || typeof picture !== 'string') return null;
  let url = picture.startsWith('//') ? `https:${picture}` : picture;
  if (!/^https:\/\//.test(url)) return null;
  // Duolingo avatar URLs are a base path; a size suffix picks the image.
  if (/\/ssr-avatars\//.test(url) && !/\/(large|xlarge|medium)$/.test(url)) url += '/large';
  return url;
}

export function normalizeProfile(u) {
  const streak = u.streakData?.currentStreak?.length ?? u.streak ?? 0;
  return {
    duoUserId: u.id != null ? String(u.id) : null,
    username: u.username,
    displayName: u.name || u.username,
    avatarUrl: normalizeAvatar(u.picture),
    totalXp: Number(u.totalXp) || 0,
    streak: Number(streak) || 0,
    courses: (u.courses || [])
      .map((c) => ({
        id: c.id,
        title: c.title,
        language: c.learningLanguage,
        fromLanguage: c.fromLanguage,
        xp: Number(c.xp) || 0,
      }))
      .sort((a, b) => b.xp - a.xp),
  };
}

export async function fetchProfile(username, { fetchImpl = fetch } = {}) {
  const url =
    'https://www.duolingo.com/2017-06-30/users?username=' +
    encodeURIComponent(username) +
    '&fields=' +
    encodeURIComponent(FIELDS);
  const res = await fetchImpl(url, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
    signal: AbortSignal.timeout(15000),
  });
  if (res.status === 404) throw new ProfileNotFoundError(username);
  if (!res.ok) throw new Error(`Duolingo returned HTTP ${res.status}`);
  const data = await res.json();
  const user = data?.users?.[0];
  if (!user) throw new ProfileNotFoundError(username);
  return normalizeProfile(user);
}

// ---- Mock mode: believable fake profiles that grow over time ----

function hash(str) {
  let h = 2166136261;
  for (const ch of str.toLowerCase()) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return h >>> 0;
}

const MOCK_COURSES = [
  ['es', 'Spanish'], ['fr', 'French'], ['de', 'German'], ['ja', 'Japanese'],
  ['it', 'Italian'], ['ko', 'Korean'], ['pt', 'Portuguese'], ['nl', 'Dutch'],
];

export function mockProfile(username, now = Date.now()) {
  if (/^missing|^notfound/i.test(username)) throw new ProfileNotFoundError(username);
  const h = hash(username);
  const dailyRate = 40 + (h % 160); // XP per day
  const days = Math.max(0, now - Date.UTC(2024, 0, 1)) / 86_400_000;
  // A wobble so days differ, but totals never go down.
  const totalXp = Math.floor(5000 + (h % 20000) + days * dailyRate + 15 * Math.sin(days * 2 + h));
  const c1 = MOCK_COURSES[h % MOCK_COURSES.length];
  const c2 = MOCK_COURSES[(h >>> 3) % MOCK_COURSES.length];
  const courses = [{ id: c1[0], title: c1[1], learningLanguage: c1[0], fromLanguage: 'en', xp: Math.floor(totalXp * 0.8) }];
  if (c2 !== c1) courses.push({ id: c2[0], title: c2[1], learningLanguage: c2[0], fromLanguage: 'en', xp: totalXp - courses[0].xp });
  return normalizeProfile({
    id: h,
    username,
    name: username.charAt(0).toUpperCase() + username.slice(1),
    totalXp,
    streak: 3 + (h % 400),
    picture: null,
    courses,
  });
}
