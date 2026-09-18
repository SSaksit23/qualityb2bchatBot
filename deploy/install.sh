#!/usr/bin/env bash
set -euo pipefail

test "$(id -u)" -eq 0 || { echo 'Run in the Hostinger root terminal.'; exit 1; }
stage=/var/lib/line-hub/bobo-stage
test -f "$stage/release.tar.gz"
test -f "$stage/SHA256SUMS"
test -f /root/bobo.env || { echo 'Create /root/bobo.env from .env.example with dedicated secrets and pilot IDs.'; exit 1; }
cd "$stage"
sha256sum --check SHA256SUMS
test ! -e /opt/qualityb2b-bobo || { echo 'Bobo is already installed; use a reviewed upgrade.'; exit 1; }
test ! -e /etc/systemd/system/qualityb2b-bobo.service
if ss -ltnH | awk '{print $4}' | grep -qE ':3212$'; then echo 'Port 3212 is in use'; exit 1; fi
grep -q '^LINE_BOT_USER_ID=U72707de51c9321546199e9c039bbdbd5$' /root/bobo.env
grep -q '^PILOT_OWNER_ID=U[0-9a-f]\{32\}$' /root/bobo.env
grep -q '^B2B_STORAGE_STATE=/var/lib/qualityb2b-bobo/auth/state.json$' /root/bobo.env
systemctl is-active line-hub line-coach nginx
nginx -t

id qualityb2b-bobo >/dev/null 2>&1 || useradd --system --home-dir /var/lib/qualityb2b-bobo --shell /usr/sbin/nologin qualityb2b-bobo
install -d -m 0755 /opt/qualityb2b-bobo
install -d -m 0700 /etc/qualityb2b-bobo
install -d -m 0700 -o qualityb2b-bobo -g qualityb2b-bobo /var/lib/qualityb2b-bobo /var/lib/qualityb2b-bobo/auth
tar -xzf release.tar.gz -C /opt/qualityb2b-bobo --no-same-owner
chown -R root:root /opt/qualityb2b-bobo
chmod -R go-w /opt/qualityb2b-bobo
install -m 0600 /root/bobo.env /etc/qualityb2b-bobo/bobo.env
install -m 0644 /opt/qualityb2b-bobo/deploy/qualityb2b-bobo.service /etc/systemd/system/qualityb2b-bobo.service
install -m 0644 /opt/qualityb2b-bobo/deploy/nginx.conf /etc/nginx/snippets/qualityb2b-bobo.conf

cd /opt/qualityb2b-bobo
export PATH=/opt/line-hub/runtime/bin:/usr/sbin:/usr/bin:/sbin:/bin
npm ci --ignore-scripts
PLAYWRIGHT_BROWSERS_PATH=/opt/qualityb2b-bobo/browsers npx playwright install --with-deps chromium
npm run check
npm test
test -f /var/lib/qualityb2b-bobo/auth/state.json || { echo 'Booking storage state is missing; service not started.'; exit 1; }
chown qualityb2b-bobo:qualityb2b-bobo /var/lib/qualityb2b-bobo/auth/state.json
chmod 0600 /var/lib/qualityb2b-bobo/auth/state.json

site=$(readlink -f /etc/nginx/sites-enabled/hermes-line)
test -f "$site"
marker='    server_name srv1925838.hstgr.cloud;'
include='    include /etc/nginx/snippets/qualityb2b-bobo.conf;'
grep -Fq "$include" "$site" || sed -i "0,/$marker/s//$marker\\n$include/" "$site"
nginx -t
systemctl daemon-reload
systemctl enable --now qualityb2b-bobo
systemctl reload nginx
curl --fail --silent http://127.0.0.1:3212/health
curl --fail --silent https://srv1925838.hstgr.cloud/bobo/health
echo
echo 'Service installed. Configure and verify the LINE webhook only after private /help and known-booking checks pass.'
