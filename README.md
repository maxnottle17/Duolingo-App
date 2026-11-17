# XP League

A self-hosted Duolingo XP leaderboard for you and your friends. It runs on your
home server, checks everyone's public Duolingo profile every few hours, and
shows who earned the most XP today, this week, this month and overall. Friends
install it on their phones straight from the browser, no app store needed.

![](public/icons/icon-192.png)

## What it does

- **Leaderboard** for Today / 7 days / 30 days / All time, with streaks
- **Profile pages** with a 30-day XP-per-day chart, totals and courses
- **Add / remove friends** by Duolingo username (password protected)
- **Installs like an app** on Android (and iPhone) as a PWA, works offline with the last data
- **Light and dark mode**, follows the phone's setting
- No dependencies to install: plain Node.js with its built-in SQLite

> **Heads-up:** Duolingo has no official API. This uses the same public profile
> endpoint their website uses. It can stop working if Duolingo changes it, and it
> may go against their terms of service, so keep this to a private group of
> friends. Only public profiles can be read.

## Try it with fake data

Needs Node.js 22.13 or newer.

```bash
npm run seed:demo   # 6 fake friends with 30 days of history
npm run dev:mock    # http://localhost:3000, never contacts Duolingo
```

## Run it for real

### Option A: Docker (recommended)

```bash
cp .env.example .env      # then edit: set ADMIN_TOKEN and TZ
mkdir -p data && sudo chown 1000:1000 data
docker compose up -d --build
```

Open `http://<server-ip>:3000`, go to **Friends**, enter your admin password and
add usernames.

### Option B: plain Node.js

```bash
cp .env.example .env      # edit it
node --env-file=.env --disable-warning=ExperimentalWarning src/server.js
```

To keep it running after a reboot, use the systemd unit below or `pm2`.

<details><summary>systemd unit</summary>

```ini
# /etc/systemd/system/xp-league.service
[Unit]
Description=XP League
After=network-online.target

[Service]
WorkingDirectory=/opt/xp-league
ExecStart=/usr/bin/node --env-file=.env --disable-warning=ExperimentalWarning src/server.js
Restart=always
User=xpleague

[Install]
WantedBy=multi-user.target
```

`sudo systemctl enable --now xp-league`
</details>

## Let friends reach it (Cloudflare Tunnel)

Friends' phones need to reach your server from anywhere, and installing as an app
requires **HTTPS**. A Cloudflare Tunnel gives you both without opening router ports.

1. Get a domain on Cloudflare (or move an existing one's DNS there).
2. In the Cloudflare dashboard: **Zero Trust → Networks → Tunnels → Create tunnel**
   → choose *Cloudflared* → copy the token.
3. Add a **Public hostname**, e.g. `xp.yourdomain.com` → service `http://app:3000`
   (Docker) or `http://localhost:3000` (plain Node).
4. Put the token in `.env` as `CLOUDFLARE_TUNNEL_TOKEN` and run
   `docker compose --profile tunnel up -d`.

**Set `ADMIN_TOKEN` before doing this**, or anyone with the link can edit the league.

## Install on a Samsung / Android phone

1. Open `https://xp.yourdomain.com` in **Chrome** or **Samsung Internet**.
2. Go to **Friends → Add to home screen**, or use the browser menu →
   *Add to Home screen* / *Install app*.
3. It opens full-screen with its own icon, like a normal app.

On iPhone: Safari → Share → *Add to Home Screen*.

## Settings

All settings are environment variables (see `.env.example`):

| Variable | Default | Meaning |
| --- | --- | --- |
| `ADMIN_TOKEN` | *(none)* | Password for adding/removing friends and manual refresh. Unset = anyone can edit. |
| `FETCH_INTERVAL_HOURS` | `3` | How often XP is fetched. It also fetches just after midnight. |
| `TZ` | server's zone | Time zone used for "Today" and daily charts. |
| `PORT` | `3000` | Port to listen on. |
| `DB_PATH` | `./data/tracker.db` | SQLite file. Back this up to keep history. |
| `FETCH_DELAY_MS` | `2000` | Pause between friends during a fetch, to be gentle on Duolingo. |
| `DUO_MOCK` | off | `1` = fake profiles, for testing. |

## How XP is counted

Duolingo only shows a running total, so the app saves a snapshot of everyone's total
each time it fetches. "XP this week" is the latest total minus the last snapshot from
before the week started. History therefore starts on the day you add someone; a `*`
marks numbers that only cover part of the period.

## Development

```bash
npm test                    # unit + API tests
node scripts/make-icons.mjs # re-render PNG icons from public/icons/icon.svg (needs Playwright)
```

```
src/server.js     HTTP server + API routes
src/tracker.js    scheduled fetching
src/duolingo.js   Duolingo profile client (+ mock mode)
src/stats.js      leaderboard and daily-history maths
src/db.js         SQLite storage
public/           the phone app (HTML/CSS/JS, service worker, manifest)
```

### API

| Method | Path | |
| --- | --- | --- |
| GET | `/api/leaderboard?period=today\|week\|month\|all` | ranked list |
| GET | `/api/friends/:username` | profile, gains, 30-day history |
| POST | `/api/friends` `{ "username": "..." }` | add (admin) |
| DELETE | `/api/friends/:username` | remove (admin) |
| POST | `/api/refresh` | fetch now (admin) |
| GET | `/api/status` | last update time, settings |

Admin calls take `Authorization: Bearer <ADMIN_TOKEN>`.
