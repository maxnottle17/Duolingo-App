const view = document.getElementById('view');
const toastEl = document.getElementById('toast');
const reloadBtn = document.getElementById('reload-btn');

const store = {
  get(key, fallback = null) {
    try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; }
  },
  set(key, value) {
    try { value == null ? localStorage.removeItem(key) : localStorage.setItem(key, value); } catch {}
  },
};

let status = null;
let period = store.get('period', 'week');

// ---------- helpers ----------

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const fmt = (n) => Number(n || 0).toLocaleString();

function ago(ts) {
  if (!ts) return 'never';
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  return `${Math.round(h / 24)} d ago`;
}

function toast(msg) {
  toastEl.textContent = msg;
  toastEl.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => (toastEl.hidden = true), 3000);
}

async function api(path, { method = 'GET', body } = {}) {
  const headers = {};
  const token = store.get('adminToken');
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body) headers['Content-Type'] = 'application/json';
  const res = await fetch(path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `Request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return data;
}

function avatar(f, cls = '') {
  const initial = esc((f.displayName || f.username || '?').trim().charAt(0).toUpperCase());
  if (f.avatarUrl) {
    return `<img class="avatar ${cls}" src="${esc(f.avatarUrl)}" alt="" loading="lazy" referrerpolicy="no-referrer" data-initial="${initial}">`;
  }
  return `<div class="avatar ${cls}" aria-hidden="true">${initial}</div>`;
}

function setTab(name) {
  document.querySelectorAll('.tabbar a').forEach((a) => a.classList.toggle('active', a.dataset.tab === name));
}

// ---------- leaderboard ----------

async function renderBoard() {
  setTab('board');
  const periods = status?.periods || { today: 'Today', week: '7 days', month: '30 days', all: 'All time' };
  view.innerHTML = `
    <div class="segmented" role="group" aria-label="Time period">
      ${Object.entries(periods)
        .map(([k, label]) => `<button data-period="${k}" aria-pressed="${k === period}">${esc(label)}</button>`)
        .join('')}
    </div>
    <div id="board"><div class="skeleton"></div></div>`;
  view.querySelectorAll('[data-period]').forEach((b) =>
    b.addEventListener('click', () => {
      period = b.dataset.period;
      store.set('period', period);
      renderBoard();
    })
  );

  const target = view.querySelector('#board');
  try {
    const { friends } = await api(`/api/leaderboard?period=${period}`);
    if (!friends.length) {
      target.innerHTML = `
        <div class="card empty">
          <h2>No one here yet</h2>
          <p>Add your friends by their Duolingo username to start the league.</p>
          <a class="btn" href="#/settings">Add friends</a>
        </div>`;
      return;
    }
    const label = period === 'all' ? 'total XP' : 'XP';
    target.innerHTML = `
      <ol class="board">
        ${friends
          .map(
            (f) => `
          <li class="card">
            <a class="row" href="#/u/${encodeURIComponent(f.username)}">
              <span class="rank rank-${f.rank}">${f.rank}</span>
              ${avatar(f)}
              <span class="who">
                <span class="name">${esc(f.displayName)}</span>
                <span class="sub">
                  <span class="streak" title="Day streak">🔥 ${fmt(f.streak)}</span>
                  ${f.error ? '<span class="warn" title="Last update failed">⚠ update failed</span>' : ''}
                </span>
              </span>
              <span class="xp">${fmt(f.xp)}<small>${label}${f.partial ? '*' : ''}</small></span>
            </a>
          </li>`
          )
          .join('')}
      </ol>
      ${friends.some((f) => f.partial) ? '<p class="meta">* Tracking started partway through this period.</p>' : ''}
      <p class="meta">Updated ${ago(status?.lastRefreshAt)}${status?.mock ? ' · demo data' : ''}</p>`;
  } catch (e) {
    target.innerHTML = `<div class="card empty"><p>Couldn't load the leaderboard: ${esc(e.message)}</p></div>`;
  }
}

// ---------- friend detail ----------

function chart(history) {
  const max = Math.max(1, ...history.map((d) => d.xp || 0));
  const w = 300;
  const h = 120;
  const gap = 2;
  const bw = (w - gap * (history.length - 1)) / history.length;
  const bars = history
    .map((d, i) => {
      const x = i * (bw + gap);
      if (d.xp == null) return `<rect class="none" x="${x}" y="${h - 2}" width="${bw}" height="2" rx="1"><title>${d.date}: not tracked</title></rect>`;
      const bh = Math.max(2, (d.xp / max) * (h - 14));
      return `<rect class="bar" x="${x}" y="${h - bh}" width="${bw}" height="${bh}" rx="2"><title>${d.date}: ${fmt(d.xp)} XP</title></rect>`;
    })
    .join('');
  return `
    <svg class="chart" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" role="img" aria-label="XP per day, last 30 days">
      ${bars}
    </svg>
    <div class="chart-legend"><span>${esc(history[0]?.date.slice(5))}</span><span>best: ${fmt(max)} XP</span><span>today</span></div>`;
}

async function renderFriend(username) {
  setTab('board');
  view.innerHTML = '<a class="back" href="#/">‹ Leaderboard</a><div class="skeleton"></div>';
  try {
    const f = await api(`/api/friends/${encodeURIComponent(username)}`);
    const g = f.gains;
    const active = f.history.filter((d) => d.xp > 0).length;
    view.innerHTML = `
      <a class="back" href="#/">‹ Leaderboard</a>
      <div class="card profile-head">
        ${avatar(f, 'big')}
        <div>
          <h2>${esc(f.displayName)}</h2>
          <div class="sub">@${esc(f.username)} · updated ${ago(f.lastFetchedAt)}</div>
          ${f.error ? `<div class="sub warn">Last update failed: ${esc(f.error)}</div>` : ''}
        </div>
      </div>
      <div class="stats">
        <div class="card stat"><div class="label">🔥 Streak</div><div class="value">${fmt(f.streak)}</div></div>
        <div class="card stat"><div class="label">Total XP</div><div class="value">${fmt(f.totalXp)}</div></div>
        <div class="card stat"><div class="label">Today</div><div class="value">${fmt(g.today.xp)}</div></div>
        <div class="card stat"><div class="label">Last 7 days</div><div class="value">${fmt(g.week.xp)}</div></div>
      </div>
      <div class="card section">
        <h3>XP per day <span class="sub" style="display:inline">· active ${active} of 30 days</span></h3>
        ${chart(f.history)}
      </div>
      ${
        f.courses.length
          ? `<div class="card section"><h3>Courses</h3><ul class="courses">
              ${f.courses.map((c) => `<li><span>${esc(c.title)}</span><span>${fmt(c.xp)} XP</span></li>`).join('')}
            </ul></div>`
          : ''
      }`;
  } catch (e) {
    view.innerHTML = `<a class="back" href="#/">‹ Leaderboard</a><div class="card empty"><p>${esc(e.message)}</p></div>`;
  }
}

// ---------- friends / settings ----------

async function renderSettings() {
  setTab('settings');
  const canEdit = status && (!status.adminRequired || status.isAdmin);
  let friends = [];
  try {
    friends = (await api('/api/leaderboard?period=all')).friends.sort((a, b) => a.displayName.localeCompare(b.displayName));
  } catch {}

  view.innerHTML = `
    ${
      status?.adminRequired && !status.isAdmin
        ? `<div class="card section">
            <h3>Admin password</h3>
            <form class="add" id="login">
              <input type="password" name="token" placeholder="Password" autocomplete="current-password" required>
              <button class="btn">Unlock</button>
            </form>
            <p class="hint">Needed to add or remove friends. Everyone else can still view the league.</p>
          </div>`
        : ''
    }
    ${
      canEdit
        ? `<div class="card section">
            <h3>Add a friend</h3>
            <form class="add" id="add">
              <input type="text" name="username" placeholder="Duolingo username" autocapitalize="off" autocorrect="off" spellcheck="false" required>
              <button class="btn">Add</button>
            </form>
            <p class="hint">Their Duolingo profile must be public. The username is on their profile page.</p>
          </div>`
        : ''
    }
    <div class="card section">
      <h3>In the league (${friends.length})</h3>
      ${
        friends.length
          ? `<ul class="manage">${friends
              .map(
                (f) => `<li>${avatar(f)}<span class="who"><span class="name">${esc(f.displayName)}</span>
                  <span class="sub">@${esc(f.username)}</span></span>
                  ${canEdit ? `<button class="btn danger" data-remove="${esc(f.username)}">Remove</button>` : ''}</li>`
              )
              .join('')}</ul>`
          : '<p class="hint">Nobody yet.</p>'
      }
    </div>
    ${
      canEdit
        ? `<div class="card section">
            <h3>Data</h3>
            <button class="btn secondary block" id="refresh">Fetch latest XP now</button>
            <p class="hint">XP updates automatically every ${status.fetchIntervalHours} h. Last update: ${ago(status.lastRefreshAt)}.</p>
            ${status.adminRequired ? '<button class="btn secondary block" id="logout" style="margin-top:8px">Lock this device</button>' : ''}
          </div>`
        : ''
    }
    <div class="card section" id="install-card" hidden>
      <h3>Install on your phone</h3>
      <button class="btn block" id="install">Add to home screen</button>
    </div>`;

  view.querySelector('#login')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const token = e.target.token.value;
    store.set('adminToken', token);
    try {
      await api('/api/login', { method: 'POST' });
      await loadStatus();
      toast('Unlocked');
      renderSettings();
    } catch {
      store.set('adminToken', null);
      toast('Wrong password');
    }
  });

  view.querySelector('#add')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('button');
    btn.disabled = true;
    btn.textContent = 'Adding…';
    try {
      const { username } = await api('/api/friends', { method: 'POST', body: { username: e.target.username.value } });
      toast(`Added ${username}`);
      renderSettings();
    } catch (err) {
      toast(err.message);
      btn.disabled = false;
      btn.textContent = 'Add';
    }
  });

  view.querySelectorAll('[data-remove]').forEach((b) =>
    b.addEventListener('click', async () => {
      const name = b.dataset.remove;
      if (!confirm(`Remove ${name} and their history?`)) return;
      try {
        await api(`/api/friends/${encodeURIComponent(name)}`, { method: 'DELETE' });
        toast(`Removed ${name}`);
        renderSettings();
      } catch (err) {
        toast(err.message);
      }
    })
  );

  view.querySelector('#refresh')?.addEventListener('click', async (e) => {
    e.target.disabled = true;
    e.target.textContent = 'Fetching…';
    try {
      const r = await api('/api/refresh', { method: 'POST' });
      toast(`Updated ${r.updated} of ${r.total}`);
      await loadStatus();
      renderSettings();
    } catch (err) {
      toast(err.message);
      e.target.disabled = false;
      e.target.textContent = 'Fetch latest XP now';
    }
  });

  view.querySelector('#logout')?.addEventListener('click', async () => {
    store.set('adminToken', null);
    await loadStatus();
    renderSettings();
  });

  setupInstall();
}

// ---------- install prompt (Android Chrome / Samsung Internet) ----------

let deferredInstall = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredInstall = e;
  setupInstall();
});

function setupInstall() {
  const card = document.getElementById('install-card');
  if (!card || !deferredInstall) return;
  card.hidden = false;
  document.getElementById('install').onclick = async () => {
    deferredInstall.prompt();
    await deferredInstall.userChoice;
    deferredInstall = null;
    card.hidden = true;
  };
}

// Broken avatar image -> show the initial instead.
document.addEventListener(
  'error',
  (e) => {
    const img = e.target;
    if (!(img instanceof HTMLImageElement) || !img.classList.contains('avatar')) return;
    const div = document.createElement('div');
    div.className = img.className;
    div.textContent = img.dataset.initial || '?';
    img.replaceWith(div);
  },
  true
);

// ---------- routing ----------

async function loadStatus() {
  try {
    status = await api('/api/status');
  } catch {
    status = null;
  }
}

function route() {
  const hash = location.hash || '#/';
  const m = hash.match(/^#\/u\/(.+)$/);
  if (m) return renderFriend(decodeURIComponent(m[1]));
  if (hash === '#/settings') return renderSettings();
  return renderBoard();
}

reloadBtn.addEventListener('click', async () => {
  reloadBtn.classList.add('spinning');
  await loadStatus();
  await route();
  reloadBtn.classList.remove('spinning');
});

window.addEventListener('hashchange', () => {
  window.scrollTo(0, 0);
  route();
});

document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState === 'visible') {
    await loadStatus();
    route();
  }
});

if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});

await loadStatus();
route();
