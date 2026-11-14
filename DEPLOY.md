# Running the traffic API

How the Quadrum traffic API is hosted, deployed, backed up and watched, and how
to move it to a new Raspberry Pi. Everything here is safe to keep in a public
repo: secrets live only on the machine (and in the team's password manager).

## What runs where

| Part | Where | Address |
|---|---|---|
| API (`wss_server.js`: REST + WebSocket) | Raspberry Pi, `traffic-api.service`, listening on `127.0.0.1:5000` (plain HTTP) | `https://api.quadrumtechnologies.com` (also `traffic-api.`) |
| Public entry | Cloudflare Tunnel (`cloudflared.service` on the Pi) | TLS ends at Cloudflare; nothing on the Pi is open to the internet |
| Database | MongoDB Atlas, free tier (M0) | `DATABASE_URI` in `.env` |
| Dashboard | Cloudflare Pages (`traffic-app-client`) | `app.` / `traffic-signal.quadrumtechnologies.com` |
| Website | Cloudflare Pages, from this repo's `website` branch | `quadrumtechnologies.com` |

The tunnel on the current Pi also serves other sites, so restart `cloudflared`
only when they can take a few seconds' blip.

## Settings and secrets

| Where (on the Pi) | Holds |
|---|---|
| `~/traffic-app-server/.env` | `DATABASE_URI`, `JWT_SECRET`, mail login, `NODE_ENV=production`, and the optional settings below |
| `/etc/systemd/system/traffic-api.service.d/cors.conf` | `CORS_ORIGINS` |
| `/etc/cloudflared/` | the tunnel's credentials and routes |
| `/etc/default/quadrum` | app folder, user and backup folder (written by `ops/install-pi.sh`) |

Never commit these, paste them in chat or email them. Keep a copy of `.env` and
the tunnel credentials in the team password manager: that's what makes a new
Pi a one-hour job instead of a rebuild.

Optional settings (in `.env`):

| Setting | Default | What it does |
|---|---|---|
| `DEVICE_OFFLINE_MS` | `20000` | A controller counts as offline after this long without a ping (it pings every 6 s). Minimum 7000. |
| `OPS_ALERT_TO` | `ACCESS_REQUESTS_TO`, else `hello@quadrumtechnologies.com` | Who gets the alert emails below |
| `DEMO_JUNCTION` | `on` | `off` stops the simulated demo junction |
| `CRON_JOBS` | `on` | `off` skips the scheduled jobs (nightly junction release, demo summary email). Use it on a second copy of the API so jobs don't run twice. |
| `KEEP_DAILY` / `KEEP_WEEKLY` / `KEEP_MONTHLY` | `7` / `4` / `6` | How many backups to keep |

## Deploying

Merge a pull request into `main`. Within about two minutes the Pi notices
(`deploy-quadrum.timer`) and runs `deploy-quadrum --auto`, which:

1. refuses to run if someone edited files on the Pi;
2. fast-forwards to `origin/main` (never merges or rewrites history);
3. runs `npm install --omit=dev` only if `package.json` changed;
4. restarts `traffic-api` and waits up to 45 s for `http://127.0.0.1:5000/` to answer;
5. if it doesn't, rolls back to the previous commit, restarts, emails the team, and
   skips that commit until `main` moves on.

Pull requests are checked by GitHub Actions (`Checks`: syntax and tests on
Node 20 and 24). Deploys don't go through GitHub Actions.

By hand, on the Pi:

```bash
deploy-quadrum --status    # what's deployed, whether GitHub is ahead, backups, timers
deploy-quadrum             # deploy now (also retries a commit that failed before)
sudo systemctl disable --now deploy-quadrum.timer   # stop deploying automatically
sudo systemctl enable --now deploy-quadrum.timer    # start again
```

Deploy history: `/var/log/deploy-quadrum.log` and `journalctl -u deploy-quadrum`.

If a change touches `ops/`, run `sudo bash ~/traffic-app-server/ops/install-pi.sh`
after it's deployed, so the installed commands and timers match the repo.

## Backups

`quadrum-backup.timer` runs `ops/backup-db.js` every night at 02:30 Lagos time.
Atlas's free tier has no backups of its own, so these are the only ones.

- Where: `~/backups/traffic-db/<date>_<time>/` on the Pi, readable by the app user only.
- What: every collection as gzipped Extended JSON (ObjectIds and dates come back
  exactly), its indexes, and `manifest.json` with counts and the database size.
- Kept: the newest of each of the last 7 days, 4 weeks and 6 months.
- Size: the log line warns when the database passes 80% of the free tier's 512 MB.
- If a backup fails, or the newest is over 2 days old, the team gets an email.

```bash
sudo systemctl start quadrum-backup        # take one now
journalctl -u quadrum-backup -n 5 --no-pager
cd ~/traffic-app-server && node ops/backup-db.js --list
```

The backups sit on the same SD card as everything else. Copy one off the Pi now
and then (to a laptop or the team's drive, never to git): it's one folder.

## Restoring

```bash
cd ~/traffic-app-server
B=~/backups/traffic-db/2026-11-14_0230                 # the backup to use

node ops/restore-db.js $B                              # dry run: shows what it would do
node ops/restore-db.js $B --db restore_check --yes     # restore into a scratch database to look at
```

To put data back into the live database:

```bash
sudo systemctl stop traffic-api
sudo systemctl start quadrum-backup                    # a fresh backup of how things are now
node ops/restore-db.js $B --yes                        # fills collections that are empty or missing
node ops/restore-db.js $B --yes --replace --live --only users,userdevices   # replaces these
sudo systemctl start traffic-api
```

Without `--replace` a collection that holds data is left alone. `--replace` on
the database the API uses also needs `--live`. Drop a scratch database
afterwards in Atlas (Database → Browse Collections).

## Watching it

`quadrum-watchdog.timer` runs `quadrum-watchdog` every minute:

- the API doesn't answer on `127.0.0.1:5000` three times running: it restarts
  `traffic-api` and emails the team (systemd already restarts it after a crash;
  this catches a hang);
- the public address fails five times running while the API answers on the Pi:
  it emails the team (the tunnel isn't restarted automatically);
- the newest backup is over 2 days old: it emails the team.

At most one email per problem every 6 hours, and one when it clears. Alerts use
the API's own mail settings (`ops/notify.js`) and go to `OPS_ALERT_TO`.

What the Pi can't report is being off or offline itself. For that, add an
outside uptime check on `https://api.quadrumtechnologies.com/` (any free uptime
service, checking every few minutes, alerting by email and SMS).

Logs:

```bash
journalctl -u traffic-api -f                 # the API
journalctl -t quadrum-watchdog -t quadrum-alert --since today
systemctl list-timers 'quadrum-*' 'deploy-quadrum*'
```

Controller status: a controller is online from its first message and offline
`DEVICE_OFFLINE_MS` after its last ping. The database, the log and the
dashboards hear about changes only (dashboards also get a reminder every 30 s
while it stays online), so a busy junction doesn't fill the log.

## Setting up a new Pi (moving to the Pi 5)

Plan about an hour, with 5–10 minutes of downtime at the switch. Pick a quiet
time, not around midnight or 08:00 (scheduled jobs).

1. **Prepare the Pi 5.** Raspberry Pi OS Lite (64-bit), an SSD if possible
   (SD cards wear out under logs and swap), timezone `Africa/Lagos`, updates
   installed, a normal user with sudo, remote access (SSH or Raspberry Pi Connect).
2. **Node.js 24 LTS** (Node 20 reached end of life in April 2026; the API's tests
   pass on 24), for example from NodeSource's `node_24.x` repository.
3. **Code.**
   `git clone https://github.com/QuadrumTechnologies/traffic-app-server.git ~/traffic-app-server`.
   Copy `package-lock.json` from the old Pi into it (it isn't in git; it keeps the
   same package versions), then `npm install --omit=dev`.
4. **Secrets.** Copy `.env` and `cors.conf` from the old Pi over SSH or from the
   password manager (not by email or chat). Add `CRON_JOBS=off` and
   `DEMO_JUNCTION=off` to `.env` for now.
5. **Install.** `sudo bash ~/traffic-app-server/ops/install-pi.sh --no-auto-deploy`.
   This installs `traffic-api.service` from `ops/systemd` (with `TLS=off`,
   `PORT=5000`, `HOST=127.0.0.1`, `TRUST_PROXY=1`); put `cors.conf` in
   `/etc/systemd/system/traffic-api.service.d/`, then
   `sudo systemctl daemon-reload && sudo systemctl start traffic-api`.
6. **Test on the Pi 5**, while the old Pi stays live:
   `curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:5000/` gives `200`, and
   `node ops/backup-db.js --out /tmp/test-backup` reaches the database.
   Don't leave both running for long: they share the database.
7. **Switch over.**
   1. Old Pi: `sudo systemctl start quadrum-backup` (final backup), then
      `sudo systemctl disable --now deploy-quadrum.timer traffic-api`.
   2. Pi 5: remove `CRON_JOBS=off` and `DEMO_JUNCTION=off` from `.env`, then
      `sudo systemctl enable traffic-api && sudo systemctl restart traffic-api`.
   3. Cloudflare: give the Pi 5 its own tunnel for the API (Zero Trust →
      Networks → Tunnels → create, install the connector on the Pi 5) and move the
      public hostnames `api.` and `traffic-api.quadrumtechnologies.com` to it,
      pointing at `http://127.0.0.1:5000`. Then remove those two hostnames from
      the old Pi's tunnel and restart its `cloudflared`. This keeps the API apart
      from the other sites on the old Pi.
   4. Pi 5: `sudo bash ~/traffic-app-server/ops/install-pi.sh` (turns auto-deploy on).
8. **Check.** The public address answers; the dashboard signs in and its
   junctions show online; `deploy-quadrum --status` is clean;
   `sudo systemctl start quadrum-backup` succeeds.
9. **Tidy up.** Copy `~/backups/traffic-db` from the old Pi to the Pi 5. On the
   old Pi: `sudo systemctl disable --now quadrum-backup.timer quadrum-watchdog.timer`;
   keep its copy of the code and backups for a month, then delete them.

To go back: stop `traffic-api` on the Pi 5, move the two hostnames back to the
old Pi's tunnel, start `traffic-api` on the old Pi.

## Leftovers from AWS

The API used to run on AWS EC2 with a GitHub Actions deploy; that workflow is
gone. Once the EC2 instance is shut down, also remove: its Elastic IP, volumes and
snapshots, the Route 53 hosted zone (DNS is on Cloudflare), any IAM keys used
for deploys, and the repository secrets `EC2_SSH_KEY`, `HOST` and `USER`
(Settings → Secrets and variables → Actions).
