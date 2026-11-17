import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, normalize, extname, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { timingSafeEqual, createHash } from 'node:crypto';
import { loadConfig } from './config.js';
import { openDb } from './db.js';
import { Tracker } from './tracker.js';
import { buildLeaderboard, friendDetail, PERIODS } from './stats.js';

const PUBLIC_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function sendJson(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(data);
}

async function readJson(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 10_000) throw new HttpError(413, 'Request too large');
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, 'Invalid JSON');
  }
}

const digest = (s) => createHash('sha256').update(String(s)).digest();

function isAdmin(req, config) {
  if (!config.adminToken) return true;
  const header = req.headers.authorization || '';
  const given = header.startsWith('Bearer ') ? header.slice(7) : '';
  return timingSafeEqual(digest(given), digest(config.adminToken));
}

function requireAdmin(req, config) {
  if (!isAdmin(req, config)) throw new HttpError(401, 'Admin password required');
}

async function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel === '/' || !extname(rel)) rel = '/index.html'; // app routes fall back to the shell
  const file = normalize(join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR + sep)) throw new HttpError(404, 'Not found');
  let info;
  try {
    info = await stat(file);
  } catch {
    throw new HttpError(404, 'Not found');
  }
  if (!info.isFile()) throw new HttpError(404, 'Not found');
  const ext = extname(file);
  res.writeHead(200, {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    // The service worker and HTML must always be revalidated so updates reach phones.
    'Cache-Control': ext === '.png' || ext === '.svg' ? 'public, max-age=86400' : 'no-cache',
    'X-Content-Type-Options': 'nosniff',
  });
  if (req.method === 'HEAD') return res.end();
  res.end(await readFile(file));
}

export function createApp({ store, tracker, config }) {
  async function handle(req, res) {
    const url = new URL(req.url, 'http://localhost');
    const { pathname } = url;
    const method = req.method;

    if (!pathname.startsWith('/api/')) {
      if (method !== 'GET' && method !== 'HEAD') throw new HttpError(405, 'Method not allowed');
      return serveStatic(req, res, pathname);
    }

    if (method === 'GET' && pathname === '/api/status') {
      const last = Number(store.getMeta('last_refresh_at')) || null;
      return sendJson(res, 200, {
        adminRequired: Boolean(config.adminToken),
        isAdmin: isAdmin(req, config),
        lastRefreshAt: last,
        refreshing: Boolean(tracker.running),
        fetchIntervalHours: config.fetchIntervalHours,
        mock: config.mock,
        periods: Object.fromEntries(Object.entries(PERIODS).map(([k, v]) => [k, v.label])),
      });
    }

    if (method === 'GET' && pathname === '/api/leaderboard') {
      const period = url.searchParams.get('period') || 'week';
      if (!PERIODS[period]) throw new HttpError(400, 'Unknown period');
      return sendJson(res, 200, { period, friends: buildLeaderboard(store, period) });
    }

    const friendMatch = pathname.match(/^\/api\/friends\/([^/]+)$/);

    if (method === 'GET' && friendMatch) {
      const detail = friendDetail(store, decodeURIComponent(friendMatch[1]));
      if (!detail) throw new HttpError(404, 'Friend not found');
      return sendJson(res, 200, detail);
    }

    if (method === 'POST' && pathname === '/api/friends') {
      requireAdmin(req, config);
      const body = await readJson(req);
      const friend = await tracker.addFriend(body.username);
      return sendJson(res, 201, { username: friend.username });
    }

    if (method === 'DELETE' && friendMatch) {
      requireAdmin(req, config);
      const removed = store.removeFriend(decodeURIComponent(friendMatch[1]));
      if (!removed) throw new HttpError(404, 'Friend not found');
      return sendJson(res, 200, { ok: true });
    }

    if (method === 'POST' && pathname === '/api/refresh') {
      requireAdmin(req, config);
      const result = await tracker.refreshAll();
      return sendJson(res, 200, result);
    }

    if (method === 'POST' && pathname === '/api/login') {
      // Lets the settings screen check a password before saving it.
      return sendJson(res, isAdmin(req, config) ? 200 : 401, { ok: isAdmin(req, config) });
    }

    throw new HttpError(404, 'Not found');
  }

  return createServer(async (req, res) => {
    try {
      await handle(req, res);
    } catch (e) {
      const status = e.status || 500;
      if (status >= 500) console.error(e);
      if (!res.headersSent) sendJson(res, status, { error: status >= 500 && !e.status ? 'Server error' : e.message });
      else res.end();
    }
  });
}

// Run directly: `node src/server.js`
if (process.argv[1] && fileURLToPath(import.meta.url) === normalize(process.argv[1])) {
  const config = loadConfig();
  const store = openDb(config.dbPath);
  const tracker = new Tracker(store, config);
  const server = createApp({ store, tracker, config });
  server.listen(config.port, config.host, () => {
    console.log(`XP tracker running on http://localhost:${config.port}`);
    if (config.mock) console.log('Mock mode: profiles are fake, Duolingo is not contacted.');
    if (!config.adminToken) console.warn('ADMIN_TOKEN is not set: anyone who can open the app can add or remove friends.');
  });
  tracker.start();
  const shutdown = () => {
    tracker.stop();
    server.close(() => {
      store.close();
      process.exit(0);
    });
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
