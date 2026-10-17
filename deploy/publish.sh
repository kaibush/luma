#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$project_root"
[[ "$EUID" -eq 0 ]] || { echo 'Run as root to install the systemd and Caddy configuration.' >&2; exit 1; }
[[ -f /etc/remote-console/environment ]] || { echo 'Create /etc/remote-console/environment first; see docs/DEPLOYMENT.md.' >&2; exit 1; }

npm run package:agent
npm run build
install -d -m 755 /var/www/remote-console
# Retain old hashed assets for browser tabs that are still running the prior release.
rsync -a apps/web/dist/ /var/www/remote-console/
chown -R caddy:caddy /var/www/remote-console
install -m 644 deploy/remote-console-api.service /etc/systemd/system/remote-console-api.service
systemctl daemon-reload
systemctl enable remote-console-api.service
systemctl restart remote-console-api.service
for attempt in $(seq 1 40); do
  if curl -fsS --max-time 1 http://127.0.0.1:8798/health >/dev/null; then break; fi
  if [[ "$attempt" -eq 40 ]]; then echo 'API health check failed.' >&2; exit 1; fi
  sleep 0.25
done

# Validate the full candidate configuration before installing or reloading it.
candidate="$(mktemp -d)"
trap 'rm -rf "$candidate"' EXIT
cp /etc/caddy/conf.d/*.caddy "$candidate/"
install -m 644 deploy/Caddyfile.rc.lvyrix.com "$candidate/remote-console.caddy"
sed "s|/etc/caddy/conf.d/\*.caddy|$candidate/*.caddy|" /etc/caddy/Caddyfile > "$candidate/Caddyfile"
caddy validate --config "$candidate/Caddyfile" --adapter caddyfile
install -m 644 deploy/Caddyfile.rc.lvyrix.com /etc/caddy/conf.d/remote-console.caddy
systemctl reload caddy
printf '%s\n' 'Published https://rc.lvyrix.com (API 127.0.0.1:8798).'
