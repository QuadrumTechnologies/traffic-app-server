#!/usr/bin/env bash
# quadrum-alert: email the Quadrum team about a problem on this Pi.
# Installed as /usr/local/bin/quadrum-alert by ops/install-pi.sh.
#
#   quadrum-alert "subject" "message"
#   quadrum-alert --unit NAME     a systemd unit failed: mails its status and last log lines
#                                 (used by quadrum-alert@.service through OnFailure=)
#
# Sends with the API's own mail settings (ops/notify.js). Also writes the subject to the
# journal (journalctl -t quadrum-alert), so there's a trace even when mail can't go out.
set -uo pipefail
[ -r /etc/default/quadrum ] && . /etc/default/quadrum
APP_DIR="${APP_DIR:-/home/daracomms/traffic-app-server}"
APP_USER="${APP_USER:-daracomms}"

if [ "${1:-}" = "--unit" ]; then
  unit="${2:?unit name}"
  subject="$unit failed on $(hostname)"
  body="$(systemctl status "$unit" --no-pager -n 0 2>&1 | head -6)

Last log lines:
$(journalctl -u "$unit" -n 40 --no-pager -o short-iso 2>&1)"
else
  subject="${1:?subject}"
  body="${2:-}"
fi

logger -t quadrum-alert -p user.warning "$subject"
cd "$APP_DIR" || exit 1
if [ "$(id -un)" = "$APP_USER" ]; then
  printf '%s\n' "$body" | node ops/notify.js "$subject"
else
  printf '%s\n' "$body" | sudo -u "$APP_USER" -H node ops/notify.js "$subject"
fi
