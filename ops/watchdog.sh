#!/usr/bin/env bash
# quadrum-watchdog: run every minute by quadrum-watchdog.timer (as root).
# Installed as /usr/local/bin/quadrum-watchdog by ops/install-pi.sh.
#
# - The API doesn't answer on 127.0.0.1 for 3 checks running: restart traffic-api and
#   email the team. (systemd already restarts it if it crashes; this catches a hang.)
# - The public address fails for 5 checks running while the API answers locally: email
#   the team. The tunnel (cloudflared) also serves other sites on this Pi, so it is not
#   restarted from here.
# - The newest database backup is more than 2 days old: email the team.
#
# At most one email per problem every 6 hours, and one when it clears.
# State is kept in /var/lib/quadrum-watchdog. Actions are logged: journalctl -t quadrum-watchdog
set -uo pipefail
[ -r /etc/default/quadrum ] && . /etc/default/quadrum
APP_USER="${APP_USER:-daracomms}"
SERVICE="${SERVICE:-traffic-api}"
LOCAL_URL="${LOCAL_URL:-http://127.0.0.1:5000/}"
PUBLIC_URL="${PUBLIC_URL:-https://api.quadrumtechnologies.com/}"
BACKUP_DIR="${BACKUP_DIR:-/home/$APP_USER/backups/traffic-db}"
STATE_DIR="${STATE_DIR:-/var/lib/quadrum-watchdog}"
LOCK="${LOCK:-/run/deploy-quadrum.lock}"
mkdir -p "$STATE_DIR"

http_code() { curl -s -o /dev/null -m "$2" -w '%{http_code}' "$1" 2>/dev/null || true; }
note() { logger -t quadrum-watchdog -p user.warning "$*"; }

# Consecutive failures of a check: "ok" resets, "fail" adds one. Prints the count.
streak() {
  local f="$STATE_DIR/$1.fails" n=0
  if [ "$2" = ok ]; then rm -f "$f"; echo 0; return; fi
  [ -f "$f" ] && n="$(cat "$f")"
  n=$((n + 1)); echo "$n" >"$f"; echo "$n"
}
# Email about a problem, at most every 6 hours per problem.
problem() {
  local f="$STATE_DIR/$1.alerted" now; now="$(date +%s)"
  if [ -f "$f" ] && [ $((now - $(head -1 "$f"))) -lt 21600 ]; then return 0; fi
  { echo "$now"; date '+%F %T'; } >"$f"
  quadrum-alert "$2" "$3" >/dev/null 2>&1 || note "could not send alert: $2"
}
# The problem is over: say so once, if an email went out about it.
cleared() {
  local f="$STATE_DIR/$1.alerted" since
  [ -f "$f" ] || return 0
  since="$(sed -n 2p "$f")"; rm -f "$f"
  quadrum-alert "$2" "Back to normal at $(date '+%F %T') (first reported $since)." >/dev/null 2>&1 || true
}

# Leave the API alone while a deploy is restarting it, or while it is still starting.
if [ -e "$LOCK" ] && ! flock -n "$LOCK" true 2>/dev/null; then exit 0; fi
[ "$(systemctl is-active "$SERVICE")" = active ] || exit 0
started_us="$(systemctl show "$SERVICE" -p ActiveEnterTimestampMonotonic --value 2>/dev/null || echo 0)"
uptime_s="$(cut -d. -f1 /proc/uptime)"
if [ $(( uptime_s - ${started_us:-0} / 1000000 )) -lt 90 ]; then exit 0; fi

# 1. The API itself.
code="$(http_code "$LOCAL_URL" 5)"
if [ "$code" = 200 ]; then
  streak api ok >/dev/null
  cleared api "Traffic API answering again on $(hostname)"

  # 2. The public address, through Cloudflare.
  pub="$(http_code "$PUBLIC_URL" 10)"
  if [ "$pub" = 200 ]; then
    streak public ok >/dev/null
    cleared public "Public API address working again"
  else
    n="$(streak public fail)"
    if [ "$n" -ge 5 ]; then
      note "public address failing for $n checks (HTTP ${pub:-none}); API answers locally"
      problem public "Public API address not working" \
"$PUBLIC_URL has failed for $n minutes (last answer: HTTP ${pub:-none}), while the API answers on this Pi.

Likely the tunnel or the internet link. Check:
  sudo systemctl status cloudflared --no-pager
  journalctl -u cloudflared -n 50 --no-pager
cloudflared also serves the other sites on this Pi, so restart it only if they can take the blip:
  sudo systemctl restart cloudflared"
    fi
  fi
else
  n="$(streak api fail)"
  if [ "$n" -ge 3 ]; then
    note "API not answering for $n checks (HTTP ${code:-none}); restarting $SERVICE"
    journal="$(journalctl -u "$SERVICE" -n 30 --no-pager -o short-iso 2>&1)"
    systemctl restart "$SERVICE"
    streak api ok >/dev/null
    problem api "Traffic API was not answering on $(hostname); restarted it" \
"$LOCAL_URL didn't answer for $n minutes (last answer: HTTP ${code:-none}), so the watchdog restarted $SERVICE at $(date '+%F %T').

Log before the restart:
$journal"
  fi
fi

# 3. Backups, once an hour is plenty.
if [ "$(date +%M)" = 07 ]; then
  newest="$(ls -1 "$BACKUP_DIR" 2>/dev/null | grep -E '^[0-9]{4}-[0-9]{2}-[0-9]{2}_[0-9]{4}$' | tail -1 || true)"
  if [ -z "$newest" ]; then age=999; else
    age=$(( ( $(date +%s) - $(date -d "${newest:0:10}" +%s) ) / 86400 ))
  fi
  if [ "$age" -ge 2 ]; then
    problem backup "Database backup is out of date on $(hostname)" \
"The newest backup in $BACKUP_DIR is ${newest:-missing}.

Check: systemctl status quadrum-backup --no-pager; journalctl -u quadrum-backup -n 30 --no-pager
Take one now: sudo systemctl start quadrum-backup"
  else
    cleared backup "Database backups are up to date again"
  fi
fi
exit 0
