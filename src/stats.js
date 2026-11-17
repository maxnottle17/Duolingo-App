// Turns stored XP snapshots into leaderboard numbers and daily history.
// Duolingo only reports a running total, so "XP gained" in a period is the
// difference between the latest snapshot and the last one before the period began.
// Days follow the server's local time zone (set TZ to change it).

export const PERIODS = {
  today: { label: 'Today', daysBack: 0 },
  week: { label: '7 days', daysBack: 6 },
  month: { label: '30 days', daysBack: 29 },
  all: { label: 'All time', daysBack: null },
};

export function startOfDay(ts, daysBack = 0) {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - daysBack);
  return d.getTime();
}

export function dayKey(ts) {
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// Last snapshot taken at or before `t` (snaps must be sorted by taken_at).
export function snapshotAt(snaps, t) {
  let lo = 0;
  let hi = snaps.length - 1;
  let found = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (snaps[mid].taken_at <= t) {
      found = snaps[mid];
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return found;
}

// XP gained since `start`. `partial` means tracking began after `start`,
// so the number only covers part of the period.
export function gainSince(snaps, start) {
  if (!snaps.length) return { xp: 0, partial: true };
  const latest = snaps[snaps.length - 1];
  let base = snapshotAt(snaps, start);
  let partial = false;
  if (!base) {
    base = snaps[0];
    partial = true;
  }
  return { xp: Math.max(0, latest.total_xp - base.total_xp), partial };
}

export function periodGain(snaps, period, now = Date.now()) {
  const p = PERIODS[period];
  if (!p) throw new Error(`Unknown period "${period}"`);
  if (p.daysBack === null) {
    const latest = snaps[snaps.length - 1];
    return { xp: latest ? latest.total_xp : 0, partial: false };
  }
  return gainSince(snaps, startOfDay(now, p.daysBack));
}

// XP earned on each of the last `days` days (oldest first). `xp` is null for
// days before tracking started.
export function dailyHistory(snaps, days = 30, now = Date.now()) {
  const out = [];
  for (let i = days - 1; i >= 0; i--) {
    const dayStart = startOfDay(now, i);
    const nextStart = startOfDay(now, i - 1);
    const end = snapshotAt(snaps, nextStart - 1);
    const begin = snapshotAt(snaps, dayStart - 1) ?? (end && end.taken_at >= dayStart ? snaps.find((s) => s.taken_at >= dayStart) : null);
    out.push({
      date: dayKey(dayStart),
      xp: end && begin ? Math.max(0, end.total_xp - begin.total_xp) : null,
    });
  }
  return out;
}

export function buildLeaderboard(store, period, now = Date.now()) {
  const rows = store.listFriends().map((f) => {
    const snaps = store.snapshots(f.id);
    const latest = snaps[snaps.length - 1];
    const gain = periodGain(snaps, period, now);
    return {
      username: f.username,
      displayName: f.display_name || f.username,
      avatarUrl: f.avatar_url,
      xp: gain.xp,
      partial: gain.partial && snaps.length > 0,
      totalXp: latest?.total_xp ?? 0,
      streak: latest?.streak ?? 0,
      lastFetchedAt: f.last_fetched_at,
      error: f.last_error,
    };
  });
  rows.sort((a, b) => b.xp - a.xp || b.totalXp - a.totalXp || a.username.localeCompare(b.username));
  let rank = 0;
  let prev = null;
  rows.forEach((r, i) => {
    if (r.xp !== prev) rank = i + 1;
    r.rank = rank;
    prev = r.xp;
  });
  return rows;
}

export function friendDetail(store, username, now = Date.now()) {
  const f = store.getFriend(username);
  if (!f) return null;
  const snaps = store.snapshots(f.id);
  const latest = store.latestSnapshot(f.id);
  const gains = Object.fromEntries(Object.keys(PERIODS).map((p) => [p, periodGain(snaps, p, now)]));
  return {
    username: f.username,
    displayName: f.display_name || f.username,
    avatarUrl: f.avatar_url,
    addedAt: f.added_at,
    lastFetchedAt: f.last_fetched_at,
    error: f.last_error,
    totalXp: latest?.total_xp ?? 0,
    streak: latest?.streak ?? 0,
    courses: latest?.courses_json ? JSON.parse(latest.courses_json) : [],
    gains,
    history: dailyHistory(snaps, 30, now),
  };
}
