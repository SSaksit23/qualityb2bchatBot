#!/bin/bash
set -euo pipefail
export PATH=/opt/line-hub/runtime/bin:/usr/sbin:/usr/bin:/sbin:/bin
stage=/var/lib/line-hub/bobo-stage
release=/opt/qualityb2b-bobo-release-060
backup=/opt/qualityb2b-bobo/rollback-060
test ! -e "$release"
test ! -e "$backup"
mkdir -m 755 "$release"
tar -xzf "$stage/workflow-060.tar.gz" -C "$release"
cd "$release"
npm ci --ignore-scripts --no-audit --no-fund
chmod -R a+rX "$release"
export PLAYWRIGHT_BROWSERS_PATH=/opt/qualityb2b-bobo/browsers
runuser -u qualityb2b-bobo -- npm test
npm run check
set -a
. /etc/qualityb2b-bobo/bobo.env
set +a
runuser -u qualityb2b-bobo -- node "$release/deploy/check-router-060.mjs"
mkdir -m 700 "$backup"
files='app.mjs booking.mjs live-booking.mjs product-search.mjs product-format.mjs workflow.mjs hermes.mjs package.json package-lock.json test.mjs workflow.test.mjs README.md OPERATIONS.md IMPLEMENTATION_STATUS.md'
for file in $files; do cp "/opt/qualityb2b-bobo/$file" "$backup/$file"; done
cp /etc/qualityb2b-bobo/bobo.env "$backup/bobo.env"
rollback() {
  for file in $files; do cp "$backup/$file" "/opt/qualityb2b-bobo/$file"; done
  cp "$backup/bobo.env" /etc/qualityb2b-bobo/bobo.env
  systemctl start qualityb2b-bobo
}
systemctl stop qualityb2b-bobo
trap rollback ERR
for file in $files; do install -m 644 "$release/$file" "/opt/qualityb2b-bobo/$file"; done
install -m 644 "$release/deploy/check-router-060.mjs" /opt/qualityb2b-bobo/deploy/check-router-060.mjs
if grep -q '^BOBO_CATALOG_ROUTER_ENABLED=' /etc/qualityb2b-bobo/bobo.env; then
  sed -i 's/^BOBO_CATALOG_ROUTER_ENABLED=.*/BOBO_CATALOG_ROUTER_ENABLED=true/' /etc/qualityb2b-bobo/bobo.env
else
  printf '\nBOBO_CATALOG_ROUTER_ENABLED=true\n' >> /etc/qualityb2b-bobo/bobo.env
fi
systemctl start qualityb2b-bobo
sleep 2
systemctl is-active qualityb2b-bobo
curl -fsS http://127.0.0.1:3212/health
echo
trap - ERR
echo RELEASE_060_COMPLETE
