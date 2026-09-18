#!/bin/bash
set -euo pipefail
export PATH=/opt/line-hub/runtime/bin:/usr/sbin:/usr/bin:/sbin:/bin
stage=/var/lib/line-hub/bobo-stage
release=/opt/qualityb2b-bobo-release-040
test ! -e "$release"
mkdir -m 755 "$release"
tar -xzf "$stage/workflow-040.tar.gz" -C "$release"
cd "$release"
npm ci --ignore-scripts --no-audit --no-fund
chmod -R a+rX "$release"
export PLAYWRIGHT_BROWSERS_PATH=/opt/qualityb2b-bobo/browsers
runuser -u qualityb2b-bobo -- npm test
npm run check
backup=/opt/qualityb2b-bobo/rollback-040
mkdir -m 700 "$backup"
files='app.mjs booking.mjs live-booking.mjs product-search.mjs hermes.mjs package.json package-lock.json test.mjs OPERATIONS.md IMPLEMENTATION_STATUS.md'
for file in $files; do cp "/opt/qualityb2b-bobo/$file" "$backup/$file"; done
systemctl stop qualityb2b-bobo
rollback() {
  for file in $files; do cp "$backup/$file" "/opt/qualityb2b-bobo/$file"; done
  systemctl start qualityb2b-bobo
}
trap rollback ERR
for file in $files product-format.mjs workflow.mjs workflow.test.mjs; do install -m 644 "$release/$file" "/opt/qualityb2b-bobo/$file"; done
cp -a "$release/node_modules/." /opt/qualityb2b-bobo/node_modules/
install -m 644 "$release/deploy/check-workflow.mjs" /opt/qualityb2b-bobo/deploy/check-workflow.mjs
sed -i '/^BOBO_WORKFLOW_ENABLED=/d' /etc/qualityb2b-bobo/bobo.env
printf '\nBOBO_WORKFLOW_ENABLED=false\n' >> /etc/qualityb2b-bobo/bobo.env
systemctl start qualityb2b-bobo
trap - ERR
sleep 2
systemctl is-active qualityb2b-bobo
curl -fsS http://127.0.0.1:3212/health
echo
set -a
. /etc/qualityb2b-bobo/bobo.env
set +a
runuser -u qualityb2b-bobo -- node /opt/qualityb2b-bobo/deploy/check-workflow.mjs
echo RELEASE_FORMAT_COMPLETE_WORKFLOW_DISABLED
