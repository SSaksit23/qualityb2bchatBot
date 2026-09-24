#!/bin/bash
set -euo pipefail
export PATH=/opt/line-hub/runtime/bin:/usr/sbin:/usr/bin:/sbin:/bin
export PLAYWRIGHT_BROWSERS_PATH=/opt/qualityb2b-bobo/browsers
release=/opt/qualityb2b-bobo-release-063
backup=/opt/qualityb2b-bobo/rollback-063-$(date +%Y%m%dT%H%M%S)
cd "$release"
set -a
. /etc/qualityb2b-bobo/bobo.env
set +a
# This live gate must pass before stopping or replacing the service.
runuser -u qualityb2b-bobo -- node deploy/check-travel-window.mjs
files='app.mjs booking.mjs product-search.mjs product-format.mjs workflow.mjs package.json package-lock.json test.mjs workflow.test.mjs'
test ! -e "$backup"
mkdir -m 700 "$backup"
for file in $files; do cp -a "/opt/qualityb2b-bobo/$file" "$backup/$file"; done
cp -a /etc/qualityb2b-bobo/bobo.env "$backup/bobo.env"
rollback() {
  for file in $files; do cp -a "$backup/$file" "/opt/qualityb2b-bobo/$file"; done
  systemctl restart qualityb2b-bobo
}
systemctl stop qualityb2b-bobo
trap rollback ERR
for file in $files travel-window.mjs travel-window.test.mjs; do install -m 644 "$release/$file" "/opt/qualityb2b-bobo/$file"; done
systemctl start qualityb2b-bobo
ready=false
for attempt in $(seq 1 30); do
  if curl -fsS http://127.0.0.1:3212/health 2>/dev/null | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{const h=JSON.parse(s);process.exit(h.version==='0.6.3'&&h.ok?0:1);}catch{process.exit(1);}})"; then ready=true; break; fi
  sleep 1
done
test "$ready" = true
systemctl is-active --quiet qualityb2b-bobo
curl -fsS http://127.0.0.1:3212/health
trap - ERR
printf 'BOBO_063_DEPLOYED\n'
