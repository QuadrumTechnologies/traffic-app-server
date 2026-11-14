#!/usr/bin/env bash
# Install or update this machine's helpers for the traffic API. Safe to run again.
#
#   sudo bash ops/install-pi.sh                    everything, with auto-deploy on
#   sudo bash ops/install-pi.sh --no-auto-deploy   the same, but deploys stay by hand
#
# Installs
#   /usr/local/bin/deploy-quadrum     deploy from GitHub, with health check and rollback
#   /usr/local/bin/quadrum-alert      email the team (uses the API's mail settings)
#   /usr/local/bin/quadrum-watchdog   restart a hung API, warn about the public address and backups
#   /etc/default/quadrum              where the app lives, for the three commands above
#   systemd: quadrum-backup.timer (02:30 nightly), deploy-quadrum.timer (every 2 min),
#            quadrum-watchdog.timer (every minute), quadrum-alert@.service
#   /etc/logrotate.d/deploy-quadrum
#
# traffic-api.service is installed only if this machine has none yet (a new Pi); an
# existing one is left as it is. Nothing here touches .env, secrets, cloudflared or the
# firewall. See DEPLOY.md.
set -Eeuo pipefail
[ "$(id -u)" = 0 ] || { echo "Run it with sudo: sudo bash $0 $*"; exit 1; }

OPS="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="${APP_DIR:-$(dirname "$OPS")}"
APP_USER="${APP_USER:-$(stat -c %U "$APP_DIR")}"
APP_HOME="$(getent passwd "$APP_USER" | cut -d: -f6)"
NODE="${NODE:-$(command -v node || true)}"
BACKUP_DIR="${BACKUP_DIR:-$APP_HOME/backups/traffic-db}"
AUTO_DEPLOY=1
[ "${1:-}" = "--no-auto-deploy" ] && AUTO_DEPLOY=0

[ -n "$NODE" ] || { echo "node not found; install Node.js first (see DEPLOY.md)"; exit 1; }
[ -f "$APP_DIR/wss_server.js" ] || { echo "$APP_DIR doesn't look like traffic-app-server"; exit 1; }
[ "$APP_USER" != root ] || { echo "The app folder is owned by root; run the API as a normal user"; exit 1; }

fill() {
  sed -e "s#@APP_DIR@#$APP_DIR#g" -e "s#@APP_USER@#$APP_USER#g" \
      -e "s#@NODE@#$NODE#g" -e "s#@BACKUP_DIR@#$BACKUP_DIR#g" "$1"
}

echo "App: $APP_DIR (user $APP_USER, node $("$NODE" -v)), backups: $BACKUP_DIR"

cat >/etc/default/quadrum <<EOF
# Written by ops/install-pi.sh; read by deploy-quadrum, quadrum-alert and quadrum-watchdog.
APP_DIR=$APP_DIR
APP_USER=$APP_USER
BACKUP_DIR=$BACKUP_DIR
EOF

for pair in deploy-quadrum.sh:deploy-quadrum alert.sh:quadrum-alert watchdog.sh:quadrum-watchdog; do
  src="$OPS/${pair%%:*}"
  dst="/usr/local/bin/${pair##*:}"
  install -m 755 "$src" "$dst.new" && mv -f "$dst.new" "$dst"
done

for f in "$OPS"/systemd/*; do
  name="$(basename "$f")"
  if [ "$name" = traffic-api.service ] && [ -e /etc/systemd/system/traffic-api.service ]; then
    echo "Keeping the existing traffic-api.service"
    continue
  fi
  fill "$f" >"/etc/systemd/system/$name.new" && mv -f "/etc/systemd/system/$name.new" "/etc/systemd/system/$name"
done

install -m 644 "$OPS/logrotate/deploy-quadrum" /etc/logrotate.d/deploy-quadrum
touch /var/log/deploy-quadrum.log
[ -d "$BACKUP_DIR" ] || sudo -u "$APP_USER" mkdir -p "$BACKUP_DIR" 2>/dev/null || mkdir -p "$BACKUP_DIR"
case "$BACKUP_DIR" in "$APP_HOME"/backups/*) chown "$APP_USER": "$APP_HOME/backups" ;; esac
chown "$APP_USER": "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

systemctl daemon-reload
systemctl enable --now quadrum-backup.timer quadrum-watchdog.timer
if [ "$AUTO_DEPLOY" = 1 ]; then
  systemctl enable --now deploy-quadrum.timer
else
  systemctl disable --now deploy-quadrum.timer 2>/dev/null || true
  echo "Auto-deploy is off; deploy by hand with: deploy-quadrum"
fi
if ! systemctl is-enabled --quiet traffic-api; then
  echo "traffic-api.service is installed but not enabled. When .env and the CORS drop-in are in place:"
  echo "  sudo systemctl enable --now traffic-api"
fi

systemctl list-timers --all --no-pager 'quadrum-*' 'deploy-quadrum*'
echo
echo "Done. Take a backup now with: sudo systemctl start quadrum-backup && journalctl -u quadrum-backup -n 5 --no-pager"
