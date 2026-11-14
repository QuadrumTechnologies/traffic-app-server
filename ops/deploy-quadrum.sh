#!/usr/bin/env bash
# deploy-quadrum: update the Quadrum traffic API on this Pi from GitHub.
# Installed as /usr/local/bin/deploy-quadrum by ops/install-pi.sh.
#
#   deploy-quadrum            fast-forward to origin/main, install deps if they changed,
#                             restart traffic-api, check health, roll back on failure
#   deploy-quadrum --status   what is deployed, whether GitHub is ahead, backups and timers
#   deploy-quadrum --auto     the same deploy, quietly, for deploy-quadrum.timer: says nothing
#                             when there is nothing new, and doesn't retry a commit that
#                             already failed (fix it on GitHub, or deploy it by hand)
#
# Repo:     https://github.com/QuadrumTechnologies/traffic-app-server (public, read over HTTPS)
# Service:  traffic-api.service (settings in .env and the unit's drop-ins; never in git)
# Public:   https://api.quadrumtechnologies.com (Cloudflare Tunnel -> 127.0.0.1:5000)
set -Eeuo pipefail

# Settings written by ops/install-pi.sh (APP_DIR, APP_USER, BACKUP_DIR), if any.
[ -r /etc/default/quadrum ] && . /etc/default/quadrum

# Always run as root (the Pi user has sudo), so the lock, state and log have one owner.
if [ "$(id -u)" != 0 ]; then exec sudo "$0" "$@"; fi

APP_DIR="${APP_DIR:-/home/daracomms/traffic-app-server}"
APP_USER="${APP_USER:-daracomms}"
BRANCH="${BRANCH:-main}"
SERVICE="${SERVICE:-traffic-api}"
LOCAL_URL="${LOCAL_URL:-http://127.0.0.1:5000/}"
PUBLIC_URL="${PUBLIC_URL:-https://api.quadrumtechnologies.com/}"
LOG_FILE="${LOG_FILE:-/var/log/deploy-quadrum.log}"
STATE_DIR="${STATE_DIR:-/var/lib/deploy-quadrum}"
BACKUP_DIR="${BACKUP_DIR:-/home/$APP_USER/backups/traffic-db}"
HEALTH_WAIT="${HEALTH_WAIT:-45}"   # seconds; the API only listens once MongoDB Atlas answers
LOCK="${LOCK:-/run/deploy-quadrum.lock}"

MODE="${1:-}"
AUTO=0; [ "$MODE" = "--auto" ] && AUTO=1

# One deploy at a time.
exec 200>>"$LOCK"
if ! flock -n 200; then
  [ "$AUTO" = 1 ] && exit 0
  echo "Deploy already running. Exiting."; exit 1
fi

log() { local m; m="$(date '+%F %T')  $*"; echo "$m"; echo "$m" >>"$LOG_FILE" 2>/dev/null || true; }
# Run as the app user. setpriv rather than sudo: sudo writes a journal line for every
# command, which would be thousands of lines a day from the 2-minute timer.
APP_HOME="$(getent passwd "$APP_USER" | cut -d: -f6)"
as_app() {
  if [ "$(id -un)" = "$APP_USER" ]; then "$@"
  elif command -v setpriv >/dev/null; then
    HOME="$APP_HOME" setpriv --reuid="$APP_USER" --regid="$(id -gn "$APP_USER")" --init-groups -- "$@"
  else runuser -u "$APP_USER" -- "$@"; fi
}
git_app() { as_app git -C "$APP_DIR" "$@"; }
remember_failed() { mkdir -p "$STATE_DIR" && echo "$1" >"$STATE_DIR/failed" || true; }
forget_failed() { rm -f "$STATE_DIR/failed" || true; }
# A problem not yet reported in the last 6 hours? (Marks it reported.) Keeps a stuck
# auto-deploy from emailing and logging every 2 minutes.
fresh_problem() {
  local f now
  f="$STATE_DIR/alerted-$(printf '%s' "$1" | md5sum | cut -c1-12)"; now="$(date +%s)"
  if [ -f "$f" ] && [ $((now - $(cat "$f"))) -lt 21600 ]; then return 1; fi
  mkdir -p "$STATE_DIR" && echo "$now" >"$f"
}
# Email the team. Auto mode only: a person running it by hand sees the output.
alert() {   # subject body [key]
  [ "$AUTO" = 1 ] && command -v quadrum-alert >/dev/null || return 0
  fresh_problem "${3:-$1}" || return 0
  quadrum-alert "$1" "$2" >/dev/null 2>&1 || true
}
die() {
  if [ "$AUTO" = 1 ]; then
    if fresh_problem "$*"; then
      log "FAILED: $*"
      if command -v quadrum-alert >/dev/null; then quadrum-alert "Deploy stopped on $(hostname)" "$*" >/dev/null 2>&1 || true; fi
    fi
    exit 0   # reported; the timer tries again later
  fi
  log "FAILED: $*"
  exit 1
}

healthy() {   # 200 from the local listener within HEALTH_WAIT seconds
  local i code
  for ((i = 0; i < HEALTH_WAIT; i++)); do
    code="$(curl -s -o /dev/null -m 3 -w '%{http_code}' "$LOCAL_URL" || true)"
    [ "$code" = "200" ] && return 0
    sleep 1
  done
  return 1
}

install_deps() {
  log "package.json changed: npm install --omit=dev"
  (cd "$APP_DIR" && as_app npm install --omit=dev --no-audit --no-fund)
}

[ -d "$APP_DIR/.git" ] || die "$APP_DIR is not a git checkout"

if [ "$MODE" = "--status" ]; then
  git_app fetch -q origin "$BRANCH"
  echo "deployed: $(git_app log -1 --format='%h %ad %s' --date=short)"
  echo "github:   $(git_app log -1 --format='%h %ad %s' --date=short "origin/$BRANCH")"
  echo "behind:   $(git_app rev-list --count "HEAD..origin/$BRANCH") commit(s)"
  [ -f "$STATE_DIR/failed" ] && echo "failed:   $(cut -c1-7 "$STATE_DIR/failed") (auto-deploy skips it until main moves on)"
  git_app status --short --untracked-files=no
  systemctl is-active "$SERVICE" >/dev/null && echo "service:  $SERVICE active since $(systemctl show "$SERVICE" -p ActiveEnterTimestamp --value)" || echo "service:  $SERVICE NOT active"
  newest="$(ls -1 "$BACKUP_DIR" 2>/dev/null | grep -E '^[0-9]{4}-[0-9]{2}-[0-9]{2}_[0-9]{4}$' | tail -1 || true)"
  echo "backup:   ${newest:-none} ($(ls -1 "$BACKUP_DIR" 2>/dev/null | grep -cE '^[0-9]{4}-' || true) kept in $BACKUP_DIR)"
  systemctl list-timers --all --no-pager 'deploy-quadrum.timer' 'quadrum-*.timer' 2>/dev/null | sed -n '1,5p'
  exit 0
fi

# 1. Refuse to overwrite hand edits on the Pi. Commit them to GitHub first, or discard them.
if [ -n "$(git_app status --porcelain --untracked-files=no)" ]; then
  git_app status --short --untracked-files=no
  die "local changes in $APP_DIR; push them to GitHub or discard them (git checkout -- <file>) and rerun"
fi

# 2. Fetch and fast-forward only (never merge or rewrite history on the Pi).
before="$(git_app rev-parse HEAD)"
if ! git_app fetch -q origin "$BRANCH"; then
  [ "$AUTO" = 1 ] && exit 0   # GitHub or the network is down; try again next time
  die "git fetch failed"
fi
target="$(git_app rev-parse "origin/$BRANCH")"
if [ "$before" = "$target" ]; then
  [ "$AUTO" = 1 ] && exit 0
  log "already at ${target:0:7}; nothing to deploy"
  healthy && log "health OK ($LOCAL_URL)" || log "WARNING: $LOCAL_URL is not answering 200"
  exit 0
fi
if [ "$AUTO" = 1 ] && [ -f "$STATE_DIR/failed" ] && [ "$(cat "$STATE_DIR/failed")" = "$target" ]; then
  exit 0   # this commit already failed once; wait for a new one or a deploy by hand
fi
git_app checkout -q "$BRANCH"
git_app merge -q --ff-only "origin/$BRANCH" || die "origin/$BRANCH is not a fast-forward of ${before:0:7}"
log "updated ${before:0:7} -> ${target:0:7}$([ "$AUTO" = 1 ] && echo ' (auto)')"
git_app log --oneline "${before}..${target}" | sed 's/^/    /'

# 3. Dependencies only when the manifest changed (package-lock.json is not tracked in this repo).
deps_changed=0
if git_app diff --quiet "$before" "$target" -- package.json; then :; else deps_changed=1; install_deps; fi

# 4. Restart and check; roll back to the previous commit if the API does not come up.
systemctl restart "$SERVICE"
if healthy; then
  log "health OK: $LOCAL_URL"
  code="$(curl -s -o /dev/null -m 10 -w '%{http_code}' "$PUBLIC_URL" || true)"
  log "public check: $PUBLIC_URL -> $code"
  log "Deployed commit: ${target:0:7} at $(date)"
  forget_failed
  if ! git_app diff --quiet "$before" "$target" -- ops/; then
    log "NOTE: ops/ changed; to update the timers and helpers run: sudo bash $APP_DIR/ops/install-pi.sh"
  fi
  exit 0
fi

log "API did not answer within ${HEALTH_WAIT}s; rolling back to ${before:0:7}"
journal="$(journalctl -u "$SERVICE" -n 30 --no-pager 2>/dev/null || true)"
echo "$journal"
git_app reset -q --hard "$before"
[ "$deps_changed" = 1 ] && install_deps
systemctl restart "$SERVICE"
remember_failed "$target"
if healthy; then
  log "rolled back to ${before:0:7}; API is up"
  alert "Deploy of ${target:0:7} failed on $(hostname); rolled back" "The API didn't come up on ${target:0:7}, so ${before:0:7} is running again. Auto-deploy will skip ${target:0:7}.

Last log lines:
$journal"
else
  log "rolled back, but the API is still down; check: journalctl -u $SERVICE"
  alert "Deploy failed on $(hostname) and the API is DOWN" "Rolled back to ${before:0:7}, but the API still isn't answering.

Last log lines:
$journal"
fi
exit 1
